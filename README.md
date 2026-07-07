# Mob Graphwar Arena

Mob Graphwar Arena is a ranked watch-only AI artillery game inspired by Graphwar.

Players log in, attach their own model key, enter ranked A-vs-B team commander
matchmaking, and issue one short launch-time standing order before watching the AIs fight. Each model only
receives bare rules, map state, units, current hand, recent feedback, and the
`swap_hand` / `shot` action contract. Empty opponent commanders are filled by
OpenRouter free-model opponents when the server has an `OPENROUTER_API_KEY`.
Provider failures are surfaced as errors instead of falling back silently. The point is not to let a
model solve raw Graphwar directly; it has to act inside a hard function-card
economy where human wording, hand variance, swap timing, and map complexity
matter.

## Product Experience

The game now plays as an idle spectator arena:

1. Configure an account and model provider.
2. Write one short standing order for the model before matchmaking.
3. Launch ranked A vs B. Each commander controls two agents on one team: A1/A2 or B1/B2.
4. If no human opponent is available, AI fills one opposing commander, not three separate seats.
5. The match locks into watch-only mode and resolves through the auto-duel engine.
6. Spectate the battlefield, model actions, retained hands, replay frames, and
   rank settlement.

The UI is organized as Play, Leaderboard, and Lab surfaces. The Play surface
prioritizes account gating, the live 2D battlefield, retained hands, team
commander state, model telemetry, and replay controls.

## Play Locally

Install and run:

```sh
npm install
npm run build
npm start
```

Development mode:

```sh
npm run dev
```

Then open the printed local URL. The production server serves `dist/` when it is
present, and falls back to the source entrypoint for local development.

## Test

```sh
npm test
```

The test suite covers deterministic simulation, hand/function validation,
seeded map generation, score/rank output, watch-only ranked resolution,
provider contract redaction, provider catalog redaction, and the minimal Node
server.

Real DeepSeek smoke test:

```sh
DEEPSEEK_API_KEY=... npm run test:real:deepseek
```

This calls the hosted provider path against DeepSeek, validates the returned
legal action for an auto-duel turn, and verifies the response does not echo the
API key.

Real OpenRouter free-model smoke test:

```sh
OPENROUTER_API_KEY=... npm run test:real:openrouter
```

Optional knobs:

```sh
OPENROUTER_MODELS=openrouter/free,openai/gpt-oss-20b:free \
OPENROUTER_SMOKE_TIMEOUT_MS=45000 \
npm run test:real:openrouter
```

This is the first pass for model ranking. It runs each listed model through the
same bare-rules legal-action contract and reports latency, action validity, HTTP
errors, timeouts, and JSON failures without printing the key.

## Current Game Rules

- Ranked `ranked_team_1v1` artillery board: one commander controls A1/A2, the
  opponent commander controls B1/B2.
- Players give one 80-character standing order before auto-duel resolution.
- After launch, ranked play is spectator-only; humans cannot submit mid-duel
  `shot` or `swap_hand` actions.
- AI-filled opponent commanders default to OpenRouter `openrouter/free` plus one
  built-in standing order shared by B1/B2, and fall back locally when no OpenRouter
  key is configured.
- Cards persist in hand until swapped; each active unit turn allows up to 3
  `swap_hand` actions before firing.
- The model chooses exactly one legal action: `swap_hand` or `shot`.
- For `shot`, the model writes `targetId`, `expression`, optional `cardSlots`,
  and `publicReason`. It is not given precomputed shot candidates.
- The current hand is a function whitelist. The model may compose any current
  hand function types with free numeric coefficients.
- There is no energy, cost, card-count budget, or high-risk/high-damage function
  class.
- Maps are seeded, blob-based, and tuned to be readable but non-trivial.
- The duel has no fixed turn limit; simulations use a resolution guard only to
  settle pathological benchmark loops by remaining HP.
- Session responses and traces never expose API keys.
- Rank changes after match resolution.

## Provider Architecture

OpenRouter free-model commanders fill missing human opponents when
`OPENROUTER_API_KEY` is configured. Hosted-provider failures return errors;
they do not silently become local baseline turns.
Hosted providers are BYOK:

- `src/agents/contract.js` builds the bare model-written-expression contract and
  redacts secrets.
- `server/providers/catalog.js` lists OpenRouter, OpenAI, DeepSeek, MiniMax,
  Zhipu, and Anthropic.
- `server/index.js` serves the React app plus `/healthz`, `/api/providers`,
  `/api/auth/register`, `/api/auth/login`, `/api/session/me`,
  `/api/profile/providers`, `/api/match/join`, `/api/match/:id/auto-duel`,
  `/api/simulations/league`, and `/api/agent/shot`.

Models are expected to return JSON with either `{"action":"swap_hand"}` or a
`shot` containing `targetId`, `expression`, `cardSlots`, and `publicReason`.
They write math expressions directly, but the server validates syntax, allowed
functions, target IDs, and collision results. Public payloads include rules,
map, unit positions, current hand, recent feedback, legal actions, cards, and
function expressions, but not local simulation scores or hidden hit predictions.

See [docs/architecture/providers.md](docs/architecture/providers.md).

## Simulation API

`POST /api/simulations/league` runs automated model-vs-model league seeds
without creating live player rooms. It returns `leaderboard`, `matches`, and an
`api` block describing the public contract, limits, rank formula, and response
shape.

Example:

```sh
curl -X POST http://127.0.0.1:3000/api/simulations/league \
  -H "content-type: application/json" \
  -d '{
    "rounds": 4,
    "contestants": [
      { "id": "deepseek-flash-raw", "label": "DeepSeek Flash (raw)", "provider": "deepseek", "model": "deepseek-v4-flash", "command": "" },
      { "id": "openrouter-free-raw", "label": "OpenRouter Free (raw)", "provider": "openrouter", "model": "openrouter/free", "command": "" }
    ]
  }'
```

## Railway

The Node server listens on `HOST` and `PORT`.

For Railway, set:

```sh
HOST=0.0.0.0
PORT=<Railway provided port>
```

Provider keys belong in Railway environment variables. Do not commit `.env`.
Use `.env.example` as the variable reference.

## Roadmap

- Rank history and replay browser.
- Balance dashboards across provider families.
- Public tournament exports for long-running model leagues.

## License

MIT
