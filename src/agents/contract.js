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
    return shots.map((shot, index) => ({
      candidateId: `${team}-${state.turn}-${index}-${shot.targetId}-${shot.usedCardIds.join(".") || "baseline"}`,
      targetId: shot.targetId,
      cards: shot.cards,
      cost: shot.cost,
      resultLabel: shot.resultLabel,
      score: shot.score,
      expression: shot.expression
    }));
  }

  function validateAgentDecision(decision, candidates) {
    if (!decision || typeof decision !== "object") return { ok: false, reason: "missing_decision" };
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
    listPublicShotCandidates,
    redactSecrets,
    validateAgentDecision
  };
});
