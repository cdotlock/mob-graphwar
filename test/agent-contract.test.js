const assert = require("assert");
const Sim = require("../src/sim-core.js");
const Contract = require("../src/agents/contract.js");

function testCandidateExportIsSafe() {
  const state = Sim.createInitialState({ seed: 7351 });
  const candidates = Contract.listPublicShotCandidates(state, "A", "hit B2 high");
  assert.ok(candidates.length > 0, "should expose legal candidates");
  assert.ok(candidates.length <= Contract.MAX_PUBLIC_CANDIDATES, "candidate list should be bounded");
  assert.ok(candidates.every((candidate) => candidate.candidateId), "candidate should have stable id");
  assert.ok(candidates.every((candidate) => !candidate.expression.includes("function")), "candidate should not expose code");
  assert.ok(candidates.every((candidate) => candidate.combo && candidate.combo.name), "candidate should expose combo identity");
  assert.ok(
    candidates.every((candidate) => Array.isArray(candidate.combo.traits)),
    "candidate combo should expose readable traits"
  );
  assert.ok(candidates.every((candidate) => candidate.mapFit === undefined), "candidate should not expose simulated map fit");
  assert.ok(candidates.every((candidate) => candidate.score === undefined), "candidate should not expose local score");
  assert.ok(candidates.every((candidate) => candidate.resultLabel === undefined), "candidate should not expose simulated result");
  assert.ok(candidates.every((candidate) => candidate.action === "shot"), "candidate should expose the legal shot action");
}

function testRulesPayloadIsBareGameStateAndLegalActions() {
  const state = Sim.createInitialState({ seed: 7351 });
  const payload = Contract.buildRulesPayload(state, "A", "human prompt only");
  const serialized = JSON.stringify(payload);
  assert.strictEqual(payload.objective, "eliminate opposing team while avoiding allied units");
  assert.strictEqual(payload.team, "A");
  assert.ok(payload.allyIds.includes("A2"), "payload should identify allies");
  assert.ok(payload.opponentIds.includes("B1") && payload.opponentIds.includes("B2"), "payload should identify opponents");
  assert.ok(payload.hand.cards.length === Sim.CONFIG.handSize, "payload should include the retained current hand");
  assert.strictEqual(payload.hand.retained, true, "payload should tell providers that hands persist");
  assert.strictEqual(payload.hand.swapsUsed, 0, "payload should expose active-turn swap usage");
  assert.strictEqual(payload.hand.swapsRemaining, Sim.CONFIG.maxRerollsPerTurn, "payload should expose remaining hand swaps");
  assert.ok(payload.legalActions.some((action) => action.action === "swap_hand"), "payload should include swap_hand as a legal model action");
  assert.ok(payload.legalActions.some((action) => action.action === "shot"), "payload should include shot as a legal model action");
  assert.ok(payload.rules.handRetention.includes("persist"), "rules should describe retained hands");
  assert.ok(payload.rules.actionLimit.includes("swap_hand"), "rules should use the public swap_hand action");
  assert.ok(!serialized.includes('"action":"reroll"'), "provider payload should not expose reroll as the public action");
  assert.ok(!serialized.includes("score"), "payload should not expose local scoring");
  assert.ok(!serialized.includes("hitEnemy"), "payload should not expose simulated outcomes");
}

function testDecisionValidation() {
  const state = Sim.createInitialState({ seed: 7351 });
  const candidates = Contract.listPublicShotCandidates(state, "A", "hit B2 high");
  const valid = Contract.validateAgentDecision({ candidateId: candidates[0].candidateId, publicReason: "High arc." }, candidates);
  assert.strictEqual(valid.ok, true);

  const payload = Contract.buildRulesPayload(state, "A", "hit B2 high");
  const swap = Contract.validateAgentDecision({ action: "swap_hand", publicReason: "Need a better hand." }, payload.legalActions);
  assert.strictEqual(swap.ok, true);
  assert.strictEqual(swap.action, "swap_hand");

  const legacyReroll = Contract.validateAgentDecision({ action: "reroll", publicReason: "Legacy client." }, payload.legalActions);
  assert.strictEqual(legacyReroll.ok, true);
  assert.strictEqual(legacyReroll.action, "swap_hand", "legacy reroll should normalize to swap_hand");

  const noReroll = Contract.validateAgentDecision(
    { action: "swap_hand", publicReason: "Need a better hand." },
    payload.legalActions.filter((action) => action.action !== "swap_hand")
  );
  assert.strictEqual(noReroll.ok, false);
  assert.strictEqual(noReroll.reason, "reroll_limit_reached");

  const invalid = Contract.validateAgentDecision({ candidateId: "missing", publicReason: "Nope." }, candidates);
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.reason, "unknown_candidate");
}

function testSecretRedaction() {
  const redacted = Contract.redactSecrets({
    provider: "openai",
    apiKey: "sk-secret",
    nested: { authorization: "Bearer token" },
    safe: "ok"
  });
  assert.strictEqual(redacted.apiKey, "[redacted]");
  assert.strictEqual(redacted.nested.authorization, "[redacted]");
  assert.strictEqual(redacted.safe, "ok");
}

testCandidateExportIsSafe();
testRulesPayloadIsBareGameStateAndLegalActions();
testDecisionValidation();
testSecretRedaction();

console.log("agent-contract tests passed");
