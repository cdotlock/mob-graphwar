const assert = require("assert");
const Sim = require("../src/sim-core.js");

function commands() {
  return {
    A: "high arc, avoid allies, hit the weakest enemy",
    B: "aggressive shot, use sharp bends, finish low HP targets"
  };
}

function testDeterministicBattle() {
  const first = Sim.runBattle({ seed: 7351, commands: commands() });
  const second = Sim.runBattle({ seed: 7351, commands: commands() });
  assert.deepStrictEqual(Sim.exportTrace(first), Sim.exportTrace(second));
  assert.ok(first.events.length > 0, "battle should produce events");
  assert.ok(first.winner, "battle should reach a terminal state");
  assert.ok(["A", "B", "draw"].includes(first.winner), "winner should be valid");
  assert.ok(first.score && Number.isFinite(first.score.value), "battle should include a numeric score");
  assert.ok(["S", "A", "B", "C", "D"].includes(first.score.rank), "battle should include a rank");
}

function testNoInvalidState() {
  const state = Sim.runBattle({ seed: 2219, commands: commands() });
  for (const unit of state.units) {
    assert.ok(Number.isFinite(unit.hp), "unit hp should be finite");
    assert.ok(unit.hp >= 0, "unit hp should not go negative");
  }
  for (const event of state.events) {
    assert.ok(event.cost <= event.energy, "shot cost should fit energy");
    assert.ok(event.command.length <= Sim.CONFIG.maxCommandLength, "command should be truncated");
    assert.ok(event.hand.length <= Sim.CONFIG.handSize, "hand should fit hand size");
    assert.ok(event.expression.includes("y="), "event should include expression");
    assert.ok(event.thinking, "event should include thinking trace");
    assert.ok(event.thinking.intent, "thinking trace should include interpreted intent");
    assert.ok(event.thinking.handConstraint, "thinking trace should include hand constraint");
    assert.ok(event.thinking.risk, "thinking trace should include risk note");
  }
}

function testResourceValidation() {
  const hand = Sim.dealHand(1234, 0, "A");
  const expensive = hand.slice(0, 3).map((card) => ({
    id: card.id,
    cardId: card.instanceId,
    amp: 10
  }));
  const result = Sim.validateResourceUse(hand, expensive, 1);
  assert.strictEqual(result.ok, false);
  assert.ok(["not_enough_energy", "too_many_components"].includes(result.reason));

  const fake = Sim.validateResourceUse(hand, [{ 