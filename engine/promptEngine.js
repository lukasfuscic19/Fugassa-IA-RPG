function buildCampaignProfileBlock(campaignSettings, arcs) {
  const cfg = campaignSettings || {};
  const lines = [
    `CAMPAIGN PROFILE`,
    `- Length: ${cfg.campaign_length || "long"}`,
    `- Pacing: ${cfg.pacing || "balanced"}`,
    `- Style: ${cfg.campaign_style || "mixed"}`,
    `- Narrative focus: ${cfg.narrative_focus || "mixed"}`,
    `- World complexity: ${cfg.world_complexity || "medium"}`,
    `- Threat floor: ${cfg.threat_floor ?? 1}`,
    `- Threat ceiling: ${cfg.threat_ceiling ?? 5}`,
    `- Current global threat level: ${cfg.current_global_threat_level ?? 1}`,
    ``,
    `GM RULES`,
    `- Respect the campaign profile when deciding escalation, scope, and intensity.`,
    `- Endless or sandbox campaigns should avoid rushing toward a final ending.`,
    `- Slow pacing should emphasize exploration, atmosphere, and gradual developments.`,
    `- High complexity worlds should preserve factions, continuity, and layered consequences.`,
  ];

  if (Array.isArray(arcs) && arcs.length) {
    lines.push("", "RELEVANT STORY ARCS");
    for (const arc of arcs) {
      lines.push(`- ${arc.title} [${arc.arc_type}] stage ${arc.stage}/${arc.stages_total}, progress ${arc.progress}%, threat ${arc.threat_level}: ${arc.summary || "No summary."}`);
    }
    lines.push(`- Prefer advancing these arcs over inventing unrelated major crises.`);
  }

  return lines.join("\n");
}

module.exports = { buildCampaignProfileBlock };
