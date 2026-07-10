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
    return { status: response.status, text, json, headers: response.headers };
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

let testAccountNumber = 1;
async function createAuthenticatedSession(serverOptions) {
  const options = serverOptions || { env: {} };
  const suffix = testAccountNumber++;
  const session = await request(createServer(options), "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      handle: `test-user-${suffix}`,
      displayName: `Test User ${suffix}`,
      password: "password-123"
    })
  });
  assert.strictEqual(session.status, 200);
  return session;
}

function providerRulesPayload(requestBody) {
  const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
  const userMessage = messages.slice().reverse().find((message) => message.role === "user");
  assert.ok(userMessage && typeof userMessage.content === "string", "provider request should include a user rules payload");
  return JSON.parse(userMessage.content);
}

function expressionShotFetchMock(captured) {
  return async (url, options) => {
    const requestBody = JSON.parse(options.body);
    const prompt = String(url).includes("anthropic.com")
      ? JSON.parse(requestBody.messages[0].content)
      : providerRulesPayload(requestBody);
    if (Array.isArray(captured)) captured.push({ url, options, requestBody, prompt });
    const targetId = prompt.opponentIds && prompt.opponentIds[0] ? prompt.opponentIds[0] : "";
    const content = JSON.stringify({
      action: "shot",
      targetId,
      expression: "y=y0+dy*t+10*sin(pi*t)",
      cardSlots: [1],
      publicReason: "Provider wrote a function shot."
    });
    if (String(url).includes("anthropic.com")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: "text", text: content }] })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content,
              reasoning_content: "Model inspected coordinates, obstacles, allies, and the current function hand."
            }
          }
        ]
      })
    };
  };
}

async function testHealthAndProviders() {
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        {
          id: "openrouter/free",
          name: "Free Models Router",
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
      provider.models.some((model) => model.id === "openrouter/free")
    ),
    "OpenRouter free router should be exposed as a selectable provider option"
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

async function testProviderModelsEndpointSurfacesRefreshErrors() {
  const fetchMock = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: "unavailable" })
  });
  const result = await request(createServer({ env: {}, fetch: fetchMock }), "/api/providers/openai/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "sk-user-models" })
  });
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.json.error, "openai_models_503");
  assert.ok(!result.text.includes("gpt-5.5"), "failed refresh should not silently return static curated models");
  assert.ok(!result.text.includes("sk-user-models"), "failed refresh response should not leak the BYOK key");
}

async function testStaticServerOnlyServesMainEntrypoint() {
  const main = await request(createServer({ env: {} }), "/index.html");
  assert.strictEqual(main.status, 200);
  assert.ok(main.text.includes("Mob Graphwar Arena"));
  assert.ok(main.text.includes('<div id="root"></div>'), "entrypoint should mount the React game shell");
  assert.ok(!main.text.includes("/src/sim-core.js"), "entrypoint should not load a duplicate public simulation engine");
  assert.ok(
    main.text.includes("/src/main.jsx") || main.text.includes("/assets/"),
    "entrypoint should load either the dev React app or the built bundle"
  );

  const duplicate = await request(createServer({ env: {} }), "/index%202.html");
  assert.strictEqual(duplicate.status, 404);
  assert.strictEqual(duplicate.json.error, "not_found");
}

async function testProductionStaticServerFailsClosedWithoutBuild() {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "graphwar-empty-dist-"));
  const result = await request(createServer({
    env: {
      NODE_ENV: "production",
      GRAPHWAR_SESSION_SECRET: "test-production-static-secret-long-enough"
    },
    staticRoot: emptyRoot
  }), "/");
  assert.strictEqual(result.status, 503);
  assert.strictEqual(result.json.error, "build_unavailable");
}

async function testInvalidProviderFails() {
  const options = { env: {} };
  const session = await createAuthenticatedSession(options);
  const result = await request(createServer(options), "/api/agent/shot", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
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
        openai: { apiKey: "", model: "gpt-5.5" }
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
  assert.ok(match.json.match.state.mapMeta.difficulty >= 68 && match.json.match.state.mapMeta.difficulty <= 86, "ranked match should use moderated Graphwar maps");
  assert.strictEqual(match.json.match.state.obstacles.length, 6, "ranked match should keep blocker count token-light");
  assert.strictEqual(match.json.match.state.mapMeta.complexity.generator, "poisson-blob-search", "ranked match should expose the map generator");
  assert.strictEqual(match.json.match.state.bonusPoints.length, 3, "ranked match should expose a small set of route bonus points to spectators");

  const fetchMock = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const prompt = providerRulesPayload(payload);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "shot",
                targetId: prompt.opponentIds[0],
                expression: "y=y0+dy*t+10*sin(pi*t)",
                cardSlots: [1],
                publicReason: "Provider wrote a function shot."
              })
            }
          }
        ]
      })
    };
  };
  const result = await request(createServer({ env: { OPENROUTER_API_KEY: "sk-router-env" }, fetch: fetchMock }), `/api/match/${match.json.match.id}/resolve`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      playerId: session.json.player.id,
      providerConfig: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "sk-user" }
    })
  });
  assert.strictEqual(result.status, 200);
  assert.ok(result.json.rankDelta !== 0, "resolved ranked match should award or remove rank points");
  assert.ok(Number.isFinite(result.json.player.rank.rating), "resolved ranked match should return updated rank");
}

async function testAiFillSeatsDefaultToOpenRouterFreePrompts() {
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
  const env = { GRAPHWAR_DATA_FILE: dataFile, OPENROUTER_API_KEY: "sk-router-env" };
  const fetchMock = expressionShotFetchMock();
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

  const resolved = await request(createPersistentServer({ env, fetch: fetchMock }), `/api/match/${match.json.match.id}/resolve`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      playerId,
      providerConfig: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "persist-secret" }
    })
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

async function testAdminBenchmarkImportRequiresTokenAndPublishesRawMetadata() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphwar-benchmark-"));
  const dataFile = path.join(dataDir, "store.json");
  const env = { GRAPHWAR_DATA_FILE: dataFile, GRAPHWAR_ADMIN_TOKEN: "admin-secret" };
  const benchmarkPayload = {
    id: "infron-raw-20260707b",
    title: "Infron Raw Model Benchmark",
    generatedAt: "2026-07-08T00:00:00.000Z",
    platform: "infron",
    promptPolicy: "none",
    thinkingMode: "off",
    leaderboard: [
      {
        id: "openai-gpt-5-5",
        label: "OpenAI GPT-5.5",
        provider: "infron",
        model: "openai/gpt-5.5",
        rating: 1298,
        games: 16,
        wins: 13,
        losses: 3,
        draws: 0
      }
    ],
    analysis: { aggregate: { matches: 72, invalidActions: 198 } },
    matches: [{ id: "match-0001", winner: "A" }],
    traces: { "match-0001": { id: "match-0001", actions: [] } }
  };

  const missingToken = await request(createServer({ env }), "/api/admin/benchmarks/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(benchmarkPayload)
  });
  assert.strictEqual(missingToken.status, 401);
  assert.strictEqual(missingToken.json.error, "missing_admin_token");

  const imported = await request(createServer({ env }), "/api/admin/benchmarks/import", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer admin-secret" },
    body: JSON.stringify(benchmarkPayload)
  });
  assert.strictEqual(imported.status, 200);
  assert.strictEqual(imported.json.benchmark.id, "infron-raw-20260707b");
  assert.strictEqual(imported.json.benchmark.promptPolicy, "none");
  assert.strictEqual(imported.json.benchmark.thinkingMode, "off");
  assert.strictEqual(imported.json.importedPlayers, 1);
  assert.strictEqual(imported.json.traces, 1);
  assert.ok(!imported.text.includes("admin-secret"), "admin import response should not echo the admin token");

  const createPersistentServer = freshCreateServer();
  const leaderboard = await request(createPersistentServer({ env }), "/api/leaderboard");
  assert.strictEqual(leaderboard.status, 200);
  const rawRow = leaderboard.json.players.find((player) => player.displayName === "OpenAI GPT-5.5 (raw)");
  assert.ok(rawRow, "imported raw benchmark player should appear in the public leaderboard");
  assert.deepStrictEqual(rawRow.benchmark, {
    runId: "infron-raw-20260707b",
    kind: "raw_model_benchmark",
    promptPolicy: "none",
    thinkingMode: "off",
    platform: "infron",
    label: "Infron Raw Model Benchmark"
  });
  assert.ok(!leaderboard.text.includes("admin-secret"), "leaderboard should not expose admin tokens");

  const benchmarkList = await request(createPersistentServer({ env }), "/api/benchmarks");
  assert.strictEqual(benchmarkList.status, 200);
  assert.strictEqual(benchmarkList.json.benchmarks.length, 1);
  assert.strictEqual(benchmarkList.json.benchmarks[0].id, "infron-raw-20260707b");
  assert.strictEqual(benchmarkList.json.benchmarks[0].promptPolicy, "none");
  assert.strictEqual(benchmarkList.json.benchmarks[0].thinkingMode, "off");

  const benchmarkDetail = await request(createPersistentServer({ env }), "/api/benchmarks/infron-raw-20260707b?includeTraces=1");
  assert.strictEqual(benchmarkDetail.status, 200);
  assert.strictEqual(benchmarkDetail.json.benchmark.traces["match-0001"].id, "match-0001");
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
  assert.strictEqual(registered.json.player.providers.deepseek.configured, false);
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
        openai: { apiKey: "sk-auth-login", model: "gpt-5.5" }
      }
    })
  });
  assert.strictEqual(loggedIn.status, 200);
  assert.strictEqual(loggedIn.json.player.id, registered.json.player.id);
  assert.strictEqual(loggedIn.json.player.handle, "clock_ai");
  assert.strictEqual(loggedIn.json.player.providers.openai.model, "gpt-5.5");
  assert.strictEqual(loggedIn.json.player.providers.openai.configured, false);
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
    body: JSON.stringify({ providers: { openai: { apiKey: "sk-no-session", model: "gpt-5.5" } } })
  });
  assert.strictEqual(noProviderSession.status, 401);
  assert.strictEqual(noProviderSession.json.error, "missing_session");

  const badProviderSession = await request(createServer({ env: {} }), "/api/profile/providers", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer bad-token" },
    body: JSON.stringify({ providers: { openai: { apiKey: "sk-bad-session", model: "gpt-5.5" } } })
  });
  assert.strictEqual(badProviderSession.status, 401);
  assert.strictEqual(badProviderSession.json.error, "invalid_session");

  const updated = await request(createServer({ env: {} }), "/api/profile/providers", {
    method: "POST",
    headers: authHeaders(registered, { "content-type": "application/json" }),
    body: JSON.stringify({
      providers: {
        anthropic: { apiKey: "sk-provider-session", model: "claude-sonnet-5" }
      }
    })
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.json.player.providers.anthropic.configured, false);
  assert.strictEqual(updated.json.player.providers.anthropic.model, "claude-sonnet-5");
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

  const autoDuel = await request(
    createServer({ env: { OPENROUTER_API_KEY: "sk-router-env" }, fetch: expressionShotFetchMock() }),
    `/api/match/${joined.json.match.id}/auto-duel`,
    {
    method: "POST",
    headers: authHeaders(registered, { "content-type": "application/json" }),
    body: JSON.stringify({
      command: "safe arc",
      providerConfig: { provider: "anthropic", model: "claude-sonnet-5", apiKey: "sk-provider-session" }
    })
    }
  );
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
    capturedPrompts.push({ url, options, requestBody, prompt });
    const targetId = prompt.opponentIds && prompt.opponentIds[0] ? prompt.opponentIds[0] : "";
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "shot",
                targetId,
                expression: "y=y0+dy*t+12*sin(pi*t)",
                cardSlots: [1],
                publicReason: "Provider followed the launch order."
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

  assert.strictEqual(capturedPrompts.length, 0, "human matchmaking must not retain provider keys for unattended server resolution");
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
    body: JSON.stringify({ displayName: "Commander", providers: { deepseek: { apiKey: "sk-commander", model: "deepseek-v4-flash" } } })
  });
  assert.strictEqual(session.status, 200);

  const joined = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(joined.status, 200);
  const matchId = joined.json.match.id;

  const manualSwap = await request(createServer({ env: {} }), `/api/match/${matchId}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.json.player.id, action: "swap_hand" })
  });
  assert.strictEqual(manualSwap.status, 410);
  assert.strictEqual(manualSwap.json.error, "manual_actions_disabled");

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

  const autoDuel = await request(createServer({ env: { OPENROUTER_API_KEY: "sk-router-env" }, fetch: expressionShotFetchMock() }), `/api/match/${matchId}/auto-duel`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      playerId: session.json.player.id,
      providerConfig: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "sk-commander" }
    })
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
      providers: { deepseek: { apiKey: "sk-auto", model: "deepseek-v4-flash" } }
    })
  });
  assert.strictEqual(session.status, 200);

  const joined = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(joined.status, 200);

  const autoDuel = await request(createServer({ env: { OPENROUTER_API_KEY: "sk-router-env" }, fetch: expressionShotFetchMock() }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      playerId: session.json.player.id,
      providerConfig: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "sk-auto" }
    })
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
  assert.ok(autoDuel.json.autoBattle.providers.some((provider) => provider.includes("deepseek-v4-flash")));
  assert.ok(autoDuel.json.autoBattle.providers.some((provider) => provider.includes("openrouter/free")));
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
  assert.ok(
    autoDuel.json.autoBattle.frames.some((frame) => frame.action.modelThought?.includes("coordinates")),
    "replay frames should carry the provider's returned reasoning when available"
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

async function testRankedJoinCanRunServerSideIdleBatch() {
  const createIsolatedServer = freshCreateServer();
  const capturedPrompts = [];
  const fetchMock = async (_url, options) => {
    const requestBody = JSON.parse(options.body);
    const prompt = providerRulesPayload(requestBody);
    capturedPrompts.push(prompt);
    const previous = Array.isArray(prompt.recentFeedback) && prompt.recentFeedback.length
      ? prompt.recentFeedback[prompt.recentFeedback.length - 1]
      : null;
    const targetId = prompt.opponentIds && prompt.opponentIds[0] ? prompt.opponentIds[0] : "";
    const shouldSwap = previous && previous.result === "blocked" && Number(prompt.hand?.swapsRemaining) > 0;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: shouldSwap ? "swap_hand" : "shot",
                targetId: shouldSwap ? "" : targetId,
                expression: shouldSwap ? "" : "y=y0+dy*t+10*sin(pi*t)",
                cardSlots: shouldSwap ? [] : [1],
                publicReason: previous ? `adjusting after ${previous.result}` : "opening function shot"
              })
            }
          }
        ]
      })
    };
  };
  const queuedSession = await request(createIsolatedServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Queued Human",
      providers: { deepseek: { apiKey: "queued-human-secret", model: "deepseek-v4-flash" } }
    })
  });
  assert.strictEqual(queuedSession.status, 200);
  const queued = await request(createIsolatedServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(queuedSession, { "content-type": "application/json" }),
    body: JSON.stringify({
      preferredProvider: "deepseek",
      allowAiFill: false,
      standingOrder: "wait for a human commander"
    })
  });
  assert.strictEqual(queued.status, 202);
  assert.strictEqual(queued.json.status, "queued");

  const session = await request(createIsolatedServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Idle Batch",
      providers: { openai: { apiKey: "idle-batch-secret", model: "gpt-idle" } }
    })
  });
  assert.strictEqual(session.status, 200);

  const batch = await request(createIsolatedServer({ env: { OPENROUTER_API_KEY: "sk-router-env" }, fetch: fetchMock }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      preferredProvider: "openai",
      allowAiFill: true,
      standingOrder: "use prior collision feedback; swap blocked hands",
      rounds: 2,
      maxActions: 4,
      providerConfig: { provider: "openai", model: "gpt-idle", apiKey: "idle-batch-secret" }
    })
  });

  assert.strictEqual(batch.status, 200);
  assert.strictEqual(batch.json.batch.roundsRequested, 2);
  assert.strictEqual(batch.json.batch.roundsCompleted, 2);
  assert.strictEqual(batch.json.matches.length, 2, "server should return one settled match per idle-run round");
  assert.strictEqual(batch.json.autoBattles.length, 2, "server should return one battle summary per idle-run round");
  assert.strictEqual(batch.json.player.rank.games, 2, "server-side idle batch should settle rank once per round");
  assert.ok(
    batch.json.matches.every((match) => match.state.turn > 4 || match.state.reason !== "resolution_guard"),
    "ranked idle batches must ignore a client attempt to lower the 24-action cap"
  );
  assert.ok(batch.json.match, "batch response should keep the latest match for the watch UI");
  assert.ok(
    capturedPrompts.some((prompt) => Array.isArray(prompt.recentFeedback) && prompt.recentFeedback.length > 0),
    "later model turns should receive recent shot feedback"
  );
  assert.ok(!batch.text.includes("idle-batch-secret"), "idle batch response must not leak player provider keys");

  const queuedStatus = await request(
    createIsolatedServer({ env: {} }),
    `/api/matchmaking/${queuedSession.json.player.id}`,
    { headers: authHeaders(queuedSession) }
  );
  assert.strictEqual(queuedStatus.status, 200);
  assert.strictEqual(queuedStatus.json.status, "queued", "server-side idle batch should not consume waiting human commanders");
  assert.ok(!queuedStatus.text.includes("queued-human-secret"), "queue status must not leak waiting player API keys");
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

async function testAutoDuelThrowsWhenProviderIsNotConfigured() {
  const createIsolatedServer = freshCreateServer();
  const session = await request(createIsolatedServer({ env: {} }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Missing Provider",
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
  assert.strictEqual(autoDuel.status, 400);
  assert.strictEqual(autoDuel.json.error, "provider_not_configured");
}

function testProviderErrorsAreNotSilentlyFallbacked() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");
  assert.ok(!source.includes("providerLabel: localAutoProviderLabel"), "provider errors should not return local fallback decisions");
  assert.ok(source.includes('throw new Error("provider_not_configured")'), "missing providers should throw explicit errors");
}

async function testAutoDuelUsesConfiguredProviderWithoutLeakingKeys() {
  const capturedPrompts = [];
  const fetchMock = async (url, options) => {
    const requestBody = JSON.parse(options.body);
    const prompt = providerRulesPayload(requestBody);
    capturedPrompts.push({ url, options, requestBody, prompt });
    const firstCall = capturedPrompts.length === 1;
    const targetId = prompt.opponentIds && prompt.opponentIds[0] ? prompt.opponentIds[0] : "";
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
                    targetId,
                    expression: "y=y0+dy*t+12*sin(pi*t)",
                    cardSlots: [1],
                    publicReason: "Provider wrote a legal function shot."
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

  const autoDuel = await request(createServer({ env: { OPENROUTER_API_KEY: "sk-router-env" }, fetch: fetchMock }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      playerId: session.json.player.id,
      command: "safe high arc, avoid ally, target the weakest opponent",
      providerConfig: { provider: "openai", model: "gpt-auto", apiKey: "auto-provider-secret" }
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
    captured.push({ url, options, requestBody, prompt });
    const targetId = prompt.opponentIds && prompt.opponentIds[0] ? prompt.opponentIds[0] : "";
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "shot",
                targetId,
                expression: "y=y0+dy*t+10*sin(pi*t)",
                cardSlots: [1],
                publicReason: "OpenRouter free opponent wrote a function shot."
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
      body: JSON.stringify({
        command: "support ally, swap if the hand cannot thread the maze",
        providerConfig: { provider: "openrouter", model: "openrouter/free", apiKey: "sk-router-env" }
      })
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

async function testAutoDuelPropagatesSlowProviderTimeout() {
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
    body: JSON.stringify({
      command: "safe arc",
      providerConfig: { provider: "openrouter", model: "openrouter/free", apiKey: "sk-router-env" }
    })
  });
  assert.strictEqual(autoDuel.status, 504);
  assert.strictEqual(autoDuel.json.error, "provider_timeout");
  assert.ok(providerCalls >= 1, "slow provider should be called before timeout is propagated");
}

async function testModelLeagueSimulationRanksContestantsWithoutLeakingKeys() {
  const options = { env: {} };
  const session = await createAuthenticatedSession(options);
  const result = await request(createServer(options), "/api/simulations/league", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
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

async function testModelLeagueRoundRobinCanExportCompleteTraces() {
  const options = { env: {} };
  const session = await createAuthenticatedSession(options);
  const result = await request(createServer(options), "/api/simulations/league", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      schedule: "round_robin",
      gamesPerPair: 2,
      includeTraces: true,
      continueOnProviderError: true,
      contestants: [
        { id: "raw-a", label: "Raw A", provider: "local", command: "", apiKey: "raw-a-secret" },
        { id: "raw-b", label: "Raw B", provider: "local", command: "", apiKey: "raw-b-secret" },
        { id: "raw-c", label: "Raw C", provider: "local", command: "", apiKey: "raw-c-secret" }
      ]
    })
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.json.matches.length, 6, "three contestants with two games per pair should produce six matches");
  assert.deepStrictEqual(
    result.json.matches.map((match) => `${match.teamA.id}->${match.teamB.id}`),
    ["raw-a->raw-b", "raw-b->raw-a", "raw-a->raw-c", "raw-c->raw-a", "raw-b->raw-c", "raw-c->raw-b"],
    "round robin should alternate sides for each pair"
  );
  assert.ok(result.json.matches.every((match) => Array.isArray(match.actions) && match.actions.length > 0), "each match should export agent action trajectory");
  assert.ok(result.json.matches.every((match) => match.trace && Array.isArray(match.trace.events) && match.trace.events.length > 0), "each match should export event traces");
  assert.ok(result.json.matches.every((match) => match.trace && Array.isArray(match.trace.paths) && match.trace.paths.length > 0), "each match should export path traces");
  assert.ok(result.json.api.responseShape.includes("trace"), "simulation API should document trace output");
  assert.ok(!result.text.includes("raw-a-secret"), "round-robin trace should not echo contestant keys");
  assert.ok(!result.text.includes("raw-b-secret"), "round-robin trace should not echo contestant keys");
  assert.ok(!result.text.includes("raw-c-secret"), "round-robin trace should not echo contestant keys");
}

async function testProviderShotUsesByokAndValidatesExpression() {
  let captured;
  const state = require("../src/sim-core.js").createInitialState({ seed: 7351 });
  const fetchMock = async (url, options) => {
    captured = { url, options };
    const payload = JSON.parse(options.body);
    const prompt = providerRulesPayload(payload);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "shot",
                targetId: prompt.opponentIds[0],
                expression: "y=y0+dy*t+12*sin(pi*t)",
                cardSlots: [1],
                publicReason: "Provider wrote a legal function."
              })
            }
          }
        ]
      })
    };
  };

  const options = { env: {}, fetch: fetchMock };
  const session = await createAuthenticatedSession(options);
  const result = await request(createServer(options), "/api/agent/shot", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      provider: "openai",
      apiKey: "sk-live-user",
      state,
      team: "A",
      command: "只打B2，安全高抛越塔，别误伤队友。"
    })
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.json.provider, "openai");
  assert.strictEqual(result.json.decision.targetId, "B1");
  assert.ok(result.json.decision.expression.includes("sin(pi*t)"), "response should include model-written expression");
  assert.strictEqual(result.json.contractMode, "model_written_expression");
  assert.ok(captured.url.endsWith("/chat/completions"), "OpenAI-compatible adapter should call chat completions");
  assert.strictEqual(captured.options.headers.authorization, "Bearer sk-live-user");
  const prompt = providerRulesPayload(JSON.parse(captured.options.body));
  assert.strictEqual(JSON.parse(captured.options.body).messages.length, 1, "provider request should not include hidden system prompt scaffolding");
  assert.strictEqual(prompt.state.map.windows, undefined, "provider prompt should not include route windows");
  assert.ok(!JSON.stringify(prompt).includes("candidateId"), "provider prompt should not include precomputed candidates");
  assert.ok(prompt.legalActions.some((action) => action.action === "swap_hand"), "provider prompt should expose swap_hand as a legal action");
  assert.ok(prompt.legalActions.every((action) => ["shot", "swap_hand"].includes(action.action)), "provider prompt should expose the current action set");
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
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "shot",
                targetId: capturedPrompt.opponentIds[0],
                expression: "y=y0+dy*t+8*sin(pi*t)",
                cardSlots: [1],
                publicReason: "Provider followed the locked order."
              })
            }
          }
        ]
      })
    };
  };

  const options = { env: {}, fetch: fetchMock };
  const session = await createAuthenticatedSession(options);
  const result = await request(createServer(options), "/api/agent/shot", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      provider: "openai",
      apiKey: "sk-live-user",
      state,
      team: "B",
      command: "must target A1, low direct shot"
    })
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(capturedPrompt.command, "must target A1, low direct shot", "server should use the current turn command");
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

  const options = { env: {}, fetch: fetchMock };
  const session = await createAuthenticatedSession(options);
  const result = await request(createServer(options), "/api/agent/shot", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
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
  assert.strictEqual(result.json.contractMode, "model_written_expression");
}

async function testProviderShotRequiresKey() {
  const state = require("../src/sim-core.js").createInitialState({ seed: 7351 });
  const options = { env: {} };
  const session = await createAuthenticatedSession(options);
  const result = await request(createServer(options), "/api/agent/shot", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
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

function testProductionRequiresExplicitSessionSecret() {
  assert.throws(
    () => createServer({ env: { NODE_ENV: "production" } }),
    /missing_session_secret/,
    "production must not start with the historical development signing secret"
  );
  const server = createServer({
    env: { NODE_ENV: "production", GRAPHWAR_SESSION_SECRET: "test-production-secret-that-is-long-enough" }
  });
  server.close();
}

async function testRegistrationNeverStoresUserApiKeys() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "graphwar-local-key-"));
  const dataFile = path.join(tempDir, "store.json");
  const env = { GRAPHWAR_DATA_FILE: dataFile, GRAPHWAR_SESSION_SECRET: "test-session-secret" };
  const result = await request(createServer({ env }), "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      handle: "localkey",
      displayName: "Local Key",
      password: "password-123",
      providers: { openai: { apiKey: "sk-browser-only", model: "gpt-5.5" } }
    })
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.json.player.providers.openai.configured, false, "server profile must not claim a browser key is retained");
  assert.ok(!fs.readFileSync(dataFile, "utf8").includes("sk-browser-only"), "persistent store must not contain a user key");
}

async function testExpensiveProviderRoutesRequireSession() {
  const Sim = require("../src/sim-core.js");
  let providerCalls = 0;
  const fetchMock = async () => {
    providerCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "{}" } }] })
    };
  };
  const serverOptions = {
    env: { OPENROUTER_API_KEY: "sk-server-owned" },
    fetch: fetchMock
  };
  const shot = await request(createServer(serverOptions), "/api/agent/shot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "openrouter", state: Sim.createInitialState({ seed: 42 }), team: "A" })
  });
  assert.strictEqual(shot.status, 401);
  assert.strictEqual(shot.json.error, "missing_session");

  const league = await request(createServer(serverOptions), "/api/simulations/league", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contestants: [] })
  });
  assert.strictEqual(league.status, 401);
  assert.strictEqual(league.json.error, "missing_session");
  assert.strictEqual(providerCalls, 0, "anonymous routes must never reach a provider");
}

async function testCookieSessionSurvivesReloadAndLogout() {
  const env = { GRAPHWAR_SESSION_SECRET: "test-cookie-session-secret" };
  const registered = await request(createServer({ env }), "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "cookie-user", displayName: "Cookie User", password: "password-123" })
  });
  assert.strictEqual(registered.status, 200);
  const setCookie = registered.headers.get("set-cookie") || "";
  assert.match(setCookie, /graphwar_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(";")[0];

  const restored = await request(createServer({ env }), "/api/session/me", {
    headers: { cookie }
  });
  assert.strictEqual(restored.status, 200);
  assert.strictEqual(restored.json.player.id, registered.json.player.id);

  const logout = await request(createServer({ env }), "/api/auth/logout", {
    method: "POST",
    headers: { cookie }
  });
  assert.strictEqual(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/i);
}

async function testSessionStatusIsAnonymousSafeAndCookieAware() {
  const env = { GRAPHWAR_SESSION_SECRET: "test-session-status-secret" };
  const anonymous = await request(createServer({ env }), "/api/session/status");
  assert.strictEqual(anonymous.status, 200);
  assert.deepStrictEqual(anonymous.json, { authenticated: false });

  const registered = await request(createServer({ env }), "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "status-user", displayName: "Status User", password: "password-123" })
  });
  const cookie = (registered.headers.get("set-cookie") || "").split(";")[0];
  const restored = await request(createServer({ env }), "/api/session/status", {
    headers: { cookie }
  });
  assert.strictEqual(restored.status, 200);
  assert.strictEqual(restored.json.authenticated, true);
  assert.strictEqual(restored.json.player.id, registered.json.player.id);
}

async function testLegacyPasswordlessSessionIsDisabledInProduction() {
  const env = {
    NODE_ENV: "production",
    GRAPHWAR_SESSION_SECRET: "test-production-legacy-session-secret"
  };
  const result = await request(createServer({ env }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Anonymous Legacy" })
  });
  assert.strictEqual(result.status, 410);
  assert.strictEqual(result.json.error, "legacy_session_disabled");
}

async function testExpensiveRoutesAreRateLimitedPerSession() {
  const env = {
    GRAPHWAR_SESSION_SECRET: "test-rate-limit-session-secret",
    GRAPHWAR_RATE_LIMIT_PER_MINUTE: "2"
  };
  const session = await createAuthenticatedSession({ env });
  const makeRequest = () => request(createServer({ env }), "/api/agent/shot", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ provider: "unknown" })
  });
  assert.strictEqual((await makeRequest()).status, 400);
  assert.strictEqual((await makeRequest()).status, 400);
  const limited = await makeRequest();
  assert.strictEqual(limited.status, 429);
  assert.strictEqual(limited.json.error, "rate_limited");
}

async function testResolvedMatchReplayAndRankSettlementAreIdempotent() {
  let providerCalls = 0;
  const fetchMock = expressionShotFetchMock();
  const countedFetch = async (...args) => {
    providerCalls += 1;
    return fetchMock(...args);
  };
  const env = { OPENROUTER_API_KEY: "sk-ai-fill", GRAPHWAR_SESSION_SECRET: "test-idempotent-secret" };
  const session = await request(createServer({ env, fetch: countedFetch }), "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Idempotent",
      providers: { openai: { apiKey: "sk-never-store", model: "gpt-idempotent" } }
    })
  });
  const joined = await request(createServer({ env, fetch: countedFetch }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ preferredProvider: "openai", allowAiFill: true })
  });
  const resolve = () => request(createServer({ env, fetch: countedFetch }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: authHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      providerConfig: { provider: "openai", model: "gpt-idempotent", apiKey: "sk-never-store" }
    })
  });

  const first = await resolve();
  assert.strictEqual(first.status, 200);
  const callsAfterFirst = providerCalls;
  const second = await resolve();
  assert.strictEqual(second.status, 200);
  assert.strictEqual(providerCalls, callsAfterFirst, "replaying a resolved match must not invoke providers again");
  assert.strictEqual(second.json.player.rank.games, 1, "a resolved match must settle rank exactly once");
  assert.strictEqual(
    second.json.autoBattle.frames.length,
    first.json.autoBattle.frames.length,
    "replay should return the original authoritative trajectory"
  );
  assert.strictEqual(
    second.json.autoBattle.frames.at(-1)?.state?.turn,
    first.json.autoBattle.frames.at(-1)?.state?.turn,
    "replay should end on the original authoritative turn"
  );
}

async function testHumanMatchStepsUseOnlyTheActivePlayersLocalKey() {
  const createIsolatedServer = freshCreateServer();
  const captured = [];
  const fetchMock = expressionShotFetchMock(captured);
  async function createHuman(handle) {
    return request(createIsolatedServer({ env: {}, fetch: fetchMock }), "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle,
        displayName: handle.toUpperCase(),
        password: "password-123",
        providers: { openai: { model: `model-${handle}` } }
      })
    });
  }
  const alpha = await createHuman("step-alpha");
  const bravo = await createHuman("step-bravo");
  const queued = await request(createIsolatedServer({ env: {}, fetch: fetchMock }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(alpha, { "content-type": "application/json" }),
    body: JSON.stringify({ preferredProvider: "openai", allowAiFill: false, standingOrder: "alpha order" })
  });
  assert.strictEqual(queued.status, 202);
  const matched = await request(createIsolatedServer({ env: {}, fetch: fetchMock }), "/api/match/join", {
    method: "POST",
    headers: authHeaders(bravo, { "content-type": "application/json" }),
    body: JSON.stringify({ preferredProvider: "openai", allowAiFill: false, standingOrder: "bravo order" })
  });
  assert.strictEqual(matched.status, 200);
  const matchId = matched.json.match.id;

  const alphaStep = await request(createIsolatedServer({ env: {}, fetch: fetchMock }), `/api/match/${matchId}/step`, {
    method: "POST",
    headers: authHeaders(alpha, { "content-type": "application/json" }),
    body: JSON.stringify({ providerConfig: { provider: "openai", model: "model-step-alpha", apiKey: "sk-alpha-local" } })
  });
  assert.strictEqual(alphaStep.status, 200);
  assert.strictEqual(alphaStep.json.step.waiting, false);
  assert.strictEqual(captured[0].options.headers.authorization, "Bearer sk-alpha-local");

  const alphaWait = await request(createIsolatedServer({ env: {}, fetch: fetchMock }), `/api/match/${matchId}/step`, {
    method: "POST",
    headers: authHeaders(alpha, { "content-type": "application/json" }),
    body: JSON.stringify({ providerConfig: { provider: "openai", model: "model-step-alpha", apiKey: "sk-alpha-local" } })
  });
  assert.strictEqual(alphaWait.status, 202);
  assert.strictEqual(alphaWait.json.step.waiting, true);
  assert.strictEqual(captured.length, 1, "inactive player must not invoke any provider");

  const bravoStep = await request(createIsolatedServer({ env: {}, fetch: fetchMock }), `/api/match/${matchId}/step`, {
    method: "POST",
    headers: authHeaders(bravo, { "content-type": "application/json" }),
    body: JSON.stringify({ providerConfig: { provider: "openai", model: "model-step-bravo", apiKey: "sk-bravo-local" } })
  });
  assert.strictEqual(bravoStep.status, 200);
  assert.strictEqual(captured[1].options.headers.authorization, "Bearer sk-bravo-local");
  assert.ok(!alphaStep.text.includes("sk-alpha-local") && !bravoStep.text.includes("sk-bravo-local"));
}

(async () => {
  await testHealthAndProviders();
  await testProviderModelsEndpointUsesByokForLiveCatalog();
  await testProviderModelsEndpointSurfacesRefreshErrors();
  await testStaticServerOnlyServesMainEntrypoint();
  await testProductionStaticServerFailsClosedWithoutBuild();
  await testInvalidProviderFails();
  await testLoginMatchmakingAndRankLoop();
  await testAiFillSeatsDefaultToOpenRouterFreePrompts();
  await testProfileRankAndLeaderboardPersistAcrossRestart();
  await testAdminBenchmarkImportRequiresTokenAndPublishesRawMetadata();
  await testRegisterLoginAndProviderUpdatePersistAcrossRestart();
  await testSessionTokenProtectsRankedAndProviderRoutes();
  await testHumanMatchmakingQueueCanFormRanked2v2();
  await testHumanMatchmakingStoresLaunchOrdersPerSeat();
  await testQueuedPlayersCanPollMatchedRoom();
  await testRankedMatchRejectsMidDuelManualActions();
  await testAutoDuelResolvesRankedMatchWithBattleSummary();
  await testRankedJoinCanRunServerSideIdleBatch();
  await testMatchRulesEndpointExposesBareModelContract();
  await testAutoDuelThrowsWhenProviderIsNotConfigured();
  testProviderErrorsAreNotSilentlyFallbacked();
  await testAutoDuelUsesConfiguredProviderWithoutLeakingKeys();
  await testAutoDuelUsesOpenRouterFreeForAiOpponentsWhenEnvKeyExists();
  await testAutoDuelPropagatesSlowProviderTimeout();
  await testModelLeagueSimulationRanksContestantsWithoutLeakingKeys();
  await testModelLeagueRoundRobinCanExportCompleteTraces();
  await testProviderShotUsesByokAndValidatesExpression();
  await testProviderShotUsesCurrentTurnOrder();
  await testProviderCanChooseSwapHand();
  await testProviderShotRequiresKey();
  testProductionRequiresExplicitSessionSecret();
  await testRegistrationNeverStoresUserApiKeys();
  await testExpensiveProviderRoutesRequireSession();
  await testCookieSessionSurvivesReloadAndLogout();
  await testSessionStatusIsAnonymousSafeAndCookieAware();
  await testLegacyPasswordlessSessionIsDisabledInProduction();
  await testExpensiveRoutesAreRateLimitedPerSession();
  await testResolvedMatchReplayAndRankSettlementAreIdempotent();
  await testHumanMatchStepsUseOnlyTheActivePlayersLocalKey();
  console.log("server tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
