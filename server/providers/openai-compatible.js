"use strict";

function buildOpenAICompatibleRequest(provider, payload, apiKey) {
  const isDeepSeek = provider.id === "deepseek";
  const body = {
    model: payload.model || provider.defaultModel,
    temperature: 0.2,
    max_tokens: 260,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Choose exactly one legal Mob Graphwar candidate. Return only valid JSON with candidateId and publicReason. " +
          'EXAMPLE JSON: {"candidateId":"A-0-0-B2-arc","publicReason":"Chose the safest legal high-clearance curve."}'
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
  };
  if (isDeepSeek) {
    body.thinking = { type: "disabled" };
  }
  return {
    url: `${String(payload.baseUrl || provider.defaultBaseUrl).replace(/\/$/, "")}/chat/completions`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body
  };
}

module.exports = {
  buildOpenAICompatibleRequest
};
