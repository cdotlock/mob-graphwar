const assert = require("assert");
const { listProviders, listProviderCatalog, getProvider } = require("../server/providers/catalog.js");
const { normalizeProviderDecision } = require("../server/providers/normalize.js");
const { buildOpenAICompatibleRequest } = require("../server/providers/openai-compatible.js");
const { buildAnthropicRequest } = require("../server/providers/anthropic.js");
const { executeProviderDecision } = require("../server/providers/execute.js");
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

async function testProviderCatalogIncludesSelectableModels() {
  const catalog = await listProviderCatalog(
    { OPENROUTER_API_KEY: "sk-router", OPENAI_API_KEY: "sk-test" },
    {
      noCache: true,
      fetch: async (url) => {
        assert.ok(String(url).startsWith("https://openrouter.ai/api/v1/models"));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "cohere/north-mini-code:free",
                name: "Cohere: North Mini Code (free)",
                pricing: { prompt: "0", completion: "0" },
                architecture: { input_modalities: ["text"], output_modalities: ["text"] },
                context_length: 256000
              },
              {
                id: "openai/gpt-5.5",
                name: "OpenAI: GPT-5.5",
                pricing: { prompt: "2", completion: "8" },
                architecture: { input_modalities: ["text"], output_modalities: ["text"] },
                context_length: 400000
              },
              {
                id: "google/image-model",
                name: "Google: Image Model",
                pricing: { prompt: "1", completion: "1" },
                architecture: { input_modalities: ["text"], output_modalities: ["image"] },
                context_length: 8192
              },
              {
                id: "google/nano-banana-pro",
                name: "Google: Nano Banana Pro (Gemini Image)",
                pricing: { prompt: "1", completion: "1" },
                architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
                context_length: 8192
              }
            ]
          })
        };
      }
    }
  );
  const openrouter = catalog.find((provider) => provider.id === "openrouter");
  const openai = catalog.find((provider) => provider.id === "openai");
  assert.ok(openrouter.available, "OpenRouter should keep availability while adding models");
  assert.ok(Array.isArray(openrouter.models), "OpenRouter should expose selectable models");
  assert.ok(openrouter.models.some((model) => model.id === "cohere/north-mini-code:free"), "free OpenRouter model list should be exposed");
  assert.ok(openrouter.models.some((model) => model.id === "openai/gpt-5.5" && model.free === false), "paid OpenRouter models should remain selectable");
  assert.ok(!openrouter.models.some((model) => model.id === "google/image-model"), "image-output OpenRouter models should not appear in the function-writing game");
  assert.ok(!openrouter.models.some((model) => model.id === "google/nano-banana-pro"), "named image-generation OpenRouter models should not appear in the function-writing game");
  assert.ok(openai.models.some((model) => model.id === "gpt-4.1-mini"), "static providers should expose their configured model as an option");
  assert.ok(!JSON.stringify(catalog).includes("sk-router"), "catalog should still redact keys");
}

async function testProviderCatalogFetchesDynamicModelsForConfiguredProviders() {
  const calls = [];
  const catalog = await listProviderCatalog(
    {
      OPENAI_API_KEY: "sk-openai",
      DEEPSEEK_API_KEY: "sk-deepseek",
      MINIMAX_API_KEY: "sk-minimax",
      ZHIPU_API_KEY: "sk-zhipu",
      ANTHROPIC_API_KEY: "sk-anthropic",
      OPENROUTER_API_KEY: "sk-router"
    },
    {
      noCache: true,
      fetch: async (url, options) => {
        calls.push({ url: String(url), headers: options?.headers || {} });
        if (String(url).includes("anthropic.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: "claude-haiku-live", display_name: "Claude Haiku Live", created_at: "2026-01-01T00:00:00Z" }
              ]
            })
          };
        }
        if (String(url).includes("openrouter.ai")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "anthropic/claude-haiku-live",
                  name: "Anthropic: Claude Haiku Live",
                  pricing: { prompt: "0.8", completion: "4" },
                  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
                  context_length: 200000
                }
              ]
            })
          };
        }
        const host = new URL(String(url)).host;
        const id = host.includes("deepseek")
          ? "deepseek-live"
          : host.includes("minimax")
            ? "minimax-live"
            : host.includes("bigmodel")
              ? "glm-live"
              : "gpt-live";
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id, object: "model" }] })
        };
      }
    }
  );
  for (const [providerId, modelId] of Object.entries({
    openai: "gpt-live",
    deepseek: "deepseek-live",
    minimax: "minimax-live",
    zhipu: "glm-live",
    anthropic: "claude-haiku-live",
    openrouter: "anthropic/claude-haiku-live"
  })) {
    const provider = catalog.find((item) => item.id === providerId);
    assert.ok(provider, `${providerId} should be present`);
    assert.ok(provider.models.some((model) => model.id === modelId), `${providerId} should expose fetched live models`);
  }
  assert.ok(calls.some((call) => call.url === "https://api.openai.com/v1/models"), "OpenAI should use its live models endpoint");
  assert.ok(calls.some((call) => call.url === "https://api.deepseek.com/models"), "DeepSeek should use its live models endpoint");
  assert.ok(calls.some((call) => call.url === "https://api.minimax.io/v1/models"), "MiniMax should use its live models endpoint");
  assert.ok(calls.some((call) => call.url === "https://open.bigmodel.cn/api/paas/v4/models"), "Zhipu should use its live models endpoint");
  assert.ok(calls.some((call) => call.url === "https://api.anthropic.com/v1/models"), "Anthropic should use its live models endpoint");
  assert.ok(calls.some((call) => call.headers.authorization === "Bearer sk-openai"), "OpenAI model list should use bearer auth");
  assert.ok(calls.some((call) => call.headers["x-api-key"] === "sk-anthropic"), "Anthropic model list should use x-api-key auth");
  assert.ok(!JSON.stringify(catalog).includes("sk-openai"), "dynamic catalog should redact OpenAI key");
  assert.ok(!JSON.stringify(catalog).includes("sk-anthropic"), "dynamic catalog should redact Anthropic key");
}

function testNormalizeDecision() {
  const decision = normalizeProviderDecision('{"candidateId":"A-1","publicReason":"<think>x</think>Use high arc."}');
  assert.deepStrictEqual(decision, { action: "shot", candidateId: "A-1", publicReason: "Use high arc." });
  assert.deepStrictEqual(
    normalizeProviderDecision('Here is the legal JSON: {"action":"shot","candidateId":"B-2","publicReason":"thread lane"}'),
    { action: "shot", candidateId: "B-2", publicReason: "thread lane" }
  );
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
  assert.strictEqual(request.body.include_reasoning, false);
  assert.deepStrictEqual(request.body.reasoning, { exclude: true });
  assert.strictEqual(request.body.reasoning_effort, undefined);
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
  assert.strictEqual(pkg.scripts["test:real:openrouter"], "node test/real-openrouter-smoke.js");
  const smokePath = path.resolve(__dirname, "real-deepseek-smoke.js");
  const openrouterSmokePath = path.resolve(__dirname, "real-openrouter-smoke.js");
  assert.ok(fs.existsSync(smokePath), "real DeepSeek smoke test script should exist");
  assert.ok(fs.existsSync(openrouterSmokePath), "real OpenRouter smoke test script should exist");
}

async function testProviderRequestTimeoutUsesEnvLimit() {
  const openrouter = getProvider("openrouter");
  const state = Sim.createInitialState({ seed: 7351 });
  const rulesPayload = Contract.buildRulesPayload(state, "A1", "thread the maze");
  let sawAbortSignal = false;
  const fetchMock = async (_url, options) => {
    sawAbortSignal = Boolean(options && options.signal);
    if (!options || !options.signal) throw new Error("missing_abort_signal");
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  };

  await assert.rejects(
    () =>
      executeProviderDecision(
        openrouter,
        {
          apiKey: "sk-redacted",
          command: "thread the maze",
          candidates: rulesPayload.legalActions.filter((action) => action.action === "shot"),
          stateSummary: { seed: state.seed, turn: state.turn, map: state.mapMeta },
          rulesPayload,
          model: "openrouter/free"
        },
        { env: { GRAPHWAR_REQUEST_TIMEOUT_MS: "1" }, fetch: fetchMock }
      ),
    /provider_timeout/
  );
  assert.strictEqual(sawAbortSignal, true, "provider fetch should receive an AbortSignal");
}

(async () => {
  testProviderCatalogRedactsKeys();
  await testProviderCatalogIncludesSelectableModels();
  await testProviderCatalogFetchesDynamicModelsForConfiguredProviders();
  testNormalizeDecision();
  testDeepSeekUsesCurrentJsonModeDefaults();
  testOpenRouterUsesFreeJsonModeDefaults();
  testAnthropicUsesSameBareRulesPayload();
  testRealDeepSeekSmokeScriptIsDiscoverable();
  await testProviderRequestTimeoutUsesEnvLimit();
  console.log("provider-catalog tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
