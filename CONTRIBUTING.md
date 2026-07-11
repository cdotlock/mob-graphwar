# Contributing

Mob Graphwar is early. Keep changes small, deterministic, and easy to replay.

## Development

```sh
npm test
npm start
```

Use `npm run dev` for source development. Use `npm run build && npm start` to
verify the production bundle.

## Project Rules

- Do not add movement, fog of war, scouting, or reward drafts to the core demo
  without a design update.
- Let models write mathematical expressions, but never executable JavaScript.
- Keep ranked settlement server-authoritative and capped at 24 actions.
- Keep player provider keys browser-local and out of persistence, logs, traces,
  fixtures, and screenshots.
- Add tests for deterministic mechanics and provider contracts.
- Keep traces free of secrets.
