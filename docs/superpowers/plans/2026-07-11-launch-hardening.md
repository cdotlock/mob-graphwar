# Mob Graphwar Launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved secure, responsive, battlefield-first Mob Graphwar experience to Railway.

**Architecture:** Preserve the React/Vite and Node HTTP stack while separating UI responsibilities and making the server the sole ranked authority. User provider keys remain ephemeral request inputs owned by the browser; server-owned credentials are reachable only by the internal AI-fill path. The simulation remains deterministic and single-sourced.

**Tech Stack:** React 18, Vite 7, Node.js HTTP server, `node:test`-style script tests, Lucide React, Railway.

## Global Constraints

- User API keys exist only in browser storage and request memory; never persist, log, trace, or echo them on the server.
- Server-owned provider keys are internal AI-fill credentials only.
- Ranked matches always use exactly `MAX_MATCH_ACTIONS = 24` as the cap.
- One commander controls both teammates with one provider, one model, and one standing prompt.
- No energy, function cost, candidate function, or silent fallback mechanics may reappear.
- The visible expression is the exact expression validated and simulated by the server.
- Core Play UI has no page-level horizontal overflow at 390, 768, 1024, 1366, and 1440 CSS pixels.
- Use Chinese and English copy from one localization source; set `document.documentElement.lang` to the active locale.
- Keep commits atomic and push each verified slice to `origin/main`.

---

### Task 1: Lock Security And Ranked Authority With Tests

**Files:**
- Modify: `test/server.test.js`
- Modify: `test/agent-contract.test.js`
- Modify: `server/index.js`
- Modify: `.env.example`

**Interfaces:**
- Produces: `MAX_MATCH_ACTIONS = 24`, production environment validation, authenticated expensive routes, request-key redaction, idempotent settlement.

- [ ] Add failing tests proving production rejects the default/missing session secret, unauthenticated shot/league calls cannot use environment keys, ranked requests ignore `maxActions`, repeated settlement is idempotent, and persisted configuration contains no API key.
- [ ] Run `node test/server.test.js` and confirm each new assertion fails for the intended current behavior.
- [ ] Add minimal server guards, sanitizers, rate limiting, and ranked authority to pass the tests.
- [ ] Run `node test/server.test.js && node test/agent-contract.test.js` and confirm zero failures.
- [ ] Commit as `Secure ranked provider execution` and push `origin main`.

### Task 2: Make Session And Matchmaking State Truthful

**Files:**
- Modify: `server/index.js`
- Modify: `test/server.test.js`
- Modify: `src/main.jsx`
- Modify: `test/ui-source.test.js`

**Interfaces:**
- Consumes: `MAX_MATCH_ACTIONS`, authenticated provider execution.
- Produces: cookie-backed session endpoints, logout, human-first queue with bounded AI fill, single resolver and both-side settlement.

- [ ] Add failing integration tests for cookie session creation/current-user/logout, human-first queue, internal AI fill, and two-sided one-time rating settlement.
- [ ] Run `node test/server.test.js` and verify the new tests fail.
- [ ] Implement HttpOnly cookie helpers, remove passwordless ID session lookup, keep secrets out of provider persistence, and centralize match resolution.
- [ ] Replace client bearer-token assumptions with credentialed fetch and remove the manual Sync control.
- [ ] Run the focused server/UI tests and confirm they pass.
- [ ] Commit as `Make ranked sessions and settlement authoritative` and push.

### Task 3: Build The Responsive Game Shell

**Files:**
- Create: `src/lib/api.js`
- Create: `src/lib/i18n.js`
- Create: `src/components/AppShell.jsx`
- Create: `src/components/AuthModal.jsx`
- Create: `src/game/GameSetup.jsx`
- Create: `src/game/Battlefield.jsx`
- Create: `src/game/AgentThought.jsx`
- Create: `src/game/FunctionHand.jsx`
- Create: `src/pages/PlayPage.jsx`
- Create: `src/pages/LeaderboardPage.jsx`
- Create: `src/pages/ApiDocsPage.jsx`
- Modify: `src/main.jsx`
- Modify: `src/arena.css`
- Create: `test/ui-render.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: credentialed API client and server-owned match state.
- Produces: `AppShell`, `PlayPage`, `LeaderboardPage`, `ApiDocsPage`, and local-only `useLocalApiKey` behavior.

- [ ] Add a DOM test harness and failing rendered tests for local-only API keys, visible server errors, modal focus/Escape/restore behavior, active locale document language, and responsive navigation semantics.
- [ ] Run `node test/ui-render.test.js` and verify failures are caused by missing components/behavior.
- [ ] Extract focused components from `main.jsx`; make model/key/prompt controls authoritative and save metadata before queueing while sending the key only on provider calls.
- [ ] Implement the compact shell, desktop 3-column play grid, tablet drawers, mobile task tabs, compact result banner, exact expression/thought output, hand under battlefield, split leaderboard, and full-width API docs.
- [ ] Replace fake/pending cards, stale Lab wording, manual Sync, duplicate status panels, and guest win/loss language.
- [ ] Run UI tests and `npm run build`; fix all failures.
- [ ] Commit as `Rebuild the battlefield-first game interface` and push.

### Task 4: Remove Legacy And Duplicate Paths

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/arena.css`
- Delete: `public/src/sim-core.js`
- Delete: `scripts/sync-public-sim.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/architecture/providers.md`
- Modify: `test/ui-source.test.js`

**Interfaces:**
- Produces: one simulation source and documentation matching production behavior.

- [ ] Add/update tests so no test requires dead component names, legacy session endpoints, candidate IDs, energy/cost rules, or the public simulation duplicate.
- [ ] Verify focused tests fail before deleting the obsolete paths.
- [ ] Delete unreachable components and CSS, import `src/sim-core.js` directly through Vite, remove sync lifecycle scripts, and update all documentation and environment examples.
- [ ] Run `rg` scans for legacy mechanics, fallback language, duplicate session routes, and secret-like values; resolve every active-code hit.
- [ ] Run full tests and build.
- [ ] Commit as `Remove legacy Graphwar paths` and push.

### Task 5: Verify And Deploy

**Files:**
- Create: `docs/launch/2026-07-11-launch-checklist.md`
- Modify only if verification exposes a defect: covering source/test file.

**Interfaces:**
- Produces: reproducible launch evidence and verified production deployment.

- [ ] Run `npm test` and `npm run build` fresh and record exact results.
- [ ] Start the production build locally and verify 1440x900, 1366x768, 1024x768, 768x1024, and 390x844 screenshots plus `scrollWidth <= clientWidth`.
- [ ] Verify auth keyboard flow, local-key persistence boundary, model selection, matchmaking, AI fill, reasoning/expression display, result/rank delta, leaderboard, API docs, and bilingual switch.
- [ ] Run a whole-branch code and launch-risk review; fix Critical and Important findings with focused failing tests.
- [ ] Set required Railway secret/storage configuration without printing values, push final `main`, wait for deployment, and verify `/healthz` plus critical production paths.
- [ ] Commit launch evidence as `Document launch verification` and push.

