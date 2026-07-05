# Mob Graphwar Resource Card Duel Design

Date: 2026-07-05

## Product Goal

Mob Graphwar is a two-player AI command game inspired by Graphwar. Players do
not directly write functions. Each turn they see a limited hand of function
cards, write one short command, lock it in, and then watch their AI fire a
single shot. There is no movement, fog, scouting, counterspell phase, or reward
drafting in this prototype.

The point of the game is not to make math hard for an AI. The point is to make
the AI operate inside a compact card economy, so human wording, card luck, map
shape, and risk appetite produce visible differences.

## Non-Goals

- No movement system.
- No fog of war or hidden enemy coordinates.
- No scouting action.
- No candidate function edit phase.
- No between-game reward cards yet.
- No direct arbitrary code or free-form function execution from a model.

## Core Turn Loop

1. A deterministic map is generated from the seed.
2. The active player sees their hand, energy, current units, and terrain.
3. The player has one command field with an 80-character limit.
4. After lock-in, the AI produces one shot. The player cannot revise it.
5. The UI reveals the AI's concise thinking trace:
   - interpreted intent
   - target priority
   - hand constraints
   - selected combo
   - risk note
6. The shot animates along the generated curve.
7. The result is logged: hit, ally hit, blocked, ground, out, or miss.

## Card System

Cards are not raw math templates; they are tactical shot ingredients. Every
card still maps to a deterministic component so the shot remains inspectable.

Card fields:

- `id`: stable card id
- `label`: UI name
- `family`: `lift`, `bend`, `wave`, `control`, `risk`, or `modifier`
- `cost`: energy cost
- `rarity`: `basic`, `common`, `rare`
- `tags`: short mechanical tags, such as `clearance`, `precision`, `volatile`
- `description`: player-facing text
- `component`: deterministic shot component id
- `amplitudes`: candidate amplitudes the AI can try
- `effect`: optional scoring modifier, such as precision bonus or volatility

The prototype should include about 18 cards, with a 12-card deck per team
sampled from a seeded starter pool. Cards should make different-looking curves:
high arcs, shelves, dives, bends, narrow threading, overcorrection, and risky
power boosts.

Energy starts at 4, caps at 8, and increases slowly. A shot can use at most two
cards. This keeps rules readable and makes hand variance matter.

## Randomness

All randomness is seeded. The same seed and commands must reproduce the same
map, hands, trace, outcome, rank, and event list.

Per-turn hand generation:

- Use a team-specific deterministic deck generated from the seed.
- Shuffle using `seed + team + turn`.
- Draw 5 cards.
- No persistent deck mutation in this prototype, so replay is simple.

Map generation:

- Pick one of several hard layouts by seed.
- Add 3-5 obstacles, including at least one tall central obstruction.
- Add an elevated block or slot that can punish mid-height shots.
- Position units so direct fire is usually blocked.
- Keep all units above ground and targetable with some available card combos.

## AI Decision Model

The local AI is deterministic and transparent. It is not a real LLM yet.

For each legal one- or two-card combo, it simulates candidate amplitudes and
scores the result using:

- strong reward for enemy hit
- penalty for ally hit
- penalty for blocked/ground/out
- distance-to-target penalty on misses
- command keyword influence:
  - high / over / 上缘 / 越塔 prefer high clearance
  - safe / 避 / 别误伤 penalize ally risk
  - aggressive / 收割 prefer damage and low HP targets
  - explicit target ids like `B2` or `A1` bias target selection
- card tag influence:
  - precision helps near misses
  - volatile improves damage but increases risk penalty
  - clearance helps high maps

The AI thinking trace is derived from this scoring and must not expose chain of
thought. It is a compact explanation of the selected inputs and outcome.

## Rank Score

Each finished battle receives a rank:

- `S`: decisive win with high remaining HP and few blocked shots
- `A`: win with reasonable efficiency
- `B`: win with heavy damage or many misses
- `C`: draw or low-quality win
- `D`: loss

Score formula:

- +600 for win, +250 for draw
- +sum allied remaining HP
- +35 per enemy hit
- -25 per blocked/ground/out/miss
- -45 per ally hit
- -6 per turn used
- +difficulty bonus from map layout

The UI should display numeric score and rank at the end.

## UI Direction

The page is the game surface, not a landing page. Use a dark tactical board
with tactile card controls and readable command panels.

Layout:

- Top command/status bar: seed, round, active team, score/rank.
- Left or center: large fixed-coordinate battlefield.
- Bottom: current hand as cards, with used cards highlighted after a shot.
- Right: shot inspector with AI thinking trace, expression, result, and log.

Visual style:

- Deep board background.
- Team A: electric blue.
- Team B: ember red.
- Accents: green/gold for resources and rank.
- Cards use compact tactical text and visible tags.
- Motion is simple: latest path draws in, hit ring pulses, cards press subtly.

Responsive:

- Desktop uses board + inspector side by side.
- Mobile stacks command, board, hand, inspector without overlapping text.

## LLM/API-Key Architecture

The offline deterministic AI remains the default. The future hosted version
adds an optional provider adapter layer:

- `src/providers/catalog.js`: provider metadata and model defaults.
- `src/providers/prompt.js`: prompt assembly from battle state, hand, and
  command.
- `src/providers/local-agent.js`: current deterministic AI wrapper.
- `src/providers/http-agent.js`: browser-to-server client for hosted play.
- `server/index.js`: minimal Railway-ready Node server.
- `server/providers/*.js`: OpenAI-compatible, Anthropic, DeepSeek, Minimax,
  and Zhipu request adapters.

Security:

- The browser may accept a user API key for local direct calls only when the
  provider supports browser CORS and the user explicitly opts in.
- Hosted Railway mode should proxy requests server-side. User keys are used
  only for the request and not persisted.
- Never log API keys or include them in exported traces.

The current implementation can ship without live LLM calls if the interfaces
and provider catalog are present and documented.

## Open Source Requirements

The repo should be ready for `cdotlock/mob-graphwar`:

- clear README with concept, run commands, scope, roadmap
- MIT or explicit project license
- contribution notes
- deterministic tests
- no secrets committed
- remote configured and pushed when GitHub access works

## Acceptance Criteria For This Stage

- The demo has no movement, fog, scouting, or reward draft.
- Every turn displays the current hand.
- Each turn is one-shot: once run, no candidate revision phase appears.
- The event inspector shows AI thinking trace for the selected shot.
- The card system has richer cards and tags beyond six function templates.
- Maps are generated from seed and are harder than the initial fixed map.
- Finished battles show numeric score and rank.
- Same seed and commands reproduce identical exported traces.
- Tests cover determinism, resource validation, command parsing, generated map
  validity, rank scoring, and trace shape.
- The UI is polished enough to be judged as a game prototype, not a debugger.
