import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bot,
  Cpu,
  Crosshair,
  KeyRound,
  ListOrdered,
  LogIn,
  PlayCircle,
  RadioTower,
  RefreshCw,
  Shield,
  Swords,
  Trophy
} from "lucide-react";
import "./arena.css";

const Sim = window.GraphwarSim;

const DEFAULT_ROSTER = [
  { unitId: "A1", team: "A", control: "human", displayName: "You", provider: "local" },
  { unitId: "A2", team: "A", control: "ai", displayName: "Auto Ally", provider: "local" },
  { unitId: "B1", team: "B", control: "ai", displayName: "AI Rival 1", provider: "local" },
  { unitId: "B2", team: "B", control: "ai", displayName: "AI Rival 2", provider: "local" }
];

const PROFILE_STORAGE_KEY = "mob-graphwar-profile-id";
const EXHIBITION_COMMANDS = {
  A: "safe high arc target weakest enemy avoid ally",
  B: "thread center with bend target weakest enemy"
};

function createExhibitionBattle() {
  return Sim.runBattle({ seed: 9461, commands: EXHIBITION_COMMANDS });
}

function sx(x) {
  return x * 10;
}

function sy(y) {
  return 600 - y * 10;
}

function pointList(points) {
  return points.map((point) => `${sx(point.x).toFixed(1)},${sy(point.y).toFixed(1)}`).join(" ");
}

function terrainPath() {
  const pts = [];
  for (let x = 0; x <= Sim.CONFIG.width; x += 1) {
    pts.push(`${sx(x)},${sy(Sim.groundY(x))}`);
  }
  return `M0,600 L${pts.join(" L")} L1000,600 Z`;
}

function terrainLinePath(offset) {
  const pts = [];
  for (let x = 0; x <= Sim.CONFIG.width; x += 1) {
    pts.push(`${sx(x)},${sy(Sim.groundY(x) + offset)}`);
  }
  return `M${pts.join(" L")}`;
}

function obstacleFacetPoints(obstacle, layer) {
  const x = sx(obstacle.x);
  const top = sy(obstacle.y + obstacle.h);
  const bottom = sy(obstacle.y);
  const width = obstacle.w * 10;
  const height = obstacle.h * 10;
  const bevel = Math.max(5, Math.min(18, width * 0.28, height * 0.22));
  if (layer === "cap") {
    return [
      `${x + bevel},${top}`,
      `${x + width},${top + bevel * 0.45}`,
      `${x + width - bevel * 0.55},${top + bevel + 7}`,
      `${x + bevel * 0.25},${top + 7}`
    ].join(" ");
  }
  if (layer === "shadow") {
    return [
      `${x + width},${top + bevel * 0.45}`,
      `${x + width + 8},${top + bevel + 9}`,
      `${x + width - bevel * 0.3},${bottom + 7}`,
      `${x + width - bevel * 0.65},${bottom}`
    ].join(" ");
  }
  return [
    `${x + bevel},${top}`,
    `${x + width},${top + bevel * 0.45}`,
    `${x + width - bevel * 0.35},${bottom}`,
    `${x},${bottom}`,
    `${x},${top + bevel * 0.55}`
  ].join(" ");
}

function obstacleLabel(obstacle) {
  return obstacle.id
    .replace(/^seed-/, "")
    .split("-")
    .slice(0, 2)
    .join(" ")
    .toUpperCase();
}

function teamUnits(state, team) {
  return state.units.filter((unit) => unit.team === team);
}

function teamHealth(state, team) {
  const units = teamUnits(state, team);
  const hp = units.reduce((sum, unit) => sum + unit.hp, 0);
  return { hp, max: units.length * 100, alive: units.filter((unit) => unit.hp > 0).length };
}

function eventDecision(event) {
  if (!event) return null;
  return {
    action: "shot",
    team: event.team,
    provider: event.provider || "Exhibition AI",
    result: event.resultLabel,
    publicReason: event.combo ? `${event.combo.name} into ${event.targetId}` : event.targetId
  };
}

function App() {
  const [profile, setProfile] = useState(null);
  const [match, setMatch] = useState(null);
  const [battleState, setBattleState] = useState(createExhibitionBattle);
  const [login, setLogin] = useState({
    displayName: "Clock",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: ""
  });
  const [battleOrder, setBattleOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [leagueBusy, setLeagueBusy] = useState(false);
  const [message, setMessage] = useState("Watching an exhibition AI duel. Sign in to enter ranked 2v2.");
  const [lastDecision, setLastDecision] = useState(null);
  const [queueState, setQueueState] = useState(null);
  const [leagueResult, setLeagueResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [autoBattle, setAutoBattle] = useState(null);

  const latestEvent = battleState.events[battleState.events.length - 1];
  const activeTeam = battleState.winner ? "-" : battleState.turn % 2 === 0 ? "A" : "B";
  const displayTeam = activeTeam === "-" ? latestEvent?.team || battleState.winner || "A" : activeTeam;
  const activeHand = useMemo(() => Sim.getCurrentHand(battleState, displayTeam === "B" ? "B" : "A"), [battleState, displayTeam]);
  const visibleDecision = lastDecision || eventDecision(latestEvent);

  useEffect(() => {
    if (!profile || !queueState || match) return undefined;
    const timer = window.setInterval(() => {
      pollMatchmaking(profile.id).catch((err) => setMessage(err.message || "Queue sync failed."));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [profile?.id, queueState?.status, queueState?.queueSize, match?.id]);

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: login.displayName,
          providers: {
            [login.provider]: { apiKey: login.apiKey, model: login.model }
          }
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "login_failed");
      setProfile(payload.player);
      window.localStorage.setItem(PROFILE_STORAGE_KEY, payload.player.id);
      await loadLeaderboard();
      setMessage("Profile ready. Join ranked matchmaking.");
    } catch (err) {
      setMessage(err.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreProfile() {
    const storedId = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!storedId) {
      setMessage("No saved ranked profile on this device.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/session/${storedId}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "restore_failed");
      setProfile(payload.player);
      setLogin((current) => ({ ...current, displayName: payload.player.displayName }));
      await loadLeaderboard();
      const status = await pollMatchmaking(payload.player.id);
      if (!status || status.status === "idle") {
        setMessage(`Restored ${payload.player.displayName} at ${payload.player.rank.rating}.`);
      }
    } catch (err) {
      window.localStorage.removeItem(PROFILE_STORAGE_KEY);
      setMessage(err.message || "Profile restore failed.");
    } finally {
      setBusy(false);
    }
  }

  async function loadLeaderboard() {
    const response = await fetch("/api/leaderboard?limit=8");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "leaderboard_failed");
    setLeaderboard(payload.players || []);
    return payload.players || [];
  }

  async function syncMatchRoom(matchId = match?.id, playerId = profile?.id) {
    if (!matchId || !playerId) return null;
    const response = await fetch(`/api/match/${matchId}?playerId=${playerId}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "room_sync_failed");
    setMatch(payload.match);
    setBattleState(payload.match.state);
    setLastDecision(null);
    setQueueState(null);
    setAutoBattle(null);
    setMessage(`Room synced: ${payload.match.status}.`);
    return payload.match;
  }

  async function pollMatchmaking(playerId = profile?.id) {
    if (!playerId) return null;
    const response = await fetch(`/api/matchmaking/${playerId}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "matchmaking_sync_failed");
    if (payload.status === "matched" && payload.match) {
      await syncMatchRoom(payload.match.id, playerId);
      return payload;
    }
    if (payload.status === "queued") {
      setQueueState({ ...payload, polling: true });
      setMessage(`Waiting for humans. Position ${payload.position || "?"}/${payload.queueSize}.`);
      return payload;
    }
    setQueueState(null);
    setMessage("No active queue or room for this profile.");
    return payload;
  }

  async function syncCurrentRoom() {
    if (!profile) return;
    setBusy(true);
    try {
      if (match?.id) {
        await syncMatchRoom(match.id, profile.id);
      } else {
        await pollMatchmaking(profile.id);
      }
    } catch (err) {
      setMessage(err.message || "Room sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function joinMatch(options) {
    if (!profile) return;
    const opts = options || {};
    setBusy(true);
    try {
      const response = await fetch("/api/match/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: profile.id, preferredProvider: login.provider, allowAiFill: opts.allowAiFill !== false })
      });
      const payload = await response.json();
      if (response.status === 202) {
        setQueueState({ ...payload, polling: true });
        setMessage(`Waiting for humans. ${payload.queueSize}/4 commanders queued.`);
        return;
      }
      if (!response.ok) throw new Error(payload.error || "matchmaking_failed");
      setMatch(payload.match);
      setBattleState(payload.match.state);
      setLastDecision(null);
      setQueueState(null);
      setAutoBattle(null);
      setMessage(payload.match.filledByAi ? "No full lobby found. AI filled ally and rivals." : "Ranked lobby matched.");
    } catch (err) {
      setMessage(err.message || "Matchmaking failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runLeague() {
    setLeagueBusy(true);
    try {
      const response = await fetch("/api/simulations/league", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rounds: 4,
          contestants: [
            {
              id: "your-model",
              label: login.apiKey.trim() ? `${login.provider} ${login.model}` : "Your Local Baseline",
              provider: login.apiKey.trim() ? login.provider : "local",
              model: login.model,
              apiKey: login.apiKey,
              command: battleOrder || "safe high arc target weakest enemy avoid ally"
            },
            {
              id: "pressure-local",
              label: "Pressure Local",
              provider: "local",
              command: "bend through center target weakest enemy"
            },
            {
              id: "control-local",
              label: "Control Local",
              provider: "local",
              command: "thread high shelf avoid ally"
            }
          ]
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "league_failed");
      setLeagueResult(payload);
      const leader = payload.leaderboard && payload.leaderboard[0];
      setMessage(leader ? `League leader: ${leader.label} at ${leader.rating}.` : "League simulation complete.");
    } catch (err) {
      setMessage(err.message || "League simulation failed.");
    } finally {
      setLeagueBusy(false);
    }
  }

  async function runAutoDuel() {
    if (!profile || !match || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/match/${match.id}/auto-duel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: profile.id, command: battleOrder })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "auto_duel_failed");
      setProfile(payload.player);
      setMatch(payload.match);
      setBattleState(payload.match.state);
      setAutoBattle(payload.autoBattle);
      window.localStorage.setItem(PROFILE_STORAGE_KEY, payload.player.id);
      await loadLeaderboard();
      setLastDecision({
        action: "auto duel",
        team: payload.match.state.winner || "draw",
        provider: "Battle Engine",
        result: `${payload.autoBattle?.resolvedTurns || 0} turns`,
        publicReason: `Rank ${payload.rankDelta > 0 ? "+" : ""}${payload.rankDelta}; rating ${payload.player.rank.rating}.`
      });
      setMessage(`Auto duel complete. ${payload.match.state.winner || "draw"} result, rank ${payload.rankDelta > 0 ? "+" : ""}${payload.rankDelta}.`);
    } catch (err) {
      setMessage(err.message || "Auto duel failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="arena-shell battle-priority-layout" data-ui-version="react-arena-v2">
      <section className="hero-band">
        <div className="brand-zone">
          <span className="kicker">MOB GRAPHWAR ARENA</span>
          <h1>Ranked AI Artillery</h1>
          <p>2v2 function-card combat with human-written model orders.</p>
        </div>
        <div className="rank-chip">
          <Trophy size={22} />
          <div>
            <span>Rank Rating</span>
            <strong>{profile ? profile.rank.rating : 1000}</strong>
          </div>
        </div>
      </section>

      <section className="game-grid">
        <aside className="lobby-panel game-panel">
          <LaunchBay
            login={login}
            setLogin={setLogin}
            profile={profile}
            match={match}
            queueState={queueState}
            busy={busy}
            canAutoDuel={Boolean(profile && match && !battleState.winner)}
            onSubmit={signIn}
            onRestore={restoreProfile}
            onJoin={joinMatch}
            onSync={syncCurrentRoom}
            onAutoDuel={runAutoDuel}
          />
          <RosterCard match={match} />
          <LeaderboardPanel players={leaderboard} profile={profile} onRefresh={loadLeaderboard} />
        </aside>

        <section className="battle-panel game-panel">
          <BattleHeader state={battleState} activeTeam={activeTeam} message={message} />
          <SpectatorHud state={battleState} activeTeam={activeTeam} match={match} />
          <section className="arena-stage" aria-label="AI duel stage">
            <VersusBanner state={battleState} match={match} activeTeam={activeTeam} />
            <DuelCommanders state={battleState} match={match} activeTeam={activeTeam} lastDecision={visibleDecision} />
            <Battlefield state={battleState} latestEvent={latestEvent} />
            <BattleReplayRail state={battleState} />
          </section>
          <Co