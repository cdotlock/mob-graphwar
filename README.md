# Mob Graphwar Arena

Mob Graphwar Arena is a ranked AI-command artillery game inspired by Graphwar.

Players log in, attach their own model key, enter ranked 2v2 matchmaking, and
issue short per-turn orders to a model that only receives bare rules, map state,
units, current hand, and legal actions. Empty seats are filled by AI. The point
is not to let a model solve raw Graphwar directly; it has to act inside a hard
function-card economy where human wording, hand variance, reroll timing, and map
complexity matter.

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

The test suite covers deterministic simulation, card/resource validation,
seeded map generation, score/rank output, provider contract redaction, provider
catalog redaction, and the minimal Node server.

Real DeepSeek smoke test:

```sh
DEEPSEEK_API_KEY=... npm run test:real:deepseek
```

This calls the hosted provider path against DeepSeek, validates the returned
legal action, executes either the selected shot or reroll locally, and verifies
the response does not echo the API key.

## Current Game Rules

- Ranked 2v2 artillery board with human player plus AI-filled seats.
- Each turn uses a fresh 80-character human order for the active model.
- Cards persist in hand until rerolled; each active turn allows up to 3 rerolls.
- The model chooses exactly one legal action: reroll or shot.
- The AI can use at most two shape/control cards and one modifier card.
- Maps are seeded, high-density, and intentionally hard.
- Session responses and traces never expose API keys.
- Rank changes after match resolution.

## Provider Architecture

Local AI fills missing seats and handles offline play. Hosted providers are BYOK:

- `src/agents/contract.js` exposes legal candidate IDs and redaction helpers.
- `server/providers/catalog.js` lists OpenAI, DeepSeek, MiniMax, Zhipu, and
  Anthropic.
- `server/index.js` serves the React app plus `/healthz`, `/api/providers`,
  `/api/session`, `/api/match/join`, `/api/match/:id/resolve`, and
  `/api/agent/shot`.

Models are expected to choose `{"action":"reroll"}` or a listed shot
`candidateId`. They should never output arbitrary JavaScript or free-form
functions. Public payloads include rules, map, unit positions, current hand,
legal actions, cards, combo identity, target, cost, and expression, but not
local simulation scores or hit results.

See [docs/architecture/providers.md](docs/architecture/providers.md).

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

- Real player matchmaking persistence.
- Richer shot playback animation and replay controls.
- More map templates and balance tests across provider families.
- Rank history and replay browser.

## License

MIT
