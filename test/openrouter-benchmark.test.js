const assert = require("assert");

const {
  TARGET_MODEL_SPECS,
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
    fakeModel("anthropic/claude-sonnet-5", "Anthropic: Claude Sonnet 5", 30),
    fakeModel("google/gemini-3.5-flash", "Google: Gemini 3.5 Flash", 40),
    fakeModel("google/gemini-3.1-pro-preview", "Google: Gemini 3.1 Pro Preview", 50),
    fakeModel("x-ai/grok-4.3", "xAI: Grok 4.3", 60),
    fakeModel("moonshotai/kimi-k2.7-code", "MoonshotAI: Kimi K2.7 Code", 70),
    fakeModel("z-ai/glm-5.2", "Z.ai: GLM 5.2", 80),
    fakeModel("deepseek/deepseek-v4-flash", "DeepSeek: V4 Flash", 90),
    fakeModel("deepseek/deepseek-v4-pro", "DeepSeek: V4 Pro", 100),
    fakeModel("stepfun/step-3.7-flash", "StepFun: Step 3.7 Flash", 110),
    fakeModel("minimax/minimax-m3", "MiniMax: MiniMax M3", 120),
    fakeModel("xiaomi/mimo-v2.5-pro", "Xiaomi: MiMo V2.5 Pro", 130),
    { ...fakeModel("google/nano-banana-pro", "Google: Nano Banana Pro", 140), architecture: { output_modalities: ["image"] } }
  ];
  const resolved = resolveTargetModels(catalog);
  assert.strictEqual(resolved.contestants.length, TARGET_MODEL_SPECS.length);
  assert.ok(resolved.contestants.every((contestant) => contestant.provider === "openrouter"));
  assert.ok(resolved.contestants.every((contestant) => contestant.command === ""), "raw benchmark should not add standing orders");
  const gpt = resolved.contestants.find((contestant) => contestant.model === "openai/gpt-5.5");
  assert.deepStrictEqual(gpt.reasoning, { enabled: true, exclude: false, effort: "high" }, "reasoning-capable models should run with high thinking visible in traces");
  assert.strictEqual(gpt.strictDecisionSchema, true, "raw benchmark should enforce the tiny decision JSON schema");
  assert.ok(resolved.contestants.some((contestant) => contestant.model === "google/gemini-3.1-pro-preview"), "requested Gemini 3.1 Pro should map to the live preview model id");
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
    { id: "openai-gpt-5-5", label: "OpenAI GPT-5.5", model: "openai/gpt-5.5", rating: 1028, games: 2, wins: 1, losses: 0, draws: 1 },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", model: "deepseek/deepseek-v4-pro", rating: 978, games: 2, wins: 0, losses: 1, draws: 1 }
  ];
  const store = buildBenchmarkStore(leaderboard, { nextPlayerId: 7, players: {} });
  const players = Object.values(store.players);
  assert.strictEqual(players.length, 2);
  assert.ok(players.every((player) => player.displayName.endsWith("(raw)")));
  assert.ok(players.every((player) => player.providers.openrouter.configured === true));
  assert.ok(!JSON.stringify(store).includes("sk-"), "benchmark store should not contain provider secrets");
}

async function testLeagueBattleCanUseBenchmarkActionCap() {
  const teamA = { id: "raw-a", label: "Raw A", provider: "local", model: "", command: "" };
  const teamB = { id: "raw-b", label: "Raw B", provider: "local", model: "", command: "" };
  const battle = await runLeagueBattle(8123, teamA, teamB, {}, globalThis.fetch, { maxActions: 1 });
  assert.ok(battle.actions.length <= 1, "benchmark action cap should stop long model duels");
  assert.ok(battle.state.winner, "capped benchmark battle should still settle by guard for ranking");
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
      const shot = rules.legalActions.find((action) => action.action === "shot");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                reasoning: "Pick the first legal shot.",
                content: JSON.stringify({ action: "shot", candidateId: shot.candidateId, publicReason: "first legal shot" })
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

(async () => {
  testResolveTargetModelsUsesCurrentOpenRouterIds();
  testBenchmarkScheduleAlternatesSidesForEveryPair();
  testBenchmarkStoreRegistersRawRowsWithoutSecrets();
  await testLeagueBattleCanUseBenchmarkActionCap();
  await testRunWithConcurrencyKeepsResultsInScheduleOrder();
  await testConcurrentBenchmarkDoesNotDoubleScore();
  console.log("openrouter benchmark tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
