"use strict";

function decisionResponseFormat() {
  return {
    type: "json_schema",
    json_schema: {
      name: "graphwar_agent_decision",
      strict: true,
      schema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["shot", "swap_hand"],
            description: "Use shot when choosing a listed candidateId; use swap_hand to replace the retained hand."
          },
          candidateId: {
            type: "string",
            description: "When action is shot, this must exactly match one legalActions candidateId. When action is swap_hand, use an empty string."
          },
          publicReason: {
            type: "string",
            description: "One concise sentence explaining the selected legal action."
          }
        },
        required: ["action", "candidateId", "publicReason"],
        additionalProperties: false
      }
    }
  };
}

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
  if (payload.strictDecisionSchema) {
    body.response_format = decisionResponseFormat();
  }
  if (isDeepSeek) {
    body.thinking = { type: "disabled" };
  }
  if (isOpenRouter) {
    if (payload.reasoning && typeof payload.reasoning === "object") {
      body.include_reasoning = payload.reasoning.exclude === false;
      body.reasoning = { ...payload.reasoning };
      if (body.reasoning.max_tokens && body.reasoning.effort) delete body.reasoning.effort;
      body.max_tokens = Math.max(body.max_tokens, Number(payload.maxTokens) || 6000);
      body.max_completion_tokens = Math.max(Number(body.max_completion_tokens) || 0, body.max_tokens);
    } else {
      body.include_reasoning = false;
      body.reasoning = { exclude: true };
    }
    if (payload.strictDecisionSchema) {
      body.plugins = [{ id: "response-healing" }];
    }
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
  buildOpenAICompatibleRequest,
  decisionResponseFormat
};
