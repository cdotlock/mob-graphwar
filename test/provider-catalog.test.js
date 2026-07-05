const assert = require("assert");
const { listProviders, getProvider } = require("../server/providers/catalog.js");
const { normalizeProviderDecision } = require("../server/providers/normalize.js");
const { buildOpenAICompatibleRequest } = require("../server/providers/openai-compatible.js");
const fs = require("fs");
const path = require("path");

function testProviderCatalogRedactsKeys() {
  const providers = listProviders({ OPENAI_API_KEY: "sk-test", DEEPSEEK_API_KEY: "" });
  const openai = providers.find((provider) => provider.id === "openai");
  assert.ok(openai.available, "OpenAI should be marked available when env key exists");
  assert.strictEqual(openai.apiKey, undefined, "catalog should never expose key");
  assert.ok(getProvider("deepseek"), "DeepSeek should be known");
  assert.strictEqual(getProvider("unknown"), null);
}

function testNormalizeDecision() {
  const decision = normalizeProviderDecision('{"candidateId":"A-1","publicReason":"<think>x</think>Use high arc."}');
  assert.deepStrictEqual(decision, { action: "shot", candidateId: "A-1", publicReason: "Use high arc." });
  assert.deepStrictEqual(normalizeProviderDecision('{"action":"reroll","publicReason":"Need a different hand."}'), {
    action: "reroll",
    candidateId: undefined,
    publicReason: "Need a different hand."
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
  assert.ok(request.body.messages[0].content.includes("JSON"), "system prompt should explicitly request JSON");
  assert.ok(request.body.messages[0].content.includes("candidateId"), "system prompt should name candidateId");
  assert.ok(!request.body.messages[0].content.includes("safest"), "system prompt should not provide tactical advice");
  assert.ok(!request.body.messages[0].content.includes("high-clearance"), "system prompt should not provide tactical advice");
  assert.ok(!request.body.messages[0].content.includes("clearest"), "system prompt should not provide tactical advice");
  const userPayload = JSON.parse(request.body.messages[1].content);
  assert.ok(userPayload.rules, "provider should receive bare rules");
  assert.ok(Array.isArray(userPayload.legalActions), "provider should receive legal actions");
  assert.ok(userPayload.legalActions.some((action) => action.action === "reroll"), "provider should be allowed to reroll");
  assert.ok(!JSON.stringify(userPayload).includes("score"), "provider payload should not expose local scores");
  assert.ok(!JSON.stringify(userPayload).includes("hitEnemy"), "provider payload should not expose simulated hit outcomes");
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
testRealDeepSeekSmokeScriptIsDiscoverable();

console.log("provider-catalog tests passed");
