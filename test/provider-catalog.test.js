const assert = require("assert");
const { listProviders, getProvider } = require("../server/providers/catalog.js");
const { normalizeProviderDecision } = require("../server/providers/normalize.js");
const { buildOpenAICompatibleRequest } = require("../server/providers/openai-compatible.js");
const { buildAnthropicRequest } = require("../server/providers/anthropic.js");
const Sim = require("../src/sim-core.js");
const Contract = require("../src/agents/contract.js");
const fs = require("fs");
const path = require("path");

function testProviderCatalogRedactsKeys() {
  const providers = listProviders({ OPENAI_API_KEY: "sk-test", DEEPSEEK_API_KEY: "", OPENROUTER_API_KEY: "sk-router" });
  const openai = providers.find((provider) => provider.id === "openai");
  const openrouter = providers.find((provider) => provider.id === "openrouter");
  assert.ok(openai.available, "OpenAI should be marked available when env key exists");
  assert.ok(openrouter.available, "OpenRouter should be marked available when env key exists");
  assert.strictEqual(openrouter.model, "openrouter/free", "OpenRouter should default to the free model router");
  assert.strictEqual(openai.apiKey, undefined, "catalog should never expose key");
  assert.ok(getProvider("deepseek"), "DeepSeek should be known");
  assert.ok(getProvider("openrouter"), "OpenRouter should be known");
  assert.strictEqual(getProvider("unknown"), null);
}

function testNormalizeDecision() {
  const decision = normalizeProviderDecision('{"candidateId":"A-1","publicReason":"<think>x</think>Use high arc."}');
  assert.deepStrictEqual(decision, { action: "shot", candidateId: "A-1", publicReason: "Use high arc." });
  assert.deepStrictEqual(normalizeProviderDecision('{"action":"swap_hand","publicReason":"Need a different hand."}'), {
    action: "swap_hand",
    candidateId: undefined,
    publicReason: "Need a different hand."
  });
  assert.deepStrictEqual(normalizeProviderDecision('{"action":"reroll","publicReason":"Legacy action."}'), {
    action: "swap_hand",
    candidateId: undefined,
    publicReason: "Legacy action."
  });
  assert.throws(() => normalizeProviderDecision("not json"), /invalid_provider_json/);
}

function testDeepSeekUsesCurrentJsonModeDefaults() {
  const deepseek = getProvider("deepseek");
  assert.strictEqual(deepseek.defaultModel, "deepseek-v4-flash");

  const request = buildOpenAICompatibleRequest(
    deepseek,
    {
      command: "",
      candidates: [{ candidateId: "A-0-0-B2-arc", targetId: "B2" }],
      stateSummary: { seed: 7351, turn: 0, map: { name: "Basalt Gate" } }
    },
    "sk-redacted"
  );

  assert.deepStrictEqual(request.body.response_format, { type: "json_object" });
  assert.deepStrictEqual(request.body.thinking, { type: "disabled" });
  assert.ok(request.body.max_tokens > 0 && request.body.max_tokens <= 512, "JSON mode should cap output tokens");
  assert.strictEqual(request.body.messages.length, 1, "provider should receive only the bare rules packet as prompt content");
  assert.strictEqual(request.body.messages[0].role, "user");
  const userPayload = JSON.parse(request.body.messages[0].content);
  assert.ok(userPayload.rules.output.includes("JSON"), "bare rules should specify the required JSON output");
  assert.ok(userPayload.rules.actionLimit.includes("legal action"), "bare rules should describe the legal action contract");
  assert.ok(userPayload.rules.actionLimit.includes("swap_hand"), "bare rules should name the public hand swap action");
  assert.ok(userPayload.rules, "provider should receive bare rules");
  assert.ok(Array.isArray(userPayload.legalActions), "provider should receive legal actions");
  assert.ok(userPayload.legalActions.some((action) => action.action === "swap_hand"), "provider should be allowed to swap the retained hand");
  assert.ok(!userPayload.legalActions.some((action) => action.action === "reroll"), "provider legal actions should use swap_hand");
  assert.ok(!JSON.stringify(userPayload).includes("score"), "provider payload should not expose local scores");
  assert.ok(!JSON.stringify(userPayload).includes("hitEnemy"), "provider payload should not expose simulated hit outcomes");
}

function testOpenRouterUsesFreeJsonModeDefaults() {
  const openrouter = getProvider("openrouter");
  assert.strictEqual(openrouter.defaultModel, "openrouter/free");
  assert.strictEqual(openrouter.defaultBaseUrl, "https://openrouter.ai/api/v1");

  const request = buildOpenAICompatibleRequest(
    openrouter,
    {
      command: "thread the maze, swap if hand is weak",
      candidates: [{ candidateId: "B-0-0-A2-bend", targetId: "A2" }],
      stateSummary: { seed: 7351, turn: 0, map: { name: "Basalt Gate" } }
    },
    "sk-router"
  );

  assert.strictEqual(request.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.strictEqual(request.headers.authorization, "Bearer sk-router");
  assert.strictEqual(request.body.model, "openrouter/free");
  assert.deepStrictEqual(request.body.response_format, { type: "json_object" });
  assert.strictEqual(request.body.messages.length, 1, "OpenRouter should receive only the public rules payload");
  const userPayload = JSON.parse(request.body.messages[0].content);
  assert.ok(userPayload.legalActions.some((action) => action.action === "swap_hand"));
  assert.ok(userPayload.legalActions.some((action) => action.action === "shot"));
}

function testAnthropicUsesSameBareRulesPayload() {
  const anthropic = getProvider("anthropic");
  const state = Sim.createInitialState({ seed: 7351 });
  const rulesPayload = Contract.buildRulesPayload(state, "A", "thread the center");
  const request = buildAnthropicRequest(
    anthropic,
    {
      command: "thread the center",
      candidates: [{ candidateId: "legacy", targetId: "B2" }],
      stateSummary: { seed: 7351, turn: 0, map: { name: "legacy" } },
      rulesPayload,
      model: "claude-test"
    },
    "sk-redacted"
  );
  assert.strictEqual(request.body.model, "claude-test");
  assert.strictEqual(request.body.system, undefined, "Anthropic request should not add hidden prompt text outside the bare rules packet");
  assert.strictEqual(request.body.messages.length, 1, "Anthropic should receive only the bare rules packet as prompt content");
  const userPayload = JSON.parse(request.body.messages[0].content);
  assert.strictEqual(userPayload.command, "thread the center");
  assert.ok(userPayload.rules, "Anthropic should receive the shared bare rules payload");
  assert.ok(userPayload.rules.output.includes("JSON"), "bare Anthropic rules should specify the required JSON output");
  assert.ok(userPayload.rules.actionLimit.includes("swap_hand"), "bare Anthropic rules should name the public hand swap action");
  assert.ok(userPayload.hand && userPayload.hand.retained, "Anthropic payload should include retained hand state");
  assert.ok(userPayload.legalActions.some((action) => action.action === "swap_hand"));
  assert.ok(userPayload.legalActions.some((action) => action.action === "shot"));
  assert.ok(!JSON.stringify(userPayload).includes("hitEnemy"), "Anthropic payload should not expose simulated hit outcomes");
}

function testRealDeepSeekSmokeScriptIsDiscoverable() {
  const pkg = require("../package.json");
  assert.strictEqual(pkg.scripts["test:real:deepseek"], "node test/real-deepseek-smoke.js");
  const smokePath = path.resolve(__dirname, "real-deepseek-smoke.js");
  assert.ok(fs.existsSync(smokePath), "real DeepSeek smoke test script should exist");
}

testProviderCatalogRedactsKeys();
testNormalizeDecision();
testDeepSeekUsesCurrentJsonModeDefaults();
testOpenRouterUsesFreeJsonModeDefaults();
testAnthropicUsesSameBareRulesPayload();
testRealDeepSeekSmokeScriptIsDiscoverable();

console.log("provider-catalog tests passed");
