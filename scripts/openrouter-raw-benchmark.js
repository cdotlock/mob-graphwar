#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { runLeagueBattle } = require("../server/index.js");
const Sim = require("../src/sim-core.js");

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_GAMES_PER_PAIR = 2;
const DEFAULT_MAX_ACTIONS = Sim.CONFIG.maxResolutionActions;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_SEED_BASE = 64000;

const TARGET_MODEL_SPECS = [
  {
    id: "openai-gpt-5-5",
    requested: "OpenAI gpt-5.5",
    label: "OpenAI GPT-5.5",
    exactIds: ["openai/gpt-5.5"],
    patterns: [/^openai\/gpt-5\.5$/i]
  },
  {
    id: "anthropic-claude-opus-4-8",
    requested: "Anthropic claude-opus-4-8",
    label: "Anthropic Claude Opus 4.8",
    exactIds: ["anthropic/claude-opus-4.8"],
    patterns: [/^anthropic\/claude-opus-4\.8$/i, /claude-opus-4[.-]8/i]
  },
  {
    id: "anthropic-claude-sonnet-5",
    requested: "Anthropic claude-sonnet-5",
    label: "Anthropic Claude Sonnet 5",
    exactIds: ["anthropic/claude-sonnet-5"],
    patterns: [/^anthropic\/claude-sonnet-5$/i]
  },
  {
    id: "google-gemini-3-5-flash",
    requested: "Gemini gemini-3.5-flash",
    label: "Google Gemini 3.5 Flash",
    exactIds: ["google/gemini-3.5-flash"],
    patterns: [/^google\/gemini-3\.5-flash$/i]
  },
  {
    id: "google-gemini-3-1-pro",
    requested: "Gemini gemini-3.1-pro",
    label: "Google Gemini 3.1 Pro",
    exactIds: ["google/gemini-3.1-pro-preview", "google/gemini-3.1-pro-preview-customtools"],
    patterns: [/^google\/gemini-3\.1-pro/i]
  },
  {
    id: "xai-grok-4-3",
    requested: "Grok grok-4.3",
    label: "xAI Grok 4.3",
    exactIds: ["x-ai/grok-4.3"],
    patterns: [/^x-ai\/grok-4\.3$/i]
  },
  {
    id: "moonshot-kimi-k2-7-code",
    requested: "kimi-k2.7 code",
    label: "Moonshot Kimi K2.7 Code",
    exactIds: ["moonshotai/kimi-k2.7-code"],
    patterns: [/kimi-k2\.7-code/i]
  },
  {
    id: "zai-glm-5-2",
    requested: "Z.ai glm-5.2",
    label: "Z.ai GLM 5.2",
    exactIds: ["z-ai/glm-5.2"],
    patterns: [/^z-ai\/glm-5\.2$/i]
  },
  {
    id: "deepseek-v4-flash",
    requested: "DeepSeek deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    exactIds: ["deepseek/deepseek-v4-flash"],
    patterns: [/^deepseek\/deepseek-v4-flash$/i]
  },
  {
    id: "deepseek-v4-pro",
    requested: "DeepSeek deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    exactIds: ["deepseek/deepseek-v4-pro"],
    patterns: [/^deepseek\/deepseek-v4-pro$/i]
  },
  {
    id: "stepfun-step-3-7-flash",
    requested: "StepFun step-3.7-flash",
    label: "StepFun Step 3.7 Flash",
    exactIds: ["stepfun/step-3.7-flash"],
    patterns: [/^stepfun\/step-3\.7-flash$/i]
  },
  {
    id: "minimax-m3",
    requested: "MiniMax MiniMax-M3",
    label: "MiniMax M3",
    exactIds: ["minimax/minimax-m3"],
    patterns: [/^minimax\/minimax-m3$/i]
  },
  {
    id: "xiaomi-mimo-v2-5-pro",
    requested: "MiMo mimo-v2.5-pro",
    label: "Xiaomi MiMo V2.5 Pro",
    exactIds: ["xiaomi/mimo-v2.5-pro"],
    patterns: [/mimo-v2\.5-pro/i]
  }
];

const ROUTE_MODEL_SPECS = [
  {
    id: "openrouter-auto",
    requested: "OpenRouter Auto",
    label: "OpenRouter Auto",
    exactIds: ["openrouter/auto"],
    patterns: [/^openrouter\/auto$/i]
  },
  {
    id: "openrouter-free",
    requested: "OpenRouter Free",
    label: "OpenRouter Free",
    exactIds: ["openrouter/free"],
    patterns: [/^openrouter\/free$/i]
  }
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonl(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "model";
}

function isoTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function modelSupportsText(model) {
  const architecture = model && model.architecture ? model.architecture : {};
  const identity = `${model?.id || ""} ${model?.name || ""}`.toLowerCase();
  if (/(image|banana|dall[- ]?e|stable diffusion|midjourney|flux|sdxl)/.test(identity)) return false;
  const outputModalities = Array.isArray(architecture.output_modalities)
    ? architecture.output_modalities.map((item) => String(item).toLowerCase())
    : [];
  if (outputModalities.length) return outputModalities.includes("text");
  const inputModalities = Array.isArray(architecture.input_modalities)
    ? architecture.input_modalities.map((item) => String(item).toLowerCase())
    : [];
  if (inputModalities.length && !inputModalities.includes("text")) return false;
  return true;
}

function modelCost(model) {
  const pricing = model?.pricing || {};
  return {
    prompt: Number(pricing.prompt || 0) || 0,
    completion: Number(pricing.completion || 0) || 0
  };
}

function publicModelMeta(model) {
  if (!model) return null;
  const cost = modelCost(model);
  return {
    id: model.id,
    name: model.name || model.id,
    created: Number(model.created || model.created_at || 0) || null,
    contextLength: Number(model.context_length || model.contextLength || 0) || null,
    pricing: cost,
    free: cost.prompt === 0 && cost.completion === 0,
    reasoning: model.reasoning && typeof model.reasoning === "object" ? model.reasoning : null,
    supportedParameters: Array.isArray(model.supported_parameters) ? model.supported_parameters.slice() : []
  };
}

function chooseReasoningEffort(reasoning) {
  if (!reasoning || typeof reasoning !== "object") return "";
  const supported = Array.isArray(reasoning.supported_efforts) ? reasoning.supported_efforts : [];
  const preferred = String(reasoning.default_effort || "").trim();
  if (preferred && preferred !== "none") return preferred;
  for (const effort of ["medium", "high", "low", "minimal", "xhigh", "max"]) {
    if (!supported.length || supported.includes(effort)) return effort;
  }
  return "";
}

function reasoningConfigForModel(model) {
  const reasoning = model && model.reasoning && typeof model.reasoning === "object" ? model.reasoning : null;
  if (!reasoning) return null;
  const config = {
    enabled: true,
    exclude: false
  };
  const supported = Array.isArray(reasoning.supported_efforts) ? reasoning.supported_efforts : [];
  if (!supported.length || supported.includes("high")) config.effort = "high";
  else config.effort = chooseReasoningEffort(reasoning) || undefined;
  return config;
}

function findModelForSpec(catalog, spec) {
  const models = (catalog || []).filter(modelSupportsText);
  for (const exactId of spec.exactIds || []) {
    const exact = models.find((model) => String(model.id).toLowerCase() === String(exactId).toLowerCase());
    if (exact) return exact;
  }
  const matched = models
    .filter((model) => (spec.patterns || []).some((pattern) => pattern.test(`${model.id} ${model.name || ""}`)))
    .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0));
  return matched[0] || null;
}

function resolveTargetModels(catalog, options) {
  const opts = options || {};
  const reasoningMode = String(opts.reasoning || "off").toLowerCase();
  const specs = opts.includeRoutes ? TARGET_MODEL_SPECS.concat(ROUTE_MODEL_SPECS) : TARGET_MODEL_SPECS;
  const missing = [];
  const resolutions = specs.map((spec) => {
    const model = findModelForSpec(catalog, spec);
    if (!model) {
      missing.push({ id: spec.id, requested: spec.requested });
      return { spec, model: null };
    }
    return { spec, model };
  });
  const contestants = resolutions
    .filter((resolution) => resolution.model)
    .map((resolution) => ({
      id: resolution.spec.id,
      label: resolution.spec.label,
      requested: resolution.spec.requested,
      provider: "openrouter",
      model: resolution.model.id,
      modelName: resolution.model.name || resolution.model.id,
      command: "",
      apiKey: "",
      reasoning: reasoningMode === "high" ? reasoningConfigForModel(resolution.model) : null,
      strictDecisionSchema: true,
      meta: publicModelMeta(resolution.model)
    }));
  return {
    contestants,
    missing,
    resolutions: resolutions.map((resolution) => ({
      id: resolution.spec.id,
      requested: resolution.spec.requested,
      label: resolution.spec.label,
      model: publicModelMeta(resolution.model)
    }))
  };
}

function buildBenchmarkSchedule(contestants, gamesPerPair, seedBase, maxMatches) {
  const games = Math.max(1, Math.min(8, Number(gamesPerPair) || DEFAULT_GAMES_PER_PAIR));
  const base = Number.isFinite(Number(seedBase)) ? Number(seedBase) : DEFAULT_SEED_BASE;
  const schedule = [];
  let index = 0;
  for (let left = 0; left < contestants.length; left += 1) {
    for (let right = left + 1; right < contestants.length; right += 1) {
      for (let game = 0; game < games; game += 1) {
        const flipped = game % 2 === 1;
        schedule.push({
          index,
          pair: `${contestants[left].id}:${contestants[right].id}`,
          game: game + 1,
          teamA: flipped ? contestants[right] : contestants[left],
          teamB: flipped ? contestants[left] : contestants[right],
          seed: base + index * 73 + left * 997 + right * 37 + game * 11
        });
        index += 1;
      }
    }
  }
  const cap = Number(maxMatches);
  return Number.isFinite(cap) && cap > 0 ? schedule.slice(0, cap) : schedule;
}

function createRows(contestants) {
  return new Map(contestants.map((contestant) => [contestant.id, {
    id: contestant.id,
    label: contestant.label,
    requested: contestant.requested,
    provider: contestant.provider,
    model: contestant.model,
    modelName: contestant.modelName,
    rating: 1000,
    wins: 0,
    losses: 0,
    draws: 0,
    games: 0,
    providerFailures: 0,
    enemyHits: 0,
    routeBonus: 0,
    turns: 0
  }]));
}

function applyScore(rows, teamA, teamB, state, failures) {
  const a = rows.get(teamA.id);
  const b = rows.get(teamB.id);
  const winner = state?.winner || "draw";
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
  for (const failure of failures || []) {
    const row = failure.team === "A" ? a : failure.team === "B" ? b : null;
    if (row) row.providerFailures += 1;
  }
  for (const event of state?.events || []) {
    const row = event.team === "A" ? a : event.team === "B" ? b : null;
    if (!row) continue;
    if (event.result === "hitEnemy") row.enemyHits += 1;
    row.routeBonus += Number(event.routeBonus?.value || 0) || 0;
    row.turns += 1;
  }
}

function sortedLeaderboard(rows) {
  return Array.from(rows.values())
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.providerFailures - b.providerFailures || a.label.localeCompare(b.label));
}

async function runWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(16, Number(concurrency) || 1));
  const results = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (next < items.length) {
      const current = next;
      next += 1;
      results[current] = await worker(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

function tierForRating(rating) {
  if (rating >= 1200) return "Gold";
  if (rating >= 1050) return "Silver";
  return "Bronze";
}

function readStore(file) {
  if (!file || !fs.existsSync(file)) return { version: 1, nextPlayerId: 1, players: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: parsed.version || 1,
      nextPlayerId: Number(parsed.nextPlayerId) || 1,
      players: parsed.players && typeof parsed.players === "object" ? parsed.players : {}
    };
  } catch {
    return { version: 1, nextPlayerId: 1, players: {} };
  }
}

function buildBenchmarkStore(leaderboard, existingStore) {
  const store = {
    version: 1,
    nextPlayerId: Number(existingStore?.nextPlayerId) || 1,
    players: { ...(existingStore?.players || {}) }
  };
  const now = new Date().toISOString();
  for (const row of leaderboard) {
    const id = `benchmark-${slug(row.model)}-raw`;
    store.players[id] = {
      id,
      handle: slug(`${row.label}-raw`).slice(0, 24),
      displayName: `${row.label} (raw)`,
      createdAt: store.players[id]?.createdAt || now,
      lastLoginAt: now,
      passwordHash: "",
      passwordSalt: "",
      rank: {
        rating: row.rating,
        tier: tierForRating(row.rating),
        games: row.games
      },
      providers: {
        openrouter: {
          model: row.model,
          configured: true
        }
      }
    };
  }
  return store;
}

async function fetchOpenRouterModels(apiKey, fetchFn) {
  const fetchImpl = fetchFn || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const response = await fetchImpl(OPENROUTER_MODELS_URL, {
    method: "GET",
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  });
  if (!response || !response.ok) {
    const err = new Error("openrouter_models_failed");
    err.status = response && response.status;
    throw err;
  }
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

function parseArgs(argv) {
  const args = {};
  for (const raw of argv || []) {
    if (!raw.startsWith("--")) continue;
    const trimmed = raw.slice(2);
    const eq = trimmed.indexOf("=");
    if (eq >= 0) args[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    else args[trimmed] = true;
  }
  return args;
}

function buildReport(data) {
  const lines = [];
  lines.push("# OpenRouter Raw Model Benchmark");
  lines.push("");
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push(`Games per pair: ${data.gamesPerPair}`);
  if (data.maxActions) lines.push(`Action cap per game: ${data.maxActions}`);
  lines.push(`Models: ${data.contestants.length}`);
  lines.push(`Planned matches: ${data.schedule.length}`);
  lines.push(`Completed matches: ${data.matches.length}`);
  lines.push("");
  lines.push("## Model Mapping");
  lines.push("");
  lines.push("| Requested | OpenRouter model | Status |");
  lines.push("| --- | --- | --- |");
  for (const resolution of data.resolutions) {
    lines.push(`| ${resolution.requested} | ${resolution.model ? resolution.model.id : "-"} | ${resolution.model ? "mapped" : "missing"} |`);
  }
  lines.push("");
  lines.push("## Leaderboard");
  lines.push("");
  lines.push("| Rank | Model (raw) | Rating | W-L-D | Provider failures | Enemy hits | Route bonus |");
  lines.push("| ---: | --- | ---: | --- | ---: | ---: | ---: |");
  data.leaderboard.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${row.label} (raw) | ${row.rating} | ${row.wins}-${row.losses}-${row.draws} | ${row.providerFailures} | ${row.enemyHits} | ${row.routeBonus} |`);
  });
  lines.push("");
  lines.push("## Data Files");
  lines.push("");
  lines.push("- `models.json`: resolved OpenRouter model metadata and substitutions.");
  lines.push("- `matches.jsonl`: one summary row per game.");
  lines.push("- `leaderboard.json`: final raw model standings.");
  lines.push("- `graphwar-store.json`: leaderboard import file using model name + `(raw)`.");
  lines.push("- `traces/*.json`: full map, events, paths, actions, failures, and final state per game.");
  return `${lines.join("\n")}\n`;
}

async function runBenchmark(options) {
  const opts = options || {};
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY || "";
  if (!apiKey && !opts.dryRun) throw new Error("missing_OPENROUTER_API_KEY");
  const generatedAt = new Date().toISOString();
  const outputDir = path.resolve(opts.outDir || path.join("artifacts", "openrouter-benchmark", isoTimestamp()));
  ensureDir(outputDir);
  ensureDir(path.join(outputDir, "traces"));

  const catalog = opts.catalog || await fetchOpenRouterModels(apiKey, opts.fetch);
  const resolved = resolveTargetModels(catalog, { includeRoutes: opts.includeRoutes, reasoning: opts.reasoning });
  if (resolved.missing.length && !opts.allowMissing) {
    const err = new Error(`missing_models:${resolved.missing.map((item) => item.requested).join(",")}`);
    err.missing = resolved.missing;
    throw err;
  }
  const limitModels = Number(opts.limitModels);
  const contestants = (Number.isFinite(limitModels) && limitModels > 0 ? resolved.contestants.slice(0, limitModels) : resolved.contestants)
    .map((contestant) => ({ ...contestant, apiKey }));
  const gamesPerPair = Math.max(1, Math.min(8, Number(opts.gamesPerPair) || DEFAULT_GAMES_PER_PAIR));
  const maxActions = Math.max(1, Math.min(Sim.CONFIG.maxResolutionActions, Number(opts.maxActions) || DEFAULT_MAX_ACTIONS));
  const concurrency = Math.max(1, Math.min(16, Number(opts.concurrency) || DEFAULT_CONCURRENCY));
  const schedule = buildBenchmarkSchedule(contestants, gamesPerPair, opts.seedBase, opts.maxMatches);

  writeJson(path.join(outputDir, "models.json"), {
    generatedAt,
    openRouterModelsUrl: OPENROUTER_MODELS_URL,
    targetSpecs: TARGET_MODEL_SPECS.map((spec) => ({ id: spec.id, requested: spec.requested, label: spec.label })),
    includeRoutes: Boolean(opts.includeRoutes),
    resolutions: resolved.resolutions,
    missing: resolved.missing,
    contestants: contestants.map(({ apiKey: _apiKey, ...contestant }) => contestant),
    schedule: schedule.map((entry) => ({
      index: entry.index,
      pair: entry.pair,
      game: entry.game,
      seed: entry.seed,
      teamA: entry.teamA.id,
      teamB: entry.teamB.id
    })),
    maxActionsPerGame: maxActions,
    concurrency
  });

  if (opts.dryRun) {
    const report = buildReport({
      generatedAt,
      gamesPerPair,
      maxActions,
      contestants,
      schedule,
      resolutions: resolved.resolutions,
      matches: [],
      leaderboard: []
    });
    fs.writeFileSync(path.join(outputDir, "report.md"), report);
    return { outputDir, dryRun: true, contestants, schedule, leaderboard: [], matches: [] };
  }

  const rows = createRows(contestants);
  const matchesFile = path.join(outputDir, "matches.jsonl");
  const env = {
    ...process.env,
    OPENROUTER_API_KEY: apiKey,
    GRAPHWAR_ALLOWED_PROVIDERS: "openrouter",
    GRAPHWAR_REQUEST_TIMEOUT_MS: String(opts.timeoutMs || process.env.GRAPHWAR_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };

  const matches = await runWithConcurrency(schedule, concurrency, async (entry) => {
    const id = `match-${String(entry.index + 1).padStart(4, "0")}`;
    const startedAt = new Date().toISOString();
    const traceFile = path.join(outputDir, "traces", `${id}.json`);
    let summary;
    if (!opts.quiet) {
      console.error(
        `[${entry.index + 1}/${schedule.length}] ${entry.teamA.label} vs ${entry.teamB.label} seed=${entry.seed} maxActions=${maxActions}`
      );
    }
    try {
      const battle = await runLeagueBattle(entry.seed, entry.teamA, entry.teamB, env, opts.fetch || globalThis.fetch, {
        continueOnProviderError: Boolean(opts.continueOnError),
        maxActions
      });
      const endedAt = new Date().toISOString();
      const trace = {
        id,
        startedAt,
        endedAt,
        seed: entry.seed,
        pair: entry.pair,
        game: entry.game,
        teamA: { id: entry.teamA.id, label: entry.teamA.label, model: entry.teamA.model },
        teamB: { id: entry.teamB.id, label: entry.teamB.label, model: entry.teamB.model },
        state: battle.state,
        maxActions,
        actions: battle.actions,
        failures: battle.failures
      };
      writeJson(traceFile, trace);
      summary = {
        id,
        seed: entry.seed,
        pair: entry.pair,
        game: entry.game,
        teamA: entry.teamA.id,
        teamB: entry.teamB.id,
        winner: battle.state.winner || "draw",
        reason: battle.state.reason || "",
        events: battle.state.events.length,
        failures: battle.failures.length,
        score: battle.state.score || null,
        trace: path.relative(outputDir, traceFile)
      };
    } catch (err) {
      if (!opts.continueOnError) throw err;
      const endedAt = new Date().toISOString();
      const trace = {
        id,
        startedAt,
        endedAt,
        seed: entry.seed,
        pair: entry.pair,
        game: entry.game,
        teamA: { id: entry.teamA.id, label: entry.teamA.label, model: entry.teamA.model },
        teamB: { id: entry.teamB.id, label: entry.teamB.label, model: entry.teamB.model },
        state: { seed: entry.seed, winner: "draw", reason: "runner_error", events: [] },
        maxActions,
        actions: [],
        failures: [
          { team: "A", model: entry.teamA.model, error: err.message || "runner_error" },
          { team: "B", model: entry.teamB.model, error: err.message || "runner_error" }
        ]
      };
      writeJson(traceFile, trace);
      summary = {
        id,
        seed: entry.seed,
        pair: entry.pair,
        game: entry.game,
        teamA: entry.teamA.id,
        teamB: entry.teamB.id,
        winner: "draw",
        reason: "runner_error",
        events: 0,
        failures: 2,
        error: err.message,
        trace: path.relative(outputDir, traceFile)
      };
    }
    if (!opts.quiet) {
      console.error(
        `[${entry.index + 1}/${schedule.length}] done winner=${summary.winner} reason=${summary.reason} events=${summary.events} failures=${summary.failures}`
      );
    }
    if (Number(opts.sleepMs) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Number(opts.sleepMs)));
    }
    return summary;
  });
  fs.writeFileSync(matchesFile, "");
  for (const summary of matches) appendJsonl(matchesFile, summary);
  for (const summary of matches) {
    const teamA = contestants.find((contestant) => contestant.id === summary.teamA);
    const teamB = contestants.find((contestant) => contestant.id === summary.teamB);
    const trace = summary.trace ? JSON.parse(fs.readFileSync(path.join(outputDir, summary.trace), "utf8")) : null;
    applyScore(rows, teamA, teamB, trace ? trace.state : { winner: summary.winner, events: [] }, trace ? trace.failures : []);
  }

  const leaderboard = sortedLeaderboard(rows);
  writeJson(path.join(outputDir, "leaderboard.json"), leaderboard);
  writeJson(path.join(outputDir, "matches-summary.json"), matches);
  const store = buildBenchmarkStore(leaderboard, readStore(opts.writeStore));
  writeJson(path.join(outputDir, "graphwar-store.json"), store);
  if (opts.writeStore) writeJson(path.resolve(opts.writeStore), store);
  const report = buildReport({
    generatedAt,
    gamesPerPair,
    maxActions,
    contestants,
    schedule,
    resolutions: resolved.resolutions,
    matches,
    leaderboard
  });
  fs.writeFileSync(path.join(outputDir, "report.md"), report);
  return { outputDir, contestants, schedule, leaderboard, matches };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runBenchmark({
    gamesPerPair: args["games-per-pair"],
    seedBase: args["seed-base"],
    maxMatches: args["max-matches"],
    limitModels: args["limit-models"],
    outDir: args.out,
    writeStore: args["write-store"],
    sleepMs: args["sleep-ms"],
    timeoutMs: args["timeout-ms"],
    maxActions: args["max-actions"],
    concurrency: args.concurrency,
    includeRoutes: Boolean(args["include-routes"]),
    dryRun: Boolean(args["dry-run"]),
    allowMissing: Boolean(args["allow-missing"]),
    continueOnError: Boolean(args["continue-on-error"]),
    reasoning: args.reasoning || "off",
    quiet: Boolean(args.quiet)
  });
  console.log(JSON.stringify({
    outputDir: result.outputDir,
    dryRun: Boolean(result.dryRun),
    contestants: result.contestants.length,
    matches: result.matches.length,
    plannedMatches: result.schedule.length,
    top: result.leaderboard.slice(0, 5).map((row) => ({ label: row.label, rating: row.rating, games: row.games }))
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  ROUTE_MODEL_SPECS,
  TARGET_MODEL_SPECS,
  buildBenchmarkSchedule,
  buildBenchmarkStore,
  fetchOpenRouterModels,
  resolveTargetModels,
  runWithConcurrency,
  runBenchmark
};
