"use strict";

function buildAnthropicRequest(provider, payload, apiKey) {
  const rulesPayload =
    payload.rulesPayload || {
      rules: {
        actionLimit: "choose exactly one legal action from legalActions",
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
      system:
        'Return only valid JSON. For a shot, return {"action":"shot","candidateId":"...","publicReason":"..."}. ' +
        'For a hand swap, return {"action":"swap_hand","publicReason":"..."}. Use only legalActions from the user payload.',
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
