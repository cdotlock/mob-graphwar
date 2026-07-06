const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
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

function authHeaders(session, extra) {
  const token = session?.json?.sessionToken || session?.sessionToken;
  return {
    ...(extra || {}),
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
}

function providerRulesPayload(requestBody) {
  const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
  const userMessage = messages.slice().reverse().find((message) => message.role === "user");
  assert.ok(userMessage && typeof userMessage.content === "string", "provider request should include a user rules payload");
  return JSON.parse(userMessage.content);
}

async function testHealthAndProviders() {
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        {
          id: "cohere/north-mini-code:free",
          name: "Cohere: North Mini Code (free)",
          pricing: { prompt: "0", completion: "0" },
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
          context_length: 256000
        }
      ]
    })
  });
  const health = await request(createServer({ env: {} }), "/healthz");
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.json.ok, true);

  const providers = await request(createServer({ env: { OPENAI_API_KEY: "sk-test", OPENROUTER_API_KEY: "sk-router" }, fetch: fetchMock }), "/api/providers");
  assert.strictEqual(providers.status, 200);
  assert.ok(providers.json.providers.some((provider) => provider.id === "openai" && provider.available));
  assert.ok(
    providers.json.providers.some((provider) =>
      provider.id === "openrouter" &&
      provider.available &&
      Array.isArray(provider.models) &&
      provider.models.some((model) => model.id === "cohere/north-mini-code:free")
    ),
    "OpenRouter free model list should be exposed as selectable provider options"
  );
  assert.strictEqual(providers.json.defaultProvider, "openrouter");
  assert.ok(!JSON.stringify(providers.json).includes("sk-test"), "response should redact keys");
  assert.ok(!JSON.stringify(providers.json).includes("sk-router"), "response should redact OpenRouter keys");
}

async function testProviderModelsEndpointUsesByokForLiveCatalog() {
  let captured;
  const fetchMock = async (url, options) => {
    captured = { url: String(url), headers: options?.headers || {} };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "gpt-live-byok", object: "model" }] })
    };
  };
  const result = await request(createServer({ env: {}, fetch: fetchMock }), "/api/providers/openai/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "sk-user-models" })
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.json.provider, "openai");
  assert.ok(result.json.models.some((model) => model.id === "gpt-live-byok"), "BYOK model refresh should return live models");
  assert.strictEqual(captured.url, "https://api.openai.com/v1/models");
  assert.strictEqual(captured.headers.authorization, "Bearer sk-user-models");
  assert.ok(!result.text.includes("sk-user-models"), "model refresh response should not leak the BYOK key");
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
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(match.status, 200);
  assert.strictEqual(match.json.match.mode, "ranked_team_1v1");
  assert.strictEqual(match.json.match.roster.filter((seat) => seat.control === "ai").length, 2, "empty matchmaking should fill one opposing AI commander");
  assert.deepStrictEqual(
    match.json.match.roster.filter((seat) => seat.playerId === session.json.player.id).map((seat) => seat.unitId),
    ["A1", "A2"],
    "one player should command both allied agents"
  );
  assert.ok(match.json.match.state.mapMeta.difficulty >= 90, "ranked match should use complex maps");
  assert.strictEqual(match.json.match.state.mapMeta.complexity.generator, "poisson-blob-search", "ranked match should expose the map generator");
  assert.strictEqual(match.json.match.state.bonusPoints.length, 3, "ranked match should expose a small set of route bonus points to spectators");

  const result = await request(createServer({ env: {} }), `/api/match/${match.json.match.id}/resolve`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id })
  });
  assert.strictEqual(result.status, 200);
  assert.ok(result.json.rankDelta !== 0, "resolved ranked match should award or remove rank points");
  assert.ok(Number.isFinite(result.json.player.rank.rating), "resolved ranked match should return updated rank");
}

async function testAiFallbackSeatsDefaultToOpenRouterFreePrompts() {
  const session = await request(createServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "OpenRouter Fill",
      providers: {
        openrouter: { apiKey: "", model: "openrouter/free" }
      }
    })
  });
  assert.strictEqual(session.status, 200);

  const match = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ preferredProvider: "openrouter", allowAiFill: true })
  });
  assert.strictEqual(match.status, 200);
  const aiSeats = match.json.match.roster.filter((seat) => seat.control === "ai");
  assert.strictEqual(aiSeats.length, 2, "AI fill should create one opposing commander controlling B1 and B2");
  assert.deepStrictEqual(aiSeats.map((seat) => seat.unitId), ["B1", "B2"]);
  assert.strictEqual(new Set(aiSeats.map((seat) => seat.commanderId)).size, 1, "AI-filled B1/B2 should share one commander id");
  assert.ok(aiSeats.every((seat) => seat.provider === "openrouter"), "AI-filled seats should default to OpenRouter");
  assert.ok(aiSeats.every((seat) => seat.model === "openrouter/free"), "AI-filled seats should default to an OpenRouter free model");
  assert.ok(aiSeats.every((seat) => seat.standingOrderConfigured), "AI-filled seats should carry default prompts");
  assert.ok(aiSeats.every((seat) => seat.standingOrderLength > 20), "default AI prompts should be meaningful without being exposed");
}

function freshCreateServer() {
  const serverPath = require.resolve("../server/index.js");
  delete require.cache[serverPath];
  return require("../server/index.js").createServer;
}

async function testProfileRankAndLeaderboardPersistAcrossRestart() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphwar-store-"));
  const dataFile = path.join(dataDir, "store.json");
  const env = { GRAPHWAR_DATA_FILE: dataFile };
  const createPersistentServer = freshCreateServer();

  const session = await request(createPersistentServer({ env }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Persisted",
      providers: {
        deepseek: { apiKey: "persist-secret", model: "deepseek-v4-flash" }
      }
    })
  });
  assert.strictEqual(session.status, 200);
  assert.ok(fs.existsSync(dataFile), "session creation should persist the player store");
  assert.ok(!session.text.includes("persist-secret"), "session response should not echo API keys");

  const playerId = session.json.player.id;
  const match = await request(createPersistentServer({ env }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId, preferredProvider: "deepseek" })
  });
  assert.strictEqual(match.status, 200);

  const resolved = await request(createPersistentServer({ env }), `/api/match/${match.json.match.id}/resolve`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId })
  });
  assert.strictEqual(resolved.status, 200);
  const settledRating = resolved.json.player.rank.rating;
  assert.notStrictEqual(settledRating, 1000, "rank settlement should mutate persistent rating");

  const restartedCreateServer = freshCreateServer();
  const restored = await request(restartedCreateServer({ env }), `/api/session/${playerId}`, {
    headers: authHeaders(session)
  });
  assert.strictEqual(restored.status, 200);
  assert.strictEqual(restored.json.player.id, playerId);
  assert.strictEqual(restored.json.player.rank.rating, settledRating);
  assert.ok(!restored.text.includes("persist-secret"), "restored profile should not expose API keys");

  const leaderboard = await request(restartedCreateServer({ env }), "/api/leaderboard");
  assert.strictEqual(leaderboard.status, 200);
  assert.ok(
    leaderboard.json.players.some((player) => player.id === playerId && player.rating === settledRating),
    "leaderboard should include restored ranked player"
  );
  assert.ok(!leaderboard.text.includes("persist-secret"), "leaderboard should not expose API keys");
}

async function testRegisterLoginAndProviderUpdatePersistAcrossRestart() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphwar-auth-"));
  const dataFile = path.join(dataDir, "store.json");
  const env = { GRAPHWAR_DATA_FILE: dataFile };
  const createPersistentServer = freshCreateServer();

  const registered = await request(createPersistentServer({ env }), "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      handle: "Clock_AI",
      displayName: "Clock Auth",
      password: "Swordfish!9",
      providers: {
        deepseek: { apiKey: "sk-auth-register", model: "deepseek-v4-flash" }
      }
    })
  });
  assert.strictEqual(registered.status, 200);
  assert.strictEqual(registered.json.player.handle, "clock_ai");
  assert.strictEqual(registered.json.player.displayName, "Clock Auth");
  assert.strictEqual(registered.json.player.rank.rating, 1000);
  assert.strictEqual(registered.json.player.providers.deepseek.configured, true);
  assert.ok(!registered.text.includes("sk-auth-register"), "register response should not echo API keys");
  assert.ok(!registered.text.includes("passwordHash"), "register response should not expose password hash");
  assert.ok(!registered.text.includes("passwordSalt"), "register response should not expose password salt");

  const duplicate = await request(createPersistentServer({ env }), "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "clock_ai", displayName: "Dup", password: "Swordfish!9" })
  });
  assert.strictEqual(duplicate.status, 409);
  assert.strictEqual(duplicate.json.error, "handle_taken");

  const badPassword = await request(createPersistentServer({ env }), "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "clock_ai", password: "wrong-password" })
  });
  assert.strictEqual(badPassword.status, 401);
  assert.strictEqual(badPassword.json.error, "invalid_credentials");

  const restartedCreateServer = freshCreateServer();
  const loggedIn = await request(restartedCreateServer({ env }), "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      handle: "CLOCK_AI",
      password: "Swordfish!9",
      providers: {
        openai: { apiKey: "sk-auth-login", model: "gpt-4.1-mini" }
      }
    })
  });
  assert.strictEqual(loggedIn.status, 200);
  assert.strictEqual(loggedIn.json.player.id, registered.json.player.id);
  assert.strictEqual(loggedIn.json.player.handle, "clock_ai");
  assert.strictEqual(loggedIn.json.player.providers.openai.model, "gpt-4.1-mini");
  assert.strictEqual(loggedIn.json.player.providers.openai.configured, true);
  assert.ok(!loggedIn.text.includes("sk-auth-login"), "login response should not echo API keys");
  assert.ok(!loggedIn.text.includes("Swordfish!9"), "login response should not echo password");
  assert.ok(!loggedIn.text.includes("passwordHash"), "login response should not expose password hash");

  const stored = fs.readFileSync(dataFile, "utf8");
  assert.ok(stored.includes("passwordHash"), "persistent store should keep a password verifier");
  assert.ok(!stored.includes("Swordfish!9"), "persistent store should not keep raw passwords");
  assert.ok(!stored.includes("sk-auth-register"), "persistent store should not keep registration API keys");
  assert.ok(!stored.includes("sk-auth-login"), "persistent store should not keep login API keys");
}

async function testSessionTokenProtectsRankedAndProviderRoutes() {
  const registered = await request(createServer({ env: {} }), "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      handle: "ranked_secure",
      displayName: "Ranked Secure",
      password: "Swordfish!10",
      providers: {
        deepseek: { apiKey: "sk-session-register", model: "deepseek-v4-flash" }
      }
    })
  });
  assert.strictEqual(registered.status, 200);
  assert.ok(registered.json.sessionToken, "register should return a session token");
  assert.ok(!registered.text.includes("sk-session-register"), "register response should not leak provider keys");

  const restored = await request(createServer({ env: {} }), "/api/session/me", {
    headers: authHeaders(registered)
  });
  assert.strictEqual(restored.status, 200);
  assert.strictEqual(restored.json.player.id, registered.json.player.id);

  const noProviderSession = await request(createServer({ env: {} }), "/api/profile/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providers: { openai: { apiKey: "sk-no-session", model: "gpt-4.1-mini" } } })
  });
  assert.strictEqual(noProviderSession.status, 401);
  assert.strictEqual(noProviderSession.json.error, "missing_session");

  const badProviderSession = await request(createServer({ env: {} }), "/api/profile/providers", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer bad-token" },
    body: JSON.stringify({ providers: { openai: { apiKey: "sk-bad-session", model: "gpt-4.1-mini" } } })
  });
  assert.strictEqual(badProviderSession.status, 401);
  assert.strictEqual(badProviderSession.json.error, "invalid_session");

  const updated = await request(createServer({ env: {} }), "/api/profile/providers", {
    method: "POST",
    headers: authHeaders(registered, { "content-type": "application/json" }),
    body: JSON.stringify({
      providers: {
        anthropic: { apiKey: "sk-provider-session", model: "claude-3-5-haiku-latest" }
      }
    })
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.json.player.providers.anthropic.configured, true);
  assert.strictEqual(updated.json.player.providers.anthropic.model, "claude-3-5-haiku-latest");
  assert.ok(!updated.text.includes("sk-provider-session"), "provider update response should not leak API keys");

  const noJoinSession = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: registered.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(noJoinSession.status, 401);
  assert.strictEqual(noJoinSession.json.error, "missing_session");

  const badJoinSession = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer bad-token" },
    body: JSON.stringify({ playerId: registered.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(badJoinSession.status, 401);
  assert.strictEqual(badJoinSession.json.error, "invalid_session");

  const joined = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(registered, { "content-type": "application/json" }),
    body: JSON.stringify({ preferredProvider: "anthropic" })
  });
  assert.strictEqual(joined.status, 200);
  assert.strictEqual(joined.json.match.roster[0].playerId, registered.json.player.id);
  assert.strictEqual(joined.json.match.roster[0].provider, "anthropic");

  const rules = await request(createServer({ env: {} }), `/api/match/${joined.json.match.id}/rules?command=safe%20arc`, {
    headers: authHeaders(registered)
  });
  assert.strictEqual(rules.status, 200);
  assert.strictEqual(rules.json.requesterSeat.playerId, registered.json.player.id);

  const noDuelSession = await request(createServer({ env: {} }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: registered.json.player.id })
  });
  assert.strictEqual(noDuelSession.status, 401);
  assert.strictEqual(noDuelSession.json.error, "missing_session");

  const autoDuel = await request(createServer({ env: {} }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: authHeaders(registered, { "content-type": "application/json" }),
    body: JSON.stringify({ command: "safe arc" })
  });
  assert.strictEqual(autoDuel.status, 200);
  assert.strictEqual(autoDuel.json.match.status, "resolved");
  assert.ok(!autoDuel.text.includes("sk-provider-session"), "auto duel should not leak stored provider keys");
}

async function createTestPlayer(displayName) {
  const session = await request(createServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName,
      providers: { deepseek: { apiKey: `${displayName}-secret`, model: "deepseek-v4-flash" } }
    })
  });
  assert.strictEqual(session.status, 200);
  assert.ok(!session.text.includes(`${displayName}-secret`), "session should redact player API key");
  return { ...session.json.player, sessionToken: session.json.sessionToken };
}

async function testHumanMatchmakingQueueCanFormRanked2v2() {
  const players = [];
  for (const name of ["Alpha", "Bravo"]) {
    players.push(await createTestPlayer(name));
  }

  const queued = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(players[0], { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: players[0].id, preferredProvider: "deepseek", allowAiFill: false })
  });
  assert.strictEqual(queued.status, 202);
  assert.strictEqual(queued.json.status, "queued");
  assert.strictEqual(queued.json.queueSize, 1);
  assert.strictEqual(queued.json.needed, 1);
  assert.ok(!queued.text.includes(`${players[0].displayName}-secret`), "queue response should not leak API keys");

  const matched = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(players[1], { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: players[1].id, preferredProvider: "deepseek", allowAiFill: false })
  });
  assert.strictEqual(matched.status, 200);
  assert.strictEqual(matched.json.match.status, "matched");
  assert.strictEqual(matched.json.match.filledByAi, false);
  assert.strictEqual(matched.json.match.roster.filter((seat) => seat.control === "human").length, 4);
  assert.deepStrictEqual(
    matched.json.match.roster.map((seat) => [seat.unitId, seat.playerId]),
    [["A1", players[0].id], ["A2", players[0].id], ["B1", players[1].id], ["B2", players[1].id]],
    "matchmaker should split two commanders into two two-agent teams"
  );
  assert.ok(!matched.text.includes("Alpha-secret"), "match response should not leak queued player keys");
}

async function testHumanMatchmakingStoresLaunchOrdersPerSeat() {
  const capturedPrompts = [];
  const fetchMock = async (url, options) => {
    const requestBody = JSON.parse(options.body);
    const prompt = providerRulesPayload(requestBody);
    const candidates = prompt.legalActions.filter((action) => action.action === "shot");
    capturedPrompts.push({ url, options, requestBody, prompt });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(candidates[0]
                ? {
                    action: "shot",
                    candidateId: candidates[0].candidateId,
                    publicReason: "Provider followed the launch order."
                  }
                : {
                    action: "swap_hand",
                    publicReason: "Provider needed a legal firing hand."
                  })
            }
          }
        ]
      })
    };
  };
  const players = [];
  const launchOrders = [
    "alpha locks B1 with safe high arc",
    "bravo bends low toward A1"
  ];
  for (const name of ["OrderAlpha", "OrderBravo"]) {
    const session = await request(createServer({ env: {} }), "/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: name,
        providers: { openai: { apiKey: `${name}-order-secret`, model: "gpt-order" } }
      })
    });
    assert.strictEqual(session.status, 200);
    players.push({ ...session.json.player, sessionToken: session.json.sessionToken });
  }

  const queued = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(players[0], { "content-type": "application/json" }),
    body: JSON.stringify({
      playerId: players[0].id,
      preferredProvider: "openai",
      allowAiFill: false,
      standingOrder: launchOrders[0]
    })
  });
  assert.strictEqual(queued.status, 202);
  assert.ok(!queued.text.includes(launchOrders[0]), "queue response should not leak launch orders");

  const matched = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(players[1], { "content-type": "application/json" }),
    body: JSON.stringify({
      playerId: players[1].id,
      preferredProvider: "openai",
      allowAiFill: false,
      standingOrder: launchOrders[1]
    })
  });
  assert.strictEqual(matched.status, 200);
  assert.deepStrictEqual(
    matched.json.match.roster.map((seat) => [seat.unitId, seat.standingOrderConfigured]),
    [["A1", true], ["A2", true], ["B1", true], ["B2", true]],
    "matched roster should expose that both team commanders armed both agents without exposing the text"
  );
  assert.deepStrictEqual(
    matched.json.match.roster.map((seat) => [seat.unitId, seat.commanderId]),
    [["A1", players[0].id], ["A2", players[0].id], ["B1", players[1].id], ["B2", players[1].id]],
    "same team agents should share the same commander id"
  );
  for (const order of launchOrders) {
    assert.ok(!matched.text.includes(order), "match response should not leak launch order text");
  }

  const autoDuel = await request(createServer({ env: {}, fetch: fetchMock }), `/api/match/${matched.json.match.id}/auto-duel`, {
    method: "POST",
    headers: authHeaders(players[0], { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: players[0].id })
  });
  assert.strictEqual(autoDuel.status, 200);
  const firstPromptByUnit = new Map();
  for (const captured of capturedPrompts) {
    if (!firstPromptByUnit.has(captured.prompt.activeUnitId)) {
      firstPromptByUnit.set(captured.prompt.activeUnitId, captured.prompt.command);
    }
  }
  assert.strictEqual(firstPromptByUnit.get("A1"), launchOrders[0]);
  assert.strictEqual(firstPromptByUnit.get("A2"), launchOrders[0]);
  assert.strictEqual(firstPromptByUnit.get("B1"), launchOrders[1]);
  assert.strictEqual(firstPromptByUnit.get("B2"), launchOrders[1]);
  for (const order of launchOrders) {
    assert.ok(!autoDuel.text.includes(order), "auto duel response should not leak other players' launch orders");
  }
}

async function testQueuedPlayersCanPollMatchedRoom() {
  const players = [];
  for (const name of ["Echo", "Flux"]) {
    players.push(await createTestPlayer(name));
  }

  const queued = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(players[0], { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: players[0].id, preferredProvider: "deepseek", allowAiFill: false })
  });
  assert.strictEqual(queued.status, 202);

  const waiting = await request(createServer({ env: {} }), `/api/matchmaking/${players[0].id}`, {
    headers: authHeaders(players[0])
  });
  assert.strictEqual(waiting.status, 200);
  assert.strictEqual(waiting.json.status, "queued");
  assert.strictEqual(waiting.json.queueSize, 1);
  assert.strictEqual(waiting.json.position, 1);
  assert.strictEqual(waiting.json.needed, 1);

  const matched = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(players[1], { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: players[1].id, preferredProvider: "deepseek", allowAiFill: false })
  });
  assert.strictEqual(matched.status, 200);
  const matchId = matched.json.match.id;

  const synced = await request(createServer({ env: {} }), `/api/matchmaking/${players[0].id}`, {
    headers: authHeaders(players[0])
  });
  assert.strictEqual(synced.status, 200);
  assert.strictEqual(synced.json.status, "matched");
  assert.strictEqual(synced.json.match.id, matchId);
  assert.strictEqual(synced.json.match.roster.filter((seat) => seat.control === "human").length, 4);
  assert.strictEqual(new Set(synced.json.match.roster.map((seat) => seat.playerId)).size, 2);
  assert.ok(!synced.text.includes("Echo-secret"), "matchmaking poll should not leak API keys");

  const fetched = await request(createServer({ env: {} }), `/api/match/${matchId}?playerId=${players[0].id}`, {
    headers: authHeaders(players[0])
  });
  assert.strictEqual(fetched.status, 200);
  assert.strictEqual(fetched.json.match.id, matchId);
  assert.ok(fetched.json.match.roster.some((seat) => seat.playerId === players[0].id), "fetched match should include requesting player");
  assert.ok(!fetched.text.includes("Flux-secret"), "match fetch should not leak API keys");
}

async function testRankedMatchRejectsMidDuelManualActions() {
  const session = await request(createServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Commander", providers: { deepseek: { apiKey: "", model: "local" } } })
  });
  assert.strictEqual(session.status, 200);

  const joined = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(joined.status, 200);
  const matchId = joined.json.match.id;

  const rerolled = await request(createServer({ env: {} }), `/api/match/${matchId}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.json.player.id, action: "swap_hand" })
  });
  assert.strictEqual(rerolled.status, 410);
  assert.strictEqual(rerolled.json.error, "manual_actions_disabled");

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
  assert.strictEqual(fired.status, 410);
  assert.strictEqual(fired.json.error, "manual_actions_disabled");

  const fetched = await request(createServer({ env: {} }), `/api/match/${matchId}?playerId=${session.json.player.id}`, {
    headers: authHeaders(session)
  });
  assert.strictEqual(fetched.status, 200);
  assert.strictEqual(fetched.json.match.state.turn, 0, "rejected manual actions must not consume turns");
  assert.strictEqual(fetched.json.match.state.events.length, 0, "rejected manual actions must not create events");

  const autoDuel = await request(createServer({ env: {} }), `/api/match/${matchId}/auto-duel`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id })
  });
  assert.strictEqual(autoDuel.status, 200);
  assert.strictEqual(autoDuel.json.match.status, "resolved");
  assert.ok(autoDuel.json.autoBattle.resolvedTurns >= 1, "auto duel should be the only ranked play path");
}

async function testAutoDuelResolvesRankedMatchWithBattleSummary() {
  const session = await request(createServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "AutoDuelist",
      providers: { deepseek: { apiKey: "", model: "local" } }
    })
  });
  assert.strictEqual(session.status, 200);

  const joined = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(joined.status, 200);

  const autoDuel = await request(createServer({ env: {} }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id })
  });
  assert.strictEqual(autoDuel.status, 200);
  assert.strictEqual(autoDuel.json.match.status, "resolved");
  assert.ok(autoDuel.json.match.state.winner, "auto duel should finish the battle");
  assert.ok(autoDuel.json.match.state.events.length > 1, "auto duel should play multiple model turns when needed");
  assert.ok(
    autoDuel.json.match.state.events.every((event) => event.routeBonus && Array.isArray(event.routeBonus.pointIds)),
    "auto duel public events should expose route bonus scoring"
  );
  assert.ok(
    autoDuel.json.match.state.events.some((event) => event.expression && event.thinking && event.thinking.publicReason),
    "auto duel public events should expose model function expressions and thoughts"
  );
  assert.ok(autoDuel.json.score && Number.isFinite(autoDuel.json.score.value), "auto duel should return rank score");
  assert.ok(Number.isFinite(autoDuel.json.rankDelta), "auto duel should return rank delta");
  assert.ok(autoDuel.json.player.rank.games >= 1, "auto duel should settle the player's ranked profile");
  assert.ok(autoDuel.json.autoBattle, "auto duel should expose a visible battle summary");
  assert.strictEqual(autoDuel.json.autoBattle.mode, "auto_duel");
  assert.strictEqual(autoDuel.json.autoBattle.startedTurn, 0);
  assert.strictEqual(autoDuel.json.autoBattle.finalTurn, autoDuel.json.match.state.events.length);
  assert.ok(autoDuel.json.autoBattle.resolvedTurns >= 1);
  assert.ok(autoDuel.json.autoBattle.finalEvent && autoDuel.json.autoBattle.finalEvent.resultLabel);
  assert.ok(autoDuel.json.autoBattle.providers.includes("Auto Resolve A"));
  assert.ok(autoDuel.json.autoBattle.providers.includes("Auto Resolve B"));
  assert.ok(Array.isArray(autoDuel.json.autoBattle.frames), "auto duel should return replayable battle frames");
  assert.ok(autoDuel.json.autoBattle.frames.length >= autoDuel.json.autoBattle.resolvedTurns + 1, "frames should include the starting state and every model action");
  assert.strictEqual(autoDuel.json.autoBattle.frames[0].action.action, "start", "first frame should represent the pre-duel state");
  assert.strictEqual(autoDuel.json.autoBattle.frames[0].state.events.length, 0, "first frame should not already contain resolved shots");
  assert.strictEqual(
    autoDuel.json.autoBattle.frames[autoDuel.json.autoBattle.frames.length - 1].state.winner,
    autoDuel.json.match.state.winner,
    "last frame should match the resolved battle winner"
  );
  assert.ok(
    autoDuel.json.autoBattle.frames.some((frame) => frame.action.action === "shot"),
    "playback frames should expose shot actions for the spectator timeline"
  );
  assert.ok(
    autoDuel.json.autoBattle.modelTurns.some((turn) => turn.expression && turn.publicReason),
    "model turn summary should carry the visible function and model thought"
  );
  const modelActionFrames = autoDuel.json.autoBattle.frames.filter((frame) => frame.action.action !== "start");
  assert.ok(modelActionFrames.length >= 1, "auto duel should include model action frames");
  assert.ok(
    modelActionFrames.every((frame) => frame.action.rulesDigest && frame.action.rulesDigest.promptPolicy === "bare_rules_only"),
    "each replayed model action should expose that the model received only bare rules"
  );
  assert.ok(
    modelActionFrames.every((frame) => frame.action.rulesDigest.handRetained === true),
    "each replayed model action should expose retained-hand state"
  );
  assert.ok(
    modelActionFrames.every((frame) => Number.isFinite(frame.action.rulesDigest.legalShotCount)),
    "each replayed model action should expose legal shot count"
  );
  assert.ok(
    modelActionFrames.every((frame) => Array.isArray(frame.action.rulesDigest.allyIds) && Array.isArray(frame.action.rulesDigest.opponentIds)),
    "each replayed model action should expose allies and opponents from the rules packet"
  );
  assert.ok(
    autoDuel.json.autoBattle.modelTurns.some((turn) => turn.rulesDigest && turn.rulesDigest.promptPolicy === "bare_rules_only"),
    "auto battle summary should include a compact model-turn rules digest"
  );
  assert.ok(!JSON.stringify(autoDuel.json.autoBattle.frames).includes("secret"), "playback frames should not leak stored API keys");
}

async function testMatchRulesEndpointExposesBareModelContract() {
  const createIsolatedServer = freshCreateServer();
  const session = await request(createIsolatedServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Rules Pilot",
      providers: { openai: { apiKey: "rules-secret", model: "gpt-rules" } }
    })
  });
  assert.strictEqual(session.status, 200);

  const joined = await request(createIsolatedServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "openai" })
  });
  assert.strictEqual(joined.status, 200);

  const rules = await request(
    createIsolatedServer({ env: {} }),
    `/api/match/${joined.json.match.id}/rules?playerId=${session.json.player.id}&command=safe%20high%20arc`,
    { headers: authHeaders(session) }
  );
  assert.strictEqual(rules.status, 200);
  assert.strictEqual(rules.json.matchId, joined.json.match.id);
  assert.strictEqual(rules.json.modelContract.activeUnitId, "A1");
  assert.strictEqual(rules.json.modelContract.controlledUnit.id, "A1");
  assert.strictEqual(rules.json.modelContract.hand.owner, "A1");
  assert.strictEqual(rules.json.modelContract.command, "safe high arc");
  assert.ok(rules.json.modelContract.legalActions.some((action) => action.action === "swap_hand"));
  assert.ok(rules.json.modelContract.legalActions.some((action) => action.action === "shot"));
  assert.strictEqual(rules.json.modelContract.state.map.windows, undefined, "bare rules should not expose removed route windows");
  assert.strictEqual(rules.json.roster.length, 4);
  assert.deepStrictEqual(rules.json.roster.map((seat) => seat.unitId), ["A1", "A2", "B1", "B2"]);
  assert.ok(!rules.text.includes("rules-secret"), "rules endpoint should never leak stored API keys");
  assert.ok(!rules.text.includes("system"), "rules endpoint should expose environment rules, not hidden prompt scaffolding");
}

async function testLocalFallbackModelsCanSwapWeakHandsDuringAutoDuel() {
  const createIsolatedServer = freshCreateServer();
  const session = await request(createIsolatedServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Local Swap",
      providers: { deepseek: { apiKey: "", model: "local" } }
    })
  });
  assert.strictEqual(session.status, 200);

  const joined = await request(createIsolatedServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(joined.status, 200);

  const autoDuel = await request(createIsolatedServer({ env: {} }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id })
  });
  assert.strictEqual(autoDuel.status, 200);
  const swapFrames = autoDuel.json.autoBattle.frames.filter((frame) => frame.action.action === "swap_hand");
  assert.ok(swapFrames.length > 0, "local fallback models should sometimes choose swap_hand on hard maps");
  assert.ok(
    swapFrames.every((frame) => frame.action.swapsRemaining >= 0 && frame.action.swapsRemaining < 3),
    "swap frames should expose decreasing swap economy"
  );
  assert.ok(
    autoDuel.json.autoBattle.frames.some((frame) => frame.action.action === "shot"),
    "auto duel should still fire shots after model-selected swaps"
  );
}

function testLocalFallbackSwapPolicyUsesSolverPressure() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");
  assert.ok(source.includes("solverPressure"), "local fallback swap policy should use map solver pressure");
  assert.ok(source.includes("swapWindowHitRate"), "local fallback swap policy should use retained-hand swap-window metadata");
}

async function testAutoDuelUsesConfiguredProviderWithoutLeakingKeys() {
  const capturedPrompts = [];
  const fetchMock = async (url, options) => {
    const requestBody = JSON.parse(options.body);
    const prompt = providerRulesPayload(requestBody);
    const candidates = prompt.legalActions.filter((action) => action.action === "shot");
    capturedPrompts.push({ url, options, requestBody, prompt });
    const firstCall = capturedPrompts.length === 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(firstCall
                ? {
                    action: "swap_hand",
                    publicReason: "Provider wants a different retained hand."
                  }
                : {
                    action: "shot",
                    candidateId: candidates[0].candidateId,
                    publicReason: "Provider chose a listed legal shot."
                  })
            }
          }
        ]
      })
    };
  };

  const session = await request(createServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Provider Pilot",
      providers: { openai: { apiKey: "auto-provider-secret", model: "gpt-auto" } }
    })
  });
  assert.strictEqual(session.status, 200);

  const joined = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "openai" })
  });
  assert.strictEqual(joined.status, 200);

  const autoDuel = await request(createServer({ env: {}, fetch: fetchMock }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      playerId: session.json.player.id,
      command: "safe high arc, avoid ally, target the weakest opponent"
    })
  });

  assert.strictEqual(autoDuel.status, 200);
  assert.ok(capturedPrompts.length >= 2, "auto duel should continue the same provider turn after swap_hand");
  assert.strictEqual(capturedPrompts[0].options.headers.authorization, "Bearer auto-provider-secret");
  assert.strictEqual(capturedPrompts[0].requestBody.model, "gpt-auto");
  assert.strictEqual(capturedPrompts[0].prompt.command, "safe high arc, avoid ally, target the weakest opponent");
  assert.strictEqual(capturedPrompts[0].prompt.activeUnitId, "A1");
  assert.strictEqual(capturedPrompts[0].prompt.controlledUnit.id, "A1");
  assert.strictEqual(capturedPrompts[0].prompt.hand.owner, "A1");
  assert.strictEqual(capturedPrompts[1].prompt.activeUnitId, "A1", "provider should continue the same unit turn after swap_hand");
  assert.strictEqual(capturedPrompts[0].prompt.state.map.windows, undefined, "auto duel prompt should not include route windows");
  assert.ok(capturedPrompts[0].prompt.legalActions.some((action) => action.action === "swap_hand"));
  assert.ok(capturedPrompts[0].prompt.legalActions.some((action) => action.action === "shot"));
  assert.ok(
    autoDuel.json.autoBattle.providers.some((provider) => provider.includes("Provider Pilot / gpt-auto")),
    "auto duel summary should expose the configured provider label"
  );
  assert.ok(
    autoDuel.json.autoBattle.frames.some((frame) => frame.action.action === "swap_hand"),
    "auto duel frames should expose provider swap_hand decisions before the shot"
  );
  assert.ok(
    autoDuel.json.autoBattle.frames.some((frame) => frame.action.provider.includes("Provider Pilot / gpt-auto")),
    "auto duel frames should preserve the visible provider label for replay"
  );
  assert.ok(!autoDuel.text.includes("auto-provider-secret"), "auto duel should not leak stored API keys");
}

async function testAutoDuelUsesOpenRouterFreeForAiOpponentsWhenEnvKeyExists() {
  const captured = [];
  const fetchMock = async (url, options) => {
    const requestBody = JSON.parse(options.body);
    const prompt = providerRulesPayload(requestBody);
    const candidates = prompt.legalActions.filter((action) => action.action === "shot");
    captured.push({ url, options, requestBody, prompt });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(candidates[0]
                ? {
                    action: "shot",
                    candidateId: candidates[0].candidateId,
                    publicReason: "OpenRouter free opponent picked a listed legal shot."
                  }
                : {
                    action: "swap_hand",
                    publicReason: "OpenRouter free opponent searched another hand."
                  })
            }
          }
        ]
      })
    };
  };

  const session = await request(createServer({ env: { OPENROUTER_API_KEY: "sk-router-env" } }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Router Opponent",
      providers: { openrouter: { apiKey: "", model: "openrouter/free" } }
    })
  });
  assert.strictEqual(session.status, 200);

  const joined = await request(createServer({ env: { OPENROUTER_API_KEY: "sk-router-env" } }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ preferredProvider: "openrouter", allowAiFill: true })
  });
  assert.strictEqual(joined.status, 200);

  const autoDuel = await request(
    createServer({ env: { OPENROUTER_API_KEY: "sk-router-env" }, fetch: fetchMock }),
    `/api/match/${joined.json.match.id}/auto-duel`,
    {
      method: "POST",
      headers: authHeaders(session, { "content-type": "application/json" }),
      body: JSON.stringify({ command: "support ally, swap if the hand cannot thread the maze" })
    }
  );

  assert.strictEqual(autoDuel.status, 200);
  assert.ok(captured.length > 0, "auto-duel should call OpenRouter for AI-filled seats when an env key exists");
  assert.ok(captured.every((call) => call.url === "https://openrouter.ai/api/v1/chat/completions"));
  assert.ok(captured.every((call) => call.options.headers.authorization === "Bearer sk-router-env"));
  assert.ok(captured.every((call) => call.requestBody.model === "openrouter/free"));
  assert.ok(captured.some((call) => ["B1", "B2"].includes(call.prompt.activeUnitId)), "captured prompts should come from the single AI-filled opponent commander");
  assert.ok(
    autoDuel.json.autoBattle.providers.some((provider) => provider.includes("openrouter/free")),
    "auto duel summary should show OpenRouter free model opponents"
  );
  assert.ok(!autoDuel.text.includes("sk-router-env"), "auto duel should not leak OpenRouter env key");
}

async function testAutoDuelCapsSlowProviderCallsAndFallsBackLocally() {
  let providerCalls = 0;
  const env = {
    OPENROUTER_API_KEY: "sk-router-env",
    GRAPHWAR_REQUEST_TIMEOUT_MS: "1",
    GRAPHWAR_PROVIDER_CALL_BUDGET: "2",
    GRAPHWAR_PROVIDER_FAILURE_BUDGET: "1"
  };
  const fetchMock = async (_url, options) => {
    providerCalls += 1;
    return new Promise((_resolve, reject) => {
      if (options?.signal) {
        options.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }
    });
  };

  const session = await request(createServer({ env, fetch: fetchMock }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Slow Provider",
      providers: { openrouter: { apiKey: "", model: "openrouter/free" } }
    })
  });
  assert.strictEqual(session.status, 200);

  const joined = await request(createServer({ env, fetch: fetchMock }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ preferredProvider: "openrouter", allowAiFill: true })
  });
  assert.strictEqual(joined.status, 200);

  const autoDuel = await request(createServer({ env, fetch: fetchMock }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ command: "safe arc" })
  });
  assert.strictEqual(autoDuel.status, 200);
  assert.strictEqual(autoDuel.json.match.status, "resolved");
  assert.ok(providerCalls <= 2, "slow providers should be capped by the per-duel provider call budget");
  assert.ok(
    autoDuel.json.autoBattle.providers.some((provider) => provider === "Auto Resolve B"),
    "provider timeout should fall back to the local AI resolver for the slow side"
  );
}

async function testModelLeagueSimulationRanksContestantsWithoutLeakingKeys() {
  const result = await request(createServer({ env: {} }), "/api/simulations/league", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rounds: 2,
      contestants: [
        { id: "arc-local", label: "Arc Local", provider: "local", command: "safe high arc target B2", apiKey: "arc-secret" },
        { id: "bend-local", label: "Bend Local", provider: "local", command: "bend through center target A2", apiKey: "bend-secret" }
      ]
    })
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.json.matches.length, 2);
  assert.strictEqual(result.json.leaderboard.length, 2);
  assert.ok(result.json.leaderboard.every((row) => Number.isFinite(row.rating)), "leaderboard should expose numeric ratings");
  assert.ok(result.json.matches.every((match) => match.events > 0 && match.seed), "simulation should run actual battles");
  assert.strictEqual(result.json.api.endpoint, "/api/simulations/league");
  assert.strictEqual(result.json.api.method, "POST");
  assert.strictEqual(result.json.api.modelContract, "bare_rules_only");
  assert.strictEqual(result.json.api.watchOnly, true);
  assert.ok(result.json.api.limits.maxContestants >= 2, "simulation API should disclose contestant limits");
  assert.ok(result.json.api.limits.maxRounds >= 2, "simulation API should disclose round limits");
  assert.ok(result.json.api.rankFormula.win > 0, "simulation API should disclose rank win delta");
  assert.ok(result.json.api.rankFormula.loss < 0, "simulation API should disclose rank loss delta");
  assert.ok(result.json.api.responseShape.includes("leaderboard"), "simulation API should document leaderboard output");
  assert.ok(result.json.api.responseShape.includes("matches"), "simulation API should document match output");
  assert.ok(!result.text.includes("arc-secret"), "simulation response should not echo API keys");
  assert.ok(!result.text.includes("bend-secret"), "simulation response should not echo API keys");
}

async function testProviderShotUsesByokAndValidatesCandidate() {
  let captured;
  const state = require("../src/sim-core.js").createInitialState({ seed: 7351 });
  const fetchMock = async (url, options) => {
    captured = { url, options };
    const payload = JSON.parse(options.body);
    const legalActions = providerRulesPayload(payload).legalActions;
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
                publicReason: "Provider chose a listed legal combo."
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
  const prompt = providerRulesPayload(JSON.parse(captured.options.body));
  assert.strictEqual(JSON.parse(captured.options.body).messages.length, 1, "provider request should not include hidden system prompt scaffolding");
  assert.strictEqual(prompt.state.map.windows, undefined, "provider prompt should not include route windows");
  assert.ok(prompt.legalActions.every((action) => action.mapFit === undefined), "provider candidates should not leak simulated map fit");
  assert.ok(prompt.legalActions.some((action) => action.action === "swap_hand"), "provider prompt should expose swap_hand as a legal action");
  assert.ok(!prompt.legalActions.some((action) => action.action === "reroll"), "provider prompt should not expose old reroll wording");
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
    capturedPrompt = providerRulesPayload(payload);
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

async function testProviderCanChooseSwapHand() {
  const state = require("../src/sim-core.js").createInitialState({ seed: 7351 });
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              action: "swap_hand",
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
  assert.strictEqual(result.json.decision.action, "swap_hand");
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
  await testProviderModelsEndpointUsesByokForLiveCatalog();
  await testStaticServerOnlyServesMainEntrypoint();
  await testInvalidProviderFails();
  await testLoginMatchmakingAndRankLoop();
  await testAiFallbackSeatsDefaultToOpenRouterFreePrompts();
  await testProfileRankAndLeaderboardPersistAcrossRestart();
  await testRegisterLoginAndProviderUpdatePersistAcrossRestart();
  await testSessionTokenProtectsRankedAndProviderRoutes();
  await testHumanMatchmakingQueueCanFormRanked2v2();
  await testHumanMatchmakingStoresLaunchOrdersPerSeat();
  await testQueuedPlayersCanPollMatchedRoom();
  await testRankedMatchRejectsMidDuelManualActions();
  await testAutoDuelResolvesRankedMatchWithBattleSummary();
  await testMatchRulesEndpointExposesBareModelContract();
  await testLocalFallbackModelsCanSwapWeakHandsDuringAutoDuel();
  testLocalFallbackSwapPolicyUsesSolverPressure();
  await testAutoDuelUsesConfiguredProviderWithoutLeakingKeys();
  await testAutoDuelUsesOpenRouterFreeForAiOpponentsWhenEnvKeyExists();
  await testAutoDuelCapsSlowProviderCallsAndFallsBackLocally();
  await testModelLeagueSimulationRanksContestantsWithoutLeakingKeys();
  await testProviderShotUsesByokAndValidatesCandidate();
  await testProviderShotUsesCurrentTurnOrder();
  await testProviderCanChooseSwapHand();
  await testProviderShotRequiresKey();
  console.log("server tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
