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

  function resolveControlledUnit(state, owner) {
    const normalized = String(owner || "").toUpperCase();
    const units = state.units || [];
    const direct = units.find((unit) => unit.id === normalized);
    if (direct) return direct;
    const active = Sim.getActiveUnit ? Sim.getActiveUnit(state) : null;
    if (active && active.team === normalized) return active;
    return units.find((unit) => unit.team === normalized && unit.hp > 0) || active || null;
  }

  function listPublicShotCandidates(state, owner, command) {
    const unit = resolveControlledUnit(state, owner);
    const handOwner = unit ? unit.id : owner;
    const shots = Sim.listLegalShots(state, handOwner, command).slice(0, MAX_PUBLIC_CANDIDATES);
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

  function buildRulesPayload(state, owner, command) {
    const units = state.units || [];
    const controlledUnit = resolveControlledUnit(state, owner);
    const activeUnitId = controlledUnit ? controlledUnit.id : String(owner || "A1").toUpperCase();
    const team = controlledUnit ? controlledUnit.team : activeUnitId.startsWith("B") ? "B" : "A";
    const handState = state.hands && state.hands[activeUnitId] ? state.hands[activeUnitId] : null;
    const cards = Sim.getCurrentHand(state, activeUnitId).map((card) => ({
      id: card.id,
      instanceId: card.instanceId,
      label: card.label,
      family: card.family,
      cost: card.cost,
      tags: card.tags,
      description: card.description
    }));
    const shotActions = listPublicShotCandidates(state, activeUnitId, command);
    const swapsUsed = handState ? Number(handState.swapsUsed ?? handState.rerollsUsed) || 0 : 0;
    const swapsRemaining = Math.max(0, Sim.CONFIG.maxRerollsPerTurn - swapsUsed);
    const legalActions = swapsRemaining > 0
      ? [{ action: "swap_hand", swapsUsed, swapsRemaining }].concat(shotActions)
      : shotActions;
    return {
      rules: {
        turnOrder: "A1, B1, A2, B2 rotate as separate AI seats",
        actionLimit: "choose exactly one legal action: swap_hand or shot",
        handRetention: "cards persist in hand across shots until the active model chooses swap_hand",
        swapLimit: `${Sim.CONFIG.maxRerollsPerTurn} swap_hand actions per active turn; swap_hand replaces the retained hand and does not fire a shot`,
        cardUse: `${Sim.CONFIG.maxCardsPerShot} cards max, ${Sim.CONFIG.maxShapeCards} shape cards max, ${Sim.CONFIG.maxModifierCards} modifier max`,
        output: "return JSON only"
      },
      objective: "eliminate opposing team while avoiding allied units",
      team,
      activeUnitId,
      controlledUnit: controlledUnit
        ? { id: controlledUnit.id, team: controlledUnit.team, x: controlledUnit.x, y: controlledUnit.y, hp: controlledUnit.hp }
        : { id: activeUnitId, team },
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
        owner: activeUnitId,
        retained: true,
        swapsUsed,
        swapsRemaining,
        rerollsUsed: swapsUsed,
        rerollsRemaining: swapsRemaining,
        cards
      },
      legalActions
    };
  }

  function validateAgentDecision(decision, legalActions) {
    if (!decision || typeof decision !== "object") return { ok: false, reason: "missing_decision" };
    const actions = Array.isArray(legalActions) ? legalActions : [];
    const candidates = actions.filter((item) => item.action === "shot" || !item.action);
    if (decision.action === "swap_hand" || decision.action === "reroll") {
      if (!actions.some((item) => item.action === "swap_hand")) return { ok: false, reason: "reroll_limit_reached" };
      return {
        ok: true,
        action: "swap_hand",
        publicReason:
          typeof decision.publicReason === "string" ? decision.publicReason.slice(0, 240) : "Provider chose to swap hand."
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
