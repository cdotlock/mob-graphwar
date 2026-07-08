#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const Contract = require("../src/agents/contract.js");
const Sim = require("../src/sim-core.js");
const { normalizeProviderDecision, stripReasoning } = require("../server/providers/normalize.js");
const { buildBenchmarkStore } = require("./openrouter-raw-benchmark.js");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonl(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
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

function publicEventSummary(event) {
  if (!event) return null;
  return {
    turn: event.turn,
    team: event.team,
    unitId: event.unitId || event.shooterId,
    targetId: event.targetId,
    result: event.result,
    resultLabel: event.resultLabel,
    damage: event.damage,
    hitDistance: event.hitDistance,
    proximityAccuracy: event.proximityAccuracy,
    routeBonus: event.routeBonus,
    expression: event.expression,
    score: event.score,
    closestTargetDistance: event.closestTargetDistance,
    maxY: event.maxY,
    collisionPoint: event.collisionPoint || null
  };
}

function getActiveUnit(state) {
  return typeof Sim.getActiveUnit === "function" ? Sim.getActiveUnit(state) : null;
}

function replayFailure(sourceAction, state, error, extra) {
  const activeUnit = getActiveUnit(state);
  return {
    turn: state.turn,
    originalTurn: sourceAction.turn,
    team: activeUnit ? activeUnit.team : sourceAction.team,
    originalTeam: sourceAction.team,
    unitId: activeUnit ? activeUnit.id : sourceAction.unitId || null,
    originalUnitId: sourceAction.unitId || null,
    contestantId: sourceAction.contestantId,
    model: sourceAction.model || "",
    error: error && error.message ? error.message : String(error || "replay_error"),
    rawText: stripReasoning(sourceAction.modelOutput || ""),
    validation: error && error.validation ? error.validation : null,
    replay: extra || null
  };
}

function actionContestant(action, teamA, teamB) {
  if (action.team === "A") return teamA;
  if (action.team === "B") return teamB;
  if (action.contestantId === teamA.id) return teamA;
  if (action.contestantId === teamB.id) return teamB;
  return teamA;
}

function replayRawAction(state, sourceAction, teamA, teamB) {
  const activeUnit = getActiveUnit(state);
  if (!activeUnit) {
    const err = new Error("no_alive_shooter");
    return { kind: "invalid", failure: replayFailure(sourceAction, state, err) };
  }
  if (sourceAction.team && sourceAction.team !== activeUnit.team) {
    const err = new Error("stale_action_team_mismatch");
    return {
      kind: "invalid",
      failure: replayFailure(sourceAction, state, err, {
        activeTeam: activeUnit.team,
        actionTeam: sourceAction.team
      })
    };
  }

  const contestant = actionContestant(sourceAction, teamA, teamB);
  const raw = sourceAction.modelOutput || "";
  let decision;
  try {
    decision = normalizeProviderDecision(raw);
  } catch (err) {
    return { kind: "invalid", failure: replayFailure(sourceAction, state, err) };
  }

  const rulesPayload = Contract.buildRulesPayload(state, activeUnit.id, contestant.command || "");
  const validation = Contract.validateAgentDecision(decision, rulesPayload.legalActions);
  if (!validation.ok) {
    const err = new Error(validation.reason);
    err.validation = validation;
    return { kind: "invalid", failure: replayFailure(sourceAction, state, err) };
  }

  if (validation.action === "swap_hand") {
    const swap = Sim.applyTurn(state, {}, {
      action: "swap_hand",
      provider: sourceAction.provider || `${contestant.label} / replay`,
      providerReason: validation.publicReason
    });
    return {
      kind: "swap_hand",
      action: {
        action: "swap_hand",
        swapsUsed: swap.swapsUsed,
        swapsRemaining: swap.swapsRemaining,
        hand: swap.cards
      },
      decision: {
        action: "swap_hand",
        publicReason: validation.publicReason
      }
    };
  }

  const beforeEventCount = state.events.length;
  Sim.applyTurn(
    state,
    { [activeUnit.id]: contestant.command || "" },
    {
      targetId: validation.targetId,
      expression: validation.expression,
      cardSlots: validation.cardSlots || [],
      provider: sourceAction.provider || `${contestant.label} / replay`,
      providerReason: validation.publicReason
    }
  );
  const event = state.events[beforeEventCount] || state.events[state.events.length - 1] || null;
  return {
    kind: "shot",
    action: {
      action: "shot",
      targetId: validation.targetId,
      expression: validation.expression,
      cardSlots: validation.cardSlots || [],
      event
    },
    decision: {
      action: "shot",
      targetId: validation.targetId,
      expression: validation.expression,
      cardSlots: validation.cardSlots || [],
      publicReason: validation.publicReason
    }
  };
}

function replayTrace(sourceTrace, options) {
  const opts = options || {};
  const maxActions = Math.max(1, Math.min(Number(opts.maxActions || sourceTrace.maxActions || Sim.CONFIG.maxResolutionActions) || 24, Sim.CONFIG.maxResolutionActions));
  const state = Sim.createInitialState({ seed: sourceTrace.seed });
  const teamA = opts.contestantsById.get(sourceTrace.teamA.id) || sourceTrace.teamA;
  const teamB = opts.contestantsById.get(sourceTrace.teamB.id) || sourceTrace.teamB;
  const actions = [];
  const failures = [];
  let consumed = 0;

  for (const sourceAction of sourceTrace.actions || []) {
    if (state.winner || consumed >= maxActions) break;
    consumed += 1;
    const activeUnit = getActiveUnit(state);
    const contestant = actionContestant(sourceAction, teamA, teamB);
    const base = {
      index: actions.length,
      sourceIndex: sourceAction.index,
      turn: state.turn,
      originalTurn: sourceAction.turn,
      team: activeUnit ? activeUnit.team : sourceAction.team,
      originalTeam: sourceAction.team,
      unitId: activeUnit ? activeUnit.id : sourceAction.unitId,
      originalUnitId: sourceAction.unitId,
      contestantId: contestant.id || sourceAction.contestantId,
      contestantLabel: contestant.label || sourceAction.contestantLabel,
      model: contestant.model || sourceAction.model || "",
      provider: sourceAction.provider || `${contestant.label || sourceAction.contestantLabel} / replay`,
      modelOutput: stripReasoning(sourceAction.modelOutput || ""),
      reasoning: sourceAction.reasoning || "",
      reasoningDetails: sourceAction.reasoningDetails || null
    };
    const replayed = replayRawAction(state, sourceAction, teamA, teamB);
    if (replayed.kind === "invalid") {
      failures.push(replayed.failure);
      actions.push({
        ...base,
        action: "invalid",
        targetId: null,
        expression: "",
        cardSlots: [],
        publicReason: `Invalid replay action: ${replayed.failure.error}`,
        failure: replayed.failure,
        event: null
      });
      state.turn += 1;
      continue;
    }
    actions.push({
      ...base,
      action: replayed.action.action,
      targetId: replayed.decision.targetId || null,
      expression: replayed.decision.expression || "",
      cardSlots: replayed.decision.cardSlots || [],
      publicReason: replayed.decision.publicReason || "",
      failure: null,
      swapsUsed: replayed.action.swapsUsed ?? null,
      swapsRemaining: replayed.action.swapsRemaining ?? null,
      event: replayed.action.event ? publicEventSummary(replayed.action.event) : null
    });
  }

  if (!state.winner) {
    Sim.forceResolveByHp(state, consumed >= maxActions ? "resolution_guard" : "replay_action_exhausted");
  }

  return {
    id: sourceTrace.id,
    sourceId: sourceTrace.id,
    sourceSeed: sourceTrace.seed,
    seed: sourceTrace.seed,
    pair: sourceTrace.pair,
    game: sourceTrace.game,
    teamA: sourceTrace.teamA,
    teamB: sourceTrace.teamB,
    maxActions,
    replayedAt: opts.generatedAt,
    replayPolicy: {
      mode: "no_cost_saved_model_outputs",
      parser: "normalizeProviderDecision_current",
      validator: "validateAgentDecision_current",
      sourceRunId: opts.sourceRunId || ""
    },
    state,
    actions,
    failures
  };
}

function createRows(contestants) {
  return new Map(contestants.map((contestant) => [contestant.id, {
    id: contestant.id,
    label: contestant.label,
    requested: contestant.requested || "",
    provider: contestant.provider || "",
    model: contestant.model || "",
    modelName: contestant.modelName || contestant.model || "",
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

function applyScore(rows, teamA, teamB, trace) {
  const a = rows.get(teamA.id);
  const b = rows.get(teamB.id);
  if (!a || !b) return;
  const winner = trace.state?.winner || "draw";
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
  for (const failure of trace.failures || []) {
    const row = failure.team === "A" ? a : failure.team === "B" ? b : null;
    if (row) row.providerFailures += 1;
  }
  for (const event of trace.state?.events || []) {
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

function summarizeAnalysis(leaderboard, traces, generatedAt) {
  const rows = leaderboard.map((row) => {
    const stats = {
      ...row,
      actions: 0,
      shotActions: 0,
      swaps: 0,
      invalidActions: 0,
      invalidByError: {},
      events: 0,
      hitEnemy: 0,
      hitAlly: 0,
      blocked: 0,
      ground: 0,
      out: 0,
      invalidEvent: 0,
      damageDealt: 0,
      allyDamage: 0,
      routeBonus: 0,
      bonusHits: 0
    };
    return stats;
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const aggregate = {
    matches: traces.length,
    actions: 0,
    events: 0,
    shotActions: 0,
    swaps: 0,
    invalidActions: 0,
    hitEnemy: 0,
    hitAlly: 0,
    blocked: 0,
    routeBonus: 0,
    hpZeroMatches: 0,
    guardMatches: 0,
    drawMatches: 0,
    replayActionExhaustedMatches: 0
  };
  for (const trace of traces) {
    if (trace.state.reason === "hp_zero") aggregate.hpZeroMatches += 1;
    if (trace.state.reason === "resolution_guard") aggregate.guardMatches += 1;
    if (trace.state.reason === "replay_action_exhausted") aggregate.replayActionExhaustedMatches += 1;
    if (trace.state.winner === "draw") aggregate.drawMatches += 1;
    for (const action of trace.actions || []) {
      aggregate.actions += 1;
      const row = byId.get(action.contestantId);
      if (row) row.actions += 1;
      if (action.action === "shot") {
        aggregate.shotActions += 1;
        if (row) row.shotActions += 1;
      } else if (action.action === "swap_hand") {
        aggregate.swaps += 1;
        if (row) row.swaps += 1;
      } else if (action.action === "invalid") {
        aggregate.invalidActions += 1;
        if (row) {
          row.invalidActions += 1;
          const reason = action.failure?.error || "invalid";
          row.invalidByError[reason] = (row.invalidByError[reason] || 0) + 1;
        }
      }
    }
    for (const event of trace.state.events || []) {
      aggregate.events += 1;
      const action = (trace.actions || []).find((item) => item.turn === event.turn && item.team === event.team);
      const row = byId.get(action?.contestantId);
      if (row) row.events += 1;
      if (event.result === "hitEnemy") {
        aggregate.hitEnemy += 1;
        if (row) {
          row.hitEnemy += 1;
          row.damageDealt += Number(event.damage) || 0;
        }
      } else if (event.result === "hitAlly") {
        aggregate.hitAlly += 1;
        if (row) {
          row.hitAlly += 1;
          row.allyDamage += Number(event.damage) || 0;
        }
      } else if (event.result === "blocked") {
        aggregate.blocked += 1;
        if (row) row.blocked += 1;
      } else if (event.result === "ground") {
        if (row) row.ground += 1;
      } else if (event.result === "out") {
        if (row) row.out += 1;
      } else if (event.result === "invalid") {
        if (row) row.invalidEvent += 1;
      }
      const routeBonus = Number(event.routeBonus?.value || 0) || 0;
      aggregate.routeBonus += routeBonus;
      if (row) {
        row.routeBonus += routeBonus;
        if (routeBonus > 0) row.bonusHits += 1;
      }
    }
  }
  for (const row of rows) {
    row.hitRate = row.shotActions ? Number((row.hitEnemy / row.shotActions).toFixed(3)) : 0;
    row.blockedRate = row.shotActions ? Number((row.blocked / row.shotActions).toFixed(3)) : 0;
    row.allyHitRate = row.shotActions ? Number((row.hitAlly / row.shotActions).toFixed(3)) : 0;
    row.invalidRate = row.actions ? Number((row.invalidActions / row.actions).toFixed(3)) : 0;
    row.avgDamagePerEnemyHit = row.hitEnemy ? Number((row.damageDealt / row.hitEnemy).toFixed(2)) : 0;
  }
  return {
    generatedAt,
    aggregate,
    rows
  };
}

function buildReport(data) {
  const lines = [];
  lines.push(`# ${data.title}`);
  lines.push("");
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push(`Source: \`${data.sourceDir}\``);
  lines.push("Mode: no-cost replay from saved raw model outputs; no provider calls.");
  lines.push("");
  lines.push("## Leaderboard");
  lines.push("");
  lines.push("| Rank | Model (raw) | Rating | W-L-D | Replayed invalid | Enemy hits | Route bonus |");
  lines.push("| ---: | --- | ---: | --- | ---: | ---: | ---: |");
  data.leaderboard.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${row.label} (raw) | ${row.rating} | ${row.wins}-${row.losses}-${row.draws} | ${row.providerFailures} | ${row.enemyHits} | ${row.routeBonus} |`);
  });
  lines.push("");
  lines.push("## Replay Policy");
  lines.push("");
  lines.push("- Rebuilds each match from original seed and saved `modelOutput` / invalid `rawText`.");
  lines.push("- Applies the current tolerant JSON normalizer and current server validation.");
  lines.push("- Still rejects empty JSON, missing expressions, unavailable functions, illegal targets, and stale team mismatches.");
  lines.push("- Stops at the 24-action global cap or when the saved action stream is exhausted, then resolves by HP.");
  return `${lines.join("\n")}\n`;
}

function buildChineseReport(data) {
  const lines = [];
  lines.push(`# ${data.title} 中文复盘`);
  lines.push("");
  lines.push(`生成时间：${data.generatedAt}`);
  lines.push(`源数据：\`${data.sourceDir}\``);
  lines.push("");
  lines.push("这次没有重新调用任何模型，只用旧 benchmark 中已经保存的 agent 输出，通过当前合规解析器重新跑了一遍战斗结算。");
  lines.push("");
  lines.push("## 新榜单");
  lines.push("");
  lines.push("| 名次 | 模型 raw | 分数 | 胜-负-平 | 重放后 invalid | 命中敌人 | 奖励点 |");
  lines.push("| ---: | --- | ---: | --- | ---: | ---: | ---: |");
  data.leaderboard.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${row.label} (raw) | ${row.rating} | ${row.wins}-${row.losses}-${row.draws} | ${row.providerFailures} | ${row.enemyHits} | ${row.routeBonus} |`);
  });
  lines.push("");
  lines.push("## 解释");
  lines.push("");
  lines.push("- 这是 raw/no-prompt/no-thinking 的合规重放，不是新模型能力测试。");
  lines.push("- 旧的 `target/formula/slots/reason/fire` 等别名现在会被容忍，因此部分旧 invalid 可以恢复成实际 shot。");
  lines.push("- 空输出、缺函数、非法目标、函数白名单不满足，仍然会被判 invalid。");
  lines.push("- 如果重放后的状态和旧动作流发生偏移，不会凭空生成新动作；动作流用完后按剩余 HP 结算。");
  return `${lines.join("\n")}\n`;
}

function replayBenchmarkArtifact(options) {
  const sourceDir = path.resolve(options.sourceDir);
  const outDir = path.resolve(options.outDir);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const runId = options.id || path.basename(outDir);
  const title = options.title || "Infron Raw Model Benchmark Compliance Replay";
  const models = readJson(path.join(sourceDir, "models.json"));
  const contestants = (models.contestants || []).map((contestant) => ({
    ...contestant,
    command: contestant.command || ""
  }));
  const contestantsById = new Map(contestants.map((contestant) => [contestant.id, contestant]));
  const traceDir = path.join(sourceDir, "traces");
  const traceFiles = fs.readdirSync(traceDir).filter((file) => file.endsWith(".json")).sort();
  ensureDir(path.join(outDir, "traces"));
  writeJson(path.join(outDir, "models.json"), {
    ...models,
    generatedAt,
    replaySource: path.relative(process.cwd(), sourceDir),
    replayRunId: runId,
    replayMode: "no_cost_saved_model_outputs"
  });

  const traces = [];
  const matches = [];
  for (const file of traceFiles) {
    const sourceTrace = readJson(path.join(traceDir, file));
    const trace = replayTrace(sourceTrace, {
      generatedAt,
      sourceRunId: path.basename(sourceDir),
      contestantsById,
      maxActions: options.maxActions || models.maxActionsPerGame || sourceTrace.maxActions
    });
    traces.push(trace);
    writeJson(path.join(outDir, "traces", file), trace);
    matches.push({
      id: trace.id,
      seed: trace.seed,
      pair: trace.pair,
      game: trace.game,
      teamA: trace.teamA.id,
      teamB: trace.teamB.id,
      winner: trace.state.winner || "draw",
      reason: trace.state.reason || "",
      events: trace.state.events.length,
      failures: trace.failures.length,
      score: trace.state.score || null,
      trace: path.join("traces", file)
    });
  }

  const rows = createRows(contestants);
  for (const trace of traces) {
    const teamA = contestantsById.get(trace.teamA.id) || trace.teamA;
    const teamB = contestantsById.get(trace.teamB.id) || trace.teamB;
    applyScore(rows, teamA, teamB, trace);
  }
  const leaderboard = sortedLeaderboard(rows);
  const analysis = summarizeAnalysis(leaderboard, traces, generatedAt);

  fs.writeFileSync(path.join(outDir, "matches.jsonl"), "");
  for (const match of matches) appendJsonl(path.join(outDir, "matches.jsonl"), match);
  writeJson(path.join(outDir, "matches-summary.json"), matches);
  writeJson(path.join(outDir, "leaderboard.json"), leaderboard);
  writeJson(path.join(outDir, "analysis-summary.json"), analysis);
  writeJson(path.join(outDir, "graphwar-store.json"), buildBenchmarkStore(leaderboard, {}, {
    id: runId,
    title,
    generatedAt,
    platform: models.platform || "infron",
    promptPolicy: "none",
    thinkingMode: "off",
    traceCount: traces.length
  }));
  fs.writeFileSync(path.join(outDir, "report.md"), buildReport({ title, generatedAt, sourceDir: path.relative(process.cwd(), sourceDir), leaderboard }));
  fs.writeFileSync(path.join(outDir, "analysis-report-zh.md"), buildChineseReport({ title, generatedAt, sourceDir: path.relative(process.cwd(), sourceDir), leaderboard }));

  return {
    outputDir: outDir,
    runId,
    generatedAt,
    sourceDir,
    matches,
    leaderboard,
    analysis,
    traces
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.out) {
    throw new Error("usage: replay-benchmark-artifact --source=<artifact-dir> --out=<output-dir> [--id=<run-id>] [--max-actions=24]");
  }
  const result = replayBenchmarkArtifact({
    sourceDir: args.source,
    outDir: args.out,
    id: args.id,
    title: args.title,
    maxActions: args["max-actions"]
  });
  console.log(JSON.stringify({
    outputDir: result.outputDir,
    runId: result.runId,
    matches: result.matches.length,
    top: result.leaderboard.slice(0, 9).map((row) => ({
      label: row.label,
      rating: row.rating,
      wld: `${row.wins}-${row.losses}-${row.draws}`,
      invalid: row.providerFailures
    }))
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ error: err && err.message ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  replayBenchmarkArtifact,
  replayRawAction,
  replayTrace,
  summarizeAnalysis
};
