# Watch-First Product Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Mob Graphwar from a flat debug cockpit into a watch-first ranked arena with modal account setup, top-level Play/Leaderboard/Lab tabs, a flat 2D battlefield, and clearer leaderboard categories.

**Architecture:** Keep the existing React/Vite app and Node server APIs. Reorganize `src/main.jsx` around top-level product modes, move account/model setup into a modal, reuse existing match and league API calls, and replace the pseudo-3D battlefield layer with 2D map layers. Use source-level UI tests to lock the new product surfaces before editing production UI.

**Tech Stack:** React 18, Vite, Node/CommonJS tests, SVG battlefield, existing lucide icon module imports.

## Global Constraints

- Keep ranked battles watch-only after the launch standing order.
- Keep OpenRouter `openrouter/free` as the default AI-fill model.
- Do not add movement, fog of war, scouting, route windows, or arbitrary executable provider code.
- Preserve existing server endpoints unless a test proves an API contract gap.
- Use TDD for behavior/source assertions before production UI edits.
- Keep commits atomic and push the branch after each coherent slice.

---

### Task 1: Lock Product Shell Expectations

**Files:**
- Modify: `test/ui-source.test.js`

**Interfaces:**
- Consumes: `src/main.jsx` source text and `src/arena.css` source text.
- Produces: source assertions for `ProductTabs`, `AuthModal`, `LeaderboardView`, `LabView`, and a modal-driven login flow.

- [ ] **Step 1: Add failing source tests**

Add tests asserting:

```js
assert.ok(main.includes("ProductTabs"), "app should expose top-level Play, Leaderboard, and Lab tabs");
assert.ok(main.includes("AuthModal"), "account and model setup should live in a modal");
assert.ok(!main.includes("<LoginCard login={login}"), "login card should not be rendered directly in the always-visible layout");
assert.ok(main.includes("LeaderboardView"), "leaderboards should be a named top-level view");
assert.ok(main.includes("Model League"), "leaderboard should distinguish model competition");
assert.ok(main.includes("Prompt League"), "leaderboard should distinguish prompt competition");
assert.ok(main.includes("Pair League"), "leaderboard should distinguish model plus prompt competition");
assert.ok(main.includes("LabView"), "simulation tooling should be a named top-level lab view");
assert.ok(css.includes(".auth-modal-backdrop"), "CSS should provide modal scrim isolation");
assert.ok(css.includes(".product-tabs"), "CSS should style top-level product tabs");
```

- [ ] **Step 2: Run the red test**

Run: `node test/ui-source.test.js`

Expected: FAIL because the current app uses scroll sections and renders `LoginCard` directly in the launch bay.

- [ ] **Step 3: Implement the product shell**

In `src/main.jsx`, add:

```jsx
const [activeMode, setActiveMode] = useState("play");
const [authModalOpen, setAuthModalOpen] = useState(false);
```

Create `ProductTabs`, `AuthModal`, `PlayView`, `LeaderboardView`, and `LabView`. `LaunchBay` should receive `onOpenAuth` and render account/model summary plus CTA buttons, not the full form.

- [ ] **Step 4: Add shell CSS**

In `src/arena.css`, add `.product-tabs`, `.app-view-stack`, `.auth-modal-backdrop`, `.auth-modal`, `.leaderboard-view`, and `.lab-view`.

- [ ] **Step 5: Run green test**

Run: `node test/ui-source.test.js`

Expected: PASS.

### Task 2: Replace Pseudo-3D Battlefield With Flat 2D Map

**Files:**
- Modify: `test/ui-source.test.js`
- Modify: `src/main.jsx`
- Modify: `src/arena.css`

**Interfaces:**
- Consumes: `state.obstacles`, `state.paths`, `state.units`, and `state.mapMeta.complexity`.
- Produces: `FlatMapObstacleLayer`, `RouteGuideLayer`, and CSS classes for flat map rendering.

- [ ] **Step 1: Add failing source tests**

Add tests asserting:

```js
assert.ok(main.includes("FlatMapObstacleLayer"), "battlefield should use a flat 2D obstacle layer");
assert.ok(main.includes("RouteGuideLayer"), "battlefield should render route guides separately from solid blockers");
assert.ok(!main.includes("renderObstacleFacets"), "battlefield should not render pseudo-3D obstacle facets");
assert.ok(!main.includes("obstacleFacetPoints"), "battlefield should not compute cuboid facet points");
assert.ok(css.includes(".map-obstacle"), "CSS should style flat solid map obstacles");
assert.ok(css.includes(".route-guide"), "CSS should style route guides as lightweight map lines");
assert.ok(!css.includes(".obstacle-facet"), "CSS should not keep pseudo-3D obstacle faces");
assert.ok(!css.includes(".obstacle-cap"), "CSS should not keep pseudo-3D caps");
```

- [ ] **Step 2: Run the red test**

Run: `node test/ui-source.test.js`

Expected: FAIL because the current battlefield uses faceted obstacles.

- [ ] **Step 3: Implement flat map layers**

Replace `RouteMazeLayer` and `renderObstacleFacets` usage with:

```jsx
<RouteGuideLayer state={state} />
<FlatMapObstacleLayer state={state} />
```

Solid roles render as filled `<rect>` map obstacles. Guide roles render as dashed `<line>`/`<path>` overlays. Remove per-obstacle text labels from the default map.

- [ ] **Step 4: Add 2D map CSS**

Replace facet styles with flat terrain, obstacle, guide, trajectory, unit token, and impact styles.

- [ ] **Step 5: Run green test**

Run: `node test/ui-source.test.js`

Expected: PASS.

### Task 3: Tighten Ranked and League Copy

**Files:**
- Modify: `test/ui-source.test.js`
- Modify: `src/main.jsx`
- Modify: `src/arena.css`

**Interfaces:**
- Consumes: existing `leaderboard`, `leagueResult`, `runLeague`, `profile`, and `autoBattle` state.
- Produces: visible Commander Rank, Model League, Prompt League, and Pair League sections.

- [ ] **Step 1: Add failing source tests**

Add tests asserting copy for:

```js
"Commander Rank"
"Model League"
"Prompt League"
"Pair League"
"prompt hash"
"model + prompt"
"Start Ranked"
"Sign in to play ranked"
```

- [ ] **Step 2: Run the red test**

Run: `node test/ui-source.test.js`

Expected: FAIL until the new copy and sections exist.

- [ ] **Step 3: Implement leaderboard and locked-play views**

`LeaderboardView` renders `LeaderboardPanel` as Commander Rank plus three competition cards. `PlayView` shows a locked ranked CTA for guests and opens `AuthModal` instead of rendering form fields inline.

- [ ] **Step 4: Run green test**

Run: `node test/ui-source.test.js`

Expected: PASS.

### Task 4: Full Verification and Commit

**Files:**
- All modified files.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: verified, committed, pushed branch.

- [ ] **Step 1: Run source and server tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Run browser smoke**

Start: `npm start`

Open the local URL and verify:

- guest Play is locked behind account setup;
- Account / Model Setup opens as a modal;
- Leaderboard tab is separate;
- Lab tab is separate;
- battlefield obstacles are flat 2D shapes.

- [ ] **Step 4: Commit and push**

Run:

```bash
git add docs/superpowers/specs/2026-07-06-watch-first-product-redesign-design.md docs/superpowers/plans/2026-07-06-watch-first-product-redesign.md test/ui-source.test.js src/main.jsx src/arena.css
git commit -m "Redesign ranked arena product shell"
git push origin codex/resource-card-duel
```
