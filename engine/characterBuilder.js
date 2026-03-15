function inferCharacterConcept(world, current = {}, message = "") {
  const m = String(message || "").toLowerCase();
  const result = { ...current };

  if (!result.name) {
    const match = String(message || "").match(/\b(?:name is|i am|i'm|called)\s+([A-Z][a-zA-Z0-9_\-]+)/i);
    if (match) result.name = match[1];
  }

  result.race ||= "Human";
  result.subrace ||= null;
  result.class_name ||= /medic|healer|doctor/.test(m) ? "Field Medic" : "Survivor Specialist";
  result.subclass_name ||= /cyber|implant|hack/.test(m) ? "Cybernetic Enhancement" : null;
  result.background_name ||= /alone|orphan|no relatives/.test(m) ? "Independent Survivor" : "Reclamation Settler";
  result.alignment ||= "Neutral Good";

  const ageMatch = String(message || "").match(/\b(\d{1,2})\s*(?:years old|year old|yo)\b/i);
  if (ageMatch) {
    result.notes = `${result.notes ? result.notes + " " : ""}Age ${Number(ageMatch[1])}.`.trim();
  }

  if (/girl|young woman|young girl/.test(m) && !/Age /.test(result.notes || "")) {
    result.notes = `${result.notes ? result.notes + " " : ""}Young girl survivor.`.trim();
  }

  if (/med-bot|robot|bot/.test(m)) {
    result.notes = `${result.notes ? result.notes + " " : ""}Travels with a repaired med-bot companion.`.trim();
  }

  if (/cyber|implant|hacking|data/.test(m)) {
    result.notes = `${result.notes ? result.notes + " " : ""}Has cyber-implants and practical data-hacking capability.`.trim();
  }

  result.backstory_summary ||= "A young survivor who learned medicine in a fractured technological world and now balances curiosity with compassion.";

  return result;
}

function buildCharacterSheet(current = {}, world = {}) {
  const pc = { ...current };

  pc.name ||= "Lina";
  pc.title ||= null;
  pc.race ||= "Human";
  pc.subrace ||= null;
  pc.class_name ||= "Field Medic";
  pc.subclass_name ||= "Cybernetic Enhancement";
  pc.background_name ||= "Independent Survivor";
  pc.alignment ||= "Neutral Good";
  pc.level = Number(pc.level) || 3;
  pc.experience_points = Number(pc.experience_points) || 900;
  pc.proficiency_bonus = pc.level >= 9 ? 4 : pc.level >= 5 ? 3 : 2;

  pc.str_score = Number(pc.str_score) || 10;
  pc.dex_score = Number(pc.dex_score) || 14;
  pc.con_score = Number(pc.con_score) || 12;
  pc.int_score = Number(pc.int_score) || 16;
  pc.wis_score = Number(pc.wis_score) || 14;
  pc.cha_score = Number(pc.cha_score) || 10;

  pc.armor_class = Number(pc.armor_class) || 15;
  const hp = 8 + pc.level * 5 + Math.floor((pc.con_score - 10) / 2) * pc.level;
  pc.hit_points_max = Number(pc.hit_points_max) || Math.max(18, hp);
  pc.hit_points_current = Number(pc.hit_points_current) || pc.hit_points_max;
  pc.temp_hit_points = Number(pc.temp_hit_points) || 0;
  pc.speed_walk = Number(pc.speed_walk) || 25;
  pc.passive_perception = Number(pc.passive_perception) || 12;
  pc.initiative_bonus = Number(pc.initiative_bonus) || 2;
  pc.spell_save_dc = pc.class_name === "Field Medic" ? 13 : null;
  pc.spell_attack_bonus = pc.class_name === "Field Medic" ? 5 : null;

  pc.backstory_summary ||= "Lina is a young field medic from a small reclamation settlement, gifted with practical cybernetic enhancements and driven to explore the remains of the fallen world while helping whoever she can.";
  pc.notes ||= "Enhanced senses. Data-hacking capability. Practical explorer with strong support instincts.";
  pc.status ||= "active";

  return pc;
}

module.exports = {
  inferCharacterConcept,
  buildCharacterSheet
};
