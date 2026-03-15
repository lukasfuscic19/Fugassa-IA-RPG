// PATCHED saveManager.js - Reload foundation support
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = __dirname;
const SAVES_DIR = path.join(ROOT, "saves");
const TEMPLATE_DIR = path.join(ROOT, "gm_templates");
const SCHEMA_PATH = path.join(ROOT, "schema.sql");
const SEED_PATH = path.join(ROOT, "seed.sql");
const ACTIVE_PATH = path.join(ROOT, "active-save.json");

function ensureBaseDirs() {
  if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });
  if (!fs.existsSync(TEMPLATE_DIR)) fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
}

function sanitizeSaveName(name) {
  return String(name || "").trim().replace(/[<>:"/\\|?*]+/g, "_");
}

function saveExists(name) {
  return fs.existsSync(path.join(SAVES_DIR, name));
}

function getSaveDir(name) {
  return path.join(SAVES_DIR, sanitizeSaveName(name));
}

function getSaveConfigPath(name) {
  return path.join(getSaveDir(name), "config.json");
}

function getSetupDraftPath(name) {
  return path.join(getSaveDir(name), "setup_draft.json");
}

function listSaves() {
  ensureBaseDirs();
  return fs.readdirSync(SAVES_DIR).filter((entry) => {
    const full = path.join(SAVES_DIR, entry);
    return fs.statSync(full).isDirectory();
  });
}

function readSaveConfig(name) {
  const configPath = getSaveConfigPath(name);
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

function writeSaveConfig(name, config) {
  fs.writeFileSync(getSaveConfigPath(name), JSON.stringify(config, null, 2), "utf8");
}

function readSetupDraft(name) {
  const draftPath = getSetupDraftPath(name);
  if (!fs.existsSync(draftPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(draftPath, "utf8"));
  } catch {
    return null;
  }
}

function writeSetupDraft(name, draft) {
  fs.writeFileSync(getSetupDraftPath(name), JSON.stringify(draft, null, 2), "utf8");
}

function createSave(name) {
  ensureBaseDirs();
  const safeName = sanitizeSaveName(name);
  if (!safeName) throw new Error("Invalid save name.");
  const saveDir = getSaveDir(safeName);
  if (fs.existsSync(saveDir)) throw new Error("A save with that name already exists.");

  fs.mkdirSync(saveDir, { recursive: true });
  fs.mkdirSync(path.join(saveDir, "gm"), { recursive: true });
  fs.mkdirSync(path.join(saveDir, "images"), { recursive: true });
  fs.mkdirSync(path.join(saveDir, "logs"), { recursive: true });

  for (const file of fs.readdirSync(TEMPLATE_DIR)) {
    fs.copyFileSync(path.join(TEMPLATE_DIR, file), path.join(saveDir, "gm", file));
  }

  const dbPath = path.join(saveDir, "game.db");
  const db = new Database(dbPath);
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  db.exec(fs.readFileSync(SEED_PATH, "utf8"));
  db.close();

  writeSaveConfig(safeName, {
    saveName: safeName,
    createdAt: new Date().toISOString(),
    language: "en",
    activePlayerCharacterId: null,
    narrateMode: false,
    setupComplete: false
  });

  writeSetupDraft(safeName, {
    saveName: safeName,
    world: {},
    character: {},
    inventory: [],
    startingLocation: {},
    notes: [],
    wizardMessages: []
  });

  setActiveSave(safeName);
  return safeName;
}

function deleteSave(name) {
  const safeName = sanitizeSaveName(name);
  const saveDir = getSaveDir(safeName);
  if (!fs.existsSync(saveDir)) throw new Error("Save does not exist.");
  fs.rmSync(saveDir, { recursive: true, force: true });

  const active = getActiveSave();
  if (active === safeName && fs.existsSync(ACTIVE_PATH)) {
    fs.unlinkSync(ACTIVE_PATH);
  }
}

function setActiveSave(name) {
  const safeName = sanitizeSaveName(name);
  if (!saveExists(safeName)) throw new Error("Save does not exist.");
  fs.writeFileSync(ACTIVE_PATH, JSON.stringify({ activeSave: safeName }, null, 2), "utf8");
}

function getActiveSave() {
  if (!fs.existsSync(ACTIVE_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(ACTIVE_PATH, "utf8"));
    return raw.activeSave || null;
  } catch {
    return null;
  }
}

function getActivePaths() {
  const active = getActiveSave();
  if (!active) return null;
  return {
    saveName: active,
    saveDir: getSaveDir(active),
    dbPath: path.join(getSaveDir(active), "game.db"),
    gmDir: path.join(getSaveDir(active), "gm"),
    imagesDir: path.join(getSaveDir(active), "images"),
    logsDir: path.join(getSaveDir(active), "logs"),
    configPath: getSaveConfigPath(active),
    setupDraftPath: getSetupDraftPath(active)
  };
}

function getNarrateMode(name) {
  const cfg = readSaveConfig(name);
  return !!cfg?.narrateMode;
}

function setNarrateMode(name, value) {
  const cfg = readSaveConfig(name) || {
    saveName: sanitizeSaveName(name),
    createdAt: new Date().toISOString(),
    language: "en",
    activePlayerCharacterId: null,
    setupComplete: false
  };
  cfg.narrateMode = !!value;
  writeSaveConfig(name, cfg);
  return cfg.narrateMode;
}

function setSetupComplete(name, value) {
  const cfg = readSaveConfig(name) || {
    saveName: sanitizeSaveName(name),
    createdAt: new Date().toISOString(),
    language: "en",
    activePlayerCharacterId: null,
    narrateMode: false
  };
  cfg.setupComplete = !!value;
  writeSaveConfig(name, cfg);
  return cfg.setupComplete;
}

module.exports = {
  ensureBaseDirs,
  listSaves,
  createSave,
  deleteSave,
  setActiveSave,
  getActiveSave,
  getActivePaths,
  readSaveConfig,
  writeSaveConfig,
  getNarrateMode,
  setNarrateMode,
  readSetupDraft,
  writeSetupDraft,
  setSetupComplete
};
