const assert = require("assert");
const { listProviders, listProviderCatalog, getProvider } = require("../server/providers/catalog.js");
const { normalizeProviderDecision } = require("../server/providers/normalize.js");
const { buildOpenAICompatibleRequest } = require("../server/providers/openai-compatible.js");
const { buildAnthropicRequest } = require("../server/providers/anthropic.js");
const { executeProviderDecision, providerTimeoutMs } = require("../server/providers/execute.js");
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

function testCuratedCatalogUsesCurrentMainstreamModels() {
  assert.strictEqual(getProvider("openai").defaultModel, "gpt-5.5");
  assert.strictEqual(getProvider("anthropic").defaultModel, "claude-sonnet-5");
  assert.strictEqual(getProvider("gemini").defaultModel, "gemini-3.5-flash");
  assert.strictEqual(getProvider("xai").defaultModel, "grok-build-0.1");
  assert.strictEqual(getProvider("moonshot").defaultModel, "kimi-k2.6");
  assert.strictEqual(getProvider("zhipu").defaultBaseUrl, "https://api.z.ai/api/paas/v4");
  assert.strictEqual(getProvider("zhipu").defaultModel, "glm-5.2");
  assert.strictEqual(getProvider("deepseek").defaultModel, "deepseek-v4-flash");
  assert.strictEqual(getProvider("stepfun").defaultModel, "step-3.7-flash");
  assert.strictEqual(getProvider("minimax").defaultModel, "MiniMax-M3");
  assert.strictEqual(getProvider("mimo").defaultBaseUrl, "https://api.xiaomimimo.com/v1");
  assert.strictEqual(getProvider("mimo").defaultModel, "mimo-v2.5-pro");
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
                id: "openrouter/free",
                name: "Free Models Router",
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
  assert.ok(openrouter.models.some((model) => model.id === "openrouter/free"), "free OpenRouter router should be exposed");
  assert.ok(openrouter.models.some((model) => model.id === "openai/gpt-5.5" && model.free === false), "paid OpenRouter models should remain selectable");
  assert.ok(!openrouter.models.some((model) => model.id === "google/image-model"), "image-output OpenRouter models should not appear in the function-writing game");
  assert.ok(!openrouter.models.some((model) => model.id === "google/nano-banana-pro"), "named image-generation OpenRouter models should not appear in the function-writing game");
  assert.ok(openai.models.some((model) => model.id === "gpt-5.5"), "static providers should expose their configured model as an option");
  assert.ok(!JSON.stringify(catalog).includes("sk-router"), "catalog should still redact keys");
}

async function testOpenRouterCatalogIsCuratedForGameModelSelection() {
  const noisyModels = Array.from({ length: 120 }, (_, index) => ({
    id: `unknown/vendor-${index}`,
    name: `Unknown Vendor ${index}`,
    pricing: { prompt: "0.000001", completion: "0.000002" },
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    context_length: 8192,
    created: 1000 + index
  }));
  const catalog = await listProviderCatalog(
    { OPENROUTER_API_KEY: "sk-router" },
    {
      noCache: true,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "openrouter/auto",
              name: "Auto Router",
              pricing: { prompt: "0.000001", completion: "0.000002" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 200000,
              created: 2000
            },
            {
              id: "openrouter/free",
              name: "Free Models Router",
              pricing: { prompt: "0", completion: "0" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 200000,
              created: 2001
            },
            {
              id: "anthropic/claude-sonnet-5",
              name: "Anthropic: Claude Sonnet 5",
              pricing: { prompt: "0.000003", completion: "0.000015" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 200000,
              created: 2002
            },
            {
              id: "google/gemini-3.5-flash",
              name: "Google: Gemini 3.5 Flash",
              pricing: { prompt: "0.000001", completion: "0.000004" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 1000000,
              created: 2010
            },
            {
              id: "x-ai/grok-4.3",
              name: "xAI: Grok 4.3",
              pricing: { prompt: "0.000003", completion: "0.000015" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 256000,
              created: 2011
            },
            {
              id: "moonshotai/kimi-k2.7-code",
              name: "Moonshot AI: Kimi K2.7 Code",
              pricing: { prompt: "0.000001", completion: "0.000004" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 256000,
              created: 2_000_000_000
            },
            {
              id: "z-ai/glm-5.2",
              name: "Z.ai: GLM 5.2",
              pricing: { prompt: "0.000001", completion: "0.000003" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 128000,
              created: 2013
            },
            {
              id: "deepseek/deepseek-v4-pro",
              name: "DeepSeek: DeepSeek V4 Pro",
              pricing: { prompt: "0.000001", completion: "0.000003" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 128000,
              created: 2014
            },
            {
              id: "stepfun/step-3.7-flash",
              name: "StepFun: Step 3.7 Flash",
              pricing: { prompt: "0.000001", completion: "0.000003" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 128000,
              created: 2015
            },
            {
              id: "minimax/minimax-m3",
              name: "MiniMax: MiniMax M3",
              pricing: { prompt: "0.000001", completion: "0.000003" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 128000,
              created: 2016
            },
            {
              id: "xiaomi/mimo-v2.5-pro",
              name: "Xiaomi: MiMo V2.5 Pro",
              pricing: { prompt: "0.000001", completion: "0.000003" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 128000,
              created: 2017
            },
            {
              id: "openai/gpt-5.5",
              name: "OpenAI: GPT-5.5",
              pricing: { prompt: "0.0000004", completion: "0.0000016" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 128000,
              created: 2003
            },
            {
              id: "meta-llama/llama-4.1",
              name: "Meta: Llama 4.1",
              pricing: { prompt: "0.000001", completion: "0.000003" },
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              context_length: 128000,
              created: 2018
            },
            {
              id: "google/imagen-pro",
              name: "Google: Imagen Pro",
              pricing: { prompt: "0.01", completion: "0.01" },
              architecture: { input_modalities: ["text"], output_modalities: ["image"] },
              context_length: 8192,
              created: 2004
            },
            ...noisyModels
          ]
        })
      })
    }
  );
  const openrouter = catalog.find((provider) => provider.id === "openrouter");
  const ids = openrouter.models.map((model) => model.id);
  assert.ok(ids.length <= 80, "OpenRouter select should be curated instead of exposing the entire raw catalog");
  assert.strictEqual(ids[0], "openrouter/auto", "OpenRouter auto router should be the first recommended option");
  assert.strictEqual(ids[1], "openrouter/free", "OpenRouter free router should remain easy to choose");
  for (const id of [
    "anthropic/claude-sonnet-5",
    "google/gemini-3.5-flash",
    "x-ai/grok-4.3",
    "moonshotai/kimi-k2.7-code",
    "z-ai/glm-5.2",
    "deepseek/deepseek-v4-pro",
    "stepfun/step-3.7-flash",
    "minimax/minimax-m3",
    "xiaomi/mimo-v2.5-pro",
    "openai/gpt-5.5"
  ]) {
    assert.ok(ids.includes(id), `${id} should be kept as an allowed mainstream OpenRouter family`);
  }
  assert.ok(!ids.includes("meta-llama/llama-4.1"), "non-whitelisted OpenRouter families should be hidden from the player model select");
  assert.ok(!ids.includes("google/imagen-pro"), "image-generation models should be filtered out of the function-writing game");
}

async function testProviderCatalogFetchesDynamicModelsForConfiguredProviders() {
  const calls = [];
  const catalog = await listProviderCatalog(
    {
      OPENAI_API_KEY: "sk-openai",
      DEEPSEEK_API_KEY: "sk-deepseek",
      GEMINI_API_KEY: "sk-gemini",
      XAI_API_KEY: "sk-xai",
      MOONSHOT_API_KEY: "sk-moonshot",
      MINIMAX_API_KEY: "sk-minimax",
      MIMO_API_KEY: "sk-mimo",
      STEPFUN_API_KEY: "sk-stepfun",
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
          : host.includes("generativelanguage")
            ? "gemini-live"
            : host.includes("api.x.ai")
              ? "grok-live"
              : host.includes("moonshot")
                ? "kimi-live"
                : host.includes("stepfun")
                  ? "stepfun-live"
          : host.includes("minimax")
            ? "minimax-live"
            : host.includes("xiaomimimo")
              ? "mimo-live"
            : host.includes("api.z.ai")
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
    gemini: "gemini-live",
    xai: "grok-live",
    moonshot: "kimi-live",
    minimax: "minimax-live",
    mimo: "mimo-live",
    stepfun: "stepfun-live",
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
  assert.ok(calls.some((call) => call.url === "https://generativelanguage.googleapis.com/v1beta/openai/models"), "Gemini should use its OpenAI-compatible models endpoint");
  assert.ok(calls.some((call) => call.url === "https://api.x.ai/v1/models"), "xAI should use its OpenAI-compatible models endpoint");
  assert.ok(calls.some((call) => call.url === "https://api.moonshot.ai/v1/models"), "Kimi should use its OpenAI-compatible models endpoint");
  assert.ok(calls.some((call) => call.url === "https://api.minimax.io/v1/models"), "MiniMax should use its live models endpoint");
  assert.ok(calls.some((call) => call.url === "https://api.xiaomimimo.com/v1/models"), "MiMo should use its live models endpoint");
  assert.ok(calls.some((call) => call.url === "https://api.stepfun.ai/v1/models"), "StepFun should use its OpenAI-compatible models endpoint");
  assert.ok(calls.some((call) => call.url === "https://api.z.ai/api/paas/v4/models"), "Z.ai should use its live models endpoint");
  assert.ok(calls.some((call) => call.url === "https://api.anthropic.com/v1/models"), "Anthropic should use its live models endpoint");
  assert.ok(calls.some((call) => call.headers.authorization === "Bearer sk-openai"), "OpenAI model list should use bearer auth");
  assert.ok(calls.some((call) => call.headers["api-key"] === "sk-mimo"), "MiMo model list should use api-key auth");
  assert.ok(calls.some((call) => call.headers["x-api-key"] === "sk-anthropic"), "Anthropic model list should use x-api-key auth");
  assert.ok(!JSON.stringify(catalog).includes("sk-openai"), "dynamic catalog should redact OpenAI key");
  assert.ok(!JSON.stringify(catalog).includes("sk-anthropic"), "dynamic catalog should redact Anthropic key");
}

function testNormalizeDecision() {
  assert.throws(() => normalizeProviderDecision('{"candidateId":"A-1","publicReason":"Use high arc."}'), /missing_expression/);
  assert.throws(
    () => normalizeProviderDecision('Here is the legal JSON: {"action":"shot","candidateId":"B-2","publicReason":"thread lane"}'),
    /missing_expression/
  );
  assert.deepStrictEqual(normalizeProviderDecision('{"action":"swap_hand","publicReason":"Need a different hand."}'), {
    action: "swap_hand",
    publicReason: "Need a different hand."
  });
  assert.throws(() => normalizeProviderDecision('{"action":"replace_hand","publicReason":"Unsupported action."}'), /missing_expression/);
  assert.deepStrictEqual(
    normalizeProviderDecision(
      '{"action":"shot","targetId":"B2","expression":"y=y0+dy*t+12*sin(pi*t)","cardSlots":[1,3],"publicReason":"clear arc"}'
    ),
    {
      action: "shot",
      targetId: "B2",
      expression: "y=y0+dy*t+12*sin(pi*t)",
      cardSlots: [1, 3],
      publicReason: "clear arc"
    }
  );
  assert.throws(() => normalizeProviderDecision("not json"), /invalid_provider_json/);
}

function testDeepSeekUsesCurrentJsonModeDefaults() {
  const deepseek = getProvider("deepseek");
  assert.strictEqual(deepseek.defaultModel, "deepseek-v4-flash");

  const request = buildOpenAICompatibleRequest(
    deepseek,
    {
      command: "",
      stateSummary: { seed: 7351, turn: 0, map: { name: "Basalt Gate" } }
    },
    "sk-redacted"
  );

  assert.deepStrictEqual(request.body.response_format, { type: "json_object" });
  assert.deepStrictEqual(request.body.thinking, { type: "disabled" });
  assert.strictEqual(request.body.max_tokens, undefined, "default provider calls should not impose a hard output budget");
  assert.strictEqual(request.body.messages.length, 1, "provider should receive only the bare rules packet as prompt content");
  assert.strictEqual(request.body.messages[0].role, "user");
  const userPayload = JSON.parse(request.body.messages[0].content);
  assert.ok(userPayload.rules.output.includes("JSON"), "bare rules should specify the required JSON output");
  assert.ok(userPayload.rules.actionLimit.includes("legal action"), "bare rules should describe the legal action contract");
  assert.ok(userPayload.rules.actionLimit.includes("swap_hand"), "bare rules should name the public hand swap action");
  assert.ok(userPayload.rules, "provider should receive bare rules");
  assert.ok(Array.isArray(userPayload.legalActions), "provider should receive legal actions");
  assert.ok(userPayload.legalActions.some((action) => action.action === "swap_hand"), "provider should be allowed to swap the retained hand");
  assert.ok(userPayload.legalActions.every((action) => ["shot", "swap_hand"].includes(action.action)), "provider legal actions should use the current action set");
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
  assert.strictEqual(request.body.max_tokens, undefined, "OpenRouter default calls should let the routed model finish normally");
  assert.strictEqual(request.body.messages.length, 1, "OpenRouter should receive only the public rules payload");
  const userPayload = JSON.parse(request.body.messages[0].content);
  assert.ok(userPayload.legalActions.some((action) => action.action === "swap_hand"));
  const shotAction = userPayload.legalActions.find((action) => action.action === "shot");
  assert.ok(shotAction, "provider should receive a shot action contract");
  assert.ok(!JSON.stringify(userPayload).includes("candidateId"), "provider prompt should not include precomputed shot candidates");
  assert.ok(shotAction.output.expression.includes("y="), "provider prompt should ask the model to write a function expression");
}

function testInfronDisablesReasoningByDefault() {
  const infron = getProvider("infron");
  assert.strictEqual(infron.defaultBaseUrl, "https://llm.onerouter.pro/v1");

  const request = buildOpenAICompatibleRequest(
    infron,
    {
      command: "",
      stateSummary: { seed: 7351, turn: 0, map: { name: "Needle Canyon" } },
      model: "openai/gpt-5.5",
      strictDecisionSchema: true
    },
    "sk-infron"
  );

  assert.strictEqual(request.url, "https://llm.onerouter.pro/v1/chat/completions");
  assert.strictEqual(request.headers.authorization, "Bearer sk-infron");
  assert.strictEqual(request.body.model, "openai/gpt-5.5");
  assert.strictEqual(request.body.response_format.type, "json_schema");
  assert.deepStrictEqual(request.body.reasoning, { effort: "none" });
  assert.strictEqual(request.body.include_reasoning, undefined);
  assert.strictEqual(request.body.max_tokens, undefined, "Infron default calls should not starve reasoning-capable models with a tiny output cap");
}

function testOpenRouterCanEnableReasoningForBenchmark() {
  const openrouter = getProvider("openrouter");
  const request = buildOpenAICompatibleRequest(
    openrouter,
    {
      command: "",
      stateSummary: { seed: 7351, turn: 0, map: { name: "Needle Canyon" } },
      model: "google/gemini-3.5-flash",
      reasoning: {
        enabled: true,
        effort: "high",
        exclude: false
      }
    },
    "sk-router"
  );

  assert.strictEqual(request.body.include_reasoning, true);
  assert.deepStrictEqual(request.body.reasoning, { enabled: true, effort: "high", exclude: false });
  assert.strictEqual(request.body.reasoning_effort, undefined);
  assert.ok(request.body.max_tokens >= 6000, "reasoning-enabled benchmark calls need enough output budget for high thinking plus JSON");
  assert.ok(request.body.max_completion_tokens >= 6000, "OpenRouter reasoning calls should also send max_completion_tokens for reasoning model routes");
}

function testOpenRouterBenchmarkCanRequireStrictDecisionJson() {
  const openrouter = getProvider("openrouter");
  const request = buildOpenAICompatibleRequest(
    openrouter,
    {
      command: "",
      stateSummary: { seed: 7351, turn: 0, map: { name: "Needle Canyon" } },
      model: "google/gemini-3.5-flash",
      reasoning: {
        enabled: true,
        effort: "high",
        exclude: false
      },
      strictDecisionSchema: true
    },
    "sk-router"
  );

  assert.strictEqual(request.body.response_format.type, "json_schema");
  assert.strictEqual(request.body.response_format.json_schema.name, "graphwar_agent_decision");
  assert.strictEqual(request.body.response_format.json_schema.strict, true);
  assert.deepStrictEqual(request.body.response_format.json_schema.schema.required, [
    "action",
    "targetId",
    "expression",
    "cardSlots",
    "publicReason"
  ]);
  assert.deepStrictEqual(request.body.reasoning, { enabled: true, effort: "high", exclude: false });
  assert.deepStrictEqual(request.body.plugins, [{ id: "response-healing" }]);
  assert.strictEqual(request.body.provider, undefined);
}

function testDeepSeekStrictDecisionFallsBackToJsonObject() {
  const deepseek = getProvider("deepseek");
  const request = buildOpenAICompatibleRequest(
    deepseek,
    {
      command: "",
      stateSummary: { seed: 7351, turn: 0, map: { name: "Needle Canyon" } },
      model: "deepseek-v4-flash",
      strictDecisionSchema: true
    },
    "sk-deepseek"
  );

  assert.deepStrictEqual(request.body.response_format, { type: "json_object" });
  assert.strictEqual(request.body.plugins, undefined);
}

function testMiMoUsesApiKeyHeaderForOpenAICompatibleChat() {
  const mimo = getProvider("mimo");
  const request = buildOpenAICompatibleRequest(
    mimo,
    {
      command: "write a clean function shot",
      stateSummary: { seed: 7351, turn: 0, map: { name: "Needle Canyon" } }
    },
    "sk-mimo"
  );

  assert.strictEqual(request.url, "https://api.xiaomimimo.com/v1/chat/completions");
  assert.strictEqual(request.headers["api-key"], "sk-mimo");
  assert.strictEqual(request.headers.authorization, undefined);
  assert.strictEqual(request.body.model, "mimo-v2.5-pro");
}

function testAnthropicUsesSameBareRulesPayload() {
  const anthropic = getProvider("anthropic");
  const state = Sim.createInitialState({ seed: 7351 });
  const rulesPayload = Contract.buildRulesPayload(state, "A", "thread the center");
  const request = buildAnthropicRequest(
    anthropic,
    {
      command: "thread the center",
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

function testProviderRequestTimeoutDefaultsToThinkingBudget() {
  assert.ok(providerTimeoutMs({ env: {} }) >= 300_000, "default provider timeout should allow reasoning models enough time");
  assert.strictEqual(providerTimeoutMs({ env: { GRAPHWAR_REQUEST_TIMEOUT_MS: "300000" } }), 300_000);
  assert.strictEqual(providerTimeoutMs({ env: { GRAPHWAR_REQUEST_TIMEOUT_MS: "900000" } }), 900_000);
}

async function testExecuteProviderDecisionReturnsReasoningTrace() {
  const openrouter = getProvider("openrouter");
  const state = Sim.createInitialState({ seed: 7351 });
  const rulesPayload = Contract.buildRulesPayload(state, "A1", "");
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            reasoning: "I compare the legal function contract before writing the first shot.",
            reasoning_details: [{ type: "reasoning.text", text: "Detailed model thought trace." }],
            content: JSON.stringify({
              action: "shot",
              targetId: "B2",
              expression: "y=y0+dy*t+12*sin(pi*t)",
              cardSlots: [1],
              publicReason: "The function clears the first obstacle."
            })
          }
        }
      ]
    })
  });

  const result = await executeProviderDecision(
    openrouter,
    {
      apiKey: "sk-redacted",
      command: "",
      stateSummary: { seed: state.seed, turn: state.turn, map: state.mapMeta },
      rulesPayload,
      model: "google/gemini-3.5-flash",
      reasoning: { enabled: true, effort: "medium", exclude: false }
    },
    { env: {}, fetch: fetchMock }
  );

  assert.strictEqual(result.decision.action, "shot");
  assert.ok(result.reasoningText.includes("compare the legal function contract"), "reasoning text should be preserved for benchmark traces");
  assert.deepStrictEqual(result.reasoningDetails, [{ type: "reasoning.text", text: "Detailed model thought trace." }]);
  assert.ok(result.rawText.includes("sin(pi*t)"), "raw JSON model output should be preserved separately");
}

async function testExecuteProviderDecisionAttachesFailedRawOutput() {
  const openrouter = getProvider("openrouter");
  const state = Sim.createInitialState({ seed: 7351 });
  const rulesPayload = Contract.buildRulesPayload(state, "A1", "");
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            reasoning: "I thought about the expression contract but failed the response contract.",
            content: "I would shoot through the top lane, but here is not JSON."
          }
        }
      ]
    })
  });

  await assert.rejects(
    async () =>
      executeProviderDecision(
        openrouter,
        {
          apiKey: "sk-redacted",
          command: "",
          stateSummary: { seed: state.seed, turn: state.turn, map: state.mapMeta },
          rulesPayload,
          model: "anthropic/claude-opus-4.8",
          reasoning: { enabled: true, effort: "medium", exclude: false }
        },
        { env: {}, fetch: fetchMock }
      ),
    (err) => {
      assert.strictEqual(err.message, "invalid_provider_json");
      assert.ok(err.rawText.includes("not JSON"), "failed raw output should be attached for benchmark traces");
      assert.ok(err.reasoningText.includes("failed the response contract"), "failed reasoning should be attached for benchmark traces");
      return true;
    }
  );
}

async function testExecuteProviderDecisionAttachesHttpErrorBody() {
  const openrouter = getProvider("openrouter");
  const state = Sim.createInitialState({ seed: 7351 });
  const rulesPayload = Contract.buildRulesPayload(state, "A1", "");
  const fetchMock = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: "response_format json_schema is not supported with this route" } })
  });

  await assert.rejects(
    async () =>
      executeProviderDecision(
        openrouter,
        {
          apiKey: "sk-redacted",
          command: "",
          stateSummary: { seed: state.seed, turn: state.turn, map: state.mapMeta },
          rulesPayload,
          model: "openai/gpt-5.5",
          reasoning: { enabled: true, effort: "medium", exclude: false },
          strictDecisionSchema: true
        },
        { env: {}, fetch: fetchMock }
      ),
    (err) => {
      assert.strictEqual(err.message, "provider_http_error");
      assert.strictEqual(err.status, 400);
      assert.ok(err.body.includes("json_schema"), "HTTP error body should be attached for benchmark diagnostics");
      return true;
    }
  );
}

(async () => {
  testProviderCatalogRedactsKeys();
  testCuratedCatalogUsesCurrentMainstreamModels();
  await testProviderCatalogIncludesSelectableModels();
  await testOpenRouterCatalogIsCuratedForGameModelSelection();
  await testProviderCatalogFetchesDynamicModelsForConfiguredProviders();
  testNormalizeDecision();
  testDeepSeekUsesCurrentJsonModeDefaults();
  testOpenRouterUsesFreeJsonModeDefaults();
  testInfronDisablesReasoningByDefault();
  testOpenRouterCanEnableReasoningForBenchmark();
  testOpenRouterBenchmarkCanRequireStrictDecisionJson();
  testDeepSeekStrictDecisionFallsBackToJsonObject();
  testMiMoUsesApiKeyHeaderForOpenAICompatibleChat();
  testAnthropicUsesSameBareRulesPayload();
  testRealDeepSeekSmokeScriptIsDiscoverable();
  await testProviderRequestTimeoutUsesEnvLimit();
  testProviderRequestTimeoutDefaultsToThinkingBudget();
  await testExecuteProviderDecisionReturnsReasoningTrace();
  await testExecuteProviderDecisionAttachesFailedRawOutput();
  await testExecuteProviderDecisionAttachesHttpErrorBody();
  console.log("provider-catalog tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
