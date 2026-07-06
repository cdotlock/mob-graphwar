# OpenRouter Raw Model Benchmark - 2026-07-07

## Setup

- Runner: `scripts/openrouter-raw-benchmark.js`
- Output directory: `artifacts/openrouter-benchmark/raw-2026-07-07-openrouter-thinking-quick`
- Models: 13 requested models, all routed through OpenRouter.
- Prompt mode: raw, no standing order prompt. Leaderboard names use `<model> (raw)`.
- Reasoning mode: enabled with high effort when model metadata supports reasoning.
- Schedule: round-robin, 2 games per pair, alternating sides.
- Completed matches: 156 / 156.
- Action cap: 4 model actions per game for this quick pass.
- Timeout: 300 seconds per provider request.
- Requested concurrency: 24. Effective runner cap: 16 parallel matches.

## Data Files

- `models.json`: resolved OpenRouter model IDs and metadata.
- `matches.jsonl`: one compact row per game.
- `matches-summary.json`: JSON summary for all games.
- `leaderboard.json`: final benchmark standings.
- `graphwar-store.json`: local leaderboard import file.
- `traces/*.json`: full game states, paths, model outputs, reasoning traces, failures, and results.

## Leaderboard

| Rank | Model (raw) | Rating | W-L-D | Provider failures | Enemy hits | Route bonus |
| ---: | --- | ---: | --- | ---: | ---: | ---: |
| 1 | DeepSeek V4 Pro (raw) | 1078 | 6-1-17 | 50 | 10 | 182 |
| 2 | Google Gemini 3.5 Flash (raw) | 1046 | 5-1-18 | 48 | 5 | 78 |
| 3 | Anthropic Claude Opus 4.8 (raw) | 1038 | 7-5-12 | 45 | 9 | 102 |
| 4 | OpenAI GPT-5.5 (raw) | 978 | 4-3-17 | 61 | 5 | 102 |
| 5 | DeepSeek V4 Flash (raw) | 960 | 4-4-16 | 40 | 8 | 42 |
| 6 | xAI Grok 4.3 (raw) | 946 | 3-3-18 | 49 | 4 | 90 |
| 7 | Xiaomi MiMo V2.5 Pro (raw) | 942 | 4-5-15 | 56 | 6 | 70 |
| 8 | Anthropic Claude Sonnet 5 (raw) | 938 | 5-7-12 | 38 | 6 | 102 |
| 9 | StepFun Step 3.7 Flash (raw) | 928 | 3-4-17 | 33 | 4 | 56 |
| 10 | Google Gemini 3.1 Pro (raw) | 924 | 4-6-14 | 48 | 4 | 68 |
| 11 | Moonshot Kimi K2.7 Code (raw) | 900 | 1-2-21 | 37 | 4 | 116 |
| 12 | Z.ai GLM 5.2 (raw) | 892 | 3-6-15 | 52 | 5 | 60 |
| 13 | MiniMax M3 (raw) | 882 | 1-3-20 | 53 | 3 | 70 |

## Failure Audit

This run completed the schedule, but it is not a clean capability ranking.

- Provider attempts: 624.
- Valid provider JSON outputs captured: 14.
- Provider failures captured: 610.
- HTTP 402 insufficient-credit failures: 584.
- Matches affected by HTTP 402: 153 / 156.
- Non-HTTP failures: 26, including invalid JSON, fetch failures, one terminated request, and one truncated JSON response.
- Successful reasoning traces captured on action records: 33.

The dominant result is therefore not "these models cannot play Graphwar"; it is that the supplied OpenRouter account ran out of credits during a high-reasoning concurrent benchmark. The ranking above should be treated as a quick infrastructure and trace-capture pass, not the final model ladder.

## Interpretation

The runner now proves the full pipeline:

- It can resolve the requested OpenRouter model IDs.
- It can schedule a full round-robin.
- It can run concurrent games and write per-game traces.
- It records model reasoning, raw outputs, HTTP status, provider error bodies, and fallback outcomes.
- It writes a local benchmark leaderboard with `(raw)` model names.

The game result quality is still weak because most games hit the action cap after provider failures. A more trustworthy ladder needs either enough OpenRouter credits for high-reasoning calls or a cheaper staged run:

1. Run all models with reasoning disabled or low effort to establish baseline format compliance.
2. Run a smaller high-reasoning semifinal on the top models.
3. Raise the per-game action cap after provider failures fall below 10%.
4. Keep the raw `(raw)` ladder separate from player-prompt ladders.

