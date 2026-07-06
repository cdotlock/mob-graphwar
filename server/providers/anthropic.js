"use strict";

function buildAnthropicRequest(provider, payload, apiKey) {
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
