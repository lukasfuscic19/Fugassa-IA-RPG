const { buildCharacterSheet, inferCharacterConcept } = require("./characterBuilder");
const { generateWorldProfile, inferWorldProfile } = require("./worldGenerator");
const { generateInitialStoryArcs } = require("./storyArcEngine");

const STAGES = [
  "WORLD_SETUP",
  "CHARACTER_CONCEPT",
  "CHARACTER_SHEET",
  "STARTING_SITUATION",
  "STARTING_INVENTORY",
  "CAMPAIGN_SHAPE",
  "REVIEW"
];

function getDefaultSetupDraft() {
  return {
    world: {},
    character: {},
    inventory: [],
    startingLocation: {},
    startingTime: {},
    initialQuest: {},
    initialEvent: {},
    structuredSetup: {
      world: {},
      player_character: {},
      starting_location: {},
      starting_inventory: [],
      starting_time: {},
      initial_quest: {},
      initial_event: {},
      story_arcs: []
    },
    wizardMessages: [],
    wizardMeta: {
      awaitingFinalizeConfirmation: false
    },
    wizardState: {
      stage: "WORLD_SETUP",
      autoFill: false
    }
  };
}

function ensureWizardMessageArray(draft) {
  if (!Array.isArray(draft.wizardMessages)) draft.wizardMessages = [];
  return draft.wizardMessages;
}

function ensureWizardMeta(draft) {
  if (!draft.wizardMeta || typeof draft.wizardMeta !== "object") draft.wizardMeta = {};
  if (typeof draft.wizardMeta.awaitingFinalizeConfirmation !== "boolean") {
    draft.wizardMeta.awaitingFinalizeConfirmation = false;
  }
  return draft.wizardMeta;
}

function ensureWizardState(draft) {
  if (!draft.wizardState || typeof draft.wizardState !== "object") {
    draft.wizardState = { stage: "WORLD_SETUP", autoFill: false };
  }
  if (!STAGES.includes(draft.wizardState.stage)) draft.wizardState.stage = "WORLD_SETUP";
  if (typeof draft.wizardState.autoFill !== "boolean") draft.wizardState.autoFill = false;
  return draft.wizardState;
}

function ensureStructuredSetup(draft) {
  draft.structuredSetup ||= {};
  draft.structuredSetup.world ||= {};
  draft.structuredSetup.player_character ||= {};
  draft.structuredSetup.starting_location ||= {};
  if (!Array.isArray(draft.structuredSetup.starting_inventory)) draft.structuredSetup.starting_inventory = [];
  draft.structuredSetup.starting_time ||= {};
  draft.structuredSetup.initial_quest ||= {};
  draft.structuredSetup.initial_event ||= {};
  if (!Array.isArray(draft.structuredSetup.story_arcs)) draft.structuredSetup.story_arcs = [];
  return draft.structuredSetup;
}

function buildWizardTranscript(draft) {
  return ensureWizardMessageArray(draft)
    .map((m) => `${String(m.role || "assistant").toUpperCase()}: ${String(m.content || "").trim()}`)
    .join("\n\n");
}

function getLastWizardPairInfo(draft) {
  const msgs = ensureWizardMessageArray(draft);
  let lastPlayerIndex = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      lastPlayerIndex = i;
      break;
    }
  }
  if (lastPlayerIndex === -1) return null;
  const followingAiIndex =
    msgs[lastPlayerIndex + 1] && msgs[lastPlayerIndex + 1].role === "assistant"
      ? lastPlayerIndex + 1
      : -1;
  return { lastPlayerIndex, followingAiIndex };
}

function overviewIntent(text) {
  const t = String(text || "").toLowerCase().trim();
  return /(overview|summary|summarize|review|show me the summary|show summary|show me overview|i want overview|i want an overview)/.test(t);
}

function explicitFinalizeIntent(text) {
  const t = String(text || "").toLowerCase().trim();
  return /^(finalize now|yes finalize|yes, finalize|start game now|begin now|yes begin|yes, begin|finalize)$/i.test(t);
}

function likelyFinalizeIntent(text) {
  const t = String(text || "").toLowerCase().trim();
  return /(looks good|seems good|we are ready|we're ready|can we start|can we begin|ready to begin|ready to start|almost done|close enough|finish it|that's enough|lets go to next step, character is ok|character is ok)/.test(t);
}

function detectAutoFillIntent(text) {
  const t = String(text || "").toLowerCase().trim();
  return /(surprise me|you decide|up to you|fill the rest|finish it for me|generate the rest|pick the rest|rest is up to you|choose for me|you generate|rest is your choice)/.test(t);
}

function getCurrentWizardStage(draft) {
  return ensureWizardState(draft).stage;
}

function setWizardStage(draft, stage) {
  ensureWizardState(draft).stage = STAGES.includes(stage) ? stage : "WORLD_SETUP";
  return draft;
}

function advanceWizardStage(draft) {
  const state = ensureWizardState(draft);
  const idx = STAGES.indexOf(state.stage);
  state.stage = idx === -1 || idx === STAGES.length - 1 ? "REVIEW" : STAGES[idx + 1];
  return state.stage;
}

function canFinalizeSetup(draft) {
  return assessSetupCompleteness(draft).canFinalize;
}

function inferStartingTime(world, campaign) {
  const tone = String(world?.tone || "").toLowerCase();
  const pacing = String(campaign?.pacing || "balanced").toLowerCase();
  const hour = /dark|grim|post-apocalyptic|survival/.test(tone) ? 17 : 10;
  return {
    formatted_time: `Era 1, Year 1, Month 1, Day 14, ${String(hour).padStart(2, "0")}:35:00`,
    current_era: 1,
    current_year: 1,
    current_month: 1,
    current_day: 14,
    current_hour: hour,
    current_minute: 35,
    current_second: 0,
    time_label: hour >= 17 ? "Evening" : "Morning",
    season_label: pacing === "slow" ? "Early Spring" : "Spring"
  };
}

function applyStructuredMirrors(draft) {
  const structured = ensureStructuredSetup(draft);
  draft.world = structured.world || {};
  draft.character = structured.player_character || {};
  draft.inventory = structured.starting_inventory || [];
  draft.startingLocation = structured.starting_location || {};
  draft.startingTime = structured.starting_time || {};
  draft.initialQuest = structured.initial_quest || {};
  draft.initialEvent = structured.initial_event || {};
  return draft;
}

function fillStageDefaults(draft, stage = getCurrentWizardStage(draft)) {
  const structured = ensureStructuredSetup(draft);
  if (stage === "WORLD_SETUP") {
    structured.world = {
      ...generateWorldProfile(structured.world || {}),
      ...structured.world
    };
    if (!structured.world.title || !structured.world.summary) {
      const world = generateWorldProfile(structured.world || {});
      structured.world = { ...world, ...structured.world };
    }
  } else if (stage === "CHARACTER_CONCEPT") {
    structured.player_character = {
      ...inferCharacterConcept(structured.world || {}, structured.player_character || {}),
      ...structured.player_character
    };
  } else if (stage === "CHARACTER_SHEET") {
    structured.player_character = buildCharacterSheet(structured.player_character || {}, structured.world || {});
  } else if (stage === "STARTING_SITUATION") {
    if (!structured.starting_location.name) {
      structured.starting_location = {
        name: "Dusthaven Settlement",
        description_short: "A modest reclamation settlement built from patched industrial shells and greenhouse frames.",
        description_long: "Dusthaven is a small survivor settlement on the edge of a ruined industrial district. Families live in patched prefab homes, salvagers barter in the square, and old-world machinery hums only when someone coaxes it back to life. It is safe enough to call home, but the surrounding ruins always whisper about bigger things still buried beneath the Fall.",
        region_name: "Reclamation Belt",
        notes: "Small settlement, scattered families, cautious but kind community."
      };
    }
    if (!structured.initial_event.title) {
      structured.initial_event = {
        title: "A Trader Brings a Lead",
        summary: "A passing trader arrives with salvage, medicine, and a damaged data fragment that hints at a place worth exploring beyond the settlement."
      };
    }
    if (!structured.initial_quest.title) {
      structured.initial_quest = {
        title: "First Road Beyond Dusthaven",
        description: "Follow the trader's lead to investigate a nearby ruin, gather useful supplies, and learn whether the signal hidden in the fragment is real.",
        status: "active",
        notes: "Low-intensity opening hook built for exploration."
      };
    }
  } else if (stage === "STARTING_INVENTORY") {
    if (!structured.starting_inventory.length) {
      structured.starting_inventory = [
        { name: "Tech-Magnum Pistol", description: "Reliable sidearm kept mostly for self-defense.", quantity: 1, item_type: "weapon", rarity: "common" },
        { name: "Medical Field Kit", description: "Bandages, sealant, injectors, and compact surgical tools.", quantity: 1, item_type: "gear", rarity: "common" },
        { name: "Utility Belt", description: "Cables, patch tools, flashlight, and small salvager essentials.", quantity: 1, item_type: "gear", rarity: "common" },
        { name: "Portable Water Purifier", description: "Basic purifier for travel beyond the settlement.", quantity: 1, item_type: "gear", rarity: "common" }
      ];
    }
  } else if (stage === "CAMPAIGN_SHAPE") {
    structured.world = {
      ...structured.world,
      campaign: structured.world.campaign || {
        length: "epic",
        pacing: "slow",
        style: "mixed"
      },
      complexity: structured.world.complexity || "high",
      pacing_governor: structured.world.pacing_governor || {
        threat_floor: 1,
        threat_ceiling: 4,
        escalation_speed: "slow"
      },
      narrative_focus: structured.world.narrative_focus || "exploration"
    };
    if (!structured.starting_time.formatted_time) {
      structured.starting_time = inferStartingTime(structured.world, structured.world.campaign);
    }
    if (!structured.story_arcs.length) {
      structured.story_arcs = generateInitialStoryArcs(structured.world, structured.player_character, structured.starting_location);
    }
  }
  applyStructuredMirrors(draft);
  return draft;
}

function tryAdvanceAfterStageCompletion(draft) {
  let current = getCurrentWizardStage(draft);
  let completeness = assessSetupCompleteness(draft);
  let guard = 0;
  while (current !== "REVIEW" && completeness.statuses[current] && guard < 10) {
    advanceWizardStage(draft);
    current = getCurrentWizardStage(draft);
    if (draft.wizardState.autoFill && current !== "REVIEW") {
      fillStageDefaults(draft, current);
    }
    completeness = assessSetupCompleteness(draft);
    guard += 1;
  }
  return draft;
}

function assessSetupCompleteness(draft) {
  const structured = ensureStructuredSetup(draft);
  const world = structured.world || {};
  const pc = structured.player_character || {};
  const loc = structured.starting_location || {};
  const inv = structured.starting_inventory || [];
  const time = structured.starting_time || {};
  const quest = structured.initial_quest || {};
  const event = structured.initial_event || {};
  const campaign = world.campaign || {};
  const governor = world.pacing_governor || {};

  const statuses = {
    WORLD_SETUP: !!(world.title && world.summary && world.tone),
    CHARACTER_CONCEPT: !!(pc.name && pc.class_name && (pc.backstory_summary || pc.background_name)),
    CHARACTER_SHEET: !!(
      pc.level && pc.str_score && pc.dex_score && pc.con_score && pc.int_score && pc.wis_score && pc.cha_score &&
      (pc.hit_points_max || pc.hit_points_current) && pc.armor_class
    ),
    STARTING_SITUATION: !!(loc.name && (loc.description_short || loc.description_long) && (event.title || quest.title)),
    STARTING_INVENTORY: Array.isArray(inv) && inv.length > 0,
    CAMPAIGN_SHAPE: !!(campaign.length && campaign.pacing && campaign.style && world.complexity && governor.escalation_speed && time.formatted_time),
    REVIEW: false
  };

  const missing = Object.entries(statuses)
    .filter(([stage, ok]) => stage !== "REVIEW" && !ok)
    .map(([stage]) => stage);

  return { statuses, missing, canFinalize: missing.length === 0 };
}

function buildStageSystemPrompt(stage, draft) {
  const structured = ensureStructuredSetup(draft);
  return `
You are helping with a game campaign setup.
Current stage: ${stage}

Rules:
- Final answer must be in English.
- Be concise and helpful.
- Do not repeat answered questions.
- Ask at most 2 focused questions.
- If the player clearly asked you to choose the rest, stop asking and move toward completion.
- Do not output JSON.
- Do not assume your own earlier suggestions were selected unless the player explicitly chose them.

Current structured setup:
${JSON.stringify(structured, null, 2)}
`.trim();
}

function buildStageUserPrompt(stage, draft, userMessage) {
  const structured = ensureStructuredSetup(draft);
  const transcript = buildWizardTranscript(draft);
  const completeness = assessSetupCompleteness(draft);
  return `
PLAYER MESSAGE:
${userMessage}

CURRENT STAGE:
${stage}

CURRENT STRUCTURED SETUP:
${JSON.stringify(structured, null, 2)}

COMPLETENESS:
${JSON.stringify(completeness, null, 2)}

RECENT TRANSCRIPT:
${transcript.slice(-5000)}

TASK:
Respond only for the current stage, help settle missing details, and prepare the player for the next step.
`.trim();
}

function buildWizardOpeningMessage() {
  return `Welcome. I’ll help you build the foundation of this campaign before the story begins.

We will build this in clear steps:
1. World setup
2. Character concept
3. Full DnD-style character sheet
4. Starting situation
5. Starting inventory
6. Campaign shape
7. Review and finalize

You can be detailed or brief. At any time, you can tell me to choose the rest for you.

Stage 1 — World setup:
What kind of world do you want to play in?`;
}

function buildWizardTransitionMessage(stage, draft) {
  switch (stage) {
    case "WORLD_SETUP":
      return "Stage 1 — World setup:\nTell me the kind of world you want, or ask me for example world ideas.";
    case "CHARACTER_CONCEPT":
      return "Stage 2 — Character concept:\nTell me who your character is at a high level: role, vibe, background, and what makes them interesting. If you prefer, I can propose options.";
    case "CHARACTER_SHEET":
      return "Stage 3 — Full DnD-style character sheet:\nWe now need a playable sheet. You can specify class, race, stats, and build details yourself, or tell me to generate the full sheet.";
    case "STARTING_SITUATION":
      return "Stage 4 — Starting situation:\nTell me where the character lives or begins, what the local situation is, and what first hook should start the story. I can also generate this for you.";
    case "STARTING_INVENTORY":
      return "Stage 5 — Starting inventory:\nTell me what practical gear your character begins with, or ask me to generate a grounded starter loadout.";
    case "CAMPAIGN_SHAPE":
      return "Stage 6 — Campaign shape:\nTell me the preferred campaign length, pacing, complexity, and focus. I can infer the rest if you want.";
    case "REVIEW":
    default:
      return "Stage 7 — Review:\nI have enough to build the campaign. Ask for an overview, request changes, or tell me to finalize.";
  }
}

function buildSetupOverviewText(draft) {
  const structured = ensureStructuredSetup(draft);
  return `Here is a clean overview of the setup so far.

World:
${JSON.stringify(structured.world || {}, null, 2)}

Character sheet:
${JSON.stringify(structured.player_character || {}, null, 2)}

Starting point:
${JSON.stringify(structured.starting_location || {}, null, 2)}

Starting time:
${JSON.stringify(structured.starting_time || {}, null, 2)}

Inventory:
${JSON.stringify(structured.starting_inventory || [], null, 2)}

Initial quest:
${JSON.stringify(structured.initial_quest || {}, null, 2)}

Initial event:
${JSON.stringify(structured.initial_event || {}, null, 2)}

Story arcs:
${JSON.stringify(structured.story_arcs || [], null, 2)}

You can still change anything. If you want, tell me what to adjust, expand, or replace.`;
}

function extractName(message) {
  const match = String(message || "").match(/\b(?:name is|i am|i'm|called)\s+([A-Z][a-zA-Z0-9_\-]+)/i);
  return match ? match[1] : null;
}

function parseAge(message) {
  const match = String(message || "").match(/\b(\d{1,2})\s*(?:years old|year old|yo)\b/i);
  return match ? Number(match[1]) : null;
}

function mergePlayerInputIntoStructured(draft, message) {
  const structured = ensureStructuredSetup(draft);
  const m = String(message || "");

  if (detectAutoFillIntent(m)) {
    draft.wizardState.autoFill = true;
  }

  const stage = getCurrentWizardStage(draft);

  if (stage === "WORLD_SETUP") {
    const worldHints = inferWorldProfile(m, structured.world || {});
    structured.world = { ...structured.world, ...worldHints };
    if (structured.world.title && structured.world.summary && structured.world.tone) {
      advanceWizardStage(draft);
    }
  } else if (stage === "CHARACTER_CONCEPT") {
    if (!structured.player_character.name) {
      structured.player_character.name = extractName(m) || structured.player_character.name || "Lina";
    }
    const age = parseAge(m);
    if (age && !structured.player_character.notes) {
      structured.player_character.notes = `Age ${age}.`;
    }
    structured.player_character = {
      ...inferCharacterConcept(structured.world || {}, structured.player_character || {}, m),
      ...structured.player_character
    };
    if (structured.player_character.name && structured.player_character.class_name) {
      advanceWizardStage(draft);
      if (draft.wizardState.autoFill) fillStageDefaults(draft, "CHARACTER_SHEET");
    }
  } else if (stage === "CHARACTER_SHEET") {
    if (/level\s*\d+|\blevel\s+(\d+)/i.test(m)) {
      const match = m.match(/level\s*(\d+)/i);
      if (match) structured.player_character.level = Number(match[1]);
    }
    if (/enhanced senses/i.test(m)) structured.player_character.notes = `${structured.player_character.notes || ""} Enhanced senses.`.trim();
    if (/data[- ]?hacking/i.test(m)) structured.player_character.notes = `${structured.player_character.notes || ""} Data-hacking capabilities.`.trim();
    if (/explor/i.test(m)) structured.world.narrative_focus = "exploration";
    if (/character is ok|next step|lets go to next step|let's go to next step/i.test(m) || draft.wizardState.autoFill) {
      fillStageDefaults(draft, "CHARACTER_SHEET");
      advanceWizardStage(draft);
    } else if (!assessSetupCompleteness(draft).statuses.CHARACTER_SHEET && draft.wizardState.autoFill) {
      fillStageDefaults(draft, "CHARACTER_SHEET");
      advanceWizardStage(draft);
    }
  } else if (stage === "STARTING_SITUATION") {
    if (/settlement|village|ruin|hospital|city|station/i.test(m)) {
      if (/settlement|village/i.test(m)) structured.starting_location.name ||= "Dusthaven Settlement";
      structured.starting_location.description_short ||= "A small survivor settlement in the shadow of ruined infrastructure.";
      structured.starting_location.description_long ||= "The settlement survives through salvage, repair, and careful trade with passing drifters.";
      structured.initial_event.title ||= "A Trader Brings a Lead";
      structured.initial_event.summary ||= "A traveler arrives with goods and a clue that points toward a nearby ruin worth exploring.";
      structured.initial_quest.title ||= "First Road Beyond Home";
      structured.initial_quest.description ||= "Investigate the lead brought by the trader and take the first real journey beyond the settlement.";
      structured.initial_quest.status ||= "active";
    }
    if (assessSetupCompleteness(draft).statuses.STARTING_SITUATION || draft.wizardState.autoFill) {
      fillStageDefaults(draft, "STARTING_SITUATION");
      advanceWizardStage(draft);
    }
  } else if (stage === "STARTING_INVENTORY") {
    if (/gun|pistol|rifle/i.test(m)) {
      structured.starting_inventory.push({ name: "Tech-Magnum Pistol", description: "Reliable sidearm for self-defense.", quantity: 1, item_type: "weapon", rarity: "common" });
    }
    if (/med-bot|bot|medical kit|field kit/i.test(m)) {
      if (!structured.starting_inventory.find((x) => /medical field kit/i.test(x.name))) {
        structured.starting_inventory.push({ name: "Medical Field Kit", description: "Core medical tools and emergency stabilizers.", quantity: 1, item_type: "gear", rarity: "common" });
      }
      if (/med-bot/i.test(m) && !structured.starting_inventory.find((x) => /med-bot/i.test(x.name))) {
        structured.starting_inventory.push({ name: "Damaged Med-Bot Companion", description: "Repaired helper bot and closest friend.", quantity: 1, item_type: "companion", rarity: "uncommon" });
      }
    }
    if (assessSetupCompleteness(draft).statuses.STARTING_INVENTORY || draft.wizardState.autoFill) {
      fillStageDefaults(draft, "STARTING_INVENTORY");
      advanceWizardStage(draft);
    }
  } else if (stage === "CAMPAIGN_SHAPE") {
    const t = m.toLowerCase();
    structured.world.campaign ||= {};
    if (/\bshort\b/.test(t)) structured.world.campaign.length = "short";
    if (/\bmedium\b/.test(t)) structured.world.campaign.length = "medium";
    if (/\blong\b/.test(t)) structured.world.campaign.length = "long";
    if (/\bepic\b/.test(t)) structured.world.campaign.length = "epic";
    if (/\bendless\b/.test(t)) structured.world.campaign.length = "endless";
    if (/\bslow\b/.test(t)) structured.world.campaign.pacing = "slow";
    if (/\bbalanced\b/.test(t)) structured.world.campaign.pacing = "balanced";
    if (/\bfast\b/.test(t)) structured.world.campaign.pacing = "fast";
    if (/slice of life/i.test(m)) structured.world.campaign.style = "mixed";
    if (/sandbox/i.test(t)) structured.world.campaign.style = "sandbox";
    if (/explor/i.test(t)) structured.world.narrative_focus = "exploration";
    if (/\bhigh\b/.test(t)) structured.world.complexity = "high";
    if (/\bmedium\b/.test(t) && !structured.world.complexity) structured.world.complexity = "medium";
    if (/\blow\b/.test(t)) structured.world.complexity = "low";
    if (/slow start|don't rush|dont rush/i.test(t)) {
      structured.world.pacing_governor ||= {};
      structured.world.pacing_governor.threat_floor = 1;
      structured.world.pacing_governor.threat_ceiling = 4;
      structured.world.pacing_governor.escalation_speed = "slow";
    }

    fillStageDefaults(draft, "CAMPAIGN_SHAPE");
    if (assessSetupCompleteness(draft).statuses.CAMPAIGN_SHAPE) {
      advanceWizardStage(draft);
    }
  }

  if (draft.wizardState.autoFill) {
    tryAdvanceAfterStageCompletion(draft);
  } else {
    tryAdvanceAfterStageCompletion(draft);
  }

  applyStructuredMirrors(draft);
  return draft;
}

module.exports = {
  STAGES,
  getDefaultSetupDraft,
  ensureWizardMessageArray,
  ensureWizardMeta,
  ensureWizardState,
  ensureStructuredSetup,
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
  buildSetupOverviewText,
  applyStructuredMirrors,
  fillStageDefaults,
  mergePlayerInputIntoStructured,
  tryAdvanceAfterStageCompletion
};
