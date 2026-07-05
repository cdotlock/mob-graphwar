# Provider Architecture

Mob Graphwar Arena supports local AI seats plus BYOK hosted providers. The
hosted layer is intentionally narrow: providers choose from legal actions
during auto-duel resolution; humans do not submit mid-duel ranked actions, and
models do not submit arbitrary functions.

## Contract

1. The game creates a bare rules payload for the active turn.
2. The provider receives rules, map, unit positions, retained hand, swap count,
   command text, and legal actions. Shot actions include target, cards, cost,
   combo identity, and expression. They do not include local simulation score or
   final hit/miss result.
3. The provider returns JSON:

```json
{
  "action": "shot",
  "candidateId": "A-3-0-B2-card.card",
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

4. The server validates the action against the legal list.
5. The auto-duel resolver executes the already-known legal shot or applies the
   legal hand swap without consuming the active shot turn.

Models never output arbitrary functions, JavaScript, or card IDs that were not
offered by the game.

## Hosted Server

`server/index.js` serves the static app and exposes:

- `GET /healthz`
- `GET /api/providers`
- `POST /api/session`
- `POST /api/match/join`
- `POST /api/match/:id/auto-duel`
- `POST /api/agent/shot`

The provider execution endpoint calls the selected provider, normalizes its
JSON, validates the selected legal action, then returns the verified action to
the auto-duel resolver. The browser only watches the resulting frame stream and
rank settlement.

OpenAI-compatible providers use JSON mode. DeepSeek defaults to
`deepseek-v4-flash`, caps output tokens for the candidate-selection response,
and disables thinking mode for this narrow JSON selection task.

The UI lets the player choose provider and model during session creation. A
user-supplied key is sent only with the provider request and is never returned
in session, provider, trace, or rank responses.

## Railway

The server listens on `HOST` and `PORT`. Railway deployments should use
`HOST=0.0.0.0` and Railway's injected `PORT`.

## Providers

The catalog includes OpenAI, DeepSeek, MiniMax, Zhipu, and Anthropic. OpenAI,
DeepSeek, MiniMax, and Zhipu use the OpenAI-compatible adapter shape.
Anthropic uses the Messages adapter shape.

## Real Provider Smoke

Set `DEEPSEEK_API_KEY` and run:

```sh
npm run test:real:deepseek
```

This is intentionally separate from `npm test` because it spends real provider
quota and depends on network availability.
