const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "arena.css"), "utf8");

function testCommanderBoardIsAFirstClassSurface() {
  assert.ok(main.includes('data-testid="commander-board"'), "UI should expose a dedicated AI commander board");
  assert.ok(main.includes('"team-a-commander"'), "UI should show Team A commander status");
  assert.ok(main.includes('"team-b-commander"'), "UI should show Team B commander status");
  assert.ok(main.includes("DuelCommanders"), "commander board should be implemented as a named component");
}

function testModelWarFeedIsVisibleInSource() {
  assert.ok(main.includes("ModelWarFeed"), "UI should include a visible model-vs-model feed");
  assert.ok(main.includes('data-testid="model-war-feed"'), "model war feed should be selectable for browser verification");
  assert.ok(main.includes("lastDecision"), "UI should keep latest model decision state visible");
  assert.ok(main.includes("ModelDecisionStack"), "UI should include a dedicated model decision stack");
  assert.ok(main.includes('data-testid="model-decision-stack"'), "model decision stack should be selectable for browser verification");
}

function testGameGradeHudStylesExist() {
  assert.ok(css.includes(".commander-board"), "CSS should style the commander board");
  assert.ok(css.includes(".model-war-feed"), "CSS should style the model war feed");
  assert.ok(css.includes(".arena-stage"), "CSS should frame the battlefield as the primary game stage");
  assert.ok(css.includes(".versus-banner"), "CSS should style a game-grade versus banner");
  assert.ok(css.includes(".battle-replay-rail"), "CSS should style an event replay rail");
  assert.ok(css.includes("grid-template-areas"), "responsive layout should prioritize the battlefield with grid areas");
}

function testStaticEntrypointLoadsSimBeforeReactBundle() {
  const head = indexHtml.match(/<head>[\s\S]*?<\/head>/i);
  assert.ok(head && head[0].includes("/src/sim-core.js"), "sim-core should load in head before Vite moves the React bundle");
  assert.ok(
    indexHtml.indexOf("/src/sim-core.js") < indexHtml.indexOf("/src/main.jsx"),
    "sim-core should appear before the React module entrypoint"
  );
}

function testUiKeepsRankedDuelSpectatorOnly() {
  assert.ok(!main.includes("submitMatchAction"), "ranked UI should not expose per-turn manual action submission");
  assert.ok(!main.includes("/action"), "ranked UI should not post reroll or shot actions during the duel");
  assert.ok(main.includes("After that, watch only."), "command console should frame the player as a spectator after kickoff");
  assert.ok(main.includes("spectator-hud"), "battle surface should include a dedicated spectator HUD");
  assert.ok(main.includes("AI auto-battle"), "battle surface should state that models auto-battle after kickoff");
}

function testGameSurfacesMatchmakingAndLeagueSimulation() {
  assert.ok(main.includes("LaunchBay"), "UI should expose a launch bay for login, key setup, and matchmaking");
  assert.ok(main.includes('data-testid="launch-bay"'), "launch bay should be selectable for browser verification");
  assert.ok(main.includes("LeagueLab"), "UI should expose a model league simulation panel");
  assert.ok(main.includes('data-testid="league-lab"'), "league lab should be selectable for browser verification");
  assert.ok