"use strict";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODEL_CACHE_MS = 10 * 60 * 1000;

const PROVIDERS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    adapter: "openai-compatible",
    keyEnv: "OPENROUTER_API_KEY",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    modelEnv: "OPENROUTER_MODEL",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/free",
    modelList: { url: OPENROUTER_MODELS_URL, auth: "optional-bearer", parser: "openrouter", public: true }
  },
  {
    id: "openai",
    label: "OpenAI",
    adapter: "openai-compatible",
    keyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    modelEnv: "OPENAI_MODEL",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.5",
    modelList: { path: "/models", auth: "bearer", parser: "openai-compatible" }
  },
  {
    id: "anthropic",
    label: "Anthropic",
    adapter: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    modelEnv: "ANTHROPIC_MODEL",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    modelList: { path: "/models", auth: "anthropic", parser: "anthropic" }
  },
  {
    id: "gemini",
    label: "Gemini",
    adapter: "openai-compatible",
    keyEnv: "GEMINI_API_KEY",
    baseUrlEnv: "GEMINI_BASE_URL",
    modelEnv: "GEMINI_MODEL",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.5-flash",
    modelList: { path: "/models", auth: "bearer", parser: "openai-compatible" }
  },
  {
    id: "xai",
    label: "Grok / xAI",
    adapter: "openai-compatible",
    keyEnv: "XAI_API_KEY",
    baseUrlEnv: "XAI_BASE_URL",
    modelEnv: "XAI_MODEL",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-build-0.1",
    modelList: { path: "/models", auth: "bearer", parser: "openai-compatible" }
  },
  {
    id: "moonshot",
    label: "Kimi / Moonshot",
    adapter: "openai-compatible",
    keyEnv: "MOONSHOT_API_KEY",
    baseUrlEnv: "MOONSHOT_BASE_URL",
    modelEnv: "MOONSHOT_MODEL",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2.6",
    modelList: { path: "/models", auth: "bearer", parser: "openai-compatible" }
  },
  {
    id: "zhipu",
    label: "Z.ai / Zhipu",
    adapter: "openai-compatible",
    keyEnv: "ZHIPU_API_KEY",
    alternateKeyEnv: "ZAI_API_KEY",
    baseUrlEnv: "ZHIPU_BASE_URL",
    modelEnv: "ZHIPU_MODEL",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-5.2",
    modelList: { path: "/models", auth: "bearer", parser: "openai-compatible" }
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    adapter: "openai-compatible",
    keyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    modelEnv: "DEEPSEEK_MODEL",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    modelList: { path: "/models", auth: "bearer", parser: "openai-compatible" }
  },
  {
    id: "stepfun",
    label: "StepFun",
    adapter: "openai-compatible",
    keyEnv: "STEPFUN_API_KEY",
    alternateKeyEnv: "STEP_API_KEY",
    baseUrlEnv: "STEPFUN_BASE_URL",
    modelEnv: "STEPFUN_MODEL",
    defaultBaseUrl: "https://api.stepfun.ai/v1",
    defaultModel: "step-3.7-flash",
    modelList: { path: "/models", auth: "bearer", parser: "openai-compatible" }
  },
  {
    id: "minimax",
    label: "MiniMax",
    adapter: "openai-compatible",
    keyEnv: "MINIMAX_API_KEY",
    baseUrlEnv: "MINIMAX_BASE_URL",
    modelEnv: "MINIMAX_MODEL",
    defaultBaseUrl: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M3",
    modelList: { path: "/models", auth: "bearer", parser: "openai-compatible" }
  },
  {
    id: "mimo",
    label: "MiMo / Xiaomi",
    adapter: "openai-compatible",
    keyEnv: "MIMO_API_KEY",
    baseUrlEnv: "MIMO_BASE_URL",
    modelEnv: "MIMO_MODEL",
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    defaultModel: "mimo-v2.5-pro",
    modelList: { path: "/models", auth: "api-key", parser: "openai-compatible" }
  },
];

const CURATED_PROVIDER_MODELS = {
  openrouter: [
    { id: "openrouter/auto", label: "Auto Router", family: "auto", free: false, contextLength: 200000 },
    { id: "openrouter/free", label: "Free Models Router", free: true, contextLength: 200000 },
    { id: "anthropic/claude-sonnet-5", label: "Anthropic: Claude Sonnet 5", family: "anthropic", free: false, contextLength: 200000 },
    { id: "z-ai/glm-5.2", label: "Z.ai: GLM 5.2", family: "zhipu", free: false, contextLength: 1000000 },
    { id: "moonshotai/kimi-k2.7-code", label: "MoonshotAI: Kimi K2.7 Code", family: "kimi", free: false, contextLength: 256000 },
    { id: "minimax/minimax-m3", label: "MiniMax: MiniMax M3", family: "minimax", free: false, contextLength: 1000000 },
    { id: "x-ai/grok-build-0.1", label: "xAI: Grok Build 0.1", family: "grok", free: false, contextLength: null },
    { id: "openai/gpt-5.5", label: "OpenAI: GPT-5.5", family: "openai", free: false, contextLength: 1000000 },
    { id: "xiaomi/mimo-v2.5-pro", label: "Xiaomi: MiMo V2.5 Pro", family: "mimo", free: false, contextLength: null },
    { id: "google/gemini-3.5-flash", label: "Google: Gemini 3.5 Flash", family: "gemini", free: false, contextLength: 1000000 },
    { id: "deepseek/deepseek-v4-flash", label: "DeepSeek: DeepSeek V4 Flash", family: "deepseek", free: false, contextLength: 1000000 }
  ],
  openai: [
    { id: "gpt-5.5", label: "gpt-5.5", free: false, contextLength: null },
    { id: "gpt-5.5-pro", label: "gpt-5.5-pro", free: false, contextLength: null },
    { id: "gpt-5.4-mini", label: "gpt-5.4-mini", free: false, contextLength: null },
    { id: "gpt-5.4-nano", label: "gpt-5.4-nano", free: false, contextLength: null }
  ],
  deepseek: [
    { id: "deepseek-v4-flash", label: "deepseek-v4-flash", free: false, contextLength: null },
    { id: "deepseek-v4-pro", label: "deepseek-v4-pro", free: false, contextLength: null }
  ],
  gemini: [
    { id: "gemini-3.5-flash", label: "gemini-3.5-flash", free: false, contextLength: null },
    { id: "gemini-3.5-pro", label: "gemini-3.5-pro", free: false, contextLength: null }
  ],
  xai: [
    { id: "grok-build-0.1", label: "grok-build-0.1", free: false, contextLength: null },
    { id: "grok-4.3", label: "grok-4.3", free: false, contextLength: null },
    { id: "grok-4.20", label: "grok-4.20", free: false, contextLength: null }
  ],
  moonshot: [
    { id: "kimi-k2.6", label: "kimi-k2.6", free: false, contextLength: null },
    { id: "kimi-k2.5", label: "kimi-k2.5", free: false, contextLength: null }
  ],
  minimax: [
    { id: "MiniMax-M3", label: "MiniMax-M3", free: false, contextLength: null },
    { id: "MiniMax-M2.7", label: "MiniMax-M2.7", free: false, contextLength: null }
  ],
  mimo: [
    { id: "mimo-v2.5-pro", label: "mimo-v2.5-pro", free: false, contextLength: null },
    { id: "mimo-v2.5-pro-ultraspeed", label: "mimo-v2.5-pro-ultraspeed", free: false, contextLength: null },
    { id: "mimo-v2.5", label: "mimo-v2.5", free: false, contextLength: null }
  ],
  stepfun: [
    { id: "step-3.7-flash", label: "step-3.7-flash", free: false, contextLength: null },
    { id: "step-3.7", label: "step-3.7", free: false, contextLength: null }
  ],
  zhipu: [
    { id: "glm-5.2", label: "glm-5.2", free: false, contextLength: null },
    { id: "glm-5.1", label: "glm-5.1", free: false, contextLength: null },
    { id: "glm-5-turbo", label: "glm-5-turbo", free: false, contextLength: null }
  ],
  anthropic: [
    { id: "claude-sonnet-5", label: "claude-sonnet-5", free: false, contextLength: null },
    { id: "claude-opus-4-8", label: "claude-opus-4-8", free: false, contextLength: null },
    { id: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5-20251001", free: false, contextLength: null }
  ]
};
const providerModelCache = new Map();
const OPENROUTER_MODEL_LIMIT = 80;
const OPENROUTER_FAMILY_ORDER = [
  "openai",
  "anthropic",
  "gemini",
  "grok",
  "kimi",
  "zhipu",
  "deepseek",
  "stepfun",
  "minimax",
  "mimo"
];

function getProvider(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null;
}

function listProviders(env) {
  const source = env || process.env;
  const allowed = new Set(
    String(source.GRAPHWAR_ALLOWED_PROVIDERS || PROVIDERS.map((provider) => provider.id).join(","))
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
  return PROVIDERS.filter((provider) => allowed.has(provider.id)).map((provider) => ({
    id: provider.id,
    label: provider.label,
    adapter: provider.adapter,
    available: Boolean(source[provider.keyEnv] || (provider.alternateKeyEnv && source[provider.alternateKeyEnv])),
    baseUrl: source[provider.baseUrlEnv] || provider.defaultBaseUrl || null,
    model: source[provider.modelEnv] || provider.defaultModel
  }));
}

function priceIsFree(value) {
  return Number(value || 0) === 0;
}

function modelSupportsText(model) {
  const architecture = model && model.architecture ? model.architecture : {};
  const identity = `${model?.id || ""} ${model?.name || ""}`.toLowerCase();
  if (/(image|banana|dall[- ]?e|stable diffusion|midjourney|flux|sdxl)/.test(identity)) return false;
  const outputModalities = Array.isArray(architecture.output_modalities)
    ? architecture.output_modalities.map((item) => String(item).toLowerCase())
    : Array.isArray(architecture.output)
      ? architecture.output.map((item) => String(item).toLowerCase())
      : [];
  if (outputModalities.length) return outputModalities.includes("text");
  const inputModalities = Array.isArray(architecture.input_modalities)
    ? architecture.input_modalities.map((item) => String(item).toLowerCase())
    : [];
  if (inputModalities.length && !inputModalities.includes("text")) return false;
  const encoded = JSON.stringify(architecture).toLowerCase();
  return encoded.includes("text") || !encoded.includes("image");
}

function openRouterFamily(model) {
  const id = String(model?.id || "").toLowerCase();
  const name = String(model?.name || "").toLowerCase();
  const identity = `${id} ${name}`;
  if (id === "openrouter/auto") return "auto";
  if (id === "openrouter/free") return "free";
  if (id.startsWith("openai/") || /\bopenai\b|gpt-|o\d\b/.test(identity)) return "openai";
  if (id.startsWith("anthropic/") || /anthropic|claude/.test(identity)) return "anthropic";
  if (/gemini/.test(identity) || /^google\/.*gemini/.test(id)) return "gemini";
  if (id.startsWith("x-ai/") || /grok|xai|x\.ai/.test(identity)) return "grok";
  if (/kimi|moonshot/.test(identity)) return "kimi";
  if (id.startsWith("z-ai/") || id.startsWith("zhipu/") || /z\.ai|zhipu|\bglm[-_ ]/.test(identity)) return "zhipu";
  if (id.startsWith("deepseek/") || /deepseek/.test(identity)) return "deepseek";
  if (id.startsWith("stepfun/") || /stepfun|\bstep[-_ ]?\d/.test(identity)) return "stepfun";
  if (id.startsWith("minimax/") || /minimax/.test(identity)) return "minimax";
  if (id.startsWith("mimo/") || /\bmimo\b/.test(identity)) return "mimo";
  return "";
}

function openRouterModelRank(model) {
  const family = model.family || "";
  if (family === "auto") return 1_000_000_000;
  if (family === "free") return 999_000_000;
  const identity = `${model.id || ""} ${model.label || ""}`.toLowerCase();
  const familyRank = OPENROUTER_FAMILY_ORDER.indexOf(family);
  const created = Number(model.created) || 0;
  const latestBoost = /latest|preview|3\.5|4\.3|4\.20|build|k2\.[67]|3\.7|v4|m3|glm-5|gpt-5|sonnet|opus|pro/.test(identity)
    ? 50_000
    : 0;
  const freePenalty = model.free ? 5_000 : 0;
  return 800_000_000 + latestBoost + created - freePenalty - Math.max(0, familyRank) * 100;
}

function normalizeOpenRouterModel(model) {
  const inputCost = Number(model.pricing?.prompt || 0) || 0;
  const outputCost = Number(model.pricing?.completion || 0) || 0;
  const family = openRouterFamily(model);
  return {
    id: String(model.id || "").trim(),
    label: String(model.name || model.id || "").trim(),
    family,
    created: Number(model.created || model.created_at || 0) || null,
    free: priceIsFree(model.pricing?.prompt) && priceIsFree(model.pricing?.completion),
    contextLength: Number(model.context_length || model.contextLength || 0) || null,
    inputCost,
    outputCost
  };
}

function normalizeOpenAICompatibleModel(model) {
  const id = String(model.id || model.name || "").trim();
  return {
    id,
    label: String(model.name || model.display_name || id).trim(),
    free: typeof model.free === "boolean" ? model.free : false,
    contextLength: Number(model.context_length || model.contextLength || model.context_window || 0) || null,
    created: Number(model.created || model.created_at || 0) || null
  };
}

function normalizeAnthropicModel(model) {
  const id = String(model.id || model.name || "").trim();
  return {
    id,
    label: String(model.display_name || model.name || id).trim(),
    free: false,
    contextLength: Number(model.context_length || model.contextLength || 0) || null,
    created: Number(model.created || model.created_at || 0) || null
  };
}

function dedupeModels(models) {
  const seen = new Set();
  return (models || []).filter((model) => {
    if (!model || !model.id || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function curateOpenRouterModels(models) {
  const routes = [];
  const mainstream = [];
  for (const model of models || []) {
    const family = model.family || openRouterFamily(model);
    if (family === "auto" || family === "free") {
      routes.push({ ...model, family });
    } else if (OPENROUTER_FAMILY_ORDER.includes(family)) {
      mainstream.push({ ...model, family });
    }
  }
  if (!routes.some((model) => model.id === "openrouter/auto")) {
    routes.push({ id: "openrouter/auto", label: "Auto Router", family: "auto", free: false, contextLength: null });
  }
  if (!routes.some((model) => model.id === "openrouter/free")) {
    routes.push({ id: "openrouter/free", label: "Free Models Router", family: "free", free: true, contextLength: null });
  }
  const sortedRoutes = dedupeModels(routes)
    .sort((a, b) => openRouterModelRank(b) - openRouterModelRank(a) || String(a.label).localeCompare(String(b.label)));
  const sortedMainstream = dedupeModels(mainstream)
    .sort((a, b) => openRouterModelRank(b) - openRouterModelRank(a) || String(a.label).localeCompare(String(b.label)));
  return dedupeModels(sortedRoutes.concat(sortedMainstream))
    .slice(0, OPENROUTER_MODEL_LIMIT);
}

function curatedProviderModels(provider, env) {
  const source = env || process.env;
  const curated = CURATED_PROVIDER_MODELS[provider.id] || [];
  const selected = String(source[provider.modelEnv] || provider.defaultModel || "").trim();
  return ensureSelectedModel(curated, selected);
}

function providerModelsUrl(provider, env) {
  const modelList = provider.modelList || {};
  if (modelList.url) return modelList.url;
  const source = env || process.env;
  const baseUrl = String(source[provider.baseUrlEnv] || provider.defaultBaseUrl || "").replace(/\/$/, "");
  const path = String(modelList.path || "/models");
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function providerModelKey(provider, env, explicitApiKey) {
  const byok = typeof explicitApiKey === "string" ? explicitApiKey.trim() : "";
  if (byok) return byok;
  const source = env || process.env;
  return source[provider.keyEnv] || (provider.alternateKeyEnv ? source[provider.alternateKeyEnv] : "") || "";
}

function modelListHeaders(provider, apiKey) {
  const auth = provider.modelList?.auth || "bearer";
  if (auth === "anthropic") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    };
  }
  if (auth === "api-key") return apiKey ? { "api-key": apiKey } : {};
  if (!apiKey && auth === "optional-bearer") return {};
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

function normalizeProviderModels(provider, payload) {
  const data = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];
  const parser = provider.modelList?.parser || "openai-compatible";
  const models = data
    .filter((model) => model && (model.id || model.name))
    .filter((model) => parser !== "openrouter" || modelSupportsText(model))
    .map((model) => {
      if (parser === "openrouter") return normalizeOpenRouterModel(model);
      if (parser === "anthropic") return normalizeAnthropicModel(model);
      return normalizeOpenAICompatibleModel(model);
    });
  const deduped = dedupeModels(models);
  return parser === "openrouter" ? curateOpenRouterModels(deduped) : deduped.slice(0, 240);
}

async function fetchProviderModels(provider, env, options) {
  const now = Date.now();
  const opts = options || {};
  const fetchImpl = opts.fetch || globalThis.fetch;
  const apiKey = providerModelKey(provider, env, opts.apiKey);
  const strictRefresh = Boolean(opts.strict || opts.apiKey);
  const modelList = provider.modelList || {};
  if (!modelList.public && !apiKey) return curatedProviderModels(provider, env);
  if (typeof fetchImpl !== "function") {
    if (strictRefresh) throw new Error(`${provider.id}_models_fetch_unavailable`);
    return curatedProviderModels(provider, env);
  }
  const url = providerModelsUrl(provider, env);
  const cacheKey = `${provider.id}:${url}:${apiKey ? "env-keyed" : "public"}`;
  if (!opts.noCache && !opts.apiKey) {
    const cached = providerModelCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.models;
  }
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: modelListHeaders(provider, apiKey)
    });
    if (!response || !response.ok) throw new Error(`${provider.id}_models_${response ? response.status : "failed"}`);
    const payload = await response.json();
    const models = normalizeProviderModels(provider, payload);
    if (!models.length && strictRefresh) throw new Error(`${provider.id}_models_empty`);
    const resolved = models.length ? ensureSelectedModel(models, (env || process.env)[provider.modelEnv] || provider.defaultModel) : curatedProviderModels(provider, env);
    if (!opts.noCache && !opts.apiKey) providerModelCache.set(cacheKey, { expiresAt: now + MODEL_CACHE_MS, models: resolved });
    return resolved;
  } catch (err) {
    if (strictRefresh) throw err;
    return curatedProviderModels(provider, env);
  }
}

function staticProviderModels(provider, env) {
  const source = env || process.env;
  const model = String(source[provider.modelEnv] || provider.defaultModel || "").trim();
  return model ? [{ id: model, label: model, free: false, contextLength: null }] : [];
}

async function listProviderModels(providerId, env, options) {
  const provider = getProvider(providerId);
  if (!provider) return null;
  const models = await fetchProviderModels(provider, env || process.env, options || {});
  const source = env || process.env;
  return ensureSelectedModel(models, source[provider.modelEnv] || provider.defaultModel);
}

function ensureSelectedModel(models, selectedModel) {
  const selected = String(selectedModel || "").trim();
  if (!selected || models.some((model) => model.id === selected)) return models;
  return [{ id: selected, label: selected, free: false, contextLength: null }, ...models];
}

async function listProviderCatalog(env, options) {
  const opts = options || {};
  const source = env || process.env;
  const providers = listProviders(source);
  return Promise.all(
    providers.map(async (publicProvider) => {
      const provider = getProvider(publicProvider.id);
      const fetchedModels = provider.modelList
        ? await fetchProviderModels(provider, source, opts)
        : staticProviderModels(provider, source);
      const models = ensureSelectedModel(fetchedModels, publicProvider.model);
      return {
        ...publicProvider,
        models
      };
    })
  );
}

module.exports = {
  PROVIDERS,
  getProvider,
  listProviders,
  listProviderCatalog,
  listProviderModels
};
