import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  Crosshair,
  KeyRound,
  LogIn,
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
  const [message, setMessage] = useState("Sign in to enter ranked 2v2.");
  const [lastDecision, setLastDecision] = useState(null);

  const activeTeam = battleState.winner ? "-" : battleState.turn % 2 === 0 ? "A" : "B";
  const activeHand = useMemo(() => (activeTeam === "-" ? [] : Sim.getCurrentHand(battleState, activeTeam)), [battleState, activeTeam]);
  const activeHandState = activeTeam === "-" ? null : battleState.hands?.[activeTeam];
  const latestEvent = battleState.events[battleState.events.length - 1];

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
      setMessage("Profile ready. Join ranked matchmaking.");
    } catch (err) {
      setMessage(err.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function joinMatch() {
    if (!profile) return;
    setBusy(true);
    try {
      const response = await fetch("/api/match/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: profile.id, preferredProvider: login.provider })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "matchmaking_failed");
      setMatch(payload.match);
      setBattleState(payload.match.state);
      setLastDecision(null);
      setMessage(payload.match.filledByAi ? "No full lobby found. AI filled ally and rivals." : "Ranked lobby matched.");
    } catch (err) {
      setMessage(err.message || "Matchmaking failed.");
    } finally {
      setBusy(false);
    }
  }

  function localReroll() {
    if (battleState.winner || activeTeam === "-") return;
    const next = clone(battleState);
    try {
      const result = Sim.rerollHand(next, activeTeam);
      setBattleState(next);
      setLastDecision({
        action: "reroll",
        team: activeTeam,
        provider: "Local AI",
        publicReason: `Rerolled into ${result.cards.map((card) => card.label).join(", ")}.`
      });
      setMessage(`Team ${activeTeam} rerolled. ${result.rerollsRemaining} rerolls left this turn.`);
    } catch (err) {
      setMessage(err.message || "Reroll failed.");
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
          Sim.rerollHand(next, activeTeam);
          setLastDecision({
            action: "reroll",
            team: activeTeam,
            provider: `${login.provider} / ${payload.model}`,
            publicReason: payload.decision.publicReason || "Provider selected a legal reroll."
          });
          setMessage(`${login.provider} chose to reroll.`);
        } else {
          Sim.applyTurn(next, { A: battleOrder, B: "" }, {
            candidateId: payload.decision.candidateId,
            provider: `${login.provider} / ${payload.model}`,
            providerReason: payload.decision.publicReason
          });
          const event = next.events[next.events.length - 1];
          setLastDecision({
            action: "shot",
            team: activeTeam,
            provider: event.provider || `${login.provider} / ${payload.model}`,
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
        Sim.applyTurn(next, orders, { provider: activeTeam === "A" ? "Local Ally AI" : "Local Rival AI" });
        const event = next.events[next.events.length - 1];
        setLastDecision({
          action: "shot",
          team: activeTeam,
          provider: event.provider || "Local AI",
          result: event.resultLabel,
          combo: event.combo?.name || "Mixed Curve",
          command: event.command,
          publicReason: "Local model resolved a legal curve."
        });
        setMessage(`Team ${activeTeam} resolved by local AI.`);
      }
      setBattleState(next);
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
          <LoginCard login={login} setLogin={setLogin} profile={profile} busy={busy} onSubmit={signIn} />
          <MatchCard profile={profile} match={match} busy={busy} onJoin={joinMatch} onSettle={settleRank} />
          <RosterCard match={match} />
        </aside>

        <section className="battle-panel game-panel">
          <BattleHeader state={battleState} activeTeam={activeTeam} message={message} />
          <section className="arena-stage" aria-label="AI duel stage">
            <DuelCommanders state={battleState} match={match} activeTeam={activeTeam} lastDecision={lastDecision} />
            <Battlefield state={battleState} />
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

function LoginCard({ login, setLogin, profile, busy, onSubmit }) {
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
      <button disabled={busy}>{profile ? "Update Session" : "Enter Arena"}</button>
    </form>
  );
}

function MatchCard({ profile, match, busy, onJoin, onSettle }) {
  return (
    <div className="match-card">
      <div className="panel-title"><RadioTower size={18} /> Ranked Matchmaking</div>
      <div className="match-status">
        <span>{match ? match.mode : "No active match"}</span>
        <strong>{match ? match.status : "waiting"}</strong>
      </div>
      <button disabled={!profile || busy} onClick={onJoin}>Join Ranked 2v2</button>
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

function Battlefield({ state }) {
  return (
    <svg className="battlefield" viewBox="0 0 1000 600" role="img" aria-label="Mob Graphwar ranked battlefield">
      <defs>
        <linearGradient id="arenaGround" x1="0" x2="1">
          <stop offset="0%" stopColor="#173b35" />
          <stop offset="100%" stopColor="#2f5139" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1000" height="600" fill="#071018" />
      {Array.from({ length: 11 }, (_, i) => <line key={`x-${i}`} className="grid-line" x1={i * 100} y1="0" x2={i * 100} y2="600" />)}
      {Array.from({ length: 7 }, (_, i) => <line key={`y-${i}`} className="grid-line" x1="0" y1={i * 100} x2="1000" y2={i * 100} />)}
      <path className="terrain" d={terrainPath()} />
      {state.obstacles.map((obstacle) => (
        <rect key={obstacle.id} className="obstacle" x={sx(obstacle.x)} y={sy(obstacle.y + obstacle.h)} width={obstacle.w * 10} height={obstacle.h * 10} rx="2" />
      ))}
      {state.paths.map((path, index) => (
        <polyline key={`${path.turn}-${index}`} className={`shot-path team-${path.team.toLowerCase()}`} points={pointList(path.points)} />
      ))}
      {state.units.map((unit) => (
        <g key={unit.id} className={`unit team-${unit.team.toLowerCase()} ${unit.hp <= 0 ? "dead" : ""}`}>
          <circle cx={sx(unit.x)} cy={sy(unit.y)} r={Sim.CONFIG.unitRadius * 10} />
          <text x={sx(unit.x)} y={sy(unit.y) - 32} textAnchor="middle">{unit.id} {unit.hp}</text>
        </g>
      ))}
    </svg>
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

createRoot(document.getElementById("root")).render(<App />);
