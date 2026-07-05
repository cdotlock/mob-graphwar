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
  assert.ok(candidates.every((candidate) => candidate.score === undefined), "candidate should not expose local score");
  assert.ok(candidates.every((candidate) => candidate.resultLabel === undefined), "candidate should not expose simulated result");
}

function testDecisionValidation() {
  const state = Sim.createInitialState({ seed: 7351 });
  const candidates = Contract.listPublicShotCandidates(state, "A", "hit B2 high");
  const valid = Contract.validateAgentDecision({ candidateId: candidates[0].candidateId, publicReason: "High arc." }, candidates);
  assert.strictEqual(valid.ok, true);

  const invalid = Contract.validateAgentDecision({ candidateId: "missing", publicReason: "Nope." }, candidates);
  assert.strictEqual(invalid.ok, false);
  assert.strictEqua