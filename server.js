// PATCHED server.js
// Dynamic prompt builder + new GM guides support + DB read integration

const express = require("express");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const {
  ensureBaseDirs,
  listSaves,
  createSave,
  deleteSave,
  setActiveSave,
  getActiveSave,
  getActivePaths,
  getNarrateMode,
  setNarrateMode,
  readSaveConfig,
  readSetupDraft,
  writeSetupDraft,
  setSetupComplete
} = require("./saveManager");
const { buildWorldContext } = require("./dbEngine");
const { bootstrapWorldChangeLog, applyWorldChanges, revertWorldChanges } = require("./dbWriteEngine");

const {
  getDefaultSetupDraft,
  ensureWizardMessageArray,
  ensureWizardMeta,
  ensureWizardState,
  getLastWizardPairInfo,
  overviewIntent,
  explicitFinalizeIntent,
  likelyFinalizeIntent,
  detectAutoFillIntent,
  getCurrentWizardStage,
  assessSetupCompleteness,
  advanceWizardStage,
  setWizardStage,
  canFinalizeSetup,
  buildWizardOpeningMessage,
  buildWizardTransitionMessage,
  buildStageSystemPrompt,
  buildStageUserPrompt,
  buildSetupOverviewText,
  mergePlayerInputIntoStructured,
  fillStageDefaults
} = require("./engine/wizardEngine");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "web")));

const LM_STUDIO_MODEL = "qwen3.5-9b-uncensored-hauhaucs-aggressive";
const LM_STUDIO_URL = "http://localhost:1234/v1/chat/completions";
const MAX_OUTPUT_TOKENS = 8000;

ensureBaseDirs();

// -------------------- DB bootstrap --------------------

function getDb() {
  const active = getActivePaths();
  if (!active) return null;
  const db = new Database(active.dbPath);
  bootstrapTurnTables(db);
  bootstrapWorldChangeLog(db);
  return db;
}

function bootstrapTurnTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_text TEXT NOT NULL,
      ai_text TEXT NOT NULL,
      prompt_snapshot TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ingame_time TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      replaces_turn_id INTEGER
    );
  `);

  const eventCols = db.prepare(`PRAGMA table_info(event_log)`).all();
  if (!eventCols.find(c => c.name === "turn_id")) {
    db.exec(`ALTER TABLE event_log ADD COLUMN turn_id INTEGER;`);
  }
  if (!eventCols.find(c => c.name === "is_active")) {
    db.exec(`ALTER TABLE event_log ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;`);
  }

  const sceneExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='scene_summaries'`)
    .get();

  if (sceneExists) {
    const sceneCols = db.prepare(`PRAGMA table_info(scene_summaries)`).all();
    if (!sceneCols.find(c => c.name === "turn_id")) {
      db.exec(`ALTER TABLE scene_summaries ADD COLUMN turn_id INTEGER;`);
    }
    if (!sceneCols.find(c => c.name === "is_active")) {
      db.exec(`ALTER TABLE scene_summaries ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;`);
    }
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scene_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_character_id INTEGER NOT NULL,
        location_id INTEGER,
        summary_text TEXT NOT NULL,
        ingame_created_at TEXT,
        is_current INTEGER NOT NULL DEFAULT 1,
        turn_id INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_character_id) REFERENCES player_characters(id) ON DELETE CASCADE,
        FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
      );
    `);
  }
}

// -------------------- File helpers --------------------

function readTextFileSafe(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return fallback;
  }
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

// -------------------- Dynamic GM guide loading --------------------

function detectGuideNeeds(actionText = "", snapshot = {}) {
  const text = String(actionText || "").toLowerCase();

  return {
    needsNpc: /(talk|ask|speak|say|guard|merchant|villager|persuade|convince|intimidate|flirt|threaten|question|approach|greet)/.test(text),
    needsWorld: /(look|search|inspect|investigate|explore|observe|tracks|gate|door|room|around|follow|listen|watch|survey)/.test(text),
    needsCombat: /(attack|fight|shoot|stab|combat|kill|strike|slash|punch|ambush|duel|battle)/.test(text),
    needsCrafting: /(craft|build|repair|forge|assemble|blueprint|schematic|make|brew|smith|enchant item)/.test(text),
    needsEconomy: /(buy|sell|trade|gold|coin|inventory|loot|bag|pack|merchant|pay|price|cost|shop)/.test(text),
    needsQuests: /(quest|mission|job|guild|faction|reputation|task|contract|bounty)/.test(text),
    needsMagic: /(magic|spell|ritual|mana|arcane|aether|weave|enchanted|sorcery|cast)/.test(text),
  };
}

function loadGuideGroup(gmDir, fileNames) {
  return fileNames
    .map((fileName) => {
      const full = path.join(gmDir, fileName);
      return fileExists(full) ? readTextFileSafe(full, "") : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildGuideBundle(gmDir, actionText, snapshot = {}, narrateMode = false) {
  const alwaysFiles = [
    "gm_core.txt",
    "gm_time.txt",
    "gm_immersion.txt",
    "gm_output_format.txt",
    "gm_qwen_boost.txt",
    "gm_action_interpretation.txt",
    "gm_world_sanity.txt",
    "gm_world.txt"
  ];

  const needs = detectGuideNeeds(actionText, snapshot);
  const selected = new Set(alwaysFiles);

  if (needs.needsNpc) selected.add("gm_npc.txt");
  if (needs.needsCombat) selected.add("gm_combat.txt");
  if (needs.needsCrafting) selected.add("gm_crafting.txt");
  if (needs.needsEconomy) selected.add("gm_economy.txt");
  if (needs.needsQuests) selected.add("gm_quests.txt");
  if (needs.needsMagic) selected.add("gm_magic.txt");

  const text = loadGuideGroup(gmDir, Array.from(selected));

  const canonBlock = `
DATABASE AND WORLD CANON

The provided structured world state is canonical truth.
Do not contradict it.
Do not invent persistent NPCs, locations, factions, artifacts, or major world facts unless the narration clearly frames them as uncertain, distant rumor, or minor background detail.

Player actions are attempts, not facts.
If an action is impossible in the present scene, say so in-world and offer a plausible alternative.

Narrate from what exists, not from what the player merely wishes to exist.
`.trim();

  const narrateBlock = narrateMode
    ? `NARRATE MODE\nNarrate mode is ON. Resolve uncertainty narratively. Do not require explicit dice rolling from the player. Favor believable soft outcomes over mechanical framing.`
    : `NARRATE MODE\nNarrate mode is OFF. Mechanical uncertainty may exist. Preserve risk, resistance, and harder consequences when appropriate.`;

  return `${text}\n\n${canonBlock}\n\n${narrateBlock}`.trim();
}

// -------------------- World state helpers --------------------

function getGameTime(db) {
  return db.prepare(`
    SELECT formatted_time, time_label, season_label
    FROM game_time_state
    ORDER BY id DESC
    LIMIT 1
  `).get() || {
    formatted_time: "Era 1, Year 1, Month 1, Day 1, 08:00:00",
    time_label: "Morning",
    season_label: "Spring"
  };
}

function getPlayerCharacter(db) {
  return db.prepare(`SELECT * FROM player_characters ORDER BY id ASC LIMIT 1`).get();
}

function getLocation(db, id) {
  if (!id) return null;
  try {
    return db.prepare(`SELECT * FROM locations WHERE id = ?`).get(id);
  } catch {
    return null;
  }
}

function getRecentEvents(db, limit = 5) {
  try {
    return db.prepare(`
      SELECT event_type, summary, ingame_occurred_at
      FROM event_log
      WHERE COALESCE(is_active,1)=1
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

function getLastSceneSummary(db, playerCharacterId) {
  try {
    return db.prepare(`
      SELECT summary_text
      FROM scene_summaries
      WHERE player_character_id = ? AND is_current = 1 AND COALESCE(is_active,1)=1
      ORDER BY id DESC
      LIMIT 1
    `).get(playerCharacterId);
  } catch {
    return null;
  }
}

function getTimestampHeader(gameTime, locationName) {
  const formatted = gameTime.formatted_time || "Era 1, Year 1, Month 1, Day 1, 08:00:00";
  const match = formatted.match(/Day\s+\d+,\s+(\d{2}):(\d{2}):(\d{2})/i);
  let hh = "08";
  let mm = "00";
  if (match) {
    hh = match[1];
    mm = match[2];
  }

  let h = parseInt(hh, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  let twelve = h % 12;
  if (twelve === 0) twelve = 12;

  const hh12 = String(twelve).padStart(2, "0");
  const timeOfDay = gameTime.time_label || "Morning";
  const season = gameTime.season_label || "Spring";
  const moonPhase = "Waxing Crescent";
  const weather = "Cool air, light wind";

  return `| ${timeOfDay} | ${hh12}:${mm} ${ampm} | ${formatted.replace(/,\s+\d{2}:\d{2}:\d{2}$/,"")} | ${moonPhase} | ${locationName || "Unknown Location"} | ${season} | ${weather} |`;
}

// -------------------- Output cleanup --------------------

function cleanNarrative(raw) {
  if (!raw) return "";
  let text = raw.trim();

  const closeTag = "</think>";
  const idx = text.lastIndexOf(closeTag);
  if (idx !== -1) text = text.substring(idx + closeTag.length).trim();

  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => {
      const lower = p.toLowerCase();
      const banned = [
        "thinking process",
        "analyze the request",
        "input data:",
        "goal:",
        "constraints:",
        "drafting",
        "character:",
        "location:",
        "time:",
        "action:",
        "the user wants",
        "i need to",
        "i should"
      ];
      return !banned.some((x) => lower.includes(x));
    });

  return paragraphs.join("\n\n").trim();
}

function extractFirstJsonObject(raw) {
  if (!raw) return null;
  const text = String(raw).trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const objText = candidate.slice(start, end + 1);
  try {
    return JSON.parse(objText);
  } catch {
    return null;
  }
}

async function proposeWorldChanges(snapshot, aiNarrative) {
  const systemPrompt = `
You are a strict world-state extraction engine.

Return ONLY valid JSON.
No markdown.
No explanation.

You must propose only grounded world changes already supported by the current scene.

Allowed schema:
{
  "location_change": { "to_location_id": number|null, "reason": string|null },
  "inventory_changes": [
    {
      "action": "add"|"remove",
      "item_id": number|null,
      "item_name": string|null,
      "quantity": number,
      "reason": string|null
    }
  ],
  "npc_encounters": [
    {
      "npc_id": number,
      "note": string
    }
  ],
  "quest_updates": [
    {
      "quest_id": number,
      "status": string|null,
      "note": string|null
    }
  ]
}

Rules:
- Use only IDs present in WORLD DATA when possible.
- If no grounded change is clearly supported, return empty arrays and null location_change.
- Do not invent new NPCs, quests, or items.
- A location change should be proposed only if the narration clearly places the player in a connected destination.
- NPC encounter should be proposed only for NPCs present in WORLD DATA.
- Inventory changes should be proposed only if the narration clearly gains or loses an item.
- Quest updates should be proposed only if the narration clearly advances, starts, completes, or fails a known quest.
`.trim();

  const userPrompt = `
WORLD DATA:
${JSON.stringify(snapshot, null, 2)}

AI NARRATIVE:
${aiNarrative}

Return the JSON object now.
`.trim();

  try {
    const raw = await callLmStudio([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], 1200, 0.2);

    const parsed = extractFirstJsonObject(raw);
    if (!parsed || typeof parsed !== "object") {
      return {
        location_change: null,
        inventory_changes: [],
        npc_encounters: [],
        quest_updates: []
      };
    }

    return {
      location_change: parsed.location_change || null,
      inventory_changes: Array.isArray(parsed.inventory_changes) ? parsed.inventory_changes : [],
      npc_encounters: Array.isArray(parsed.npc_encounters) ? parsed.npc_encounters : [],
      quest_updates: Array.isArray(parsed.quest_updates) ? parsed.quest_updates : []
    };
  } catch {
    return {
      location_change: null,
      inventory_changes: [],
      npc_encounters: [],
      quest_updates: []
    };
  }
}

// -------------------- Turn persistence --------------------

function saveSceneSummary(db, playerCharacterId, locationId, summaryText, ingameTime, turnId) {
  try {
    db.prepare(`UPDATE scene_summaries SET is_current = 0 WHERE player_character_id = ?`).run(playerCharacterId);
    db.prepare(`
      INSERT INTO scene_summaries (
        player_character_id, location_id, summary_text, ingame_created_at, is_current, turn_id, is_active
      ) VALUES (?, ?, ?, ?, 1, ?, 1)
    `).run(playerCharacterId, locationId || null, summaryText, ingameTime, turnId || null);
  } catch {}
}

function saveEvent(db, summary, ingameTime, turnId) {
  try {
    db.prepare(`
      INSERT INTO event_log (code, event_type, title, summary, ingame_occurred_at, turn_id, is_active)
      VALUES (?, 'other', 'Player Action', ?, ?, ?, 1)
    `).run(`evt_${Date.now()}`, summary, ingameTime, turnId || null);
  } catch {}
}

function createTurn(db, playerText, aiText, promptSnapshot, ingameTime, replacesTurnId = null) {
  const info = db.prepare(`
    INSERT INTO turn_history (player_text, ai_text, prompt_snapshot, ingame_time, is_active, replaces_turn_id)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(playerText, aiText, JSON.stringify(promptSnapshot || null), ingameTime || null, replacesTurnId);
  return info.lastInsertRowid;
}

function getLastActiveTurn(db) {
  return db.prepare(`
    SELECT *
    FROM turn_history
    WHERE is_active = 1
    ORDER BY id DESC
    LIMIT 1
  `).get();
}

function invalidateTurnArtifacts(db, turnId, playerCharacterId) {
  revertWorldChanges(db, turnId);
  db.prepare(`UPDATE turn_history SET is_active = 0 WHERE id = ?`).run(turnId);

  try {
    db.prepare(`UPDATE event_log SET is_active = 0 WHERE turn_id = ?`).run(turnId);
  } catch {}

  try {
    db.prepare(`UPDATE scene_summaries SET is_active = 0, is_current = 0 WHERE turn_id = ?`).run(turnId);

    const previous = db.prepare(`
      SELECT id
      FROM scene_summaries
      WHERE player_character_id = ? AND COALESCE(is_active,1)=1
      ORDER BY id DESC
      LIMIT 1
    `).get(playerCharacterId);

    if (previous?.id) {
      db.prepare(`UPDATE scene_summaries SET is_current = 1 WHERE id = ?`).run(previous.id);
    }
  } catch {}
}

// -------------------- LM Studio --------------------

async function callLmStudio(messages, maxTokens = MAX_OUTPUT_TOKENS, temperature = 0.7) {
  const response = await fetch(LM_STUDIO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer lm-studio"
    },
    body: JSON.stringify({
      model: LM_STUDIO_MODEL,
      temperature,
      top_p: 0.95,
      max_tokens: maxTokens,
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LM Studio error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// -------------------- Wizard + setup helpers --------------------

const {
  getDefaultSetupDraft,
  ensureWizardMessageArray,
  ensureWizardMeta,
  ensureWizardState,
  overviewIntent,
  explicitFinalizeIntent,
  likelyFinalizeIntent,
  detectAutoFillIntent,
  getCurrentWizardStage,
  assessSetupCompleteness,
  setWizardStage,
  canFinalizeSetup,
  buildWizardOpeningMessage,
  buildWizardTransitionMessage,
  buildStageSystemPrompt,
  buildStageUserPrompt,
  buildSetupOverviewText,
  mergePlayerInputIntoStructured,
  fillStageDefaults
} = require("./engine/wizardEngine");

function appendWizardMessage(saveName, role, content) {
  const draft = readSetupDraft(saveName) || getDefaultSetupDraft();
  ensureWizardMessageArray(draft).push({ role, content, createdAt: new Date().toISOString() });
  ensureWizardMeta(draft);
  writeSetupDraft(saveName, draft);
  return draft;
}

function makeCode(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

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

function safeRun(db, sql, params = []) {
  try {
    return db.prepare(sql).run(...params);
  } catch {
    return null;
  }
}

function safeGet(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch {
    return null;
  }
}

function clearCampaignWorld(db) {
  const statements = [
    `DELETE FROM world_change_log`,
    `DELETE FROM turn_history`,
    `DELETE FROM scene_summaries`,
    `DELETE FROM item_ownership_log`,
    `DELETE FROM player_character_inventory`,
    `DELETE FROM npc_inventory`,
    `DELETE FROM npc_memories`,
    `DELETE FROM npc_relationships`,
    `DELETE FROM npc_goals`,
    `DELETE FROM npc_skills`,
    `DELETE FROM npc_spellbooks`,
    `DELETE FROM npc_stats`,
    `DELETE FROM npc_traits`,
    `DELETE FROM quests`,
    `DELETE FROM event_log`,
    `DELETE FROM visited_locations`,
    `DELETE FROM location_connections`,
    `DELETE FROM location_state_flags`,
    `DELETE FROM assets`,
    `DELETE FROM npcs`,
    `DELETE FROM items`,
    `DELETE FROM player_characters`,
    `DELETE FROM locations`,
    `DELETE FROM campaign_settings`,
    `DELETE FROM story_arcs`
  ];
  for (const sql of statements) {
    try { db.prepare(sql).run(); } catch {}
  }
}

function ensureMainPlayerRecord(db, ingameTime) {
  const existing = safeGet(db, `SELECT * FROM players ORDER BY id ASC LIMIT 1`);
  if (existing?.id) return existing.id;
  const info = safeRun(db, `
    INSERT INTO players (code, display_name, notes, ingame_created_at, ingame_updated_at)
    VALUES (?, ?, ?, ?, ?)
  `, [makeCode("player"), "Main Player", null, ingameTime || null, ingameTime || null]);
  return info?.lastInsertRowid || 1;
}

function ensureCalendarAndTime(db, startingTime = {}) {
  let calendar = safeGet(db, `SELECT * FROM game_calendars ORDER BY id ASC LIMIT 1`);
  if (!calendar && tableExists(db, "game_calendars")) {
    const info = safeRun(db, `
      INSERT INTO game_calendars (code, name, era_name, months_json, weekdays_json, hours_per_day, minutes_per_hour, seconds_per_minute)
      VALUES (?, ?, ?, ?, ?, 24, 60, 60)
    `, [
      makeCode("cal"),
      "Default Calendar",
      "Era",
      JSON.stringify(["Month 1","Month 2","Month 3","Month 4","Month 5","Month 6","Month 7","Month 8","Month 9","Month 10","Month 11","Month 12"]),
      JSON.stringify(["Day 1","Day 2","Day 3","Day 4","Day 5","Day 6","Day 7"])
    ]);
    calendar = safeGet(db, `SELECT * FROM game_calendars WHERE id = ?`, [info?.lastInsertRowid]);
  }

  let row = safeGet(db, `SELECT * FROM game_time_state ORDER BY id ASC LIMIT 1`);
  const data = {
    current_era: Number(startingTime.current_era) || 1,
    current_year: Number(startingTime.current_year) || 1,
    current_month: Number(startingTime.current_month) || 1,
    current_day: Number(startingTime.current_day) || 14,
    current_hour: Number(startingTime.current_hour) || 10,
    current_minute: Number(startingTime.current_minute) || 0,
    current_second: Number(startingTime.current_second) || 0,
    formatted_time: startingTime.formatted_time || `Era 1, Year 1, Month 1, Day 14, 10:00:00`,
    time_label: startingTime.time_label || "Morning",
    season_label: startingTime.season_label || "Spring"
  };

  if (!row && tableExists(db, "game_time_state")) {
    safeRun(db, `
      INSERT INTO game_time_state (
        calendar_id, current_era, current_year, current_month, current_day, current_hour, current_minute, current_second,
        formatted_time, time_label, season_label
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      calendar?.id || 1,
      data.current_era, data.current_year, data.current_month, data.current_day,
      data.current_hour, data.current_minute, data.current_second,
      data.formatted_time, data.time_label, data.season_label
    ]);
  } else if (row) {
    safeRun(db, `
      UPDATE game_time_state
      SET current_era = ?, current_year = ?, current_month = ?, current_day = ?, current_hour = ?, current_minute = ?, current_second = ?,
          formatted_time = ?, time_label = ?, season_label = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      data.current_era, data.current_year, data.current_month, data.current_day,
      data.current_hour, data.current_minute, data.current_second,
      data.formatted_time, data.time_label, data.season_label, row.id
    ]);
  }

  return data.formatted_time;
}

function insertSetupLocation(db, location, world, ingameTime) {
  const info = safeRun(db, `
    INSERT INTO locations (
      code, name, description_short, description_long, region_name, is_discovered, notes,
      ingame_created_at, ingame_updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
  `, [
    makeCode("loc"),
    String(location?.name || "Starting Location").trim(),
    String(location?.description_short || location?.description_long || "Starting location").trim(),
    String(location?.description_long || location?.description_short || location?.notes || "Starting location").trim(),
    location?.region_name ? String(location.region_name).trim() : null,
    location?.notes ? String(location.notes).trim() : (world?.tone ? `World tone: ${world.tone}` : null),
    ingameTime || null,
    ingameTime || null
  ]);
  return info?.lastInsertRowid || null;
}

function insertSetupPlayerCharacter(db, playerId, locationId, pc, ingameTime) {
  const info = safeRun(db, `
    INSERT INTO player_characters (
      code, player_id, name, title, race, subrace, class_name, subclass_name, background_name, alignment,
      level, experience_points, proficiency_bonus, str_score, dex_score, con_score, int_score, wis_score, cha_score,
      armor_class, hit_points_current, hit_points_max, temp_hit_points, speed_walk, passive_perception, initiative_bonus,
      spell_save_dc, spell_attack_bonus, current_location_id, backstory_summary, notes, status, ingame_created_at, ingame_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    makeCode("pc"),
    playerId,
    pc.name || "Unnamed",
    pc.title || null,
    pc.race || "Human",
    pc.subrace || null,
    pc.class_name || "Adventurer",
    pc.subclass_name || null,
    pc.background_name || "Survivor",
    pc.alignment || null,
    Number(pc.level) || 1,
    Number(pc.experience_points) || 0,
    Number(pc.proficiency_bonus) || 2,
    Number(pc.str_score) || 10,
    Number(pc.dex_score) || 10,
    Number(pc.con_score) || 10,
    Number(pc.int_score) || 10,
    Number(pc.wis_score) || 10,
    Number(pc.cha_score) || 10,
    Number(pc.armor_class) || 10,
    Number(pc.hit_points_current) || 10,
    Number(pc.hit_points_max) || 10,
    Number(pc.temp_hit_points) || 0,
    Number(pc.speed_walk) || 30,
    Number(pc.passive_perception) || 10,
    Number(pc.initiative_bonus) || 0,
    pc.spell_save_dc != null ? Number(pc.spell_save_dc) : null,
    pc.spell_attack_bonus != null ? Number(pc.spell_attack_bonus) : null,
    locationId,
    pc.backstory_summary || null,
    pc.notes || null,
    pc.status || "active",
    ingameTime || null,
    ingameTime || null
  ]);
  return info?.lastInsertRowid || null;
}

function insertSetupInventory(db, playerCharacterId, items, ingameTime) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const itemInfo = safeRun(db, `
      INSERT INTO items (code, name, item_type, rarity, weight, value_gp, description, stackable, ingame_created_at, ingame_updated_at)
      VALUES (?, ?, ?, ?, 0, 0, ?, 1, ?, ?)
    `, [
      makeCode("item"),
      item.name || "Item",
      item.item_type || "gear",
      item.rarity || null,
      item.description || null,
      ingameTime || null,
      ingameTime || null
    ]);
    const itemId = itemInfo?.lastInsertRowid;
    if (!itemId) continue;
    safeRun(db, `
      INSERT INTO player_character_inventory (
        player_character_id, item_id, quantity, is_equipped, slot, notes, acquired_ingame_at, ingame_created_at, ingame_updated_at
      ) VALUES (?, ?, ?, 0, NULL, NULL, ?, ?, ?)
    `, [
      playerCharacterId,
      itemId,
      Math.max(1, Number(item.quantity) || 1),
      ingameTime || null,
      ingameTime || null,
      ingameTime || null
    ]);
  }
}

function insertSetupQuest(db, playerCharacterId, locationId, quest, ingameTime) {
  if (!quest || !quest.title) return null;
  const info = safeRun(db, `
    INSERT INTO quests (
      code, title, description, status, related_location_id, notes, ingame_created_at, ingame_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    makeCode("quest"),
    quest.title,
    quest.description || quest.summary || null,
    quest.status || "active",
    locationId || null,
    quest.notes || null,
    ingameTime || null,
    ingameTime || null
  ]);
  return info?.lastInsertRowid || null;
}

function insertSetupEvent(db, playerCharacterId, locationId, event, ingameTime) {
  if (!event || !event.title) return null;
  const info = safeRun(db, `
    INSERT INTO event_log (
      code, event_type, title, summary, actor_type, actor_id, location_id, ingame_occurred_at, is_active
    ) VALUES (?, ?, ?, ?, 'player_character', ?, ?, ?, 1)
  `, [
    makeCode("evt"),
    event.event_type || "story",
    event.title,
    event.summary || "A new chapter begins.",
    playerCharacterId || null,
    locationId || null,
    ingameTime || null
  ]);
  return info?.lastInsertRowid || null;
}

function upsertCampaignSettings(db, world) {
  if (!tableExists(db, "campaign_settings")) return;
  const campaign = world?.campaign || {};
  const governor = world?.pacing_governor || {};
  safeRun(db, `DELETE FROM campaign_settings`, []);
  safeRun(db, `
    INSERT INTO campaign_settings (
      code, campaign_length, campaign_pacing, campaign_style, world_complexity, narrative_focus,
      threat_floor, threat_ceiling, escalation_speed, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    makeCode("camp"),
    campaign.length || "long",
    campaign.pacing || "balanced",
    campaign.style || "mixed",
    world?.complexity || "medium",
    world?.narrative_focus || "mixed",
    Number(governor.threat_floor) || 1,
    Number(governor.threat_ceiling) || 5,
    governor.escalation_speed || "medium",
    world?.summary || null
  ]);
}

function replaceStoryArcs(db, arcs, locationId, ingameTime) {
  if (!tableExists(db, "story_arcs")) return;
  safeRun(db, `DELETE FROM story_arcs`, []);
  for (const arc of Array.isArray(arcs) ? arcs : []) {
    safeRun(db, `
      INSERT INTO story_arcs (
        code, title, arc_type, status, stage, stages_total, progress, threat_level,
        related_location_id, summary, notes, ingame_created_at, ingame_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      arc.code || makeCode("arc"),
      arc.title || "Story Arc",
      arc.arc_type || "local",
      arc.status || "active",
      Number(arc.stage) || 1,
      Number(arc.stages_total) || 4,
      Number(arc.progress) || 0,
      Number(arc.threat_level) || 1,
      locationId || null,
      arc.summary || null,
      arc.notes || null,
      ingameTime || null,
      ingameTime || null
    ]);
  }
}

async function applySetupDraftToDatabase(db, saveName, draft) {
  const structured = draft?.structuredSetup || {};
  const world = structured.world || {};
  const playerCharacter = structured.player_character || {};
  const location = structured.starting_location || {};
  const inventory = structured.starting_inventory || [];
  const startingTime = structured.starting_time || {};
  const initialQuest = structured.initial_quest || {};
  const initialEvent = structured.initial_event || {};
  const storyArcs = structured.story_arcs || [];

  clearCampaignWorld(db);
  const ingameTime = ensureCalendarAndTime(db, startingTime);
  const playerId = ensureMainPlayerRecord(db, ingameTime);
  const locationId = insertSetupLocation(db, location, world, ingameTime);
  const playerCharacterId = insertSetupPlayerCharacter(db, playerId, locationId, playerCharacter, ingameTime);

  if (locationId && playerCharacterId && tableExists(db, "visited_locations")) {
    safeRun(db, `
      INSERT INTO visited_locations (
        player_character_id, location_id, first_visited_ingame_at, last_visited_ingame_at, discovery_method, notes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [playerCharacterId, locationId, ingameTime, ingameTime, "campaign_start", "Starting location"]);
  }

  insertSetupInventory(db, playerCharacterId, inventory, ingameTime);
  const questId = insertSetupQuest(db, playerCharacterId, locationId, initialQuest, ingameTime);
  insertSetupEvent(db, playerCharacterId, locationId, initialEvent, ingameTime);
  upsertCampaignSettings(db, world);
  replaceStoryArcs(db, storyArcs, locationId, ingameTime);

  const cfg = readSaveConfig(saveName) || {};
  cfg.activePlayerCharacterId = playerCharacterId || null;
  cfg.setupComplete = true;
  const activePaths = getActivePaths();
  const configPath = activePaths?.configPath || path.join(__dirname, "saves", String(saveName), "config.json");
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");

  return { locationId, playerCharacterId, questId };
}

function getCampaignSettings(db) {
  if (!tableExists(db, "campaign_settings")) return null;
  return safeGet(db, `SELECT * FROM campaign_settings ORDER BY id DESC LIMIT 1`);
}

function getRelevantStoryArcs(db, limit = 3) {
  if (!tableExists(db, "story_arcs")) return [];
  try {
    return db.prepare(`
      SELECT code, title, arc_type, status, stage, stages_total, progress, threat_level, summary
      FROM story_arcs
      WHERE status = 'active'
      ORDER BY threat_level DESC, progress DESC, id ASC
      LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

function buildNormalPrompts(db, action, narrateMode, active) {
  const gameTime = getGameTime(db);
  const world = buildWorldContext(db);
  const player = world.playerCharacter;
  if (!player) throw new Error("No player character found in current save.");

  const location = world.currentLocation;
  const recentEvents = getRecentEvents(db, 5);
  const lastScene = getLastSceneSummary(db, player.id);
  const header = getTimestampHeader(gameTime, location?.name || "Unknown Location");
  const campaignSettings = getCampaignSettings(db);
  const storyArcs = getRelevantStoryArcs(db, 3);

  const snapshot = {
    game_time: gameTime,
    player_record: world.playerRecord,
    player_character: {
      id: player.id,
      name: player.name,
      race: player.race,
      class_name: player.class_name,
      level: player.level,
      background_name: player.background_name,
      alignment: player.alignment,
      current_location_id: player.current_location_id || player.location_id || null
    },
    location,
    location_exits: world.exits,
    location_flags: world.locationFlags,
    present_npcs: world.npcs,
    player_inventory: world.inventory,
    active_quests: world.activeQuests,
    visited_locations: world.visitedLocations,
    campaign_settings: campaignSettings,
    relevant_story_arcs: storyArcs,
    recent_events: recentEvents,
    last_scene_summary: lastScene ? lastScene.summary_text : null,
    player_action: action,
    narrate_mode: narrateMode
  };

  const guides = buildGuideBundle(active.gmDir, action, snapshot, narrateMode);

  const systemPrompt = `
You are the Game Master of a persistent DnD 5e-inspired RPG.

${guides}

CAMPAIGN SETTINGS
${JSON.stringify(campaignSettings || {}, null, 2)}

RELEVANT STORY ARCS
${JSON.stringify(storyArcs || [], null, 2)}

PRIMARY TASK
- Interpret the player's action as an attempted action in a living world.
- Use the structured world state as canon.
- Continue from the previous scene rather than resetting the location.
- Prefer advancing current story arcs or grounded local consequences over inventing unrelated major crises.
- Respect campaign pacing and threat ceilings from campaign settings.
- If the player attempts something impossible or unsupported by the current scene, explain this naturally in-world and suggest realistic alternatives.

OUTPUT RULES
- Final answer must be in English.
- Start with this exact timestamp header:
${header}
- Write 3 to 4 narrative paragraphs.
- The first paragraph may briefly reflect the player's attempted action and immediate outcome.
- Each paragraph should contain several sentences.
- Focus on the direct consequence of the player's action.
- Keep continuity strong with the previous scene.
- After the narrative, include:
Possible continuation:
- 2 or 3 short options
- Final line must be exactly:
What do you do next?
- Do not reveal your reasoning.
- Do not output lists except for the continuation section.
- Output only final narrative text.
`.trim();

  const userPrompt = `
WORLD DATA:
${JSON.stringify(snapshot, null, 2)}
`.trim();

  return { systemPrompt, userPrompt, snapshot, gameTime, player, location };
}

// Wizard
app.get("/api/setup/state", (req, res) => {
  try {
    const active = getActiveSave();
    if (!active) return res.status(400).json({ ok: false, error: "No active save loaded." });

    const config = readSaveConfig(active) || {};
    const draft = readSetupDraft(active) || getDefaultSetupDraft();
    ensureWizardMeta(draft);
    ensureWizardState(draft);

    res.json({
      ok: true,
      activeSave: active,
      setupComplete: !!config.setupComplete,
      draft,
      messages: draft.wizardMessages || [],
      wizardStage: getCurrentWizardStage(draft),
      completeness: assessSetupCompleteness(draft),
      awaitingFinalizeConfirmation: !!draft.wizardMeta.awaitingFinalizeConfirmation,
      canEditLastWizardPlayer: !!getLastWizardPairInfo(draft)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/setup/start", async (req, res) => {
  try {
    const active = getActiveSave();
    if (!active) return res.status(400).json({ ok: false, error: "No active save loaded." });

    const config = readSaveConfig(active) || {};
    if (config.setupComplete) return res.json({ ok: true, alreadyComplete: true });

    const draft = readSetupDraft(active) || getDefaultSetupDraft();
    if ((draft.wizardMessages || []).length > 0) {
      return res.json({ ok: true, message: draft.wizardMessages[draft.wizardMessages.length - 1].content });
    }

    const opening = buildWizardOpeningMessage();
    appendWizardMessage(active, "assistant", opening);
    writeSetupDraft(active, draft);
    res.json({ ok: true, message: opening, wizardStage: getCurrentWizardStage(draft), completeness: assessSetupCompleteness(draft) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/setup/message", async (req, res) => {
  try {
    const active = getActiveSave();
    if (!active) return res.status(400).json({ ok: false, error: "No active save loaded." });

    const config = readSaveConfig(active) || {};
    if (config.setupComplete) return res.status(400).json({ ok: false, error: "Setup is already complete for this campaign." });

    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ ok: false, error: "Message is required." });

    let draft = readSetupDraft(active) || getDefaultSetupDraft();
    ensureWizardMeta(draft);
    ensureWizardState(draft);

    if (overviewIntent(message)) {
      appendWizardMessage(active, "user", message);
      const summary = buildSetupOverviewText(draft);
      appendWizardMessage(active, "assistant", summary);
      return res.json({
        ok: true,
        reply: summary,
        draft,
        wizardStage: getCurrentWizardStage(draft),
        completeness: assessSetupCompleteness(draft),
        awaitingFinalizeConfirmation: false
      });
    }

    appendWizardMessage(active, "user", message);

    if (detectAutoFillIntent(message)) {
      draft.wizardState.autoFill = true;
      while (!canFinalizeSetup(draft) && getCurrentWizardStage(draft) !== "REVIEW") {
        fillStageDefaults(draft, getCurrentWizardStage(draft));
        advanceWizardStage(draft);
      }
    } else {
      mergePlayerInputIntoStructured(draft, message);
    }

    const completeness = assessSetupCompleteness(draft);
    let reply = "";

    if ((explicitFinalizeIntent(message) || likelyFinalizeIntent(message)) && completeness.canFinalize) {
      ensureWizardMeta(draft).awaitingFinalizeConfirmation = true;
      setWizardStage(draft, "REVIEW");
      reply = `Everything important is now in place.

${buildSetupOverviewText(draft)}

If you are happy with it, press Finalize and I will begin the campaign.`;
    } else {
      const stage = getCurrentWizardStage(draft);
      const systemPrompt = buildStageSystemPrompt(stage, draft);
      const userPrompt = buildStageUserPrompt(stage, draft, message);
      const raw = await callLmStudio([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ], 1200, 0.4);
      const cleaned = cleanNarrative(raw) || raw;
      reply = `${cleaned}

${buildWizardTransitionMessage(stage, draft)}`.trim();
    }

    writeSetupDraft(active, draft);
    appendWizardMessage(active, "assistant", reply);

    res.json({
      ok: true,
      reply,
      draft,
      wizardStage: getCurrentWizardStage(draft),
      completeness: assessSetupCompleteness(draft),
      awaitingFinalizeConfirmation: !!draft.wizardMeta.awaitingFinalizeConfirmation
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/setup/finalize-request", (req, res) => {
  try {
    const active = getActiveSave();
    if (!active) return res.status(400).json({ ok: false, error: "No active save loaded." });
    const draft = readSetupDraft(active) || getDefaultSetupDraft();
    const completeness = assessSetupCompleteness(draft);
    if (!completeness.canFinalize) {
      return res.status(400).json({ ok: false, error: `Setup is not ready to finalize. Missing: ${completeness.missing.join(", ")}`, draft, completeness });
    }
    ensureWizardMeta(draft).awaitingFinalizeConfirmation = true;
    setWizardStage(draft, "REVIEW");
    writeSetupDraft(active, draft);
    res.json({ ok: true, awaitingFinalizeConfirmation: true, draft, completeness });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function rebuildDraftFromWizardMessages(messages) {
  let draft = getDefaultSetupDraft();
  for (const msg of messages) {
    ensureWizardMessageArray(draft).push(msg);
    if (msg.role === "user") {
      if (detectAutoFillIntent(msg.content)) {
        draft.wizardState.autoFill = true;
        while (!canFinalizeSetup(draft) && getCurrentWizardStage(draft) !== "REVIEW") {
          fillStageDefaults(draft, getCurrentWizardStage(draft));
          advanceWizardStage(draft);
        }
      } else {
        mergePlayerInputIntoStructured(draft, msg.content);
      }
    }
  }
  return draft;
}

app.post("/api/setup/edit-last-player-message", async (req, res) => {
  try {
    const active = getActiveSave();
    if (!active) return res.status(400).json({ ok: false, error: "No active save loaded." });

    const newMessage = String(req.body?.message || "").trim();
    if (!newMessage) return res.status(400).json({ ok: false, error: "Message is required." });

    const oldDraft = readSetupDraft(active) || getDefaultSetupDraft();
    const info = getLastWizardPairInfo(oldDraft);
    if (!info) return res.status(400).json({ ok: false, error: "No editable wizard player message found." });

    const msgs = ensureWizardMessageArray(oldDraft).slice();
    msgs[info.lastPlayerIndex].content = newMessage;
    if (info.followingAiIndex !== -1) {
      msgs.splice(info.followingAiIndex, 1);
    }

    let rebuilt = rebuildDraftFromWizardMessages(msgs.filter(m => m.role === "user"));
    rebuilt.wizardMessages = msgs.filter(m => m.role === "user");
    ensureWizardMeta(rebuilt);

    let reply = "";
    if (overviewIntent(newMessage)) {
      reply = buildSetupOverviewText(rebuilt);
    } else {
      const stage = getCurrentWizardStage(rebuilt);
      const raw = await callLmStudio([
        { role: "system", content: buildStageSystemPrompt(stage, rebuilt) },
        { role: "user", content: buildStageUserPrompt(stage, rebuilt, newMessage) }
      ], 1200, 0.4);
      const cleaned = cleanNarrative(raw) || raw;
      reply = `${cleaned}

${buildWizardTransitionMessage(stage, rebuilt)}`.trim();
    }

    appendWizardMessage(active, "assistant", reply);
    rebuilt = readSetupDraft(active) || rebuilt;
    rebuilt = rebuildDraftFromWizardMessages(msgs.filter(m => m.role === "user"));
    ensureWizardMessageArray(rebuilt).length = 0;
    for (const m of msgs.filter(m => m.role === "user")) ensureWizardMessageArray(rebuilt).push(m);
    ensureWizardMessageArray(rebuilt).push({ role: "assistant", content: reply, createdAt: new Date().toISOString() });
    writeSetupDraft(active, rebuilt);

    return res.json({
      ok: true,
      editedMessage: newMessage,
      reply,
      draft: rebuilt,
      wizardStage: getCurrentWizardStage(rebuilt),
      completeness: assessSetupCompleteness(rebuilt),
      awaitingFinalizeConfirmation: false
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/setup/complete", async (req, res) => {
  try {
    const active = getActiveSave();
    if (!active) return res.status(400).json({ ok: false, error: "No active save loaded." });

    const db = getDb();
    if (!db) return res.status(400).json({ ok: false, error: "No database available." });

    try {
      let draft = readSetupDraft(active) || getDefaultSetupDraft();
      const completeness = assessSetupCompleteness(draft);
      if (!completeness.canFinalize) {
        return res.status(400).json({
          ok: false,
          error: `Setup is not ready to finalize. Missing: ${completeness.missing.join(", ")}`,
          draft,
          wizardStage: getCurrentWizardStage(draft),
          completeness
        });
      }

      ensureWizardMeta(draft).awaitingFinalizeConfirmation = false;
      setWizardStage(draft, "REVIEW");
      writeSetupDraft(active, draft);

      await applySetupDraftToDatabase(db, active, draft);
      setSetupComplete(active, true);

      const world = buildWorldContext(db);
      const player = world.playerCharacter || getPlayerCharacter(db);
      const location = world.currentLocation || (player ? getLocation(db, player.current_location_id || player.location_id) : null);
      const gameTime = getGameTime(db);
      const header = getTimestampHeader(gameTime, location?.name || "Unknown Location");

      const openingRaw = await callLmStudio([
        {
          role: "system",
          content: `You are the Game Master of a persistent DnD 5e-inspired RPG.
Start with this exact timestamp header:
${header}
Then write 3 to 4 immersive narrative paragraphs.
After that, include:
Possible continuation:
- 2 or 3 brief options
Final line:
What do you do next?
Do not reveal your reasoning.`
        },
        {
          role: "user",
          content: `FINALIZED SETUP:
${JSON.stringify(draft.structuredSetup, null, 2)}

WORLD STATE:
${JSON.stringify({ game_time: gameTime, player_character: player, location, world_context: world }, null, 2)}

TASK:
Begin the campaign with a strong opening scene that reflects the finalized setup and feels like the first playable moment.`
        }
      ], 4000, 0.7);

      const opening = cleanNarrative(openingRaw) || openingRaw;
      appendWizardMessage(active, "assistant", `Setup complete. Beginning game.

${opening}`);

      res.json({ ok: true, setupComplete: true, opening });
    } finally {
      db.close();
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Normal turn
app.post("/api/turn", async (req, res) => {
  const db = getDb();
  const active = getActivePaths();
  if (!db || !active) return res.status(400).json({ ok: false, error: "No active save loaded." });

  try {
    const activeSave = getActiveSave();
    const cfg = readSaveConfig(activeSave) || {};
    if (!cfg.setupComplete) return res.status(400).json({ ok: false, error: "Campaign setup is not complete yet." });

    const action = String(req.body?.action || "").trim();
    const narrateMode = getNarrateMode(active.saveName);
    if (!action) return res.status(400).json({ ok: false, error: "Action is required." });

    const built = buildNormalPrompts(db, action, narrateMode, active);

    const raw = await callLmStudio([
      { role: "system", content: built.systemPrompt },
      { role: "user", content: built.userPrompt }
    ]);

    const cleaned = cleanNarrative(raw);
    const turnId = createTurn(db, action, cleaned, built.snapshot, built.gameTime.formatted_time, null);

    const proposedChanges = await proposeWorldChanges(built.snapshot, cleaned);
    const appliedChanges = applyWorldChanges(db, proposedChanges, {
      turnId,
      ingameTime: built.gameTime.formatted_time,
      playerCharacterId: built.player.id,
      currentLocationId: built.location?.id || null
    });

    saveEvent(
      db,
      `Player action: ${action}. Result: ${cleaned}`,
      built.gameTime.formatted_time,
      turnId
    );

    saveSceneSummary(
      db,
      built.player.id,
      appliedChanges?.currentLocationId ?? built.location?.id ?? null,
      cleaned.slice(0, 1200),
      built.gameTime.formatted_time,
      turnId
    );

    res.json({
      ok: true,
      ai_output: cleaned,
      narrateMode,
      turnId,
      proposed_changes: proposedChanges,
      applied_changes: appliedChanges
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    db.close();
  }
});

app.post("/api/reload-last-turn", async (req, res) => {
  const db = getDb();
  const active = getActivePaths();
  if (!db || !active) return res.status(400).json({ ok: false, error: "No active save loaded." });

  try {
    const activeSave = getActiveSave();
    const cfg = readSaveConfig(activeSave) || {};
    if (!cfg.setupComplete) return res.status(400).json({ ok: false, error: "Campaign setup is not complete yet." });

    const lastTurn = getLastActiveTurn(db);
    if (!lastTurn) return res.status(400).json({ ok: false, error: "No active turn to reload." });

    let snapshot = null;
    try {
      snapshot = JSON.parse(lastTurn.prompt_snapshot || "null");
    } catch {
      snapshot = null;
    }
    if (!snapshot) return res.status(400).json({ ok: false, error: "No prompt snapshot found for the last turn." });

    const narrateMode = getNarrateMode(active.saveName);
    const guides = buildGuideBundle(active.gmDir, snapshot.player_action, snapshot, narrateMode);
    const header = getTimestampHeader(snapshot.game_time, snapshot.location?.name || "Unknown Location");

    const systemPrompt = `
You are the Game Master of a persistent DnD 5e-inspired RPG.

${guides}

PRIMARY TASK
- Interpret the player's action as an attempted action in a living world.
- Use the structured world state as canon.
- Provide a fresh alternative response from the same pre-turn state.

OUTPUT RULES
- Final answer must be in English.
- Start with this exact timestamp header:
${header}
- Write 3 to 4 narrative paragraphs.
- The first paragraph may briefly reflect the player's attempted action and immediate outcome.
- Each paragraph should contain several sentences.
- Focus on the direct consequence of the player's action.
- After the narrative, include:
Possible continuation:
- 2 or 3 short options
- Final line must be exactly:
What do you do next?
- Do not reveal your reasoning.
- Do not output lists except for the continuation section.
- Output only final narrative text.
`.trim();

    const userPrompt = `
WORLD DATA:
${JSON.stringify(snapshot, null, 2)}

TASK:
Regenerate the last AI response as a different but still coherent continuation from the same pre-turn state.
`.trim();

    invalidateTurnArtifacts(db, lastTurn.id, snapshot.player_character?.id || 1);

    const raw = await callLmStudio([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]);

    const cleaned = cleanNarrative(raw);
    const newTurnId = createTurn(db, lastTurn.player_text, cleaned, snapshot, lastTurn.ingame_time, lastTurn.id);
    saveEvent(db, `Player action: ${lastTurn.player_text}. Reloaded result: ${cleaned}`, lastTurn.ingame_time, newTurnId);
    saveSceneSummary(db, snapshot.player_character?.id || 1, snapshot.location?.id || null, cleaned.slice(0, 1200), lastTurn.ingame_time, newTurnId);

    res.json({
      ok: true,
      replacedTurnId: lastTurn.id,
      newTurnId,
      player_text: lastTurn.player_text,
      ai_output: cleaned
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    db.close();
  }
});

app.post("/api/edit-last-turn", async (req, res) => {
  const db = getDb();
  const active = getActivePaths();
  if (!db || !active) return res.status(400).json({ ok: false, error: "No active save loaded." });

  try {
    const activeSave = getActiveSave();
    const cfg = readSaveConfig(activeSave) || {};
    if (!cfg.setupComplete) return res.status(400).json({ ok: false, error: "Campaign setup is not complete yet." });

    const newText = String(req.body?.player_text || "").trim();
    if (!newText) return res.status(400).json({ ok: false, error: "player_text is required." });

    const lastTurn = getLastActiveTurn(db);
    if (!lastTurn) return res.status(400).json({ ok: false, error: "No active turn to edit." });

    let snapshot = null;
    try {
      snapshot = JSON.parse(lastTurn.prompt_snapshot || "null");
    } catch {
      snapshot = null;
    }
    if (!snapshot) return res.status(400).json({ ok: false, error: "No prompt snapshot found for the last turn." });

    snapshot.player_action = newText;

    const narrateMode = getNarrateMode(active.saveName);
    const guides = buildGuideBundle(active.gmDir, newText, snapshot, narrateMode);
    const header = getTimestampHeader(snapshot.game_time, snapshot.location?.name || "Unknown Location");

    const systemPrompt = `
You are the Game Master of a persistent DnD 5e-inspired RPG.

${guides}

PRIMARY TASK
- Interpret the player's edited action as an attempted action in the same pre-turn state.
- Use the structured world state as canon.

OUTPUT RULES
- Final answer must be in English.
- Start with this exact timestamp header:
${header}
- Write 3 to 4 narrative paragraphs.
- The first paragraph may briefly reflect the player's attempted action and immediate outcome.
- Each paragraph should contain several sentences.
- Focus on the direct consequence of the edited action.
- After the narrative, include:
Possible continuation:
- 2 or 3 short options
- Final line must be exactly:
What do you do next?
- Do not reveal your reasoning.
- Do not output lists except for the continuation section.
- Output only final narrative text.
`.trim();

    const userPrompt = `
WORLD DATA:
${JSON.stringify(snapshot, null, 2)}

TASK:
Generate the correct AI response from the same pre-turn state, but using the edited player action.
`.trim();

    invalidateTurnArtifacts(db, lastTurn.id, snapshot.player_character?.id || 1);

    const raw = await callLmStudio([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]);

    const cleaned = cleanNarrative(raw);
    const newTurnId = createTurn(db, newText, cleaned, snapshot, lastTurn.ingame_time, lastTurn.id);
    saveEvent(db, `Edited player action: ${newText}. Result: ${cleaned}`, lastTurn.ingame_time, newTurnId);
    saveSceneSummary(db, snapshot.player_character?.id || 1, snapshot.location?.id || null, cleaned.slice(0, 1200), lastTurn.ingame_time, newTurnId);

    res.json({
      ok: true,
      replacedTurnId: lastTurn.id,
      newTurnId,
      player_text: newText,
      ai_output: cleaned
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    db.close();
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`WebUI running at http://localhost:${PORT}`);
});
