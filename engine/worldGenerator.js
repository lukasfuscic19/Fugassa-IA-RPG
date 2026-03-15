function inferWorldProfile(message = "", current = {}) {
  const m = String(message || "").toLowerCase();
  const out = { ...current };

  if (/sci|cyber|future|space|technology/.test(m)) {
    out.title ||= "Post-Fall Earth";
    out.tone ||= "Hard Sci-Fi Survival";
  }
  if (/rogue ai|resource war|resource wars|ai taking power|fall happened/.test(m)) {
    out.summary ||= "Civilization fractured after rogue strategic AI systems seized vital infrastructure during the final resource wars.";
  }
  if (/no magic|heavy sci-fi|hard sci-fi/.test(m)) {
    out.tone = "Hard Sci-Fi Survival";
  }
  if (/slice of life/.test(m)) {
    out.narrative_focus ||= "exploration";
  }

  out.campaign ||= out.campaign || {};
  return out;
}

function generateWorldProfile(current = {}) {
  const world = { ...current };
  world.title ||= "Post-Fall Earth";
  world.tone ||= "Hard Sci-Fi Survival";
  world.summary ||= "A harsh but livable world where humanity survives in scattered settlements after rogue AI seized power during resource wars. Advanced technology still exists, but the highest-tier systems are scarce, dangerous, and often broken.";
  world.campaign ||= {
    length: "epic",
    pacing: "slow",
    style: "mixed"
  };
  world.complexity ||= "high";
  world.pacing_governor ||= {
    threat_floor: 1,
    threat_ceiling: 4,
    escalation_speed: "slow"
  };
  world.narrative_focus ||= "exploration";
  world.regions ||= [
    {
      name: "Ruined Megacity Zones",
      description: "Collapsed city-blocks full of salvage, dead transit spines, and dormant industrial systems."
    },
    {
      name: "Reclamation Belts",
      description: "Semi-rural settlement networks rebuilding food production around old infrastructure."
    },
    {
      name: "Machine Deadlands",
      description: "Dangerous areas still patrolled by autonomous war platforms and hostile security logic."
    },
    {
      name: "Coastal Recovery Arcs",
      description: "Port settlements, storm-battered ocean platforms, and flooded logistics routes."
    }
  ];
  world.factions ||= [
    {
      name: "Free Settlements Compact",
      type: "survivor communities",
      description: "Loosely allied settlements focused on trade, repair, and mutual defense."
    },
    {
      name: "Iron Scavengers",
      type: "salvage clans",
      description: "Mobile crews who map dangerous ruins, reclaim technology, and sell what they find."
    },
    {
      name: "Helix Recovery",
      type: "hidden megacorporation",
      description: "A surviving corporate network quietly rebuilding influence through proxies and data control."
    }
  ];
  return world;
}

module.exports = {
  inferWorldProfile,
  generateWorldProfile
};
