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

function testGameModeShellMakesProductFeelLikeGame() {
  assert.ok(main.includes("GameModeNav"), "app should expose a named spectator game navigation shell");
  assert.ok(main.includes('data-testid="game-mode-nav"'), "spectator nav should be selectable for browser verification");
  assert.ok(main.includes('data-testid="mobile-mode-nav"'), "mobile spectator nav should be selectable for browser verification");
  assert.ok(main.includes("Spectator deck"), "mode nav should frame the game as watch-only after launch");
  assert.ok(main.includes("Launch"), "mode nav should include the ranked launch entry");
  assert.ok(main.includes("Watch"), "mode nav should include the battle watch view");
  assert.ok(main.includes("Intel"), "mode nav should include the model/card intel view");
  assert.ok(main.includes("Ladder"), "mode nav should include rank progression");
  assert.ok(main.includes("data-game-section=\"launch\""), "ranked login/matchmaking should be addressable as the launch section");
  assert.ok(main.includes("data-game-section=\"watch\""), "battlefield should be addressable as the watch section");
  assert.ok(main.includes("data-game-section=\"intel\""), "hand/rules should be addressable as the intel section");
  assert.ok(main.includes("data-game-section=\"ladder\""), "leaderboard should be addressable as the ladder section");
  assert.ok(main.includes('useState("watch")'), "the battle watch view should be the default active mode");
  assert.ok(css.includes(".game-mode-nav"), "CSS should style the top game mode navigation");
  assert.ok(css.includes(".mode-tab"), "CSS should style game mode tabs");
  assert.ok(css.includes(".mobile-mode-nav"), "CSS should style mobile mode navigation");
  assert.ok(css.includes("padding-bottom: 142px"), "mobile layout should reserve room for stacked game docks");
}

function testHeroOrnamentStaysBounded() {
  assert.ok(css.includes(".brand-zone::after"), "hero should keep the game-mode ornament in CSS");
  assert.ok(!css.includes("right: -90px"), "hero ornament should not bleed across the title and rank chip");
  assert.ok(css.includes("max-width: 42%"), "hero ornament should have a bounded desktop width");
  assert.ok(css.includes("z-index: 0"), "hero ornament should sit behind readable hero copy");
}

function testArenaDirectorHudMakesBattleReadAsLiveGame() {
  assert.ok(main.includes("ArenaDirectorHud"), "battle stage should include a named arena director HUD");
  assert.ok(main.includes('data-testid="arena-director-hud"'), "arena director HUD should be selectable for browser verification");
  assert.ok(main.includes("battleStats"), "HUD should compute battle stats from real events");
  assert.ok(main.includes("currentActorLabel"), "HUD should expose the active or last AI actor");
  assert.ok(main.includes("rankDelta"), "HUD should surface ranked stake after auto duel settlement");
  assert.ok(main.includes("routePressure"), "HUD should expose map route pressure in the game chrome");
  assert.ok(main.indexOf("<ArenaDirectorHud") < main.indexOf("<Battlefield"), "director HUD should appear before the battlefield inside the stage");
  assert.ok(css.includes(".arena-director-hud"), "CSS should style the director HUD as first-class game chrome");
  assert.ok(css.includes(".director-callout"), "CSS should style the live actor callout");
  assert.ok(css.includes(".director-rank-stake"), "CSS should style ranked stake information");
  assert.ok(css.includes(".director-feed"), "CSS should style live model action feed");
}

function testProductionBundleUsesBoundedEntrypoints() {
  assert.ok(!packageJson.includes('"framer-motion"'), "production build should not carry framer-motion for lightweight HUD fades");
  assert.ok(!main.includes('from "framer-motion"'), "main UI should avoid the framer-motion barrel during production builds");
  assert.ok(main.includes("MotionSection"), "game HUD transitions should use local lightweight motion components");
  assert.ok(main.includes("MotionDiv"), "replayed feed transitions should use a local lightweight motion component");
  assert.ok(!main.includes('from "lucide-react"'), "main UI should not import the lucide-react barrel");
  assert.ok(
    main.includes("lucide-react/dist/esm/icons/play-circle.js"),
    "main UI should import only the icon modules it renders"
  );
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
  assert.ok(main.includes("standingOrder: login.standingOrder"), "ranked join should attach the launch-time standing order to the seat");
  assert.ok(main.includes("spectator-hud"), "battle surface should include a dedicated spectator HUD");
  assert.ok(main.includes("AI auto-battle"), "battle surface should state that models auto-battle after kickoff");
  assert.ok(main.includes("Watch-only after launch"), "launch bay should tell users the duel locks into spectator mode");
  assert.ok(main.includes("Spectator lock"), "matchmaking panel should expose the no-mid-duel-intervention rule");
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
  assert.ok(main.includes("SESSION_STORAGE_KEY"), "UI should persist an opaque session token instead of only a player id");
  assert.ok(main.includes("/api/session/me"), "UI should restore profile through the authenticated session endpoint");
  assert.ok(main.includes("Authorization"), "ranked client requests should send bearer authorization");
  assert.ok(main.includes("/api/profile/providers"), "logged-in users should update model keys without re-registering");
  assert.ok(main.includes("SessionStatusPanel"), "launch bay should include a named secure session status panel");
  assert.ok(main.includes('data-testid="session-status-panel"'), "secure session panel should be selectable for browser verification");
  assert.ok(main.includes("Secure session"), "account panel should visibly show session readiness");
  assert.ok(main.includes("Model vault"), "account panel should visibly show model-key readiness");
  assert.ok(main.includes("Account / Model Key"), "account panel should frame login as a persistent account");
  assert.ok(main.includes('data-testid="auth-mode-tabs"'), "auth mode control should be selectable for browser verification");
  assert.ok(main.includes("Handle"), "auth form should collect a stable player handle");
  assert.ok(main.includes("Password"), "auth form should collect a password");
  assert.ok(css.includes(".auth-mode-tabs"), "CSS should style the auth mode segmented control");
}

function testGameShowsRankedOnboardingAndProviderReadiness() {
  assert.ok(main.includes("RankedFlowPanel"), "launch bay should include a named ranked flow panel");
  assert.ok(main.includes('data-testid="ranked-flow-panel"'), "ranked flow should be selectable for browser verification");
  assert.ok(main.includes("ProviderReadinessGrid"), "account setup should expose a named provider readiness grid");
  assert.ok(main.includes('data-testid="provider-readiness-grid"'), "provider grid should be selectable for browser verification");
  assert.ok(main.includes("API key armed"), "provider setup should visibly distinguish keyed models from local fallback");
  assert.ok(main.includes("Quick AI Fill"), "matchmaking should expose AI fallback when humans are unavailable");
  assert.ok(css.includes(".ranked-flow-panel"), "CSS should style ranked onboarding as game chrome");
  assert.ok(css.includes(".provider-readiness-grid"), "CSS should style provider readiness");
}

function testRankedGameStatePanelMakesAutoBattleLoopReadable() {
  assert.ok(main.includes("RankedGameStatePanel"), "launch bay should include a named ranked game state panel");
  assert.ok(main.includes('data-testid="ranked-game-state-panel"'), "ranked game state panel should be selectable for browser verification");
  assert.ok(main.includes("Queue"), "ranked state panel should show the queue step");
  assert.ok(main.includes("Matched"), "ranked state panel should show the matched step");
  assert.ok(main.includes("Resolving"), "ranked state panel should show the auto-resolve step");
  assert.ok(main.includes("Rank settled"), "ranked state panel should show rank settlement");
  assert.ok(main.includes("filledByAi"), "ranked state panel should expose whether AI filled missing humans");
  assert.ok(main.includes("playerTeam"), "ranked state panel should expose the player's team assignment");
  assert.ok(main.includes("autoBattle?.rankDelta"), "ranked state panel should read rank delta from the auto duel result");
  assert.ok(css.includes(".ranked-game-state-panel"), "CSS should style ranked game state as first-class launch chrome");
  assert.ok(css.includes(".state-node"), "CSS should style the ranked state timeline nodes");
  assert.ok(css.includes(".team-assignment-grid"), "CSS should style team assignments for spectators");
  assert.ok(css.includes(".rank-settlement-card"), "CSS should style rank settlement as a visible result");
}

function testUiExposesBareRulesPacketForModels() {
  assert.ok(main.includes("RulesPacketPanel"), "UI should include a named bare-rules panel");
  assert.ok(main.includes('data-testid="rules-packet-panel"'), "rules packet should be selectable for browser verification");
  assert.ok(main.includes("rulesSnapshot"), "UI should derive a rules snapshot from live battle state");
  assert.ok(main.includes("legalActions"), "rules packet should expose legal action counts");
  assert.ok(main.includes("swap_hand"), "rules packet should show model-visible swap_hand vocabulary");
  assert.ok(main.includes("allyIds"), "rules packet should show model-visible ally ids");
  assert.ok(main.includes("opponentIds"), "rules packet should show model-visible opponent ids");
  assert.ok(css.includes(".rules-packet-panel"), "CSS should style the rules packet panel");
  assert.ok(css.includes(".rules-json-preview"), "CSS should style a compact rules JSON preview");
}

function testMobileHasGameDockForWatchOnlyLoop() {
  assert.ok(main.includes("MobileSpectatorDock"), "UI should include a mobile spectator dock");
  assert.ok(main.includes('data-testid="mobile-spectator-dock"'), "mobile dock should be selectable for browser verification");
  assert.ok(main.includes("ranked: profile ?"), "mobile dock should summarize ranked account state");
  assert.ok(main.includes("queue: queueState"), "mobile dock should summarize queue state");
  assert.ok(css.includes(".mobile-spectator-dock"), "CSS should style the fixed mobile spectator dock");
  assert.ok(css.includes("padding-bottom: 142px"), "mobile layout should reserve room for the fixed game dock");
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
  assert.ok(main.includes("solid-blockers"), "battlefield should show how many blockers are truly solid");
  assert.ok(main.includes("route-guides"), "battlefield should show pass-through route guide complexity");
  assert.ok(main.includes("solver-pressure"), "battlefield should show solver pressure for spectators");
  assert.ok(main.includes("swap-window"), "battlefield should show retained-hand swap-window solvability");
  assert.ok(main.includes("complexity.solverPressure"), "battlefield should read solver pressure from real map metadata");
  assert.ok(main.includes("complexity.swapWindowHitRate"), "battlefield should read swap-window hit rate from real map metadata");
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
  assert.ok(css.includes(".solver-pressure"), "CSS should style solver pressure as game difficulty chrome");
  assert.ok(css.includes(".swap-window"), "CSS should style swap-window solvability");
  assert.ok(css.includes(".route-guides"), "CSS should style pass-through route guide metadata");
  assert.ok(css.includes(".depth-fog"), "CSS should style battlefield depth fog");
  assert.ok(css.includes(".spectator-hud"), "CSS should style the spectator HUD");
  assert.ok(css.includes(".terrain-ridge"), "CSS should style layered terrain ridges");
  assert.ok(css.includes(".obstacle-facet"), "CSS should style faceted obstacle terrain");
  assert.ok(css.includes(".impact-burst"), "CSS should style the latest impact marker");
}

function testCommercialSpectatorPanelsExposeTopologyAndBareRules() {
  assert.ok(main.includes("MapTopologyScanner"), "battle stage should include a named commercial map topology scanner");
  assert.ok(main.includes('data-testid="map-topology-scanner"'), "map topology scanner should be selectable for browser verification");
  assert.ok(main.includes("topologyTags"), "topology scanner should read multi-chamber topology metadata");
  assert.ok(main.includes("straightLaneBreaks"), "topology scanner should expose direct-lane break pressure");
  assert.ok(main.includes("solidBandCoverage"), "topology scanner should expose distributed solid blocker coverage");
  assert.ok(main.includes("ModelRulesTicker"), "battle stage should include a named model rules ticker");
  assert.ok(main.includes('data-testid="model-rules-ticker"'), "model rules ticker should be selectable for browser verification");
  assert.ok(main.includes("No hidden prompt"), "rules ticker should visibly state the bare-rules model contract");
  assert.ok(main.includes("rulesDigest"), "rules ticker should read replayed rules digests from model action frames");
  assert.ok(main.includes("legalShotCount"), "rules ticker should expose legal shot count from the model rules packet");
  assert.ok(main.includes("handRetained"), "rules ticker should expose retained-hand state from the model rules packet");
  assert.ok(css.includes(".map-topology-scanner"), "CSS should style the topology scanner as game chrome");
  assert.ok(css.includes(".topology-lane-grid"), "CSS should style topology coverage metrics");
  assert.ok(css.includes(".model-rules-ticker"), "CSS should style the model rules ticker");
  assert.ok(css.includes(".rules-contract-pill"), "CSS should style bare-rules contract pills");
}

function testLiveModelTelemetryMakesAiDuelVisible() {
  assert.ok(main.includes("LiveModelTelemetryPanel"), "battle stage should include a named live model telemetry panel");
  assert.ok(main.includes('data-testid="live-model-telemetry"'), "live model telemetry should be selectable for browser verification");
  assert.ok(main.includes("model-signal-spine"), "telemetry should include a visible turn-order signal spine");
  assert.ok(main.includes("telemetry-seat-grid"), "telemetry should show all AI seats as active combatants");
  assert.ok(main.includes("telemetry-action-chip"), "telemetry should expose each model's latest action");
  assert.ok(main.includes("telemetry-provider"), "telemetry should expose provider/model identity during the duel");
  assert.ok(main.includes("telemetryReason"), "telemetry should derive a public model reason/result for spectators");
  assert.ok(main.includes("playback?.action"), "telemetry should follow replay frames, not just final state");
  assert.ok(css.includes(".live-model-telemetry"), "CSS should style live model telemetry as first-class game HUD");
  assert.ok(css.includes(".model-signal-spine"), "CSS should style the turn-order signal spine");
  assert.ok(css.includes(".telemetry-seat-grid"), "CSS should style the four-model telemetry grid");
  assert.ok(css.includes(".telemetry-action-chip"), "CSS should style model action chips");
}

function testBattleBroadcastPanelMakesAiVsAiReadable() {
  assert.ok(main.includes("BattleBroadcastPanel"), "battle stage should include a named broadcast panel for spectators");
  assert.ok(main.includes('data-testid="battle-broadcast-panel"'), "battle broadcast panel should be selectable for browser verification");
  assert.ok(main.includes("Model duel broadcast"), "broadcast should label the AI-vs-AI fight as the main event");
  assert.ok(main.includes("broadcast-shot-card"), "broadcast should show the current or latest shot as a card");
  assert.ok(main.includes("broadcast-lanes"), "broadcast should show both AI teams as opposing lanes");
  assert.ok(main.includes("broadcast-team-lane"), "broadcast should style each AI team lane");
  assert.ok(main.includes("broadcast-result"), "broadcast should expose the latest result as a game callout");
  assert.ok(main.includes("latestPath"), "broadcast should derive trajectory status from real battle paths");
  assert.ok(main.includes("latestEvent?.combo"), "broadcast should expose the model's function-card combo");
  assert.ok(main.includes("playback?.action"), "broadcast should follow replay frames during auto-duel playback");
  assert.ok(main.includes("match?.roster"), "broadcast should use the matched four-seat roster");
  assert.ok(css.includes(".battle-broadcast-panel"), "CSS should style the broadcast as first-class battle chrome");
  assert.ok(css.includes(".broadcast-shot-card"), "CSS should style the shot card");
  assert.ok(css.includes(".broadcast-lanes"), "CSS should style opposing AI lanes");
  assert.ok(css.includes(".broadcast-result"), "CSS should style the result callout");
}

function testDuelBroadcastScorebugMakesBattleReadableAtAGlance() {
  assert.ok(main.includes("DuelBroadcastScorebug"), "battle stage should include a named esports-style duel scorebug");
  assert.ok(main.includes('data-testid="duel-broadcast-scorebug"'), "scorebug should be selectable for browser verification");
  assert.ok(main.includes("teamBattleStats"), "scorebug should derive team stats from real battle events");
  assert.ok(main.includes("battleMomentum"), "scorebug should derive a readable momentum state from HP and event pressure");
  assert.ok(main.includes("damageRace"), "scorebug should expose damage race copy instead of only raw coordinates");
  assert.ok(main.includes("accuracy"), "scorebug should expose hit accuracy for each AI team");
  assert.ok(main.includes("recent-model-action"), "scorebug should include a recent model action ticker");
  assert.ok(main.includes("latestEvent?.damage"), "scorebug should surface recent damage from the latest event");
  assert.ok(main.includes("<DuelBroadcastScorebug"), "battle stage should render the scorebug component");
  assert.ok(
    main.indexOf("<DuelBroadcastScorebug") < main.indexOf("<CombatCinematicLayer"),
    "scorebug should appear before cinematic combat layers so the battle reads like a live game"
  );
  assert.ok(css.includes(".duel-broadcast-scorebug"), "CSS should style the duel scorebug");
  assert.ok(css.includes(".scorebug-team"), "CSS should style each team block inside the scorebug");
  assert.ok(css.includes(".momentum-track"), "CSS should style a visible momentum track");
  assert.ok(css.includes(".recent-model-action"), "CSS should style the recent model action ticker");
  assert.ok(css.includes(".damage-race"), "CSS should style damage-race metrics");
  assert.ok(
    css.includes(".duel-broadcast-scorebug {\n    grid-template-columns: repeat(2, minmax(0, 1fr));"),
    "mobile scorebug should collapse to a compact two-column broadcast strip instead of a tall one-column stack"
  );
  assert.ok(
    css.includes(".scorebug-team-stats span:nth-child(n+3)"),
    "mobile scorebug should hide low-priority team stats to keep the battlefield visible"
  );
}

function testCombatCinematicLayerMakesAiVsAiFeelLikeGame() {
  assert.ok(main.includes("CombatCinematicLayer"), "battle stage should include a named cinematic combat layer");
  assert.ok(main.includes('data-testid="combat-cinematic-layer"'), "cinematic combat layer should be selectable for browser verification");
  assert.ok(main.includes("AI STRIKE LANE"), "cinematic layer should frame the model duel as a strike lane");
  assert.ok(main.includes("MODEL LOCK"), "cinematic layer should show the active or latest model lock");
  assert.ok(main.includes("TARGET VECTOR"), "cinematic layer should show the target vector");
  assert.ok(main.includes("FUNCTION COMBO"), "cinematic layer should show the function-card combo as a game attack");
  assert.ok(main.includes("teamHealth(state, \"A\")"), "cinematic layer should derive Team A state from real health");
  assert.ok(main.includes("teamHealth(state, \"B\")"), "cinematic layer should derive Team B state from real health");
  assert.ok(main.includes("latestPath"), "cinematic layer should read real trajectory state");
  assert.ok(main.includes("playback?.action"), "cinematic layer should follow replay frames during auto-duel playback");
  assert.ok(css.includes(".combat-cinematic-layer"), "CSS should style the cinematic layer");
  assert.ok(css.includes(".cinematic-team-card"), "CSS should style competing AI team cards");
  assert.ok(css.includes(".cinematic-core"), "CSS should style the central versus/lock-on core");
  assert.ok(css.includes(".strike-vector-card"), "CSS should style attack telemetry as game chrome");
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
testGameModeShellMakesProductFeelLikeGame();
testHeroOrnamentStaysBounded();
testArenaDirectorHudMakesBattleReadAsLiveGame();
testProductionBundleUsesBoundedEntrypoints();
testStaticEntrypointLoadsSimBeforeReactBundle();
testUiKeepsRankedDuelSpectatorOnly();
testGameSurfacesMatchmakingAndLeagueSimulation();
testGameSurfacesPersistentProfileAndLeaderboard();
testGameSurfacesRealAccountAuth();
testGameShowsRankedOnboardingAndProviderReadiness();
testRankedGameStatePanelMakesAutoBattleLoopReadable();
testUiExposesBareRulesPacketForModels();
testMobileHasGameDockForWatchOnlyLoop();
testUiPollsQueuedMatchmakingRooms();
testBattlefieldReadsAsGameSurface();
testCommercialSpectatorPanelsExposeTopologyAndBareRules();
testLiveModelTelemetryMakesAiDuelVisible();
testBattleBroadcastPanelMakesAiVsAiReadable();
testDuelBroadcastScorebugMakesBattleReadableAtAGlance();
testCombatCinematicLayerMakesAiVsAiFeelLikeGame();
testUiExplainsRetainedHandsAndSwapAction();
testUiAutoStartsRankedAutoDuel();
testUiPlaysAutoDuelFramesInsteadOfJumpingToFinalState();
testSpectatorReplayHasWatchOnlyControls();
testBattlefieldIsPrioritizedBeforeSecondaryCommanderPanels();
testBattleHeaderDoesNotCallDrawAWin();

console.log("ui-source tests passed");
