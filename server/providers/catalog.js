"use strict";

const PROVIDERS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    adapter: "openai-compatible",
    keyEnv: "OPENROUTER_API_KEY",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    modelEnv: "OPENROUTER_MODEL",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/free"
  },
  {
    id: "openai",
    label: "OpenAI",
    adapter: "openai-compatible",
    keyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    modelEnv: "OPENAI_MODEL",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini"
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    adapter: "openai-compatible",
    keyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    modelEnv: "DEEPSEEK_MODEL",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash"
  },
  {
    id: "minimax",
    label: "MiniMax",
    adapter: "openai-compatible",
    keyEnv: "MINIMAX_API_KEY",
    baseUrlEnv: "MINIMAX_BASE_URL",
    modelEnv: "MINIMAX_MODEL",
    defaultBaseUrl: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M1"
  },
  {
    id: "zhipu",
    label: "Zhipu",
    adapter: "openai-compatible",
    keyEnv: "ZHIPU_API_KEY",
    alternateKeyEnv: "ZAI_API_KEY",
    baseUrlEnv: "ZHIPU_BASE_URL",
    modelEnv: "ZHIPU_MODEL",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash"
  },
  {
    id: "anthropic",
    label: "Anthropic",
    adapter: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-3-5-haiku-latest"
  }
];

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODEL_CACHE_MS = 10 * 60 * 1000;
const OPENROUTER_FREE_MODEL_FALLBACKS = [
  { id: "openrouter/free", label: "Free Models Router", free: true, contextLength: 200000 },
  { id: "cohere/north-mini-code:free", label: "Cohere: North Mini Code (free)", free: true, contextLength: 256000 },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free", label: "Qwen: Qwen3 Next 80B A3B Instruct (free)", free: true, contextLength: 262144 },
  { id: "openai/gpt-oss-120b:free", label: "OpenAI: gpt-oss-120b (free)", free: true, contextLength: 131072 }
];
let openRouterModelCache = { expiresAt: 0, models: null };

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
  const encoded = JSON.stringify(architecture).toLowerCase();
  return encoded.includes("text") || !encoded.includes("image");
}

function normalizeOpenRouterModel(model) {
  return {
    id: String(model.id || "").trim(),
    label: String(model.name || model.id || "").trim(),
    free: true,
    contextLength: Number(model.context_length || model.contextLength || 0) || null
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

async function fetchOpenRouterFreeModels(fetchFn) {
  const now = Date.now();
  if (openRouterModelCache.models && openRouterModelCache.expiresAt > now) return openRouterModelCache.models;
  const fetchImpl = fetchFn || globalThis.fetch;
  if (typeof fetchImpl !== "function") return OPENROUTER_FREE_MODEL_FALLBACKS;
  try {
    const response = await fetchImpl(OPENROUTER_MODELS_URL);
    if (!response || !response.ok) throw new Error(`openrouter_models_${response ? response.status : "failed"}`);
    const payload = await response.json();
    const models = dedupeModels(
      (Array.isArray(payload?.data) ? payload.data : [])
        .filter((model) =>
          model &&
          model.id &&
          priceIsFree(model.pricing?.prompt) &&
          priceIsFree(model.pricing?.completion) &&
          modelSupportsText(model)
        )
        .map(normalizeOpenRouterModel)
    ).slice(0, 40);
    const resolved = models.length ? models : OPENROUTER_FREE_MODEL_FALLBACKS;
    openRouterModelCache = { expiresAt: now + MODEL_CACHE_MS, models: resolved };
    return resolved;
  } catch {
    return OPENROUTER_FREE_MODEL_FALLBACKS;
  }
}

function staticProviderModels(provider, env) {
  const source = env || process.env;
  const model = String(source[provider.modelEnv] || provider.defaultModel || "").trim();
  return model ? [{ id: model, label: model, free: false, contextLength: null }] : [];
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
      const fetchedModels = provider.id === "openrouter"
        ? await fetchOpenRouterFreeModels(opts.fetch)
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
  listProviderCatalog
};
