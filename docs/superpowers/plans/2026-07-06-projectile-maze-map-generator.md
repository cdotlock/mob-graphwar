# Projectile Maze Map Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace obstacle-pile difficulty with projectile-maze maps that force multiple shot route archetypes instead of always converging on high arcs.

**Architecture:** Keep the existing no-movement, watch-only Graphwar loop. Add deterministic projectile maze metadata and generated solid corridor walls inside `src/sim-core.js`, expose route diversity through `mapMeta.complexity`, and keep UI/tests reading the same public metadata shape.

**Tech Stack:** Node/CommonJS simulation core, React source UI, source-level tests with `node test/*.test.js`.

## Global Constraints

- Do not add movement, fog of war, scouting, route windows, `mapFit`, or arbitrary executable provider code.
- Keep maps deterministic by seed.
- Keep rules simple: models only choose `swap_hand` or a listed `shot`.
- Use TDD: failing tests before production code.
- Keep changes atomic and push the branch after verification.

---

### Task 1: Lock Projectile Maze Requirements

**Files:**
- Modify: `test/sim-core.test.js`

**Interfaces:**
- Consumes: `Sim.createInitialState({ seed })`
- Produces: assertions against `state.mapMeta.complexity.routeArchetypes`, `highArcDominance`, `routeEntropy`, `ceilingLock`, `requiredBendCount`, and maze-specific obstacle roles.

- [x] **Step 1: Write failing tests**

Add tests that require every sampled seed to expose at least three route archetypes, keep high arc dominance below 0.6, include projectile maze rooms/corridors, and include solid ceiling locks.

- [x] **Step 2: Run red test**

Run: `node test/sim-core.test.js`
Expected: FAIL because `routeArchetypes` and `highArcDominance` do not exist yet.

### Task 2: Generate Projectile Maze Obstacles

**Files:**
- Modify: `src/sim-core.js`

**Interfaces:**
- Produces: deterministic helper-generated obstacle roles `maze-room`, `maze-corridor-wall`, `ceiling-lock`, and `route-contour`.
- Produces complexity fields: `routeArchetypes`, `highArcDominance`, `routeEntropy`, `ceilingLock`, `requiredBendCount`.

- [x] **Step 1: Implement deterministic projectile maze helper**

Build a seed-driven chamber/corridor scaffold that creates ceiling caps, staggered chamber walls, and route contour guides without adding unit movement.

- [x] **Step 2: Update local solver scoring**

Reject or down-rank maps where high arcs dominate, where fewer than three route archetypes exist, or where ceiling lock is absent.

- [x] **Step 3: Run green tests**

Run: `node test/sim-core.test.js`
Expected: PASS.

### Task 3: Surface Maze Variety In UI

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/arena.css`
- Modify: `test/ui-source.test.js`

**Interfaces:**
- Consumes: `state.mapMeta.complexity.routeArchetypes`, `highArcDominance`, `routeEntropy`, `ceilingLock`.
- Produces: visible battlefield/map-topology metadata using route variety language.

- [x] **Step 1: Write failing UI source test**

Require route archetype, high arc dominance, entropy, and ceiling lock copy/classes.

- [x] **Step 2: Implement UI metadata**

Add compact map chips and topology scanner details without increasing mobile first-viewport height.

- [x] **Step 3: Run UI test**

Run: `node test/ui-source.test.js`
Expected: PASS.

### Task 4: Add OpenRouter Free AI Opponents

**Files:**
- Modify: `server/providers/catalog.js`
- Modify: `server/index.js`
- Modify: `src/main.jsx`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/architecture/providers.md`
- Modify: `test/provider-catalog.test.js`
- Modify: `test/server.test.js`
- Modify: `test/ui-source.test.js`

**Interfaces:**
- Adds provider id `openrouter` with default model `openrouter/free`.
- Uses OpenRouter free for AI-filled seats when `OPENROUTER_API_KEY` exists.
- Surfaces provider errors when OpenRouter is not configured; no silent local fallback.
- Adds distinct default standing orders for AI-filled ally/rival seats.

- [x] **Step 1: Write failing provider/server/UI tests**

- [x] **Step 2: Implement OpenRouter catalog/default AI seats**

- [x] **Step 3: Update UI defaults, simulation API example, and docs**

### Task 5: Verify, Commit, Push

**Files:**
- No code file changes beyond prior tasks.

- [x] **Step 1: Full verification**

Run: `npm test`
Run: `npm run build`
Run browser desktop/mobile checks against `http://127.0.0.1:3010/`.

- [ ] **Step 2: Commit and push**

Run:
```bash
git add .
git commit -m "Add projectile maze maps and OpenRouter opponents"
git push origin codex/resource-card-duel
```
