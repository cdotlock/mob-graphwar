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
            description: "Use shot when writing a function expression; use swap_hand to replace the retained hand."
          },
          targetId: {
            type: "string",
            description: "When action is shot, this must exactly match one allowedTargetIds value. When action is swap_hand, use an empty string."
          },
          expression: {
            type: "string",
            description: "When action is shot, write y=<absolute board y expression> using t,u,d,x,y0,y1,dy. Anchor on y0+dy*t and add scaled allowed current-hand functions. When action is swap_hand, use an empty string."
          },
          cardSlots: {
            type: "array",
            items: { type: "integer" },
            description: "1-based hand card slots used by the expression. Use [] for swap_hand."
          },
          publicReason: {
            type: "string",
            description: "One concise sentence explaining the selected legal action."
          }
        },
        required: ["action", "targetId", "expression", "cardSlots", "publicReason"],
        additionalProperties: false
      }
    }
  };
}

function buildOpenAICompatibleRequest(provider, payload, apiKey) {
  const isDeepSeek = provider.id === "deepseek";
  const isOpenRouter = provider.id === "openrouter";
  const isInfron = provider.id === "infron";
  const usesApiKeyHeader = provider.requestAuth === "api-key" || provider.modelList?.auth === "api-key";
  const rulesPayload =
    payload.rulesPayload || {
      rules: {
        actionLimit: "choose exactly one legal action from legalActions: swap_hand or shot; for shot write your own function expression",
        handRetention: "cards persist until the active model chooses swap_hand",
        expressionCoordinate: "y is absolute board y; start with y0+dy*t and add scaled current-hand function terms",
        output: "return JSON only"
      },
      command: payload.command,
      state: payload.stateSummary,
      legalActions: [
        { action: "swap_hand", swapsRemaining: 3 },
        {
          action: "shot",
          allowedTargetIds: [],
          output: {
            action: "shot",
            targetId: "target unit id",
            expression: "y=<absolute board y expression>",
            cardSlots: [],
            publicReason: "short explanation"
          }
        }
      ]
    };
  const body = {
    model: payload.model || provider.defaultModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: JSON.stringify(rulesPayload)
      }
    ]
  };
  if (payload.strictDecisionSchema && !isDeepSeek) {
    body.response_format = decisionResponseFormat();
  }
  if (isDeepSeek) {
    body.thinking = { type: "disabled" };
  }
  if (isOpenRouter || isInfron) {
    if (payload.reasoning && typeof payload.reasoning === "object") {
      body.reasoning = { ...payload.reasoning };
      if (body.reasoning.max_tokens && body.reasoning.effort) delete body.reasoning.effort;
      const outputBudget = Number(payload.maxTokens) || Number(payload.max_tokens) || 6000;
      body.max_tokens = outputBudget;
      body.max_completion_tokens = Math.max(Number(body.max_completion_tokens) || 0, outputBudget);
      if (isOpenRouter) body.include_reasoning = payload.reasoning.exclude === false;
    } else {
      if (isOpenRouter) {
        body.include_reasoning = false;
        body.reasoning = { exclude: true };
      } else {
        body.reasoning = { effort: "none" };
      }
    }
    if (payload.strictDecisionSchema) {
      if (isOpenRouter) body.plugins = [{ id: "response-healing" }];
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
