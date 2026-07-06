# Watch-First Product Redesign Design

## Problem

The current Mob Graphwar screen exposes login, model setup, matchmaking, replay, cards, rules packets, topology metrics, leaderboard, and simulation tools at the same time. The mechanics exist, but the product reads like a debug cockpit. Players cannot quickly answer five basic questions:

- Am I logged in?
- How do I start ranked play?
- Where are my model, prompt, cards, units, and enemies?
- What happened in the last shot?
- Which leaderboard am I competing on?

The current battlefield also looks pseudo-3D. Dense faceted cuboids, many labels, and topological metric chips obscure the actual 2D artillery problem: choose legal card-built trajectories through solid map regions without hitting allies.

## Product Decision

Mob Graphwar should become a watch-first ranked arena:

1. A player logs in through a modal, chooses a model/provider, and writes one standing order before queueing.
2. After matchmaking, the player watches the AIs resolve the full match without mid-fight input.
3. The battle view foregrounds a 2D map, four unit tokens, the active model's retained hand, team health, the latest trajectory, and the latest model decision.
4. Ranking is split by intent:
   - Commander Rank: player account Elo from ranked matches.
   - Model League: model-vs-model simulation leaderboard.
   - Prompt League: prompt performance under controlled model/seed sets.
   - Pair League: model + prompt combinations.

## Information Architecture

The top-level app has three primary tabs:

- Play: ranked queue, 2D battlefield, hand rack, replay controls, and compact match state.
- Leaderboard: commander ladder plus model, prompt, and pair league panels.
- Lab: simulation API and model league runner.

Logged-out users may view the leaderboard and the locked Play state, but starting ranked play opens the account/model modal. The login and provider form must not sit permanently in the page layout.

Secondary details should be drawers or compact panels instead of permanent columns:

- AI decision feed.
- Rules packet.
- Map topology diagnostics.
- Replay proof details.

## 2D Battlefield

The battlefield is a flat tactical map, not a pseudo-3D obstacle pile.

- Solid blockers render as filled 2D terrain polygons/rects.
- Route guide roles render as subtle dashed lanes or contour strokes.
- Unit tokens are large, labeled circles with team color and HP rings.
- Current and recent trajectories are the strongest visual lines on the map.
- The map header only shows a compact set of readable facts: map name, route count, high-arc pressure, ceiling lock, and swap hit rate.
- Per-obstacle text labels are removed from the default view.

## Ranked Flow

The player flow is:

1. Sign in or register through Account / Model Setup modal.
2. Pick provider/model/API key and set one standing order.
3. Join ranked with Wait for Humans or Quick AI Fill.
4. Watch the full auto-duel.
5. Review rank delta, replay frames, model decisions, and leaderboard movement.

The UI must keep this rule visible: one standing order before launch, then spectate.

## Leaderboards

The Leaderboard tab contains:

- Commander Ladder: real player account rank from resolved ranked matches.
- Model League: controlled simulation ranking by model identity.
- Prompt League: controlled simulation ranking by prompt hash/text.
- Pair League: controlled simulation ranking by model + prompt pair.

The initial implementation can use the existing `/api/simulations/league` result and clear placeholders for Prompt/Pair leagues, but it must expose the product distinction now.

## Implementation Scope

This slice changes the React UI and CSS only where practical, while preserving existing server APIs and simulation contracts:

- Keep `/api/auth/*`, `/api/match/*`, `/api/leaderboard`, and `/api/simulations/league`.
- Keep watch-only ranked auto-duel behavior.
- Keep OpenRouter as the default AI-fill provider.
- Do not add movement, fog of war, scouting, route windows, or arbitrary executable model code.

## Acceptance Criteria

- Login/model setup is opened through a modal and is not permanently visible in the main grid.
- Logged-out Play clearly blocks ranked start and routes users to the modal.
- Leaderboard is a top-level tab with commander/model/prompt/pair sections.
- Lab is a top-level tab for simulation API and league runner.
- The battle surface renders a flat 2D map with no faceted pseudo-3D obstacle polygons.
- Cards, players, active unit, latest decision, and rank outcome are visible in coherent game chrome.
- `npm test` and `npm run build` pass.
