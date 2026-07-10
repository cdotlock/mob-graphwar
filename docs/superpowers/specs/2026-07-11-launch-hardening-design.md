# Mob Graphwar Launch Hardening Design

**Date:** 2026-07-11
**Status:** Approved

## Product Goal

Ship a coherent ranked function-artillery game in which one human configures one model and one standing prompt for Team A, then watches that model control A1 and A2 against another commander controlling B1 and B2. The match must visibly be about models writing mathematical functions, not about deciphering a dashboard.

## Non-Negotiable Rules

- A user API key exists only in that user's browser. It is never persisted, encrypted, logged, or replayed by the server.
- The server-owned OpenRouter key is reserved for internal AI-fill opponents. Public agent and league endpoints may not spend it.
- Ranked games have a server-owned hard limit of 24 actions. Clients cannot lower or raise it.
- A match ends when one team is eliminated or after action 24; the surviving HP total breaks the cap result, with equal HP producing a draw.
- A commander controls both units on its team with one provider, one model, and one standing prompt.
- The model writes an exact mathematical expression each action. The current hand limits function families only; there is no energy or card-cost legality rule.
- Up to three hand swaps are available before each shot. The model decides whether to swap.
- Failed provider calls and invalid model decisions are explicit match errors. There is no silent local decision fallback.

## Information Architecture

### Global shell

Use a compact header containing the product name, Play, Leaderboard, API Docs, language, rank, and account. Remove the marketing hero. Signing in happens in an accessible modal; the account remains visible after sign-in.

### Play

The first viewport is the game:

- Left rail: provider, model, API key, standing prompt, hang-up game count, and one Random Match command.
- Center: map, units, trajectories, reward points, current function, result banner, and compact playback controls.
- Right rail: active model, actual returned reasoning when available, public explanation, exact expression, target, validation, collision, precision, and damage.
- Bottom of center: the current function-family hand with mathematical names and expressions.

Desktop at 1366x768 uses a 240-280px left rail, a flexible battlefield, and a 280-320px right rail. Tablet stacks setup/thought into drawers around the battlefield. Mobile uses a single-column task flow with Battlefield, Setup, Thought, and Hand tabs. No viewport may have horizontal page overflow.

### Leaderboard

Show two explicit ladders: ranked player/model/prompt combinations and verified Raw model baselines. Remove fabricated empty prompt/model panels. Every row exposes model, prompt provenance or `raw / no prompt / no reasoning`, games, win rate, rating, and replay access.

### API Docs

Use a full-width documentation surface with authentication, request schema, response schema, error semantics, rate limits, and examples. Remove any public try-it flow that could spend a server key.

## Session And Key Model

- Browser session identity is an HttpOnly, Secure in production, SameSite=Lax cookie.
- Production startup fails when `GRAPHWAR_SESSION_SECRET` is absent or uses the documented development default.
- The API key input is local browser state. Match requests may carry it to the provider execution endpoint for that request only; request bodies, errors, traces, and persistence must redact it.
- Provider configuration persisted on the server contains provider/model/prompt metadata only and never claims a key remains configured after restart.
- Logout clears the cookie and browser-local API key.

## Matchmaking And Settlement

- Random Match first queues for a human opponent for a short bounded window.
- If no human is available, the server creates one OpenRouter Free AI commander.
- One server resolver owns the complete match. A match lock and settlement marker make resolution idempotent.
- Both commanders are ranked in one atomic settlement. A client cannot submit a winner or action cap.
- Hang-up mode requeues only after the prior match is settled and renders progress per game.

## Operations And Data Safety

- Rate-limit expensive provider routes by session and IP.
- Production static serving fails closed if `dist/index.html` is absent and never exposes the repository root.
- Public traces contain sanitized reasoning and decisions only. Provider error bodies and secrets are not public.
- `/healthz` reports build, storage readiness, session-secret readiness, and AI-fill readiness without returning secret values.
- Railway uses a mounted persistent data path and a strong session secret.

## Code Structure

Split the monolithic React file by responsibility: API/session utilities, localization, shell/navigation, play setup, battlefield, thought panel, hand rack, leaderboard, API docs, and auth modal. Keep simulation logic in one source module imported by both client and server; remove the tracked public duplicate and synchronization script.

## Acceptance Criteria

- No user key appears in server persistence, benchmark artifacts, logs, public traces, or API responses.
- An unauthenticated request cannot invoke a paid/server-owned model route.
- A forged token signed with the historical development secret is rejected in production.
- Ranked `maxActions` supplied by a client is ignored and the match uses 24.
- Duplicate resolve/settle requests return the same result and do not change rating twice.
- Model choice shown in the Play rail is the model the resolver actually uses.
- Provider errors and invalid expressions are visible in the game UI.
- Play fits without horizontal scrolling at 1440x900, 1366x768, 1024x768, 768x1024, and 390x844.
- Keyboard focus is trapped in the auth modal and restored when it closes.
- `npm test` and `npm run build` pass before deployment; production health and critical paths pass after deployment.

