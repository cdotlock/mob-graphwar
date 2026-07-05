# AI Graphwar Demo

This is a minimal prototype for a Graphwar-like AI game.

The important rule is that AI players do not get to write arbitrary functions.
Each turn they draw a small hand of function resource cards and must build a
shot from those cards only. The human command is intentionally short, so the
interesting part is the interface between a player intent and the AI's limited
math toolkit.

## Run

Open `index.html` in a browser.

For a smoke test:

```sh
npm test
```

## Current Scope

- No fog of war.
- No movement.
- No scouting.
- Two deterministic AI agents fight using limited function resources.
- The page shows the trajectory, current hand, expression, event log, and trace
  export.

## Next Prototype Questions

- Is the card hand restrictive enough to make shots visibly different?
- Do short human commands produce meaningfully different choices?
- Are misses understandable from the trajectory and event log?
- Should movement become a card effect later, instead of a full tactical layer?
