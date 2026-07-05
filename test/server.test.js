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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId, preferredProvider: "deepseek" })
  });
  assert.strictEqual(match.status, 200);

  const resolved = await request(createPersistentServer({ env }), `/api/match/${match.json.match.id}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId })
  });
  assert.strictEqual(resolved.status, 200);
  const settledRating = resolved.json.player.rank.rating;
  assert.notStrictEqual(settledRating, 1000, "rank settlement should mutate persistent rating");

  const restartedCreateServer = freshCreateServer();
  const restored = await request(restartedCreateServer({ env }), `/api/session/${playerId}`);
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
  return session.json.player;
}

async function testHumanMatchmakingQueueCanFormRanked2v2() {
  const players = [];
  for (const name of ["Alpha", "Bravo", "Cinder", "Delta"]) {
    players.push(await createTestPlayer(name));
  }

  for (let index = 0; index < 3; index += 1) {
    const queued = await request(createServer({ env: {} }), "/api/match/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: players[index].id, preferredProvider: "deepseek", allowAiFill: false })
    });
    assert.strictEqual(queued.status, 202);
    assert.strictEqual(queued.json.status, "queued");
    assert.strictEqual(queued.json.queueSize, index + 1);
    assert.ok(!queued.text.includes(`${players[index].displayName}-secret`), "queue response should not leak API keys");
  }

  const matched = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: players[3].id, preferredProvider: "deepseek", allowAiFill: false })
  });
  assert.strictEqual(matched.status, 200);
  assert.strictEqual(matched.json.match.status, "matched");
  assert.strictEqual(matched.json.match.filledByAi, false);
  assert.strictEqual(matched.json.match.roster.filter((seat) => seat.control === "human").length, 4);
  assert.deepStrictEqual(
    matched.json.match.roster.map((seat) => seat.team),
    ["A", "A", "B", "B"],
    "matchmaker should split four humans into two teams"
  );
  assert.ok(!matched.text.includes("Alpha-secret"), "match response should not leak queued player keys");
}

async function testQueuedPlayersCanPollMatchedRoom() {
  const players = [];
  for (const name of ["Echo", "Flux", "Glint", "Helix"]) {
    players.push(await createTestPlayer(name));
  }

  for (let index = 0; index < 3; index += 1) {
    const queued = await request(createServer({ env: {} }), "/api/match/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: players[index].id, preferredProvider: "deepseek", allowAiFill: false })
    });
    assert.strictEqual(queued.status, 202);
  }

  const waiting = await request(createServer({ env: {} }), `/api/matchmaking/${players[0].id}`);
  assert.strictEqual(waiting.status, 200);
  assert.strictEqual(waiting.json.status, "queued");
  assert.strictEqual(waiting.json.queueSize, 3);
  assert.strictEqual(waiting.json.position, 1);
  assert.strictEqual(waiting.json.needed, 1);

  const matched = await request(createServer({ env: {} }), "/api/match/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: players[3].id, preferredProvider: "deepseek", allowAiFill: false })
  });
  assert.strictEqual(matched.status, 200);
  const matchId = matched.json.match.id;

  const synced = await request(createServer({ env: {} }), `/api/matchmaking/${players[0].id}`);
  assert.strictEqual(synced.status, 200);
  assert.strictEqual(synced.json.status, "matched");
  assert.strictEqual(synced.json.match.id, matchId);
  assert.strictEqual(synced.json.match.roster.filter((seat) => seat.control === "human").length, 4);
  assert.ok(!synced.text.includes("Echo-secret"), "matchmaking poll should not leak API keys");

  const fetched = await request(createServer({ env: {} }), `/api/match/${matchId}?playerId=${players[0].id}`);
  assert.strictEqual(fetched.status, 200);
  assert.strictEqual(fetched.json.match.id, matchId);
  assert.ok(fetched.json.match.roster.some((seat) => seat.playerId === players[0].id), "fetched match should include requesting player");
  assert.ok(!fetched.text.includes("Flux-secret"), "match fetch should not leak API keys");
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
    body: JSON.stringify({ playerId: session.json.player.id, action: "swap_hand" })
  });
  assert.strictEqual(rerolled.status, 200);
  assert.strictEqual(rerolled.json.action.action, "swap_hand");
  assert.strictEqual(rerolled.json.action.team, "A");
  assert.strictEqual(rerolled.json.match.state.turn, 0, "swap_hand should not consume the turn");
  assert.strictEqual(rerolled.json.match.state.hands.A.rerollsUsed, 1);
  assert.strictEqual(rerolled.json.match.state.hands.A.swapsUsed, 1);
  assert.notStrictEqual(
    rerolled.json.match.state.hands.A.cards.map((card) => card.instanceId).join("|"),
    originalHand,
    "swap_hand should replace the active hand"
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "deepseek" })
  });
  assert.strictEqual(joined.status, 200);

  const autoDuel = await request(createServer({ env: {} }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.json.player.id })
  });
  assert.strictEqual(autoDuel.status, 200);
  assert.strictEqual(autoDuel.json.match.status, "resolved");
  assert.ok(autoDuel.json.match.state.winner, "auto duel should finish the battle");
  assert.ok(autoDuel.json.match.state.events.length > 1, "auto duel should play multiple model turns when needed");
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
  assert.ok(!JSON.stringify(autoDuel.json.autoBattle.frames).includes("secret"), "playback frames should not leak stored API keys");
}

async function testAutoDuelUsesConfiguredProviderWithoutLeakingKeys() {
  const capturedPrompts = [];
  const fetchMock = async (url, options) => {
    const requestBody = JSON.parse(options.body);
    const prompt = JSON.parse(requestBody.messages[1].content);
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: session.json.player.id, preferredProvider: "openai" })
  });
  assert.strictEqual(joined.status, 200);

  const autoDuel = await request(createServer({ env: {}, fetch: fetchMock }), `/api/match/${joined.json.match.id}/auto-duel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  assert.ok(!result.text.includes("arc-secret"), "simulation response should not echo API keys");
  assert.ok(!result.text.includes("bend-secret"), "simulation response should not echo API keys");
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
  const prompt = JSON.parse(JSON.parse(captured.options.body).messages[1].content);
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
  await testStaticServerOnlyServesMainEntrypoint();
  await testInvalidProviderFails();
  await testLoginMatchmakingAndRankLoop();
  await testProfileRankAndLeaderboardPersistAcrossRestart();
  await testHumanMatchmakingQueueCanFormRanked2v2();
  await testQueuedPlayersCanPollMatchedRoom();
  await testMatchActionsMutateAuthoritativeState();
  await testAutoDuelResolvesRankedMatchWithBattleSummary();
  await testAutoDuelUsesConfiguredProviderWithoutLeakingKeys();
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
