"use strict";

const PROVIDERS = [
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

module.exports = {
  PROVIDERS,
  getProvider,
  listProviders
};
