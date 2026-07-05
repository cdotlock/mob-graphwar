"use strict";

const { validateAgentDecision } = require("../../src/agents/contract.js");
const { buildAnthropicRequest } = require("./anthropic.js");
const { buildOpenAICompatibleRequest } = require("./openai-compatible.js");
const { normalizeProviderDecision } = require("./normalize.js");

function resolveApiKey(provider, body, env) {
  const byok = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (byok) return byok;
  const source = env || process.env;
  return source[provider.keyEnv] || (provider.alternateKeyEnv ? source[provider.alternateKeyEnv] : "") || "";
}

function buildProviderRequest(provider, payload, apiKey) {
  if (provider.adapter === "anthropic") {
    return buildAnthropicRequest(provider, payload, apiKey);
  }
  return buildOpenAICompatibleRequest(provider, payload, apiKey);
}

function extractOpenAIText(json) {
  const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === "string" ? item : item && item.text ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return content || "";
}

function extractAnthropicText(json) {
  const content = json && json.content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === "string" ? item : item && item.text ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return content || "";
}

function extractProviderText(provider, json) {
  return provider.adapter === "anthropic" ? extractAnthropicText(json) : extractOpenAIText(json);
}

async function executeProviderDecision(provider, payload, options) {
  const opts = options || {};
  const fetchFn = opts.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch_unavailable");

  const apiKey = resolveApiKey(provider, payload, opts.env);
  if (!apiKey) throw new Error("missing_api_key");

  const request = buildProviderRequest(provider, payload, apiKey);
  const response = await fetchFn(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body)
  });
  if (!response || !response.ok) {
    const err = new Error("provider_http_error");
    err.status = response && response.status;
    throw err;
  }

  const json = await response.json();
  const decision = normalizeProviderDecision(extractProviderText(provider, json));
  const validation = validateAgentDecision(decision, payload.candidates);
  if (!validation.ok) {
    const err = new Error(validation.reason);
    err.validation = validation;
    throw err;
  }
  return {
    decision: {
      candidateId: validation.candidate.candidateId,
      publicReason: validation.publicReason
    },
    candidate: validation.candidate
  };
}

module.exports = {
  buildProviderRequest,
  executeProviderDecision,
  extractProviderText,
  resolveApiKey
};
