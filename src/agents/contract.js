(function initAgentContract(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../sim-core.js"));
  } else {
    root.GraphwarAgentContract = factory(root.GraphwarSim);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function contractFactory(Sim) {
  "use strict";

  const MAX_PUBLIC_CANDIDATES = 24;
  const SECRET_KEYS = new Set(["apiKey", "key", "authorization", "Authorization", "x-api-key"]);

  function redactSecrets(value) {
    if (Array.isArray(value)) return value.map(redactSecrets);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SECRET_KEYS.has(key) ? "[redacted]" : redactSecrets(inner);
    }
    return out;
  }

  function listPublicShotCandidates(state, team, command) {
    const shots = Sim.listLegalShots(state, team, command).slice(0, MAX_PUBLIC_CANDIDATES);
    return shots.map((shot) => ({
      action: "shot",
      candidateId: shot.candidateId,
      targetId: shot.targetId,
      cards: shot.cards,
      cost: shot.cost,
      combo: shot.combo
        ? {
            name: shot.combo.name,
            traits: shot.combo.traits || []
          }
        : null,
      expression: shot.expression
    }));
  }

  function buildRulesPayload(state, team, command) {
    const units = state.units || [];
    const handState = state.hands && state.hands[team] ? state.hands[team] : null;
    const cards = Sim.getCurrentHand(state, team).map((card) => ({
      id: card.id,
      instanceId: card.instanceId,
      label: card.label,
      family: card.family,
      cost: card.cost,
      tags: card.tags,
      description: card.description
    }));
    const shotActions = listPublicShotCandidates(state, team, command);
    const rerollsUsed = handState ? handState.rerollsUsed : 0;
    const rerollsRemaining = Math.max(0, Sim.CONFIG.maxRerollsPerTurn - rerollsUsed);
    const legalActions = rerollsRemaining > 0
      ? [{ action: "reroll", rerollsRemaining }].concat(shotActions)
      : shotActions;
    return {
      rules: {
        turnOrder: "A and B alternate one active unit per turn",
        actionLimit: "choose exactly one legal action: reroll or shot",
        rerollLimit: `${Sim.CONFIG.maxRerollsPerTurn} rerolls per active turn`,
        cardUse: `${Sim.CONFIG.maxCardsPerShot} cards max, ${Sim.CONFIG.maxShapeCards} shape cards max, ${Sim.CONFIG.maxModifierCards} modifier max`,
        output: "return JSON only"
      },
      objective: "eliminate opposing team while avoiding allied units",
      team,
      command: String(command || "").slice(0, Sim.CONFIG.maxCommandLength),
      allyIds: units.filter((unit) => unit.team === team && unit.hp > 0).map((unit) => unit.id),
      opponentIds: units.filter((unit) => unit.team !== team && unit.hp > 0).map((unit) => unit.id),
      state: {
        seed: state.seed,
        turn: state.turn,
        map: state.mapMeta,
        units: units.map((unit) => ({ id: unit.id, team: unit.team, x: unit.x, y: unit.y, hp: unit.hp })),
        obstacles: state.obstacles || []
      },
      hand: {
        rerollsUsed,
        rerollsRemaining,
        cards
      },
      legalActions
    };
  }

  function validateAgentDecision(decision, legalActions) {
    if (!decision || typeof decision !== "object") return { ok: false, reason: "missing_decision" };
    const actions = Array.isArray(legalActions) ? legalActions : [];
    const candidates = actions.filter((item) => item.action === "shot" || !item.action);
    if (decision.action === "reroll") {
      if (!actions.some((item) => item.action === "reroll")) return { ok: false, reason: "reroll_limit_reached" };
      return {
        ok: true,
        action: "reroll",
        publicReason:
          typeof decision.publicReason === "string" ? decision.publicReason.slice(0, 240) : "Provider chose to reroll."
      };
    }
    if (typeof decision.candidateId !== "string") return { ok: false, reason: "missing_candidate_id" };
    const candidate = candidates.find((item) => item.candidateId === decision.candidateId);
    if (!candidate) return { ok: false, reason: "unknown_candidate" };
    return {
      ok: true,
      candidate,
      publicReason:
        typeof decision.publicReason === "string" ? decision.publicReason.slice(0, 240) : "Provider selected a legal shot."
    };
  }

  return {
    MAX_PUBLIC_CANDIDATES,
    buildRulesPayload,
    listPublicShotCandidates,
    redactSecrets,
    validateAgentDecision
  };
});
