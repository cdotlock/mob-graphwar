"use strict";

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { listProviders, listProviderCatalog, listProviderModels, getProvider } = require("./providers/catalog.js");
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
const DEFAULT_AI_PROVIDER = "openrouter";
const DEFAULT_AI_MODEL = "openrouter/free";
const MATCH_COMMANDER_COUNT = 2;
const LEAGUE_MAX_CONTESTANTS = 16;
const LEAGUE_MAX_MATCHES = 240;
const TEAM_UNITS = {
  A: ["A1", "A2"],
  B: ["B1", "B2"]
};
const DEFAULT_AI_ORDER = "pressure weakest enemy; swap no-lane hands; use low threads and ceiling locks";
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
    handle: player.handle || "",
    displayName: player.displayName,
    createdAt: player.createdAt || "",
    lastLoginAt: player.lastLoginAt || "",
    passwordHash: player.passwordHash || "",
    passwordSalt: player.passwordSalt || "",
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
      handle: String(player.handle || "").toLowerCase().slice(0, 24),
      displayName: String(player.displayName || "Player").slice(0, 32),
      createdAt: String(player.createdAt || ""),
      lastLoginAt: String(player.lastLoginAt || ""),
      passwordHash: String(player.passwordHash || ""),
      passwordSalt: String(player.passwordSalt || ""),
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
    handle: player.handle || "",
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

function normalizeHandle(handle) {
  return String(handle || "").trim().toLowerCase();
}

function assertValidHandle(handle) {
  if (!/^[a-z0-9_-]{3,24}$/.test(handle)) {
    const err = new Error("invalid_handle");
    err.status = 400;
    throw err;
  }
}

function assertValidPassword(password) {
  if (String(password || "").length < 8) {
    const err = new Error("weak_password");
    err.status = 400;
    throw err;
  }
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 120_000, 32, "sha256").toString("hex");
}

function createPasswordRecord(password) {
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  return {
    passwordSalt,
    passwordHash: hashPassword(password, passwordSalt)
  };
}

function verifyPassword(player, password) {
  if (!player.passwordHash || !player.passwordSalt) return false;
  const expected = Buffer.from(player.passwordHash, "hex");
  const actual = Buffer.from(hashPassword(password, player.passwordSalt), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function findPlayerByHandle(handle) {
  const normalized = normalizeHandle(handle);
  return Array.from(players.values()).find((player) => normalizeHandle(player.handle) === normalized) || null;
}

function normalizeAuthProviders(providers) {
  if (!providers || typeof providers !== "object") return {};
  return Object.fromEntries(
    Object.entries(providers).map(([id, value]) => [
      String(id).slice(0, 40),
      {
        apiKey: typeof value?.apiKey === "string" ? value.apiKey : "",
        model: typeof value?.model === "string" ? value.model.slice(0, 100) : "",
        configured: Boolean(value?.apiKey || value?.configured)
      }
    ])
  );
}

function createRegisteredPlayer(body) {
  const handle = normalizeHandle(body.handle);
  assertValidHandle(handle);
  assertValidPassword(body.password);
  if (findPlayerByHandle(handle)) {
    const err = new Error("handle_taken");
    err.status = 409;
    throw err;
  }
  const now = new Date().toISOString();
  const passwordRecord = createPasswordRecord(body.password);
  return {
    id: `player-${nextPlayerId++}`,
    handle,
    displayName: String(body.displayName || handle).trim().slice(0, 32) || handle,
    createdAt: now,
    lastLoginAt: now,
    ...passwordRecord,
    providers: normalizeAuthProviders(body.providers),
    rank: { rating: 1000, tier: "Bronze", games: 0 }
  };
}

function authErrorResponse(res, err) {
  sendJson(res, err.status || 400, { error: err.message || "auth_failed" });
}

function sessionSecret(env) {
  return String((env || process.env).GRAPHWAR_SESSION_SECRET || "dev-graphwar-session-secret");
}

function encodeSessionPayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function signSessionPayload(encodedPayload, env) {
  return crypto.createHmac("sha256", sessionSecret(env)).update(encodedPayload).digest("base64url");
}

function createSessionToken(player, env) {
  const encodedPayload = encodeSessionPayload({
    playerId: player.id,
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(8).toString("hex")
  });
  return `${encodedPayload}.${signSessionPayload(encodedPayload, env)}`;
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function verifySessionToken(token, env) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) return null;
  const expected = signSessionPayload(encodedPayload, env);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload || !payload.playerId) return null;
    const issuedAt = Number(payload.issuedAt);
    const maxAgeMs = 1000 * 60 * 60 * 24 * 30;
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionPlayer(req, env) {
  const token = bearerToken(req);
  if (!token) return { status: 401, error: "missing_session" };
  const payload = verifySessionToken(token, env);
  if (!payload) return { status: 401, error: "invalid_session" };
  const player = players.get(String(payload.playerId));
  if (!player) return { status: 401, error: "invalid_session" };
  return { player };
}

function protectedPlayer(req, res, env, requestedPlayerId) {
  const resolved = sessionPlayer(req, env);
  if (!resolved.player) {
    sendJson(res, resolved.status, { error: resolved.error });
    return null;
  }
  const requested = String(requestedPlayerId || "");
  if (requested && requested !== resolved.player.id) {
    sendJson(res, 403, { error: "session_player_mismatch" });
    return null;
  }
  return resolved.player;
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

function normalizeStandingOrder(value) {
  return String(value || "").trim().slice(0, Sim.CONFIG.maxCommandLength);
}

function attachStandingOrder(seat, standingOrder) {
  const order = normalizeStandingOrder(standingOrder);
  Object.defineProperty(seat, "standingOrder", {
    value: order,
    enumerable: false,
    writable: true,
    configurable: true
  });
  seat.standingOrderConfigured = Boolean(order);
  seat.standingOrderLength = order.length;
  return seat;
}

function seatStandingOrder(seat) {
  return normalizeStandingOrder(seat && seat.standingOrder);
}

function createRoster(player, preferredProvider, standingOrder) {
  return [
    ...createHumanCommanderSeats(player, preferredProvider, "A", standingOrder),
    ...createAiCommanderSeats("B", "AI Rival")
  ];
}

function preferredPlayerProvider(player, preferredProvider) {
  if (preferredProvider) return String(preferredProvider).slice(0, 40);
  const configured = Object.keys(player.providers || {});
  return configured[0] || "local";
}

function createHumanSeat(player, preferredProvider, unitId, team, standingOrder) {
  const provider = preferredPlayerProvider(player, preferredProvider);
  const providerConfig = player.providers && player.providers[provider] ? player.providers[provider] : {};
  return attachStandingOrder({
    unitId,
    team,
    control: "human",
    playerId: player.id,
    commanderId: player.id,
    commanderSlot: team,
    displayName: player.displayName,
    provider,
    model: providerConfig.model || ""
  }, standingOrder);
}

function createHumanCommanderSeats(player, preferredProvider, team, standingOrder) {
  return (TEAM_UNITS[team] || []).map((unitId) => createHumanSeat(player, preferredProvider, unitId, team, standingOrder));
}

function createAiSeat(unitId, team, displayName) {
  return attachStandingOrder(
    {
      unitId,
      team,
      control: "ai",
      commanderId: `${team.toLowerCase()}-ai-commander`,
      commanderSlot: team,
      displayName,
      provider: DEFAULT_AI_PROVIDER,
      model: DEFAULT_AI_MODEL
    },
    DEFAULT_AI_ORDER
  );
}

function createAiCommanderSeats(team, displayName) {
  return (TEAM_UNITS[team] || []).map((unitId) => createAiSeat(unitId, team, displayName));
}

function createRankedMatchFromRoster(roster, options) {
  const opts = options || {};
  const id = `match-${nextMatchId++}`;
  const seed = 9000 + nextMatchId * 37 + roster.length * 11;
  const match = {
    id,
    mode: "ranked_team_1v1",
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

function createRankedMatch(player, preferredProvider, standingOrder) {
  return createRankedMatchFromRoster(createRoster(player, preferredProvider, standingOrder), { filledByAi: true });
}

function createHumanRankedMatch(entries) {
  const seats = entries.flatMap((entry, index) => {
    const player = players.get(entry.playerId);
    const team = index === 0 ? "A" : "B";
    return createHumanCommanderSeats(player, entry.preferredProvider, team, entry.standingOrder);
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
      match: publicMatch(match),
      queueSize: matchmakingQueue.length,
      needed: Math.max(0, MATCH_COMMANDER_COUNT - matchmakingQueue.length)
    };
  }
  const queuedIndex = matchmakingQueue.findIndex((entry) => entry.playerId === player.id);
  if (queuedIndex >= 0) {
    return {
      status: "queued",
      queueSize: matchmakingQueue.length,
      position: queuedIndex + 1,
      needed: Math.max(0, MATCH_COMMANDER_COUNT - matchmakingQueue.length)
    };
  }
  return {
    status: "idle",
    queueSize: matchmakingQueue.length,
    needed: Math.max(0, MATCH_COMMANDER_COUNT - matchmakingQueue.length)
  };
}

function queueRankedPlayer(player, preferredProvider, standingOrder) {
  removeQueuedPlayer(player.id);
  matchmakingQueue.push({
    playerId: player.id,
    preferredProvider: preferredProvider || preferredPlayerProvider(player),
    standingOrder: normalizeStandingOrder(standingOrder),
    joinedAt: Date.now()
  });
  if (matchmakingQueue.length >= MATCH_COMMANDER_COUNT) {
    return createHumanRankedMatch(matchmakingQueue.splice(0, MATCH_COMMANDER_COUNT));
  }
  return null;
}

function createAiFallbackMatch(player, preferredProvider, standingOrder) {
  removeQueuedPlayer(player.id);
  if (matchmakingQueue.length >= MATCH_COMMANDER_COUNT - 1) {
    const entries = matchmakingQueue.splice(0, MATCH_COMMANDER_COUNT - 1).concat({
      playerId: player.id,
      preferredProvider: preferredProvider || preferredPlayerProvider(player),
      standingOrder: normalizeStandingOrder(standingOrder)
    });
    return createHumanRankedMatch(entries);
  }
  return createRankedMatch(player, preferredProvider, standingOrder);
}

function getPlayerSeat(match, player) {
  if (!match || !player) return null;
  return match.roster.find((seat) => seat.playerId === player.id) || null;
}

function getActiveTeam(state) {
  const unit = Sim.getActiveUnit ? Sim.getActiveUnit(state) : null;
  return unit ? unit.team : null;
}

function getActiveUnitId(state) {
  const unit = Sim.getActiveUnit ? Sim.getActiveUnit(state) : null;
  return unit ? unit.id : null;
}

function isSwapAction(action) {
  return action === "swap_hand" || action === "reroll";
}

function buildActionSummary(match, action, team, unitId, rerollResult, beforeEventCount) {
  if (isSwapAction(action)) {
    return {
      action: "swap_hand",
      team,
      unitId,
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
    unitId: event ? event.unitId || event.shooterId : unitId,
    event,
    result: event ? event.result : match.state.reason,
    winner: match.state.winner
  };
}

function autoResolveCommandsForTurn(match, options) {
  const opts = options || {};
  const unitId = getActiveUnitId(match.state);
  const team = getActiveTeam(match.state);
  const seat = getRosterSeatForTurn(match, unitId);
  const launchOrder = seatStandingOrder(seat);
  const requestOrder = seat && opts.playerId && seat.playerId === opts.playerId
    ? normalizeStandingOrder(opts.command)
    : "";
  const command = launchOrder || requestOrder;
  return { team, unitId, seat, command };
}

function getRosterSeatForTurn(match, unitId) {
  if (!match || !unitId || !Array.isArray(match.roster)) return null;
  const unit = (match.state.units || []).find((item) => item.id === unitId);
  return match.roster.find((seat) => seat.unitId === unitId) || match.roster.find((seat) => seat.team === unit?.team) || null;
}

function publicRosterSeat(seat) {
  return {
    unitId: seat.unitId,
    team: seat.team,
    control: seat.control,
    playerId: seat.playerId || null,
    commanderId: seat.commanderId || seat.playerId || null,
    commanderSlot: seat.commanderSlot || seat.team,
    displayName: seat.displayName,
    provider: seat.provider,
    model: seat.model || "",
    standingOrderConfigured: Boolean(seat.standingOrderConfigured),
    standingOrderLength: Number(seat.standingOrderLength) || 0
  };
}

function buildRulesDigest(rulesPayload) {
  const payload = rulesPayload || {};
  const hand = payload.hand || {};
  const legalActions = Array.isArray(payload.legalActions) ? payload.legalActions : [];
  return {
    promptPolicy: "bare_rules_only",
    activeUnitId: payload.activeUnitId || "",
    team: payload.team || "",
    objective: payload.objective || "",
    handRetained: hand.retained === true,
    handSize: Array.isArray(hand.cards) ? hand.cards.length : 0,
    handArchetype: hand.analysis && hand.analysis.archetype ? hand.analysis.archetype : "",
    swapsUsed: Number(hand.swapsUsed) || 0,
    swapsRemaining: Number(hand.swapsRemaining) || 0,
    legalActionCount: legalActions.length,
    legalShotCount: legalActions.filter((action) => action.action === "shot").length,
    canSwap: legalActions.some((action) => action.action === "swap_hand"),
    allyIds: Array.isArray(payload.allyIds) ? payload.allyIds.slice() : [],
    opponentIds: Array.isArray(payload.opponentIds) ? payload.opponentIds.slice() : []
  };
}

function buildPublicRulesPacket(match, player, command) {
  const activeUnitId = getActiveUnitId(match.state);
  const activeTeam = getActiveTeam(match.state);
  const seat = getRosterSeatForTurn(match, activeUnitId);
  return {
    matchId: match.id,
    status: match.status,
    activeSeat: seat ? publicRosterSeat(seat) : null,
    requesterSeat: getPlayerSeat(match, player) ? publicRosterSeat(getPlayerSeat(match, player)) : null,
    roster: (match.roster || []).map(publicRosterSeat),
    modelContract: Contract.buildRulesPayload(match.state, activeUnitId || activeTeam || "A1", command || "")
  };
}

function localAutoProviderLabel(team) {
  return team === "A" ? "Auto Resolve A" : "Auto Resolve B";
}

function providerEnvKey(provider, env) {
  const source = env || process.env;
  if (!provider) return "";
  return source[provider.keyEnv] || (provider.alternateKeyEnv ? source[provider.alternateKeyEnv] : "") || "";
}

function configuredSeatProvider(seat, env) {
  if (!seat) return null;
  const source = env || process.env;
  const player = seat.control === "human" && seat.playerId ? players.get(seat.playerId) : null;
  const providerId = String(seat.provider || (player ? preferredPlayerProvider(player) : DEFAULT_AI_PROVIDER)).slice(0, 40);
  const provider = getProvider(providerId);
  const allowedProviders = listProviders(env).map((item) => item.id);
  const providerConfig = player && player.providers && player.providers[providerId] ? player.providers[providerId] : {};
  const apiKey = typeof providerConfig.apiKey === "string" ? providerConfig.apiKey.trim() : "";
  const envKey = providerEnvKey(provider, source);
  if (!provider || provider.id === "local" || !allowedProviders.includes(provider.id)) return null;
  if (seat.control === "ai") {
    if (!envKey) return null;
    return {
      player: null,
      provider,
      providerConfig: {},
      apiKey: "",
      model: seat.model || source[provider.modelEnv] || provider.defaultModel
    };
  }
  if (!player || !apiKey) return null;
  const model = providerConfig.model || seat.model || source[provider.modelEnv] || provider.defaultModel;
  return { player, provider, providerConfig, apiKey, model };
}

function createProviderBudget(env) {
  const source = env || process.env;
  const maxCalls = Number(source.GRAPHWAR_PROVIDER_CALL_BUDGET);
  const maxFailures = Number(source.GRAPHWAR_PROVIDER_FAILURE_BUDGET);
  return {
    calls: 0,
    failures: 0,
    disabled: false,
    maxCalls: Number.isFinite(maxCalls) && maxCalls >= 0 ? maxCalls : 6,
    maxFailures: Number.isFinite(maxFailures) && maxFailures >= 0 ? maxFailures : 2
  };
}

function budgetAllowsProvider(budget) {
  if (!budget) return true;
  return !budget.disabled && budget.calls < budget.maxCalls;
}

function recordProviderFailure(budget, err) {
  if (!budget) return;
  budget.failures += 1;
  if (err?.message === "provider_timeout" || budget.failures >= budget.maxFailures || budget.calls >= budget.maxCalls) {
    budget.disabled = true;
  }
}

async function autoResolveDecisionForTurn(match, turn, options) {
  const opts = options || {};
  const rulesPayload = Contract.buildRulesPayload(match.state, turn.unitId || turn.team, turn.command);
  const rulesDigest = buildRulesDigest(rulesPayload);
  const configured = configuredSeatProvider(turn.seat, opts.env);
  if (!configured || !budgetAllowsProvider(opts.providerBudget)) {
    return {
      command: turn.command,
      providerLabel: localAutoProviderLabel(turn.team),
      decision: localDecisionFromRules(rulesPayload),
      rulesDigest
    };
  }

  const providerLabel = `${turn.seat.displayName || configured.player?.displayName || configured.provider.label} / ${configured.model}`;
  try {
    if (opts.providerBudget) opts.providerBudget.calls += 1;
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
      decision: result.decision,
      rulesDigest
    };
  } catch (err) {
    recordProviderFailure(opts.providerBudget, err);
    return {
      command: turn.command,
      providerLabel: localAutoProviderLabel(turn.team),
      decision: localDecisionFromRules(rulesPayload),
      rulesDigest
    };
  }
}

async function advanceMatchToResolution(match, options) {
  const opts = options || {};
  opts.providerBudget = opts.providerBudget || createProviderBudget(opts.env);
  let guard = 0;
  const maxActions = Math.max(32, Number(Sim.CONFIG.maxResolutionActions || 96) * (Sim.CONFIG.maxRerollsPerTurn + 1));
  while (!match.state.winner && guard < maxActions) {
    guard += 1;
    const turn = autoResolveCommandsForTurn(match, opts);
    const resolved = await autoResolveDecisionForTurn(match, turn, opts);
    if (isSwapAction(resolved.decision.action)) {
      const rerollResult = Sim.applyTurn(match.state, {}, {
        action: "swap_hand",
        provider: resolved.providerLabel,
        providerReason: resolved.decision.publicReason
      });
      pushPlaybackFrame(opts.frames, match, {
        action: "swap_hand",
        team: turn.team,
        unitId: turn.unitId,
        provider: resolved.providerLabel,
        publicReason: resolved.decision.publicReason,
        swapsUsed: rerollResult.swapsUsed,
        swapsRemaining: rerollResult.swapsRemaining,
        hand: rerollResult.cards,
        rulesDigest: resolved.rulesDigest
      });
      continue;
    }
    const beforeEventCount = match.state.events.length;
    Sim.applyTurn(
      match.state,
      { [turn.unitId || turn.team]: resolved.command },
      {
        candidateId: resolved.decision.candidateId || undefined,
        provider: resolved.providerLabel,
        providerReason: resolved.decision.publicReason
      }
    );
    const event = match.state.events[beforeEventCount] || match.state.events[match.state.events.length - 1] || null;
    pushPlaybackFrame(opts.frames, match, {
      action: "shot",
      team: turn.team,
      unitId: event ? event.unitId || event.shooterId : turn.unitId,
      provider: resolved.providerLabel,
      publicReason: resolved.decision.publicReason,
      candidateId: resolved.decision.candidateId || null,
      resultLabel: event ? event.resultLabel : match.state.reason || null,
      event: publicEventSummary(event),
      rulesDigest: resolved.rulesDigest
    });
  }
  if (!match.state.winner) {
    Sim.forceResolveByHp(match.state, "resolution_guard");
    pushPlaybackFrame(opts.frames, match, {
      action: "state",
      team: match.state.winner || "draw",
      provider: "Battle Engine",
      publicReason: "Resolution guard settled the extended duel by remaining HP.",
      resultLabel: match.state.winner ? `${match.state.winner} wins by remaining HP` : "draw",
      rulesDigest: {
        promptPolicy: "bare_rules_only",
        handRetained: true,
        legalShotCount: 0,
        allyIds: [],
        opponentIds: [],
        resolutionGuard: true
      }
    });
  }
  match.status = "resolved";
  return match.state;
}

function publicEventSummary(event) {
  if (!event) return null;
  return {
    turn: event.turn,
    team: event.team,
    unitId: event.unitId || event.shooterId,
    provider: event.provider || "Local AI",
    shooterId: event.shooterId,
    targetId: event.targetId,
    candidateId: event.candidateId || null,
    energy: event.energy,
    cost: event.cost,
    result: event.result,
    resultLabel: event.resultLabel,
    combo: event.combo ? clonePublic(event.combo) : { name: "y0+dy*t" },
    routeBonus: clonePublic(event.routeBonus || { value: 0, pointIds: [] }),
    expression: event.expression || "",
    thinking: clonePublic(event.thinking || null),
    damage: event.damage || 0,
    score: event.score,
    closestTargetDistance: event.closestTargetDistance,
    maxY: event.maxY,
    collisionPoint: event.collisionPoint || null
  };
}

function clonePublic(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicPlaybackState(state) {
  return {
    seed: state.seed,
    config: clonePublic(state.config || null),
    turn: state.turn,
    mapMeta: clonePublic(state.mapMeta || null),
    obstacles: clonePublic(state.obstacles || []),
    bonusPoints: clonePublic(state.bonusPoints || []),
    units: (state.units || []).map((unit) => ({
      id: unit.id,
      team: unit.team,
      name: unit.name,
      x: unit.x,
      y: unit.y,
      hp: unit.hp
    })),
    events: (state.events || []).map(publicEventSummary),
    paths: clonePublic(state.paths || []),
    hands: clonePublic(state.hands || null),
    winner: state.winner || null,
    reason: state.reason || null,
    score: clonePublic(state.score || null)
  };
}

function publicMatch(match) {
  if (!match) return null;
  return {
    id: match.id,
    mode: match.mode,
    status: match.status,
    seed: match.seed,
    roster: (match.roster || []).map(publicRosterSeat),
    filledByAi: Boolean(match.filledByAi),
    state: publicPlaybackState(match.state)
  };
}

function buildPlaybackFrame(match, action) {
  const publicAction = action || { action: "state", provider: "Battle Engine" };
  return {
    index: 0,
    turn: match.state.turn,
    winner: match.state.winner || null,
    action: {
      action: publicAction.action || "state",
      team: publicAction.team || getActiveTeam(match.state) || "-",
      unitId: publicAction.unitId || getActiveUnitId(match.state) || null,
      provider: publicAction.provider || "Battle Engine",
      publicReason: publicAction.publicReason || "",
      resultLabel: publicAction.resultLabel || null,
      candidateId: publicAction.candidateId || null,
      swapsUsed: Number.isFinite(Number(publicAction.swapsUsed)) ? Number(publicAction.swapsUsed) : null,
      swapsRemaining: Number.isFinite(Number(publicAction.swapsRemaining)) ? Number(publicAction.swapsRemaining) : null,
      hand: Array.isArray(publicAction.hand) ? clonePublic(publicAction.hand) : null,
      rulesDigest: publicAction.rulesDigest ? clonePublic(publicAction.rulesDigest) : null,
      event: publicAction.event || null
    },
    state: publicPlaybackState(match.state)
  };
}

function pushPlaybackFrame(frames, match, action) {
  if (!Array.isArray(frames)) return;
  const frame = buildPlaybackFrame(match, action);
  frame.index = frames.length;
  frames.push(frame);
}

function buildAutoBattleSummary(match, startedTurn, playerTeam, mode, frames) {
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
    finalEvent: publicEventSummary(match.state.events[match.state.events.length - 1]),
    modelTurns: (Array.isArray(frames) ? frames : [])
      .filter((frame) => frame.action && frame.action.action !== "start")
      .map((frame) => ({
        index: frame.index,
        action: frame.action.action,
        team: frame.action.team,
        unitId: frame.action.unitId,
        provider: frame.action.provider,
        resultLabel: frame.action.resultLabel,
        expression: frame.action.event?.expression || "",
        hand: frame.action.hand || null,
        publicReason: frame.action.publicReason || "",
        rulesDigest: frame.action.rulesDigest || null
      })),
    frames: Array.isArray(frames) ? frames : []
  };
}

async function settleResolvedMatch(match, player, playerSeat, env, options, fetchFn) {
  const opts = options || {};
  const startedTurn = match.state.events.length;
  const playerTeam = playerSeat ? playerSeat.team : "A";
  const frames = [];
  pushPlaybackFrame(frames, match, {
    action: "start",
    team: getActiveTeam(match.state) || playerTeam,
    provider: "Battle Engine",
    publicReason: "Pre-duel ranked state."
  });
  const finalState = await advanceMatchToResolution(match, {
    env,
    fetchFn,
    playerId: player.id,
    playerTeam,
    command: opts.command,
    frames
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
    match: publicMatch(match),
    player: publicPlayer(player),
    rankDelta: settlement.rankDelta,
    score: finalState.score,
    autoBattle: buildAutoBattleSummary(match, opts.startedTurn ?? startedTurn, playerTeam, opts.mode || "auto_duel", frames)
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
        {
          id: "router-thread",
          label: "OpenRouter Thread",
          provider: DEFAULT_AI_PROVIDER,
          model: DEFAULT_AI_MODEL,
          command: "thread the maze; swap no-lane hands; avoid ally fire"
        },
        {
          id: "router-pressure",
          label: "OpenRouter Pressure",
          provider: DEFAULT_AI_PROVIDER,
          model: DEFAULT_AI_MODEL,
          command: "pressure weakest enemy; bend low when ceiling locks high arcs"
        }
      ];
  return source.slice(0, LEAGUE_MAX_CONTESTANTS).map((item, index) => ({
    id: String(item.id || `model-${index + 1}`).slice(0, 48),
    label: String(item.label || item.model || item.provider || `Model ${index + 1}`).slice(0, 80),
    provider: String(item.provider || "local").slice(0, 40),
    model: String(item.model || "").slice(0, 80),
    command: String(item.command || "").slice(0, Sim.CONFIG.maxCommandLength),
    apiKey: typeof item.apiKey === "string" ? item.apiKey : "",
    reasoning: item.reasoning && typeof item.reasoning === "object" ? clonePublic(item.reasoning) : null,
    strictDecisionSchema: item.strictDecisionSchema === true
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

function simulationApiContract() {
  return {
    endpoint: "/api/simulations/league",
    method: "POST",
    modelContract: "bare_rules_only",
    watchOnly: true,
    limits: {
      maxContestants: LEAGUE_MAX_CONTESTANTS,
      maxRounds: LEAGUE_MAX_MATCHES,
      maxMatches: LEAGUE_MAX_MATCHES,
      maxCommandLength: Sim.CONFIG.maxCommandLength
    },
    rankFormula: {
      win: 28,
      loss: -22,
      draw: -4
    },
    responseShape: ["rounds", "contestants", "leaderboard", "matches", "trace", "api"]
  };
}

function localDecisionFromRules(rulesPayload) {
  const actions = Array.isArray(rulesPayload.legalActions) ? rulesPayload.legalActions : [];
  const swap = actions.find((action) => action.action === "swap_hand");
  const shotActions = actions.filter((action) => action.action === "shot");
  const complexity = rulesPayload.state && rulesPayload.state.map && rulesPayload.state.map.complexity
    ? rulesPayload.state.map.complexity
    : {};
  const hand = rulesPayload.hand || {};
  const analysis = hand.analysis || {};
  const swapsUsed = Number(swap ? swap.swapsUsed : hand.swapsUsed) || 0;
  const totalShotCandidates = Number(rulesPayload.actionSpace && rulesPayload.actionSpace.shotCandidateCount) || shotActions.length;
  const lowActionSpace = totalShotCandidates > 0 && totalShotCandidates < 96;
  const solverPressure = Number(complexity.solverPressure) || 0;
  const swapWindowHitRate = Number(complexity.swapWindowHitRate) || 0;
  const highPressure =
    solverPressure >= 90 ||
    Number(complexity.routePressure) >= 95 ||
    Number(complexity.obstacleCount) >= 40;
  const searchMap = swapWindowHitRate > 0 && swapWindowHitRate <= 0.5;
  const underPlayable = Number(analysis.playableCount) < Math.min(Number(analysis.handSize) || 4, 3);
  const unstableHand = String(analysis.risk || "").includes("volatile") && !(analysis.traits || []).includes("precision");
  if (swap && swapsUsed < Sim.CONFIG.maxRerollsPerTurn && highPressure && (searchMap || lowActionSpace || underPlayable || unstableHand)) {
    return {
      action: "swap_hand",
      publicReason: searchMap
        ? `Local baseline searched another retained hand because solver pressure is ${solverPressure} and swap-window hit rate is ${Math.round(swapWindowHitRate * 100)}%.`
        : lowActionSpace
        ? `Local baseline swapped because only ${totalShotCandidates} legal shots fit this high-pressure map.`
        : "Local baseline swapped a weak retained hand before firing."
    };
  }
  const shot = shotActions[0];
  if (shot) {
    return {
      action: "shot",
      candidateId: shot.candidateId,
      publicReason: "Local baseline selected the first legal shot."
    };
  }
  if (actions.some((action) => action.action === "reroll")) {
    return { action: "swap_hand", publicReason: "Local baseline swapped hand because no shot was legal." };
  }
  if (actions.some((action) => action.action === "swap_hand")) {
    return { action: "swap_hand", publicReason: "Local baseline swapped hand because no shot was legal." };
  }
  return { action: "shot", candidateId: null, publicReason: "No legal action available." };
}

async function contestantDecision(contestant, state, unitId, env, fetchFn) {
  const unit = (state.units || []).find((item) => item.id === unitId) || Sim.getActiveUnit(state);
  const team = unit ? unit.team : getActiveTeam(state);
  const command = contestant.command || "";
  const rulesPayload = Contract.buildRulesPayload(state, unit ? unit.id : team, command);
  const provider = getProvider(contestant.provider);
  const allowedProviders = listProviders(env).map((item) => item.id);
  const apiKey = contestant.apiKey.trim();
  if (!provider || contestant.provider === "local" || !allowedProviders.includes(provider.id) || (!apiKey && !providerEnvKey(provider, env))) {
    return {
      command,
      providerLabel: `${contestant.label} / local`,
      decision: localDecisionFromRules(rulesPayload),
      rawText: ""
    };
  }
  const result = await executeProviderDecision(
    provider,
    {
      apiKey,
      command,
      candidates: rulesPayload.legalActions.filter((action) => action.action === "shot"),
      stateSummary: summarizeState(state),
      rulesPayload,
      model: contestant.model,
      reasoning: contestant.reasoning || undefined,
      strictDecisionSchema: contestant.strictDecisionSchema
    },
    { env, fetch: fetchFn }
  );
  return {
    command,
    providerLabel: `${contestant.label} / ${contestant.model || provider.defaultModel}`,
    decision: result.decision,
    rawText: result.rawText || "",
    reasoningText: result.reasoningText || "",
    reasoningDetails: result.reasoningDetails || null
  };
}

function contestantFailureDecision(contestant, state, unitId, err, failures) {
  const unit = (state.units || []).find((item) => item.id === unitId) || Sim.getActiveUnit(state);
  const team = unit ? unit.team : getActiveTeam(state);
  const rulesPayload = Contract.buildRulesPayload(state, unit ? unit.id : team, contestant.command || "");
  const failure = {
    turn: state.turn,
    team,
    unitId: unit ? unit.id : unitId || null,
    contestantId: contestant.id,
    model: contestant.model || "",
    error: err && err.message ? err.message : "provider_error",
    status: err && err.status ? err.status : null,
    body: err && err.body ? String(err.body).slice(0, 1200) : ""
  };
  if (Array.isArray(failures)) failures.push(failure);
  return {
    command: contestant.command || "",
    providerLabel: `${contestant.label} / provider_error`,
    decision: localDecisionFromRules(rulesPayload),
    rawText: err && err.rawText ? String(err.rawText) : "",
    reasoningText: err && err.reasoningText ? String(err.reasoningText) : "",
    reasoningDetails: err && err.reasoningDetails ? clonePublic(err.reasoningDetails) : null,
    failure
  };
}

function publicLeagueTrace(state) {
  return {
    seed: state.seed,
    turn: state.turn,
    mapMeta: clonePublic(state.mapMeta || null),
    obstacles: clonePublic(state.obstacles || []),
    bonusPoints: clonePublic(state.bonusPoints || []),
    units: clonePublic(state.units || []),
    events: (state.events || []).map(publicEventSummary),
    paths: clonePublic(state.paths || []),
    hands: clonePublic(state.hands || null),
    winner: state.winner || null,
    reason: state.reason || null,
    score: clonePublic(state.score || null)
  };
}

function publicLeagueAction(state, action, beforeEventCount) {
  const event = state.events[beforeEventCount] || state.events[state.events.length - 1] || null;
  return {
    index: action.index,
    turn: action.turn,
    team: action.team,
    unitId: action.unitId,
    contestantId: action.contestantId,
    contestantLabel: action.contestantLabel,
    model: action.model,
    provider: action.provider,
    action: action.action,
    candidateId: action.candidateId || null,
    publicReason: action.publicReason || "",
    modelOutput: action.modelOutput || "",
    reasoning: action.reasoning || "",
    reasoningDetails: action.reasoningDetails || null,
    failure: action.failure || null,
    swapsUsed: Number.isFinite(Number(action.swapsUsed)) ? Number(action.swapsUsed) : null,
    swapsRemaining: Number.isFinite(Number(action.swapsRemaining)) ? Number(action.swapsRemaining) : null,
    event: event ? publicEventSummary(event) : null
  };
}

async function runLeagueBattle(seed, teamA, teamB, env, fetchFn, options) {
  const opts = options || {};
  const state = Sim.createInitialState({ seed });
  let guard = 0;
  const actions = [];
  const failures = [];
  const configuredMaxActions = Number(opts.maxActions);
  const maxActions = Number.isFinite(configuredMaxActions) && configuredMaxActions > 0
    ? Math.max(1, Math.floor(configuredMaxActions))
    : Math.max(32, Number(Sim.CONFIG.maxResolutionActions || 96) * (Sim.CONFIG.maxRerollsPerTurn + 1));
  while (!state.winner && guard < maxActions) {
    guard += 1;
    const unitId = getActiveUnitId(state);
    const team = getActiveTeam(state);
    const contestant = team === "A" ? teamA : teamB;
    let resolved;
    try {
      resolved = await contestantDecision(contestant, state, unitId, env, fetchFn);
    } catch (err) {
      if (opts.continueOnProviderError === false) throw err;
      resolved = contestantFailureDecision(contestant, state, unitId, err, failures);
    }
    const actionBase = {
      index: actions.length,
      turn: state.turn,
      team,
      unitId,
      contestantId: contestant.id,
      contestantLabel: contestant.label,
      model: contestant.model || "",
      provider: resolved.providerLabel,
      modelOutput: resolved.rawText || "",
      reasoning: resolved.reasoningText || "",
      reasoningDetails: resolved.reasoningDetails || null,
      failure: resolved.failure || null,
      publicReason: resolved.decision.publicReason || ""
    };
    if (isSwapAction(resolved.decision.action)) {
      const rerollResult = Sim.applyTurn(state, {}, {
        action: "swap_hand",
        provider: resolved.providerLabel,
        providerReason: resolved.decision.publicReason
      });
      actions.push(publicLeagueAction(state, {
        ...actionBase,
        action: "swap_hand",
        swapsUsed: rerollResult.swapsUsed,
        swapsRemaining: rerollResult.swapsRemaining
      }, state.events.length));
      continue;
    }
    const beforeEventCount = state.events.length;
    Sim.applyTurn(
      state,
      { [unitId || team]: resolved.command },
      {
        candidateId: resolved.decision.candidateId || undefined,
        provider: resolved.providerLabel,
        providerReason: resolved.decision.publicReason
      }
    );
    actions.push(publicLeagueAction(state, {
      ...actionBase,
      action: "shot",
      candidateId: resolved.decision.candidateId || null
    }, beforeEventCount));
  }
  if (!state.winner) {
    Sim.forceResolveByHp(state, "resolution_guard");
  }
  return { state, actions, failures };
}

function buildLeagueSchedule(contestants, body) {
  const source = body || {};
  const seedBase = Number.isFinite(Number(source.seedBase)) ? Number(source.seedBase) : 12000 + contestants.length * 17;
  if (source.schedule === "round_robin" || Number(source.gamesPerPair) > 0) {
    const gamesPerPair = Math.max(1, Math.min(8, Number(source.gamesPerPair) || 2));
    const schedule = [];
    let index = 0;
    for (let left = 0; left < contestants.length; left += 1) {
      for (let right = left + 1; right < contestants.length; right += 1) {
        for (let game = 0; game < gamesPerPair; game += 1) {
          const flipped = game % 2 === 1;
          const teamA = flipped ? contestants[right] : contestants[left];
          const teamB = flipped ? contestants[left] : contestants[right];
          schedule.push({
            index,
            pair: `${contestants[left].id}:${contestants[right].id}`,
            game: game + 1,
            teamA,
            teamB,
            seed: seedBase + index * 73 + left * 997 + right * 37 + game * 11
          });
          index += 1;
        }
      }
    }
    return schedule.slice(0, LEAGUE_MAX_MATCHES).map((entry, entryIndex) => ({ ...entry, index: entryIndex }));
  }

  const rounds = Math.max(1, Math.min(LEAGUE_MAX_MATCHES, Number(source.rounds) || 3));
  return Array.from({ length: rounds }, (_unused, index) => ({
    index,
    pair: `${contestants[index % contestants.length].id}:${contestants[(index + 1) % contestants.length].id}`,
    game: 1,
    teamA: contestants[index % contestants.length],
    teamB: contestants[(index + 1) % contestants.length],
    seed: seedBase + index * 73
  }));
}

async function runLeagueSimulation(body, env, fetchFn) {
  const contestants = normalizeContestants(body.contestants);
  if (contestants.length < 2) {
    const err = new Error("not_enough_contestants");
    err.status = 400;
    throw err;
  }
  const includeTraces = body.includeTraces === true;
  const schedule = buildLeagueSchedule(contestants, body);
  const rows = createLeagueRows(contestants);
  const matchesOut = [];
  for (const entry of schedule) {
    const teamA = entry.teamA;
    const teamB = entry.teamB;
    const seed = entry.seed;
    const battle = await runLeagueBattle(seed, teamA, teamB, env, fetchFn, {
      continueOnProviderError: body.continueOnProviderError !== false,
      maxActions: body.maxActions
    });
    const state = battle.state;
    applyLeagueScore(rows, teamA, teamB, state.winner);
    const matchOut = {
      id: `sim-${entry.index + 1}`,
      round: entry.index + 1,
      pair: entry.pair,
      game: entry.game,
      seed,
      teamA: publicContestant(teamA),
      teamB: publicContestant(teamB),
      winner: state.winner,
      reason: state.reason,
      events: state.events.length,
      actions: battle.actions,
      failures: battle.failures,
      score: state.score
        ? { value: state.score.value, rank: state.score.rank, failures: state.score.failures, enemyHits: state.score.enemyHits }
        : null
    };
    if (includeTraces) matchOut.trace = publicLeagueTrace(state);
    matchesOut.push(matchOut);
  }
  return {
    rounds: schedule.length,
    schedule: body.schedule === "round_robin" ? "round_robin" : "rotating",
    contestants: contestants.map(publicContestant),
    leaderboard: Array.from(rows.values()).sort((a, b) => b.rating - a.rating || b.wins - a.wins),
    matches: matchesOut,
    api: simulationApiContract()
  };
}

function providerErrorStatus(error) {
  if (error.message === "missing_api_key") return 400;
  if (error.message === "unknown_candidate") return 422;
  if (error.message === "missing_candidate_id") return 502;
  if (error.message === "invalid_provider_json") return 502;
  if (error.message === "provider_http_error") return 502;
  if (error.message === "provider_timeout") return 504;
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
        const providers = await listProviderCatalog(env, { fetch: fetchFn });
        sendJson(res, 200, { defaultProvider: env.GRAPHWAR_DEFAULT_PROVIDER || DEFAULT_AI_PROVIDER, providers });
        return;
      }
      const providerModelsMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/models$/);
      if (req.method === "POST" && providerModelsMatch) {
        const body = JSON.parse(await readBody(req, 64_000));
        const providerId = String(providerModelsMatch[1] || "").slice(0, 40);
        const provider = getProvider(providerId);
        const allowedProviders = listProviders(env).map((item) => item.id);
        if (!provider || !allowedProviders.includes(provider.id)) {
          sendJson(res, 400, { error: "unknown_provider" });
          return;
        }
        const models = await listProviderModels(provider.id, env, {
          fetch: fetchFn,
          apiKey: body.apiKey,
          noCache: true
        });
        sendJson(res, 200, { provider: provider.id, models: models || [] });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/session/me") {
        const player = protectedPlayer(req, res, env);
        if (!player) return;
        sendJson(res, 200, { player: publicPlayer(player) });
        return;
      }
      const sessionMatch = url.pathname.match(/^\/api\/session\/([^/]+)$/);
      if (req.method === "GET" && sessionMatch) {
        const player = protectedPlayer(req, res, env, sessionMatch[1]);
        if (!player) return;
        sendJson(res, 200, { player: publicPlayer(player) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/leaderboard") {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 25));
        sendJson(res, 200, { players: publicLeaderboard(limit) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/register") {
        const body = JSON.parse(await readBody(req, 128_000));
        try {
          const player = createRegisteredPlayer(body);
          players.set(player.id, player);
          savePersistentStore(env);
          sendJson(res, 200, { player: publicPlayer(player), sessionToken: createSessionToken(player, env) });
        } catch (err) {
          authErrorResponse(res, err);
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/login") {
        const body = JSON.parse(await readBody(req, 128_000));
        const handle = normalizeHandle(body.handle);
        const player = findPlayerByHandle(handle);
        if (!player || !verifyPassword(player, body.password)) {
          sendJson(res, 401, { error: "invalid_credentials" });
          return;
        }
        const providers = normalizeAuthProviders(body.providers);
        if (Object.keys(providers).length) {
          player.providers = { ...(player.providers || {}), ...providers };
        }
        player.lastLoginAt = new Date().toISOString();
        savePersistentStore(env);
        sendJson(res, 200, { player: publicPlayer(player), sessionToken: createSessionToken(player, env) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/profile/providers") {
        const body = JSON.parse(await readBody(req, 128_000));
        const player = protectedPlayer(req, res, env);
        if (!player) return;
        const providers = normalizeAuthProviders(body.providers);
        if (!Object.keys(providers).length) {
          sendJson(res, 400, { error: "missing_providers" });
          return;
        }
        player.providers = { ...(player.providers || {}), ...providers };
        savePersistentStore(env);
        sendJson(res, 200, { player: publicPlayer(player) });
        return;
      }
      const matchmakingStatusMatch = url.pathname.match(/^\/api\/matchmaking\/([^/]+)$/);
      if (req.method === "GET" && matchmakingStatusMatch) {
        const player = protectedPlayer(req, res, env, matchmakingStatusMatch[1]);
        if (!player) return;
        sendJson(res, 200, publicMatchmakingStatus(player));
        return;
      }
      const rulesMatch = url.pathname.match(/^\/api\/match\/([^/]+)\/rules$/);
      if (req.method === "GET" && rulesMatch) {
        const match = matches.get(rulesMatch[1]);
        if (!match) {
          sendJson(res, 404, { error: "unknown_match" });
          return;
        }
        const player = protectedPlayer(req, res, env, url.searchParams.get("playerId"));
        if (!player) return;
        if (!getPlayerSeat(match, player)) {
          sendJson(res, 403, { error: "player_not_in_match" });
          return;
        }
        const command = String(url.searchParams.get("command") || "").slice(0, Sim.CONFIG.maxCommandLength);
        sendJson(res, 200, buildPublicRulesPacket(match, player, command));
        return;
      }
      const readMatch = url.pathname.match(/^\/api\/match\/([^/]+)$/);
      if (req.method === "GET" && readMatch) {
        const match = matches.get(readMatch[1]);
        if (!match) {
          sendJson(res, 404, { error: "unknown_match" });
          return;
        }
        const player = protectedPlayer(req, res, env, url.searchParams.get("playerId"));
        if (!player) return;
        if (!getPlayerSeat(match, player)) {
          sendJson(res, 403, { error: "player_not_in_match" });
          return;
        }
        sendJson(res, 200, { match: publicMatch(match) });
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
        sendJson(res, 200, { player: publicPlayer(player), sessionToken: createSessionToken(player, env) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/match/join") {
        const body = JSON.parse(await readBody(req, 64_000));
        const player = protectedPlayer(req, res, env, body.playerId);
        if (!player) return;
        const indexedMatch = getIndexedMatch(player.id);
        if (indexedMatch && indexedMatch.status !== "resolved") {
          sendJson(res, 200, { match: publicMatch(indexedMatch), queueSize: matchmakingQueue.length });
          return;
        }
        if (indexedMatch && indexedMatch.status === "resolved") {
          playerMatchIndex.delete(player.id);
        }
        const allowAiFill = body.allowAiFill !== false;
        const standingOrder = normalizeStandingOrder(body.standingOrder);
        if (!allowAiFill) {
          const queuedMatch = queueRankedPlayer(player, body.preferredProvider, standingOrder);
          if (!queuedMatch) {
            sendJson(res, 202, publicMatchmakingStatus(player));
            return;
          }
          sendJson(res, 200, { match: publicMatch(queuedMatch), queueSize: matchmakingQueue.length });
          return;
        }
        const match = createAiFallbackMatch(player, body.preferredProvider, standingOrder);
        sendJson(res, 200, { match: publicMatch(match) });
        return;
      }
      const actionMatch = url.pathname.match(/^\/api\/match\/([^/]+)\/action$/);
      if (req.method === "POST" && actionMatch) {
        sendJson(res, 410, {
          error: "manual_actions_disabled",
          message: "Ranked matches are watch-only after launch. Use /api/match/:id/auto-duel to resolve model play."
        });
        return;
      }
      const autoDuelMatch = url.pathname.match(/^\/api\/match\/([^/]+)\/auto-duel$/);
      if (req.method === "POST" && autoDuelMatch) {
        const body = JSON.parse(await readBody(req, 64_000));
        const match = matches.get(autoDuelMatch[1]);
        if (!match) {
          sendJson(res, 404, { error: "unknown_match" });
          return;
        }
        const player = protectedPlayer(req, res, env, body.playerId);
        if (!player) return;
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
        if (!match) {
          sendJson(res, 404, { error: "unknown_match" });
          return;
        }
        const player = protectedPlayer(req, res, env, body.playerId);
        if (!player) return;
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
        const requestedOwner = String(body.unitId || body.team || "").toUpperCase();
        const validTeam = requestedOwner === "A" || requestedOwner === "B";
        const validUnit = /^[AB][12]$/.test(requestedOwner);
        if (!body.state || (!validTeam && !validUnit)) {
          sendJson(res, 400, { error: "invalid_agent_request" });
          return;
        }
        const command = String(body.command || "").slice(0, 80);
        const rulesPayload = Contract.buildRulesPayload(body.state, requestedOwner, command);
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
  createServer,
  buildLeagueSchedule,
  runLeagueBattle,
  runLeagueSimulation
};
