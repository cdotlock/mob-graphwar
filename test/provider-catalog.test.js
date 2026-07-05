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
  assert.deepStrictEqual(decision, { candidateId: "A-1", publicReason: "Use high arc." });
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
  assert.ok(request.body.messages[0].content.includes("EXAMPLE JSON"), "system prompt should include a JSON example");
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
