// NEW dbWriteEngine.js
// Controlled world-state write-back with reversible turn-linked changes

function tableExists(db, tableName) {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
    return !!row;
  } catch {
    return false;
  }
}

function getColumns(db, tableName) {
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
  } catch {
    return [];
  }
}

function hasColumn(db, tableName, columnName) {
  return getColumns(db, tableName).includes(columnName);
}

function safeGet(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch {
    return null;
  }
}

function safeRun(db, sql, params = []) {
  try {
    return db.prepare(sql).run(...params);
  } catch {
    return null;
  }
}

function bootstrapWorldChangeLog(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id INTEGER NOT NULL,
      change_type TEXT NOT NULL,
      inverse_json TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function logInverse(db, turnId, changeType, inversePayload) {
  safeRun(
    db,
    `INSERT INTO world_change_log (turn_id, change_type, inverse_json, is_active)
     VALUES (?, ?, ?, 1)`,
    [turnId, changeType, JSON.stringify(inversePayload || {})]
  );
}

function resolveItemId(db, itemId, itemName) {
  if (itemId && Number.isFinite(Number(itemId))) return Number(itemId);
  if (!itemName || !tableExists(db, "items")) return null;

  const cols = getColumns(db, "items");
  const nameCol = cols.includes("name") ? "name" : cols.includes("item_name") ? "item_name" : null;
  if (!nameCol) return null;

  const row = safeGet(db, `SELECT id FROM items WHERE LOWER(${nameCol}) = LOWER(?) LIMIT 1`, [itemName]);
  return row?.id ?? null;
}

function setPlayerLocation(db, playerCharacterId, toLocationId) {
  if (!tableExists(db, "player_characters")) return null;
  const cols = getColumns(db, "player_characters");
  const locCol = cols.includes("current_location_id") ? "current_location_id" : cols.includes("location_id") ? "location_id" : null;
  if (!locCol) return null;

  const before = safeGet(db, `SELECT id, ${locCol} as current_location_id FROM player_characters WHERE id = ?`, [playerCharacterId]);
  if (!before) return null;

  safeRun(db, `UPDATE player_characters SET ${locCol} = ? WHERE id = ?`, [toLocationId, playerCharacterId]);
  return before.current_location_id ?? null;
}

function insertVisitedLocation(db, playerCharacterId, locationId, ingameTime) {
  if (!tableExists(db, "visited_locations")) return null;
  const cols = getColumns(db, "visited_locations");
  if (!cols.includes("player_character_id") || !cols.includes("location_id")) return null;

  const fields = [];
  const values = [];
  const params = [];

  fields.push("player_character_id"); values.push("?"); params.push(playerCharacterId);
  fields.push("location_id"); values.push("?"); params.push(locationId);

  if (cols.includes("visited_at")) { fields.push("visited_at"); values.push("?"); params.push(ingameTime); }
  if (cols.includes("last_visited_at")) { fields.push("last_visited_at"); values.push("?"); params.push(ingameTime); }
  if (cols.includes("created_at")) { /* let default handle if present */ }

  const info = safeRun(db, `INSERT INTO visited_locations (${fields.join(", ")}) VALUES (${values.join(", ")})`, params);
  return info?.lastInsertRowid ?? null;
}

function getInventoryRow(db, playerCharacterId, itemId) {
  if (!tableExists(db, "player_character_inventory")) return null;
  const cols = getColumns(db, "player_character_inventory");
  if (!cols.includes("player_character_id") || !cols.includes("item_id")) return null;

  let sql = `SELECT * FROM player_character_inventory WHERE player_character_id = ? AND item_id = ?`;
  if (cols.includes("is_active")) sql += " AND COALESCE(is_active,1)=1";
  sql += " ORDER BY id ASC LIMIT 1";
  return safeGet(db, sql, [playerCharacterId, itemId]);
}

function setInventoryQuantity(db, playerCharacterId, itemId, quantity) {
  if (!tableExists(db, "player_character_inventory")) return;
  const cols = getColumns(db, "player_character_inventory");
  if (!cols.includes("player_character_id") || !cols.includes("item_id")) return;

  const row = getInventoryRow(db, playerCharacterId, itemId);
  const qtyCol = cols.includes("quantity");

  if (row) {
    if (quantity <= 0) {
      if (cols.includes("is_active")) {
        safeRun(db, `UPDATE player_character_inventory SET is_active = 0${qtyCol ? ", quantity = 0" : ""} WHERE id = ?`, [row.id]);
      } else if (qtyCol) {
        safeRun(db, `UPDATE player_character_inventory SET quantity = 0 WHERE id = ?`, [row.id]);
      }
    } else {
      if (qtyCol) {
        let sql = `UPDATE player_character_inventory SET quantity = ?`;
        const params = [quantity];
        if (cols.includes("is_active")) { sql += `, is_active = 1`; }
        sql += ` WHERE id = ?`;
        params.push(row.id);
        safeRun(db, sql, params);
      } else if (cols.includes("is_active")) {
        safeRun(db, `UPDATE player_character_inventory SET is_active = 1 WHERE id = ?`, [row.id]);
      }
    }
    return;
  }

  if (quantity <= 0) return;

  const fields = ["player_character_id", "item_id"];
  const values = ["?", "?"];
  const params = [playerCharacterId, itemId];

  if (qtyCol) {
    fields.push("quantity");
    values.push("?");
    params.push(quantity);
  }
  if (cols.includes("is_active")) {
    fields.push("is_active");
    values.push("1");
  }

  safeRun(db, `INSERT INTO player_character_inventory (${fields.join(", ")}) VALUES (${values.join(", ")})`, params);
}

function applyInventoryChange(db, change, ctx) {
  const itemId = resolveItemId(db, change.item_id, change.item_name);
  if (!itemId) return false;

  const existing = getInventoryRow(db, ctx.playerCharacterId, itemId);
  const oldQty = existing ? (existing.quantity ?? (existing.is_active === 0 ? 0 : 1)) : 0;
  const qty = Math.max(1, Number(change.quantity) || 1);

  let newQty = oldQty;
  if (change.action === "add") newQty = oldQty + qty;
  if (change.action === "remove") newQty = Math.max(0, oldQty - qty);

  setInventoryQuantity(db, ctx.playerCharacterId, itemId, newQty);
  logInverse(db, ctx.turnId, "inventory", {
    player_character_id: ctx.playerCharacterId,
    item_id: itemId,
    previous_quantity: oldQty
  });
  return true;
}

function applyQuestUpdate(db, update, ctx) {
  if (!tableExists(db, "quests")) return false;
  const cols = getColumns(db, "quests");
  const questId = Number(update.quest_id);
  if (!Number.isFinite(questId)) return false;

  const row = safeGet(db, `SELECT * FROM quests WHERE id = ?`, [questId]);
  if (!row) return false;

  const inverse = { quest_id: questId };
  let changed = false;

  if (update.status && cols.includes("status")) {
    inverse.status = row.status ?? null;
    safeRun(db, `UPDATE quests SET status = ? WHERE id = ?`, [String(update.status), questId]);
    changed = true;
  }

  if (update.note) {
    const noteCol = cols.includes("summary") ? "summary" : cols.includes("description") ? "description" : null;
    if (noteCol) {
      inverse[noteCol] = row[noteCol] ?? null;
      safeRun(db, `UPDATE quests SET ${noteCol} = ? WHERE id = ?`, [String(update.note), questId]);
      changed = true;
    }
  }

  if (changed) {
    logInverse(db, ctx.turnId, "quest", inverse);
  }

  return changed;
}

function applyNpcEncounter(db, encounter, ctx) {
  const npcId = Number(encounter.npc_id);
  if (!Number.isFinite(npcId)) return false;

  if (tableExists(db, "npc_memories")) {
    const cols = getColumns(db, "npc_memories");
    const fields = [];
    const values = [];
    const params = [];

    if (cols.includes("npc_id")) { fields.push("npc_id"); values.push("?"); params.push(npcId); }
    if (cols.includes("player_character_id")) { fields.push("player_character_id"); values.push("?"); params.push(ctx.playerCharacterId); }

    const noteCol =
      cols.includes("memory_text") ? "memory_text" :
      cols.includes("summary") ? "summary" :
      cols.includes("text") ? "text" :
      cols.includes("description") ? "description" :
      cols.includes("note") ? "note" : null;

    if (noteCol) { fields.push(noteCol); values.push("?"); params.push(String(encounter.note || "Encountered the player.")); }
    if (cols.includes("ingame_created_at")) { fields.push("ingame_created_at"); values.push("?"); params.push(ctx.ingameTime); }
    if (cols.includes("turn_id")) { fields.push("turn_id"); values.push("?"); params.push(ctx.turnId); }
    if (cols.includes("is_active")) { fields.push("is_active"); values.push("1"); }

    if (fields.length >= 2) {
      const info = safeRun(db, `INSERT INTO npc_memories (${fields.join(", ")}) VALUES (${values.join(", ")})`, params);
      if (info?.lastInsertRowid) {
        logInverse(db, ctx.turnId, "npc_memory", { memory_id: info.lastInsertRowid });
        return true;
      }
    }
  }

  return false;
}

function applyLocationChange(db, locationChange, ctx) {
  if (!locationChange || !Number.isFinite(Number(locationChange.to_location_id))) return null;
  const toLocationId = Number(locationChange.to_location_id);
  if (toLocationId === ctx.currentLocationId) return toLocationId;

  const oldLocationId = setPlayerLocation(db, ctx.playerCharacterId, toLocationId);
  if (oldLocationId === null || oldLocationId === undefined) return null;

  const visitedRowId = insertVisitedLocation(db, ctx.playerCharacterId, toLocationId, ctx.ingameTime);
  logInverse(db, ctx.turnId, "location", {
    player_character_id: ctx.playerCharacterId,
    previous_location_id: oldLocationId,
    visited_row_id: visitedRowId
  });
  return toLocationId;
}

function applyWorldChanges(db, changes, ctx) {
  const result = {
    applied: false,
    location_changed: false,
    currentLocationId: ctx.currentLocationId,
    inventory_changes_applied: 0,
    npc_encounters_applied: 0,
    quest_updates_applied: 0
  };

  if (!changes || typeof changes !== "object") return result;

  if (changes.location_change) {
    const newLoc = applyLocationChange(db, changes.location_change, ctx);
    if (newLoc !== null) {
      result.applied = true;
      result.location_changed = newLoc !== ctx.currentLocationId;
      result.currentLocationId = newLoc;
      ctx.currentLocationId = newLoc;
    }
  }

  if (Array.isArray(changes.inventory_changes)) {
    for (const ch of changes.inventory_changes) {
      if (applyInventoryChange(db, ch || {}, ctx)) {
        result.applied = true;
        result.inventory_changes_applied += 1;
      }
    }
  }

  if (Array.isArray(changes.npc_encounters)) {
    for (const enc of changes.npc_encounters) {
      if (applyNpcEncounter(db, enc || {}, ctx)) {
        result.applied = true;
        result.npc_encounters_applied += 1;
      }
    }
  }

  if (Array.isArray(changes.quest_updates)) {
    for (const qu of changes.quest_updates) {
      if (applyQuestUpdate(db, qu || {}, ctx)) {
        result.applied = true;
        result.quest_updates_applied += 1;
      }
    }
  }

  return result;
}

function revertWorldChanges(db, turnId) {
  if (!tableExists(db, "world_change_log")) return;

  const rows = db.prepare(`
    SELECT *
    FROM world_change_log
    WHERE turn_id = ? AND COALESCE(is_active,1)=1
    ORDER BY id DESC
  `).all(turnId);

  for (const row of rows) {
    let inverse = {};
    try {
      inverse = JSON.parse(row.inverse_json || "{}");
    } catch {
      inverse = {};
    }

    if (row.change_type === "location") {
      if (inverse.player_character_id && inverse.previous_location_id !== undefined) {
        setPlayerLocation(db, inverse.player_character_id, inverse.previous_location_id);
      }
      if (inverse.visited_row_id && tableExists(db, "visited_locations")) {
        safeRun(db, `DELETE FROM visited_locations WHERE id = ?`, [inverse.visited_row_id]);
      }
    }

    if (row.change_type === "inventory") {
      if (inverse.player_character_id && inverse.item_id !== undefined) {
        setInventoryQuantity(db, inverse.player_character_id, inverse.item_id, Number(inverse.previous_quantity) || 0);
      }
    }

    if (row.change_type === "quest") {
      const questId = inverse.quest_id;
      if (questId && tableExists(db, "quests")) {
        const cols = getColumns(db, "quests");
        if (inverse.status !== undefined && cols.includes("status")) {
          safeRun(db, `UPDATE quests SET status = ? WHERE id = ?`, [inverse.status, questId]);
        }
        if (inverse.summary !== undefined && cols.includes("summary")) {
          safeRun(db, `UPDATE quests SET summary = ? WHERE id = ?`, [inverse.summary, questId]);
        }
        if (inverse.description !== undefined && cols.includes("description")) {
          safeRun(db, `UPDATE quests SET description = ? WHERE id = ?`, [inverse.description, questId]);
        }
      }
    }

    if (row.change_type === "npc_memory") {
      if (inverse.memory_id && tableExists(db, "npc_memories")) {
        safeRun(db, `DELETE FROM npc_memories WHERE id = ?`, [inverse.memory_id]);
      }
    }

    safeRun(db, `UPDATE world_change_log SET is_active = 0 WHERE id = ?`, [row.id]);
  }
}

module.exports = {
  bootstrapWorldChangeLog,
  applyWorldChanges,
  revertWorldChanges
};
