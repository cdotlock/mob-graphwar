const assert = require("assert");
const { createServer } = require("../server/index.js");

async function request(server, path, options) {
  const address = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, options);
    const text = await response.text();
    const trimmed = text.trim();
    const json = trimmed.startsWith("{") || trimmed.startsWith("[") ? JSON.parse(text) : null;
    return { status: response.status, text, json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testHealthAndProviders() {
  const health = await request(createServer({ env: {} }), "/healthz");
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.json.ok, true);

  const providers = await request(createServer({ env: { OPENAI_API_KEY: "sk-test" } }), "/api/providers");
  assert.strictEqual(providers.status, 200);
  assert.ok(providers.json.providers.some((provider) => provider.id === "openai" && provider.available));
  assert.ok(!JSON.stringify(providers.json).includes("sk-test"), "response should redact keys");
}

async function testStaticServerOnlyServesMainEntrypoint() {
  const main = await request(createServer({ env: {} }), "/index.html");
  assert.strictEqual(main.status, 200);
  assert.ok(main.text.includes("Mob Graphwar"));
  assert.ok(main.text.includes('<textarea id="commandA" maxlength="80"></textarea>'), "Team A should not ship with a default prompt");
  assert.ok(main.text.includes('<textarea id="commandB" maxlength="80"></textarea>'), "Team B should not ship with a default prompt");

  const duplicate = await request(createServer({ env: {} }), "/index%202.html");
  assert.strictEqual(duplicate.status, 404);
  assert.strictEqual(duplicate.json.error, "not_found");
}

async function testInvalidProviderFails() {
  const result = await request(createServer({ env: {} }), "/api/agent/shot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "unknown" })
  });
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.json.error, "unknown_provider");
}

async function testProviderShotUsesByokAndValidatesCandidate() {
  let captured;
  const state = require("../src/sim-core.js").createInitialState({ seed: 7351 });
  const fetchMock = async (url, options) => {
    captured = { url, options };
    const payload = JSON.parse(options.body);
    const candidates = JSON.parse(payload.messages[1].content).candidates;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                candidateId: candidates[0].candidateId,
                publicReason: "Provider chose the clearest legal combo."
              })
            }
          }
        ]
      })
    };
  };

  const result = await request(createServer({ env: {}, fetch: fetchMock }), "/api/agent/shot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "openai",
      apiKey: "sk-live-user",
      state,
      team: "A",
      command: "只打B2，安全高抛越塔，禁用冒险牌，别误伤队友。"
    })
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.json.provider, "openai");
  assert.ok(result.json.decision.candidateId, "response should include selected candidate id");
  assert.ok(result.json.candidate.combo.name, "response should include selected combo");
  assert.ok(captured.url.endsWith("/chat/completions"), "OpenAI-compatible adapter should call chat completions");
  assert.strictEqual(captured.options.headers.authorization, "Bearer sk-live-user");
  const prompt = JSON.parse(JSON.parse(captured.options.body).messages[1].content);
  assert.strictEqual(prompt.state.map.windows, undefined, "provider prompt should not include route windows");
  assert.ok(prompt.candidates.every((candidate) => candidate.mapFit === undefined), "provider candidates should not leak simulated map fit");
  assert.ok(!result.text.includes("sk-live-user"), "server response should never echo BYOK key");
}

async function testProviderShotUsesLockedStateOrder() {
  let capturedPrompt;
  const Sim = require("../src/sim-core.js");
  const lockedOrders = {
    A: "must target B2, high safe arc",
    B: "must target A2, high safe arc"
  };
  const state = Sim.createInitialState({ seed: 7351 });
  Sim.applyTurn(state, lockedOrders);
  const fetchMock = async (url, options) => {
    const payload = JSON.parse(options.body);
    capturedPrompt = JSON.parse(payload.messages[1].content);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                candidateId: capturedPrompt.candidates[0].candidateId,
                publicReason: "Provider followed the locked order."
              })
            }
          }
        ]
      })
    };
  };

  const result = await request(createServer({ env: {}, fetch: fetchMock }), "/api/agent/shot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "openai",
      apiKey: "sk-live-user",
      state,
      team: "B",
      command: "must target A1, low risky direct shot"
    })
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(capturedPrompt.command, lockedOrders.B, "server should prefer locked state order over request body command");
}

async function testProviderShotRequiresKey() {
  const state = require("../src/sim-core.js").createInitialState({ seed: 7351 });
  const result = await request(createServer({ env: {} }), "/api/agent/shot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "openai",
      state,
      team: "A",
      command: "hit B2 high"
    })
  });
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.json.error, "missing_api_key");
}

(async () => {
  await testHealthAndProviders();
  await testStaticServerOnlyServesMainEntrypoint();
  await testInvalidProviderFails();
  await testProviderShotUsesByokAndValidatesCandidate();
  await testProviderShotUsesLockedStateOrder();
  await testProviderShotRequiresKey();
  console.log("server tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
