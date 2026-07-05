const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
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

function testFourSeatAgentBattleMatrixExists() {
  assert.ok(main.includes("AgentBattleMatrix"), "battle surface should include a named four-seat AI battle matrix");
  assert.ok(main.includes('data-testid="agent-battle-matrix"'), "agent matrix should be selectable for browser verification");
  assert.ok(main.includes('data-testid={`agent-seat-${seat.unitId}`}'), "each unit seat should expose a stable test id");
  assert.ok(main.includes("agent-hand-strip"), "each agent seat should surface the retained hand visible to its model");
  assert.ok(main.includes("agent-action-beam"), "agent seats should show the latest model action/reason as a game HUD element");
  assert.ok(main.includes("swapsRemaining"), "agent seats should expose retained-hand swap economy");
  assert.ok(main.includes("Sim.getCurrentHand(state, seat.unitId)"), "agent seats should read retained hands per AI unit, not per team");
  assert.ok(main.includes("state.hands?.[seat.unitId]"), "agent seats should read swap economy per AI unit");
  assert.ok(main.includes("activeUnitId"), "battle surface should track the active AI unit for watch-only play");
  assert.ok(css.includes(".agent-battle-matrix"), "CSS should style the four-seat battle matrix");
  assert.ok(css.includes(".agent-seat"), "CSS should style each AI seat card");
  assert.ok(css.includes(".agent-hand-strip"), "CSS should style per-agent retained hand chips");
  assert.ok(css.includes(".agent-action-beam"), "CSS should style latest agent action beams");
  assert.ok(css.includes(".agent-vitals"), "CSS should style per-agent HP and provider vitals");
}

function testGameGradeHudStylesExist() {
  assert.ok(css.includes(".commander-board"), "CSS should style the commander board");
  assert.ok(css.includes(".model-war-feed"), "CSS should style the model war feed");
  assert.ok(css.includes(".arena-stage"), "CSS should frame the battlefield as the primary game stage");
  assert.ok(css.includes(".versus-banner"), "CSS should style a game-grade versus banner");
  assert.ok(css.includes(".battle-replay-rail"), "CSS should style an event replay rail");
  assert.ok(css.includes("grid-template-areas"), "responsive layout should prioritize the battlefield with grid areas");
}

function testArenaDirectorHudMakesBattleReadAsLiveGame() {
  assert.ok(packageJson.includes('"framer-motion"'), "the React game shell should use a motion framework for game-grade state transitions");
  assert.ok(main.includes('from "framer-motion"'), "main UI should import framer-motion primitives");
  assert.ok(main.includes("ArenaDirectorHud"), "battle stage should include a named arena director HUD");
  assert.ok(main.includes('data-testid="arena-director-hud"'), "arena director HUD should be selectable for browser verification");
  assert.ok(main.includes("battleStats"), "HUD should compute battle stats from real events");
  assert.ok(main.includes("currentActorLabel"), "HUD should expose the active or last AI actor");
  assert.ok(main.includes("rankDelta"), "HUD should surface ranked stake after auto duel settlement");
  assert.ok(main.includes("routePressure"), "HUD should expose map route pressure in the game chrome");
  assert.ok(main.includes("<AnimatePresence"), "latest model action should animate as the feed changes");
  assert.ok(main.indexOf("<ArenaDirectorHud") < main.indexOf("<Battlefield"), "director HUD should appear before the battlefield inside the stage");
  assert.ok(css.includes(".arena-director-hud"), "CSS should style the director HUD as first-class game chrome");
  assert.ok(css.includes(".director-callout"), "CSS should style the live actor callout");
  assert.ok(css.includes(".director-rank-stake"), "CSS should style ranked stake information");
  assert.ok(css.includes(".director-feed"), "CSS should style live model action feed");
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
  assert.ok(!main.includes("CommandConsole"), "ranked battle surface should not include a mid-duel command console");
  assert.ok(!main.includes("Watch Auto Duel"), "ranked battle surface should not expose a manual duel-start button after matchmaking");
  assert.ok(!main.includes("Start Auto Duel"), "ranked launch bay should not require a manual auto-duel start after matchmaking");
  assert.ok(main.includes("standingOrder"), "pre-match setup should keep the one allowed human-to-AI instruction");
  assert.ok(main.includes("spectator-hud"), "battle surface should include a dedicated spectator HUD");
  assert.ok(main.includes("AI auto-battle"), "battle surface should state that models auto-battle after kickoff");
}

function testGameSurfacesMatchmakingAndLeagueSimulation() {
  assert.ok(main.includes("LaunchBay"), "UI should expose a launch bay for login, key setup, and matchmaking");
  assert.ok(main.includes('data-testid="launch-bay"'), "launch bay should be selectable for browser verification");
  assert.ok(main.includes("LeagueLab"), "UI should expose a model league simulation panel");
  assert.ok(main.includes('data-testid="league-lab"'), "league lab should be selectable for browser verification");
  assert.ok(main.includes("queueSize"), "ranked lobby should surface matchmaking queue state");
  assert.ok(css.includes(".launch-bay"), "CSS should style the game launch bay");
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

function testGameSurfacesRealAccountAuth() {
  assert.ok(main.includes("authMode"), "UI should distinguish register and sign-in modes");
  assert.ok(main.includes("/api/auth/register"), "UI should call the register endpoint");
  assert.ok(main.includes("/api/auth/login"), "UI should call the login endpoint");
  assert.ok(main.includes("Account / Model Key"), "account panel should frame login as a persistent account");
  assert.ok(main.includes('data-testid="auth-mode-tabs"'), "auth mode control should be selectable for browser verification");
  assert.ok(main.includes("Handle"), "auth form should collect a stable player handle");
  assert.ok(main.includes("Password"), "auth form should collect a password");
  assert.ok(css.includes(".auth-mode-tabs"), "CSS should style the auth mode segmented control");
}

function testUiPollsQueuedMatchmakingRooms() {
  assert.ok(main.includes("pollMatchmaking"), "UI should poll queued ranked players into matched rooms");
  assert.ok(main.includes("/api/matchmaking/"), "UI should call the matchmaking status endpoint");
  assert.ok(main.includes("/api/match/"), "UI should be able to fetch an active match room");
  assert.ok(css.includes(".sync-strip"), "CSS should style room sync and polling state");
}

function testBattlefieldReadsAsGameSurface() {
  assert.ok(main.includes("createExhibitionBattle"), "unmatched users should see a real AI-vs-AI exhibition battle");
  assert.ok(main.includes("VersusBanner"), "battlefield should include a named 2v2 versus banner component");
  assert.ok(main.includes('data-testid="versus-banner"'), "versus banner should be selectable for browser verification");
  assert.ok(main.includes("BattleReplayRail"), "battlefield should include a named battle replay rail component");
  assert.ok(main.includes('data-testid="battle-replay-rail"'), "battle replay rail should be selectable for browser verification");
  assert.ok(main.includes("BattlefieldBackdrop"), "battlefield should have a named layered backdrop component");
  assert.ok(main.includes("RouteMazeLayer"), "battlefield should render a named route maze layer above the backdrop");
  assert.ok(main.includes("renderObstacleFacets"), "battlefield should render obstacles as faceted terrain, not plain blocks");
  assert.ok(main.includes('data-testid="battlefield-frame"'), "battlefield should expose a framed game-stage surface");
  assert.ok(main.includes('data-testid="map-intel-strip"'), "battlefield should expose map complexity and pressure metadata");
  assert.ok(main.includes('data-testid="route-maze-layer"'), "route maze layer should be selectable for browser verification");
  assert.ok(main.includes("route-pressure"), "battlefield should show route pressure metadata");
  assert.ok(main.includes("battlefield-depth"), "battlefield should show layered route depth metadata");
  assert.ok(main.includes("maze-bands"), "battlefield should show maze band metadata");
  assert.ok(main.includes("gate-slits"), "battlefield should show gate slit metadata");
  assert.ok(main.includes("thread-slots"), "battlefield should show thread slot metadata");
  assert.ok(main.includes("impact-burst"), "battlefield should mark the latest shot impact");
  assert.ok(css.includes(".battlefield-frame"), "CSS should frame the battlefield as a game viewport");
  assert.ok(css.includes(".battle-priority-layout"), "CSS should include battle-priority layout rules");
  assert.ok(css.includes(".map-intel-strip"), "CSS should style map difficulty intel");
  assert.ok(css.includes(".route-pressure"), "CSS should style route pressure metadata");
  assert.ok(css.includes(".battlefield-depth"), "CSS should style battlefield depth metadata");
  assert.ok(css.includes(".route-maze-layer"), "CSS should style the route maze overlay layer");
  assert.ok(css.includes(".maze-band"), "CSS should style horizontal maze bands");
  assert.ok(css.includes(".gate-slit"), "CSS should style narrow gate slits");
  assert.ok(css.includes(".thread-slot"), "CSS should style thread slot guides");
  assert.ok(css.includes(".depth-fog"), "CSS should style battlefield depth fog");
  assert.ok(css.includes(".spectator-hud"), "CSS should style the spectator HUD");
  assert.ok(css.includes(".terrain-ridge"), "CSS should style layered terrain ridges");
  assert.ok(css.includes(".obstacle-facet"), "CSS should style faceted obstacle terrain");
  assert.ok(css.includes(".impact-burst"), "CSS should style the latest impact marker");
}

function testUiExplainsRetainedHandsAndSwapAction() {
  assert.ok(main.includes("Retained Hand"), "hand panel should use retained-hand game language");
  assert.ok(main.includes("Swap Hand x3"), "hand panel should explain the active model can swap hand up to three times");
  assert.ok(main.includes("swap_hand"), "model feed should surface the provider action vocabulary");
  assert.ok(!main.includes("choose rerolls and shots"), "model feed should not use old reroll wording");
}

function testUiAutoStartsRankedAutoDuel() {
  assert.ok(main.includes("autoStartRankedDuel"), "UI should auto-start ranked auto-duel after matchmaking");
  assert.ok(main.includes("/auto-duel"), "UI should call the ranked auto-duel endpoint");
  assert.ok(main.includes("AutoDuelPanel"), "UI should show the auto-duel result as a named game panel");
  assert.ok(main.includes('data-testid="auto-duel-panel"'), "auto-duel panel should be selectable for browser verification");
  assert.ok(main.includes("autoBattle"), "UI should preserve the server battle summary");
  assert.ok(css.includes(".auto-duel-panel"), "CSS should style the auto-duel battle result panel");
  assert.ok(css.includes(".auto-duel-summary"), "CSS should style auto-duel summary stats");
}

function testUiPlaysAutoDuelFramesInsteadOfJumpingToFinalState() {
  assert.ok(main.includes("battlePlayback"), "UI should keep battle playback state separate from final match state");
  assert.ok(main.includes("playAutoBattleFrames"), "UI should animate server-supplied auto duel frames");
  assert.ok(main.includes("payload.autoBattle?.frames"), "UI should consume replay frames returned by the auto duel endpoint");
  assert.ok(main.includes('data-testid="battle-playback"'), "battle playback HUD should be selectable for browser verification");
  assert.ok(main.includes("window.setTimeout"), "frame playback should advance visibly instead of jumping directly to the final state");
  assert.ok(css.includes(".battle-playback"), "CSS should style the battle playback HUD");
  assert.ok(css.includes(".playback-bar"), "CSS should style frame playback progress");
}

function testSpectatorReplayHasWatchOnlyControls() {
  assert.ok(main.includes("playbackDeck"), "UI should retain replay frames for spectator controls");
  assert.ok(main.includes("playbackPaused"), "UI should expose pause state for the replay loop");
  assert.ok(main.includes("playbackSpeed"), "UI should expose replay speed state");
  assert.ok(main.includes("stepPlayback"), "UI should allow stepping through already-resolved replay frames");
  assert.ok(main.includes("resumePlayback"), "UI should allow resuming replay without posting a gameplay action");
  assert.ok(main.includes("changePlaybackSpeed"), "UI should allow speed changes without changing battle rules");
  assert.ok(main.includes("Paused replay"), "paused playback should be labeled as paused, not live");
  assert.ok(main.includes('data-testid="playback-controls"'), "replay controls should be selectable for browser verification");
  assert.ok(main.includes('aria-label="Previous replay frame"'), "replay controls should expose a previous-frame button");
  assert.ok(main.includes('aria-label="Next replay frame"'), "replay controls should expose a next-frame button");
  assert.ok(main.includes('aria-label="Replay speed"'), "replay controls should expose speed choices");
  assert.ok(!main.includes('fetch(`/api/match/${match.id}/action`'), "replay controls must not submit server-side gameplay actions");
  assert.ok(css.includes(".playback-controls"), "CSS should style replay controls as game HUD controls");
  assert.ok(css.includes(".speed-strip"), "CSS should style replay speed choices");
}

function testBattlefieldIsPrioritizedBeforeSecondaryCommanderPanels() {
  assert.ok(
    main.indexOf("<Battlefield") < main.indexOf("<DuelCommanders"),
    "battlefield should render before secondary commander panels so the game map appears earlier"
  );
  assert.ok(css.includes(".mobile-game-compact"), "mobile CSS should include compact game-first rules");
  assert.ok(css.includes("grid-template-columns: repeat(3, minmax(0, 1fr));"), "mobile battle header should remain compact in a dense HUD grid");
  assert.ok(main.includes('!playback ? "idle"'), "empty playback HUD should expose an idle class for compact mobile layout");
  assert.ok(css.includes(".battle-playback.idle"), "mobile CSS should be able to hide idle playback chrome");
}

function testBattleHeaderDoesNotCallDrawAWin() {
  assert.ok(main.includes("resultLabel"), "battle header should compute a readable result label");
  assert.ok(main.includes('winner === "draw" ? "Draw"'), "draw results should be labeled as draws");
  assert.ok(!main.includes('`${state.winner} wins`'), "battle header should not render 'draw wins'");
}

testCommanderBoardIsAFirstClassSurface();
testModelWarFeedIsVisibleInSource();
testFourSeatAgentBattleMatrixExists();
testGameGradeHudStylesExist();
testArenaDirectorHudMakesBattleReadAsLiveGame();
testStaticEntrypointLoadsSimBeforeReactBundle();
testUiKeepsRankedDuelSpectatorOnly();
testGameSurfacesMatchmakingAndLeagueSimulation();
testGameSurfacesPersistentProfileAndLeaderboard();
testGameSurfacesRealAccountAuth();
testUiPollsQueuedMatchmakingRooms();
testBattlefieldReadsAsGameSurface();
testUiExplainsRetainedHandsAndSwapAction();
testUiAutoStartsRankedAutoDuel();
testUiPlaysAutoDuelFramesInsteadOfJumpingToFinalState();
testSpectatorReplayHasWatchOnlyControls();
testBattlefieldIsPrioritizedBeforeSecondaryCommanderPanels();
testBattleHeaderDoesNotCallDrawAWin();

console.log("ui-source tests passed");
