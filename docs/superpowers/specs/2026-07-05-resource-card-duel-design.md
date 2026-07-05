# Mob Graphwar Resource Card Duel Design

Date: 2026-07-05

## Product Goal

Mob Graphwar is a two-player AI command game inspired by Graphwar. Players do
not directly write functions. Before the first shot, each player may write one
short battle order for their AI, or leave the order blank and let the AI solve
from the visible environment. That order is locked for the whole battle; each
turn the AI receives the same order plus a new hand, energy value, shooter, map
state, and target state, then fires a single shot. There is no movement, fog,
scouting, counterspell phase, or reward drafting in this prototype.

The point of the game is not to make math hard for an AI. A strong model can
usually find a function through any passable field. The point is to make the AI
operate inside a compact card economy and a hard generated map, so human
wording, card luck, model interpretation, map shape, and risk appetite produce
visible differences.

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
3. Before the first shot, both players may write one 80-character battle order.
4. The first lock-in freezes both battle orders for the rest of the battle.
5. On every turn, the AI interprets the locked order against the current hand,
   energy, shooter, map, and living targets, then produces one shot. A blank
   order is valid. The player cannot revise the current battle.
6. The UI reveals the AI's concise thinking trace:
   - interpreted intent
   - target priority
   - hand constraints
   - selected combo
   - risk note
7. The shot animates along the generated curve.
8. The result is logged: hit, ally hit, blocked, ground, out, or miss.

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

Energy starts at 4, caps at 8, and increases slowly. A shot can use at most
three cards: two shape/control cards plus one modifier. This keeps rules
readable while allowing card-battler-style payoff.

## Randomness

All randomness is seeded. The same seed and commands must reproduce the same
map, hands, trace, outcome, rank, and event list.

Per-turn hand generation:

- Use a team-specific deterministic 24-card deck generated from the seed.
- Shuffle using `seed + team + turn`.
- Draw 4 cards.
- Repair the hand if needed so at least two non-modifier shape cards are
  available.
- No persistent deck mutation in this prototype, so replay is simple.

Map generation:

- Pick one of several hard layouts by seed.
- Add base obstacles plus procedural obstacles, targeting 5-8 total blockers.
- Include multiple tall obstructions and at least one elevated shelf/floater
  that punishes mid-height shots.
- Do not expose route windows, golden gates, target lanes, or map-fit hints.
- Position units so direct fire is usually blocked.
- Keep all units above ground and targetable with some available finite card
  combos. The generator should avoid impossible maps, but it does not need to
  show the player the intended solution.

## AI Decision Model

The local AI is deterministic and transparent. It is not a real LLM yet.

The player order is battle-level, not turn-level. This makes the AI feel more
autonomous: it can keep obeying, overfitting, or creatively interpreting the
same instruction as the tactical state changes. The player may also provide no
order at all; in that case, the AI receives only the environment, legal hand,
units, map, and target state. The difficulty should come from limited hands,
finite card combinations, hard terrain, model interpretation, and imperfect
language, not from asking the player to rewrite an optimal prompt every turn.

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
- no hidden route-window score. Clean hits, resource use, target pressure, and
  risk should explain the result.

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
- Middle command row: two battle-order boxes, editable only before the first
  shot of a battle.
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
and provider catalog are present and documented. Model selection must not be
limited to one API key or one default model: the UI and server should keep a
provider id plus an editable model string in the request.

## Future Multiplayer And Simulation Direction

This stage keeps the battle local, but the intended online game is:

- simple login so rank and match history can be attached to a player
- 2v2 matchmaking where each human controls one AI
- no communication between the two teammate AIs inside a match
- AI-filled teammate or opponent seats when matchmaking cannot fill a lobby
- rank points gained or lost from match outcome and quality
- rank-aware matchmaking once enough players or model bots exist
- model selection per controlled AI, including provider and model name
- simulation API for automated model-vs-model and prompt-vs-prompt ladders

The simulation API should accept seeded match parameters, provider/model
configuration, player prompts, and bot fill policy, then return a deterministic
trace and rank delta. This lets us run many automated matches and observe which
models or prompt styles climb fastest.

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
- Default battle-order boxes are empty.
- Each turn is one-shot: once run, no candidate revision phase appears.
- The event inspector shows AI thinking trace for the selected shot.
- The card system has richer cards and tags beyond six function templates.
- Maps are generated from seed and are harder than the initial fixed map.
- Maps do not expose route windows or map-fit hints.
- Finished battles show numeric score and rank.
- Same seed and commands reproduce identical exported traces.
- Tests cover determinism, resource validation, command parsing, generated map
  validity, rank scoring, and trace shape.
- The UI is polished enough to be judged as a game prototype, not a debugger.
