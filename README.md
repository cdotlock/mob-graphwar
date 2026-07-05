# Mob Graphwar

Mob Graphwar is a Graphwar-inspired AI command game.

Two human players write short commands. Their AI agents must fire one shot using
only the function cards in the current hand. There is no movement, fog of war,
scouting, counterspell phase, or reward drafting in the current prototype.

The design goal is simple: do not let AI play raw Graphwar as an unconstrained
math solver. Make it play inside a small card economy where wording, hand
variance, hard maps, and risk choices matter.

## Play Locally

Static offline mode:

```sh
open index.html
```

Hosted local mode:

```sh
npm start
```

Then open `http://127.0.0.1:3000`.

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
candidate id, executes that candidate locally, and verifies the response does
not echo the API key.

## Current Game Rules

- 2v2 artillery board.
- Each turn shows the active team's four-card hand.
- The player has one 80-character command.
- `Lock Shot` resolves exactly one AI-generated legal function shot.
- The AI can use at most two shape/control cards and one modifier card.
- Maps are seeded and intentionally hard.
- The game exports a deterministic trace with no API keys.
- Finished battles show score and rank.

## Provider Architecture

Offline play uses the deterministic local agent.

Hosted provider play is optional:

- `src/agents/contract.js` exposes legal candidate IDs and redaction helpers.
- `server/providers/catalog.js` lists OpenAI, DeepSeek, MiniMax, Zhipu, and
  Anthropic.
- `server/index.js` serves the app plus `/healthz`, `/api/providers`, and the
  provider-shot contract endpoint.

Models are expected to choose from candidate IDs. They should never output
arbitrary JavaScript or free-form functions. Public candidates include cards,
combo identity, target, cost, and expression, but not local simulation scores or
hit results.

The browser defaults to `Local`. Toggle `Live` in Agent Source to send one
locked shot through `/api/agent/shot` with either a server environment key or a
user-supplied session key.

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

- More live-provider status and model presets.
- Richer shot playback animation and replay controls.
- More map templates and balance tests.
- Multiplayer lobby.
- Rank history and replay browser.

## License

MIT
