"use strict";

function buildOpenAICompatibleRequest(provider, payload, apiKey) {
  return {
    url: `${String(payload.baseUrl || provider.defaultBaseUrl).replace(/\/$/, "")}/chat/completions`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: {
      model: payload.model || provider.defaultModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Choose exactly one legal Mob Graphwar candidate. Return JSON with candidateId and publicReason."
        },
        {
          role: "user",
          content: JSON.stringify({
            command: payload.command,
            state: payload.stateSummary,
            candidates: payload.candidates
          })
        }
      ]
    }
  };
}

module.expor