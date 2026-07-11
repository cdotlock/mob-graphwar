const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const main = read("src/main.jsx");
const app = read("src/App.jsx");
const css = read("src/app.css");
const html = read("index.html");
const pkg = JSON.parse(read("package.json"));

function testSingleSimulationSource() {
  const simAdapter = read("src/lib/sim.js");
  assert.ok(simAdapter.includes('import "../sim-core.js"'), "browser adapter should execute the single simulation source");
  assert.ok(app.includes('import { Sim } from "./lib/sim.js"'), "App should import the simulation adapter explicitly");
  assert.ok(!main.includes("sim-core.js"), "entrypoint should not depend on side-effect import order");
  assert.ok(!html.includes("/src/sim-core.js"), "HTML should not load a second public simulation copy");
  assert.ok(!fs.existsSync(path.join(root, "public/src/sim-core.js")), "tracked public simulation duplicate should be removed");
  assert.ok(!fs.existsSync(path.join(root, "scripts/sync-public-sim.js")), "duplicate synchronization script should be removed");
  assert.ok(!pkg.scripts["sync:public-sim"], "build scripts should not recreate the duplicate");
}

function testBrowserOwnsProviderKeys() {
  const localConfig = read("src/lib/local-config.js");
  assert.ok(localConfig.includes("LOCAL_PROVIDER_KEY"));
  assert.ok(localConfig.includes("providerMetadataPayload"));
  assert.ok(localConfig.includes("ephemeralProviderConfig"));
  assert.ok(app.includes("providerMetadataPayload(config)"), "account/profile writes should contain model metadata only");
  assert.ok(app.includes("ephemeralProviderConfig(config)"), "provider keys should be attached only to immediate match/provider requests");
  assert.ok(!app.includes("SESSION_STORAGE_KEY"), "browser should not persist bearer session tokens");
  assert.ok(!app.includes("Authorization"), "browser session should use HttpOnly cookies");
}

function testBattlefieldFirstProductStructure() {
  const play = read("src/pages/PlayPage.jsx");
  assert.ok(play.includes("<GameSetup"));
  assert.ok(play.includes("<Battlefield"));
  assert.ok(play.includes("<AgentThought"));
  assert.ok(play.includes("<FunctionHand"));
  assert.ok(play.includes("mobile-task-tabs"));
  assert.ok(css.includes("grid-template-columns: 258px minmax(0, 1fr) 292px"));
  assert.ok(css.includes("@media (max-width: 900px)"));
  assert.ok(css.includes("overflow-x: hidden"));
  assert.ok(css.includes(".result-banner"));
}

function testProductPagesAreRealDestinations() {
  const shell = read("src/components/AppShell.jsx");
  const leaderboard = read("src/pages/LeaderboardPage.jsx");
  const docs = read("src/pages/ApiDocsPage.jsx");
  assert.ok(shell.includes('id: "play"'));
  assert.ok(shell.includes('id: "leaderboard"'));
  assert.ok(shell.includes('id: "api"'));
  assert.ok(!shell.includes("Lab"));
  assert.ok(leaderboard.includes("Raw model baselines"));
  assert.ok(leaderboard.includes("Ranked combinations"));
  assert.ok(docs.includes("POST /api/simulations/league"));
  assert.ok(docs.includes("HttpOnly"));
  assert.ok(!docs.includes("Run league"), "public docs should not expose a server-key spending button");
}

function testClientCannotOverrideRankedActionCap() {
  assert.ok(!app.includes("maxActions"), "ranked client must not send an action cap");
  assert.ok(app.includes("allowAiFill: false"), "random match should briefly prefer a human opponent");
  assert.ok(app.includes("allowAiFill: true"), "empty queues should fill with an internal AI opponent");
  assert.ok(app.includes("/step"), "human-v-human play should submit only the active browser model turn");
}

testSingleSimulationSource();
testBrowserOwnsProviderKeys();
testBattlefieldFirstProductStructure();
testProductPagesAreRealDestinations();
testClientCannotOverrideRankedActionCap();

console.log("ui-source tests passed");
