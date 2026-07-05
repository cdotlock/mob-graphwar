"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { listProviders, getProvider } = require("./providers/catalog.js");
const { executeProviderDecision } = require("./providers/execute.js");
const Contract = require("../src/agents/contract.js");
const Sim = require("../src/sim-core.js");

const ROOT = path.resolve(__dirname, "..");
const DIST_ROOT = path.join(ROOT, "dist");
const players = new Map();
const matches = new Map();
const playerMatchIndex = new Map();
const matchmakingQueue = [];
let nextPlayerId = 1;
let nextMatchId = 1;
let loadedStoreFile = null;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const staticRoot = fs.existsSync(path.join(DIST_ROOT, "index.html")) ? DIST_ROOT : ROOT;
  const rawPath = url.pathname === "/" || (!path.extname(url.pathname) && !url.pathname.startsWith("/api/"))
    ? "/index.html"
    : url.pathname;
  if (path.extname(rawPath) === ".html" && rawPath !== "/index.html") {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  const filePath = path.resolve(staticRoot, `.${decodeURIComponent(rawPath)}`);
  if (!filePath.startsWith(staticRoot)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const type = MIME[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    res.end(data);
  });
}

function resolveStoreFile(env) {
  const source = env || process.env;
  if (source.GRAPHWAR_DATA_FILE === "memory") return null;
  if (source.GRAPHWAR_DATA_FILE) return path.resolve(String(source.GRAPHWAR_DATA_FILE));
  if (source.RAILWAY_ENVIRONMENT || source.RAILWAY_PROJECT_ID || source.NODE_ENV === "production") {
    return path.join(ROOT, ".data", "graphwar-store.json");
  }
  return null;
}

function persistableProviders(providers) {
  return Object.fromEntries(
    Object.entries(providers || {}).map(([id, value]) => [
      id,
      {
        model: value.model || "",
        configured: Boolean(value.apiKey || value.configured)
      }
    ])
  );
}

function persistablePlayer(player) {
  return {
    id: player.id,
    displayName: player.displayName,
    rank: player.rank,
    providers: persistableProviders(player.providers)
  };
}

function readStoreFile(storeFile) {
  if (!storeFile || !fs.existsSync(storeFile)) return { players: {}, nextPlayerId: 1 };
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    return {
      players: parsed && parsed.players && typeof parsed.players === "object" ? parsed.players : {},
      nextPlayerId: Number(parsed && parsed.nextPlayerId) || 1
    };
  } catch {
    return { players: {}, nextPlayerId: 1 };
  }
}

function loadPersistentStore(env) {
  const storeFile = resolveStoreFile(env);
  if (!storeFile || loadedStoreFile === storeFile) return storeFile;
  players.clear();
  matches.clear();
  playerMatchIndex.clear();
  matchmakingQueue.length = 0;

  const store = readStoreFile(storeFile);
  let maxPlayerNumber = 0;
  for (const player of Object.values(store.players)) {
    if (!player || !player.id) continue;
    players.set(player.id, {
      id: String(player.id),
      displayName: String(player.displayName || "Player").slice(0, 32),
      rank: player.rank || { rating: 1000, tier: "Bronze", games: 0 },
      providers: persistableProviders(player.providers)
    });
    const numeric = Number(String(player.id).replace(/^player-/, ""));
    if (Number.isFinite(numeric)) maxPlayerNumber = Math.max(maxPlayerNumber, numeric);
  }
  nextPlayerId = Math.max(Number(store.nextPlayerId) || 1, maxPlayerNumber + 1);
  nextMatchId = 1;
  loadedStoreFile = storeFile;
  return storeFile;
}

function savePersistentStore(env) {
  const storeFile = resolveStoreFile(env);
  if (!storeFile) return;
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  const body = JSON.stringify({
    version: 1,
    nextPlayerId,
    players: Object.fromEntries(Array.from(players.values()).map((player) => [player.id, persistablePlayer(player)]))
  }, null, 2);
  const tempFile = `${storeFile}.tmp`;
  fs.writeFileSync(tempFile, body);
  fs.renameSync(tempFile, storeFile);
  loadedStoreFile = storeFile;
}

function summarizeState(state) {
  return {
    seed: state.seed,
    turn: state.turn,
    map: state.mapMeta,
    units: (state.units || []).map((unit) => ({
      id: unit.id,
      team: unit.team,
      x: unit.x,
      y: unit.y,
      hp: unit.hp
    })),
    obstacles: (state.obstacles || []).map((obstacle) => ({
      id: obstacle.id,
      x: obstacle.x,
      y: obstacle.y,
      w: obstacle.w,
      h: obstacle.h
    }))
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    displayName: player.displayName,
    rank: player.rank,
    providers: Object.fromEntries(
      Object.entries(player.providers || {}).map(([id, value]) => [
        id,
        { model: value.model || "", configured: Boolean(value.apiKey || value.configured) }
      ])
    )
  };
}

function publicLeaderboard(limit) {
  return Array.from(players.values())
    .map((player) => ({
      id: player.id,
      displayName: player.displayName,
      rating: player.rank.rating,
      tier: player.rank.tier,
      games: player.rank.games,
      providers: Object.keys(player.providers || {})
    }))
    .sort((a, b) => b.rating - a.rating || b.games - a.games || a.displayName.localeCompare(b.displayName))
    .slice(0, limit || 25);
}

function createRoster(player, preferredProvider) {
  return [
    createHumanSeat(player, preferredProvider, "A1", "A"),
    createAiSeat("A2", "A", "Auto Ally"),
    createAiSeat("B1", "B", "AI Rival 1"),
    createAiSeat("B2", "B", "AI Rival 2")
  ];
}

function preferredPlayerProvider(player, preferredProvider) {
  if (preferredProvider) return String(preferredProvider).slice(0, 40);
  const configured = Object.keys(player.providers || {});
  return configured[0] || "local";
}

function createHumanSeat(player, preferredProvider, unitId, team) {
  const provider = preferredPlayerProvider(player, preferredProvider);
  const providerConfig = player.providers && player.providers[provider] ? player.providers[provider] : {};
  return {
    unitId,
    team,
    control: "human",
    playerId: player.id,
    displayName: player.displayName,
    provider,
    model: providerConfig.model || ""
  };
}

function createAiSeat(unitId, team, displayName) {
  return { unitId, team, control: "ai", displayName, provider: "local", model: "local-baseline" };
}

function createRankedMatchFromRoster(roster, options) {
  const opts = options || {};
  const id = `match-${nextMatchId++}`;
  const seed = 9000 + nextMatchId * 37 + roster.length * 11;
  const match = {
    id,
    mode: "ranked_2v2",
    status: "matched",
    seed,
    roster,
    filledByAi: Boolean(opts.filledByAi),
    state: Sim.createInitialState({ seed }),
    rankSettlements: {}
  };
  matches.set(id, match);
  for (const seat of roster) {
    if (seat.playerId) playerMatchIndex.set(seat.playerId, id);
  }
  return match;
}

function createRankedMatch(player, preferredProvider) {
  return createRankedMatchFromRoster(createRoster(player, preferredProvider), { filledByAi: true });
}

function createHumanRankedMatch(entries) {
  const seats = entries.map((entry, index) => {
    const player = players.get(entry.playerId);
    const unitId = index < 2 ? `A${index + 1}` : `B${index - 1}`;
    const team = index < 2 ? "A" : "B";
    return createHumanSeat(player, entry.preferredProvider, unitId, team);
  });
  return createRankedMatchFromRoster(seats, { filledByAi: false });
}

function removeQueuedPlayer(playerId) {
  const existing = matchmakingQueue.findIndex((entry) => entry.playerId === playerId);
  if (existing >= 0) matchmakingQueue.splice(existing, 1);
}

function getIndexedMatch(playerId) {
  const matchId = playerMatchIndex.get(playerId);
  if (!matchId) return null;
  const match = matches.get(matchId);
  if (!match) {
    playerMatchIndex.delete(playerId);
    return null;
  }
  return match;
}

function publicMatchmakingStatus(player) {
  const match = getIndexedMatch(player.id);
  if (match) {
    return {
      status: "matched",
      match,
      queueSize: matchmakingQueue.length,
      needed: Math.max(0, 4 - matchmakingQueue.length)
    };
  }
  const queuedIndex = matchmakingQueue.findIndex((entry) => entry.playerId === player.id);
  if (queuedIndex >= 0) {
    return {
      status: "queued",
      queueSize: matchmakingQueue.length,
      position: queuedIndex + 1,
      needed: Math.max(0, 4 - matchmakingQueue.length)
    };
  }
  return {
    status: "idle",
    queueSize: matchmakingQueue.length,
    needed: Math.max(0, 4 - matchmakingQueue.length)
  };
}

function queueRankedPlayer(player, preferredProvider) {
  removeQueuedPlayer(player.id);
  matchmakingQueue.push({
    playerId: player.id,
    preferredProvider: preferredProvider || preferredPlayerProvider(player),
    joinedAt: Date.now()
  });
  if (matchmakingQueue.length >= 4) {
    return createHumanRankedMatch(matchmakingQueue.splice(0, 4));
  }
  return null;
}

function createAiFallbackMatch(player, preferredProvider) {
  removeQueuedPlayer(player.id);
  if (matchmakingQueue.length >= 3) {
    const entries = matchmakingQueue.splice(0, 3).concat({
      playerId: player.id,
      preferredProvider: preferredProvider || preferredPlayerProvider(player)
    });
    return createHumanRankedMatch(entries);
  }
  return createRankedMatch(player, preferredProvider);
}

function getPlayerSeat(match, player) {
  if (!match || !player) return null;
  return match.roster.find((seat) => seat.playerId === player.id) || null;
}

function getActiveTeam(state) {
  if (!state || state.winner) return null;
  return state.turn % 2 === 0 ? "A" : "B";
}

function isSwapAction(action) {
  return action === "swap_hand" || action === "reroll";
}

function buildActionSummary(match, action, team, rerollResult, beforeEventCount) {
  if (isSwapAction(action)) {
    return {
      action: "swap_hand",
      team,
      rerollsUsed: rerollResult.rerollsUsed,
      rerollsRemaining: rerollResult.rerollsRemaining,
      swapsUsed: rerollResult.swapsUsed,
      swapsRemaining: rerollResult.swapsRemaining,
      hand: rerollResult.cards
    };
  }
  const event = match.state.events[beforeEventCount] || match.state.events[match.state.events.length - 1] || null;
  return {
    action,
    team,
    event,
    result: event ? event.result : match.state.reason,
    winner: match.state.winner
  };
}

function autoResolveCommandsForTurn(match, options) {
  const opts = options || {};
  const team = getActiveTeam(match.state);
  const seat = getRosterSeatForTurn(match, team);
  const command = seat && opts.playerId && seat.playerId === opts.playerId
    ? String(opts.command || "").slice(0, Sim.CONFIG.maxCommandLength)
    : "";
  return { team, seat, command };
}

function getActiveShooter(state, team) {
  const alive = (state.units || []).filter((unit) => unit.team === team && unit.hp > 0);
  if (!alive.length) return null;
  return alive[Math.floor(state.turn / 2) % alive.length];
}

function getRosterSeatForTurn(match, team) {
  if (!match || !team || !Array.isArray(match.roster)) return null;
  const shooter = getActiveShooter(match.state, team);
  if (!shooter) return match.roster.find((seat) => seat.team === team) || null;
  return match.roster.find((seat) => seat.unitId === shooter.id) || match.roster.find((seat) => seat.team === team) || null;
}

function localAutoProviderLabel(team) {
  return team === "A" ? "Auto Resolve A" : "Auto Resolve B";
}

function configuredSeatProvider(seat, env) {
  if (!seat || seat.control !== "human" || !seat.playerId) return null;
  const player = players.get(seat.playerId);
  if (!player) return null;
  const providerId = String(seat.provider || preferredPlayerProvider(player)).slice(0, 40);
  const provider = getProvider(providerId);
  const allowedProviders = listProviders(env).map((item) => item.id);
  const providerConfig = player.providers && player.providers[providerId] ? player.providers[providerId] : {};
  const apiKey = typeof providerConfig.apiKey === "string" ? providerConfig.apiKey.trim() : "";
  if (!provider || provider.id === "local" || !allowedProviders.includes(provider.id) || !apiKey) return null;
  const model = providerConfig.model || seat.model || provider.defaultModel;
  return { player, provider, providerConfig, apiKey, model };
}

async function autoResolveDecisionForTurn(match, turn, options) {
  const opts = options || {};
  const rulesPayload = Contract.buildRulesPayload(match.state, turn.team, turn.command);
  const configured = configuredSeatProvider(turn.seat, opts.env);
  if (!configured) {
    return {
      command: turn.command,
      providerLabel: localAutoProviderLabel(turn.team),
      decision: localDecisionFromRules(rulesPayload)
    };
  }

  const providerLabel = `${turn.seat.displayName || configured.player.displayName} / ${configured.model}`;
  try {
    const result = await executeProviderDecision(
      configured.provider,
      {
        apiKey: configured.apiKey,
        command: turn.command,
        candidates: rulesPayload.legalActions.filter((action) => action.action === "shot"),
        stateSummary: summarizeState(match.state),
        rulesPayload,
        model: configured.model
      },
      { env: opts.env, fetch: opts.fetchFn }
    );
    return {
      command: turn.command,
      providerLabel,
      decision: result.decision
    };
  } catch (err) {
    return {
      command: turn.command,
      providerLabel: localAutoProviderLabel(turn.team),
      decision: localDecisionFromRules(rulesPayload)
    };
  }
}

async function advanceMatchToResolution(match, options) {
  const opts = options || {};
  let guard = 0;
  const maxActions = Sim.CONFIG.maxTurns * (Sim.CONFIG.maxRerollsPerTurn + 1) + 4;
  while (!match.state.winner && match.state.turn < Sim.CONFIG.maxTurns && guard < maxActions) {
    guard += 1;
    const turn = autoResolveCommandsForTurn(match, opts);
    const resolved = await autoResolveDecisionForTurn(match, turn, opts);
    if (isSwapAction(resolved.decision.action)) {
      Sim.applyTurn(match.state, {}, {
        action: "swap_hand",
        provider: resolved.providerLabel,
        providerReason: resolved.decision.publicReason
      });
      continue;
    }
    Sim.applyTurn(
      match.state,
      { [turn.team]: resolved.command },
      {
        candidateId: resolved.decision.candidateId || undefined,
        provider: resolved.providerLabel,
        providerReason: resolved.decision.publicReason
      }
    );
  }
  match.status = "resolved";
  return match.state;
}

function publicEventSummary(event) {
  if (!event) return null;
  return {
    turn: event.turn,
    team: event.team,
    provider: event.provider || "Local AI",
    shooterId: event.shooterId,
    targetId: event.targetId,
    result: event.result,
    resultLabel: event.resultLabel,
    combo: event.combo ? event.combo.name : "Mixed Curve",
    damage: event.damage || 0
  };
}

function buildAutoBattleSummary(match, startedTurn, playerTeam, mode) {
  const start = Math.max(0, Math.min(match.state.events.length, Number(startedTurn) || 0));
  const playedEvents = match.state.events.slice(start);
  const providers = Array.from(new Set(playedEvents.map((event) => event.provider || "Local AI")));
  return {
    mode: mode || "auto_duel",
    playerTeam,
    startedTurn: start,
    finalTurn: match.state.events.length,
    resolvedTurns: playedEvents.length,
    winner: match.state.winner || "draw",
    score: match.state.score,
    providers,
    finalEvent: publicEventSummary(match.state.events[match.state.events.length - 1])
  };
}

async function settleResolvedMatch(match, player, playerSeat, env, options, fetchFn) {
  const opts = options || {};
  const startedTurn = match.state.events.length;
  const playerTeam = playerSeat ? playerSeat.team : "A";
  const finalState = await advanceMatchToResolution(match, {
    env,
    fetchFn,
    playerId: player.id,
    playerTeam,
    command: opts.command
  });
  let settlement = match.rankSettlements[player.id];
  if (!settlement) {
    const rankDelta = resolveRankDelta(finalState.winner, playerTeam);
    player.rank.rating += rankDelta;
    player.rank.games += 1;
    player.rank.tier = player.rank.rating >= 1200 ? "Gold" : player.rank.rating >= 1050 ? "Silver" : "Bronze";
    settlement = { rankDelta, rating: player.rank.rating };
    match.rankSettlements[player.id] = settlement;
    savePersistentStore(env);
  }
  return {
    match,
    player: publicPlayer(player),
    rankDelta: settlement.rankDelta,
    score: finalState.score,
    autoBattle: buildAutoBattleSummary(match, opts.startedTurn ?? startedTurn, playerTeam, opts.mode || "auto_duel")
  };
}

function resolveRankDelta(winner, playerTeam) {
  if (winner === playerTeam) return 28;
  if (winner === "draw") return -4;
  return -22;
}

function normalizeContestants(rawContestants) {
  const source = Array.isArray(rawContestants) && rawContestants.length
    ? rawContestants
    : [
        { id: "local-arc", label: "Local Arc", provider: "local", command: "safe high arc target weakest enemy" },
        { id: "local-bend", label: "Local Bend", provider: "local", command: "bend through center avoid ally" }
      ];
  return source.slice(0, 8).map((item, index) => ({
    id: String(item.id || `model-${index + 1}`).slice(0, 48),
    label: String(item.label || item.model || item.provider || `Model ${index + 1}`).slice(0, 80),
    provider: String(item.provider || "local").slice(0, 40),
    model: String(item.model || "").slice(0, 80),
    command: String(item.command || "").slice(0, Sim.CONFIG.maxCommandLength),
    apiKey: typeof item.apiKey === "string" ? item.apiKey : ""
  }));
}

function publicContestant(contestant) {
  return {
    id: contestant.id,
    label: contestant.label,
    provider: contestant.provider,
    model: contestant.model,
    commandLength: contestant.command.length,
    configured: Boolean(contestant.apiKey)
  };
}

function createLeagueRows(contestants) {
  return new Map(contestants.map((contestant) => [contestant.id, {
    ...publicContestant(contestant),
    rating: 1000,
    wins: 0,
    losses: 0,
    draws: 0,
    games: 0
  }]));
}

function applyLeagueScore(rows, teamA, teamB, winner) {
  const a = rows.get(teamA.id);
  const b = rows.get(teamB.id);
  a.games += 1;
  b.games += 1;
  if (winner === "A") {
    a.wins += 1;
    b.losses += 1;
    a.rating += 28;
    b.rating -= 22;
  } else if (winner === "B") {
    b.wins += 1;
    a.losses += 1;
    b.rating += 28;
    a.rating -= 22;
  } else {
    a.draws += 1;
    b.draws += 1;
    a.rating -= 4;
    b.rating -= 4;
  }
}

function localDecisionFromRules(rulesPayload) {
  const shot = rulesPayload.legalActions.find((action) => action.action === "shot");
  if (shot) {
    return {
      action: "shot",
      candidateId: shot.candidateId,
      publicReason: "Local baseline selected the first legal shot."
    };
  }
  if (rulesPayload.legalActions.some((action) => action.action === "reroll")) {
    return { action: "swap_hand", publicReason: "Local baseline swapped hand because no shot was legal." };
  }
  if (rulesPayload.legalActions.some((action) => action.action === "swap_hand")) {
    return { action: "swap_hand", publicReason: "Local baseline swapped hand because no shot was legal." };
  }
  return { action: "shot", candidateId: null, publicReason: "No legal action available." };
}

async function contestantDecision(contestant, state, team, env, fetchFn) {
  const command = contestant.command || "";
  const rulesPayload = Contract.buildRulesPayload(state, team, command);
  const provider = getProvider(contestant.provider);
  const allowedProviders = listProviders(env).map((item) => item.id);
  if (!provider || contestant.provider === "local" || !allowedProviders.includes(provider.id) || !contestant.apiKey.trim()) {
    return {
      command,
      providerLabel: `${contestant.label} / local`,
      decision: localDecisionFromRules(rulesPayload)
    };
  }
  const result = await executeProviderDecision(
    provider,
    {
      apiKey: contestant.apiKey,
      command,
      candidates: rulesPayload.legalActions.filter((action) => action.action === "shot"),
      stateSummary: summarizeState(state),
      rulesPayload,
      model: contestant.model
    },
    { env, fetch: fetchFn }
  );
  return {
    command,
    providerLabel: `${contestant.label} / ${contestant.model || provider.defaultModel}`,
    decision: result.decision
  };
}

async function runLeagueBattle(seed, teamA, teamB, env, fetchFn) {
  const state = Sim.createInitialState({ seed });
  let guard = 0;
  const maxActions = Sim.CONFIG.maxTurns * (Sim.CONFIG.maxRerollsPerTurn + 1) + 4;
  while (!state.winner && state.turn < Sim.CONFIG.maxTurns && guard < maxActions) {
    guard += 1;
    const team = getActiveTeam(state);
    const contestant = team === "A" ? teamA : teamB;
    const resolved = await contestantDecision(contestant, state, team, env, fetchFn);
    if (isSwapAction(resolved.decision.action)) {
      Sim.applyTurn(state, {}, {
        action: "swap_hand",
        provider: resolved.providerLabel,
        providerReason: resolved.decision.publicReason
      });
      continue;
    }
    Sim.applyTurn(
      state,
      { [team]: resolved.command },
      {
        candidateId: resolved.decision.candidateId || undefined,
        provider: resolved.providerLabel,
        providerReason: resolved.decision.publicReason
      }
    );
  }
  if (!state.winner) await advanceMatchToResolution({ state, status: "active" }, { env, fetchFn });
  return state;
}

async function runLeagueSimulation(body, env, fetchFn) {
  const contestants = normalizeContestants(body.contestants);
  if (contestants.length < 2) {
    const err = new Error("not_enough_contestants");
    err.status = 400;
    throw err;
  }
  const rounds = Math.max(1, Math.min(12, Number(body.rounds) || 3));
  const rows = createLeagueRows(contestants);
  const matchesOut = [];
  for (let round = 0; round < rounds; round += 1) {
    const teamA = contestants[round % contestants.length];
    const teamB = contestants[(round + 1) % contestants.length];
    const seed = 12000 + round * 73 + contestants.length * 17;
    const state = await runLeagueBattle(seed, teamA, teamB, env, fetchFn);
    applyLeagueScore(rows, teamA, teamB, state.winner);
    matchesOut.push({
      id: `sim-${round + 1}`,
      seed,
      teamA: publicContestant(teamA),
      teamB: publicContestant(teamB),
      winner: state.winner,
      reason: state.reason,
      events: state.events.length,
      score: state.score
        ? { value: state.score.value, rank: state.score.rank, failures: state.score.failures, enemyHits: state.score.enemyHits }
        : null
    });
  }
  return {
    rounds,
    contestants: contestants.map(publicContestant),
    leaderboard: Array.from(rows.values()).sort((a, b) => b.rating - a.rating || b.wins - a.wins),
    matches: matchesOut
  };
}

function providerErrorStatus(error) {
  if (error.message === "missing_api_key") return 400;
  if (error.message === "unknown_candidate") return 422;
  if (error.message === "missing_candidate_id") return 502;
  if (error.message === "invalid_provider_json") return 502;
  if (error.message === "provider_http_error") return 502;
  if (error.message === "reroll_limit_reached") return 409;
  return 400;
}

function createServer(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const fetchFn = opts.fetch || globalThis.fetch;
  loadPersistentStore(env);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/providers") {
        sendJson(res, 200, { defaultProvider: env.GRAPHWAR_DEFAULT_PROVIDER || "deepseek", providers: listProviders(env) });
        return;
      }
      const sessionMatch = url.pathname.match(/^\/api\/session\/([^/]+)$/);
      if (req.method === "GET" && sessionMatch) {
        const player = players.get(sessionMatch[1]);
        if (!player) {
          sendJson(res, 404, { error: "unknown_player" });
          return;
        }
        sendJson(res, 200, { player: publicPlayer(player) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/leaderboard") {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 25));
        sendJson(res, 200, { players: publicLeaderboard(limit) });
        return;
      }
      const matchmakingStatusMatch = url.pathname.match(/^\/api\/matchmaking\/([^/]+)$/);
      if (req.method === "GET" && matchmakingStatusMatch) {
        const player = players.get(matchmakingStatusMatch[1]);
        if (!player) {
          sendJson(res, 404, { error: "unknown_player" });
          return;
        }
        sendJson(res, 200, publicMatchmakingStatus(player));
        return;
      }
      const readMatch = url.pathname.match(/^\/api\/match\/([^/]+)$/);
      if (req.method === "GET" && readMatch) {
        const match = matches.get(readMatch[1]);
        if (!match) {
          sendJson(res, 404, { error: "unknown_match" });
          return;
        }
        const playerId = url.searchParams.get("playerId");
        if (playerId) {
          const player = players.get(playerId);
          if (!player) {
            sendJson(res, 404, { error: "unknown_player" });
            return;
          }
          if (!getPlayerSeat(match, player)) {
            sendJson(res, 403, { error: "player_not_in_match" });
            return;
          }
        }
        sendJson(res, 200, { match });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/session") {
        const body = JSON.parse(await readBody(req, 128_000));
        const id = `player-${nextPlayerId++}`;
        const player = {
          id,
          displayName: String(body.displayName || "Player").slice(0, 32),
          providers: body.providers || {},
          rank: { rating: 1000, tier: "Bronze", games: 0 }
        };
        players.set(id, player);
        savePersistentStore(env);
        sendJson(res, 200, { player: publicPlayer(player) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/match/join") {
        const body = JSON.parse(await readBody(req, 64_000));
        const player = players.get(String(body.playerId || ""));
        if (!player) {
          sendJson(res, 404, { error: "unknown_player" });
          return;
        }
        const indexedMatch = getIndexedMatch(player.id);
        if (indexedMatch && indexedMatch.status !== "resolved") {
          sendJson(res, 200, { match: indexedMatch, queueSize: matchmakingQueue.length });
          return;
        }
        if (indexedMatch && indexedMatch.status === "resolved") {
          playerMatchIndex.delete(player.id);
        }
        const allowAiFill = body.allowAiFill !== false;
        if (!allowAiFill) {
          const queuedMatch = queueRankedPlayer(player, body.preferredProvider);
          if (!queuedMatch) {
            sendJson(res, 202, publicMatchmakingStatus(player));
            return;
          }
          sendJson(res, 200, { match: queuedMatch, queueSize: matchmakingQueue.length });
          return;
        }
        const match = createAiFallbackMatch(player, body.preferredProvider);
        sendJson(res, 200, { match });
        return;
      }
      const actionMatch = url.pathname.match(/^\/api\/match\/([^/]+)\/action$/);
      if (req.method === "POST" && actionMatch) {
        const body = JSON.parse(await readBody(req, 64_000));
        const match = matches.get(actionMatch[1]);
        const player = players.get(String(body.playerId || ""));
        if (!match || !player) {
          sendJson(res, 404, { error: "unknown_match_or_player" });
          return;
        }
        if (!getPlayerSeat(match, player)) {
          sendJson(res, 403, { error: "player_not_in_match" });
          return;
        }
        if (match.status === "resolved" || match.state.winner) {
          sendJson(res, 409, { error: "match_already_resolved" });
          return;
        }
        const action = String(body.action || "shot");
        if (action !== "shot" && !isSwapAction(action)) {
          sendJson(res, 400, { error: "unknown_action" });
          return;
        }
        const team = getActiveTeam(match.state);
        if (!team) {
          sendJson(res, 409, { error: "match_already_resolved" });
          return;
        }
        try {
          let rerollResult = null;
          const beforeEventCount = match.state.events.length;
          if (isSwapAction(action)) {
            rerollResult = Sim.applyTurn(match.state, {}, { action: "swap_hand" });
          } else {
            const command = String(body.command || "").slice(0, Sim.CONFIG.maxCommandLength);
            Sim.applyTurn(
              match.state,
              { [team]: command },
              {
                candidateId: body.candidateId,
                provider: String(body.provider || "").slice(0, 80) || null,
                providerReason: String(body.providerReason || "").slice(0, 240) || null
              }
            );
          }
          match.status = match.state.winner ? "resolved" : "active";
          const summary = buildActionSummary(match, action, team, rerollResult, beforeEventCount);
          sendJson(res, 200, { match, action: summary });
        } catch (err) {
          sendJson(res, providerErrorStatus(err), { error: err.message || "action_failed" });
        }
        return;
      }
      const autoDuelMatch = url.pathname.match(/^\/api\/match\/([^/]+)\/auto-duel$/);
      if (req.method === "POST" && autoDuelMatch) {
        const body = JSON.parse(await readBody(req, 64_000));
        const match = matches.get(autoDuelMatch[1]);
        const player = players.get(String(body.playerId || ""));
        if (!match || !player) {
          sendJson(res, 404, { error: "unknown_match_or_player" });
          return;
        }
        const playerSeat = getPlayerSeat(match, player);
        if (!playerSeat) {
          sendJson(res, 403, { error: "player_not_in_match" });
          return;
        }
        const command = String(body.command || "").slice(0, Sim.CONFIG.maxCommandLength);
        sendJson(res, 200, await settleResolvedMatch(match, player, playerSeat, env, { mode: "auto_duel", command }, fetchFn));
        return;
      }
      const resolveMatch = url.pathname.match(/^\/api\/match\/([^/]+)\/resolve$/);
      if (req.method === "POST" && resolveMatch) {
        const body = JSON.parse(await readBody(req, 64_000));
        const match = matches.get(resolveMatch[1]);
        const player = players.get(String(body.playerId || ""));
        if (!match || !player) {
          sendJson(res, 404, { error: "unknown_match_or_player" });
          return;
        }
        const playerSeat = getPlayerSeat(match, player);
        if (!playerSeat) {
          sendJson(res, 403, { error: "player_not_in_match" });
          return;
        }
        sendJson(res, 200, await settleResolvedMatch(match, player, playerSeat, env, { mode: "rank_resolve" }, fetchFn));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/simulations/league") {
        const body = JSON.parse(await readBody(req, 512_000));
        try {
          const simulation = await runLeagueSimulation(body, env, fetchFn);
          sendJson(res, 200, simulation);
        } catch (err) {
          sendJson(res, err.status || providerErrorStatus(err), { error: err.message || "simulation_failed" });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/agent/shot") {
        const body = JSON.parse(await readBody(req, 512_000));
        const provider = getProvider(body.provider);
        const allowedProviders = listProviders(env).map((item) => item.id);
        if (!provider || !allowedProviders.includes(provider.id)) {
          sendJson(res, 400, { error: "unknown_provider" });
          return;
        }
        if (!body.state || (body.team !== "A" && body.team !== "B")) {
          sendJson(res, 400, { error: "invalid_agent_request" });
          return;
        }
        const command = String(body.command || "").slice(0, 80);
        const rulesPayload = Contract.buildRulesPayload(body.state, body.team, command);
        const candidates = rulesPayload.legalActions.filter((action) => action.action === "shot");
        if (!rulesPayload.legalActions.length) {
          sendJson(res, 409, { error: "no_legal_actions" });
          return;
        }
        try {
          const result = await executeProviderDecision(
            provider,
            {
              apiKey: body.apiKey,
              command,
              candidates,
              stateSummary: summarizeState(body.state),
              rulesPayload,
              model: body.model
            },
            { env, fetch: fetchFn }
          );
          sendJson(res, 200, {
            provider: provider.id,
            model: body.model || env[provider.modelEnv] || provider.defaultModel,
            decision: result.decision,
            candidate: result.candidate,
            candidatesConsidered: candidates.length
          });
        } catch (err) {
          sendJson(res, providerErrorStatus(err), { error: err.message || "provider_error" });
        }
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        serveStatic(req, res);
        return;
      }
      sendJson(res, 405, { error: "method_not_allowed" });
    } catch (err) {
      sendJson(res, err.message === "body_too_large" ? 413 : 400, { error: err.message || "bad_request" });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  createServer().listen(port, host, () => {
    console.log(`Mob Graphwar listening on http://${host}:${port}`);
  });
}

module.exports = {
  createServer
};
