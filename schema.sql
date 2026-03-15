-- Canonical AI RPG schema derived from the richer reference save
PRAGMA foreign_keys = ON;

-- TABLE: assets
CREATE TABLE assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,

    asset_type TEXT NOT NULL CHECK (asset_type IN ('image', 'portrait', 'map', 'scene', 'token', 'other')),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('npc', 'player_character', 'location', 'item', 'quest', 'event', 'other')),
    entity_id INTEGER NOT NULL,

    title TEXT,
    description TEXT,

    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('queued', 'generating', 'ready', 'failed', 'archived')),

    provider TEXT,              -- stable-diffusion-webui / comfyui / other
    model_name TEXT,
    sampler TEXT,
    steps INTEGER,
    cfg_scale REAL,
    seed INTEGER,
    width INTEGER,
    height INTEGER,

    prompt TEXT,
    negative_prompt TEXT,

    file_path TEXT,
    preview_path TEXT,
    mime_type TEXT,

    source_image_path TEXT,
    metadata_json TEXT,

    created_by_type TEXT CHECK (created_by_type IN ('system', 'player', 'npc', 'gm_ai')),
    created_by_id INTEGER,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT
);

-- TABLE: event_log
CREATE TABLE event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,

    event_type TEXT NOT NULL,
    title TEXT,
    summary TEXT NOT NULL,
    details_json TEXT,

    actor_type TEXT CHECK (actor_type IN ('player_character', 'npc', 'system', 'faction', 'location', 'other')),
    actor_id INTEGER,

    target_type TEXT CHECK (target_type IN ('player_character', 'npc', 'item', 'location', 'quest', 'faction', 'other')),
    target_id INTEGER,

    location_id INTEGER,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ingame_occurred_at TEXT NOT NULL,

    turn_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,

    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- TABLE: factions
CREATE TABLE factions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    reputation_default INTEGER NOT NULL DEFAULT 0,
    notes TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT
);

-- TABLE: game_calendars
CREATE TABLE game_calendars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    era_name TEXT,
    months_json TEXT,
    weekdays_json TEXT,
    hours_per_day INTEGER NOT NULL DEFAULT 24,
    minutes_per_hour INTEGER NOT NULL DEFAULT 60,
    seconds_per_minute INTEGER NOT NULL DEFAULT 60,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- TABLE: game_time_state
CREATE TABLE game_time_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    calendar_id INTEGER NOT NULL,
    current_era INTEGER NOT NULL DEFAULT 1,
    current_year INTEGER NOT NULL DEFAULT 1,
    current_month INTEGER NOT NULL DEFAULT 1,
    current_day INTEGER NOT NULL DEFAULT 1,
    current_hour INTEGER NOT NULL DEFAULT 0,
    current_minute INTEGER NOT NULL DEFAULT 0,
    current_second INTEGER NOT NULL DEFAULT 0,
    formatted_time TEXT NOT NULL,              -- např. "Era 1, Year 1, Month 1, Day 14, 18:35:00"
    time_label TEXT,
    season_label TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (calendar_id) REFERENCES game_calendars(id) ON DELETE CASCADE
);

-- TABLE: item_ownership_log
CREATE TABLE item_ownership_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,

    item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,

    action_type TEXT NOT NULL CHECK (
        action_type IN (
            'created',
            'acquired',
            'received',
            'given',
            'transferred',
            'equipped',
            'unequipped',
            'dropped',
            'stored',
            'looted',
            'sold',
            'bought',
            'consumed',
            'destroyed',
            'removed'
        )
    ),

    source_owner_type TEXT CHECK (source_owner_type IN ('player_character', 'npc', 'location', 'merchant', 'system', 'other')),
    source_owner_id INTEGER,

    target_owner_type TEXT CHECK (target_owner_type IN ('player_character', 'npc', 'location', 'merchant', 'system', 'other')),
    target_owner_id INTEGER,

    location_id INTEGER,
    quest_id INTEGER,
    event_id INTEGER,

    summary TEXT,
    details_json TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ingame_occurred_at TEXT NOT NULL,

    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- TABLE: items
CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    item_type TEXT NOT NULL,
    rarity TEXT,
    weight REAL DEFAULT 0,
    value_gp REAL DEFAULT 0,
    description TEXT,
    stackable INTEGER NOT NULL DEFAULT 0 CHECK (stackable IN (0,1)),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT
);

-- TABLE: location_connections
CREATE TABLE location_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_location_id INTEGER NOT NULL,
    to_location_id INTEGER NOT NULL,
    connection_type TEXT NOT NULL DEFAULT 'path',
    is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0,1)),
    lock_reason TEXT,
    notes TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    UNIQUE(from_location_id, to_location_id),

    FOREIGN KEY (from_location_id) REFERENCES locations(id) ON DELETE CASCADE,
    FOREIGN KEY (to_location_id) REFERENCES locations(id) ON DELETE CASCADE
);

-- TABLE: location_state_flags
CREATE TABLE location_state_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    flag_name TEXT NOT NULL,
    flag_value_text TEXT,
    flag_value_integer INTEGER,
    flag_value_boolean INTEGER CHECK (flag_value_boolean IN (0,1)),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ingame_created_at TEXT,
    ingame_updated_at TEXT,
    UNIQUE(location_id, flag_name),
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);

-- TABLE: locations
CREATE TABLE locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description_short TEXT,
    description_long TEXT,
    region_name TEXT,
    parent_location_id INTEGER,

    image_path TEXT,
    image_prompt TEXT,

    is_discovered INTEGER NOT NULL DEFAULT 0 CHECK (is_discovered IN (0,1)),
    notes TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    FOREIGN KEY (parent_location_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- TABLE: npc_backgrounds
CREATE TABLE npc_backgrounds (
    npc_id INTEGER PRIMARY KEY,
    background_name TEXT NOT NULL,
    background_summary TEXT,
    origin_location_id INTEGER,
    tags TEXT,
    secrets TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE,
    FOREIGN KEY (origin_location_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- TABLE: npc_goals
CREATE TABLE npc_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npc_id INTEGER NOT NULL,

    goal_type TEXT NOT NULL CHECK (goal_type IN ('current', 'long_term', 'secret', 'daily_routine')),
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 10),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'abandoned')),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE
);

-- TABLE: npc_inventory
CREATE TABLE npc_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npc_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,

    quantity INTEGER NOT NULL DEFAULT 1,
    is_equipped INTEGER NOT NULL DEFAULT 0 CHECK (is_equipped IN (0,1)),
    slot TEXT,
    notes TEXT,

    acquired_ingame_at TEXT,
    removed_ingame_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    UNIQUE(npc_id, item_id, slot),

    FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

-- TABLE: npc_memories
CREATE TABLE npc_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npc_id INTEGER NOT NULL,

    memory_type TEXT NOT NULL CHECK (memory_type IN ('core', 'relationship', 'episodic', 'summary')),
    subject_type TEXT CHECK (subject_type IN ('player', 'player_character', 'npc', 'location', 'faction', 'quest', 'event')),
    subject_id INTEGER,

    memory_text TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 1 CHECK (importance BETWEEN 1 AND 10),
    emotional_weight INTEGER NOT NULL DEFAULT 0 CHECK (emotional_weight BETWEEN -10 AND 10),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_referenced_at TEXT,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,
    ingame_occurred_at TEXT,

    FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE
);

-- TABLE: npc_relationships
CREATE TABLE npc_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_npc_id INTEGER NOT NULL,

    target_type TEXT NOT NULL CHECK (target_type IN ('player', 'player_character', 'npc', 'faction')),
    target_id INTEGER,

    relationship_label TEXT,
    attitude TEXT CHECK (attitude IN ('hostile', 'unfriendly', 'neutral', 'friendly', 'helpful')),

    trust INTEGER NOT NULL DEFAULT 0,
    respect INTEGER NOT NULL DEFAULT 0,
    fear INTEGER NOT NULL DEFAULT 0,
    affection INTEGER NOT NULL DEFAULT 0,
    suspicion INTEGER NOT NULL DEFAULT 0,
    loyalty INTEGER NOT NULL DEFAULT 0,

    summary TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    UNIQUE(source_npc_id, target_type, target_id),

    FOREIGN KEY (source_npc_id) REFERENCES npcs(id) ON DELETE CASCADE
);

-- TABLE: npc_skills
CREATE TABLE npc_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npc_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,
    ability_name TEXT NOT NULL CHECK (ability_name IN ('STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA')),
    proficiency_level TEXT NOT NULL DEFAULT 'none' CHECK (proficiency_level IN ('none', 'proficient', 'expertise')),
    bonus INTEGER NOT NULL DEFAULT 0,
    notes TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    UNIQUE(npc_id, skill_name),

    FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE
);

-- TABLE: npc_spellbooks
CREATE TABLE npc_spellbooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npc_id INTEGER NOT NULL,

    spell_name TEXT NOT NULL,
    spell_level INTEGER NOT NULL DEFAULT 0 CHECK (spell_level BETWEEN 0 AND 9),
    spell_school TEXT,
    is_prepared INTEGER NOT NULL DEFAULT 0 CHECK (is_prepared IN (0,1)),
    is_known INTEGER NOT NULL DEFAULT 1 CHECK (is_known IN (0,1)),
    uses_per_day INTEGER,
    uses_remaining INTEGER,
    notes TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    UNIQUE(npc_id, spell_name),

    FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE
);

-- TABLE: npc_stats
CREATE TABLE npc_stats (
    npc_id INTEGER PRIMARY KEY,

    armor_class INTEGER,
    hit_points_current INTEGER,
    hit_points_max INTEGER,
    temp_hit_points INTEGER NOT NULL DEFAULT 0,

    speed_walk INTEGER DEFAULT 30,
    speed_fly INTEGER DEFAULT 0,
    speed_swim INTEGER DEFAULT 0,
    speed_climb INTEGER DEFAULT 0,

    proficiency_bonus INTEGER DEFAULT 2,

    str_score INTEGER NOT NULL DEFAULT 10,
    dex_score INTEGER NOT NULL DEFAULT 10,
    con_score INTEGER NOT NULL DEFAULT 10,
    int_score INTEGER NOT NULL DEFAULT 10,
    wis_score INTEGER NOT NULL DEFAULT 10,
    cha_score INTEGER NOT NULL DEFAULT 10,

    str_save_bonus INTEGER DEFAULT 0,
    dex_save_bonus INTEGER DEFAULT 0,
    con_save_bonus INTEGER DEFAULT 0,
    int_save_bonus INTEGER DEFAULT 0,
    wis_save_bonus INTEGER DEFAULT 0,
    cha_save_bonus INTEGER DEFAULT 0,

    passive_perception INTEGER DEFAULT 10,
    initiative_bonus INTEGER DEFAULT 0,
    spell_save_dc INTEGER,
    spell_attack_bonus INTEGER,

    senses TEXT,
    languages TEXT,
    damage_resistances TEXT,
    damage_immunities TEXT,
    damage_vulnerabilities TEXT,
    condition_immunities TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE
);

-- TABLE: npc_traits
CREATE TABLE npc_traits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npc_id INTEGER NOT NULL,
    trait_type TEXT NOT NULL CHECK (trait_type IN ('personality', 'ideal', 'bond', 'flaw', 'quirk')),
    text TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE
);

-- TABLE: npcs
CREATE TABLE npcs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,

    name TEXT NOT NULL,
    title TEXT,
    race TEXT,
    subrace TEXT,
    class_role TEXT,
    alignment TEXT,
    level INTEGER DEFAULT 1,
    challenge_rating TEXT,

    faction_id INTEGER,
    current_location_id INTEGER,
    portrait_asset_id INTEGER,

    portrait_path TEXT,
    portrait_prompt TEXT,
    backstory_summary TEXT,

    status TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'dead', 'missing', 'inactive')),
    is_hostile INTEGER NOT NULL DEFAULT 0 CHECK (is_hostile IN (0,1)),
    is_important INTEGER NOT NULL DEFAULT 0 CHECK (is_important IN (0,1)),
    notes TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    FOREIGN KEY (faction_id) REFERENCES factions(id) ON DELETE SET NULL,
    FOREIGN KEY (current_location_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- TABLE: player_character_inventory
CREATE TABLE player_character_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_character_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,

    quantity INTEGER NOT NULL DEFAULT 1,
    is_equipped INTEGER NOT NULL DEFAULT 0 CHECK (is_equipped IN (0,1)),
    slot TEXT,
    notes TEXT,

    acquired_ingame_at TEXT,
    removed_ingame_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    UNIQUE(player_character_id, item_id, slot),

    FOREIGN KEY (player_character_id) REFERENCES player_characters(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

-- TABLE: player_characters
CREATE TABLE player_characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    player_id INTEGER NOT NULL,

    name TEXT NOT NULL,
    title TEXT,
    race TEXT,
    subrace TEXT,
    class_name TEXT,
    subclass_name TEXT,
    background_name TEXT,
    alignment TEXT,

    level INTEGER NOT NULL DEFAULT 1,
    experience_points INTEGER NOT NULL DEFAULT 0,
    proficiency_bonus INTEGER NOT NULL DEFAULT 2,

    str_score INTEGER NOT NULL DEFAULT 10,
    dex_score INTEGER NOT NULL DEFAULT 10,
    con_score INTEGER NOT NULL DEFAULT 10,
    int_score INTEGER NOT NULL DEFAULT 10,
    wis_score INTEGER NOT NULL DEFAULT 10,
    cha_score INTEGER NOT NULL DEFAULT 10,

    armor_class INTEGER,
    hit_points_current INTEGER,
    hit_points_max INTEGER,
    temp_hit_points INTEGER NOT NULL DEFAULT 0,

    speed_walk INTEGER DEFAULT 30,
    passive_perception INTEGER DEFAULT 10,
    initiative_bonus INTEGER DEFAULT 0,

    spell_save_dc INTEGER,
    spell_attack_bonus INTEGER,

    current_location_id INTEGER,
    portrait_asset_id INTEGER,

    backstory_summary TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dead', 'missing', 'retired', 'inactive')),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (current_location_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- TABLE: players
CREATE TABLE players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    notes TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT
);

-- TABLE: quests
CREATE TABLE quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,

    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive', 'active', 'completed', 'failed')),

    giver_npc_id INTEGER,
    related_location_id INTEGER,
    required_conditions TEXT,
    rewards TEXT,
    notes TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ingame_created_at TEXT,
    ingame_updated_at TEXT,

    FOREIGN KEY (giver_npc_id) REFERENCES npcs(id) ON DELETE SET NULL,
    FOREIGN KEY (related_location_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- TABLE: visited_locations
CREATE TABLE visited_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_character_id INTEGER NOT NULL,
    location_id INTEGER NOT NULL,

    first_visited_ingame_at TEXT NOT NULL,
    last_visited_ingame_at TEXT NOT NULL,
    visit_count INTEGER NOT NULL DEFAULT 1,

    first_visited_real_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_visited_real_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    discovery_method TEXT,
    notes TEXT,

    UNIQUE(player_character_id, location_id),

    FOREIGN KEY (player_character_id) REFERENCES player_characters(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);

-- INDEX: idx_assets_entity
CREATE INDEX idx_assets_entity ON assets(entity_type, entity_id);

-- INDEX: idx_event_log_actor
CREATE INDEX idx_event_log_actor ON event_log(actor_type, actor_id);

-- INDEX: idx_event_log_ingame_occurred_at
CREATE INDEX idx_event_log_ingame_occurred_at ON event_log(ingame_occurred_at);

-- INDEX: idx_event_log_target
CREATE INDEX idx_event_log_target ON event_log(target_type, target_id);

-- INDEX: idx_item_ownership_log_ingame_time
CREATE INDEX idx_item_ownership_log_ingame_time ON item_ownership_log(ingame_occurred_at);

-- INDEX: idx_item_ownership_log_item_id
CREATE INDEX idx_item_ownership_log_item_id ON item_ownership_log(item_id);

-- INDEX: idx_locations_parent_location_id
CREATE INDEX idx_locations_parent_location_id ON locations(parent_location_id);

-- INDEX: idx_npc_goals_npc_id
CREATE INDEX idx_npc_goals_npc_id ON npc_goals(npc_id);

-- INDEX: idx_npc_inventory_npc_id
CREATE INDEX idx_npc_inventory_npc_id ON npc_inventory(npc_id);

-- INDEX: idx_npc_memories_npc_id
CREATE INDEX idx_npc_memories_npc_id ON npc_memories(npc_id);

-- INDEX: idx_npc_memories_type
CREATE INDEX idx_npc_memories_type ON npc_memories(memory_type);

-- INDEX: idx_npc_relationships_source_npc_id
CREATE INDEX idx_npc_relationships_source_npc_id ON npc_relationships(source_npc_id);

-- INDEX: idx_npc_skills_npc_id
CREATE INDEX idx_npc_skills_npc_id ON npc_skills(npc_id);

-- INDEX: idx_npc_spellbooks_npc_id
CREATE INDEX idx_npc_spellbooks_npc_id ON npc_spellbooks(npc_id);

-- INDEX: idx_npc_traits_npc_id
CREATE INDEX idx_npc_traits_npc_id ON npc_traits(npc_id);

-- INDEX: idx_npcs_faction_id
CREATE INDEX idx_npcs_faction_id ON npcs(faction_id);

-- INDEX: idx_npcs_location_id
CREATE INDEX idx_npcs_location_id ON npcs(current_location_id);

-- INDEX: idx_pc_inventory_pc_id
CREATE INDEX idx_pc_inventory_pc_id ON player_character_inventory(player_character_id);

-- INDEX: idx_player_characters_location_id
CREATE INDEX idx_player_characters_location_id ON player_characters(current_location_id);

-- INDEX: idx_player_characters_player_id
CREATE INDEX idx_player_characters_player_id ON player_characters(player_id);

-- INDEX: idx_quests_giver_npc_id
CREATE INDEX idx_quests_giver_npc_id ON quests(giver_npc_id);

-- INDEX: idx_visited_locations_location_id
CREATE INDEX idx_visited_locations_location_id ON visited_locations(location_id);

-- INDEX: idx_visited_locations_pc_id
CREATE INDEX idx_visited_locations_pc_id ON visited_locations(player_character_id);

-- TRIGGER: trg_assets_updated_at
CREATE TRIGGER trg_assets_updated_at
AFTER UPDATE ON assets
FOR EACH ROW
BEGIN
    UPDATE assets
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_factions_updated_at
CREATE TRIGGER trg_factions_updated_at
AFTER UPDATE ON factions
FOR EACH ROW
BEGIN
    UPDATE factions
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_items_updated_at
CREATE TRIGGER trg_items_updated_at
AFTER UPDATE ON items
FOR EACH ROW
BEGIN
    UPDATE items
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_location_connections_updated_at
CREATE TRIGGER trg_location_connections_updated_at
AFTER UPDATE ON location_connections
FOR EACH ROW
BEGIN
    UPDATE location_connections
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_locations_updated_at
CREATE TRIGGER trg_locations_updated_at
AFTER UPDATE ON locations
FOR EACH ROW
BEGIN
    UPDATE locations
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_npc_backgrounds_updated_at
CREATE TRIGGER trg_npc_backgrounds_updated_at
AFTER UPDATE ON npc_backgrounds
FOR EACH ROW
BEGIN
    UPDATE npc_backgrounds
    SET updated_at = CURRENT_TIMESTAMP
    WHERE npc_id = NEW.npc_id;
END;

-- TRIGGER: trg_npc_goals_updated_at
CREATE TRIGGER trg_npc_goals_updated_at
AFTER UPDATE ON npc_goals
FOR EACH ROW
BEGIN
    UPDATE npc_goals
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_npc_inventory_updated_at
CREATE TRIGGER trg_npc_inventory_updated_at
AFTER UPDATE ON npc_inventory
FOR EACH ROW
BEGIN
    UPDATE npc_inventory
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_npc_memories_updated_at
CREATE TRIGGER trg_npc_memories_updated_at
AFTER UPDATE ON npc_memories
FOR EACH ROW
BEGIN
    UPDATE npc_memories
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_npc_relationships_updated_at
CREATE TRIGGER trg_npc_relationships_updated_at
AFTER UPDATE ON npc_relationships
FOR EACH ROW
BEGIN
    UPDATE npc_relationships
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_npc_skills_updated_at
CREATE TRIGGER trg_npc_skills_updated_at
AFTER UPDATE ON npc_skills
FOR EACH ROW
BEGIN
    UPDATE npc_skills
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_npc_spellbooks_updated_at
CREATE TRIGGER trg_npc_spellbooks_updated_at
AFTER UPDATE ON npc_spellbooks
FOR EACH ROW
BEGIN
    UPDATE npc_spellbooks
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_npc_stats_updated_at
CREATE TRIGGER trg_npc_stats_updated_at
AFTER UPDATE ON npc_stats
FOR EACH ROW
BEGIN
    UPDATE npc_stats
    SET updated_at = CURRENT_TIMESTAMP
    WHERE npc_id = NEW.npc_id;
END;

-- TRIGGER: trg_npc_traits_updated_at
CREATE TRIGGER trg_npc_traits_updated_at
AFTER UPDATE ON npc_traits
FOR EACH ROW
BEGIN
    UPDATE npc_traits
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_npcs_updated_at
CREATE TRIGGER trg_npcs_updated_at
AFTER UPDATE ON npcs
FOR EACH ROW
BEGIN
    UPDATE npcs
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_player_character_inventory_updated_at
CREATE TRIGGER trg_player_character_inventory_updated_at
AFTER UPDATE ON player_character_inventory
FOR EACH ROW
BEGIN
    UPDATE player_character_inventory
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_player_characters_updated_at
CREATE TRIGGER trg_player_characters_updated_at
AFTER UPDATE ON player_characters
FOR EACH ROW
BEGIN
    UPDATE player_characters
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_players_updated_at
CREATE TRIGGER trg_players_updated_at
AFTER UPDATE ON players
FOR EACH ROW
BEGIN
    UPDATE players
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- TRIGGER: trg_quests_updated_at
CREATE TRIGGER trg_quests_updated_at
AFTER UPDATE ON quests
FOR EACH ROW
BEGIN
    UPDATE quests
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;
-- TABLE: scene_summaries
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

-- TABLE: turn_history
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

-- INDEX: idx_event_log_turn_id
CREATE INDEX IF NOT EXISTS idx_event_log_turn_id ON event_log(turn_id);

-- INDEX: idx_event_log_is_active
CREATE INDEX IF NOT EXISTS idx_event_log_is_active ON event_log(is_active);

-- INDEX: idx_scene_summaries_player_current
CREATE INDEX IF NOT EXISTS idx_scene_summaries_player_current
ON scene_summaries(player_character_id, is_current, is_active);

-- INDEX: idx_scene_summaries_turn_id
CREATE INDEX IF NOT EXISTS idx_scene_summaries_turn_id ON scene_summaries(turn_id);

-- INDEX: idx_turn_history_is_active
CREATE INDEX IF NOT EXISTS idx_turn_history_is_active ON turn_history(is_active);
-- TABLE: campaign_settings
CREATE TABLE IF NOT EXISTS campaign_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    campaign_length TEXT,
    campaign_pacing TEXT,
    campaign_style TEXT,
    world_complexity TEXT,
    narrative_focus TEXT,
    threat_floor INTEGER DEFAULT 1,
    threat_ceiling INTEGER DEFAULT 5,
    escalation_speed TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- TABLE: story_arcs
CREATE TABLE IF NOT EXISTS story_arcs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    arc_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    stage INTEGER NOT NULL DEFAULT 1,
    stages_total INTEGER NOT NULL DEFAULT 4,
    progress INTEGER NOT NULL DEFAULT 0,
    threat_level INTEGER NOT NULL DEFAULT 1,
    related_location_id INTEGER,
    summary TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ingame_created_at TEXT,
    ingame_updated_at TEXT,
    FOREIGN KEY (related_location_id) REFERENCES locations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_campaign_settings_created_at ON campaign_settings(created_at);
CREATE INDEX IF NOT EXISTS idx_story_arcs_status ON story_arcs(status);
CREATE INDEX IF NOT EXISTS idx_story_arcs_arc_type ON story_arcs(arc_type);
