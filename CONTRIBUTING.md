# Contributing

Mob Graphwar is early. Keep changes small, deterministic, and easy to replay.

## Development

```sh
npm test
npm start
```

The static app also works by opening `index.html` directly.

## Project Rules

- Do not add movement, fog of war, scouting, or reward drafts to the core demo
  without a design update.
- Do not let LLM providers output arbitrary functions or executable code.
- Add tests for deterministic mechanics and provider contracts.
- Keep traces free of secrets.
