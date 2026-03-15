
// Stable FSM Wizard Engine
// Deterministic setup builder – structured data generated server-side

const STAGES = [
  "WORLD_SETUP",
  "CHARACTER_CONCEPT",
  "CHARACTER_SHEET",
  "STARTING_SITUATION",
  "STARTING_INVENTORY",
  "CAMPAIGN_SHAPE",
  "REVIEW"
];

function ensureWizardState(draft){
  draft.wizardState ??= {};
  draft.wizardState.stage ??= "WORLD_SETUP";
  draft.wizardState.autoFill ??= false;
  return draft.wizardState;
}

function getStage(draft){
  return ensureWizardState(draft).stage;
}

function setStage(draft,stage){
  ensureWizardState(draft).stage = stage;
}

function nextStage(stage){
  const i = STAGES.indexOf(stage);
  if(i === -1 || i === STAGES.length-1) return "REVIEW";
  return STAGES[i+1];
}

function detectAutoFill(text){
  const t = String(text||"").toLowerCase();
  return /(surprise me|choose the rest|generate the rest|up to you|fill the rest)/.test(t);
}

function ensureStructured(draft){
  draft.structuredSetup ??= {
    world:{},
    player_character:{},
    starting_location:{},
    starting_inventory:[],
    starting_time:{},
    initial_quest:{},
    initial_event:{}
  };
  return draft.structuredSetup;
}

function buildCharacterSheet(pc){

  if(pc.level == null) pc.level = 3;

  pc.str_score ??= 10;
  pc.dex_score ??= 14;
  pc.con_score ??= 12;
  pc.int_score ??= 16;
  pc.wis_score ??= 13;
  pc.cha_score ??= 8;

  pc.hit_points_max ??= 29;
  pc.hit_points_current ??= pc.hit_points_max;
  pc.armor_class ??= 15;
  pc.speed_walk ??= 25;

  pc.background_name ??= "Survivor";
  pc.class_name ??= "Field Medic";

  return pc;
}

function applyStageInput(draft,message){

  const state = ensureWizardState(draft);
  const data = ensureStructured(draft);
  const stage = state.stage;

  if(detectAutoFill(message)){
    state.autoFill = true;
  }

  if(stage==="WORLD_SETUP"){
    if(/sci/i.test(message)){
      data.world.title = "Post‑Fall Earth";
      data.world.tone = "Hard Sci‑Fi Survival";
      data.world.summary = "Civilization collapsed after rogue AI seized strategic infrastructure during resource wars.";
      setStage(draft,"CHARACTER_CONCEPT");
    }
  }

  else if(stage==="CHARACTER_CONCEPT"){
    if(/medic|doctor/i.test(message)){
      data.player_character.name = "Lina";
      data.player_character.race = "Human";
      data.player_character.backstory_summary = "Young field medic surviving in scattered settlements.";
      setStage(draft,"CHARACTER_SHEET");
    }
  }

  else if(stage==="CHARACTER_SHEET"){
    buildCharacterSheet(data.player_character);
    setStage(draft,"STARTING_SITUATION");
  }

  else if(stage==="STARTING_SITUATION"){
    data.starting_location = {
      name:"Dusthaven Settlement",
      description_short:"A small salvage settlement on the edge of ruined megacities.",
      description_long:"A fragile community powered by scavenged tech and defended by improvised walls."
    };
    data.initial_event = {
      title:"Distress Signal",
      summary:"A damaged outpost nearby begins broadcasting a broken distress transmission."
    };
    setStage(draft,"STARTING_INVENTORY");
  }

  else if(stage==="STARTING_INVENTORY"){
    data.starting_inventory = [
      {name:"Tech‑Magnum Pistol",quantity:1},
      {name:"Medical Kit",quantity:1},
      {name:"Utility Belt",quantity:1}
    ];
    setStage(draft,"CAMPAIGN_SHAPE");
  }

  else if(stage==="CAMPAIGN_SHAPE"){
    data.world.campaign = {
      length:"epic",
      pacing:"slow",
      style:"exploration"
    };

    data.starting_time = {
      formatted_time:"Day 1 – Afternoon"
    };

    setStage(draft,"REVIEW");
  }

}

function isReadyToFinalize(draft){
  const data = ensureStructured(draft);
  return (
    data.world.title &&
    data.player_character.name &&
    data.starting_location.name &&
    data.starting_inventory.length > 0 &&
    data.world.campaign
  );
}

module.exports = {
  STAGES,
  ensureWizardState,
  getStage,
  setStage,
  nextStage,
  applyStageInput,
  ensureStructured,
  isReadyToFinalize
};
