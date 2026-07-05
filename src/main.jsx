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
  Trophy,
  Zap
} from "lucide-react";
import "./arena.css";

const Sim = window.GraphwarSim;

const AUTO_ORDERS = {
  A: "thread high shelf, avoid ally, pressure weakest rival",
  B: "bend through center, punish exposed target, avoid ally"
};

const DEFAULT_ROSTER = [
  { unitId: "A1", team: "A", control: "human", displayName: "You", provider: "local" },
  { unitId: "A2", team: "A", control: "ai", displayName: "Auto Ally", provider: "local" },
  { unitId: "B1", team: "B", control: "ai", displayName: "AI Rival 1", provider: "local" },
  { unitId: "B2", team: "B", control: "ai", displayName: "AI Rival 2", provider: "local" }
];

const PROFILE_STORAGE_KEY = "mob-graphwar-profile-id";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function getAutoOrder(team) {
  return AUTO_ORDERS[team] || "";
}

function App() {
  const [profile, setProfile] = useState(null);
  const [match, setMatch] = useState(null);
  const [battleState, setBattleState] = useState(() => Sim.createInitialState({ seed: 9461 }));
  const [login, setLogin] = useState({
    displayName: "Clock",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: ""
  });
  const [battleOrder, setBattleOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [leagueBusy, setLeagueBusy] = useState(false);
  const [message, setMessage] = useState("Sign in to enter ranked 2v2.");
  const [lastDecision, setLastDecision] = useState(null);
  const [queueState, setQueueState] = useState(null);
  const [leagueResult, setLeagueResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  const activeTeam = battleState.winner ? "-" : battleState.turn % 2 === 0 ? "A" : "B";
  const activeHand = useMemo(() => (activeTeam === "-" ? [] : Sim.getCurrentHand(battleState, activeTeam)), [battleState, activeTeam]);
  const activeHandState = activeTeam === "-" ? null : battleState.hands?.[activeTeam];
  const latestEvent = battleState.events[battleState.events.length - 1];

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

  async function submitMatchAction(actionPayload) {
    if (!profile || !match) return null;
    const response = await fetch(`/api/match/${match.id}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: profile.id, ...actionPayload })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "action_failed");
    setMatch(payload.match);
    setBattleState(payload.match.state);
    return payload;
  }

  async function localReroll() {
    if (battleState.winner || activeTeam === "-" || busy) return;
    const team = activeTeam;
    setBusy(true);
    try {
      const payload = match && profile
        ? await submitMatchAction({ action: "reroll", provider: "Local AI" })
        : null;
      const result = payload ? { ...payload.action, cards: payload.action.hand } : null;
      const localState = payload ? null : clone(battleState);
      const reroll = result || Sim.rerollHand(localState, team);
      if (localState) setBattleState(localState);
      setLastDecision({
        action: "reroll",
        team,
        provider: "Local AI",
        publicReason: `Rerolled into ${reroll.cards.map((card) => card.label).join(", ")}.`
      });
      setMessage(`Team ${team} rerolled. ${reroll.rerollsRemaining} rerolls left this turn.`);
    } catch (err) {
      setMessage(err.message || "Reroll failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveActiveModel() {
    if (battleState.winner || activeTeam === "-") return;
    setBusy(true);
    try {
      const next = clone(battleState);
      const useProvider = profile && activeTeam === "A" && login.apiKey.trim();
      if (useProvider) {
        const response = await fetch("/api/agent/shot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: login.provider,
            apiKey: login.apiKey,
            model: login.model,
            state: next,
            team: activeTeam,
            command: battleOrder
          })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "provider_failed");
        if (payload.decision.action === "reroll") {
          const providerLabel = `${login.provider} / ${payload.model}`;
          const actionPayload = match && profile
            ? await submitMatchAction({
                action: "reroll",
                provider: providerLabel,
                providerReason: payload.decision.publicReason
              })
            : null;
          if (!actionPayload) Sim.rerollHand(next, activeTeam);
          setLastDecision({
            action: "reroll",
            team: activeTeam,
            provider: providerLabel,
            publicReason: payload.decision.publicReason || "Provider selected a legal reroll."
          });
          setMessage(`${login.provider} chose to reroll.`);
        } else {
          const providerLabel = `${login.provider} / ${payload.model}`;
          const actionPayload = match && profile
            ? await submitMatchAction({
                action: "shot",
                command: battleOrder,
                candidateId: payload.decision.candidateId,
                provider: providerLabel,
                providerReason: payload.decision.publicReason
              })
            : null;
          if (!actionPayload) {
            Sim.applyTurn(next, { A: battleOrder, B: "" }, {
              candidateId: payload.decision.candidateId,
              provider: providerLabel,
              providerReason: payload.decision.publicReason
            });
          }
          const resolvedState = actionPayload ? actionPayload.match.state : next;
          const event = resolvedState.events[resolvedState.events.length - 1];
          setLastDecision({
            action: "shot",
            team: activeTeam,
            provider: event.provider || providerLabel,
            result: event.resultLabel,
            combo: event.combo?.name || "Mixed Curve",
            command: event.command,
            publicReason: payload.decision.publicReason || "Provider selected a legal shot."
          });
          setMessage(`${login.provider} fired a legal ranked shot.`);
        }
      } else {
        const orders = {
          A: activeTeam === "A" ? battleOrder : getAutoOrder("A"),
          B: activeTeam === "B" ? battleOrder || getAutoOrder("B") : getAutoOrder("B")
        };
        const providerLabel = activeTeam === "A" ? "Local Ally AI" : "Local Rival AI";
        const actionPayload = match && profile
          ? await submitMatchAction({
              action: "shot",
              command: orders[activeTeam],
              provider: providerLabel
            })
          : null;
        if (!actionPayload) Sim.applyTurn(next, orders, { provider: providerLabel });
        const resolvedState = actionPayload ? actionPayload.match.state : next;
        const event = resolvedState.events[resolvedState.events.length - 1];
        setLastDecision({
          action: "shot",
          team: activeTeam,
          provider: event.provider || providerLabel,
          result: event.resultLabel,
          combo: event.combo?.name || "Mixed Curve",
          command: event.command,
          publicReason: "Local model resolved a legal curve."
        });
        setMessage(`Team ${activeTeam} resolved by local AI.`);
      }
      if (!match || !profile) setBattleState(next);
    } catch (err) {
      setMessage(err.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function settleRank() {
    if (!profile || !match) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/match/${match.id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: profile.id })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "rank_failed");
      setProfile(payload.player);
      setMatch(payload.match);
      setBattleState(payload.match.state);
      window.localStorage.setItem(PROFILE_STORAGE_KEY, payload.player.id);
      await loadLeaderboard();
      setLastDecision({
        action: "rank",
        team: payload.match.state.winner || "draw",
        provider: "Rank Engine",
        result: `${payload.rankDelta > 0 ? "+" : ""}${payload.rankDelta}`,
        publicReason: `Rating ${payload.player.rank.rating}`
      });
      setMessage(`Rank ${payload.rankDelta > 0 ? "+" : ""}${payload.rankDelta}. New rating ${payload.player.rank.rating}.`);
    } catch (err) {
      setMessage(err.message || "Rank settlement failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="arena-shell" data-ui-version="react-arena-v1">
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
          <LoginCard login={login} setLogin={setLogin} profile={profile} busy={busy} onSubmit={signIn} onRestore={restoreProfile} />
          <MatchCard profile={profile} match={match} queueState={queueState} busy={busy} onJoin={joinMatch} onSync={syncCurrentRoom} onSettle={settleRank} />
          <RosterCard match={match} />
          <LeaderboardPanel players={leaderboard} profile={profile} onRefresh={loadLeaderboard} />
        </aside>

        <section className="battle-panel game-panel">
          <BattleHeader state={battleState} activeTeam={activeTeam} message={message} />
          <section className="arena-stage" aria-label="AI duel stage">
            <DuelCommanders state={battleState} match={match} activeTeam={activeTeam} lastDecision={lastDecision} />
            <Battlefield state={battleState} latestEvent={latestEvent} />
          </section>
          <CommandConsole
            activeTeam={activeTeam}
            order={battleOrder}
            setOrder={setBattleOrder}
            onReroll={localReroll}
            onResolve={resolveActiveModel}
            busy={busy}
            rerollsRemaining={activeHandState ? Sim.CONFIG.maxRerollsPerTurn - activeHandState.rerollsUsed : 0}
          />
        </section>

        <aside className="tactical-panel game-panel">
          <HandRack hand={activeHand} activeTeam={activeTeam} />
          <Timeline state={battleState} />
          <ModelWarFeed state={battleState} lastDecision={lastDecision} />
          <ShotIntel event={latestEvent} state={battleState} />
          <LeagueLab result={leagueResult} busy={leagueBusy} onRun={runLeague} />
        </aside>
      </section>
    </main>
  );
}

function DuelCommanders({ state, match, activeTeam, lastDecision }) {
  const roster = match?.roster?.length ? match.roster : DEFAULT_ROSTER;
  return (
    <section className="commander-board" data-testid="commander-board" aria-label="AI commanders">
      {["A", "B"].map((team) => {
        const health = teamHealth(state, team);
        const seats = roster.filter((seat) => seat.team === team);
        const active = activeTeam === team;
        const testId = team === "A" ? "team-a-commander" : "team-b-commander";
        return (
          <article className={`commander-card commander-${team.toLowerCase()} ${active ? "active" : ""}`} data-testid={testId} key={team}>
            <div className="commander-topline">
              <span>Team {team}</span>
              <b>{active ? "ACTIVE MODEL" : "STANDBY"}</b>
            </div>
            <div className="commander-names">
              {seats.map((seat) => (
                <strong key={seat.unitId}>{seat.unitId} {seat.displayName}</strong>
              ))}
            </div>
            <div className="hp-track" aria-label={`Team ${team} HP`}>
              <i style={{ width: `${health.max ? Math.max(0, (health.hp / health.max) * 100) : 0}%` }} />
            </div>
            <div className="commander-metrics">
              <span>{health.hp}/{health.max} HP</span>
              <span>{health.alive} online</span>
              <span>{seats.map((seat) => seat.provider).join(" + ")}</span>
            </div>
            {lastDecision?.team === team ? <p className="commander-last">{lastDecision.action} · {lastDecision.result || lastDecision.publicReason}</p> : null}
          </article>
        );
      })}
    </section>
  );
}

function LoginCard({ login, setLogin, profile, busy, onSubmit, onRestore }) {
  return (
    <form className="login-card" onSubmit={onSubmit}>
      <div className="panel-title"><LogIn size={18} /> Login / Model Key</div>
      <label>Display name<input value={login.displayName} onChange={(e) => setLogin({ ...login, displayName: e.target.value })} /></label>
      <label>Provider<select value={login.provider} onChange={(e) => setLogin({ ...login, provider: e.target.value })}>
        <option value="deepseek">DeepSeek</option>
        <option value="openai">OpenAI</option>
        <option value="minimax">MiniMax</option>
        <option value="zhipu">Zhipu</option>
        <option value="anthropic">Anthropic</option>
      </select></label>
      <label>Model<input value={login.model} onChange={(e) => setLogin({ ...login, model: e.target.value })} /></label>
      <label>API key<input type="password" value={login.apiKey} onChange={(e) => setLogin({ ...login, apiKey: e.target.value })} placeholder="Stored only for this browser session" /></label>
      <div className="profile-vault">
        <span>{profile ? `${profile.displayName} · ${profile.rank.tier} ${profile.rank.rating}` : "No active ranked profile"}</span>
        <button type="button" disabled={busy} onClick={onRestore}>Restore</button>
      </div>
      <button disabled={busy}>{profile ? "Update Session" : "Enter Arena"}</button>
    </form>
  );
}

function MatchCard({ profile, match, queueState, busy, onJoin, onSync, onSettle }) {
  const syncLabel = queueState?.polling ? "Auto sync armed" : match ? `Room ${match.id}` : "No room synced";
  return (
    <div className="match-card">
      <div className="panel-title"><RadioTower size={18} /> Ranked Matchmaking</div>
      <div className="match-status">
        <span>{match ? match.mode : "No active match"}</span>
        <strong>{match ? match.status : "waiting"}</strong>
      </div>
      <div className="queue-strip" data-testid="ranked-queue">
        <Activity size={16} />
        <span>{queueState ? `${queueState.queueSize}/4 humans queued` : match?.filledByAi ? "AI fallback active" : "Queue idle"}</span>
      </div>
      <div className="sync-strip" data-testid="room-sync">
        <RefreshCw size={15} />
        <span>{syncLabel}</span>
        <button disabled={!profile || busy} onClick={onSync}>Sync</button>
      </div>
      <div className="match-actions">
        <button disabled={!profile || busy} onClick={() => onJoin({ allowAiFill: false })}>Wait for Humans</button>
        <button disabled={!profile || busy} onClick={() => onJoin({ allowAiFill: true })}>Quick AI Fill</button>
      </div>
      <button disabled={!profile || !match || busy} onClick={onSettle}>Resolve Rank Result</button>
    </div>
  );
}

function RosterCard({ match }) {
  const roster = match?.roster || [];
  return (
    <div className="roster-card">
      <div className="panel-title"><Shield size={18} /> Seats</div>
      {roster.length ? roster.map((seat) => (
        <div className={`seat seat-${seat.team.toLowerCase()}`} key={seat.unitId}>
          <span>{seat.unitId} / Team {seat.team}</span>
          <strong>{seat.displayName}</strong>
          <small>{seat.control} · {seat.provider}</small>
        </div>
      )) : <p className="empty-copy">Join matchmaking to fill your ally and rivals.</p>}
    </div>
  );
}

function LeaderboardPanel({ players, profile, onRefresh }) {
  return (
    <div className="leaderboard-panel" data-testid="leaderboard-panel">
      <div className="panel-title"><ListOrdered size={18} /> Ranked Ladder</div>
      <div className="leaderboard-list">
        {players.length ? players.map((player, index) => (
          <div className={`leaderboard-row ${profile?.id === player.id ? "you" : ""}`} key={player.id}>
            <span>#{index + 1}</span>
            <strong>{player.displayName}</strong>
            <b>{player.rating}</b>
            <small>{player.tier} · {player.games}G</small>
          </div>
        )) : <p className="empty-copy">Settle ranked matches to populate the ladder.</p>}
      </div>
      <button type="button" onClick={onRefresh}>Refresh Ladder</button>
    </div>
  );
}

function BattleHeader({ state, activeTeam, message }) {
  return (
    <div className="battle-header">
      <div><span>Turn</span><strong>{state.turn}/{Sim.CONFIG.maxTurns}</strong></div>
      <div><span>Active</span><strong>Team {activeTeam}</strong></div>
      <div><span>Map</span><strong>{state.mapMeta.name} {state.mapMeta.difficulty}</strong></div>
      <div><span>Status</span><strong>{state.winner ? `${state.winner} wins` : message}</strong></div>
    </div>
  );
}

function BattlefieldBackdrop({ state }) {
  const complexity = state.mapMeta?.complexity || {};
  return (
    <g className="battlefield-backdrop" aria-hidden="true">
      <rect x="0" y="0" width="1000" height="600" fill="url(#skyField)" />
      {Array.from({ length: 11 }, (_, i) => <line key={`x-${i}`} className="grid-line" x1={i * 100} y1="0" x2={i * 100} y2="600" />)}
      {Array.from({ length: 7 }, (_, i) => <line key={`y-${i}`} className="grid-line" x1="0" y1={i * 100} x2="1000" y2={i * 100} />)}
      <text className="field-watermark" x="34" y="64">DENSITY {complexity.density || "0.000"}</text>
      <text className="field-watermark right" x="966" y="64" textAnchor="end">CHOKES {complexity.chokePoints || 0}</text>
      <path className="terrain-ridge ridge-far" d={terrainLinePath(8)} />
      <path className="terrain-ridge ridge-mid" d={terrainLinePath(4)} />
    </g>
  );
}

function renderObstacleFacets(obstacle, index) {
  const showLabel = index % 4 === 0 || obstacle.h >= 30 || obstacle.y >= 38;
  return (
    <g key={obstacle.id} className="obstacle-cluster">
      <polygon className="obstacle-shadow" points={obstacleFacetPoints(obstacle, "shadow")} />
      <polygon className="obstacle-facet" points={obstacleFacetPoints(obstacle, "body")} />
      <polygon className="obstacle-cap" points={obstacleFacetPoints(obstacle, "cap")} />
      {showLabel ? (
        <text className="obstacle-label" x={sx(obstacle.x + obstacle.w / 2)} y={sy(obstacle.y + obstacle.h) + 18} textAnchor="middle">
          {obstacleLabel(obstacle)}
        </text>
      ) : null}
    </g>
  );
}

function Battlefield({ state, latestEvent }) {
  const complexity = state.mapMeta?.complexity || {};
  const latestPath = state.paths[state.paths.length - 1];
  const impactPoint = latestEvent?.collisionPoint || latestPath?.collisionPoint || null;
  return (
    <div className="battlefield-frame" data-testid="battlefield-frame">
      <div className="map-intel-strip" data-testid="map-intel-strip">
        <span><b>{state.mapMeta.name}</b> difficulty {state.mapMeta.difficulty}</span>
        <span>{complexity.obstacleCount || 0} blockers</span>
        <span>{complexity.tallCount || 0} towers</span>
        <span>{complexity.ceilingCount || 0} ceilings</span>
        <span>{complexity.suspendedShelves || 0} shelves</span>
      </div>
      <svg className="battlefield" viewBox="0 0 1000 600" role="img" aria-label="Mob Graphwar ranked battlefield">
        <defs>
          <linearGradient id="arenaGround" x1="0" x2="1">
            <stop offset="0%" stopColor="#173b35" />
            <stop offset="62%" stopColor="#2f5139" />
            <stop offset="100%" stopColor="#121b21" />
          </linearGradient>
          <linearGradient id="skyField" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#071018" />
            <stop offset="48%" stopColor="#081528" />
            <stop offset="100%" stopColor="#100a14" />
          </linearGradient>
          <linearGradient id="obstacleFace" x1="0" x2="1">
            <stop offset="0%" stopColor="#59646d" />
            <stop offset="55%" stopColor="#2e3842" />
            <stop offset="100%" stopColor="#151b24" />
          </linearGradient>
          <filter id="impactGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <BattlefieldBackdrop state={state} />
        <path className="terrain" d={terrainPath()} />
        <path className="terrain-ridge ridge-near" d={terrainLinePath(1.4)} />
        <g className="obstacle-layer">
          {state.obstacles.map(renderObstacleFacets)}
        </g>
        {state.paths.map((path, index) => (
          <polyline key={`${path.turn}-${index}`} className={`shot-path team-${path.team.toLowerCase()} ${index === state.paths.length - 1 ? "latest" : ""}`} points={pointList(path.points)} />
        ))}
        {impactPoint ? (
          <g className={`impact-burst team-${latestPath?.team?.toLowerCase() || "a"}`} filter="url(#impactGlow)">
            <circle cx={sx(impactPoint.x)} cy={sy(impactPoint.y)} r="25" />
            <circle cx={sx(impactPoint.x)} cy={sy(impactPoint.y)} r="8" />
            <path d={`M${sx(impactPoint.x) - 34},${sy(impactPoint.y)} L${sx(impactPoint.x) + 34},${sy(impactPoint.y)} M${sx(impactPoint.x)},${sy(impactPoint.y) - 34} L${sx(impactPoint.x)},${sy(impactPoint.y) + 34}`} />
          </g>
        ) : null}
        {state.units.map((unit) => (
          <g key={unit.id} className={`unit team-${unit.team.toLowerCase()} ${unit.hp <= 0 ? "dead" : ""}`}>
            <circle className="unit-aura" cx={sx(unit.x)} cy={sy(unit.y)} r={Sim.CONFIG.unitRadius * 14} />
            <circle cx={sx(unit.x)} cy={sy(unit.y)} r={Sim.CONFIG.unitRadius * 10} />
            <text x={sx(unit.x)} y={sy(unit.y) - 32} textAnchor="middle">{unit.id} {unit.hp}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function CommandConsole({ activeTeam, order, setOrder, onReroll, onResolve, busy, rerollsRemaining }) {
  return (
    <div className="command-console">
      <div className="console-copy">
        <Crosshair size={18} />
        <div>
          <strong>Team {activeTeam} model action</strong>
          <span>Hand retained. Three rerolls available each turn.</span>
        </div>
      </div>
      <textarea maxLength="80" value={order} onChange={(e) => setOrder(e.target.value)} placeholder="80-character order to your model" />
      <div className="command-actions">
        <button disabled={busy || rerollsRemaining <= 0} onClick={onReroll}><RefreshCw size={16} /> Reroll ({rerollsRemaining})</button>
        <button className="fire-button" disabled={busy} onClick={onResolve}><Zap size={16} /> Resolve Model</button>
      </div>
    </div>
  );
}

function HandRack({ hand, activeTeam }) {
  return (
    <div className="hand-rack">
      <div className="panel-title"><KeyRound size={18} /> Team {activeTeam} Hand</div>
      <div className="card-grid">
        {hand.map((card) => (
          <article className={`battle-card ${card.rarity}`} key={card.instanceId}>
            <span>{card.family}</span>
            <h3>{card.label}<b>{card.cost}E</b></h3>
            <p>{card.description}</p>
            <div>{card.tags.map((tag) => <small key={tag}>{tag}</small>)}</div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Timeline({ state }) {
  return (
    <div className="timeline-card">
      <div className="panel-title"><Swords size={18} /> Battle Timeline</div>
      <div className="timeline-grid">
        {Array.from({ length: Sim.CONFIG.maxTurns }, (_, turn) => {
          const event = state.events.find((item) => item.turn === turn);
          return <span key={turn} className={`tick ${event ? event.result : ""} ${turn === state.turn ? "active" : ""}`}>{turn + 1}</span>;
        })}
      </div>
    </div>
  );
}

function ModelWarFeed({ state, lastDecision }) {
  const events = state.events.slice(-5).reverse();
  return (
    <div className="model-war-feed" data-testid="model-war-feed">
      <div className="panel-title"><Bot size={18} /> Model War Feed</div>
      {lastDecision ? (
        <div className={`feed-prime team-${String(lastDecision.team).toLowerCase()}`}>
          <span>{lastDecision.provider || "Model"}</span>
          <strong>{lastDecision.action}</strong>
          <p>{lastDecision.result || lastDecision.publicReason}</p>
        </div>
      ) : (
        <div className="feed-prime idle">
          <span>Pre-match</span>
          <strong>awaiting command</strong>
          <p>No model decision yet.</p>
        </div>
      )}
      <div className="feed-list">
        {events.length ? events.map((event) => (
          <div className={`feed-row team-${event.team.toLowerCase()}`} key={`${event.turn}-${event.team}-${event.candidateId}`}>
            <span>T{event.turn + 1} · Team {event.team}</span>
            <strong>{event.resultLabel}</strong>
            <small>{event.provider || "Local AI"} · {event.combo?.name || "Mixed Curve"}</small>
          </div>
        )) : <p className="empty-copy">The duel feed will fill as models choose rerolls and shots.</p>}
      </div>
    </div>
  );
}

function ShotIntel({ event, state }) {
  return (
    <div className="shot-intel">
      <div className="panel-title"><Bot size={18} /> AI Battle Read</div>
      {event ? (
        <div className="intel-list">
          <span>Team <b>{event.team}</b></span>
          <span>Result <b>{event.resultLabel}</b></span>
          <span>Combo <b>{event.combo?.name || "Mixed Curve"}</b></span>
          <span>Provider <b>{event.provider || "Local AI"}</b></span>
          <code>{event.expression}</code>
        </div>
      ) : (
        <p className="empty-copy">No shots yet. Login, match, and resolve the first model action.</p>
      )}
      {state.score ? <div className="final-score">Final {state.score.rank} · {state.score.value}</div> : null}
    </div>
  );
}

function LeagueLab({ result, busy, onRun }) {
  const leaders = result?.leaderboard || [];
  const matches = result?.matches || [];
  return (
    <div className="league-lab" data-testid="league-lab">
      <div className="panel-title"><Cpu size={18} /> Model League Lab</div>
      <div className="league-headline">
        <div>
          <strong>{leaders[0] ? leaders[0].label : "No league run yet"}</strong>
          <span>{leaders[0] ? `${leaders[0].rating} rating leader` : "Run models through ranked seeds"}</span>
        </div>
        <button disabled={busy} onClick={onRun}><PlayCircle size={16} /> Run</button>
      </div>
      <div className="league-table">
        {leaders.length ? leaders.map((row, index) => (
          <div className="league-row" key={row.id}>
            <span>#{index + 1}</span>
            <strong>{row.label}</strong>
            <b>{row.rating}</b>
            <small>{row.wins}-{row.losses}-{row.draws}</small>
          </div>
        )) : <p className="empty-copy">This runs the same bare rules contract as live model turns, with API keys redacted from results.</p>}
      </div>
      {matches.length ? (
        <div className="league-matches">
          {matches.slice(0, 3).map((match) => (
            <span key={match.id}>{match.id} · seed {match.seed} · {match.winner} · {match.events} turns</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
