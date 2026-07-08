(function initAgentContract(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../sim-core.js"));
  } else {
    root.GraphwarAgentContract = factory(root.GraphwarSim);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function contractFactory(Sim) {
  "use strict";

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

  function publicRecentFeedback(state) {
    const events = Array.isArray(state.events) ? state.events.slice(-8) : [];
    return events.map((event) => ({
      turn: event.turn,
      team: event.team,
      unitId: event.unitId || event.shooterId || "",
      targetId: event.targetId || "",
      expression: event.expression || "",
      result: event.result || "",
      resultLabel: event.resultLabel || "",
      damage: Number(event.damage) || 0,
      hitDistance: Number.isFinite(Number(event.hitDistance)) ? Number(event.hitDistance) : null,
      proximityAccuracy: Number.isFinite(Number(event.proximityAccuracy)) ? Number(event.proximityAccuracy) : null,
      collisionPoint: event.collisionPoint
        ? { x: event.collisionPoint.x, y: event.collisionPoint.y }
        : null,
      closestTargetDistance: Number.isFinite(Number(event.closestTargetDistance)) ? Number(event.closestTargetDistance) : null,
      maxY: Number.isFinite(Number(event.maxY)) ? Number(event.maxY) : null
    }));
  }

  function publicOwnRecentFeedback(state, activeUnitId) {
    const id = String(activeUnitId || "").toUpperCase();
    const events = Array.isArray(state.events) ? state.events : [];
    return events
      .filter((event) => String(event.unitId || event.shooterId || "").toUpperCase() === id)
      .slice(-4)
      .map((event) => ({
        turn: event.turn,
        unitId: event.unitId || event.shooterId || "",
        targetId: event.targetId || "",
        expression: event.expression || "",
        result: event.result || "",
        resultLabel: event.resultLabel || "",
        damage: Number(event.damage) || 0,
        hitDistance: Number.isFinite(Number(event.hitDistance)) ? Number(event.hitDistance) : null,
        proximityAccuracy: Number.isFinite(Number(event.proximityAccuracy)) ? Number(event.proximityAccuracy) : null,
        collisionPoint: event.collisionPoint
          ? { x: event.collisionPoint.x, y: event.collisionPoint.y }
          : null,
        closestTargetDistance: Number.isFinite(Number(event.closestTargetDistance)) ? Number(event.closestTargetDistance) : null
      }));
  }

  function publicCardEffect(card) {
    const effect = card && card.effect ? card.effect : {};
    return {
      precisionBonus: Number(effect.precisionBonus) || 0
    };
  }

  function buildRulesPayload(state, owner, command) {
    const units = state.units || [];
    const controlledUnit = resolveControlledUnit(state, owner);
    const activeUnitId = controlledUnit ? controlledUnit.id : String(owner || "A1").toUpperCase();
    const team = controlledUnit ? controlledUnit.team : activeUnitId.startsWith("B") ? "B" : "A";
    const handState = state.hands && state.hands[activeUnitId] ? state.hands[activeUnitId] : null;
    const cards = Sim.getCurrentHand(state, activeUnitId).map((card, index) => ({
      slot: index + 1,
      function: card.label,
      label: card.label,
      family: card.family,
      tags: card.tags,
      effect: publicCardEffect(card),
      description: card.description
    }));
    const availableFunctionTypes =
      typeof Sim.allowedFunctionNamesForHand === "function" ? Sim.allowedFunctionNamesForHand(cards) : [];
    const swapsUsed = handState ? Number(handState.swapsUsed) || 0 : 0;
    const swapsRemaining = Math.max(0, Sim.CONFIG.maxSwapsPerTurn - swapsUsed);
    const opponentIds = units.filter((unit) => unit.team !== team && unit.hp > 0).map((unit) => unit.id);
    const shotAction = {
      action: "shot",
      allowedTargetIds: opponentIds,
      output: {
        action: "shot",
        targetId: "one allowedTargetIds value",
        expression: "y=<absolute board y expression>. Usually start with y0+dy*t, then add scaled current-hand function terms. Do not use a, amp, target, shooter, or helper variables.",
        cardSlots: "optional array of 1-based hand card slots referenced for UI highlighting",
        publicReason: "short visible explanation"
      }
    };
    const legalActions = swapsRemaining > 0
      ? [{ action: "swap_hand", swapsUsed, swapsRemaining }].concat([shotAction])
      : [shotAction];
    return {
      rules: {
        turnOrder: "A1, B1, A2, B2 rotate as separate AI seats",
        actionLimit: "choose exactly one legal action: swap_hand or shot; for shot, write your own function expression instead of choosing a server-authored shot option",
        handRetention: "cards persist in hand across shots until the active model chooses swap_hand",
        swapLimit: `${Sim.CONFIG.maxSwapsPerTurn} swap_hand actions per active turn; swap_hand replaces the retained hand and does not fire a shot`,
        functionHand: "the current hand is the function whitelist; combine any or all current hand function types freely",
        functionScaling: "card labels name allowed function types, not fixed amplitudes; free numeric coefficients are allowed and often need board-scale values such as 10..60",
        precisionMeaning: "card.effect.precisionBonus above 0 marks a function that is useful for fine correction or tight lanes; it is metadata, not a required tactic.",
        damageModel: "enemy damage rises with proximityAccuracy, expression function count, and route bonus points. proximityAccuracy is 1 at a unit center and falls toward 0 at the unit edge.",
        swapPolicy: "If ownRecentFeedback shows repeated blocked, out, ground, hitAlly, or invalid shots and the current hand does not suggest a materially different lane, swap_hand is a valid choice.",
        expressionVariables: "t is normalized 0..1, u is horizontal travel, d is shooter-target horizontal distance, x is board x, y0/y1 are shooter/target y, dy=y1-y0",
        expressionCoordinate: "y is the absolute board y coordinate, not a small offset; y0+dy*t is the straight shooter-to-target baseline and card functions should be added as scaled offsets around that baseline",
        expressionFunctions: "call only function names that appear in hand.availableFunctionTypes; if a useful function is absent, use swap_hand instead of inventing sin/cos/max/etc; arithmetic, numbers, variables, pi, e, +, -, *, /, ^, comparisons, and ternary expressions are always allowed",
        expressionSyntax: "write exactly one y=<expression>; do not write semicolon assignments, where clauses, undefined variables, prose, helper definitions, or the internal amplitude placeholder a",
        feedbackPolicy: "If recentFeedback shows repeated ground shots, anchor on y0+dy*t and increase positive board-scale lift; for blocked shots, route above or around the reported collisionPoint instead of repeating the same curve; for hitAlly, do not repeat that path and choose a different target/path or swap_hand; if invalid unavailable functions appear, use only the whitelist or swap_hand",
        repeatPolicy: "Do not repeat the exact same failed expression from ownRecentFeedback after blocked, hitAlly, out, ground, or invalid results; change coefficients/shape materially or use swap_hand",
        promptPolicy: "this JSON packet is the full public model contract; no hidden tactical hints are provided",
        output: "return JSON only. Preferred JSON keys are action,targetId,expression,cardSlots,publicReason. For shot: action='shot', targetId is one allowedTargetIds value, expression is y=<absolute board y expression>, cardSlots is an array, publicReason is one sentence. For swap_hand: action='swap_hand', targetId='', expression='', cardSlots=[]. The server may tolerate target/formula/slots/reason aliases, but the preferred keys are the most reliable contract."
      },
      objective: "eliminate opposing team while avoiding allied units",
      team,
      activeUnitId,
      controlledUnit: controlledUnit
        ? { id: controlledUnit.id, team: controlledUnit.team, x: controlledUnit.x, y: controlledUnit.y, hp: controlledUnit.hp }
        : { id: activeUnitId, team },
      command: String(command || "").slice(0, Sim.CONFIG.maxCommandLength),
      allyIds: units.filter((unit) => unit.team === team && unit.hp > 0).map((unit) => unit.id),
      opponentIds,
      state: {
        seed: state.seed,
        turn: state.turn,
        map: state.mapMeta,
        units: units.map((unit) => ({ id: unit.id, team: unit.team, x: unit.x, y: unit.y, hp: unit.hp })),
        obstacles: state.obstacles || []
      },
      recentFeedback: publicRecentFeedback(state),
      ownRecentFeedback: publicOwnRecentFeedback(state, activeUnitId),
      hand: {
        owner: activeUnitId,
        retained: true,
        swapsUsed,
        swapsRemaining,
        analysis: Sim.analyzeHand(cards),
        availableFunctionTypes,
        cards
      },
      actionSpace: {
        mode: "model_written_expression",
        modelFacingShotOptions: 0,
        publicShotOptions: 0,
        capped: false
      },
      legalActions
    };
  }

  function validateAgentDecision(decision, legalActions) {
    if (!decision || typeof decision !== "object") return { ok: false, reason: "missing_decision" };
    const actions = Array.isArray(legalActions) ? legalActions : [];
    const shotContract = actions.find((item) => item.action === "shot") || {};
    if (decision.action === "swap_hand") {
      if (!actions.some((item) => item.action === "swap_hand")) return { ok: false, reason: "swap_limit_reached" };
      return {
        ok: true,
        action: "swap_hand",
        publicReason:
          typeof decision.publicReason === "string" ? decision.publicReason.slice(0, 240) : "Provider chose to swap hand."
      };
    }
    if (typeof decision.expression === "string") {
      const allowedTargets = Array.isArray(shotContract.allowedTargetIds) ? shotContract.allowedTargetIds : [];
      if (typeof decision.targetId !== "string" || !decision.targetId.trim()) return { ok: false, reason: "missing_target_id" };
      if (allowedTargets.length && !allowedTargets.includes(decision.targetId)) return { ok: false, reason: "unknown_target_id" };
      const expression = decision.expression.trim();
      if (!expression) return { ok: false, reason: "missing_expression" };
      if (expression.length > 600) return { ok: false, reason: "expression_too_long" };
      const cardSlots = Array.isArray(decision.cardSlots)
        ? decision.cardSlots.map((slot) => Number(slot)).filter((slot) => Number.isInteger(slot) && slot >= 1 && slot <= Sim.CONFIG.handSize)
        : [];
      return {
        ok: true,
        action: "shot",
        targetId: decision.targetId,
        expression,
        cardSlots: Array.from(new Set(cardSlots)),
        publicReason:
          typeof decision.publicReason === "string" ? decision.publicReason.slice(0, 240) : "Provider wrote a function shot."
      };
    }
    return { ok: false, reason: "missing_expression" };
  }

  return {
    buildRulesPayload,
    redactSecrets,
    validateAgentDecision
  };
});
