"use strict";

const { getProvider } = require("../server/providers/catalog.js");
const { executeProviderDecision } = require("../server/providers/execute.js");
const Contract = require("../src/agents/contract.js");
const Sim = require("../src/sim-core.js");

const DEFAULT_MODELS = [
  "openrouter/free",
  "openai/gpt-oss-20b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "google/gemma-4-31b-it:free"
];

function csv(value, fallback) {
  const items = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function numericEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function publicError(err) {
  return {
    error: err.message || "provider_error",
    status: err.status || null,
    timeoutMs: err.timeoutMs || null,
    validation: err.validation || null
  };
}

async function runCase(provider, apiKey, model, index) {
  const seed = 7351 + index * 73;
  const unitId = index % 2 === 0 ? "A1" : "B1";
  const command = index % 2 === 0
    ? "thread the maze; swap if no clean route; avoid ally"
    : "pressure weakest enemy; use bend or side pocket; avoid ally";
  const state = Sim.createInitialState({ seed });
  const rulesPayload = Contract.buildRulesPayload(state, unitId, command);
  const started = Date.now();
  try {
    const result = await executeProviderDecision(
      provider,
      {
        apiKey,
        command,
        candidates: rulesPayload.legalActions.filter((action) => action.action === "shot"),
        stateSummary: { seed: state.seed, turn: state.turn, map: state.mapMeta },
        rulesPayload,
        model
      },
      {
        env: {
          OPENROUTER_API_KEY: apiKey,
          OPENROUTER_MODEL: model,
          GRAPHWAR_REQUEST_TIMEOUT_MS: String(numericEnv("OPENROUTER_SMOKE_TIMEOUT_MS", numericEnv("GRAPHWAR_REQUEST_TIMEOUT_MS", 20_000)))
        }
      }
    );
    return {
      model,
      ok: true,
      seed,
      unitId,
      ms: Date.now() - started,
      action: result.decision.action,
      candidateId: result.decision.candidateId || null,
      reasonChars: String(result.decision.publicReason || "").length,
      legalActions: rulesPayload.legalActions.length,
      legalShots: rulesPayload.legalActions.filter((action) => action.action === "shot").length
    };
  } catch (err) {
    return {
      model,
      ok: false,
      seed,
      unitId,
      ms: Date.now() - started,
      ...publicError(err)
    };
  }
}

async function main() {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required");
  }
  const provider = getProvider("openrouter");
  const models = csv(process.env.OPENROUTER_MODELS, DEFAULT_MODELS).slice(0, numericEnv("OPENROUTER_SMOKE_LIMIT", 8));
  const results = [];
  for (let index = 0; index < models.length; index += 1) {
    results.push(await runCase(provider, apiKey, models[index], index));
  }
  const ok = results.filter((result) => result.ok).length;
  const payload = {
    provider: "openrouter",
    testedAt: new Date().toISOString(),
    timeoutMs: numericEnv("OPENROUTER_SMOKE_TIMEOUT_MS", numericEnv("GRAPHWAR_REQUEST_TIMEOUT_MS", 20_000)),
    total: results.length,
    ok,
    failed: results.length - ok,
    results
  };
  console.log(JSON.stringify(payload, null, 2));
  if (ok === 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message || "real_openrouter_smoke_failed" }, null, 2));
  process.exit(1);
});
