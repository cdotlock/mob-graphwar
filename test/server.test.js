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
  assert.strictEqual(providers.json.defaultProvider, "deepseek");
  assert.ok(!JSON.stringify(providers.json).includes("sk-test"), "response should redact keys");
}

async function testStaticServerOnlyServesMainEntrypoint() {
  const main = await request(createServer({ env: {} }), "/index.html");
  assert.strictEqual(main.status, 200);
  assert.ok(main.text.includes("Mob Graphwar Arena"));
  assert.ok(main.text.includes('<div id="root"></div>'), "entrypoint should mount the React game shell");
  assert.ok(main.text.includes("/src/sim-core.js"), "entrypoint should load the simulation engine");
  assert.ok(
    main.text.includes("/src/main.jsx") || main.text.includes("/assets/"),
    "entrypoint should load either the dev React app or the built bundle"
  );

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

async function testLoginMatchmakingAndRankLoop() {
  const session = await request(createServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Clock",
      providers: {
        deepseek: { apiKey: "sk-user", model: "deepseek-v4-flash" },
        openai: { apiKey: "", model: "gpt-4.1-mini" }
      }
    })
  });
  assert.strictEqual(session.status, 200);
  assert.ok(session.json.player && session.json.player.id, "login should create a player session");
  assert.strictEqual(session.json.player.rank.rating, 1000);
  assert.ok(!session.text.includes("sk-user"), "session response should not echo API keys");

  const match = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(match.status, 200);
  assert.strictEqual(match.json.match.mode, "ranked_2v2");
  assert.ok(match.json.match.roster.filter((seat) => seat.control === "ai").length >= 3, "empty matchmaking should fill seats with AI");
  assert.ok(match.json.match.state.mapMeta.difficulty >= 90, "ranked match should use complex maps");

  const result = await request(createServer({ env: {} }), `/api/match/${match.json.match.id}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.json.player.id })
  });
  assert.strictEqual(result.status, 200);
  assert.ok(result.json.rankDelta !== 0, "resolved ranked match should award or remove rank points");
  assert.ok(Number.isFinite(result.json.player.rank.rating), "resolved ranked match should return updated rank");
}

async function testMatchActionsMutateAuthoritativeState() {
  const session = await request(createServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Commander", providers: { deepseek: { apiKey: "", model: "local" } } })
  });
  assert.strictEqual(session.status, 200);

  const joined = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(joined.status, 200);
  const matchId = joined.json.match.id;
  const originalHand = joined.json.match.state.hands.A.cards.map((card) => card.instanceId).join("|");

  const rerolled = await request(createServer({ env: {} }), `/api/match/${matchId}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.json.player.id, action: "reroll" })
  });
  assert.strictEqual(rerolled.status, 200);
  assert.strictEqual(rerolled.json.action.action, "reroll");
  assert.strictEqual(rerolled.json.action.team, "A");
  assert.strictEqual(rerolled.json.match.state.turn, 0, "reroll should not consume the turn");
  assert.strictEqual(rerolled.json.match.state.hands.A.rerollsUsed, 1);
  assert.notStrictEqual(
    rerolled.json.match.state.hands.A.cards.map((card) => card.instanceId).join("|"),
    originalHand,
    "reroll should replace the active hand"
  );

  const fired = await request(createServer({ env: {} }), `/api/match/${matchId}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      playerId: session.json.player.id,
      action: "shot",
      command: "must target B2 with a safe high arc",
      provider: "Test Model"
    })
  });
  assert.strictEqual(fired.status, 200);
  assert.strictEqual(fired.json.action.action, "shot");
  assert.strictEqual(fired.json.action.team, "A");
  assert.strictEqual(fired.json.match.state.turn, 1, "shot should consume the turn");
  assert.strictEqual(fired.json.match.state.events.length, 1);
  assert.strictEqual(fired.json.match.state.events[0].provider, "Test Model");
  assert.strictEqual(fired.json.match.state.events[0].command, "must target B2 with a safe high arc");

  const playedEvent = fired.json.match.state.events[0];
  const resolved = await request(createServer({ env: {} }), `/api/match/${matchId}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.json.player.id })
  });
  assert.strictEqual(resolved.status, 200);
  assert.ok(resolved.json.match.state.events.length >= 1, "resolve should keep played events");
  assert.strictEqual(resolved.json.match.state.events[0].candidateId, playedEvent.candidateId);
  assert.strictEqual(resolved.json.match.state.events[0].result, playedEvent.result);
  assert.strictEqual(resolved.json.match.state.events[0].provider, "Test Model");
  assert.ok(resolved.json.score.turns >= 1, "rank score should include the played turn");
}

async function testProviderShotUsesByokAndValidatesCandidate() {
  let captured;
  const state = require("../src/sim-core.js").createInitialState({ seed: 7351 });
  const fetchMock = async (url, options) => {
    captured = { url, options };
    const payload = JSON.parse(options.body);
    const legalActions = JSON.parse(payload.messages[1].content).legalActions;
    const candidates = legalActions.filter((action) => action.action === "shot");
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
  assert.ok(prompt.legalActions.every((action) => action.mapFit === undefined), "provider candidates should not leak simulated map fit");
  assert.ok(prompt.legalActions.some((action) => action.action === "reroll"), "provider prompt should expose reroll as a legal action");
  assert.ok(!result.text.includes("sk-live-user"), "server response should never echo BYOK key");
}

async function testProviderShotUsesCurrentTurnOrder() {
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
    const candidates = capturedPrompt.legalActions.filter((action) => action.action === "shot");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                candidateId: candidates[0].candidateId,
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
  assert.strictEqual(capturedPrompt.command, "must target A1, low risky direct shot", "server should use the current turn command");
}

async function testProviderCanChooseReroll() {
  const state = require("../src/sim-core.js").createInitialState({ seed: 7351 });
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              action: "reroll",
              publicReason: "Need a different legal hand."
            })
          }
        }
      ]
    })
  });

  const result = await request(createServer({ env: {}, fetch: fetchMock }), "/api/agent/shot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "openai",
      apiKey: "sk-live-user",
      state,
      team: "A",
      command: "find a better lane"
    })
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.json.decision.action, "reroll");
  assert.strictEqual(result.json.candidate, null);
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
  await testLoginMatchmakingAndRankLoop();
  await testMatchActionsMutateAuthoritativeState();
  await testProviderShotUsesByokAndValidatesCandidate();
  await testProviderShotUsesCurrentTurnOrder();
  await testProviderCanChooseReroll();
  await testProviderShotRequiresKey();
  console.log("server tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
