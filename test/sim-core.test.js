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

function testBattleOrdersLockAfterFirstShot() {
  const state = Sim.createInitialState({ seed: 7351 });
  const firstOrders = {
    A: "must target B2, high safe arc",
    B: "must target A2, high safe arc"
  };
  const editedOrders = {
    A: "ignore B2, use volatile",
    B: "must target A1, low risky direct shot"
  };

  assert.strictEqual(state.lockedOrders, null, "fresh battle should not start locked");
  Sim.applyTurn(state, firstOrders);
  assert.deepStrictEqual(state.lockedOrders, firstOrders, "first shot should lock both battle orders");

  Sim.applyTurn(state, editedOrders);
  assert.strictEqual(state.events[1].team, "B");
  assert.strictEqual(state.events[1].command, firstOrders.B, "later turns should use the locked order");
  assert.notStrictEqual(state.events[1].command, editedOrders.B, "mid-battle edits should not affect the current battle");

  const trace = Sim.exportTrace(state);
  assert.deepStrictEqual(trace.lockedOrders, firstOrders, "exported trace should include locked battle orders");
}

function testInvalidProviderCandidateDoesNotLockOrders() {
  const state = Sim.createInitialState({ seed: 7351 });
  assert.throws(
    () => Sim.applyTurn(state, { A: "must target B2, high safe arc", B: "must target A2, high safe arc" }, { candidateId: "missing" }),
    /unknown_candidate/
  );
  assert.strictEqual(state.lockedOrders, null, "failed provider validation should not lock orders");
  assert.strictEqual(state.events.length, 0, "failed provider validation should not append an event");
  assert.strictEqual(state.turn, 0, "failed provider validation should not advance the turn");
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

  const hard = Sim.parseDirective("must target B2, no volatile cards, safe shot");
  assert.deepStrictEqual(hard.requiredTargetIds, ["B2"]);
  assert.strictEqual(hard.forbidRisk, true);
  assert.ok(hard.ruleSummary.includes("hard target B2"));
  assert.ok(hard.ruleSummary.includes("no volatile/risk cards"));

  const chineseRiskBan = Sim.parseDirective("禁用冒险牌，不用volatile，锁定A2");
  assert.strictEqual(chineseRiskBan.forbidRisk, true);
  assert.strictEqual(chineseRiskBan.avoidAllyHits, false);
  assert.deepStrictEqual(chineseRiskBan.requiredTargetIds, ["A2"]);
}

function testHardTargetConstraintChangesShotChoice() {
  const state = Sim.createInitialState({ seed: 7351 });
  Sim.applyTurn(state, { A: "must target B2, high safe arc" });
  const event = state.events[0];
  assert.strictEqual(event.targetId, "B2");
  assert.ok(event.thinking.commandRules.includes("hard target B2"));
  assert.deepStrictEqual(
    event.thinking.targetPriority.map((target) => target.id),
    ["B2"]
  );
}

function testUnavailableHardTargetIsReportedAsFallback() {
  const state = Sim.createInitialState({ seed: 7351 });
  state.units.find((unit) => unit.id === "B2").hp = 0;
  Sim.applyTurn(state, { A: "must target B2, high safe arc" });
  const event = state.events[0];
  assert.strictEqual(event.targetId, "B1");
  assert.ok(event.thinking.commandRules.includes("requested target B2 unavailable"));
  assert.deepStrictEqual(
    event.thinking.targetPriority.map((target) => target.id),
    ["B1"]
  );
}

function testSafeCommandForbidsRiskCards() {
  const state = Sim.runBattle({
    seed: 7352,
    commands: {
      A: "safe high arc avoid ally target B2",
      B: "safe high arc avoid ally target A2"
    }
  });
  const riskySafeEvents = state.events.filter((event) =>
    event.components.some((component) => component.family === "risk" || component.tags.includes("volatile"))
  );
  assert.deepStrictEqual(
    riskySafeEvents.map((event) => ({ turn: event.turn, team: event.team, cards: event.components.map((c) => c.label) })),
    []
  );
  assert.ok(state.events.every((event) => event.thinking.commandRules.includes("no volatile/risk cards")));
}

function testLegalShotsHonorSafeConstraints() {
  const state = Sim.createInitialState({ seed: 7352 });
  const shots = Sim.listLegalShots(state, "A", "safe high arc avoid ally target B2");
  assert.ok(shots.length > 0, "safe command should still produce legal shots");
  assert.ok(shots.every((shot) => shot.result !== "hitAlly"), "safe legal shots should not include ally hits");
  assert.ok(
    shots.every((shot) =>
      shot.cards.every((card) => card.family !== "risk" && !(card.tags || []).includes("volatile"))
    ),
    "safe legal shots should not include risk or volatile cards"
  );

  const weaveState = Sim.createInitialState({ seed: 120 });
  const weaveShots = Sim.listLegalShots(weaveState, "A", "safe avoid ally no volatile target B2");
  assert.ok(weaveShots.length > 0, "safe weave setup should produce legal shots");
  assert.ok(
    weaveShots.every((shot) => !(shot.combo.traits || []).includes("volatile")),
    "safe legal shot combo traits should not imply volatile risk"
  );
}

function testShotEventsExposeCardComboIdentity() {
  const state = Sim.createInitialState({ seed: 7351 });
  Sim.applyTurn(state, { A: "只打B2，安全高抛越塔，禁用冒险牌，别误伤队友。" });
  const event = state.events[0];
  assert.ok(event.combo, "event should include card-combo identity");
  assert.ok(event.combo.name, "combo should have a player-facing name");
  assert.ok(event.combo.traits.length > 0, "combo should expose traits");
  assert.ok(event.combo.scoreBonus > 0, "combo should influence shot scoring");
  assert.strictEqual(event.thinking.comboName, event.combo.name);
  assert.strictEqual(event.thinking.comboNote, event.combo.note);
}

function testLegalShotsExposeCardComboIdentity() {
  const state = Sim.createInitialState({ seed: 7351 });
  const shots = Sim.listLegalShots(state, "A", "只打B2，安全高抛越塔，禁用冒险牌，别误伤队友。");
  assert.ok(shots.length > 0, "legal shots should be listed");
  assert.ok(shots.every((shot) => shot.combo && shot.combo.name && Array.isArray(shot.combo.traits)));
  assert.ok(shots.some((shot) => shot.combo.scoreBonus > 0), "some legal shots should have combo scoring identity");
}

function testHandAnalysisSummarizesTacticalRead() {
  const hand = Sim.dealHand(7351, 0, "A");
  const analysis = Sim.analyzeHand(hand, 4);

  assert.strictEqual(analysis.archetype, "Threaded Hook");
  assert.deepStrictEqual(analysis.traits, ["precision", "thread", "corner"]);
  assert.strictEqual(analysis.playableCount, 4);
  assert.strictEqual(analysis.risk, "volatile option");
  assert.ok(analysis.energyRead.includes("4/4 playable"));
  assert.ok(analysis.commandRead.includes("Corner"));
}

function testCardProfilesExposeTacticalCardRoles() {
  const arc = Sim.cardProfile(Sim.CARD_LIBRARY.arc, 4);
  assert.strictEqual(arc.role, "Clear");
  assert.strictEqual(arc.playable, true);
  assert.strictEqual(arc.costPressure, "mid cost");
  assert.ok(arc.tableText.includes("cover"));

  const anchor = Sim.cardProfile(Sim.CARD_LIBRARY.anchor, 4);
  assert.strictEqual(anchor.role, "Aim");
  assert.strictEqual(anchor.costPressure, "cheap");
  assert.strictEqual(anchor.riskText, "stable");

  const lateDive = Sim.cardProfile(Sim.CARD_LIBRARY.late_dive, 4);
  assert.strictEqual(lateDive.role, "Risk");
  assert.strictEqual(lateDive.riskText, "volatile");

  const overpass = Sim.cardProfile(Sim.CARD_LIBRARY.overpass, 2);
  assert.strictEqual(overpass.playable, false);
  assert.strictEqual(overpass.costPressure, "over budget");
}

function testApplyTurnCanUseProviderCandidate() {
  const command = "只打B2，安全高抛越塔，禁用冒险牌，别误伤队友。";
  const state = Sim.createInitialState({ seed: 7351 });
  const shots = Sim.listLegalShots(state, "A", command);
  const selected = shots.find((shot) => shot.expression !== shots[0].expression) || shots[1];
  assert.ok(selected && selected.candidateId, "legal shots should expose candidate ids");

  Sim.applyTurn(state, { A: command }, { candidateId: selected.candidateId, providerReason: "Provider picked a stable legal shot." });
  const event = state.events[0];
  assert.strictEqual(event.expression, selected.expression);
  assert.strictEqual(event.thinking.providerReason, "Provider picked a stable legal shot.");
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

function testCompactHandsStillGuaranteeShapeChoices() {
  assert.strictEqual(Sim.CONFIG.handSize, 4, "each turn should show a tighter four-card hand");
  for (let seed = 1; seed <= 24; seed += 1) {
    for (let turn = 0; turn < 8; turn += 1) {
      for (const team of ["A", "B"]) {
        const hand = Sim.dealHand(seed, turn, team);
        const shapeCount = hand.filter((card) => card.family !== "modifier").length;
        assert.strictEqual(hand.length, 4, "hand should have exactly four cards");
        assert.ok(shapeCount >= 2, "hand should preserve at least two shape cards");
      }
    }
  }
}

function testSeededHardMapGeneration() {
  const first = Sim.createInitialState({ seed: 9001 });
  const second = Sim.createInitialState({ seed: 9001 });
  const different = Sim.createInitialState({ seed: 9002 });
  assert.deepStrictEqual(first.obstacles, second.obstacles, "same seed should produce same map");
  assert.notDeepStrictEqual(first.obstacles, different.obstacles, "different seeds should produce different maps");
  assert.ok(first.mapMeta && first.mapMeta.difficulty >= 75, "map should include high difficulty metadata");
  assert.strictEqual(first.mapMeta.windows, undefined, "map should not expose route windows");
  assert.ok(first.obstacles.length >= 5, "map should have dense pure terrain complexity");
  assert.ok(first.obstacles.filter((obstacle) => obstacle.h >= 24).length >= 2, "map should include multiple tall obstructions");
  assert.ok(first.units.every((unit) => unit.y > Sim.groundY(unit.x)), "units should spawn above ground");
}

function testHardMapsRemainSolvableByFiniteCardCombos() {
  for (let seed = 1; seed <= 40; seed += 1) {
    const state = Sim.createInitialState({ seed });
    for (const team of ["A", "B"]) {
      const shots = Sim.listLegalShots(state, team, "");
      assert.ok(shots.length > 0, `seed ${seed} team ${team} should have legal shots`);
      assert.ok(
        shots.some((shot) => !["invalid", "out"].includes(shot.result)),
        `seed ${seed} team ${team} should have at least one bounded curve`
      );
      assert.ok(shots.every((shot) => shot.mapFit === undefined), "legal shots should not expose route-window fit");
    }
  }
}

function testTraceShapeIncludesMapAndScore() {
  const state = Sim.runBattle({ seed: 7107, commands: commands() });
  const trace = Sim.exportTrace(state);
  assert.ok(trace.mapMeta, "trace should include map metadata");
  assert.strictEqual(trace.mapMeta.windows, undefined, "trace should not include tactical windows");
  assert.ok(trace.score, "trace should include score");
  assert.strictEqual(trace.events.length, state.events.length);
  assert.ok(trace.events.every((event) => event.thinking), "all trace events should include thinking");
  assert.ok(trace.events.every((event) => event.mapFit === undefined), "events should not include route-window fit");
}

testDeterministicBattle();
testBattleOrdersLockAfterFirstShot();
testInvalidProviderCandidateDoesNotLockOrders();
testNoInvalidState();
testResourceValidation();
testCommandParsing();
testHardTargetConstraintChangesShotChoice();
testUnavailableHardTargetIsReportedAsFallback();
  testSafeCommandForbidsRiskCards();
  testLegalShotsHonorSafeConstraints();
  testShotEventsExposeCardComboIdentity();
  testLegalShotsExposeCardComboIdentity();
  testHandAnalysisSummarizesTacticalRead();
  testCardProfilesExposeTacticalCardRoles();
  testApplyTurnCanUseProviderCandidate();
  testRicherCardCatalog();
  testCompactHandsStillGuaranteeShapeChoices();
  testSeededHardMapGeneration();
  testHardMapsRemainSolvableByFiniteCardCombos();
  testTraceShapeIncludesMapAndScore();

console.log("sim-core tests passed");
