const assert = require("assert");
const Sim = require("../src/sim-core.js");
const Contract = require("../src/agents/contract.js");

function hasStandaloneAmplitudeVariable(text) {
  return /(^|[^A-Za-z0-9_])a([^A-Za-z0-9_]|$)/.test(String(text || ""));
}

function openFeedbackState(seed = 10) {
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

function testRulesPayloadIsBareGameStateAndLegalActions() {
  const state = Sim.createInitialState({ seed: 7351 });
  const payload = Contract.buildRulesPayload(state, "A1", "human prompt only");
  const serialized = JSON.stringify(payload);
  assert.strictEqual(payload.objective, "eliminate opposing team while avoiding allied units");
  assert.strictEqual(payload.team, "A");
  assert.strictEqual(payload.activeUnitId, "A1");
  assert.strictEqual(payload.controlledUnit.id, "A1");
  assert.strictEqual(payload.hand.owner, "A1");
  assert.ok(payload.allyIds.includes("A2"), "payload should identify allies");
  assert.ok(payload.opponentIds.includes("B1") && payload.opponentIds.includes("B2"), "payload should identify opponents");
  assert.ok(payload.hand.cards.length === Sim.CONFIG.handSize, "payload should include the retained current hand");
  assert.strictEqual(payload.hand.retained, true, "payload should tell providers that hands persist");
  assert.strictEqual(payload.hand.swapsUsed, 0, "payload should expose active-turn swap usage");
  assert.strictEqual(payload.hand.swapsRemaining, Sim.CONFIG.maxSwapsPerTurn, "payload should expose remaining hand swaps");
  assert.ok(Array.isArray(payload.hand.availableFunctionTypes), "payload should expose the current hand function whitelist");
  assert.ok(payload.rules.functionHand.includes("function whitelist"), "rules should describe the function whitelist");
  assert.ok(payload.rules.expressionFunctions.includes("availableFunctionTypes"), "rules should bind expressions to current hand functions");
  assert.ok(payload.rules.expressionCoordinate.includes("absolute board y"), "rules should state that y is the absolute board coordinate");
  assert.ok(payload.rules.expressionCoordinate.includes("y0+dy*t"), "rules should tell models to anchor shots on the shooter-target baseline");
  assert.ok(payload.rules.functionScaling.includes("free numeric coefficients"), "rules should clarify that function cards are types, not fixed amplitudes");
  assert.ok(payload.rules.damageModel.includes("proximityAccuracy"), "rules should explain close hits as proximity accuracy");
  assert.ok(payload.rules.precisionMeaning.includes("precisionBonus"), "rules should explain precision metadata");
  assert.ok(payload.hand.cards.every((card) => card.effect && Number.isFinite(card.effect.precisionBonus)), "hand cards should expose numeric precision metadata");
  assert.ok(!serialized.includes("high-risk"), "provider payload should not expose high-risk function concepts");
  assert.ok(!serialized.includes("high-damage"), "provider payload should not expose high-damage function concepts");
  assert.ok(!serialized.includes("damageBonus"), "provider payload should not expose function damage bonuses");
  assert.ok(!serialized.includes("volatility"), "provider payload should not expose function volatility");
  assert.ok(!serialized.includes('"risk"'), "provider payload should not expose function risk labels");
  assert.ok(payload.legalActions.some((action) => action.action === "swap_hand"), "payload should include swap_hand as a legal model action");
  assert.ok(payload.legalActions.some((action) => action.action === "shot"), "payload should include shot as a legal model action");
  assert.ok(payload.rules.handRetention.includes("persist"), "rules should describe retained hands");
  assert.ok(payload.rules.actionLimit.includes("swap_hand"), "rules should use the public swap_hand action");
  assert.ok(!serialized.includes("score"), "payload should not expose local scoring");
  assert.ok(!serialized.includes("hitEnemy"), "payload should not expose simulated outcomes");
  assert.ok(!serialized.includes("energy"), "payload should not expose removed energy rules");
  assert.ok(!serialized.includes("cost"), "payload should not expose removed cost rules");
  assert.ok(!serialized.includes("card-count"), "payload should not expose removed card-count rules");
  assert.ok(!serialized.includes("shape card"), "payload should not expose removed shape-card limits");
  assert.ok(!serialized.includes("modifier max"), "payload should not expose removed modifier limits");
}

function testRulesPayloadUsesMathExpressionsInsteadOfInternalCardNames() {
  const state = Sim.createInitialState({ seed: 7351 });
  const payload = Contract.buildRulesPayload(state, "A1", "hit B2 high");
  const publicCardText = JSON.stringify({
    hand: payload.hand.cards,
    shots: payload.legalActions.filter((action) => action.action === "shot").map((action) => ({
      cards: action.cards
    }))
  });
  for (const internalName of ["arc", "low_lob", "sky_hook", "overpass", "needle", "prism", "mortar"]) {
    assert.ok(!publicCardText.includes(internalName), `provider payload should not expose internal card id ${internalName}`);
  }
  assert.ok(
    payload.hand.cards.every((card) => typeof card.function === "string" && card.function.includes("t")),
    "hand cards should expose math function expressions"
  );
  assert.ok(
    payload.hand.cards.every((card) => !hasStandaloneAmplitudeVariable(card.function)),
    "hand cards should not expose internal amplitude variable a"
  );
  for (const card of payload.hand.cards) {
    assert.doesNotThrow(
      () => Sim._internals.compileShotExpression(`y=y0+dy*t+(${card.function})`),
      `public card function should compile without hidden variables: ${card.function}`
    );
  }
  const shotAction = payload.legalActions.find((action) => action.action === "shot");
  assert.ok(shotAction.output.expression.includes("absolute board y expression"), "shot action should ask the model to write absolute board-y math");
  assert.ok(shotAction.output.expression.includes("y0+dy*t"), "shot action should remind the model to use the shooter-target baseline");
  assert.ok(shotAction.output.expression.includes("Do not use a"), "shot output should explicitly reject internal amplitude placeholders");
}

function testRulesPayloadDoesNotExposeShotCandidates() {
  const state = Sim.createInitialState({ seed: 7351 });
  const payload = Contract.buildRulesPayload(state, "A1", "hit B2 high");
  const serialized = JSON.stringify(payload);
  assert.ok(payload.legalActions.some((action) => action.action === "shot"), "payload should still expose the shot action");
  assert.ok(payload.legalActions.some((action) => action.action === "swap_hand"), "payload should still expose swap_hand");
  assert.ok(!serialized.includes("candidateId"), "model prompt should not include precomputed shot candidates");
  const shotAction = payload.legalActions.find((action) => action.action === "shot");
  assert.deepStrictEqual(shotAction.allowedTargetIds.sort(), ["B1", "B2"], "shot action should list target ids, not candidate ids");
  assert.ok(shotAction.output.expression.includes("y="), "shot action should tell the model to write an expression");
}

function testRulesPayloadIncludesRecentShotFeedback() {
  const state = openFeedbackState();
  Sim.applyTurn(state, { A1: "direct center line target B1" }, {
    targetId: "B1",
    expression: "y=y0+dy*t",
    cardSlots: [],
    providerReason: "probe line"
  });
  const payload = Contract.buildRulesPayload(state, "B1", "adjust from the last collision");
  assert.ok(Array.isArray(payload.recentFeedback), "provider payload should include recent replay feedback");
  assert.ok(payload.recentFeedback.length > 0, "recent feedback should include previous shots");
  const latest = payload.recentFeedback[payload.recentFeedback.length - 1];
  assert.strictEqual(latest.expression, "y=y0+dy*t");
  assert.ok(latest.result, "recent feedback should include the shot result");
  assert.ok("collisionPoint" in latest, "recent feedback should include collision point data even when null");
  assert.ok("closestTargetDistance" in latest, "recent feedback should include miss distance");
  assert.strictEqual(latest.hitDistance, 0, "recent feedback should expose exact hit distance for close hits");
  assert.strictEqual(latest.proximityAccuracy, 1, "recent feedback should expose exact close-hit accuracy");
  assert.ok(JSON.stringify(payload).includes("If recentFeedback shows repeated ground shots"), "rules should tell the model how to use feedback");
  assert.ok(JSON.stringify(payload).includes("blocked shots"), "rules should tell the model how to respond to obstacle collisions");
  assert.ok(JSON.stringify(payload).includes("hitAlly"), "rules should tell the model not to repeat friendly-fire paths");
  assert.ok(JSON.stringify(payload).includes("swap_hand"), "rules should remind models that hand swaps are available");
}

function testRulesPayloadIncludesOwnRecentFeedback() {
  const state = Sim.createInitialState({ seed: 7351 });
  Sim.applyTurn(state, { A1: "safe high arc target B1" }, {
    targetId: "B1",
    expression: "y=y0+dy*t",
    cardSlots: [],
    providerReason: "probe line"
  });
  Sim.applyTurn(state, { B1: "safe high arc target A1" }, {
    targetId: "A1",
    expression: "y=y0+dy*t",
    cardSlots: [],
    providerReason: "probe line"
  });
  const payload = Contract.buildRulesPayload(state, "A1", "adjust from my last shot");
  assert.ok(Array.isArray(payload.ownRecentFeedback), "provider payload should include active unit feedback");
  assert.ok(payload.ownRecentFeedback.length > 0, "active unit feedback should include the unit's previous shots");
  assert.ok(payload.ownRecentFeedback.every((event) => event.unitId === "A1"), "ownRecentFeedback should be filtered to the active unit");
  assert.ok(JSON.stringify(payload).includes("Do not repeat the exact same failed expression"), "rules should forbid exact failed repeats");
}

function testDecisionValidation() {
  const state = Sim.createInitialState({ seed: 7351 });
  const payload = Contract.buildRulesPayload(state, "A1", "hit B2 high");
  const validExpression = Contract.validateAgentDecision(
    {
      action: "shot",
      targetId: "B2",
      expression: "y=y0+dy*t+12*sin(pi*t)",
      cardSlots: [1],
      publicReason: "High arc."
    },
    payload.legalActions
  );
  assert.strictEqual(validExpression.ok, true);
  assert.strictEqual(validExpression.action, "shot");
  assert.strictEqual(validExpression.expression, "y=y0+dy*t+12*sin(pi*t)");

  const swap = Contract.validateAgentDecision({ action: "swap_hand", publicReason: "Need a better hand." }, payload.legalActions);
  assert.strictEqual(swap.ok, true);
  assert.strictEqual(swap.action, "swap_hand");

  const noSwap = Contract.validateAgentDecision(
    { action: "swap_hand", publicReason: "Need a better hand." },
    payload.legalActions.filter((action) => action.action !== "swap_hand")
  );
  assert.strictEqual(noSwap.ok, false);
  assert.strictEqual(noSwap.reason, "swap_limit_reached");

  const invalid = Contract.validateAgentDecision({ candidateId: "missing", publicReason: "Nope." }, payload.legalActions);
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.reason, "missing_expression");
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

testRulesPayloadIsBareGameStateAndLegalActions();
testRulesPayloadUsesMathExpressionsInsteadOfInternalCardNames();
testRulesPayloadDoesNotExposeShotCandidates();
testRulesPayloadIncludesRecentShotFeedback();
testRulesPayloadIncludesOwnRecentFeedback();
testDecisionValidation();
testSecretRedaction();

console.log("agent-contract tests passed");
