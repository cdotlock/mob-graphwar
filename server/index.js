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
const benchmarks = new Map();
const playerMatchIndex = new Map();
const matchmakingQueue = [];
const rateWindows = new Map();
let nextPlayerId = 1;
let nextMatchId = 1;
let loadedStoreFile = null;
const DEFAULT_AI_PROVIDER = "openrouter";
const DEFAULT_AI_MODEL = "openrouter/free";
const DEVELOPMENT_SESSION_SECRET = "dev-graphwar-session-secret";
const MAX_MATCH_ACTIONS = 24;
const SESSION_COOKIE = "graphwar_session";
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

function serveStatic(req, res, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const url = new URL(req.url, "http://127.0.0.1");
  const configuredRoot = opts.staticRoot ? path.resolve(opts.staticRoot) : DIST_ROOT;
  const hasBuild = fs.existsSync(path.join(configuredRoot, "index.html"));
  if (!hasBuild && env.NODE_ENV === "production") {
    sendJson(res, 503, { error: "build_unavailable" });
    return;
  }
  const staticRoot = hasBuild ? configuredRoot : ROOT;
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
        configured: false
      }
    ])
  );
}

function persistablePlayer(player) {
  const out = {
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
  if (player.benchmark && typeof player.benchmark === "object") out.benchmark = publicBenchmarkRef(player.benchmark);
  return out;
}

function readStoreFile(storeFile) {
  if (!storeFile || !fs.existsSync(storeFile)) return { players: {}, benchmarks: {}, nextPlayerId: 1 };
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    return {
      players: parsed && parsed.players && typeof parsed.players === "object" ? parsed.players : {},
      benchmarks: parsed && parsed.benchmarks && typeof parsed.benchmarks === "object" ? parsed.benchmarks : {},
      nextPlayerId: Number(parsed && parsed.nextPlayerId) || 1
    };
  } catch {
    return { players: {}, benchmarks: {}, nextPlayerId: 1 };
  }
}

function loadPersistentStore(env) {
  const storeFile = resolveStoreFile(env);
  if (!storeFile || loadedStoreFile === storeFile) return storeFile;
  players.clear();
  matches.clear();
  benchmarks.clear();
  playerMatchIndex.clear();
  matchmakingQueue.length = 0;

  const store = readStoreFile(storeFile);
  for (const benchmark of Object.values(store.benchmarks || {})) {
    if (!benchmark || !benchmark.id) continue;
    benchmarks.set(String(benchmark.id), publicBenchmark(benchmark, { includeTraces: true }));
  }
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
      providers: persistableProviders(player.providers),
      benchmark: player.benchmark && typeof player.benchmark === "object" ? publicBenchmarkRef(player.benchmark) : null
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
    players: Object.fromEntries(Array.from(players.values()).map((player) => [player.id, persistablePlayer(player)])),
    benchmarks: Object.fromEntries(Array.from(benchmarks.values()).map((benchmark) => [benchmark.id, publicBenchmark(benchmark, { includeTraces: true })]))
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
  const out = {
    id: player.id,
    handle: player.handle || "",
    displayName: player.displayName,
    rank: player.rank,
    providers: Object.fromEntries(
      Object.entries(player.providers || {}).map(([id, value]) => [
        id,
        { model: value.model || "", configured: false }
      ])
    )
  };
  if (player.benchmark) out.benchmark = publicBenchmarkRef(player.benchmark);
  return out;
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
        model: typeof value?.model === "string" ? value.model.slice(0, 100) : "",
        configured: false
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
  return String((env || process.env).GRAPHWAR_SESSION_SECRET || DEVELOPMENT_SESSION_SECRET);
}

function validateRuntimeConfig(env) {
  const source = env || process.env;
  if (source.NODE_ENV !== "production") return;
  const secret = String(source.GRAPHWAR_SESSION_SECRET || "").trim();
  if (!secret || secret === DEVELOPMENT_SESSION_SECRET || secret.length < 32) {
    throw new Error("missing_session_secret");
  }
}

function rateLimitPerMinute(env) {
  const parsed = Number((env || process.env).GRAPHWAR_RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
}

function enforceRateLimit(req, res, env, player, scope) {
  const now = Date.now();
  const windowMs = 60_000;
  const token = cookieToken(req) || bearerToken(req);
  const sessionFingerprint = token
    ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 20)
    : "";
  const identity = sessionFingerprint || player?.id || String(req.socket?.remoteAddress || "unknown");
  const key = `${scope}:${identity}`;
  const current = rateWindows.get(key);
  const bucket = !current || now - current.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : current;
  bucket.count += 1;
  rateWindows.set(key, bucket);
  const limit = rateLimitPerMinute(env);
  if (bucket.count <= limit) return true;
  res.setHeader("retry-after", String(Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1000))));
  sendJson(res, 429, { error: "rate_limited" });
  return false;
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

function cookieToken(req) {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === SESSION_COOKIE) return decodeURIComponent(rawValue.join("="));
  }
  return "";
}

function sessionCookie(token, env, clear = false) {
  const source = env || process.env;
  const secure = source.NODE_ENV === "production" || source.RAILWAY_ENVIRONMENT || source.RAILWAY_PROJECT_ID;
  return [
    `${SESSION_COOKIE}=${clear ? "" : encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    clear ? "Max-Age=0" : "Max-Age=2592000"
  ].filter(Boolean).join("; ");
}

function issueSession(res, player, env) {
  const token = createSessionToken(player, env);
  res.setHeader("set-cookie", sessionCookie(token, env));
  return token;
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
  const token = cookieToken(req) || bearerToken(req);
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
      providers: Object.keys(player.providers || {}),
      ...(player.benchmark ? { benchmark: publicBenchmarkRef(player.benchmark) } : {})
    }))
    .sort((a, b) => b.rating - a.rating || b.games - a.games || a.displayName.localeCompare(b.displayName))
    .slice(0, limit || 25);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "item";
}

function publicBenchmarkRef(value) {
  const source = value || {};
  return {
    runId: String(source.runId || source.id || "").slice(0, 96),
    kind: String(source.kind || "raw_model_benchmark").slice(0, 48),
    promptPolicy: String(source.promptPolicy || "none").slice(0, 48),
    thinkingMode: String(source.thinkingMode || "off").slice(0, 48),
    platform: String(source.platform || "").slice(0, 48),
    label: String(source.label || source.title || "").slice(0, 120)
  };
}

function publicBenchmark(value, options) {
  const source = value || {};
  const includeTraces = Boolean(options && options.includeTraces);
  const out = {
    id: String(source.id || "").slice(0, 96),
    title: String(source.title || source.label || "Benchmark").slice(0, 160),
    kind: String(source.kind || "raw_model_benchmark").slice(0, 48),
    generatedAt: String(source.generatedAt || ""),
    importedAt: String(source.importedAt || ""),
    platform: String(source.platform || "").slice(0, 48),
    promptPolicy: String(source.promptPolicy || "none").slice(0, 48),
    thinkingMode: String(source.thinkingMode || "off").slice(0, 48),
    notes: String(source.notes || "").slice(0, 1000),
    leaderboard: Array.isArray(source.leaderboard) ? source.leaderboard : [],
    analysis: source.analysis && typeof source.analysis === "object" ? source.analysis : null,
    matches: Array.isArray(source.matches) ? source.matches : [],
    traceCount: Number(source.traceCount) || (source.traces && typeof source.traces === "object" ? Object.keys(source.traces).length : 0)
  };
  if (includeTraces && source.traces && typeof source.traces === "object") out.traces = source.traces;
  return out;
}

function adminAuthError(req, env) {
  const expected = String((env || process.env).GRAPHWAR_ADMIN_TOKEN || "").trim();
  if (!expected) return { status: 403, error: "admin_import_disabled" };
  const authorization = String(req.headers.authorization || "").trim();
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const direct = String(req.headers["x-admin-token"] || "").trim();
  const actual = bearer || direct;
  if (!actual) return { status: 401, error: "missing_admin_token" };
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { status: 403, error: "invalid_admin_token" };
  }
  return null;
}

function normalizeBenchmarkRun(body) {
  const source = body && typeof body === "object" ? body : {};
  const id = slug(source.id || source.runId || source.title || `benchmark-${Date.now()}`);
  const leaderboard = Array.isArray(source.leaderboard) ? source.leaderboard.map((row, index) => ({
    id: String(row.id || slug(row.model || row.label || `model-${index + 1}`)).slice(0, 96),
    label: String(row.label || row.displayName || row.model || `Model ${index + 1}`).replace(/\s+\(raw\)$/i, "").slice(0, 120),
    provider: String(row.provider || source.platform || "").slice(0, 48),
    model: String(row.model || "").slice(0, 120),
    rating: Number(row.rating) || 1000,
    games: Number(row.games) || 0,
    wins: Number(row.wins) || 0,
    losses: Number(row.losses) || 0,
    draws: Number(row.draws) || 0
  })) : [];
  const traces = source.traces && typeof source.traces === "object" ? source.traces : {};
  return {
    id,
    title: String(source.title || source.label || "Raw Model Benchmark").slice(0, 160),
    kind: String(source.kind || "raw_model_benchmark").slice(0, 48),
    generatedAt: String(source.generatedAt || new Date().toISOString()),
    importedAt: new Date().toISOString(),
    platform: String(source.platform || "").slice(0, 48),
    promptPolicy: String(source.promptPolicy || "none").slice(0, 48),
    thinkingMode: String(source.thinkingMode || "off").slice(0, 48),
    notes: String(source.notes || "").slice(0, 1000),
    leaderboard,
    analysis: source.analysis && typeof source.analysis === "object" ? source.analysis : null,
    matches: Array.isArray(source.matches) ? source.matches : [],
    traces,
    traceCount: Object.keys(traces).length
  };
}

function importBenchmarkRun(body) {
  const benchmark = normalizeBenchmarkRun(body);
  benchmarks.set(benchmark.id, benchmark);
  const currentPlayerIds = new Set();
  const benchmarkRef = {
    runId: benchmark.id,
    kind: benchmark.kind,
    promptPolicy: benchmark.promptPolicy,
    thinkingMode: benchmark.thinkingMode,
    platform: benchmark.platform,
    label: benchmark.title
  };
  for (const row of benchmark.leaderboard) {
    const id = `benchmark-${slug(row.model || row.id || row.label)}-raw`;
    currentPlayerIds.add(id);
    players.set(id, {
      id,
      handle: slug(`${row.label}-raw`).slice(0, 24),
      displayName: `${row.label} (raw)`,
      createdAt: players.get(id)?.createdAt || benchmark.importedAt,
      lastLoginAt: benchmark.importedAt,
      passwordHash: "",
      passwordSalt: "",
      rank: {
        rating: row.rating,
        tier: row.rating >= 1200 ? "Gold" : row.rating >= 1050 ? "Silver" : "Bronze",
        games: row.games
      },
      providers: {
        [row.provider || benchmark.platform || "benchmark"]: {
          model: row.model,
          configured: true
        }
      },
      benchmark: benchmarkRef
    });
  }
  for (const [id, player] of Array.from(players.entries())) {
    if (player?.benchmark?.runId === benchmark.id && !currentPlayerIds.has(id)) players.delete(id);
  }
  return {
    benchmark: publicBenchmark(benchmark),
    importedPlayers: currentPlayerIds.size,
    traces: benchmark.traceCount
  };
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
    rankSettlements: {},
    actionCount: 0,
    liveFrames: []
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

function createAiFillMatch(player, preferredProvider, standingOrder) {
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

function normalizeIdleRounds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(25, Math.floor(parsed)));
}

function getPlayerSeat(match, player) {
  if (!match || !player) return null;
  return match.roster.find((seat) => seat.playerId === player.id) || null;
}

function requiresDistributedHumanSteps(match) {
  const humanPlayers = new Set(
    (match?.roster || [])
      .filter((seat) => seat.control === "human" && seat.playerId)
      .map((seat) => seat.playerId)
  );
  return humanPlayers.size > 1;
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
  return action === "swap_hand";
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
  const recentFeedback = Array.isArray(payload.recentFeedback) ? payload.recentFeedback : [];
  const latestFeedback = recentFeedback[recentFeedback.length - 1] || null;
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
    recentFeedbackCount: recentFeedback.length,
    latestFeedback: latestFeedback
      ? {
          unitId: latestFeedback.unitId || "",
          targetId: latestFeedback.targetId || "",
          result: latestFeedback.result || "",
          collisionPoint: latestFeedback.collisionPoint || null,
          closestTargetDistance: latestFeedback.closestTargetDistance ?? null
        }
      : null,
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

function providerEnvKey(provider, env) {
  const source = env || process.env;
  if (!provider) return "";
  return source[provider.keyEnv] || (provider.alternateKeyEnv ? source[provider.alternateKeyEnv] : "") || "";
}

function normalizeRequestProvider(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    provider: String(source.provider || "").slice(0, 40),
    model: String(source.model || "").slice(0, 100),
    apiKey: typeof source.apiKey === "string" ? source.apiKey.trim() : ""
  };
}

function configuredSeatProvider(seat, env, requestProvider) {
  if (!seat) return null;
  const source = env || process.env;
  const player = seat.control === "human" && seat.playerId ? players.get(seat.playerId) : null;
  const providerId = String(seat.provider || (player ? preferredPlayerProvider(player) : DEFAULT_AI_PROVIDER)).slice(0, 40);
  const provider = getProvider(providerId);
  const allowedProviders = listProviders(env).map((item) => item.id);
  const providerConfig = player && player.providers && player.providers[providerId] ? player.providers[providerId] : {};
  const localProvider = normalizeRequestProvider(requestProvider);
  const apiKey = localProvider.provider === providerId ? localProvider.apiKey : "";
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
  const model = localProvider.model || providerConfig.model || seat.model || provider.defaultModel;
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
    maxCalls: Number.isFinite(maxCalls) && maxCalls >= 0 ? maxCalls : Infinity,
    maxFailures: Number.isFinite(maxFailures) && maxFailures >= 0 ? maxFailures : Infinity
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
  const configured = configuredSeatProvider(turn.seat, opts.env, opts.playerProvider);
  if (!configured) throw new Error("provider_not_configured");
  if (!budgetAllowsProvider(opts.providerBudget)) throw new Error("provider_budget_exhausted");

  const providerLabel = `${turn.seat.displayName || configured.player?.displayName || configured.provider.label} / ${configured.model}`;
  try {
    if (opts.providerBudget) opts.providerBudget.calls += 1;
    const result = await executeProviderDecision(
      configured.provider,
      {
        apiKey: configured.apiKey,
        command: turn.command,
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
      modelThought: String(result.reasoningText || "").slice(0, 4000),
      rulesDigest
    };
  } catch (err) {
    recordProviderFailure(opts.providerBudget, err);
    throw err;
  }
}

function applyResolvedMatchAction(match, turn, resolved, frames) {
  match.actionCount = Math.min(MAX_MATCH_ACTIONS, Number(match.actionCount || 0) + 1);
  const providerReason = resolved.modelThought || resolved.decision.publicReason;
  if (isSwapAction(resolved.decision.action)) {
    const swapResult = Sim.applyTurn(match.state, {}, {
      action: "swap_hand",
      provider: resolved.providerLabel,
      providerReason
    });
    pushPlaybackFrame(frames, match, {
      action: "swap_hand",
      team: turn.team,
      unitId: turn.unitId,
      provider: resolved.providerLabel,
      modelThought: resolved.modelThought,
      publicReason: resolved.decision.publicReason,
      swapsUsed: swapResult.swapsUsed,
      swapsRemaining: swapResult.swapsRemaining,
      hand: swapResult.cards,
      rulesDigest: resolved.rulesDigest
    });
    return;
  }
  const beforeEventCount = match.state.events.length;
  Sim.applyTurn(
    match.state,
    { [turn.unitId || turn.team]: resolved.command },
    {
      targetId: resolved.decision.targetId || undefined,
      expression: resolved.decision.expression || undefined,
      cardSlots: resolved.decision.cardSlots || undefined,
      provider: resolved.providerLabel,
      providerReason
    }
  );
  const event = match.state.events[beforeEventCount] || match.state.events[match.state.events.length - 1] || null;
  pushPlaybackFrame(frames, match, {
    action: "shot",
    team: turn.team,
    unitId: event ? event.unitId || event.shooterId : turn.unitId,
    provider: resolved.providerLabel,
    modelThought: resolved.modelThought,
    publicReason: resolved.decision.publicReason,
    targetId: resolved.decision.targetId || null,
    expression: resolved.decision.expression || null,
    cardSlots: resolved.decision.cardSlots || [],
    resultLabel: event ? event.resultLabel : match.state.reason || null,
    event: publicEventSummary(event),
    rulesDigest: resolved.rulesDigest
  });
}

async function advanceMatchToResolution(match, options) {
  const opts = options || {};
  opts.providerBudget = opts.providerBudget || createProviderBudget(opts.env);
  let guard = 0;
  const maxActions = MAX_MATCH_ACTIONS;
  while (!match.state.winner && guard < maxActions) {
    guard += 1;
    const turn = autoResolveCommandsForTurn(match, opts);
    const resolved = await autoResolveDecisionForTurn(match, turn, opts);
    applyResolvedMatchAction(match, turn, resolved, opts.frames);
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
      modelThought: publicAction.modelThought || "",
      resultLabel: publicAction.resultLabel || null,
      swapsUsed: Number.isFinite(Number(publicAction.swapsUsed)) ? Number(publicAction.swapsUsed) : null,
      swapsRemaining: Number.isFinite(Number(publicAction.swapsRemaining)) ? Number(publicAction.swapsRemaining) : null,
      hand: Array.isArray(publicAction.hand) ? clonePublic(publicAction.hand) : null,
      rulesDigest: publicAction.rulesDigest ? clonePublic(publicAction.rulesDigest) : null,
      event: publicAction.event || null
    },
    state: publicPlaybackState(match.state)
  };
}

async function performMatchStep(match, player, env, body, fetchFn) {
  const playerSeat = getPlayerSeat(match, player);
  if (!playerSeat) {
    const err = new Error("player_not_in_match");
    err.status = 403;
    throw err;
  }
  if (match.status === "resolved" || match.state.winner) {
    const settlement = match.rankSettlements[player.id] || { rankDelta: 0 };
    return {
      status: 200,
      payload: {
        match: publicMatch(match),
        player: publicPlayer(player),
        rankDelta: settlement.rankDelta,
        step: { waiting: false, resolved: true },
        autoBattle: buildAutoBattleSummary(match, 0, playerSeat.team, "human_step_duel", match.resolution?.frames || match.liveFrames)
      }
    };
  }

  const turn = autoResolveCommandsForTurn(match, { playerId: player.id });
  if (turn.seat?.control === "human" && turn.seat.playerId !== player.id) {
    return {
      status: 202,
      payload: { match: publicMatch(match), step: { waiting: true, activePlayerId: turn.seat.playerId } }
    };
  }

  if (!match.liveFrames.length) {
    pushPlaybackFrame(match.liveFrames, match, {
      action: "start",
      team: turn.team,
      provider: "Battle Engine",
      publicReason: "Pre-duel ranked state."
    });
  }
  const resolved = await autoResolveDecisionForTurn(match, turn, {
    env,
    fetchFn,
    playerId: player.id,
    playerProvider: body.providerConfig,
    providerBudget: createProviderBudget(env)
  });
  applyResolvedMatchAction(match, turn, resolved, match.liveFrames);
  if (!match.state.winner && match.actionCount >= MAX_MATCH_ACTIONS) {
    Sim.forceResolveByHp(match.state, "resolution_guard");
    pushPlaybackFrame(match.liveFrames, match, {
      action: "state",
      team: match.state.winner || "draw",
      provider: "Battle Engine",
      publicReason: "24-action cap settled the duel by remaining HP.",
      resultLabel: match.state.winner ? `${match.state.winner} wins by remaining HP` : "draw"
    });
  }
  if (match.state.winner) {
    match.status = "resolved";
    settleAllRankedPlayers(match, match.state, env);
    match.resolution = { startedTurn: 0, mode: "human_step_duel", frames: match.liveFrames };
  }
  const settlement = match.rankSettlements[player.id] || { rankDelta: 0 };
  return {
    status: 200,
    payload: {
      match: publicMatch(match),
      player: publicPlayer(player),
      rankDelta: settlement.rankDelta,
      step: { waiting: false, resolved: match.status === "resolved", actionCount: match.actionCount },
      ...(match.status === "resolved" ? { autoBattle: buildAutoBattleSummary(match, 0, playerSeat.team, "human_step_duel", match.liveFrames) } : {})
    }
  };
}

function enqueueMatchStep(match, operation) {
  const previous = match.stepQueue || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  match.stepQueue = current;
  return current;
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
        modelThought: frame.action.modelThought || "",
        rulesDigest: frame.action.rulesDigest || null
      })),
    frames: Array.isArray(frames) ? frames : []
  };
}

function settleAllRankedPlayers(match, finalState, env) {
  const participants = new Map();
  for (const seat of match.roster || []) {
    if (seat.playerId && !participants.has(seat.playerId)) participants.set(seat.playerId, seat.team);
  }
  let changed = false;
  for (const [playerId, team] of participants) {
    if (match.rankSettlements[playerId]) continue;
    const rankedPlayer = players.get(playerId);
    if (!rankedPlayer) continue;
    const rankDelta = resolveRankDelta(finalState.winner, team);
    rankedPlayer.rank.rating += rankDelta;
    rankedPlayer.rank.games += 1;
    rankedPlayer.rank.tier = rankedPlayer.rank.rating >= 1200 ? "Gold" : rankedPlayer.rank.rating >= 1050 ? "Silver" : "Bronze";
    match.rankSettlements[playerId] = { rankDelta, rating: rankedPlayer.rank.rating };
    changed = true;
  }
  if (changed) savePersistentStore(env);
}

async function resolveMatchOnce(match, player, playerSeat, env, options, fetchFn) {
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
    maxActions: MAX_MATCH_ACTIONS,
    playerProvider: opts.playerProvider,
    frames
  });
  settleAllRankedPlayers(match, finalState, env);
  match.resolution = {
    startedTurn,
    mode: opts.mode || "auto_duel",
    frames
  };
}

async function settleResolvedMatch(match, player, playerSeat, env, options, fetchFn) {
  const opts = options || {};
  if (!match.resolution && !match.resolutionPromise) {
    match.resolutionPromise = resolveMatchOnce(match, player, playerSeat, env, opts, fetchFn)
      .finally(() => {
        match.resolutionPromise = null;
      });
  }
  if (match.resolutionPromise) await match.resolutionPromise;
  const resolution = match.resolution || { startedTurn: 0, mode: opts.mode || "auto_duel", frames: [] };
  const playerTeam = playerSeat ? playerSeat.team : "A";
  const settlement = match.rankSettlements[player.id] || { rankDelta: 0, rating: player.rank.rating };
  return {
    match: publicMatch(match),
    player: publicPlayer(player),
    rankDelta: settlement.rankDelta,
    score: match.state.score,
    autoBattle: buildAutoBattleSummary(
      match,
      opts.startedTurn ?? resolution.startedTurn,
      playerTeam,
      resolution.mode,
      resolution.frames
    )
  };
}

async function runRankedIdleBatch(player, body, env, fetchFn) {
  const rounds = normalizeIdleRounds(body.rounds);
  const standingOrder = normalizeStandingOrder(body.standingOrder);
  const preferredProvider = body.preferredProvider;
  const matchesOut = [];
  const autoBattles = [];
  const rankDeltas = [];
  let latestPayload = null;
  for (let index = 0; index < rounds; index += 1) {
    const indexedMatch = getIndexedMatch(player.id);
    if (indexedMatch && indexedMatch.status === "resolved") {
      playerMatchIndex.delete(player.id);
    }
    removeQueuedPlayer(player.id);
    const match = createRankedMatch(player, preferredProvider, standingOrder);
    const playerSeat = getPlayerSeat(match, player);
    const payload = await settleResolvedMatch(
      match,
      player,
      playerSeat,
      env,
      {
        mode: "idle_batch",
        command: standingOrder,
        maxActions: MAX_MATCH_ACTIONS,
        playerProvider: body.providerConfig
      },
      fetchFn
    );
    latestPayload = payload;
    matchesOut.push(payload.match);
    autoBattles.push(payload.autoBattle);
    rankDeltas.push(payload.rankDelta);
  }
  return {
    match: latestPayload ? latestPayload.match : null,
    matches: matchesOut,
    autoBattles,
    player: publicPlayer(player),
    rankDelta: rankDeltas.reduce((sum, value) => sum + (Number(value) || 0), 0),
    batch: {
      mode: "server_idle_batch",
      roundsRequested: rounds,
      roundsCompleted: matchesOut.length,
      rankDeltas,
      finalRating: player.rank.rating
    }
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
  const complexity = rulesPayload.state && rulesPayload.state.map && rulesPayload.state.map.complexity
    ? rulesPayload.state.map.complexity
    : {};
  const hand = rulesPayload.hand || {};
  const analysis = hand.analysis || {};
  const swapsUsed = Number(swap ? swap.swapsUsed : hand.swapsUsed) || 0;
  const solverPressure = Number(complexity.solverPressure) || 0;
  const swapWindowHitRate = Number(complexity.swapWindowHitRate) || 0;
  const highPressure =
    solverPressure >= 90 ||
    Number(complexity.routePressure) >= 95 ||
    Number(complexity.obstacleCount) >= 40;
  const searchMap = swapWindowHitRate > 0 && swapWindowHitRate <= 0.5;
  const underPlayable = Number(analysis.playableCount) < Math.min(Number(analysis.handSize) || 4, 3);
  const lowPrecisionSupport = !(analysis.traits || []).includes("precision");
  if (swap && swapsUsed < Sim.CONFIG.maxSwapsPerTurn && highPressure && (searchMap || underPlayable || lowPrecisionSupport)) {
    return {
      action: "swap_hand",
      publicReason: searchMap
        ? `Local baseline searched another retained hand because solver pressure is ${solverPressure} and swap-window hit rate is ${Math.round(swapWindowHitRate * 100)}%.`
        : "Local baseline swapped a weak retained hand before firing."
    };
  }
  const shotContract = actions.find((action) => action.action === "shot");
  const targetId = Array.isArray(shotContract?.allowedTargetIds) && shotContract.allowedTargetIds.length
    ? shotContract.allowedTargetIds[0]
    : Array.isArray(rulesPayload.opponentIds) && rulesPayload.opponentIds.length
    ? rulesPayload.opponentIds[0]
    : "";
  if (targetId) {
    return {
      action: "shot",
      targetId,
      expression: "y=y0+dy*t",
      cardSlots: [],
      publicReason: "Local baseline wrote a direct line function."
    };
  }
  if (actions.some((action) => action.action === "swap_hand")) {
    return { action: "swap_hand", publicReason: "Local baseline swapped hand because no shot was legal." };
  }
  return { action: "shot", targetId: "", expression: "", cardSlots: [], publicReason: "No legal action available." };
}

async function contestantDecision(contestant, state, unitId, env, fetchFn, options) {
  const unit = (state.units || []).find((item) => item.id === unitId) || Sim.getActiveUnit(state);
  const team = unit ? unit.team : getActiveTeam(state);
  const command = contestant.command || "";
  const rulesPayload = Contract.buildRulesPayload(state, unit ? unit.id : team, command);
  const provider = getProvider(contestant.provider);
  const allowedProviders = listProviders(env).map((item) => item.id);
  const apiKey = String(contestant.apiKey || "").trim();
  if (contestant.provider === "local") {
    return {
      command,
      providerLabel: `${contestant.label} / local`,
      decision: localDecisionFromRules(rulesPayload),
      rawText: ""
    };
  }
  const allowEnvKey = options?.allowEnvKey !== false;
  if (!provider || !allowedProviders.includes(provider.id) || (!apiKey && (!allowEnvKey || !providerEnvKey(provider, env)))) {
    throw new Error("provider_not_configured");
  }
  const result = await executeProviderDecision(
    provider,
    {
      apiKey,
      command,
      stateSummary: summarizeState(state),
      rulesPayload,
      model: contestant.model,
      reasoning: contestant.reasoning || undefined,
      strictDecisionSchema: contestant.strictDecisionSchema
    },
    { env, fetch: fetchFn, allowEnvKey }
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
    body: err && err.body ? String(err.body).slice(0, 1200) : "",
    rawText: err && err.rawText ? String(err.rawText).slice(0, 4000) : "",
    reasoningText: err && err.reasoningText ? String(err.reasoningText).slice(0, 4000) : "",
    reasoningDetails: err && err.reasoningDetails ? clonePublic(err.reasoningDetails) : null,
    validation: err && err.validation ? clonePublic(err.validation) : null
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

function isModelDecisionError(err) {
  const message = err && err.message ? String(err.message) : "";
  if (!message) return false;
  if (err.status || err.body) return false;
  if (/fetch failed|network|socket|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|aborted/i.test(message)) return false;
  return ![
    "provider_http_error",
    "provider_timeout",
    "provider_not_configured",
    "provider_budget_exhausted",
    "missing_api_key",
    "fetch_unavailable"
  ].includes(message);
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
    targetId: action.targetId || null,
    expression: action.expression || "",
    cardSlots: Array.isArray(action.cardSlots) ? action.cardSlots : [],
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
  const maxActions = MAX_MATCH_ACTIONS;
  while (!state.winner && guard < maxActions) {
    guard += 1;
    const unitId = getActiveUnitId(state);
    const team = getActiveTeam(state);
    const contestant = team === "A" ? teamA : teamB;
    let resolved;
    try {
      resolved = await contestantDecision(contestant, state, unitId, env, fetchFn, { allowEnvKey: opts.allowEnvKeys !== false });
    } catch (err) {
      const failed = contestantFailureDecision(contestant, state, unitId, err, failures);
      if (opts.penalizeInvalidActions && isModelDecisionError(err)) {
        actions.push(publicLeagueAction(state, {
          index: actions.length,
          turn: state.turn,
          team,
          unitId,
          contestantId: contestant.id,
          contestantLabel: contestant.label,
          model: contestant.model || "",
          provider: failed.providerLabel,
          action: "invalid",
          modelOutput: failed.rawText || "",
          reasoning: failed.reasoningText || "",
          reasoningDetails: failed.reasoningDetails || null,
          failure: failed.failure,
          publicReason: `Invalid model action: ${failed.failure.error}`
        }, state.events.length));
        state.turn += 1;
        continue;
      }
      err.leagueFailure = failed.failure;
      throw err;
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
      const swapResult = Sim.applyTurn(state, {}, {
        action: "swap_hand",
        provider: resolved.providerLabel,
        providerReason: resolved.decision.publicReason
      });
      actions.push(publicLeagueAction(state, {
        ...actionBase,
        action: "swap_hand",
        swapsUsed: swapResult.swapsUsed,
        swapsRemaining: swapResult.swapsRemaining
      }, state.events.length));
      continue;
    }
    const beforeEventCount = state.events.length;
    Sim.applyTurn(
      state,
      { [unitId || team]: resolved.command },
      {
        targetId: resolved.decision.targetId || undefined,
        expression: resolved.decision.expression || undefined,
        cardSlots: resolved.decision.cardSlots || undefined,
        provider: resolved.providerLabel,
        providerReason: resolved.decision.publicReason
      }
    );
    actions.push(publicLeagueAction(state, {
      ...actionBase,
      action: "shot",
      targetId: resolved.decision.targetId || null,
      expression: resolved.decision.expression || null,
      cardSlots: resolved.decision.cardSlots || []
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

async function runLeagueSimulation(body, env, fetchFn, options) {
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
      maxActions: MAX_MATCH_ACTIONS,
      allowEnvKeys: options?.allowEnvKeys !== false
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
  if (error.message === "missing_expression") return 502;
  if (error.message === "invalid_provider_json") return 502;
  if (error.message === "provider_http_error") return 502;
  if (error.message === "provider_timeout") return 504;
  if (error.message === "swap_limit_reached") return 409;
  return 400;
}

function createServer(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const fetchFn = opts.fetch || globalThis.fetch;
  const staticRoot = opts.staticRoot;
  validateRuntimeConfig(env);
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
        try {
          const models = await listProviderModels(provider.id, env, {
            fetch: fetchFn,
            apiKey: body.apiKey,
            noCache: true,
            strict: true
          });
          sendJson(res, 200, { provider: provider.id, models: models || [] });
        } catch (err) {
          sendJson(res, providerErrorStatus(err), { error: err.message || "model_list_failed" });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/session/me") {
        const player = protectedPlayer(req, res, env);
        if (!player) return;
        sendJson(res, 200, { player: publicPlayer(player) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/session/status") {
        const resolved = sessionPlayer(req, env);
        sendJson(res, 200, resolved.player
          ? { authenticated: true, player: publicPlayer(resolved.player) }
          : { authenticated: false });
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
      if (req.method === "GET" && url.pathname === "/api/benchmarks") {
        sendJson(res, 200, {
          benchmarks: Array.from(benchmarks.values())
            .map((benchmark) => publicBenchmark(benchmark))
            .sort((a, b) => String(b.importedAt || b.generatedAt).localeCompare(String(a.importedAt || a.generatedAt)))
        });
        return;
      }
      const benchmarkMatch = url.pathname.match(/^\/api\/benchmarks\/([^/]+)$/);
      if (req.method === "GET" && benchmarkMatch) {
        const benchmark = benchmarks.get(benchmarkMatch[1]);
        if (!benchmark) {
          sendJson(res, 404, { error: "unknown_benchmark" });
          return;
        }
        sendJson(res, 200, { benchmark: publicBenchmark(benchmark, { includeTraces: url.searchParams.get("includeTraces") === "1" }) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/admin/benchmarks/import") {
        const authError = adminAuthError(req, env);
        if (authError) {
          sendJson(res, authError.status, { error: authError.error });
          return;
        }
        const body = JSON.parse(await readBody(req, 64_000_000));
        const result = importBenchmarkRun(body);
        savePersistentStore(env);
        sendJson(res, 200, result);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/register") {
        const body = JSON.parse(await readBody(req, 128_000));
        try {
          const player = createRegisteredPlayer(body);
          players.set(player.id, player);
          savePersistentStore(env);
          sendJson(res, 200, { player: publicPlayer(player), sessionToken: issueSession(res, player, env) });
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
        sendJson(res, 200, { player: publicPlayer(player), sessionToken: issueSession(res, player, env) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        res.setHeader("set-cookie", sessionCookie("", env, true));
        sendJson(res, 200, { ok: true });
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
        if (env.NODE_ENV === "production") {
          sendJson(res, 410, { error: "legacy_session_disabled" });
          return;
        }
        const body = JSON.parse(await readBody(req, 128_000));
        const id = `player-${nextPlayerId++}`;
        const player = {
          id,
          displayName: String(body.displayName || "Player").slice(0, 32),
          providers: normalizeAuthProviders(body.providers),
          rank: { rating: 1000, tier: "Bronze", games: 0 }
        };
        players.set(id, player);
        savePersistentStore(env);
        sendJson(res, 200, { player: publicPlayer(player), sessionToken: issueSession(res, player, env) });
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
        const rounds = normalizeIdleRounds(body.rounds);
        if (allowAiFill && rounds > 1) {
          try {
            sendJson(res, 200, await runRankedIdleBatch(player, { ...body, rounds, standingOrder }, env, fetchFn));
          } catch (err) {
            sendJson(res, providerErrorStatus(err), { error: err.message || "provider_error" });
          }
          return;
        }
        if (!allowAiFill) {
          const queuedMatch = queueRankedPlayer(player, body.preferredProvider, standingOrder);
          if (!queuedMatch) {
            sendJson(res, 202, publicMatchmakingStatus(player));
            return;
          }
          sendJson(res, 200, { match: publicMatch(queuedMatch), queueSize: matchmakingQueue.length });
          return;
        }
        const match = createAiFillMatch(player, body.preferredProvider, standingOrder);
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
        if (requiresDistributedHumanSteps(match)) {
          sendJson(res, 409, { error: "human_step_required" });
          return;
        }
        const command = String(body.command || "").slice(0, Sim.CONFIG.maxCommandLength);
        try {
          sendJson(res, 200, await settleResolvedMatch(match, player, playerSeat, env, {
            mode: "auto_duel",
            command,
            maxActions: MAX_MATCH_ACTIONS,
            playerProvider: body.providerConfig
          }, fetchFn));
        } catch (err) {
          sendJson(res, providerErrorStatus(err), { error: err.message || "provider_error" });
        }
        return;
      }
      const stepMatch = url.pathname.match(/^\/api\/match\/([^/]+)\/step$/);
      if (req.method === "POST" && stepMatch) {
        const body = JSON.parse(await readBody(req, 64_000));
        const match = matches.get(stepMatch[1]);
        if (!match) {
          sendJson(res, 404, { error: "unknown_match" });
          return;
        }
        const player = protectedPlayer(req, res, env, body.playerId);
        if (!player) return;
        try {
          const result = await enqueueMatchStep(match, () => performMatchStep(match, player, env, body, fetchFn));
          sendJson(res, result.status, result.payload);
        } catch (err) {
          sendJson(res, err.status || providerErrorStatus(err), { error: err.message || "step_failed" });
        }
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
        if (requiresDistributedHumanSteps(match)) {
          sendJson(res, 409, { error: "human_step_required" });
          return;
        }
        try {
          sendJson(res, 200, await settleResolvedMatch(match, player, playerSeat, env, {
            mode: "rank_resolve",
            maxActions: MAX_MATCH_ACTIONS,
            playerProvider: body.providerConfig
          }, fetchFn));
        } catch (err) {
          sendJson(res, providerErrorStatus(err), { error: err.message || "provider_error" });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/simulations/league") {
        const player = protectedPlayer(req, res, env);
        if (!player) return;
        if (!enforceRateLimit(req, res, env, player, "league")) return;
        const body = JSON.parse(await readBody(req, 512_000));
        try {
          const simulation = await runLeagueSimulation(body, env, fetchFn, { allowEnvKeys: false });
          sendJson(res, 200, simulation);
        } catch (err) {
          sendJson(res, err.status || providerErrorStatus(err), { error: err.message || "simulation_failed" });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/agent/shot") {
        const player = protectedPlayer(req, res, env);
        if (!player) return;
        if (!enforceRateLimit(req, res, env, player, "agent-shot")) return;
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
              stateSummary: summarizeState(body.state),
              rulesPayload,
              model: body.model
            },
            { env, fetch: fetchFn, allowEnvKey: false }
          );
          sendJson(res, 200, {
            provider: provider.id,
            model: body.model || env[provider.modelEnv] || provider.defaultModel,
            decision: result.decision,
            contractMode: "model_written_expression"
          });
        } catch (err) {
          sendJson(res, providerErrorStatus(err), { error: err.message || "provider_error" });
        }
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        serveStatic(req, res, { env, staticRoot });
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
