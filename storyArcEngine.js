// storyArcEngine.js
// V2 architecture: campaign settings + story arc engine

function tableExists(db, tableName) {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
    return !!row;
  } catch {
    return false;
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

function safeAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function makeCode(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function bootstrapStoryTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_length TEXT NOT NULL DEFAULT 'long',
      campaign_pacing TEXT NOT NULL DEFAULT 'balanced',
      campaign_style TEXT NOT NULL DEFAULT 'mixed',
      world_complexity TEXT NOT NULL DEFAULT 'medium',
      threat_floor INTEGER NOT NULL DEFAULT 1,
      threat_ceiling INTEGER NOT NULL DEFAULT 5,
      escalation_speed TEXT NOT NULL DEFAULT 'medium',
      global_threat_level INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS story_arcs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      arc_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      stage INTEGER NOT NULL DEFAULT 1,
      stages_total INTEGER NOT NULL DEFAULT 5,
      progress INTEGER NOT NULL DEFAULT 0,
      threat_level INTEGER NOT NULL DEFAULT 1,
      related_location_id INTEGER,
      related_npc_id INTEGER,
      related_faction_id INTEGER,
      summary TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ingame_created_at TEXT,
      ingame_updated_at TEXT
    );
  `);
}

function upsertCampaignSettings(db, settings = {}) {
  bootstrapStoryTables(db);
  const existing = safeGet(db, `SELECT id FROM campaign_settings ORDER BY id ASC LIMIT 1`);
  const payload = {
    campaign_length: settings.campaign_length || "long",
    campaign_pacing: settings.campaign_pacing || "balanced",
    campaign_style: settings.campaign_style || "mixed",
    world_complexity: settings.world_complexity || "medium",
    threat_floor: Number(settings.threat_floor) || 1,
    threat_ceiling: Number(settings.threat_ceiling) || 5,
    escalation_speed: settings.escalation_speed || "medium",
    global_threat_level: Number(settings.global_threat_level) || Number(settings.threat_floor) || 1
  };

  if (existing?.id) {
    safeRun(db, `
      UPDATE campaign_settings
      SET campaign_length = ?,
          campaign_pacing = ?,
          campaign_style = ?,
          world_complexity = ?,
          threat_floor = ?,
          threat_ceiling = ?,
          escalation_speed = ?,
          global_threat_level = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      payload.campaign_length,
      payload.campaign_pacing,
      payload.campaign_style,
      payload.world_complexity,
      payload.threat_floor,
      payload.threat_ceiling,
      payload.escalation_speed,
      payload.global_threat_level,
      existing.id
    ]);
    return existing.id;
  }

  const info = safeRun(db, `
    INSERT INTO campaign_settings (
      campaign_length, campaign_pacing, campaign_style, world_complexity,
      threat_floor, threat_ceiling, escalation_speed, global_threat_level
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    payload.campaign_length,
    payload.campaign_pacing,
    payload.campaign_style,
    payload.world_complexity,
    payload.threat_floor,
    payload.threat_ceiling,
    payload.escalation_speed,
    payload.global_threat_level
  ]);
  return info?.lastInsertRowid || null;
}

function getCampaignSettings(db) {
  bootstrapStoryTables(db);
  return safeGet(db, `SELECT * FROM campaign_settings ORDER BY id ASC LIMIT 1`) || {
    campaign_length: "long",
    campaign_pacing: "balanced",
    campaign_style: "mixed",
    world_complexity: "medium",
    threat_floor: 1,
    threat_ceiling: 5,
    escalation_speed: "medium",
    global_threat_level: 1
  };
}

function insertArc(db, arc, ctx = {}) {
  const info = safeRun(db, `
    INSERT INTO story_arcs (
      code, title, arc_type, status, stage, stages_total, progress, threat_level,
      related_location_id, related_npc_id, related_faction_id, summary, notes,
      ingame_created_at, ingame_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    makeCode("arc"),
    arc.title,
    arc.arc_type || "local",
    arc.status || "active",
    arc.stage || 1,
    arc.stages_total || 5,
    arc.progress || 0,
    arc.threat_level || 1,
    arc.related_location_id || null,
    arc.related_npc_id || null,
    arc.related_faction_id || null,
    arc.summary || null,
    arc.notes || null,
    ctx.ingameTime || null,
    ctx.ingameTime || null
  ]);
  return info?.lastInsertRowid || null;
}

function createInitialStoryArcsFromSetup(db, setupData, ctx = {}) {
  bootstrapStoryTables(db);
  const title = setupData?.world?.title || "The Campaign";
  const summary = setupData?.world?.summary || "A new campaign begins.";
  const questTitle = setupData?.initial_quest?.title || "First Steps";
  const characterName = setupData?.player_character?.name || "The Hero";

  const arcs = [
    {
      title: `${title}: The Long Shadow`,
      arc_type: "main",
      threat_level: Math.min(10, Math.max(1, Number(setupData?.world?.pacing_governor?.threat_floor) || 1)),
      progress: 5,
      summary
    },
    {
      title: questTitle,
      arc_type: "local",
      threat_level: Math.min(10, Math.max(1, Number(setupData?.world?.pacing_governor?.threat_floor) || 1)),
      progress: 10,
      related_location_id: ctx.locationId || null,
      summary: setupData?.initial_quest?.summary || setupData?.initial_event?.summary || "An immediate local problem awaits."
    },
    {
      title: `${characterName}'s Personal Path`,
      arc_type: "personal",
      threat_level: Math.min(10, Math.max(1, Number(setupData?.world?.pacing_governor?.threat_floor) || 1)),
      progress: 0,
      related_location_id: ctx.locationId || null,
      summary: setupData?.player_character?.backstory_summary || "The character's inner journey begins."
    }
  ];

  const ids = [];
  for (const arc of arcs) {
    const id = insertArc(db, arc, ctx);
    if (id) ids.push(id);
  }
  return ids;
}

function getRelevantStoryArcs(db, opts = {}) {
  bootstrapStoryTables(db);
  const limit = Number(opts.limit) || 3;
  const locationId = Number(opts.locationId) || null;
  let rows = [];
  if (locationId) {
    rows = safeAll(db, `
      SELECT *
      FROM story_arcs
      WHERE status = 'active'
        AND (related_location_id = ? OR related_location_id IS NULL)
      ORDER BY CASE WHEN related_location_id = ? THEN 0 ELSE 1 END, threat_level DESC, progress DESC, id ASC
      LIMIT ?
    `, [locationId, locationId, limit]);
  } else {
    rows = safeAll(db, `
      SELECT *
      FROM story_arcs
      WHERE status = 'active'
      ORDER BY threat_level DESC, progress DESC, id ASC
      LIMIT ?
    `, [limit]);
  }
  return rows;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function inferAndAdvanceArcs(db, ctx = {}) {
  bootstrapStoryTables(db);
  const settings = getCampaignSettings(db);
  const rows = getRelevantStoryArcs(db, { locationId: ctx.currentLocationId || null, limit: 3 });
  if (!rows.length) {
    return { updated_arc_ids: [], new_global_threat_level: settings.global_threat_level };
  }

  const text = `${ctx.action || ""}\n${ctx.aiNarrative || ""}`.toLowerCase();
  let progressDelta = 5;
  if (/(attack|fight|battle|duel|kill|escape|ritual|surge|discover|reveal|confront)/.test(text)) progressDelta = 12;
  else if (/(ask|talk|investigate|search|scout|follow|travel|explore)/.test(text)) progressDelta = 8;

  if (settings.campaign_pacing === "slow") progressDelta = Math.max(3, Math.round(progressDelta * 0.75));
  if (settings.campaign_pacing === "fast") progressDelta = Math.round(progressDelta * 1.25);

  const updated = [];
  for (const arc of rows.slice(0, 2)) {
    const newProgress = clamp((arc.progress || 0) + progressDelta, 0, 100);
    let newStage = arc.stage || 1;
    if (newProgress >= 25 && newStage < 2) newStage = 2;
    if (newProgress >= 50 && newStage < 3) newStage = 3;
    if (newProgress >= 75 && newStage < 4) newStage = 4;
    if (newProgress >= 100 && newStage < (arc.stages_total || 5)) newStage = arc.stages_total || 5;

    const status = newProgress >= 100 && settings.campaign_length !== "endless" ? "resolved" : arc.status;

    safeRun(db, `
      UPDATE story_arcs
      SET progress = ?, stage = ?, status = ?, ingame_updated_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [newProgress, newStage, status, ctx.ingameTime || null, arc.id]);

    updated.push({ id: arc.id, progress: newProgress, stage: newStage, status });
  }

  let threat = Number(settings.global_threat_level) || Number(settings.threat_floor) || 1;
  const escalation = settings.escalation_speed || "medium";
  if (progressDelta >= 12 && escalation !== "slow") threat += 1;
  if (escalation === "fast" && progressDelta >= 8) threat += 1;
  threat = clamp(threat, Number(settings.threat_floor) || 1, Number(settings.threat_ceiling) || 5);

  safeRun(db, `UPDATE campaign_settings SET global_threat_level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM campaign_settings ORDER BY id ASC LIMIT 1)`, [threat]);

  return { updated_arc_ids: updated, new_global_threat_level: threat };
}

module.exports = {
  bootstrapStoryTables,
  upsertCampaignSettings,
  getCampaignSettings,
  createInitialStoryArcsFromSetup,
  getRelevantStoryArcs,
  inferAndAdvanceArcs
};
