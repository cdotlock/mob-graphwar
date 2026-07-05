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

  const fake = Sim.validateResourceUse(hand, [{ id: "arc", cardId: "missing", amp: 10 }], 10);
  assert.strictEqual(fake.ok, false);
  assert.strictEqual(fake.reason, "card_not_in_hand");
}

function testCommandParsing() {
  const directive = Sim.parseDirective("high arc, avoid allies, finish low HP targets");
  assert.strictEqual(directive.high, true);
  assert.strictEqual(directive.safe, true);
  assert.strictEqual(directive.weakest, true);

  const chinese = Sim.parseDirective("绕塔墙上缘，避队友，优先B2，露线再打B1。");
  assert.strictEqual(chinese.high, true);
  assert.strictEqual(chinese.safe, true);
  assert.deepStrictEqual(chinese.targetIds, ["B2", "B1"]);
}

function testRicherCardCatalog() {
  const cards = Object.values(Sim.CARD_LIBRARY);
  assert.ok(cards.length >= 18, "card catalog should contain at least 18 cards");
  const families = new Set(cards.map((card) => card.family));
  for (const family of ["lift", "bend", "wave", "control", "risk", "modifier"]) {
    assert.ok(families.has(family), `card catalog should include ${family}`);
  }
  assert.ok(cards.every((card) => Array.isArray(card.tags) && card.tags.length > 0), "cards should have tags");
  assert.ok(cards.every((card) => Array.isArray(card.amplitudes) && card.amplitudes.length > 0), "cards should have amplitudes");
}

function testSeededHardMapGeneration() {
  const first = Sim.createInitialState({ seed: 9001 });
  const second = Sim.createInitialState({ seed: 9001 });
  const different = Sim.createInitialState({ seed: 9002 });
  assert.deepStrictEqual(first.obstacles, second.obstacles, "same seed should produce same map");
  assert.notDeepStrictEqual(first.obstacles, different.obstacles, "different seeds should produce different maps");
  assert.ok(first.mapMeta && first.mapMeta.difficulty >= 1, "map should include difficulty metadata");
  assert.ok(first.obstacles.length >= 3, "map should have multiple obstacles");
  assert.ok(first.obstacles.some((obstacle) => obstacle.h >= 24), "map should include a tall obstruction");
  assert.ok(first.units.every((unit) => unit.y > Sim.groundY(unit.x)), "units should spawn above ground");
}

function testTraceShapeIncludesMapAndScore() {
  const state = Sim.runBattle({ seed: 7107, commands: commands() });
  const trace = Sim.exportTrace(state);
  assert.ok(trace.mapMeta, "trace should include map metadata");
  assert.ok(trace.score, "trace should include score");
  assert.strictEqual(trace.events.length, state.events.length);
  assert.ok(trace.events.every((event) => event.thinking), "all trace events should include thinking");
}

testDeterministicBattle();
testNoInvalidState();
testResourceValidation();
testCommandParsing();
testRicherCardCatalog();
testSeededHardMapGeneration();
testTraceShapeIncludesMapAndScore();

console.log("sim-core tests passed");
