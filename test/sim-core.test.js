const assert = require("assert");
const Sim = require("../src/sim-core.js");

function commands() {
  return {
    A: "high arc, avoid allies, hit the weakest enemy",
    B: "aggressive shot, use sharp bends, finish low HP targets",
    A1: "high arc, avoid allies, hit the weakest enemy",
    B1: "aggressive shot, use sharp bends, finish low HP targets",
    A2: "safe high arc, target B1",
    B2: "bend through center, target A1"
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

function testGlobalActionCapIsTwentyFour() {
  assert.strictEqual(Sim.CONFIG.maxResolutionActions, 24, "global AI battle action cap should be 24");
}

function testBattleDoesNotDrawFromTurnLimit() {
  const state = Sim.createInitialState({ seed: 7351 });
  for (const unit of state.units) {
    unit.hp = 999;
  }
  for (let turn = 0; turn < 24; turn += 1) {
    Sim.applyTurn(state, { A: "safe high arc", B: "safe high arc" });
  }
  assert.strictEqual(state.winner, null, "battle should not draw just because the old 16 turn display limit passed");
  assert.notStrictEqual(state.reason, "max_turns", "max_turns should not be a terminal battle reason");
}

function testStandingOrdersStayLockedDuringAutoBattle() {
  const lockedOrders = {
    A: "must target B2, high safe arc",
    B: "must target A2, high safe arc",
    A1: "must target B2, high safe arc",
    B1: "must target A2, high safe arc"
  };
  const midDuelEdit = {
    A: "ignore B2, draw a low direct line",
    B: "must target A1, low direct shot",
    A1: "ignore B2, draw a low direct line",
    B1: "must target A1, low direct shot"
  };
  const state = Sim.createInitialState({ seed: 7351, lockedOrders });

  Sim.applyTurn(state, midDuelEdit);
  assert.strictEqual(state.events[0].team, "A");
  assert.strictEqual(state.events[0].command, lockedOrders.A1, "locked opening order should drive the first model turn");

  Sim.applyTurn(state, midDuelEdit);
  assert.strictEqual(state.events[1].team, "B");
  assert.strictEqual(state.events[1].command, lockedOrders.B1, "mid-duel human edits should not replace the standing order");

  const trace = Sim.exportTrace(state);
  assert.deepStrictEqual(trace.lockedOrders, lockedOrders, "trace should preserve the launch-time standing orders");
}

function testTurnsRotateAcrossFourUnitSeats() {
  const state = Sim.createInitialState({ seed: 7351 });
  assert.deepStrictEqual(state.turnOrder, ["A1", "B1", "A2", "B2"], "state should expose the four AI seat turn order");

  for (let i = 0; i < 4; i += 1) {
    Sim.applyTurn(state, {
      A1: "must target B2, safe high arc",
      B1: "must target A2, safe high arc",
      A2: "must target B1, safe high arc",
      B2: "must target A1, safe high arc"
    });
  }

  assert.deepStrictEqual(
    state.events.slice(0, 4).map((event) => event.shooterId),
    ["A1", "B1", "A2", "B2"],
    "each AI seat should take its own visible turn"
  );
  assert.deepStrictEqual(
    state.events.slice(0, 4).map((event) => event.team),
    ["A", "B", "A", "B"],
    "team order should alternate while preserving individual seats"
  );
  assert.deepStrictEqual(
    state.events.slice(0, 4).map((event) => event.unitId),
    ["A1", "B1", "A2", "B2"],
    "events should expose the controlled AI unit"
  );
}

function testNoInvalidState() {
  const state = Sim.runBattle({ seed: 2219, commands: commands() });
  for (const unit of state.units) {
    assert.ok(Number.isFinite(unit.hp), "unit hp should be finite");
    assert.ok(unit.hp >= 0, "unit hp should not go negative");
  }
  for (const event of state.events) {
    assert.strictEqual(event.cost, undefined, "shot cost should not remain in public events");
    assert.strictEqual(event.energy, undefined, "energy should not remain in public events");
    assert.ok(event.command.length <= Sim.CONFIG.maxCommandLength, "command should be truncated");
    assert.ok(event.hand.length <= Sim.CONFIG.handSize, "hand should fit hand size");
    assert.ok(event.expression.includes("y="), "event should include expression");
    assert.ok(event.thinking, "event should include thinking trace");
    assert.ok(event.thinking.intent, "thinking trace should include interpreted intent");
    assert.ok(event.thinking.handConstraint, "thinking trace should include hand constraint");
    assert.ok(event.thinking.trajectoryFeedback, "thinking trace should include trajectory feedback");
  }
}

function testResourceValidation() {
  const hand = Sim.dealHand(1234, 0, "A");
  const allCurrentFunctions = hand.map((card) => ({
    id: card.id,
    cardId: card.instanceId,
    family: card.family,
    amp: 10
  }));
  const result = Sim.validateResourceUse(hand, allCurrentFunctions, 0);
  assert.strictEqual(result.ok, true, "all current hand functions should be freely combinable");
  assert.strictEqual(result.reason, "ok");

  const fake = Sim.validateResourceUse(hand, [{ id: "arc", cardId: "missing", amp: 10 }], 10);
  assert.strictEqual(fake.ok, false);
  assert.strictEqual(fake.reason, "card_not_in_hand");
}

function testProviderExpressionIsLimitedToCurrentHandFunctionTypes() {
  const state = Sim.createInitialState({ seed: 1 });
  const labels = Sim.getCurrentHand(state, "A1").map((card) => card.label).join(" ");
  assert.ok(!labels.includes("sin("), "test setup should not expose sine in the current hand");

  Sim.applyTurn(state, { A1: "try an unavailable sine" }, {
    targetId: "B1",
    expression: "y=y0+dy*t+10*sin(pi*t)",
    cardSlots: [1],
    providerReason: "Provider tried to invent sine."
  });
  const event = state.events[0];
  assert.strictEqual(event.result, "invalid");
  assert.ok(event.resultLabel.includes("function_not_in_hand:sin"), "invalid reason should name the unavailable function type");
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

  const hard = Sim.parseDirective("must target B2, safe shot");
  assert.deepStrictEqual(hard.requiredTargetIds, ["B2"]);
  assert.ok(hard.ruleSummary.includes("hard target B2"));
  assert.ok(hard.ruleSummary.includes("avoid ally hits"));

  const chineseSafeTarget = Sim.parseDirective("稳一点，锁定A2，别误伤队友");
  assert.strictEqual(chineseSafeTarget.avoidAllyHits, true);
  assert.deepStrictEqual(chineseSafeTarget.requiredTargetIds, ["A2"]);
}

function testHardTargetConstraintChangesShotChoice() {
  const state = Sim.createInitialState({ seed: 7351 });
  Sim.applyTurn(state, { A1: "must target B2, high safe arc" });
  const event = state.events[0];
  assert.strictEqual(event.targetId, "B2");
  assert.ok(event.thinking.commandRules.includes("hard target B2"));
  assert.deepStrictEqual(
    event.thinking.targetPriority.map((target) => target.id),
    ["B2"]
  );
}

function testUnavailableHardTargetUsesLiveTarget() {
  const state = Sim.createInitialState({ seed: 7351 });
  state.units.find((unit) => unit.id === "B2").hp = 0;
  Sim.applyTurn(state, { A1: "must target B2, high safe arc" });
  const event = state.events[0];
  assert.strictEqual(event.targetId, "B1");
  assert.ok(event.thinking.commandRules.includes("requested target B2 unavailable"));
  assert.deepStrictEqual(
    event.thinking.targetPriority.map((target) => target.id),
    ["B1"]
  );
}

function testSafeCommandAvoidsAllyHitsWithoutFunctionBans() {
  const state = Sim.runBattle({
    seed: 7352,
    commands: {
      A: "safe high arc avoid ally target B2",
      B: "safe high arc avoid ally target A2"
    }
  });
  assert.ok(state.events.length > 0, "safe commands should still play the game");
  assert.ok(state.events.every((event) => event.thinking.commandRules.includes("avoid ally hits")));
  assert.ok(state.events.every((event) => !event.thinking.commandRules.includes("volatile/risk")));
}

function testLegalShotsHonorSafeConstraints() {
  const state = Sim.createInitialState({ seed: 7352 });
  const shots = Sim.listLegalShots(state, "A", "safe high arc avoid ally target B2");
  assert.ok(shots.length > 0, "safe command should still produce legal shots");
  assert.ok(shots.every((shot) => shot.result !== "hitAlly"), "safe legal shots should not include ally hits");

  const weaveState = Sim.createInitialState({ seed: 120 });
  const weaveShots = Sim.listLegalShots(weaveState, "A", "safe avoid ally target B2");
  assert.ok(weaveShots.length > 0, "safe weave setup should produce legal shots");
  assert.ok(weaveShots.every((shot) => shot.result !== "hitAlly"), "safe weave setup should only filter ally hits");
}

function testShotEventsExposeCardComboIdentity() {
  const state = Sim.createInitialState({ seed: 7351 });
  Sim.applyTurn(state, { A1: "只打B2，安全高抛越塔，别误伤队友。" });
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
  const shots = Sim.listLegalShots(state, "A", "只打B2，安全高抛越塔，别误伤队友。");
  assert.ok(shots.length > 0, "legal shots should be listed");
  assert.ok(shots.every((shot) => shot.combo && shot.combo.name && Array.isArray(shot.combo.traits)));
  assert.ok(shots.some((shot) => shot.combo.scoreBonus > 0), "some legal shots should have combo scoring identity");
}

function testHandAnalysisSummarizesTacticalRead() {
  const hand = Sim.dealHand(7351, 0, "A");
  const analysis = Sim.analyzeHand(hand);

  assert.ok(analysis.archetype.includes("t"), "hand archetype should summarize actual math functions");
  assert.ok(!["Threaded Hook", "Loose Charge", "Guided Overpass", "Mixed Curve"].includes(analysis.archetype), "hand archetype should not use game-move aliases");
  assert.ok(analysis.traits.length > 0, "hand analysis should expose tactical traits");
  assert.strictEqual(analysis.playableCount, 4);
  assert.ok(analysis.precisionRead, "hand analysis should expose precision read");
  assert.ok(analysis.functionRead.includes("4 current functions"));
  assert.ok(analysis.functionRead.includes("unrestricted composition"));
  assert.ok(analysis.commandRead.length > 10);
}

function testCardProfilesExposeTacticalCardRoles() {
  const arc = Sim.cardProfile(Sim.CARD_LIBRARY.arc);
  assert.strictEqual(arc.role, "Clear");
  assert.strictEqual(arc.playable, true);
  assert.strictEqual(arc.functionAccess, "allowed");
  assert.ok(arc.tableText.includes("cover"));

  const anchor = Sim.cardProfile(Sim.CARD_LIBRARY.anchor);
  assert.strictEqual(anchor.role, "Aim");
  assert.strictEqual(anchor.functionAccess, "allowed");
  assert.ok(anchor.tableText.includes("near misses"));

  const lateDive = Sim.cardProfile(Sim.CARD_LIBRARY.late_dive);
  assert.strictEqual(lateDive.role, "Control");
  assert.ok(!("riskText" in lateDive), "card profiles should not expose risk labels");

  const overpass = Sim.cardProfile(Sim.CARD_LIBRARY.overpass);
  assert.strictEqual(overpass.playable, true);
  assert.strictEqual(overpass.functionAccess, "allowed");
}

function testApplyTurnCanUseProviderExpression() {
  const command = "只打B2，安全高抛越塔，别误伤队友。";
  const state = Sim.createInitialState({ seed: 7351 });
  const selected = Sim.listLegalShots(state, "A1", command)[0];
  assert.ok(selected && selected.expression, "test needs a generated expression to replay");

  Sim.applyTurn(state, { A1: command }, {
    targetId: selected.targetId,
    expression: selected.expression,
    cardSlots: selected.cards.map((card) => card.slot),
    providerReason: "Provider wrote its own function."
  });
  const event = state.events[0];
  assert.strictEqual(event.targetId, selected.targetId);
  assert.strictEqual(event.expression, `y=${Sim._internals.normalizeShotExpression(selected.expression)}`);
  assert.ok(state.paths[0].points.length > 10, "provider expression should be sampled into a replay path");
  assert.strictEqual(event.thinking.providerReason, "Provider wrote its own function.");
}

function testProviderExpressionCanUseEveryCurrentHandFunction() {
  const state = Sim.createInitialState({ seed: 1 });
  const hand = Sim.getCurrentHand(state, "A1");

  Sim.applyTurn(state, { A1: "raw function shot" }, {
    targetId: "B1",
    expression: "y=y0+dy*t+8*max(0,1-abs(t-0.62)/0.22)+4*silu(4*(t-0.5))+3*t*(1-t)/(0.12+abs(t-0.5))",
    cardSlots: [1, 2, 3, 4],
    providerReason: "Provider used the whole current function set."
  });
  const event = state.events[0];
  assert.notStrictEqual(event.result, "invalid", "using all current hand function types should be legal");
  assert.deepStrictEqual(event.usedCardIds, hand.map((card) => card.instanceId), "all current hand slots should be accepted");
}

function openDamageState(seed) {
  const state = Sim.createInitialState({ seed });
  state.obstacles = [];
  state.bonusPoints = [];
  const units = {
    A1: { x: 20, y: 20 },
    A2: { x: 20, y: 8 },
    B1: { x: 60, y: 20 },
    B2: { x: 70, y: 8 }
  };
  state.units = state.units.map((unit) => ({
    ...unit,
    x: units[unit.id].x,
    y: units[unit.id].y,
    hp: 100
  }));
  return state;
}

function testDamageVariesByHitQualityAndFunctionCombo() {
  const baseline = openDamageState(10);
  Sim.applyTurn(baseline, { A1: "" }, {
    targetId: "B1",
    expression: "y=y0+dy*t",
    cardSlots: [],
    providerReason: "baseline line"
  });
  const baselineDamage = baseline.events[0].damage;

  const boosted = openDamageState(10);
  boosted.bonusPoints = [{ id: "route-bonus-test", x: 40, y: 20, radius: 2, value: 12 }];
  Sim.applyTurn(boosted, { A1: "" }, {
    targetId: "B1",
    expression: "y=y0+dy*t+0*sin(pi*t)+0*exp(-((t-0.50)^2)/(2*0.18^2))",
    cardSlots: [1, 3],
    providerReason: "same hit with function commitment and route bonus"
  });
  const boostedDamage = boosted.events[0].damage;

  assert.ok(baselineDamage > 0, "baseline hit should deal damage");
  assert.notStrictEqual(baselineDamage, 46, "damage should not be the old fixed three-shot value");
  assert.ok(boostedDamage > baselineDamage, "route bonus and current-hand function commitment should increase damage");
}

function testHitEventsExposeProximityAccuracy() {
  const state = openDamageState(10);
  Sim.applyTurn(state, { A1: "" }, {
    targetId: "B1",
    expression: "y=y0+dy*t",
    cardSlots: [],
    providerReason: "direct center hit"
  });
  const event = state.events[0];
  assert.strictEqual(event.result, "hitEnemy", "test setup should hit the enemy");
  assert.strictEqual(event.hitDistance, 0, "center hits should expose zero hit distance");
  assert.strictEqual(event.proximityAccuracy, 1, "center hits should expose max proximity accuracy");
}

function testProviderExpressionsNormalizeCommonModelSyntax() {
  const state = Sim.createInitialState({ seed: 7351 });
  Sim.applyTurn(state, { A1: "write a smooth line" }, {
    targetId: "B1",
    expression: "y = y0 + dy*t + 4*sin(pi*t); t = u/d; d = abs(target.x-shooter.x)",
    cardSlots: [1],
    providerReason: "Model used explanatory assignments."
  });
  const event = state.events[0];
  assert.notStrictEqual(event.result, "invalid", "common trailing assignments should not make a provider expression invalid");
  assert.strictEqual(
    event.expression,
    "y=y0 + dy*t + 4*sin(pi*t)",
    "stored expression should keep only the executable y expression"
  );

  const whereState = Sim.createInitialState({ seed: 7351 });
  Sim.applyTurn(whereState, { A1: "write a smooth line" }, {
    targetId: "B1",
    expression: "y = y0 + dy*t + 3*sin(pi*t) where t = u/d",
    cardSlots: [1],
    providerReason: "Model used where clause."
  });
  assert.notStrictEqual(whereState.events[0].result, "invalid", "where clauses should be trimmed from provider expressions");
  assert.strictEqual(whereState.events[0].expression, "y=y0 + dy*t + 3*sin(pi*t)");
}

function testRicherCardCatalog() {
  const cards = Object.values(Sim.CARD_LIBRARY);
  assert.ok(cards.length >= 28, "card catalog should contain a broader mathematical function pool");
  const families = new Set(cards.map((card) => card.family));
  for (const family of ["lift", "bend", "wave", "control", "modifier"]) {
    assert.ok(families.has(family), `card catalog should include ${family}`);
  }
  assert.ok(!families.has("risk"), "card catalog should not expose a risk function family");
  assert.ok(cards.every((card) => Array.isArray(card.tags) && card.tags.length > 0), "cards should have tags");
  assert.ok(cards.every((card) => Array.isArray(card.amplitudes) && card.amplitudes.length > 0), "cards should have amplitudes");
  const labels = cards.map((card) => card.label);
  assert.strictEqual(new Set(labels).size, labels.length, "public card labels should not duplicate the same function template");
  for (const fragment of ["sigmoid", "tanh", "softplus", "GELU", "SiLU", "exp(-", "cos(", "log1p"]) {
    assert.ok(labels.some((label) => label.includes(fragment)), `card catalog should include ${fragment}`);
  }
  for (const card of cards) {
    assert.doesNotThrow(
      () => Sim._internals.compileShotExpression(`y=y0+dy*t+(${card.label})`),
      `card label should compile when copied by a model: ${card.label}`
    );
  }
}

function testCardLabelsReadLikeFunctionNames() {
  const forbiddenNames = [
    "Parabola",
    "Low Parabola",
    "High Parabola",
    "Tower Parabola",
    "Abs Bend",
    "Sharp Abs",
    "Step Hook",
    "Sine Wave",
    "Double Sine",
    "Small Sine",
    "Unstable Sine",
    "Cubic",
    "Clamp",
    "Shelf",
    "Late Dive",
    "Boost Arc",
    "Spike",
    "Anchor",
    "Hook",
    "Mortar Spike",
    "Glide Line"
  ];
  const labels = Object.values(Sim.CARD_LIBRARY).map((card) => card.label);
  for (const name of forbiddenNames) {
    assert.ok(!labels.includes(name), `card labels should use mathematical functions instead of ${name}`);
  }
  assert.strictEqual(Sim.CARD_LIBRARY.arc.label, "4*t*(1-t)");
  assert.strictEqual(Sim.CARD_LIBRARY.bend.label, "1-abs(2*t-1)");
  assert.strictEqual(Sim.CARD_LIBRARY.wave.label, "sin(pi*t)");
  assert.strictEqual(Sim.CARD_LIBRARY.needle.label, "max(0,1-abs(t-0.62)/0.22)");
}

function testShotExpressionsUseExpandedMathFunctions() {
  const state = Sim.createInitialState({ seed: 7351 });
  const shots = Sim.listLegalShots(state, "A1", "high sine bend target B2");
  assert.ok(shots.length > 0, "legal shots should be available");
  const expressionText = shots.map((shot) => shot.expression).join("\n");
  assert.ok(expressionText.includes("t=(u/d)"), "shot expression should define the normalized variable");
  assert.ok(!/\b(arc|bend|hook|ripple|cubic|dive|spike|shelf)\(u\/d\)/.test(expressionText), "shot expressions should not expose private helper aliases");
  assert.ok(
    shots.some((shot) => shot.cards.some((card) => /sin|abs|max|t/.test(card.label))),
    "candidate cards should expose mathematical labels to models and players"
  );
}

function testCompactHandsStillGuaranteeShapeChoices() {
  assert.strictEqual(Sim.CONFIG.handSize, 4, "each turn should show a tighter four-card hand");
  for (let seed = 1; seed <= 24; seed += 1) {
    for (let turn = 0; turn < 8; turn += 1) {
      for (const team of ["A", "B"]) {
        const hand = Sim.dealHand(seed, turn, team);
        const shapeCount = hand.filter((card) => card.family !== "modifier").length;
        assert.strictEqual(hand.length, 4, "hand should have exactly four cards");
        assert.ok(shapeCount >= 2, "hand should preserve at least two non-modifier function families");
      }
    }
  }
}

function testHandsPersistAndCanBeSwappedThreeTimes() {
  const state = Sim.createInitialState({ seed: 8811 });
  const firstHand = Sim.getCurrentHand(state, "A1").map((card) => card.instanceId);
  const teammateHand = Sim.getCurrentHand(state, "A2").map((card) => card.instanceId);
  Sim.applyTurn(state, { A: "", B: "" });
  assert.deepStrictEqual(
    Sim.getCurrentHand(state, "A1").map((card) => card.instanceId),
    firstHand,
    "shooting should not discard the active unit's hand"
  );
  assert.deepStrictEqual(
    Sim.getCurrentHand(state, "A2").map((card) => card.instanceId),
    teammateHand,
    "teammate AI should retain its own independent hand"
  );

  const swapState = Sim.createInitialState({ seed: 8811 });
  const swapFirstHand = Sim.getCurrentHand(swapState, "A1").map((card) => card.instanceId);
  const swapTeammateHand = Sim.getCurrentHand(swapState, "A2").map((card) => card.instanceId);
  const firstSwap = Sim.applyTurn(swapState, {}, { action: "swap_hand" });
  assert.strictEqual(firstSwap.action, "swap_hand");
  assert.strictEqual(firstSwap.owner, "A1");
  assert.strictEqual(firstSwap.swapsUsed, 1);
  assert.strictEqual(swapState.turn, 0, "swap_hand should not consume the active turn");
  assert.notDeepStrictEqual(
    Sim.getCurrentHand(swapState, "A1").map((card) => card.instanceId),
    swapFirstHand,
    "swap_hand should replace the retained hand"
  );
  assert.deepStrictEqual(
    Sim.getCurrentHand(swapState, "A2").map((card) => card.instanceId),
    swapTeammateHand,
    "swap_hand should not change the teammate's hand"
  );
  Sim.swapHand(swapState, "A1");
  Sim.swapHand(swapState, "A1");
  assert.throws(() => Sim.swapHand(swapState, "A1"), /swap_limit_reached/);
}

function testSeededHardMapGeneration() {
  const first = Sim.createInitialState({ seed: 9001 });
  const second = Sim.createInitialState({ seed: 9001 });
  const different = Sim.createInitialState({ seed: 9002 });
  assert.deepStrictEqual(first.obstacles, second.obstacles, "same seed should produce same map");
  assert.notDeepStrictEqual(first.obstacles, different.obstacles, "different seeds should produce different maps");
  assert.ok(first.mapMeta && first.mapMeta.difficulty >= 68 && first.mapMeta.difficulty <= 86, "map should include moderated difficulty metadata");
  assert.strictEqual(first.mapMeta.windows, undefined, "map should not expose route windows");
  assert.ok(first.mapMeta.complexity, "map should expose a bare complexity summary for the UI");
  assert.strictEqual(first.mapMeta.complexity.generator, "poisson-blob-search", "map should use the Poisson blob search generator");
  assert.ok(first.mapMeta.complexity.poissonAnchorCount >= 5, "map should expose enough Poisson-distributed blob anchors");
  assert.ok(Number.isFinite(first.mapMeta.complexity.candidateFitness), "map should expose the accepted generator fitness");
  assert.strictEqual(first.obstacles.length, 6, "map should use six readable blob blockers");
  assert.ok(first.obstacles.every((obstacle) => obstacle.shape === "circle"), "all blockers should be continuous circular blobs");
  assert.ok(first.obstacles.every((obstacle) => obstacle.solid === true), "all visible blockers should be real solid terrain");
  assert.ok(first.obstacles.every((obstacle) => Number.isFinite(obstacle.cx) && Number.isFinite(obstacle.cy) && obstacle.r > 0), "blob blockers should expose circle geometry");
  assert.strictEqual(first.mapMeta.complexity.blobCount, 6, "complexity summary should count token-light blob blockers");
  assert.ok(first.mapMeta.complexity.clusterCount >= 2, "complexity summary should count terrain clusters");
  assert.ok(first.mapMeta.complexity.openLaneCount >= 3, "complexity summary should keep multiple open firing lanes");
  assert.strictEqual(first.mapMeta.complexity.routeGuideCount, 0, "maps should not reintroduce pass-through route-guide clutter");
  assert.ok(Array.isArray(first.bonusPoints) && first.bonusPoints.length === 3, "map should expose a small set of route bonus points");
  assert.ok(first.bonusPoints.every((point) => point.radius <= 2.2), "route bonus points should use tight scoring radii");
  for (const point of first.bonusPoints) {
    assert.ok(point.y > Sim.groundY(point.x) + point.radius + 2, "route bonus points should stay above solid ground");
    for (const obstacle of first.obstacles) {
      const distance = Math.hypot(point.x - obstacle.cx, point.y - obstacle.cy);
      assert.ok(
        distance > obstacle.r + point.radius + 1.8,
        `route bonus point ${point.id} should not overlap blocker ${obstacle.id}`
      );
    }
  }
  assert.ok(first.mapMeta.complexity.bonusPointCount === first.bonusPoints.length, "map summary should count route bonus points");
  assert.ok(first.units.every((unit) => unit.y > Sim.groundY(unit.x)), "units should spawn above ground");
}

function testHardMapsRemainSolvableByFiniteCardCombos() {
  for (let seed = 1; seed <= 40; seed += 1) {
    const state = Sim.createInitialState({ seed });
    assert.ok(state.mapMeta.complexity.blobCount >= 6, `seed ${seed} should keep enough continuous blockers`);
    assert.strictEqual(state.mapMeta.complexity.blobCount, 6, `seed ${seed} should keep blocker count at six`);
    assert.ok(state.mapMeta.complexity.clusterCount >= 2, `seed ${seed} should keep multiple terrain clusters`);
    assert.ok(state.mapMeta.complexity.openLaneCount >= 3, `seed ${seed} should keep readable open lanes`);
    assert.ok(state.mapMeta.complexity.routePressure >= 58 && state.mapMeta.complexity.routePressure <= 88, `seed ${seed} should keep moderate route pressure`);
    assert.ok(state.obstacles.every((obstacle) => obstacle.shape === "circle"), `seed ${seed} should not generate rectangular blockers`);
    assert.ok(state.bonusPoints.length === 3, `seed ${seed} should keep three readable scoring route points`);
    for (const point of state.bonusPoints) {
      assert.ok(point.radius <= 2.2, `seed ${seed} route point ${point.id} should have a tight scoring radius`);
      assert.ok(point.y > Sim.groundY(point.x) + point.radius + 2, `seed ${seed} route point ${point.id} should stay above ground`);
      for (const obstacle of state.obstacles) {
        assert.ok(
          Math.hypot(point.x - obstacle.cx, point.y - obstacle.cy) > obstacle.r + point.radius + 1.8,
          `seed ${seed} route point ${point.id} should not be inside blocker ${obstacle.id}`
        );
      }
    }
    for (const unitId of state.turnOrder) {
      const shots = Sim.listLegalShots(state, unitId, "");
      assert.ok(shots.length > 0, `seed ${seed} unit ${unitId} should have legal shots`);
      assert.ok(
        shots.some((shot) => !["invalid", "out"].includes(shot.result)),
        `seed ${seed} unit ${unitId} should have at least one bounded curve`
      );
      assert.ok(shots.every((shot) => shot.mapFit === undefined), "legal shots should not expose route-window fit");
    }
  }
}

function testHardMapsExposeSolverPressureWithoutBecomingImpossible() {
  let firstHandPressure = 0;
  let swapWindowPressure = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const state = Sim.createInitialState({ seed });
    const complexity = state.mapMeta.complexity;
    assert.ok(Number.isFinite(complexity.solidObstacleCount), `seed ${seed} should count solid blockers`);
    assert.ok(Number.isFinite(complexity.firstHandHitRate), `seed ${seed} should expose first-hand hit rate`);
    assert.ok(Number.isFinite(complexity.swapWindowHitRate), `seed ${seed} should expose swap-window hit rate`);
    assert.ok(Number.isFinite(complexity.solverPressure), `seed ${seed} should expose solver pressure`);
    assert.ok(Number.isFinite(complexity.requiredSearchWindows), `seed ${seed} should estimate required search windows`);
    assert.ok(complexity.solidObstacleCount >= 6, `seed ${seed} should still keep real blockers`);
    assert.strictEqual(complexity.solidObstacleCount, 6, `seed ${seed} should keep blocker count at six`);
    assert.strictEqual(complexity.routeGuideCount, 0, `seed ${seed} should not count route-guide overlays`);
    assert.ok(complexity.firstHandHitRate <= 1, `seed ${seed} should expose a normalized first-hand hit rate`);
    assert.ok(complexity.swapWindowHitRate >= complexity.firstHandHitRate, `seed ${seed} should reward model-led swap search`);
    assert.ok(complexity.swapWindowHitRate > 0, `seed ${seed} should remain solvable within retained-hand swap windows`);
    assert.ok(complexity.solverPressure >= 45, `seed ${seed} should present real solver pressure`);
    assert.ok(complexity.requiredSearchWindows >= 2, `seed ${seed} should usually need more than the first hand`);
    firstHandPressure += complexity.firstHandHitRate;
    swapWindowPressure += complexity.swapWindowHitRate;
  }
  assert.ok(firstHandPressure / 40 < 0.92, "average first-hand hit rate should stay readable without making every map trivial");
  assert.ok(swapWindowPressure / 40 >= 0.08, "average swap-window hit rate should prove the maps are not impossible");
}

function testCommercialMapsExposeTopologyNotJustBlockCount() {
  for (let seed = 1; seed <= 16; seed += 1) {
    const state = Sim.createInitialState({ seed });
    const complexity = state.mapMeta.complexity;
    assert.ok(complexity.obstacleCount >= 6, `seed ${seed} should feel like a Graphwar arena, not an empty board`);
    assert.strictEqual(complexity.obstacleCount, 6, `seed ${seed} should stay readable and token-light`);
    assert.ok(complexity.solidObstacleCount === complexity.obstacleCount, `seed ${seed} should only expose real solid blockers`);
    assert.ok(complexity.clusterCount >= 2, `seed ${seed} should expose multiple blob clusters`);
    assert.ok(complexity.openLaneCount >= 3, `seed ${seed} should preserve multiple path choices`);
    assert.ok(complexity.blobCoverage >= 0.07, `seed ${seed} should distribute blob terrain across the arena`);
    assert.ok(complexity.blobCoverage <= 0.32, `seed ${seed} should avoid overfilling the arena`);
    assert.ok(complexity.routePressure >= 54 && complexity.routePressure <= 82, `seed ${seed} should preserve moderate route pressure`);
    assert.ok(
      Array.isArray(complexity.topologyTags) && complexity.topologyTags.includes("continuous-blobs"),
      `seed ${seed} should label its continuous blob topology`
    );
  }
}

function testBlobMapsDoNotCollapseToHighArcOnly() {
  for (let seed = 1; seed <= 24; seed += 1) {
    const state = Sim.createInitialState({ seed });
    const complexity = state.mapMeta.complexity;
    assert.ok(Array.isArray(complexity.routeArchetypes), `seed ${seed} should expose projectile route archetypes`);
    assert.ok(complexity.routeArchetypes.length >= 3, `seed ${seed} should support at least three projectile route archetypes`);
    assert.ok(complexity.routeArchetypes.includes("high"), `seed ${seed} may still allow high routes`);
    assert.ok(complexity.routeArchetypes.includes("mid-pocket"), `seed ${seed} should include mid-board pocket routes`);
    assert.ok(complexity.routeArchetypes.includes("low-skim"), `seed ${seed} should include low skim routes`);
    assert.ok(complexity.routeArchetypes.includes("bonus-thread"), `seed ${seed} should include reward-point thread routes`);
    assert.ok(Number.isFinite(complexity.highArcDominance), `seed ${seed} should quantify high-arc dominance`);
    assert.ok(complexity.highArcDominance <= 0.55, `seed ${seed} should not be mostly solved by high arcs`);
    assert.ok(Number.isFinite(complexity.routeEntropy), `seed ${seed} should quantify route diversity`);
    assert.ok(complexity.routeEntropy >= 1.1, `seed ${seed} should have route diversity instead of one dominant lane`);
    assert.ok(complexity.requiredBendCount >= 1, `seed ${seed} should preserve at least one bend/thread decision`);
    assert.ok(complexity.bonusPointCount === 3, `seed ${seed} should keep a compact route scoring set`);
    assert.strictEqual(state.mapMeta.windows, undefined, "projectile maze maps should not revive route windows");
  }
}

function testRouteBonusPointsAffectShotScoring() {
  const state = Sim.createInitialState({ seed: 7351 });
  const forcedPoint = {
    id: "forced-route-bonus",
    x: state.units.find((unit) => unit.id === "A1").x + 1.1,
    y: state.units.find((unit) => unit.id === "A1").y,
    radius: 4,
    value: 18
  };
  state.bonusPoints = [forcedPoint];
  Sim.applyTurn(state, { A: "low direct bonus point route", B: "" });
  const event = state.events[0];
  assert.ok(event.routeBonus && event.routeBonus.value >= forcedPoint.value, "shot event should score route bonus points it passes through");
  assert.ok(event.routeBonus.pointIds.includes(forcedPoint.id), "shot event should identify scored route bonus points");
  assert.ok(state.paths[0].routeBonus.value === event.routeBonus.value, "replay path should preserve route bonus scoring");
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

testGlobalActionCapIsTwentyFour();
testDeterministicBattle();
testBattleDoesNotDrawFromTurnLimit();
testStandingOrdersStayLockedDuringAutoBattle();
testTurnsRotateAcrossFourUnitSeats();
testNoInvalidState();
testResourceValidation();
testProviderExpressionIsLimitedToCurrentHandFunctionTypes();
testCommandParsing();
testHardTargetConstraintChangesShotChoice();
testUnavailableHardTargetUsesLiveTarget();
  testSafeCommandAvoidsAllyHitsWithoutFunctionBans();
  testLegalShotsHonorSafeConstraints();
testShotEventsExposeCardComboIdentity();
testLegalShotsExposeCardComboIdentity();
testHandAnalysisSummarizesTacticalRead();
testCardProfilesExposeTacticalCardRoles();
testApplyTurnCanUseProviderExpression();
testProviderExpressionCanUseEveryCurrentHandFunction();
testDamageVariesByHitQualityAndFunctionCombo();
testHitEventsExposeProximityAccuracy();
testProviderExpressionsNormalizeCommonModelSyntax();
testRicherCardCatalog();
  testCardLabelsReadLikeFunctionNames();
  testShotExpressionsUseExpandedMathFunctions();
  testCompactHandsStillGuaranteeShapeChoices();
  testHandsPersistAndCanBeSwappedThreeTimes();
  testSeededHardMapGeneration();
  testHardMapsRemainSolvableByFiniteCardCombos();
testHardMapsExposeSolverPressureWithoutBecomingImpossible();
testCommercialMapsExposeTopologyNotJustBlockCount();
testBlobMapsDoNotCollapseToHighArcOnly();
testRouteBonusPointsAffectShotScoring();
testTraceShapeIncludesMapAndScore();

console.log("sim-core tests passed");
