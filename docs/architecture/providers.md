# Provider Architecture

The current game defaults to the deterministic local agent. Hosted provider
support is intentionally a thin optional layer.

## Contract

1. The game creates a bounded list of legal shot candidates.
2. The provider receives compact battle state, command text, and candidate IDs.
3. The provider returns JSON:

```json
{
  "candidateId": "A-3-0-B2-card.card",
  "publicReason": "High clearance over the central wall."
}
```

4. The server validates `candidateId` against the legal list.
5. The game executes the already-known legal candidate.

Models never output arbitrary functions, JavaScript, or card IDs that were not
offered by the game.

## Hosted Server

`server/index.js` serves the static app and exposes:

- `GET /healthz`
- `GET /api/providers`
- `POST /api/agent/shot`

The provider execution endpoint currently returns `501` until live provider
calls are enabled. This keeps the offline game stable while the contract is
reviewed.

## Railway

The server listens on `HOST` and `PORT`. Railway deployments should use
`HOST=0.0.0.0` and Railway's injected `PORT`.

## Providers

The catalog includes OpenAI, DeepSeek, MiniMax, Zhipu, and Anthropic. OpenAI,
DeepSeek, MiniMax, and Zhipu use the OpenAI-compatible adapter shape.
Anthropic uses the Messages adapter shape.
