function generateInitialStoryArcs(world = {}, character = {}, location = {}) {
  const charName = character.name || "the protagonist";
  const home = location.name || "the settlement";
  return [
    {
      code: "arc_main_echoes",
      title: "Echoes of the Fall",
      arc_type: "main",
      status: "active",
      stage: 1,
      stages_total: 5,
      progress: 0,
      threat_level: 2,
      summary: `${charName} begins uncovering what remains hidden in the ruins beyond ${home} and what the rogue AI truly left behind.`
    },
    {
      code: "arc_local_home",
      title: "Keeping Dusthaven Alive",
      arc_type: "local",
      status: "active",
      stage: 1,
      stages_total: 4,
      progress: 0,
      threat_level: 1,
      summary: `Daily life, medical needs, repair work, and fragile trust inside ${home} create a grounded slice-of-life arc.`
    },
    {
      code: "arc_personal_bot",
      title: "The Med-Bot's Buried Memory",
      arc_type: "personal",
      status: "active",
      stage: 1,
      stages_total: 4,
      progress: 0,
      threat_level: 2,
      summary: `The damaged med-bot companion may contain fragments of old medical records, restricted routes, or a hidden key to Lina's future.`
    }
  ];
}

module.exports = {
  generateInitialStoryArcs
};
