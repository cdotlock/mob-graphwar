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

function testStandingOrdersStayLockedDuringAutoBattle() {
  const lockedOrders = {
    A: "must target B2, high safe arc",
    B: "must target A2, high safe arc",
    A1: "must target B2, high safe arc",
    B1: "must target A2, high safe arc"
  };
  const midDuelEdit = {
    A: "ignore B2, use volatile",
    B: "must target A1, low risky direct shot",
    A1: "ignore B2, use volatile",
    B1: "must target A1, low risky direct shot"
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

function testInvalidProviderCandidateDoesNotAdvanceTurn() {
  const state = Sim.createInitialState({ seed: 7351 });
  assert.throws(
    () => Sim.applyTurn(state, { A: "must target B2, high safe arc", B: "must target A2, high safe arc" }, { candidateId: "missing" }),
    /unknown_candidate/
  );
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
  Sim.applyTurn(state, { A1: "must target B2, high safe arc" });
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
  Sim.applyTurn(state, { A1: "must target B2, high safe arc" });
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
  Sim.applyTurn(state, { A1: "只打B2，安全高抛越塔，禁用冒险牌，别误伤队友。" });
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
  const shots = Sim.listLegalShots(state, "A1", command);
  const selected = shots.find((shot) => shot.expression !== shots[0].expression) || shots[1];
  assert.ok(selected && selected.candidateId, "legal shots should expose candidate ids");

  Sim.applyTurn(state, { A1: command }, { candidateId: selected.candidateId, providerReason: "Provider picked a stable legal shot." });
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

function testHandsPersistAndCanBeRerolledThreeTimes() {
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
  const firstReroll = Sim.applyTurn(swapState, {}, { action: "swap_hand" });
  assert.strictEqual(firstReroll.action, "swap_hand");
  assert.strictEqual(firstReroll.owner, "A1");
  assert.strictEqual(firstReroll.rerollsUsed, 1);
  assert.strictEqual(firstReroll.swapsUsed, 1);
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
  Sim.rerollHand(swapState, "A1");
  Sim.rerollHand(swapState, "A1");
  assert.throws(() => Sim.rerollHand(swapState, "A1"), /reroll_limit_reached/);
}

function testSeededHardMapGeneration() {
  const first = Sim.createInitialState({ seed: 9001 });
  const second = Sim.createInitialState({ seed: 9001 });
  const different = Sim.createInitialState({ seed: 9002 });
  assert.deepStrictEqual(first.obstacles, second.obstacles, "same seed should produce same map");
  assert.notDeepStrictEqual(first.obstacles, different.obstacles, "different seeds should produce different maps");
  assert.ok(first.mapMeta && first.mapMeta.difficulty >= 90, "map should include high difficulty metadata");
  assert.strictEqual(first.mapMeta.windows, undefined, "map should not expose route windows");
  assert.ok(first.mapMeta.complexity, "map should expose a bare complexity summary for the UI");
  assert.strictEqual(first.mapMeta.complexity.generator, "poisson-blob-search", "map should use the Poisson blob search generator");
  assert.ok(first.mapMeta.complexity.poissonAnchorCount >= 6, "map should expose enough Poisson-distributed blob anchors");
  assert.ok(Number.isFinite(first.mapMeta.complexity.candidateFitness), "map should expose the accepted generator fitness");
  assert.ok(first.obstacles.length >= 16 && first.obstacles.length <= 34, "map should use readable blob terrain instead of a wall of blocks");
  assert.ok(first.obstacles.every((obstacle) => obstacle.shape === "circle"), "all blockers should be continuous circular blobs");
  assert.ok(first.obstacles.every((obstacle) => obstacle.solid === true), "all visible blockers should be real solid terrain");
  assert.ok(first.obstacles.every((obstacle) => Number.isFinite(obstacle.cx) && Number.isFinite(obstacle.cy) && obstacle.r > 0), "blob blockers should expose circle geometry");
  assert.ok(first.mapMeta.complexity.blobCount >= 16, "complexity summary should count blob blockers");
  assert.ok(first.mapMeta.complexity.clusterCount >= 4, "complexity summary should count terrain clusters");
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
    assert.ok(state.mapMeta.complexity.blobCount >= 16, `seed ${seed} should keep enough continuous blockers`);
    assert.ok(state.mapMeta.complexity.clusterCount >= 4, `seed ${seed} should keep multiple terrain clusters`);
    assert.ok(state.mapMeta.complexity.openLaneCount >= 3, `seed ${seed} should keep readable open lanes`);
    assert.ok(state.mapMeta.complexity.routePressure >= 80, `seed ${seed} should keep route pressure high`);
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
    assert.ok(complexity.solidObstacleCount >= 16, `seed ${seed} should still keep many real blockers`);
    assert.strictEqual(complexity.routeGuideCount, 0, `seed ${seed} should not count route-guide overlays`);
    assert.ok(complexity.firstHandHitRate <= 0.5, `seed ${seed} should not be solved too often by the first hand`);
    assert.ok(complexity.swapWindowHitRate >= complexity.firstHandHitRate, `seed ${seed} should reward model-led swap search`);
    assert.ok(complexity.swapWindowHitRate > 0, `seed ${seed} should remain solvable within retained-hand swap windows`);
    assert.ok(complexity.solverPressure >= 65, `seed ${seed} should present real solver pressure`);
    assert.ok(complexity.requiredSearchWindows >= 2, `seed ${seed} should usually need more than the first hand`);
    firstHandPressure += complexity.firstHandHitRate;
    swapWindowPressure += complexity.swapWindowHitRate;
  }
  assert.ok(firstHandPressure / 40 < 0.22, "average first-hand hit rate should stay low across seeded maps");
  assert.ok(swapWindowPressure / 40 >= 0.08, "average swap-window hit rate should prove the maps are not impossible");
}

function testCommercialMapsExposeTopologyNotJustBlockCount() {
  for (let seed = 1; seed <= 16; seed += 1) {
    const state = Sim.createInitialState({ seed });
    const complexity = state.mapMeta.complexity;
    assert.ok(complexity.obstacleCount >= 16, `seed ${seed} should feel like a Graphwar arena, not an empty board`);
    assert.ok(complexity.obstacleCount <= 34, `seed ${seed} should stay readable instead of piling on block clutter`);
    assert.ok(complexity.solidObstacleCount === complexity.obstacleCount, `seed ${seed} should only expose real solid blockers`);
    assert.ok(complexity.clusterCount >= 4, `seed ${seed} should expose multiple blob clusters`);
    assert.ok(complexity.openLaneCount >= 3, `seed ${seed} should preserve multiple path choices`);
    assert.ok(complexity.blobCoverage >= 0.16, `seed ${seed} should distribute blob terrain across the arena`);
    assert.ok(complexity.routePressure >= 95, `seed ${seed} should preserve high route pressure`);
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
    assert.ok(complexity.requiredBendCount >= 2, `seed ${seed} should require bend/thread decisions`);
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

testDeterministicBattle();
testStandingOrdersStayLockedDuringAutoBattle();
testTurnsRotateAcrossFourUnitSeats();
testInvalidProviderCandidateDoesNotAdvanceTurn();
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
  testHandsPersistAndCanBeRerolledThreeTimes();
  testSeededHardMapGeneration();
  testHardMapsRemainSolvableByFiniteCardCombos();
testHardMapsExposeSolverPressureWithoutBecomingImpossible();
testCommercialMapsExposeTopologyNotJustBlockCount();
testBlobMapsDoNotCollapseToHighArcOnly();
testRouteBonusPointsAffectShotScoring();
testTraceShapeIncludesMapAndScore();

console.log("sim-core tests passed");
