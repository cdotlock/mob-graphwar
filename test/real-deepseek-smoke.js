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
    assert.ok(payload.decision, "DeepSeek should return a validated decision");
    assert.ok(["shot", "swap_hand"].includes(payload.decision.action), "DeepSeek should choose a legal action");

    let result = null;
    let combo = null;
    if (payload.decision.action === "swap_hand") {
      const before = Sim.getCurrentHand(state, "A").map((card) => card.instanceId);
      const swap = Sim.applyTurn(state, {}, { action: "swap_hand" });
      const after = swap.cards.map((card) => card.instanceId);
      assert.notDeepStrictEqual(after, before, "validated swap_hand should change the active hand");
      assert.strictEqual(state.events.length, 0, "swap_hand should not execute a shot");
      result = "swap_hand";
    } else {
      assert.ok(payload.decision.targetId, "DeepSeek shot should choose a target id");
      assert.ok(payload.decision.expression, "DeepSeek shot should write a function expression");
      Sim.applyTurn(state, { A: command }, {
        targetId: payload.decision.targetId,
        expression: payload.decision.expression,
        cardSlots: payload.decision.cardSlots || [],
        provider: "DeepSeek",
        providerReason: payload.decision.publicReason
      });
      assert.strictEqual(state.events.length, 1, "validated DeepSeek choice should execute one shot");
      assert.strictEqual(state.events[0].provider, "DeepSeek");
      result = state.events[0].result;
      combo = state.events[0].combo && state.events[0].combo.name;
    }

    console.log(
      JSON.stringify({
        ok: true,
        provider: payload.provider,
        model: payload.model,
        action: payload.decision.action,
        targetId: payload.decision.targetId || null,
        expression: payload.decision.expression || "",
        result,
        combo
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
