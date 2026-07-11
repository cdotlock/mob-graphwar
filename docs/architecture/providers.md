# Provider Architecture

Mob Graphwar Arena supports browser-owned BYOK human commanders and server-owned
AI-fill seats. The hosted layer is intentionally narrow: providers choose a
legal action during unattended duel resolution, humans do not submit manual
shots after launch, and models write mathematical expressions rather than
selecting precomputed candidates.

## Contract

1. The game creates a bare rules payload for the active turn.
2. The provider receives rules, map, unit positions, retained hand, swap count,
   command text, recent feedback, current hand functions, and legal actions.
   Shot actions include allowed target IDs and an output schema. They do not
   include local simulation score, hidden hit/miss prediction, or precomputed
   shot candidates.
3. The provider returns JSON:

```json
{
  "action": "shot",
  "targetId": "B2",
  "expression": "y=y0+dy*t+18*sin(pi*t)",
  "cardSlots": [1],
  "publicReason": "Selected a legal curve."
}
```

or:

```json
{
  "action": "swap_hand",
  "publicReason": "Need a different hand."
}
```

4. The server validates the action against the legal list, target IDs, function
   whitelist, expression parser, and collision simulation.
5. The auto-duel resolver executes the already-known legal shot or applies the
   legal hand swap without consuming the active shot turn.

Models write math expressions directly, but they cannot call functions outside
the current hand whitelist and cannot execute JavaScript or helper definitions.

## Hosted Server

`server/index.js` serves the static app and exposes:

- `GET /healthz`
- `GET /api/providers`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/session/status`
- `POST /api/match/join`
- `POST /api/match/:id/step`
- `POST /api/match/:id/auto-duel`
- `POST /api/simulations/league`
- `POST /api/agent/shot`

The provider execution endpoint calls the selected provider, normalizes its
JSON, validates the selected legal action, then returns the verified action to
the auto-duel resolver. The browser only watches the resulting frame stream and
rank settlement.

OpenAI-compatible providers use structured JSON responses. OpenRouter defaults to
`openrouter/free` and is the default model for AI-filled ally/rival seats when
`OPENROUTER_API_KEY` is available on the server. If a required provider key is
missing or a provider call fails, the server returns an error rather than
silently falling back. Provider adapters do not impose a small hidden output
budget; provider-native limits and the global request timeout still apply.

The UI fetches current model lists with the browser key and stores the selected
provider/model plus key locally. Account persistence contains provider/model
metadata only. During human-v-human play, `/step` accepts a key only from the
browser controlling the active team; the other browser receives a waiting
response and cannot spend that key.

Every ranked match uses the server-owned 24-action cap. Elimination resolves
immediately; the action cap resolves by remaining team HP. Repeated settlement
is idempotent, so replaying a resolved room cannot spend provider quota or apply
rank twice.

## Railway

The server listens on `HOST` and `PORT`. Railway deployments should use
`HOST=0.0.0.0` and Railway's injected `PORT`.

## Providers

The catalog includes OpenRouter, OpenAI, DeepSeek, MiniMax, Zhipu, and
Anthropic. OpenRouter, OpenAI, DeepSeek, MiniMax, and Zhipu use the
OpenAI-compatible adapter shape. Anthropic uses the Messages adapter shape.

AI-filled opponent commanders use one short default standing order shared by
both agents on that team, so B1 and B2 act like a single simulated player rather
than three separate filler seats.

## Real Provider Smoke

Set `DEEPSEEK_API_KEY` and run:

```sh
npm run test:real:deepseek
```

This is intentionally separate from `npm test` because it spends real provider
quota and depends on network availability.

Set `OPENROUTER_API_KEY` and run:

```sh
npm run test:real:openrouter
```

`OPENROUTER_MODELS` accepts a comma-separated model list for model ranking
experiments. `OPENROUTER_SMOKE_TIMEOUT_MS` controls the per-call timeout. The
script exits non-zero when every tested model fails, but still prints a JSON
summary with latency, HTTP status, timeout, and validation error details.
