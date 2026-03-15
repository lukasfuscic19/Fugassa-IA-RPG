function safeRun(db, sql, params = []) {
  try { return db.prepare(sql).run(...params); } catch { return null; }
}
function safeGet(db, sql, params = []) {
  try { return db.prepare(sql).get(...params); } catch { return null; }
}
function safeAll(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); } catch { return []; }
}
function tableExists(db, tableName) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName); } catch { return false; }
}
function makeCode(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function bootstrapStoryArcTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      campaign_length TEXT NOT NULL DEFAULT 'long',
      pacing TEXT NOT NULL DEFAULT 'balanced',
      campaign_style TEXT NOT NULL DEFAULT 'mixed',
      narrative_focus TEXT NOT NULL DEFAULT 'mixed',
      world_complexity TEXT NOT NULL DEFAULT 'medium',
      threat_floor INTEGER NOT NULL DEFAULT 1,
      threat_ceiling INTEGER NOT NULL DEFAULT 5,
      escalation_speed TEXT NOT NULL DEFAULT 'medium',
      current_global_threat_level INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
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
      related_player_character_id INTEGER,
      summary TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ingame_created_at TEXT,
      ingame_updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_story_arcs_status ON story_arcs(status);
    CREATE INDEX IF NOT EXISTS idx_story_arcs_location ON story_arcs(related_location_id);
  `);
}

function getCampaignSettings(db) {
  if (!tableExists(db, "campaign_settings")) return null;
  return safeGet(db, `SELECT * FROM campaign_settings ORDER BY id DESC LIMIT 1`);
}

function upsertCampaignSettings(db, worldConfig, ctx = {}) {
  bootstrapStoryArcTables(db);
  const existing = getCampaignSettings(db);
  const campaign = worldConfig.campaign || {};
  const governor = worldConfig.pacing_governor || {};

  if (existing?.id) {
    safeRun(db, `UPDATE campaign_settings
      SET campaign_length=?, pacing=?, campaign_style=?, narrative_focus=?, world_complexity=?,
          threat_floor=?, threat_ceiling=?, escalation_speed=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`, [
      campaign.length || "long",
      campaign.pacing || "balanced",
      campaign.style || "mixed",
      campaign.narrative_focus || "mixed",
      worldConfig.complexity || "medium",
      Number(governor.threat_floor) || 1,
      Number(governor.threat_ceiling) || 5,
      governor.escalation_speed || "medium",
      existing.id
    ]);
    return existing.id;
  }

  const info = safeRun(db, `INSERT INTO campaign_settings
    (code, campaign_length, pacing, campaign_style, narrative_focus, world_complexity, threat_floor, threat_ceiling, escalation_speed, current_global_threat_level, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    makeCode("campaign"),
    campaign.length || "long",
    campaign.pacing || "balanced",
    campaign.style || "mixed",
    campaign.narrative_focus || "mixed",
    worldConfig.complexity || "medium",
    Number(governor.threat_floor) || 1,
    Number(governor.threat_ceiling) || 5,
    governor.escalation_speed || "medium",
    Number(governor.threat_floor) || 1,
    ctx.saveName ? `Save: ${ctx.saveName}` : null
  ]);
  return info?.lastInsertRowid || null;
}

function createInitialStoryArcs(db, setupData, ctx = {}) {
  bootstrapStoryArcTables(db);
  const world = setupData?.world || {};
  const campaign = world.campaign || {};
  const arcs = [];

  arcs.push({
    title: world.title ? `${world.title}: The First Disturbance` : "The First Disturbance",
    arc_type: "main",
    stage: 1,
    stages_total: campaign.length === "short" ? 3 : campaign.length === "endless" ? 6 : 5,
    progress: 5,
    threat_level: Math.max(1, Number(world?.pacing_governor?.threat_floor) || 1),
    related_location_id: ctx.startingLocationId || null,
    related_player_character_id: ctx.playerCharacterId || null,
    summary: setupData?.initial_event?.summary || world.summary || "A newly emerging problem begins to shape the campaign."
  });

  if (setupData?.initial_quest?.title) {
    arcs.push({
      title: setupData.initial_quest.title,
      arc_type: "local",
      stage: 1,
      stages_total: 3,
      progress: 10,
      threat_level: 1,
      related_location_id: ctx.startingLocationId || null,
      related_player_character_id: ctx.playerCharacterId || null,
      summary: setupData.initial_quest.summary || "The initial quest line has begun."
    });
  }

  if (setupData?.player_character?.backstory_summary) {
    arcs.push({
      title: `${setupData.player_character.name || "The Hero"}'s Personal Arc`,
      arc_type: "personal",
      stage: 1,
      stages_total: 4,
      progress: 0,
      threat_level: 1,
      related_location_id: ctx.startingLocationId || null,
      related_player_character_id: ctx.playerCharacterId || null,
      summary: setupData.player_character.backstory_summary
    });
  }

  for (const arc of arcs) {
    safeRun(db, `INSERT INTO story_arcs
      (code, title, arc_type, status, stage, stages_total, progress, threat_level, related_location_id, related_player_character_id, summary)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`, [
      makeCode("arc"),
      arc.title,
      arc.arc_type,
      arc.stage,
      arc.stages_total,
      arc.progress,
      arc.threat_level,
      arc.related_location_id,
      arc.related_player_character_id,
      arc.summary
    ]);
  }

  return arcs.length;
}

function getRelevantStoryArcs(db, { currentLocationId = null, limit = 3 } = {}) {
  if (!tableExists(db, "story_arcs")) return [];
  let rows = [];
  if (currentLocationId) {
    rows = safeAll(db, `SELECT * FROM story_arcs WHERE status='active' AND (related_location_id = ? OR related_location_id IS NULL) ORDER BY threat_level DESC, progress DESC, id ASC LIMIT ?`, [currentLocationId, limit]);
  } else {
    rows = safeAll(db, `SELECT * FROM story_arcs WHERE status='active' ORDER BY threat_level DESC, progress DESC, id ASC LIMIT ?`, [limit]);
  }
  return rows;
}

module.exports = {
  bootstrapStoryArcTables,
  upsertCampaignSettings,
  createInitialStoryArcs,
  getCampaignSettings,
  getRelevantStoryArcs
};
