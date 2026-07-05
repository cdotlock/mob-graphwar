"use strict";

function buildAnthropicRequest(provider, payload, apiKey) {
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
      system: "Choose exactly one legal Mob Graphwar candidate. Return JSON with candidateId and publicReason.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            command: payload.command,
            candidates: payload.candidates
          })
        }
      ]
    }
  };
}

module.exports = {
  buildAnthropicRequest
};
