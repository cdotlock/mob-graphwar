"use strict";

function buildAnthropicRequest(provider, payload, apiKey) {
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
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: {
      model: payload.model || provider.defaultModel,
      max_tokens: 240,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: JSON.stringify(rulesPayload)
        }
      ]
    }
  };
}

module.exports = {
  buildAnthropicRequest
};
