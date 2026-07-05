const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
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
}

function testGameGradeHudStylesExist() {
  assert.ok(css.includes(".commander-board"), "CSS should style the commander board");
  assert.ok(css.includes(".model-war-feed"), "CSS should style the model war feed");
  assert.ok(css.includes(".arena-stage"), "CSS should frame the battlefield as the primary game stage");
}

function testUiSubmitsRankedActionsToServer() {
  assert.ok(main.includes("submitMatchAction"), "UI should centralize ranked action submission");
  assert.ok(main.includes("/action"), "ranked reroll and shot actions should be posted to the match action endpoint");
}

testCommanderBoardIsAFirstClassSurface();
testModelWarFeedIsVisibleInSource();
testGameGradeHudStylesExist();
testUiSubmitsRankedActionsToServer();

console.log("ui-source tests passed");
