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

function providerTimeoutMs(options) {
  const opts = options || {};
  const source = opts.env || process.env;
  const raw = opts.timeoutMs ?? source.GRAPHWAR_REQUEST_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20_000;
  return Math.min(parsed, 120_000);
}

async function fetchWithTimeout(fetchFn, url, request, timeoutMs) {
  if (typeof AbortController !== "function" || request.signal) {
    return fetchFn(url, request);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...request, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted || err.name === "AbortError") {
      const timeoutError = new Error("provider_timeout");
      timeoutError.timeoutMs = timeoutMs;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function providerTimeoutError(timeoutMs) {
  const timeoutError = new Error("provider_timeout");
  timeoutError.timeoutMs = timeoutMs;
  return timeoutError;
}

async function runWithProviderTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(providerTimeoutError(timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function executeProviderDecision(provider, payload, options) {
  const opts = options || {};
  const fetchFn = opts.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch_unavailable");

  const apiKey = resolveApiKey(provider, payload, opts.env);
  if (!apiKey) throw new Error("missing_api_key");

  const timeoutMs = providerTimeoutMs(opts);
  return runWithProviderTimeout(async () => {
    const request = buildProviderRequest(provider, payload, apiKey);
    const response = await fetchWithTimeout(
      fetchFn,
      request.url,
      {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body)
      },
      timeoutMs
    );
    if (!response || !response.ok) {
      const err = new Error("provider_http_error");
      err.status = response && response.status;
      throw err;
    }

    const json = await response.json();
    const decision = normalizeProviderDecision(extractProviderText(provider, json));
    const validation = validateAgentDecision(
      decision,
      payload.rulesPayload && payload.rulesPayload.legalActions ? payload.rulesPayload.legalActions : payload.candidates
    );
    if (!validation.ok) {
      const err = new Error(validation.reason);
      err.validation = validation;
      throw err;
    }
    if (validation.action === "swap_hand") {
      return {
        decision: {
          action: "swap_hand",
          publicReason: validation.publicReason
        },
        candidate: null
      };
    }
    return {
      decision: {
        action: "shot",
        candidateId: validation.candidate.candidateId,
        publicReason: validation.publicReason
      },
      candidate: validation.candidate
    };
  }, timeoutMs);
}

module.exports = {
  buildProviderRequest,
  executeProviderDecision,
  extractProviderText,
  fetchWithTimeout,
  runWithProviderTimeout,
  providerTimeoutMs,
  resolveApiKey
};
