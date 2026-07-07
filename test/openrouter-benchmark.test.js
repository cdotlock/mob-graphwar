const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  TARGET_MODEL_SPECS,
  benchmarkRoute,
  buildBenchmarkSchedule,
  buildBenchmarkStore,
  runWithConcurrency,
  runBenchmark,
  resolveTargetModels
} = require("../scripts/openrouter-raw-benchmark.js");
const { runLeagueBattle } = require("../server/index.js");

function fakeModel(id, name, created) {
  return {
    id,
    name,
    created,
    context_length: 1000000,
    pricing: { prompt: "0.000001", completion: "0.000003" },
    architecture: { input_modalities: ["text"], output_modalities: ["text"] }
  };
}

function testResolveTargetModelsUsesCurrentOpenRouterIds() {
  const catalog = [
    {
      ...fakeModel("openai/gpt-5.5", "OpenAI: GPT-5.5", 10),
      reasoning: { supported_efforts: ["high", "medium", "low"], default_effort: "medium" }
    },
    fakeModel("anthropic/claude-opus-4.8", "Anthropic: Claude Opus 4.8", 20),
    fakeModel("google/gemini-3.5-flash", "Google: Gemini 3.5 Flash", 40),
    fakeModel("google/gemini-3.1-pro-preview", "Google: Gemini 3.1 Pro Preview", 50),
    fakeModel("moonshotai/kimi-k2.7-code", "MoonshotAI: Kimi K2.7 Code", 70),
    fakeModel("z-ai/glm-5.2", "Z.ai: GLM 5.2", 80),
    fakeModel("deepseek/deepseek-v4-flash", "DeepSeek: V4 Flash", 90),
    fakeModel("deepseek/deepseek-v4-pro", "DeepSeek: V4 Pro", 100),
    fakeModel("minimax/minimax-m3", "MiniMax: MiniMax M3", 120),
    { ...fakeModel("google/nano-banana-pro", "Google: Nano Banana Pro", 140), architecture: { output_modalities: ["image"] } }
  ];
  const resolved = resolveTargetModels(catalog);
  assert.strictEqual(resolved.contestants.length, TARGET_MODEL_SPECS.length);
  assert.strictEqual(TARGET_MODEL_SPECS.length, 9, "updated raw benchmark should use the current 9-model field");
  assert.ok(resolved.contestants.every((contestant) => contestant.provider === "openrouter"));
  assert.ok(resolved.contestants.every((contestant) => contestant.command === ""), "raw benchmark should not add standing orders");
  const gpt = resolved.contestants.find((contestant) => contestant.model === "openai/gpt-5.5");
  assert.strictEqual(gpt.reasoning, null, "raw benchmark should default to reasoning off for cost control");
  const highResolved = resolveTargetModels(catalog, { reasoning: "high" });
  const highGpt = highResolved.contestants.find((contestant) => contestant.model === "openai/gpt-5.5");
  assert.deepStrictEqual(highGpt.reasoning, { enabled: true, exclude: false, effort: "high" }, "reasoning can still be enabled explicitly for thinking traces");
  assert.strictEqual(gpt.strictDecisionSchema, true, "raw benchmark should enforce the tiny decision JSON schema");
  assert.ok(resolved.contestants.some((contestant) => contestant.model === "google/gemini-3.1-pro-preview"), "requested Gemini 3.1 Pro should map to the live preview model id");
  assert.deepStrictEqual(resolved.missing, []);
}

function testResolveTargetModelsCanUseInfronRoute() {
  const catalog = [
    fakeModel("openai/gpt-5.5", "OpenAI: GPT-5.5", 10),
    fakeModel("anthropic/claude-opus-4.8", "Anthropic: Claude Opus 4.8", 20),
    fakeModel("google/gemini-3.5-flash", "Google: Gemini 3.5 Flash", 40),
    fakeModel("google/gemini-3.1-pro-preview", "Google: Gemini 3.1 Pro Preview", 50),
    fakeModel("moonshotai/kimi-k2.7-code", "MoonshotAI: Kimi K2.7 Code", 70),
    fakeModel("z-ai/glm-5.2", "Z.ai: GLM 5.2", 80),
    fakeModel("deepseek/deepseek-v4-flash", "DeepSeek: V4 Flash", 90),
    fakeModel("deepseek/deepseek-v4-pro", "DeepSeek: V4 Pro", 100),
    fakeModel("minimax/minimax-m3", "MiniMax: MiniMax M3", 120)
  ];
  const resolved = resolveTargetModels(catalog, { platform: "infron" });
  assert.strictEqual(benchmarkRoute("infron").providerId, "infron");
  assert.strictEqual(resolved.contestants.length, 9);
  assert.ok(resolved.contestants.every((contestant) => contestant.provider === "infron"));
  assert.ok(resolved.contestants.every((contestant) => contestant.command === ""), "Infron raw benchmark should not add standing orders");
  assert.deepStrictEqual(resolved.missing, []);
}

function testBenchmarkScheduleAlternatesSidesForEveryPair() {
  const contestants = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" }
  ];
  const schedule = buildBenchmarkSchedule(contestants, 2, 9000);
  assert.deepStrictEqual(
    schedule.map((entry) => `${entry.teamA.id}->${entry.teamB.id}`),
    ["a->b", "b->a", "a->c", "c->a", "b->c", "c->b"]
  );
  assert.strictEqual(new Set(schedule.map((entry) => entry.seed)).size, schedule.length, "each game should have a stable unique seed");
}

function testBenchmarkStoreRegistersRawRowsWithoutSecrets() {
  const leaderboard = [
    { id: "openai-gpt-5-5", label: "OpenAI GPT-5.5", provider: "infron", model: "openai/gpt-5.5", rating: 1028, games: 2, wins: 1, losses: 0, draws: 1 },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "infron", model: "deepseek/deepseek-v4-pro", rating: 978, games: 2, wins: 0, losses: 1, draws: 1 }
  ];
  const store = buildBenchmarkStore(leaderboard, {
    nextPlayerId: 7,
    players: {
      "benchmark-openai-gpt-5-5-raw": {
        id: "benchmark-openai-gpt-5-5-raw",
        createdAt: "2026-01-01T00:00:00.000Z",
        providers: { openrouter: { model: "openai/gpt-5.5", configured: true } }
      },
      "benchmark-stale-model-raw": {
        id: "benchmark-stale-model-raw",
        displayName: "Stale Model (raw)",
        providers: { openrouter: { model: "stale/model", configured: true } }
      }
    }
  });
  const players = Object.values(store.players);
  assert.strictEqual(players.length, 2);
  assert.ok(players.every((player) => player.displayName.endsWith("(raw)")));
  assert.ok(players.every((player) => player.providers.infron.configured === true));
  assert.ok(players.every((player) => !player.providers.openrouter));
  assert.ok(!store.players["benchmark-stale-model-raw"], "benchmark store should remove stale raw rows not present in the current run");
  assert.ok(!JSON.stringify(store).includes("sk-"), "benchmark store should not contain provider secrets");
}

async function testLeagueBattleCanUseBenchmarkActionCap() {
  const teamA = { id: "raw-a", label: "Raw A", provider: "local", model: "", command: "" };
  const teamB = { id: "raw-b", label: "Raw B", provider: "local", model: "", command: "" };
  const battle = await runLeagueBattle(8123, teamA, teamB, {}, globalThis.fetch, { maxActions: 1 });
  assert.ok(battle.actions.length <= 1, "benchmark action cap should stop long model duels");
  assert.ok(battle.state.winner, "capped benchmark battle should still settle by guard for ranking");
}

async function testLeagueBattleCannotExceedGlobalActionCap() {
  const teamA = { id: "raw-a", label: "Raw A", provider: "local", model: "", command: "" };
  const teamB = { id: "raw-b", label: "Raw B", provider: "local", model: "", command: "" };
  const battle = await runLeagueBattle(4, teamA, teamB, {}, globalThis.fetch, { maxActions: 96 });
  assert.ok(battle.actions.length <= 24, "requested caps above 24 should be clamped by the global battle cap");
  assert.strictEqual(battle.state.reason, "resolution_guard", "capped battle should settle by comparing remaining HP");
}

async function testLeagueBattleCanPenalizeInvalidModelActions() {
  const teamA = { id: "raw-a", label: "Raw A", provider: "openrouter", model: "openai/gpt-5.5", command: "", apiKey: "sk-test" };
  const teamB = { id: "raw-b", label: "Raw B", provider: "openrouter", model: "anthropic/claude-opus-4.8", command: "", apiKey: "sk-test" };
  const battle = await runLeagueBattle(
    8123,
    teamA,
    teamB,
    { GRAPHWAR_ALLOWED_PROVIDERS: "openrouter" },
    async (_url, options) => {
      const payload = JSON.parse(options.body);
      const rules = JSON.parse(payload.messages[0].content);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "shot",
                  targetId: `${rules.team}1`,
                  expression: "y=y0+dy*t",
                  cardSlots: [],
                  publicReason: "invalid own-team target"
                })
              }
            }
          ]
        })
      };
    },
    { maxActions: 1, penalizeInvalidActions: true }
  );
  assert.strictEqual(battle.actions.length, 1);
  assert.strictEqual(battle.actions[0].action, "invalid");
  assert.strictEqual(battle.actions[0].failure.error, "unknown_target_id");
  assert.ok(battle.actions[0].modelOutput.includes("invalid own-team target"), "invalid model output should be preserved in trace");
  assert.strictEqual(battle.failures.length, 1);
  assert.strictEqual(battle.state.reason, "resolution_guard");
}

async function testLeagueBattleDoesNotPenalizeNetworkFailuresAsInvalidActions() {
  const teamA = { id: "raw-a", label: "Raw A", provider: "openrouter", model: "openai/gpt-5.5", command: "", apiKey: "sk-test" };
  const teamB = { id: "raw-b", label: "Raw B", provider: "openrouter", model: "anthropic/claude-opus-4.8", command: "", apiKey: "sk-test" };
  await assert.rejects(
    () =>
      runLeagueBattle(
        8123,
        teamA,
        teamB,
        { GRAPHWAR_ALLOWED_PROVIDERS: "openrouter" },
        async () => {
          throw new TypeError("fetch failed");
        },
        { maxActions: 1, penalizeInvalidActions: true }
      ),
    /fetch failed/
  );
}

async function testRunWithConcurrencyKeepsResultsInScheduleOrder() {
  const seen = [];
  const results = await runWithConcurrency(
    [0, 1, 2, 3],
    3,
    async (item) => {
      seen.push(item);
      await new Promise((resolve) => setTimeout(resolve, item === 0 ? 20 : 1));
      return item * 10;
    }
  );
  assert.deepStrictEqual(results, [0, 10, 20, 30]);
  assert.ok(seen.slice(0, 3).includes(2), "runner should start more than one match before the first slow task finishes");
}

async function testConcurrentBenchmarkDoesNotDoubleScore() {
  const result = await runBenchmark({
    apiKey: "sk-test",
    catalog: [
      fakeModel("openai/gpt-5.5", "OpenAI: GPT-5.5", 10),
      fakeModel("anthropic/claude-opus-4.8", "Anthropic: Claude Opus 4.8", 20)
    ],
    limitModels: 2,
    gamesPerPair: 2,
    maxActions: 1,
    concurrency: 2,
    outDir: "artifacts/openrouter-benchmark/test-concurrent-score",
    allowMissing: true,
    fetch: async (_url, options) => {
      const payload = JSON.parse(options.body);
      const rules = JSON.parse(payload.messages[0].content);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                reasoning: "Write a simple function shot.",
                content: JSON.stringify({
                  action: "shot",
                  targetId: rules.opponentIds[0],
                  expression: "y=y0+dy*t+8*sin(pi*t)",
                  cardSlots: [1],
                  publicReason: "simple function shot"
                })
              }
            }
          ]
        })
      };
    }
  });
  assert.strictEqual(result.matches.length, 2);
  assert.ok(result.leaderboard.every((row) => row.games === 2), "each contestant should be scored once per scheduled match, not once per worker plus summary");
}

async function testBenchmarkCanResumeExistingTraceFiles() {
  const outDir = "artifacts/openrouter-benchmark/test-resume-existing";
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "traces"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "traces", "match-0001.json"), JSON.stringify({
    id: "match-0001",
    seed: 64037,
    pair: "openai-gpt-5-5:anthropic-claude-opus-4-8",
    game: 1,
    teamA: { id: "openai-gpt-5-5", label: "OpenAI GPT-5.5", model: "openai/gpt-5.5" },
    teamB: { id: "anthropic-claude-opus-4-8", label: "Anthropic Claude Opus 4.8", model: "anthropic/claude-opus-4.8" },
    state: { winner: "A", reason: "hp_zero", events: [], score: null },
    actions: [],
    failures: []
  }));
  let calls = 0;
  const result = await runBenchmark({
    apiKey: "sk-test",
    catalog: [
      fakeModel("openai/gpt-5.5", "OpenAI: GPT-5.5", 10),
      fakeModel("anthropic/claude-opus-4.8", "Anthropic: Claude Opus 4.8", 20)
    ],
    limitModels: 2,
    gamesPerPair: 2,
    maxActions: 1,
    concurrency: 1,
    outDir,
    allowMissing: true,
    resume: true,
    fetch: async (_url, options) => {
      calls += 1;
      const payload = JSON.parse(options.body);
      const rules = JSON.parse(payload.messages[0].content);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "shot",
                  targetId: rules.opponentIds[0],
                  expression: "y=y0+dy*t",
                  cardSlots: [],
                  publicReason: "simple function shot"
                })
              }
            }
          ]
        })
      };
    }
  });
  assert.strictEqual(calls, 1, "resume should skip the completed first trace and only run the missing second match");
  assert.strictEqual(result.matches.length, 2);
  assert.ok(result.leaderboard.every((row) => row.games === 2), "resumed and new traces should be aggregated together");
}

async function testBenchmarkStopsOnProviderErrorByDefault() {
  await assert.rejects(
    () =>
      runBenchmark({
        apiKey: "sk-test",
        catalog: [
          fakeModel("openai/gpt-5.5", "OpenAI: GPT-5.5", 10),
          fakeModel("anthropic/claude-opus-4.8", "Anthropic: Claude Opus 4.8", 20)
        ],
        limitModels: 2,
        gamesPerPair: 1,
        maxActions: 1,
        concurrency: 1,
        outDir: "artifacts/openrouter-benchmark/test-stop-on-error",
        allowMissing: true,
        fetch: async () => ({ ok: false, status: 402, text: async () => "no credits" })
      }),
    /provider_http_error/
  );
}

(async () => {
  testResolveTargetModelsUsesCurrentOpenRouterIds();
  testResolveTargetModelsCanUseInfronRoute();
  testBenchmarkScheduleAlternatesSidesForEveryPair();
  testBenchmarkStoreRegistersRawRowsWithoutSecrets();
  await testLeagueBattleCanUseBenchmarkActionCap();
  await testLeagueBattleCannotExceedGlobalActionCap();
  await testLeagueBattleCanPenalizeInvalidModelActions();
  await testLeagueBattleDoesNotPenalizeNetworkFailuresAsInvalidActions();
  await testRunWithConcurrencyKeepsResultsInScheduleOrder();
  await testConcurrentBenchmarkDoesNotDoubleScore();
  await testBenchmarkCanResumeExistingTraceFiles();
  await testBenchmarkStopsOnProviderErrorByDefault();
  console.log("openrouter benchmark tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
