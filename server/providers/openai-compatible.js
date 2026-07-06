"use strict";

function buildOpenAICompatibleRequest(provider, payload, apiKey) {
  const isDeepSeek = provider.id === "deepseek";
  const isOpenRouter = provider.id === "openrouter";
  const usesApiKeyHeader = provider.requestAuth === "api-key" || provider.modelList?.auth === "api-key";
  const rulesPayload =
    payload.rulesPayload || {
      rules: {
        actionLimit: "choose exactly one legal action from legalActions: swap_hand or shot",
        handRetention: "cards persist until the active model chooses swap_hand",
        output: "return JSON only"
      },
      command: payload.command,
      state: payload.stateSummary,
      legalActions: [{ action: "swap_hand", swapsRemaining: 3 }].concat(
        (payload.candidates || []).map((candidate) => ({ action: "shot", ...candidate }))
      )
    };
  const body = {
    model: payload.model || provider.defaultModel,
    temperature: 0.2,
    max_tokens: 260,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: JSON.stringify(rulesPayload)
      }
    ]
  };
  if (isDeepSeek) {
    body.thinking = { type: "disabled" };
  }
  if (isOpenRouter) {
    body.include_reasoning = false;
    body.reasoning = { exclude: true };
  }
  return {
    url: `${String(payload.baseUrl || provider.defaultBaseUrl).replace(/\/$/, "")}/chat/completions`,
    headers: {
      "content-type": "application/json",
      ...(usesApiKeyHeader ? { "api-key": apiKey } : { authorization: `Bearer ${apiKey}` })
    },
    body
  };
}

module.exports = {
  buildOpenAICompatibleRequest
};
