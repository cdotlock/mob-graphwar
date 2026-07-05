"use strict";

const assert = require("assert");
const { createServer } = require("../server/index.js");
const Sim = require("../src/sim-core.js");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
  assert.ok(apiKey, "DEEPSEEK_API_KEY is required for the real DeepSeek smoke test");

  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const seed = Number(process.env.GRAPHWAR_REAL_SEED || 7351);
  const command = process.env.GRAPHWAR_REAL_COMMAND || "target B2, avoid ally, use the clearest legal curve";
  const state = Sim.createInitialState({ seed });
  const server = createServer({
    env: {
      ...process.env,
      GRAPHWAR_ALLOWED_PROVIDERS: "deepseek",
      DEEPSEEK_API_KEY: apiKey,
      DEEPSEEK_MODEL: model
    }
  });
  const address = await listen(server);
  try {
    const response = await fetchWithTimeout(
      `http://127.0.0.1:${address.port}/api/agent/shot`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "deepseek",
          state,
          team: "A",
          command,
          model
        })
      },
      Number(process.env.GRAPHWAR_REAL_TIMEOUT_MS || 45000)
    );
    const text = await response.text();
    assert.ok(!text.includes(apiKey), "server response must not echo the DeepSeek API key");
    assert.strictEqual(response.status, 200, text);
    const payload = JSON.parse(text);
    assert.strictEqual(payload.provider, "deepseek");
    assert.strictEqual(payload.model, model);
    assert.ok(payload.decision && payload.decision.candidateId, "DeepSeek should choose a legal candidate id");
    assert.ok(payload.candidate && payload.candidate.expression, "response should include the validated candidate");

    Sim.applyTurn(state, { A: command }, {
      candidateId: payload.decision.candidateId,
      provider: "DeepSeek",
      providerReason: payload.decision.publicReason
    });
    assert.strictEqual(state.events.length, 1, "validated DeepSeek choice should execute one shot");
    assert.strictEqual(state.events[0].provider, "DeepSeek");

    console.log(
      JSON.stringify({
        ok: true,
        provider: payload.provider,
        model: payload.model,
        candidateId: payload.decision.candidateId,
        result: state.events[0].result,
        combo: state.events[0].combo && state.events[0].combo.name
      })
    );
  } finally {
    await close(server);
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
