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
  buildWizardTranscript,
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
  buildSetupOverviewText
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

// -------------------- Wizard helpers --------------------

function appendWizardMessage(saveName, role, content) {
  const draft = readSetupDraft(saveName) || getDefaultSetupDraft();
  ensureWizardMessageArray(draft).push({ role, content, createdAt: new Date().toISOString() });
  ensureWizardMeta(draft);
  ensureWizardState(draft);
  writeSetupDraft(saveName, draft);
  return draft;
}

function applyStructuredSetupToDraft(draft, structured) {
  if (!draft || !structured || typeof structured !== "object") return draft;
  draft.world = structured.world || draft.world || {};
  draft.character = structured.player_character || draft.character || {};
  draft.inventory = Array.isArray(structured.starting_inventory) ? structured.starting_inventory : (draft.inventory || []);
  draft.startingLocation = structured.starting_location || draft.startingLocation || {};
  draft.startingTime = structured.starting_time || draft.startingTime || {};
  draft.initialQuest = structured.initial_quest || draft.initialQuest || {};
  draft.initialEvent = structured.initial_event || draft.initialEvent || {};
  draft.structuredSetup = structured;
  return draft;
}

async function extractSetupSeed(draft, debugMeta = {}) {
  const systemPrompt = `
You convert an RPG campaign setup conversation into structured seed data for a database.

Return ONLY valid JSON.
No markdown.
No explanation.

Use the final settled campaign concept from the conversation.
If the player told the assistant to choose the rest, fill all missing details yourself.
Do not ask more questions. Produce the completed setup state.

Required JSON schema:
{
  "world": {
    "title": string,
    "tone": string,
    "summary": string,
    "campaign": {
      "length": string,
      "pacing": string,
      "style": string
    },
    "complexity": string,
    "pacing_governor": {
      "threat_floor": number,
      "threat_ceiling": number,
      "escalation_speed": string
    }
  },
  "starting_time": {
    "formatted_time": string,
    "current_era": number,
    "current_year": number,
    "current_month": number,
    "current_day": number,
    "current_hour": number,
    "current_minute": number,
    "current_second": number,
    "time_label": string,
    "season_label": string
  },
  "player_character": {
    "name": string,
    "title": string|null,
    "race": string,
    "subrace": string|null,
    "class_name": string,
    "subclass_name": string|null,
    "background_name": string,
    "alignment": string|null,
    "backstory_summary": string,
    "notes": string|null,
    "level": number,
    "experience_points": number,
    "proficiency_bonus": number,
    "str_score": number,
    "dex_score": number,
    "con_score": number,
    "int_score": number,
    "wis_score": number,
    "cha_score": number,
    "armor_class": number,
    "hit_points_current": number,
    "hit_points_max": number,
    "temp_hit_points": number,
    "speed_walk": number,
    "passive_perception": number,
    "initiative_bonus": number,
    "spell_save_dc": number|null,
    "spell_attack_bonus": number|null
  },
  "starting_location": {
    "name": string,
    "description_short": string,
    "description_long": string,
    "region_name": string|null,
    "notes": string|null
  },
  "starting_inventory": [
    {
      "name": string,
      "description": string|null,
      "quantity": number,
      "item_type": string|null,
      "rarity": string|null
    }
  ],
  "initial_quest": {
    "title": string,
    "description": string,
    "status": string|null,
    "notes": string|null
  },
  "initial_event": {
    "title": string,
    "summary": string
  }
}

Rules:
- Every required object must be present.
- Build a full playable DnD-style character sheet even if the conversation only gives the concept.
- Do not leave the character sheet empty.
- starting_inventory may be empty only if the setup clearly gives no gear, otherwise infer a plausible starter kit.
- starting_time must never be empty.
- campaign.length should be one of: short, medium, long, epic, endless.
- campaign.pacing should be one of: slow, balanced, fast.
- campaign.style should be one of: story, sandbox, episodic, mixed.
- complexity should be one of: low, medium, high, simulation.
- pacing_governor.escalation_speed should be one of: slow, medium, fast.
- If the player explicitly asked for a slow start, slice of life, or exploration-heavy game, reflect that in campaign and pacing_governor.
- Keep ability scores and combat stats plausible for a level 1-5 adventurer unless the setup clearly implies something else.
- Use concise but specific prose.
- Do not include any fields outside the schema.
`.trim();

  const userPrompt = `
SETUP DRAFT JSON:
${JSON.stringify(draft || {}, null, 2)}

SETUP CHAT TRANSCRIPT:
${buildWizardTranscript(draft) || "No setup chat available."}

Extract the final settled campaign state into the required JSON schema.
`.trim();

  let raw = await callLmStudio([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ], 2600, 0.2, debugMeta);

  let parsed = extractFirstJsonObject(raw);
  if (parsed && typeof parsed === "object") return parsed;

  const repairPrompt = `
Convert the following text into valid JSON matching the previously requested schema.
Return ONLY valid JSON.

TEXT:
${raw}
`.trim();

  raw = await callLmStudio([
    { role: "system", content: "You are a JSON repair assistant. Return only valid JSON." },
    { role: "user", content: repairPrompt }
  ], 2600, 0.1, { ...debugMeta, flow: `${debugMeta.flow || "setup"}_json_repair` });

  parsed = extractFirstJsonObject(raw);
  return parsed;
}

async function refreshStructuredSetupDraft(saveName, requestId = null) {
  const draft = readSetupDraft(saveName) || getDefaultSetupDraft();
  ensureWizardMeta(draft);
  ensureWizardState(draft);

  if (!Array.isArray(draft.wizardMessages) || draft.wizardMessages.length < 2) {
    writeSetupDraft(saveName, draft);
    return draft;
  }

  try {
    const structured = await extractSetupSeed(draft, {
      saveName,
      requestId,
      flow: "setup_structured_refresh"
    });
    if (structured && typeof structured === "object") {
      applyStructuredSetupToDraft(draft, structured);
      writeSetupDraft(saveName, draft);
    }
  } catch {}

  return draft;
}

// -------------------- Dynamic prompt builder --------------------
// -------------------- Dynamic prompt builder --------------------

function buildNormalPrompts(db, action, narrateMode, active) {
  const gameTime = getGameTime(db);
  const world = buildWorldContext(db);
  const player = world.playerCharacter;
  if (!player) throw new Error("No player character found in current save.");

  const location = world.currentLocation;
  const recentEvents = getRecentEvents(db, 5);
  const lastScene = getLastSceneSummary(db, player.id);
  const header = getTimestampHeader(gameTime, location?.name || "Unknown Location");

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
    recent_events: recentEvents,
    last_scene_summary: lastScene ? lastScene.summary_text : null,
    player_action: action,
    narrate_mode: narrateMode
  };

  const guides = buildGuideBundle(active.gmDir, action, snapshot, narrateMode);

  const systemPrompt = `
You are the Game Master of a persistent DnD 5e-inspired RPG.

${guides}

PRIMARY TASK
- Interpret the player's action as an attempted action in a living world.
- Use the structured world state as canon.
- Continue from the previous scene rather than resetting the location.
- Use present NPCs, inventory, quests, exits, and location state when relevant.
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

// -------------------- API routes --------------------

// Saves / state
app.get("/api/saves", (req, res) => {
  try {
    res.json({ ok: true, saves: listSaves(), activeSave: getActiveSave() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/saves", (req, res) => {
  try {
    res.json({ ok: true, created: createSave(req.body?.name) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/load", (req, res) => {
  try {
    setActiveSave(req.body?.name);
    res.json({ ok: true, activeSave: req.body?.name });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete("/api/saves/:name", (req, res) => {
  try {
    deleteSave(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/api/state", (req, res) => {
  const db = getDb();
  const active = getActivePaths();
  const activeSave = getActiveSave();

  if (!db || !active || !activeSave) {
    return res.json({
      ok: true,
      activeSave: null,
      narrateMode: false,
      setupComplete: false,
      canReloadLast: false,
      canEditLastTurn: false
    });
  }

  try {
    const time = getGameTime(db);
    const world = buildWorldContext(db);
    const player = world.playerCharacter;
    const location = world.currentLocation;
    const cfg = readSaveConfig(activeSave) || {};
    const lastTurn = getLastActiveTurn(db);

    res.json({
      ok: true,
      activeSave: active.saveName,
      gameTime: time,
      player,
      location,
      narrateMode: getNarrateMode(active.saveName),
      setupComplete: !!cfg.setupComplete,
      canReloadLast: !!lastTurn,
      canEditLastTurn: !!lastTurn
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    db.close();
  }
});

app.get("/api/world-context", (req, res) => {
  const db = getDb();
  const active = getActivePaths();
  if (!db || !active) return res.status(400).json({ ok: false, error: "No active save loaded." });

  try {
    const world = buildWorldContext(db);
    res.json({ ok: true, world });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    db.close();
  }
});

app.post("/api/narrate-mode", (req, res) => {
  try {
    const active = getActiveSave();
    if (!active) return res.status(400).json({ ok: false, error: "No active save loaded." });
    const saved = setNarrateMode(active, !!req.body?.narrateMode);
    res.json({ ok: true, narrateMode: saved });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Wizard
app.get("/api/setup/state", (req, res) => {
  try {
    const active = getActiveSave();
    if (!active) return res.status(400).json({ ok: false, error: "No active save loaded." });

    const config = readSaveConfig(active) || {};
    const draft = readSetupDraft(active) || getDefaultSetupDraft();
    ensureWizardMeta(draft);
    ensureWizardState(draft);
    const completeness = assessSetupCompleteness(draft);

    res.json({
      ok: true,
      activeSave: active,
      setupComplete: !!config.setupComplete,
      draft,
      messages: draft.wizardMessages || [],
      wizardStage: getCurrentWizardStage(draft),
      completeness,
      awaitingFinalizeConfirmation: !!draft.wizardMeta.awaitingFinalizeConfirmation,
      canEditLastWizardPlayer: !!getLastWizardPairInfo(draft),
      canFinalize: !!completeness.canFinalize
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

    let draft = readSetupDraft(active) || getDefaultSetupDraft();
    ensureWizardMeta(draft);
    ensureWizardState(draft);
    writeSetupDraft(active, draft);

    if ((draft.wizardMessages || []).length > 0) {
      return res.json({
        ok: true,
        message: draft.wizardMessages[draft.wizardMessages.length - 1].content,
        draft,
        wizardStage: getCurrentWizardStage(draft),
        completeness: assessSetupCompleteness(draft)
      });
    }

    const opening = buildWizardOpeningMessage();
    appendWizardMessage(active, "assistant", opening);
    draft = readSetupDraft(active) || draft;
    return res.json({
      ok: true,
      message: opening,
      draft,
      wizardStage: getCurrentWizardStage(draft),
      completeness: assessSetupCompleteness(draft)
    });
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

    if (detectAutoFillIntent(message)) {
      draft.wizardState.autoFill = true;
      writeSetupDraft(active, draft);
    }

    if (overviewIntent(message)) {
      draft.wizardMeta.awaitingFinalizeConfirmation = false;
      writeSetupDraft(active, draft);
      appendWizardMessage(active, "user", message);

      const refreshedDraft = await refreshStructuredSetupDraft(active, req.requestId);
      const summary = buildSetupOverviewText(refreshedDraft);
      appendWizardMessage(active, "assistant", summary);
      return res.json({
        ok: true,
        reply: summary,
        draft: refreshedDraft,
        wizardStage: getCurrentWizardStage(refreshedDraft),
        completeness: assessSetupCompleteness(refreshedDraft),
        awaitingFinalizeConfirmation: false
      });
    }

    if (explicitFinalizeIntent(message) || likelyFinalizeIntent(message)) {
      appendWizardMessage(active, "user", message);
      const refreshedDraft = await refreshStructuredSetupDraft(active, req.requestId);
      const completeness = assessSetupCompleteness(refreshedDraft);

      if (!completeness.canFinalize) {
        const nextPrompt = `We are not ready to finalize yet. The wizard is still missing: ${completeness.missing.join(", ")}.

${buildWizardTransitionMessage(getCurrentWizardStage(refreshedDraft), refreshedDraft)}`;
        appendWizardMessage(active, "assistant", nextPrompt);
        return res.json({
          ok: true,
          reply: nextPrompt,
          draft: refreshedDraft,
          wizardStage: getCurrentWizardStage(refreshedDraft),
          completeness,
          awaitingFinalizeConfirmation: false
        });
      }

      refreshedDraft.wizardMeta.awaitingFinalizeConfirmation = true;
      setWizardStage(refreshedDraft, "REVIEW");
      writeSetupDraft(active, refreshedDraft);

      const confirmText = `The setup is ready. I can finalize the campaign now and generate the opening scene, or you can still ask for an overview and edits.

Do you want me to finalize now?`;
      appendWizardMessage(active, "assistant", confirmText);
      return res.json({
        ok: true,
        reply: confirmText,
        draft: refreshedDraft,
        wizardStage: getCurrentWizardStage(refreshedDraft),
        completeness,
        awaitingFinalizeConfirmation: true,
        needsFinalizeConfirmation: true
      });
    }

    appendWizardMessage(active, "user", message);

    draft = readSetupDraft(active) || draft;
    ensureWizardState(draft);
    const stage = getCurrentWizardStage(draft);

    const raw = await callLmStudio([
      { role: "system", content: buildStageSystemPrompt(stage, draft) },
      { role: "user", content: buildStageUserPrompt(stage, draft, message) }
    ], 2600, 0.6, {
      saveName: active,
      flow: `setup_stage_${stage.toLowerCase()}`,
      requestId: req.requestId
    });

    const cleaned = cleanNarrative(raw) || raw;
    appendWizardMessage(active, "assistant", cleaned);

    let syncedDraft = await refreshStructuredSetupDraft(active, req.requestId);
    ensureWizardMeta(syncedDraft);
    ensureWizardState(syncedDraft);

    const completeness = assessSetupCompleteness(syncedDraft);
    let currentStage = getCurrentWizardStage(syncedDraft);
    const advanced = [];

    while (currentStage !== "REVIEW" && completeness.statuses[currentStage]) {
      advanced.push(currentStage);
      currentStage = advanceWizardStage(syncedDraft);
    }
    writeSetupDraft(active, syncedDraft);

    let reply = cleaned;
    if (advanced.length > 0) {
      const transition = buildWizardTransitionMessage(currentStage, syncedDraft);
      reply = `${cleaned}

${transition}`.trim();
      appendWizardMessage(active, "assistant", transition);
    }

    return res.json({
      ok: true,
      reply,
      draft: syncedDraft,
      wizardStage: currentStage,
      advancedStages: advanced,
      completeness,
      awaitingFinalizeConfirmation: !!syncedDraft.wizardMeta.awaitingFinalizeConfirmation
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/setup/finalize-request", async (req, res) => {
  try {
    const active = getActiveSave();
    if (!active) return res.status(400).json({ ok: false, error: "No active save loaded." });

    let draft = await refreshStructuredSetupDraft(active, req.requestId);
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

    draft.wizardMeta.awaitingFinalizeConfirmation = true;
    setWizardStage(draft, "REVIEW");
    writeSetupDraft(active, draft);

    res.json({ ok: true, awaitingFinalizeConfirmation: true, draft, wizardStage: "REVIEW", completeness });
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
      let draft = await refreshStructuredSetupDraft(active, req.requestId);
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

      ensureWizardMeta(draft);
      draft.wizardMeta.awaitingFinalizeConfirmation = false;
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
          content: `SETUP DRAFT:
${JSON.stringify(draft, null, 2)}

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

app.post("/api/setup/edit-last-player-message", async (req, res) => {
  try {
    const active = getActiveSave();
    if (!active) return res.status(400).json({ ok: false, error: "No active save loaded." });

    const newMessage = String(req.body?.message || "").trim();
    if (!newMessage) return res.status(400).json({ ok: false, error: "Message is required." });

    const draft = readSetupDraft(active) || getDefaultSetupDraft();
    ensureWizardMeta(draft);
    ensureWizardState(draft);

    const info = getLastWizardPairInfo(draft);
    if (!info) return res.status(400).json({ ok: false, error: "No editable wizard player message found." });

    draft.wizardMessages[info.lastPlayerIndex].content = newMessage;
    if (info.followingAiIndex !== -1) {
      draft.wizardMessages.splice(info.followingAiIndex, 1);
    }

    draft.wizardMeta.awaitingFinalizeConfirmation = false;
    if (detectAutoFillIntent(newMessage)) draft.wizardState.autoFill = true;
    writeSetupDraft(active, draft);

    appendWizardMessage(active, "user", newMessage);

    let refreshed = await refreshStructuredSetupDraft(active, req.requestId);
    const stage = getCurrentWizardStage(refreshed);

    const raw = await callLmStudio([
      { role: "system", content: buildStageSystemPrompt(stage, refreshed) },
      { role: "user", content: buildStageUserPrompt(stage, refreshed, newMessage) }
    ], 2600, 0.6, {
      saveName: active,
      flow: `setup_edit_stage_${stage.toLowerCase()}`,
      requestId: req.requestId
    });

    const cleaned = cleanNarrative(raw) || raw;
    appendWizardMessage(active, "assistant", cleaned);

    refreshed = await refreshStructuredSetupDraft(active, req.requestId);
    const completeness = assessSetupCompleteness(refreshed);
    let currentStage = getCurrentWizardStage(refreshed);
    const advanced = [];
    while (currentStage !== "REVIEW" && completeness.statuses[currentStage]) {
      advanced.push(currentStage);
      currentStage = advanceWizardStage(refreshed);
    }
    writeSetupDraft(active, refreshed);

    let reply = cleaned;
    if (advanced.length > 0) {
      const transition = buildWizardTransitionMessage(currentStage, refreshed);
      reply = `${cleaned}\n\n${transition}`.trim();
      appendWizardMessage(active, "assistant", transition);
    }

    return res.json({
      ok: true,
      editedMessage: newMessage,
      reply,
      awaitingFinalizeConfirmation: false,
      draft: refreshed,
      wizardStage: currentStage,
      advancedStages: advanced,
      completeness
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Normal turn
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
