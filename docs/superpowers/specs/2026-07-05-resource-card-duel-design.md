# Mob Graphwar Current Game Design

Date: 2026-07-05
Updated: 2026-07-07

## Product Goal

Mob Graphwar is a watch-only AI command game inspired by Graphwar. A player
chooses a model, optionally writes one short standing order, enters A-vs-B
ranked matchmaking, and then watches models fight by writing math functions.

The product is not raw Graphwar solved directly by a script. The interesting
part is the model receiving a compact game-state packet, current function hand,
recent feedback, and imperfect human wording, then deciding whether to swap the
hand or write a function shot.

## Current Non-Goals

- No movement, fog, scouting, or hidden coordinates.
- No manual mid-duel control after launch.
- No energy, cost, draft, or card-count budget.
- No high-risk or high-damage function categories.
- No precomputed model-facing shot candidates.
- No silent local fallback for hosted provider failures.

## Match Structure

1. A deterministic 2D blob map is generated from the seed.
2. Team A has A1/A2 and Team B has B1/B2.
3. One commander controls both units on a team with one provider/model/prompt.
4. If no human opponent is available, the server may fill Team B with an
   OpenRouter free-model commander when configured.
5. Units act in rotating seat order: A1, B1, A2, B2, skipping dead units.
6. The duel continues until one team is eliminated.
7. Long automated runs use a resolution guard only to settle pathological loops
   by remaining HP for ranking.

## Hand And Function Rules

- Each active unit has a retained hand of 4 function cards.
- The hand persists after shots.
- The active unit may choose `swap_hand` up to 3 times before firing.
- `swap_hand` replaces the retained hand and does not consume the shot turn.
- Every card is shown as a mathematical expression, not a fantasy move name.
- The current hand is the function whitelist. Models may call only function
  names present in the current hand expressions.
- Numeric coefficients are free; cards limit function types, not amplitudes.
- Arithmetic, variables, constants, comparisons, and ternary expressions are
  allowed by the expression parser.

Allowed expression variables:

- `t`: normalized travel from 0 to 1
- `u`: horizontal travel distance
- `d`: shooter-target horizontal distance
- `x`: absolute board x
- `y0`: shooter y
- `y1`: target y
- `dy`: `y1 - y0`

The shot expression must be one absolute board-y expression, usually anchored
on `y0 + dy*t`.

## Model Contract

The model receives one JSON packet containing:

- objective and team
- active unit and visible units
- map metadata, obstacles, and bonus points
- current retained hand and available function names
- recent public shot feedback
- recent feedback for the active unit
- legal actions: `swap_hand` and/or `shot`
- output schema

The model returns JSON only:

```json
{
  "action": "shot",
  "targetId": "B2",
  "expression": "y=y0+dy*t+18*sin(pi*t)",
  "cardSlots": [1],
  "publicReason": "Use a sine lift over the center blockers."
}
```

or:

```json
{
  "action": "swap_hand",
  "targetId": "",
  "expression": "",
  "cardSlots": [],
  "publicReason": "Current hand has no useful lane."
}
```

The server validates target IDs, expression syntax, allowed functions, numeric
range, and collision outcome. It does not give the model hidden hit predictions
or a list of pre-solved curves.

## Map And Difficulty

Maps use seeded continuous blob obstacles rather than rectangular wall stacks.
The current target is readability with real pressure:

- blockers stay below 10 visible obstacles
- terrain forms continuous Graphwar-like silhouettes
- maps expose multiple possible lanes
- route bonus points are optional and must not spawn inside obstacles
- direct lines are often blocked, but swap windows should make maps solvable

Difficulty is tested by measuring first-hand hit rate, swap-window hit rate,
solver pressure, open lanes, blob coverage, and topology tags across seeds.

## Damage

Damage is based on hit quality and function commitment, not hidden risk classes.

Enemy hit damage:

```text
clamp(round(24 + proximityAccuracy * 20 + functionCommitment + routeDamage), 20, 72)
```

Ally hit damage:

```text
clamp(round(14 + proximityAccuracy * 8 + functionCommitment * 0.35), 8, 34)
```

Where:

- `proximityAccuracy` is 1.0 at the target center and falls toward 0.0 at the
  unit edge.
- `functionCommitment = clamp(functionCount * 4 + cardSlotsUsed * 2, 0, 18)`.
- `routeDamage = clamp(routeBonusValue * 0.4, 0, 12)`.

Precision metadata means a card is useful for fine correction or tight lanes.
It is not a direct damage bonus and not a required tactic.

## UI Direction

The Play screen should fit the core game into one dense view:

- left: account, provider, model, API key, prompt, idle rounds
- center: 2D battlefield and result banner
- right: active model thought, expression, result, and hand read
- secondary details in drawers, not always-open walls of text

The player should be able to answer three questions at a glance:

- Which team is winning?
- What function did the current model write?
- Why did that shot hit, miss, collide, or swap?

## Benchmark Direction

The benchmark path runs raw model-vs-model leagues through the same model
contract. Contestants are named as `<model> (raw)` when no standing prompt is
provided. Benchmark exports should include complete public action trajectories,
raw provider outputs, reasoning fields when available, failures, and rank table
updates.

## Acceptance Criteria

- Model prompts contain no API keys, local scores, hidden hit predictions, or
  precomputed shot IDs.
- Public UI and docs do not mention removed energy/cost/risk mechanics.
- Every shot displays the exact expression the model wrote.
- Finished battles show win/loss/draw clearly.
- Same seed and model decisions replay deterministically.
- Tests prove maps are non-trivial but solvable within swap windows.
