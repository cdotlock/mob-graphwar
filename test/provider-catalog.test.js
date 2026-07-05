const assert = require("assert");
const { listProviders, getProvider } = require("../server/providers/catalog.js");
const { normalizeProviderDecision } = require("../server/providers/normalize.js");

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

testProviderCatalogRedactsKeys();
testNormalizeDecision();

console.log("provider-catalog tests passed");
