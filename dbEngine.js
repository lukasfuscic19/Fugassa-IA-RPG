// NEW dbEngine.js
// Safe DB read layer for AI RPG world state

function tableExists(db, tableName) {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(tableName);
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

function safeAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function safeGet(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch {
    return null;
  }
}

function getPlayerRecord(db) {
  if (tableExists(db, "players")) {
    const row = safeGet(db, `SELECT * FROM players ORDER BY id ASC LIMIT 1`);
    if (row) return row;
  }
  return null;
}

function getPlayerCharacter(db) {
  if (!tableExists(db, "player_characters")) return null;
  return safeGet(db, `SELECT * FROM player_characters ORDER BY id ASC LIMIT 1`);
}

function getLocation(db, locationId) {
  if (!locationId || !tableExists(db, "locations")) return null;
  return safeGet(db, `SELECT * FROM locations WHERE id = ?`, [locationId]);
}

function getVisitedLocations(db, playerCharacterId, limit = 10) {
  if (!playerCharacterId || !tableExists(db, "visited_locations")) return [];
  const cols = getColumns(db, "visited_locations");
  const hasLocationId = cols.includes("location_id");
  const hasPlayerCharacterId = cols.includes("player_character_id");
  if (!hasLocationId || !hasPlayerCharacterId) return [];

  const orderCol = cols.includes("last_visited_at")
    ? "last_visited_at DESC"
    : cols.includes("visited_at")
    ? "visited_at DESC"
    : "id DESC";

  return safeAll(
    db,
    `SELECT * FROM visited_locations WHERE player_character_id = ? ORDER BY ${orderCol} LIMIT ?`,
    [playerCharacterId, limit]
  );
}

function getInventory(db, playerCharacterId) {
  if (!playerCharacterId) return [];

  if (tableExists(db, "player_character_inventory") && tableExists(db, "items")) {
    const pciCols = getColumns(db, "player_character_inventory");
    const itemCols = getColumns(db, "items");
    const hasQty = pciCols.includes("quantity");
    const itemNameCol = itemCols.includes("name") ? "i.name" : itemCols.includes("item_name") ? "i.item_name" : "NULL as name";
    const itemDescCol = itemCols.includes("description") ? "i.description" : "NULL as description";

    let where = "pci.player_character_id = ?";
    if (pciCols.includes("is_active")) where += " AND COALESCE(pci.is_active,1)=1";

    return safeAll(
      db,
      `SELECT
         pci.*,
         ${itemNameCol},
         ${itemDescCol}
       FROM player_character_inventory pci
       LEFT JOIN items i ON i.id = pci.item_id
       WHERE ${where}
       ORDER BY pci.id ASC`,
      [playerCharacterId]
    ).map(r => ({
      item_id: r.item_id,
      name: r.name || `Item #${r.item_id ?? "?"}`,
      description: r.description || null,
      quantity: hasQty ? (r.quantity ?? 1) : 1,
      raw: r
    }));
  }

  return [];
}

function getNPCsInLocation(db, locationId, limit = 20) {
  if (!locationId || !tableExists(db, "npcs")) return [];
  const npcCols = getColumns(db, "npcs");

  let locationFilter = null;
  if (npcCols.includes("location_id")) locationFilter = "location_id";
  else if (npcCols.includes("current_location_id")) locationFilter = "current_location_id";
  if (!locationFilter) return [];

  let where = `${locationFilter} = ?`;
  if (npcCols.includes("is_active")) where += " AND COALESCE(is_active,1)=1";

  const rows = safeAll(
    db,
    `SELECT * FROM npcs WHERE ${where} ORDER BY id ASC LIMIT ?`,
    [locationId, limit]
  );

  return rows.map(r => ({
    id: r.id,
    name: r.name || r.display_name || `NPC #${r.id}`,
    role: r.role || r.archetype || r.occupation || null,
    summary: r.summary || r.description_short || r.description || null,
    disposition: r.disposition || r.attitude || null,
    raw: r
  }));
}

function getActiveQuests(db, playerCharacterId, limit = 20) {
  if (!tableExists(db, "quests")) return [];
  const qCols = getColumns(db, "quests");

  let whereParts = [];
  if (qCols.includes("player_character_id") && playerCharacterId) {
    whereParts.push(`player_character_id = ${Number(playerCharacterId)}`);
  }
  if (qCols.includes("is_active")) whereParts.push("COALESCE(is_active,1)=1");
  if (qCols.includes("status")) {
    whereParts.push(`LOWER(COALESCE(status,'')) NOT IN ('completed','failed','archived')`);
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  return safeAll(
    db,
    `SELECT * FROM quests ${where} ORDER BY id ASC LIMIT ?`,
    [limit]
  ).map(r => ({
    id: r.id,
    title: r.title || r.name || `Quest #${r.id}`,
    status: r.status || "active",
    summary: r.summary || r.description || null,
    reward: r.reward_summary || r.reward || null,
    raw: r
  }));
}

function getLocationConnections(db, locationId, limit = 12) {
  if (!locationId || !tableExists(db, "location_connections")) return [];
  const cols = getColumns(db, "location_connections");
  const fromCol = cols.includes("from_location_id") ? "from_location_id" : cols.includes("location_id") ? "location_id" : null;
  const toCol = cols.includes("to_location_id") ? "to_location_id" : cols.includes("connected_location_id") ? "connected_location_id" : null;
  if (!fromCol || !toCol) return [];

  return safeAll(
    db,
    `SELECT lc.*, l.name as to_location_name
     FROM location_connections lc
     LEFT JOIN locations l ON l.id = lc.${toCol}
     WHERE lc.${fromCol} = ?
     ORDER BY lc.id ASC
     LIMIT ?`,
    [locationId, limit]
  ).map(r => ({
    direction: r.direction || r.label || null,
    to_location_id: r[toCol],
    to_location_name: r.to_location_name || null,
    travel_method: r.travel_method || null,
    raw: r
  }));
}

function getLocationFlags(db, locationId) {
  if (!locationId || !tableExists(db, "location_state_flags")) return [];
  const cols = getColumns(db, "location_state_flags");
  if (!cols.includes("location_id")) return [];

  return safeAll(
    db,
    `SELECT * FROM location_state_flags WHERE location_id = ? ORDER BY id ASC`,
    [locationId]
  ).map(r => {
    const flagName =
      r.flag_name ??
      r.flag_key ??
      r.flag ??
      r.state_key ??
      `flag_${r.id}`;

    let value = null;
    if (r.flag_value_boolean !== undefined && r.flag_value_boolean !== null) {
      value = !!r.flag_value_boolean;
    } else if (r.flag_value_integer !== undefined && r.flag_value_integer !== null) {
      value = r.flag_value_integer;
    } else if (r.flag_value_text !== undefined && r.flag_value_text !== null) {
      value = r.flag_value_text;
    } else if (r.flag_value !== undefined) {
      value = r.flag_value;
    } else if (r.value !== undefined) {
      value = r.value;
    } else if (r.state_value !== undefined) {
      value = r.state_value;
    }

    return {
      flag: flagName,
      value,
      notes: r.notes ?? null,
      raw: r
    };
  });
}

function buildWorldContext(db) {
  const playerRecord = getPlayerRecord(db);
  const playerCharacter = getPlayerCharacter(db);
  const currentLocation = playerCharacter ? getLocation(db, playerCharacter.current_location_id || playerCharacter.location_id) : null;

  const playerCharacterId = playerCharacter?.id || null;
  const locationId = currentLocation?.id || null;

  const inventory = getInventory(db, playerCharacterId);
  const npcs = getNPCsInLocation(db, locationId);
  const activeQuests = getActiveQuests(db, playerCharacterId);
  const visitedLocations = getVisitedLocations(db, playerCharacterId);
  const exits = getLocationConnections(db, locationId);
  const locationFlags = getLocationFlags(db, locationId);

  return {
    playerRecord,
    playerCharacter,
    currentLocation,
    inventory,
    npcs,
    activeQuests,
    visitedLocations,
    exits,
    locationFlags
  };
}

module.exports = {
  tableExists,
  getColumns,
  hasColumn,
  getPlayerRecord,
  getPlayerCharacter,
  getLocation,
  getVisitedLocations,
  getInventory,
  getNPCsInLocation,
  getActiveQuests,
  getLocationConnections,
  getLocationFlags,
  buildWorldContext
};
