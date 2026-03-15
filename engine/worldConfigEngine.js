function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function inferFromDraft(draft) {
  const text = `${JSON.stringify(draft?.world || {})}\n${(draft?.wizardMessages || []).map(m => m.content || "").join("\n")}`.toLowerCase();

  let length = "long";
  if (/(one[- ]?shot|short|brief|compact)/.test(text)) length = "short";
  else if (/(medium|standard)/.test(text)) length = "medium";
  else if (/(epic|saga)/.test(text)) length = "epic";
  else if (/(endless|infinite|sandbox|open world)/.test(text)) length = "endless";

  let pacing = "balanced";
  if (/(slow burn|slow|exploration|careful)/.test(text)) pacing = "slow";
  else if (/(fast|intense|action)/.test(text)) pacing = "fast";
  else if (/(cinematic)/.test(text)) pacing = "cinematic";

  let style = "mixed";
  if (/(sandbox|open world|free roam)/.test(text)) style = "sandbox";
  else if (/(episodic)/.test(text)) style = "episodic";
  else if (/(story driven|main plot|focused story)/.test(text)) style = "story";

  let narrative_focus = "mixed";
  if (/(exploration|discover|ruins|wilderness)/.test(text)) narrative_focus = "exploration";
  else if (/(combat|battle|fight|tactical)/.test(text)) narrative_focus = "combat";
  else if (/(mystery|investigat|secret|occult)/.test(text)) narrative_focus = "mystery";
  else if (/(sandbox|open world)/.test(text)) narrative_focus = "sandbox";
  else if (/(story|roleplay|character)/.test(text)) narrative_focus = "story";

  let complexity = "medium";
  if (/(simple|straightforward|low complexity)/.test(text)) complexity = "low";
  else if (/(politic|many faction|deep world|simulation|living world)/.test(text)) complexity = "high";
  else if (/(full simulation|simulated)/.test(text)) complexity = "simulation";

  let threat_floor = 1;
  let threat_ceiling = 5;
  let escalation_speed = "medium";

  if (length === "short") { threat_ceiling = 8; escalation_speed = "fast"; }
  if (length === "epic") { threat_ceiling = 7; escalation_speed = "medium"; }
  if (length === "endless") { threat_ceiling = 4; escalation_speed = "slow"; }

  if (pacing === "slow") escalation_speed = "slow";
  if (pacing === "fast" || pacing === "cinematic") escalation_speed = "fast";

  return {
    campaign: { length, pacing, style, narrative_focus },
    complexity,
    pacing_governor: { threat_floor, threat_ceiling, escalation_speed }
  };
}

function normalizeWorldConfig(worldLike = {}) {
  const inferred = inferFromDraft({ world: worldLike, wizardMessages: [] });
  const campaign = worldLike.campaign || {};
  const governor = worldLike.pacing_governor || {};

  return {
    title: worldLike.title || null,
    tone: worldLike.tone || null,
    summary: worldLike.summary || null,
    campaign: {
      length: campaign.length || inferred.campaign.length,
      pacing: campaign.pacing || inferred.campaign.pacing,
      style: campaign.style || inferred.campaign.style,
      narrative_focus: campaign.narrative_focus || inferred.campaign.narrative_focus
    },
    complexity: worldLike.complexity || inferred.complexity,
    pacing_governor: {
      threat_floor: clamp(governor.threat_floor ?? inferred.pacing_governor.threat_floor, 1, 10),
      threat_ceiling: clamp(governor.threat_ceiling ?? inferred.pacing_governor.threat_ceiling, 1, 10),
      escalation_speed: governor.escalation_speed || inferred.pacing_governor.escalation_speed
    }
  };
}

function mergeWorldConfigIntoStructuredSetup(structured = {}, draft = {}) {
  const normalized = normalizeWorldConfig(structured.world || draft.world || {});
  return {
    ...structured,
    world: {
      ...(structured.world || {}),
      ...normalized
    }
  };
}

module.exports = {
  normalizeWorldConfig,
  mergeWorldConfigIntoStructuredSetup
};
