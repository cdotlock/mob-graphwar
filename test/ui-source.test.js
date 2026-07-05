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

function testGameSurfacesMatchmakingAndLeagueSimulation() {
  assert.ok(main.includes("LeagueLab"), "UI should expose a model league simulation panel");
  assert.ok(main.includes('data-testid="league-lab"'), "league lab should be selectable for browser verification");
  assert.ok(main.includes("queueSize"), "ranked lobby should surface matchmaking queue state");
  assert.ok(css.includes(".league-lab"), "CSS should style the model league simulation panel");
  assert.ok(css.includes(".queue-strip"), "CSS should style the ranked queue state");
}

function testGameSurfacesPersistentProfileAndLeaderboard() {
  assert.ok(main.includes("restoreProfile"), "UI should restore a persisted ranked profile");
  assert.ok(main.includes("LeaderboardPanel"), "UI should expose a ranked leaderboard panel");
  assert.ok(main.includes('data-testid="leaderboard-panel"'), "leaderboard should be selectable for browser verification");
  assert.ok(css.includes(".profile-vault"), "CSS should style the profile persistence surface");
  assert.ok(css.includes(".leaderboard-panel"), "CSS should style the ranked leaderboard panel");
}

function testUiPollsQueuedMatchmakingRooms() {
  assert.ok(main.includes("pollMatchmaking"), "UI should poll queued ranked players into matched rooms");
  assert.ok(main.includes("/api/matchmaking/"), "UI should call the matchmaking status endpoint");
  assert.ok(main.includes("/api/match/"), "UI should be able to fetch an active match room");
  assert.ok(css.includes(".sync-strip"), "CSS should style room sync and polling state");
}

function testBattlefieldReadsAsGameSurface() {
  assert.ok(main.includes("BattlefieldBackdrop"), "battlefield should have a named layered backdrop component");
  assert.ok(main.includes("renderObstacleFacets"), "battlefield should render obstacles as faceted terrain, not plain blocks");
  assert.ok(main.includes('data-testid="battlefield-frame"'), "battlefield should expose a framed game-stage surface");
  assert.ok(main.includes('data-testid="map-intel-strip"'), "battlefield should expose map complexity and pressure metadata");
  assert.ok(main.includes("impact-burst"), "battlefield should mark the latest shot impact");
  assert.ok(css.includes(".battlefield-frame"), "CSS should frame the battlefield as a game viewport");
  assert.ok(css.includes(".map-intel-strip"), "CSS should style map difficulty intel");
  assert.ok(css.includes(".terrain-ridge"), "CSS should style layered terrain ridges");
  assert.ok(css.includes(".obstacle-facet"), "CSS should style faceted obstacle terrain");
  assert.ok(css.includes(".impact-burst"), "CSS should style the latest impact marker");
}

function testUiOffersOneClickRankedAutoDuel() {
  assert.ok(main.includes("runAutoDuel"), "UI should expose a one-click ranked auto-duel action");
  assert.ok(main.includes("/auto-duel"), "UI should call the ranked auto-duel endpoint");
  assert.ok(main.includes("AutoDuelPanel"), "UI should show the auto-duel result as a named game panel");
  assert.ok(main.includes('data-testid="auto-duel-panel"'), "auto-duel panel should be selectable for browser verification");
  assert.ok(main.includes("autoBattle"), "UI should preserve the server battle summary");
  assert.ok(css.includes(".auto-duel-panel"), "CSS should style the auto-duel battle result panel");
  assert.ok(css.includes(".auto-duel-summary"), "CSS should style auto-duel summary stats");
}

testCommanderBoardIsAFirstClassSurface();
testModelWarFeedIsVisibleInSource();
testGameGradeHudStylesExist();
testUiSubmitsRankedActionsToServer();
testGameSurfacesMatchmakingAndLeagueSimulation();
testGameSurfacesPersistentProfileAndLeaderboard();
testUiPollsQueuedMatchmakingRooms();
testBattlefieldReadsAsGameSurface();
testUiOffersOneClickRankedAutoDuel();

console.log("ui-source tests passed");
