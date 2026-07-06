import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Bot,
  Cpu,
  KeyRound,
  ListOrdered,
  LogIn,
  Gauge,
  PauseCircle,
  PlayCircle,
  RadioTower,
  RefreshCw,
  Shield,
  SkipBack,
  SkipForward,
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

const MODEL_PROVIDERS = [
  { id: "deepseek", label: "DeepSeek", model: "deepseek-v4-flash" },
  { id: "openai", label: "OpenAI", model: "gpt-4.1-mini" },
  { id: "minimax", label: "MiniMax", model: "MiniMax-M1" },
  { id: "zhipu", label: "Zhipu", model: "glm-4-flash" },
  { id: "anthropic", label: "Anthropic", model: "claude-3-5-haiku-latest" }
];

const PROFILE_STORAGE_KEY = "mob-graphwar-profile-id";
const SESSION_STORAGE_KEY = "mob-graphwar-session-token";
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

function battleStats(state) {
  const events = state.events || [];
  const failures = events.filter((event) => ["blocked", "ground", "out", "miss", "invalid"].includes(event.result)).length;
  return {
    shots: events.length,
    enemyHits: events.filter((event) => event.result === "hitEnemy").length,
    allyHits: events.filter((event) => event.result === "hitAlly").length,
    failures,
    damage: events.reduce((sum, event) => sum + (Number(event.damage) || 0), 0)
  };
}

function currentActorLabel(state, activeUnitId, latestEvent) {
  if (state.winner) {
    const unit = latestEvent?.unitId || latestEvent?.shooterId || "final";
    return `${unit} settled`;
  }
  return activeUnitId === "-" ? "standby" : `${activeUnitId} resolving`;
}

function battleResultLabel(winner) {
  if (!winner) return "";
  return winner === "draw" ? "Draw" : `Team ${winner} wins`;
}

function eventDecision(event) {
  if (!event) return null;
  return {
    action: "shot",
    team: event.team,
    unitId: event.unitId || event.shooterId,
    provider: event.provider || "Exhibition AI",
    result: event.resultLabel,
    publicReason: event.combo ? `${event.combo.name} into ${event.targetId}` : event.targetId
  };
}

function frameDecision(frame) {
  if (!frame || !frame.action) return null;
  return {
    action: frame.action.action,
    team: frame.action.team,
    unitId: frame.action.unitId,
    provider: frame.action.provider,
    result: frame.action.resultLabel,
    publicReason: frame.action.publicReason || frame.action.event?.resultLabel || frame.action.candidateId
  };
}

function rulesSnapshot(state, activeUnitId, command) {
  const unit = state.units.find((item) => item.id === activeUnitId) || Sim.getActiveUnit(state) || state.units[0];
  const unitId = unit?.id || activeUnitId || "A1";
  const team = unit?.team || (String(unitId).startsWith("B") ? "B" : "A");
  const handState = state.hands?.[unitId] || {};
  const swapsUsed = Number(handState.swapsUsed ?? handState.rerollsUsed) || 0;
  const swapsRemaining = Math.max(0, Sim.CONFIG.maxRerollsPerTurn - swapsUsed);
  const hand = Sim.getCurrentHand(state, unitId);
  const shotActions = Sim.listLegalShots(state, unitId, command || "").slice(0, 12);
  const legalActions = [
    ...(swapsRemaining > 0 ? [{ action: "swap_hand", swapsUsed, swapsRemaining }] : []),
    ...shotActions.map((shot) => ({
      action: "shot",
      candidateId: shot.candidateId,
      targetId: shot.targetId,
      cost: shot.cost,
      combo: shot.combo?.name || "Mixed Curve"
    }))
  ];
  const allyIds = state.units.filter((item) => item.team === team && item.hp > 0).map((item) => item.id);
  const opponentIds = state.units.filter((item) => item.team !== team && item.hp > 0).map((item) => item.id);
  return {
    activeUnitId: unitId,
    team,
    objective: "eliminate opposing team while avoiding allied units",
    allyIds,
    opponentIds,
    hand: {
      owner: unitId,
      retained: true,
      swapsUsed,
      swapsRemaining,
      analysis: Sim.analyzeHand(hand, Sim.getEnergy(state.turn)),
      cards: hand.map((card) => ({ id: card.id, label: card.label, family: card.family, cost: card.cost }))
    },
    legalActions
  };
}

function delayFrame(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function App() {
  const [profile, setProfile] = useState(null);
  const [sessionToken, setSessionToken] = useState("");
  const [match, setMatch] = useState(null);
  const [battleState, setBattleState] = useState(createExhibitionBattle);
  const [battlePlayback, setBattlePlayback] = useState(null);
  const [playbackDeck, setPlaybackDeck] = useState([]);
  const [playbackPaused, setPlaybackPaused] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [login, setLogin] = useState({
    authMode: "register",
    handle: "clock",
    displayName: "Clock",
    password: "",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: "",
    standingOrder: ""
  });
  const [busy, setBusy] = useState(false);
  const [leagueBusy, setLeagueBusy] = useState(false);
  const [message, setMessage] = useState("Watching an exhibition AI duel. Sign in to enter ranked 2v2.");
  const [lastDecision, setLastDecision] = useState(null);
  const [queueState, setQueueState] = useState(null);
  const [leagueResult, setLeagueResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [autoBattle, setAutoBattle] = useState(null);
  const playbackToken = useRef(0);
  const playbackFramesRef = useRef([]);
  const playbackPausedRef = useRef(false);
  const playbackSpeedRef = useRef(1);
  const autoStartRef = useRef("");

  const latestEvent = battleState.events[battleState.events.length - 1];
  const activeUnit = battleState.winner ? null : Sim.getActiveUnit(battleState);
  const activeUnitId = activeUnit?.id || "-";
  const activeTeam = activeUnit?.team || "-";
  const displayTeam = activeTeam === "-" ? latestEvent?.team || battleState.winner || "A" : activeTeam;
  const displayUnitId = activeUnitId === "-" ? latestEvent?.unitId || latestEvent?.shooterId || (displayTeam === "B" ? "B1" : "A1") : activeUnitId;
  const activeHand = useMemo(() => Sim.getCurrentHand(battleState, displayUnitId), [battleState, displayUnitId]);
  const visibleDecision = lastDecision || eventDecision(latestEvent);

  useEffect(() => {
    if (!profile || !queueState || match) return undefined;
    const timer = window.setInterval(() => {
      pollMatchmaking(profile.id).catch((err) => setMessage(err.message || "Queue sync failed."));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [profile?.id, queueState?.status, queueState?.queueSize, match?.id]);

  useEffect(() => {
    playbackPausedRef.current = playbackPaused;
  }, [playbackPaused]);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  function authorizedHeaders(extra = {}, token = sessionToken) {
    return {
      ...extra,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  function rememberSession(payload) {
    if (!payload?.player) return;
    setProfile(payload.player);
    window.localStorage.setItem(PROFILE_STORAGE_KEY, payload.player.id);
    if (payload.sessionToken) {
      setSessionToken(payload.sessionToken);
      window.localStorage.setItem(SESSION_STORAGE_KEY, payload.sessionToken);
    }
  }

  async function saveProviderSettings() {
    if (!profile || !sessionToken) throw new Error("missing_session");
    const response = await fetch("/api/profile/providers", {
      method: "POST",
      headers: authorizedHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        providers: {
          [login.provider]: { apiKey: login.apiKey, model: login.model }
        }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "provider_update_failed");
    setProfile(payload.player);
    window.localStorage.setItem(PROFILE_STORAGE_KEY, payload.player.id);
    setMessage(`${login.provider} model vault updated. Ranked queue is ready.`);
    return payload.player;
  }

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    try {
      if (profile && sessionToken) {
        await saveProviderSettings();
        return;
      }
      const endpoint = login.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: login.handle,
          displayName: login.displayName,
          password: login.password,
          providers: {
            [login.provider]: { apiKey: login.apiKey, model: login.model }
          }
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "login_failed");
      rememberSession(payload);
      await loadLeaderboard();
      setMessage(login.authMode === "login" ? "Secure session restored. Join ranked matchmaking." : "Secure session created. Join ranked matchmaking.");
    } catch (err) {
      setMessage(err.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreProfile() {
    const storedId = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    const storedToken = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!storedId || !storedToken) {
      setMessage("No saved secure ranked session on this device.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/session/me", {
        headers: authorizedHeaders({}, storedToken)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "restore_failed");
      setProfile(payload.player);
      setSessionToken(storedToken);
      setLogin((current) => ({ ...current, handle: payload.player.handle || current.handle, displayName: payload.player.displayName }));
      await loadLeaderboard();
      const status = await pollMatchmaking(payload.player.id);
      if (!status || status.status === "idle") {
        setMessage(`Restored ${payload.player.displayName} at ${payload.player.rank.rating}.`);
      }
    } catch (err) {
      window.localStorage.removeItem(PROFILE_STORAGE_KEY);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      setSessionToken("");
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
    playbackToken.current += 1;
    const response = await fetch(`/api/match/${matchId}?playerId=${playerId}`, {
      headers: authorizedHeaders()
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "room_sync_failed");
    const room = payload.match;
    setMatch(room);
    setBattleState(room.state);
    setBattlePlayback(null);
    setPlaybackDeck([]);
    playbackFramesRef.current = [];
    setPlaybackPaused(false);
    setLastDecision(null);
    setQueueState(null);
    setAutoBattle(null);
    setMessage(`Room synced: ${room.status}.`);
    if (room.status !== "resolved" && !room.state?.winner) {
      await autoStartRankedDuel(room, playerId);
    }
    return room;
  }

  async function pollMatchmaking(playerId = profile?.id) {
    if (!playerId) return null;
    const response = await fetch(`/api/matchmaking/${playerId}`, {
      headers: authorizedHeaders()
    });
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
    if (!profile || !sessionToken) {
      setMessage("Sign in before joining ranked matchmaking.");
      return;
    }
    const opts = options || {};
    setBusy(true);
    try {
      const response = await fetch("/api/match/join", {
        method: "POST",
        headers: authorizedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ preferredProvider: login.provider, allowAiFill: opts.allowAiFill !== false })
      });
      const payload = await response.json();
      if (response.status === 202) {
        setQueueState({ ...payload, polling: true });
        setMessage(`Waiting for humans. ${payload.queueSize}/4 commanders queued.`);
        return;
      }
      if (!response.ok) throw new Error(payload.error || "matchmaking_failed");
      playbackToken.current += 1;
      setMatch(payload.match);
      setBattleState(payload.match.state);
      setBattlePlayback(null);
      setPlaybackDeck([]);
      playbackFramesRef.current = [];
      setPlaybackPaused(false);
      setLastDecision(null);
      setQueueState(null);
      setAutoBattle(null);
      setMessage(payload.match.filledByAi ? "AI filled ally and rivals. Auto duel launching." : "Ranked lobby matched. Auto duel launching.");
      await autoStartRankedDuel(payload.match, profile.id);
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
              command: login.standingOrder || "safe high arc target weakest enemy avoid ally"
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

  function showPlaybackFrame(frame, index, total, active) {
    if (!frame) return;
    setBattleState(frame.state);
    setLastDecision(frameDecision(frame));
    setBattlePlayback({
      active,
      index: index + 1,
      total,
      action: frame.action,
      winner: frame.state.winner || null
    });
  }

  async function waitPlaybackDelay(baseMs, token) {
    let remaining = Math.max(80, Math.round(baseMs / Math.max(0.5, playbackSpeedRef.current)));
    while (remaining > 0) {
      if (playbackToken.current !== token) return false;
      if (playbackPausedRef.current) {
        await delayFrame(120);
        continue;
      }
      const step = Math.min(120, remaining);
      await delayFrame(step);
      remaining -= step;
    }
    return playbackToken.current === token;
  }

  async function playAutoBattleFrames(frames, finalMatch, summary, startIndex = 0, preserveDeck = false) {
    const frameList = Array.isArray(frames) && frames.length ? frames : [];
    const token = playbackToken.current + 1;
    playbackToken.current = token;
    if (!preserveDeck) {
      setPlaybackDeck(frameList);
      playbackFramesRef.current = frameList;
    }
    setPlaybackPaused(false);
    playbackPausedRef.current = false;
    if (!frameList.length) {
      setBattleState(finalMatch.state);
      setBattlePlayback(null);
      return;
    }
    for (let index = Math.max(0, Math.min(frameList.length - 1, startIndex)); index < frameList.length; index += 1) {
      if (playbackToken.current !== token) return;
      const frame = frameList[index];
      showPlaybackFrame(frame, index, frameList.length, true);
      const keepPlaying = await waitPlaybackDelay(index === 0 ? 240 : 520, token);
      if (!keepPlaying) return;
    }
    if (playbackToken.current !== token) return;
    setBattleState(finalMatch.state);
    setPlaybackPaused(false);
    setBattlePlayback({
      active: false,
      index: frameList.length,
      total: frameList.length,
      action: frameList[frameList.length - 1].action,
      winner: summary?.winner || finalMatch.state.winner || "draw"
    });
  }

  function stepPlayback(delta) {
    const frames = playbackFramesRef.current;
    if (!frames.length) return;
    playbackToken.current += 1;
    setPlaybackPaused(true);
    playbackPausedRef.current = true;
    const currentIndex = Math.max(0, (battlePlayback?.index || 1) - 1);
    const nextIndex = Math.min(frames.length - 1, Math.max(0, currentIndex + delta));
    showPlaybackFrame(frames[nextIndex], nextIndex, frames.length, false);
  }

  function resumePlayback() {
    const frames = playbackFramesRef.current;
    if (!frames.length) return;
    const startIndex = Math.max(0, (battlePlayback?.index || 1) - 1);
    const finalMatch = { state: frames[frames.length - 1].state };
    const summary = { winner: frames[frames.length - 1].state.winner || "draw" };
    setPlaybackPaused(false);
    playbackPausedRef.current = false;
    playAutoBattleFrames(frames, finalMatch, summary, startIndex, true);
  }

  function togglePlayback() {
    if (!playbackFramesRef.current.length) return;
    if (playbackPaused || battlePlayback?.active === false) {
      resumePlayback();
      return;
    }
    setPlaybackPaused(true);
    playbackPausedRef.current = true;
  }

  function changePlaybackSpeed(speed) {
    const nextSpeed = Number(speed);
    if (![0.5, 1, 2].includes(nextSpeed)) return;
    setPlaybackSpeed(nextSpeed);
    playbackSpeedRef.current = nextSpeed;
  }

  async function autoStartRankedDuel(room = match, playerId = profile?.id) {
    if (!room || !playerId || room.status === "resolved" || room.state?.winner) return room;
    const lockKey = `${room.id}:${playerId}`;
    if (autoStartRef.current === lockKey) return room;
    autoStartRef.current = lockKey;
    setMessage("Match ready. Models are resolving the full duel.");
    try {
      const response = await fetch(`/api/match/${room.id}/auto-duel`, {
        method: "POST",
        headers: authorizedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ command: login.standingOrder })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "auto_duel_failed");
      setProfile(payload.player);
      setMatch(payload.match);
      setAutoBattle({ ...payload.autoBattle, rankDelta: payload.rankDelta, rating: payload.player.rank.rating });
      window.localStorage.setItem(PROFILE_STORAGE_KEY, payload.player.id);
      await playAutoBattleFrames(payload.autoBattle?.frames, payload.match, payload.autoBattle);
      await loadLeaderboard();
      setLastDecision({
        action: "auto duel",
        team: payload.match.state.winner || "draw",
        provider: "Battle Engine",
        result: `${payload.autoBattle?.resolvedTurns || 0} turns`,
        publicReason: `Rank ${payload.rankDelta > 0 ? "+" : ""}${payload.rankDelta}; rating ${payload.player.rank.rating}.`
      });
      setMessage(`Auto duel complete. ${payload.match.state.winner || "draw"} result, rank ${payload.rankDelta > 0 ? "+" : ""}${payload.rankDelta}.`);
      return payload.match;
    } catch (err) {
      setMessage(err.message || "Auto duel failed.");
      return null;
    } finally {
      if (autoStartRef.current === lockKey) autoStartRef.current = "";
    }
  }

  return (
    <main className="arena-shell battle-priority-layout mobile-game-compact" data-ui-version="react-arena-v2">
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
            sessionToken={sessionToken}
            match={match}
            queueState={queueState}
            autoBattle={autoBattle}
            busy={busy}
            onSubmit={signIn}
            onRestore={restoreProfile}
            onJoin={joinMatch}
            onSync={syncCurrentRoom}
          />
          <RosterCard match={match} />
          <LeaderboardPanel players={leaderboard} profile={profile} onRefresh={loadLeaderboard} />
        </aside>

        <section className="battle-panel game-panel">
          <BattleHeader state={battleState} activeTeam={activeTeam} activeUnitId={activeUnitId} message={message} />
          <SpectatorHud state={battleState} activeTeam={activeTeam} match={match} />
          <BattlePlaybackHud
            playback={battlePlayback}
            paused={playbackPaused}
            speed={playbackSpeed}
            canControl={playbackDeck.length > 0}
            onToggle={togglePlayback}
            onStep={stepPlayback}
            onSpeed={changePlaybackSpeed}
          />
          <section className="arena-stage" aria-label="AI duel stage">
            <VersusBanner state={battleState} match={match} activeTeam={activeTeam} />
            <ArenaDirectorHud
              state={battleState}
              match={match}
              profile={profile}
              activeTeam={activeTeam}
              activeUnitId={activeUnitId}
              latestEvent={latestEvent}
              autoBattle={autoBattle}
              playback={battlePlayback}
            />
            <LiveModelTelemetryPanel
              state={battleState}
              match={match}
              playback={battlePlayback}
              lastDecision={visibleDecision}
              activeUnitId={activeUnitId}
            />
            <BattleBroadcastPanel
              state={battleState}
              match={match}
              activeTeam={activeTeam}
              activeUnitId={activeUnitId}
              latestEvent={latestEvent}
              playback={battlePlayback}
              lastDecision={visibleDecision}
            />
            <Battlefield state={battleState} latestEvent={latestEvent} />
            <AgentBattleMatrix state={battleState} match={match} activeTeam={activeTeam} activeUnitId={activeUnitId} lastDecision={visibleDecision} />
            <BattleReplayRail state={battleState} />
            <DuelCommanders state={battleState} match={match} activeTeam={activeTeam} lastDecision={visibleDecision} />
          </section>
        </section>

        <aside className="tactical-panel game-panel">
          <HandRack hand={activeHand} activeTeam={displayTeam} activeUnitId={displayUnitId} />
          <Timeline state={battleState} />
          <AutoDuelPanel autoBattle={autoBattle} state={battleState} />
          <RulesPacketPanel state={battleState} activeUnitId={displayUnitId} standingOrder={login.standingOrder} />
          <ModelDecisionStack state={battleState} lastDecision={visibleDecision} />
          <ModelWarFeed state={battleState} lastDecision={visibleDecision} />
          <ShotIntel event={latestEvent} state={battleState} />
          <LeagueLab result={leagueResult} busy={leagueBusy} onRun={runLeague} />
        </aside>
      </section>
      <MobileSpectatorDock
        profile={profile}
        queueState={queueState}
        match={match}
        state={battleState}
        activeUnitId={activeUnitId}
        autoBattle={autoBattle}
      />
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

function LaunchBay({
  login,
  setLogin,
  profile,
  sessionToken,
  match,
  queueState,
  autoBattle,
  busy,
  onSubmit,
  onRestore,
  onJoin,
  onSync
}) {
  const readySteps = [
    { label: "Account", value: profile ? profile.handle || profile.displayName : "Guest" },
    { label: "Model", value: profile?.providers?.[login.provider]?.configured || login.apiKey.trim() ? login.model : "Local fallback" },
    { label: "Room", value: match ? match.status : queueState ? "queued" : "not matched" },
    { label: "Control", value: "Watch-only after launch" }
  ];
  return (
    <section className="launch-bay" data-testid="launch-bay">
      <div className="launch-header">
        <div>
          <span>Ranked launch bay</span>
          <strong>{profile ? `${profile.rank.tier} ${profile.rank.rating}` : "Login to arm model"}</strong>
        </div>
        <b>{match?.filledByAi ? "AI FILL" : match ? "2V2" : "READY"}</b>
      </div>
      <div className="launch-steps">
        {readySteps.map((step) => (
          <span key={step.label}><b>{step.label}</b>{step.value}</span>
        ))}
      </div>
      <RankedFlowPanel profile={profile} sessionToken={sessionToken} match={match} queueState={queueState} login={login} />
      <RankedGameStatePanel profile={profile} match={match} queueState={queueState} autoBattle={autoBattle} />
      <SessionStatusPanel profile={profile} sessionToken={sessionToken} login={login} />
      <LoginCard login={login} setLogin={setLogin} profile={profile} sessionToken={sessionToken} busy={busy} onSubmit={onSubmit} onRestore={onRestore} />
      <MatchCard
        profile={profile}
        match={match}
        queueState={queueState}
        busy={busy}
        onJoin={onJoin}
        onSync={onSync}
      />
    </section>
  );
}

function RankedGameStatePanel({ profile, match, queueState, autoBattle }) {
  const roster = match?.roster?.length ? match.roster : [];
  const playerSeat = roster.find((seat) => seat.playerId && seat.playerId === profile?.id);
  const playerTeam = autoBattle?.playerTeam || playerSeat?.team || "-";
  const rankDelta = Number.isFinite(Number(autoBattle?.rankDelta)) ? Number(autoBattle?.rankDelta) : null;
  const isSettled = Boolean(autoBattle || match?.state?.winner);
  const phase = isSettled ? "Rank settled" : match ? "Resolving" : queueState ? "Queue" : profile ? "Armed" : "Booting";
  const stateNodes = [
    {
      label: "Queue",
      value: queueState ? `${queueState.queueSize}/4 humans` : match ? "closed" : "idle",
      ready: Boolean(queueState || match || autoBattle),
      active: Boolean(queueState && !match)
    },
    {
      label: "Matched",
      value: match ? (match.filledByAi ? "AI fill" : "2v2 humans") : "waiting",
      ready: Boolean(match || autoBattle),
      active: Boolean(match && !autoBattle && !match?.state?.winner)
    },
    {
      label: "Resolving",
      value: match ? "AI auto-battle" : "standby",
      ready: Boolean(match || autoBattle),
      active: Boolean(match && !autoBattle && !match?.state?.winner)
    },
    {
      label: "Rank settled",
      value: rankDelta === null ? "pending" : `${rankDelta > 0 ? "+" : ""}${rankDelta}`,
      ready: Boolean(autoBattle),
      active: Boolean(autoBattle)
    }
  ];
  const teamSeats = (team) => roster.filter((seat) => seat.team === team);
  const settlementCopy = autoBattle
    ? `${battleResultLabel(autoBattle.winner)} · ${autoBattle.resolvedTurns} turns · Team ${playerTeam}`
    : match
      ? "Models are resolving without mid-duel commands."
      : "Queue a ranked room, then watch the AIs fight unattended.";
  return (
    <div className="ranked-game-state-panel" data-testid="ranked-game-state-panel" aria-label="Ranked auto-battle game state">
      <div className="ranked-state-header">
        <span>Auto-battle loop</span>
        <strong>{phase}</strong>
        <small>{match?.filledByAi ? "Quick AI Fill" : match ? "Human room" : queueState ? "Waiting for room" : "No active room"}</small>
      </div>
      <div className="ranked-state-timeline">
        {stateNodes.map((node, index) => (
          <div className={`state-node ${node.ready ? "ready" : ""} ${node.active ? "active" : ""}`} key={node.label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{node.label}</strong>
            <small>{node.value}</small>
          </div>
        ))}
      </div>
      <div className="team-assignment-grid">
        {["A", "B"].map((team) => {
          const seats = teamSeats(team);
          return (
            <article className={team === playerTeam ? "player-team" : ""} key={team}>
              <span>{team === playerTeam ? "Your team" : "Opponent team"}</span>
              <strong>Team {team}</strong>
              <small>{seats.length ? seats.map((seat) => `${seat.unitId} ${seat.displayName}`).join(" / ") : "awaiting seats"}</small>
            </article>
          );
        })}
      </div>
      <div className="rank-settlement-card">
        <span>Rank settlement</span>
        <strong>{rankDelta === null ? "Pending" : `${rankDelta > 0 ? "+" : ""}${rankDelta}`}</strong>
        <small>{settlementCopy}</small>
      </div>
    </div>
  );
}

function LoginCard({ login, setLogin, profile, sessionToken, busy, onSubmit, onRestore }) {
  const authMode = login.authMode === "login" ? "login" : "register";
  return (
    <form className="login-card" onSubmit={onSubmit}>
      <div className="panel-title"><LogIn size={18} /> Account / Model Key</div>
      <div className="auth-mode-tabs" data-testid="auth-mode-tabs" role="tablist" aria-label="Account mode">
        <button type="button" className={authMode === "register" ? "active" : ""} aria-selected={authMode === "register"} onClick={() => setLogin({ ...login, authMode: "register" })}>Register</button>
        <button type="button" className={authMode === "login" ? "active" : ""} aria-selected={authMode === "login"} onClick={() => setLogin({ ...login, authMode: "login" })}>Sign In</button>
      </div>
      <label>Handle<input autoComplete="username" value={login.handle} onChange={(e) => setLogin({ ...login, handle: e.target.value })} placeholder="3-24 letters, numbers, _ or -" /></label>
      {authMode === "register" ? (
        <label>Display name<input autoComplete="nickname" value={login.displayName} onChange={(e) => setLogin({ ...login, displayName: e.target.value })} /></label>
      ) : null}
      <label>Password<input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} placeholder="8+ characters" /></label>
      <label>Provider<select value={login.provider} onChange={(e) => setLogin({ ...login, provider: e.target.value })}>
        <option value="deepseek">DeepSeek</option>
        <option value="openai">OpenAI</option>
        <option value="minimax">MiniMax</option>
        <option value="zhipu">Zhipu</option>
        <option value="anthropic">Anthropic</option>
      </select></label>
      <label>Model<input autoComplete="off" value={login.model} onChange={(e) => setLogin({ ...login, model: e.target.value })} /></label>
      <label>API key<input type="password" autoComplete="current-password" value={login.apiKey} onChange={(e) => setLogin({ ...login, apiKey: e.target.value })} placeholder="Stored only for this browser session" /></label>
      <ProviderReadinessGrid login={login} profile={profile} />
      <label>Standing order<textarea maxLength={80} value={login.standingOrder} onChange={(e) => setLogin({ ...login, standingOrder: e.target.value })} placeholder="Optional 80-character instruction before matchmaking" /></label>
      <div className="profile-vault">
        <span>{profile ? `${profile.handle || profile.displayName} · ${profile.rank.tier} ${profile.rank.rating} · ${sessionToken ? "secure" : "no token"}` : "No active ranked account"}</span>
        <button type="button" disabled={busy} onClick={onRestore}>Restore</button>
      </div>
      <button disabled={busy}>{profile ? "Save Model Key" : authMode === "login" ? "Sign In" : "Create Account"}</button>
    </form>
  );
}

function RankedFlowPanel({ profile, sessionToken, match, queueState, login }) {
  const steps = [
    { id: "account", label: "Account", value: profile && sessionToken ? "secure session" : profile ? "profile only" : "guest", ready: Boolean(profile && sessionToken) },
    { id: "model", label: "Model", value: profile?.providers?.[login.provider]?.configured || login.apiKey.trim() ? "API key armed" : "local fallback", ready: Boolean(profile?.providers?.[login.provider]?.configured || login.apiKey.trim()) },
    { id: "match", label: "Match", value: match ? match.status : queueState ? "queue live" : "not queued", ready: Boolean(match || queueState) },
    { id: "watch", label: "Watch", value: match ? "auto duel" : "exhibition", ready: Boolean(match) },
    { id: "rank", label: "Rank", value: profile ? `${profile.rank.tier} ${profile.rank.rating}` : "unrated", ready: Boolean(profile?.rank?.games) }
  ];
  return (
    <div className="ranked-flow-panel" data-testid="ranked-flow-panel" aria-label="Ranked game flow">
      {steps.map((step, index) => (
        <div className={`flow-step ${step.ready ? "ready" : ""}`} key={step.id}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{step.label}</strong>
          <small>{step.value}</small>
        </div>
      ))}
    </div>
  );
}

function SessionStatusPanel({ profile, sessionToken, login }) {
  const selectedProvider = profile?.providers?.[login.provider];
  const modelReady = Boolean(selectedProvider?.configured || login.apiKey.trim());
  return (
    <div className="session-status-panel" data-testid="session-status-panel" aria-label="Secure account and model vault status">
      <span className={profile && sessionToken ? "ready" : ""}>
        <Shield size={16} />
        <b>Secure session</b>
        <small>{profile && sessionToken ? "Bearer token active" : "Sign in to unlock ranked queue"}</small>
      </span>
      <span className={modelReady ? "ready" : ""}>
        <KeyRound size={16} />
        <b>Model vault</b>
        <small>{modelReady ? `${login.provider} / ${selectedProvider?.model || login.model}` : "BYOK key or local fallback"}</small>
      </span>
    </div>
  );
}

function ProviderReadinessGrid({ login, profile }) {
  const keyed = Boolean(login.apiKey.trim() || profile?.providers?.[login.provider]?.configured);
  return (
    <div className="provider-readiness-grid" data-testid="provider-readiness-grid" aria-label="Model provider readiness">
      {MODEL_PROVIDERS.map((provider) => {
        const selected = login.provider === provider.id;
        return (
          <span className={selected ? "selected" : ""} key={provider.id}>
            <b>{provider.label}</b>
            <small>{selected && keyed ? "API key armed" : selected ? "local fallback until keyed" : provider.model}</small>
          </span>
        );
      })}
    </div>
  );
}

function MatchCard({ profile, match, queueState, busy, onJoin, onSync }) {
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
      <div className="spectator-lock-strip" data-testid="spectator-lock">
        <Shield size={15} />
        <span><b>Spectator lock</b> One standing order before launch, then models fight unattended.</span>
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
    </div>
  );
}

function MobileSpectatorDock({ profile, queueState, match, state, activeUnitId, autoBattle }) {
  const dock = {
    ranked: profile ? `${profile.rank.tier} ${profile.rank.rating}` : "guest",
    queue: queueState ? `${queueState.queueSize}/4` : match ? match.status : "idle",
    actor: activeUnitId === "-" ? state.winner || "standby" : activeUnitId,
    result: state.winner ? battleResultLabel(state.winner) : autoBattle ? `${autoBattle.resolvedTurns} turns` : "watching"
  };
  return (
    <nav className="mobile-spectator-dock" data-testid="mobile-spectator-dock" aria-label="Mobile spectator status">
      <span><b>Rank</b>{dock.ranked}</span>
      <span><b>Queue</b>{dock.queue}</span>
      <span><b>AI</b>{dock.actor}</span>
      <span><b>Result</b>{dock.result}</span>
    </nav>
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

function VersusBanner({ state, match, activeTeam }) {
  const roster = match?.roster?.length ? match.roster : DEFAULT_ROSTER;
  const side = (team) => {
    const health = teamHealth(state, team);
    const names = roster.filter((seat) => seat.team === team).map((seat) => seat.displayName).join(" / ");
    return { health, names: names || `Team ${team}` };
  };
  const a = side("A");
  const b = side("B");
  const resultLabel = battleResultLabel(state.winner);
  return (
    <div className="versus-banner" data-testid="versus-banner">
      <div className={`versus-side team-a ${activeTeam === "A" ? "active" : ""}`}>
        <span>Team A</span>
        <strong>{a.names}</strong>
        <small>{a.health.hp}/{a.health.max} HP · {a.health.alive} online</small>
      </div>
      <div className="versus-core">
        <b>VS</b>
        <span>{resultLabel || `Turn ${state.turn + 1}`}</span>
      </div>
      <div className={`versus-side team-b ${activeTeam === "B" ? "active" : ""}`}>
        <span>Team B</span>
        <strong>{b.names}</strong>
        <small>{b.health.hp}/{b.health.max} HP · {b.health.alive} online</small>
      </div>
    </div>
  );
}

function ArenaDirectorHud({ state, match, profile, activeTeam, activeUnitId, latestEvent, autoBattle, playback }) {
  const stats = battleStats(state);
  const complexity = state.mapMeta?.complexity || {};
  const teamA = teamHealth(state, "A");
  const teamB = teamHealth(state, "B");
  const actor = currentActorLabel(state, activeUnitId, latestEvent);
  const rankDelta = Number.isFinite(Number(autoBattle?.rankDelta)) ? Number(autoBattle.rankDelta) : null;
  const rankText = rankDelta === null ? `${profile?.rank?.rating || 1000} rating` : `${rankDelta > 0 ? "+" : ""}${rankDelta} / ${autoBattle?.rating || profile?.rank?.rating || 1000}`;
  const resultLabel = battleResultLabel(state.winner);
  const latestKey = latestEvent ? `${latestEvent.turn}-${latestEvent.unitId || latestEvent.shooterId}-${latestEvent.result}` : "pre-battle";
  const pressure = complexity.routePressure || 0;
  const tempo = playback?.active ? "live replay" : state.winner ? "settled" : match ? "models armed" : "exhibition";
  const hudTeam = activeTeam !== "-" ? activeTeam : latestEvent?.team || "A";
  return (
    <motion.section
      className={`arena-director-hud team-${String(hudTeam).toLowerCase()} ${state.winner ? "settled" : "live"}`}
      data-testid="arena-director-hud"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      <div className="director-callout">
        <span>{tempo}</span>
        <strong>{actor}</strong>
        <small>{resultLabel || `Team ${hudTeam} has initiative`}</small>
      </div>
      <div className="director-scoreline">
        <span><b>{teamA.hp}</b> Team A HP</span>
        <i aria-hidden="true" />
        <span><b>{teamB.hp}</b> Team B HP</span>
      </div>
      <div className="director-map-pressure">
        <span>routePressure</span>
        <strong>{pressure}</strong>
        <small>{complexity.obstacleCount || 0} blockers / {complexity.layerCount || 0} layers</small>
      </div>
      <div className="director-rank-stake">
        <Trophy size={18} />
        <span>rank stake</span>
        <strong>{rankText}</strong>
        <small>{state.score ? `${state.score.rank} ${state.score.value}` : `${profile?.rank?.tier || "Bronze"} queue`}</small>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          className={`director-feed team-${String(latestEvent?.team || hudTeam).toLowerCase()}`}
          key={latestKey}
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -14 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <span>{latestEvent ? `T${latestEvent.turn + 1} ${latestEvent.unitId || latestEvent.shooterId}` : "pre-battle"}</span>
          <strong>{latestEvent ? latestEvent.resultLabel : "waiting for first shot"}</strong>
          <small>{stats.enemyHits} hits / {stats.failures} failed lines / {stats.damage} dmg</small>
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}

function LiveModelTelemetryPanel({ state, match, playback, lastDecision, activeUnitId }) {
  const roster = match?.roster?.length ? match.roster : DEFAULT_ROSTER;
  const events = state.events || [];
  const turnOrder = state.turnOrder || ["A1", "B1", "A2", "B2"];
  const playbackAction = playback?.action || null;
  const latestForSeat = (unitId) => [...events].reverse().find((event) => event.unitId === unitId || event.shooterId === unitId) || null;
  const telemetryReason = (seat, event, isActive) => {
    if (playbackAction?.unitId === seat.unitId) return playbackAction.publicReason || playbackAction.resultLabel || playbackAction.result || "frame action";
    if (lastDecision?.unitId === seat.unitId || (isActive && lastDecision?.team === seat.team)) return lastDecision.publicReason || lastDecision.result || "model decision";
    if (event) return event.resultLabel || event.combo?.name || "resolved shot";
    return "waiting for model turn";
  };
  const actionForSeat = (seat, event, isActive) => {
    if (playbackAction?.unitId === seat.unitId) return playbackAction.action || "frame";
    if (lastDecision?.unitId === seat.unitId || (isActive && lastDecision?.team === seat.team)) return lastDecision.action || "thinking";
    if (event) return event.result || event.resultLabel || "shot";
    return isActive ? "thinking" : "standby";
  };
  return (
    <section className="live-model-telemetry" data-testid="live-model-telemetry" aria-label="Live model telemetry">
      <div className="model-signal-spine">
        <span>turn order</span>
        {turnOrder.map((unitId) => (
          <b className={unitId === activeUnitId ? "active" : ""} key={unitId}>{unitId}</b>
        ))}
        <small>{playback?.active ? `frame ${playback.index}/${playback.total}` : state.winner ? "resolved" : "live decision loop"}</small>
      </div>
      <div className="telemetry-seat-grid">
        {roster.map((seat) => {
          const unit = state.units.find((item) => item.id === seat.unitId) || { hp: 0 };
          const event = latestForSeat(seat.unitId);
          const isActive = activeUnitId === seat.unitId && !state.winner;
          const action = actionForSeat(seat, event, isActive);
          const reason = telemetryReason(seat, event, isActive);
          return (
            <article className={`telemetry-seat team-${seat.team.toLowerCase()} ${isActive ? "active" : ""} ${unit.hp <= 0 ? "offline" : ""}`} key={seat.unitId}>
              <div>
                <span>{seat.unitId}</span>
                <strong>{seat.displayName}</strong>
              </div>
              <small className="telemetry-provider">{seat.provider}{seat.model ? ` / ${seat.model}` : ""}</small>
              <b className="telemetry-action-chip">{action}</b>
              <small>{reason}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function BattleBroadcastPanel({ state, match, activeTeam, activeUnitId, latestEvent, playback, lastDecision }) {
  const roster = match?.roster?.length ? match.roster : DEFAULT_ROSTER;
  const latestPath = state.paths[state.paths.length - 1] || null;
  const action = playback?.action || null;
  const shooterId = action?.unitId || latestEvent?.unitId || latestEvent?.shooterId || (activeUnitId === "-" ? null : activeUnitId);
  const shooterSeat = roster.find((seat) => seat.unitId === shooterId);
  const targetId = latestEvent?.targetId || action?.targetId || lastDecision?.publicReason || "target pending";
  const targetSeat = roster.find((seat) => seat.unitId === targetId);
  const comboName = latestEvent?.combo?.name || action?.combo?.name || lastDecision?.result || "function combo pending";
  const result = latestEvent?.resultLabel || action?.resultLabel || lastDecision?.result || (state.winner ? battleResultLabel(state.winner) : "waiting for shot");
  const trajectory = latestPath ? `${latestPath.points.length} plotted points` : action ? "replay frame armed" : "no trajectory yet";
  const lane = (team) => {
    const seats = roster.filter((seat) => seat.team === team);
    const health = teamHealth(state, team);
    return { seats, health, active: activeTeam === team || latestEvent?.team === team || action?.team === team };
  };
  const lanes = { A: lane("A"), B: lane("B") };
  return (
    <section className="battle-broadcast-panel" data-testid="battle-broadcast-panel" aria-label="Model duel broadcast">
      <div className="broadcast-header">
        <span>Model duel broadcast</span>
        <strong>{shooterId ? `${shooterId} ${shooterSeat?.displayName || "model"}` : "Models sizing the map"}</strong>
        <small>{match ? "ranked auto-battle feed" : "exhibition feed"}</small>
      </div>
      <div className="broadcast-shot-card">
        <span>Shooter <b>{shooterId || "standby"}</b></span>
        <span>Target <b>{targetSeat ? `${targetId} ${targetSeat.displayName}` : targetId}</b></span>
        <span>Combo <b>{comboName}</b></span>
        <span>Trajectory <b>{trajectory}</b></span>
      </div>
      <div className="broadcast-lanes">
        {["A", "B"].map((team) => (
          <article className={`broadcast-team-lane team-${team.toLowerCase()} ${lanes[team].active ? "active" : ""}`} key={team}>
            <span>Team {team}</span>
            <strong>{lanes[team].health.hp}/{lanes[team].health.max} HP</strong>
            <small>{lanes[team].seats.map((seat) => `${seat.unitId} ${seat.provider}`).join(" / ") || "waiting"}</small>
          </article>
        ))}
      </div>
      <div className={`broadcast-result team-${String(latestEvent?.team || action?.team || activeTeam || "a").toLowerCase()}`}>
        <span>Result</span>
        <strong>{result}</strong>
        <small>{state.score ? `${state.score.rank} score ${state.score.value}` : "battle unresolved"}</small>
      </div>
    </section>
  );
}

function AgentBattleMatrix({ state, match, activeTeam, activeUnitId, lastDecision }) {
  const roster = match?.roster?.length ? match.roster : DEFAULT_ROSTER;
  const events = state.events || [];
  const latestUnitEvent = (unitId) => [...events].reverse().find((event) => event.unitId === unitId || event.shooterId === unitId);
  return (
    <section className="agent-battle-matrix" data-testid="agent-battle-matrix" aria-label="Four AI battle seats">
      {roster.map((seat) => {
        const unit = state.units.find((item) => item.id === seat.unitId) || { hp: 0, team: seat.team };
        const handState = state.hands?.[seat.unitId] || {};
        const hand = Sim.getCurrentHand(state, seat.unitId).slice(0, 4);
        const swapsUsed = Number(handState.swapsUsed ?? handState.rerollsUsed) || 0;
        const swapsRemaining = Math.max(0, Sim.CONFIG.maxRerollsPerTurn - swapsUsed);
        const teamDecision = lastDecision?.unitId === seat.unitId || (activeUnitId === seat.unitId && lastDecision?.team === seat.team) ? lastDecision : null;
        const event = latestUnitEvent(seat.unitId);
        const actionLabel = teamDecision?.action || (event ? event.resultLabel : "standing by");
        const actionReason = teamDecision?.publicReason || event?.combo?.name || "waiting for auto-battle";
        const active = activeUnitId === seat.unitId && activeTeam === seat.team && !state.winner;
        return (
          <article className={`agent-seat team-${seat.team.toLowerCase()} ${active ? "active" : ""} ${unit.hp <= 0 ? "offline" : ""}`} data-testid={`agent-seat-${seat.unitId}`} key={seat.unitId}>
            <div className="agent-vitals">
              <span>{seat.unitId} / Team {seat.team}</span>
              <b>{Math.max(0, unit.hp || 0)} HP</b>
            </div>
            <div className="agent-identity">
              <strong>{seat.displayName}</strong>
              <small>{seat.provider}{seat.model ? ` / ${seat.model}` : ""}</small>
            </div>
            <div className="agent-hp-track" aria-label={`${seat.unitId} HP`}>
              <i style={{ width: `${Math.max(0, Math.min(100, unit.hp || 0))}%` }} />
            </div>
            <div className="agent-hand-strip" aria-label={`${seat.unitId} retained hand`}>
              {hand.map((card) => (
                <span key={`${seat.unitId}-${card.instanceId}`}>
                  {card.label}<b>{card.cost}</b>
                </span>
              ))}
            </div>
            <div className="agent-action-beam">
              <span>{active ? "ACTIVE" : unit.hp <= 0 ? "OFFLINE" : "WATCHING"}</span>
              <strong>{actionLabel}</strong>
              <small>{actionReason}</small>
            </div>
            <div className="agent-economy">
              <span>swapsRemaining <b>{swapsRemaining}</b></span>
              <span>retained hand</span>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function BattleHeader({ state, activeTeam, activeUnitId, message }) {
  const resultLabel = battleResultLabel(state.winner);
  const statusLabel = resultLabel && message ? `${resultLabel} · ${message}` : resultLabel || message;
  return (
    <div className="battle-header">
      <div><span>Turn</span><strong>{state.turn}/{Sim.CONFIG.maxTurns}</strong></div>
      <div><span>Active</span><strong>{activeUnitId === "-" ? "Standby" : `${activeUnitId} / Team ${activeTeam}`}</strong></div>
      <div><span>Map</span><strong>{state.mapMeta.name} {state.mapMeta.difficulty}</strong></div>
      <div><span>Status</span><strong>{statusLabel}</strong></div>
    </div>
  );
}

function SpectatorHud({ state, activeTeam, match }) {
  return (
    <div className="spectator-hud" data-testid="spectator-hud">
      <div>
        <span>AI auto-battle</span>
        <strong>{match ? "armed" : "offline"}</strong>
      </div>
      <div>
        <span>Model action</span>
        <strong>shot / swap_hand</strong>
      </div>
      <div>
        <span>Viewer state</span>
        <strong>{state.winner ? "settled" : activeTeam === "-" ? "standby" : "watch only"}</strong>
      </div>
    </div>
  );
}

function BattlePlaybackHud({ playback, paused, speed, canControl, onToggle, onStep, onSpeed }) {
  const progress = playback?.total ? Math.min(100, Math.max(0, (playback.index / playback.total) * 100)) : 0;
  const action = playback?.action || null;
  const playLabel = paused || playback?.active === false ? "Play replay" : "Pause replay";
  const stateLabel = paused ? "Paused replay" : playback?.active ? "Live playback" : "Playback";
  return (
    <div className={`battle-playback ${playback?.active && !paused ? "playing" : ""} ${paused ? "paused" : ""} ${!playback ? "idle" : ""}`} data-testid="battle-playback">
      <div>
        <span>{stateLabel}</span>
        <strong>{action ? `${action.action} · Team ${action.team}` : "standby"}</strong>
      </div>
      <div className="playback-bar" aria-label="Battle playback progress">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div>
        <span>{playback?.total ? `${playback.index}/${playback.total} frames` : "0/0 frames"}</span>
        <strong>{action?.provider || playback?.winner || "waiting"}</strong>
      </div>
      <div className="playback-controls" data-testid="playback-controls">
        <button type="button" aria-label="Previous replay frame" disabled={!canControl} onClick={() => onStep(-1)}>
          <SkipBack size={15} />
        </button>
        <button type="button" aria-label={playLabel} disabled={!canControl} onClick={onToggle}>
          {paused || playback?.active === false ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
        </button>
        <button type="button" aria-label="Next replay frame" disabled={!canControl} onClick={() => onStep(1)}>
          <SkipForward size={15} />
        </button>
        <div className="speed-strip" aria-label="Replay speed">
          <Gauge size={14} />
          {[0.5, 1, 2].map((value) => (
            <button
              type="button"
              className={speed === value ? "active" : ""}
              disabled={!canControl}
              onClick={() => onSpeed(value)}
              key={value}
            >
              {value}x
            </button>
          ))}
        </div>
      </div>
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

function RouteMazeLayer({ state }) {
  const obstacles = state.obstacles || [];
  const mazeBands = obstacles.filter((obstacle) => obstacle.role === "maze-band");
  const gateSlits = obstacles.filter((obstacle) => obstacle.role === "gate-slit");
  const threadSlots = obstacles.filter((obstacle) => obstacle.role === "thread-slot");
  const visibleBands = mazeBands.slice(0, 14);
  return (
    <g className="route-maze-layer" data-testid="route-maze-layer" aria-hidden="true">
      {visibleBands.filter((obstacle) => obstacle.y >= 30).map((obstacle) => (
        <rect
          key={`fog-${obstacle.id}`}
          className={`depth-fog layer-${obstacle.visualLayer || 1}`}
          x={sx(Math.max(0, obstacle.x - 2))}
          y={Math.max(0, sy(obstacle.y + obstacle.h) - 24)}
          width={(obstacle.w + 4) * 10}
          height={Math.max(26, obstacle.h * 10 + 32)}
          rx="8"
        />
      ))}
      {visibleBands.map((obstacle) => (
        <rect
          key={`band-${obstacle.id}`}
          className={`maze-band layer-${obstacle.visualLayer || 1}`}
          x={sx(obstacle.x)}
          y={sy(obstacle.y + obstacle.h)}
          width={obstacle.w * 10}
          height={Math.max(5, obstacle.h * 10)}
          rx="2"
        />
      ))}
      {gateSlits.slice(0, 12).map((obstacle) => {
        const x = sx(obstacle.x + obstacle.w / 2);
        return (
          <line
            key={`gate-${obstacle.id}`}
            className={`gate-slit layer-${obstacle.visualLayer || 1}`}
            x1={x}
            y1={sy(obstacle.y + obstacle.h)}
            x2={x}
            y2={sy(obstacle.y)}
          />
        );
      })}
      {threadSlots.slice(0, 10).map((obstacle) => (
        <path
          key={`thread-${obstacle.id}`}
          className={`thread-slot layer-${obstacle.visualLayer || 1}`}
          d={`M${sx(obstacle.x)},${sy(obstacle.y + obstacle.h / 2)} L${sx(obstacle.x + obstacle.w)},${sy(obstacle.y + obstacle.h / 2)}`}
        />
      ))}
    </g>
  );
}

function renderObstacleFacets(obstacle, index) {
  const showLabel = index % 4 === 0 || obstacle.h >= 30 || obstacle.y >= 38;
  const role = obstacle.role || "blocker";
  return (
    <g key={obstacle.id} className={`obstacle-cluster role-${role} layer-${obstacle.visualLayer || 1}`}>
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
        <span className="maze-bands">{complexity.mazeBands || 0} bands</span>
        <span className="gate-slits">{complexity.gateSlits || 0} slits</span>
        <span className="thread-slots">{complexity.threadSlots || 0} slots</span>
        <span className="route-pressure">{complexity.routePressure || 0} pressure</span>
        <span className="battlefield-depth">{complexity.layerCount || 0} layers</span>
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
        <RouteMazeLayer state={state} />
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

function BattleReplayRail({ state }) {
  const events = state.events.slice(-10);
  return (
    <div className="battle-replay-rail" data-testid="battle-replay-rail">
      {events.length ? events.map((event) => (
        <div className={`replay-chip team-${event.team.toLowerCase()} ${event.result}`} key={`${event.turn}-${event.team}-${event.candidateId || event.result}`}>
          <span>T{event.turn + 1}</span>
          <strong>{event.team} {event.resultLabel}</strong>
          <small>{event.combo?.name || "Mixed Curve"}</small>
        </div>
      )) : <span className="empty-copy">No battle events yet.</span>}
    </div>
  );
}

function HandRack({ hand, activeTeam, activeUnitId }) {
  return (
    <div className="hand-rack">
      <div className="panel-title"><KeyRound size={18} /> Retained Hand</div>
      <p className="hand-rule">{activeUnitId} / Team {activeTeam} cards stay after shots. Active model may choose Swap Hand x3 before firing.</p>
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

function AutoDuelPanel({ autoBattle, state }) {
  const score = state.score;
  const finalEvent = autoBattle?.finalEvent;
  return (
    <div className="auto-duel-panel" data-testid="auto-duel-panel">
      <div className="panel-title"><PlayCircle size={18} /> Auto Duel</div>
      <div className="auto-duel-summary">
        <span><b>{autoBattle ? autoBattle.resolvedTurns : state.events.length}</b> turns</span>
        <span><b>{state.winner || "live"}</b> result</span>
        <span><b>{score ? score.rank : "-"}</b> rank</span>
      </div>
      {autoBattle ? (
        <div className="auto-duel-result">
          <strong>{autoBattle.mode} · Team {autoBattle.playerTeam}</strong>
          <p>{finalEvent ? `${finalEvent.provider} finished with ${finalEvent.resultLabel}` : "Battle resolved."}</p>
          <small>{(autoBattle.providers || []).join(" vs ")}</small>
        </div>
      ) : (
        <p className="empty-copy">Start a ranked match, then let the AIs play the full fight while you watch the battlefield and feed.</p>
      )}
    </div>
  );
}

function RulesPacketPanel({ state, activeUnitId, standingOrder }) {
  const snapshot = rulesSnapshot(state, activeUnitId, standingOrder);
  const shotCount = snapshot.legalActions.filter((action) => action.action === "shot").length;
  const canSwap = snapshot.legalActions.some((action) => action.action === "swap_hand");
  const preview = {
    activeUnitId: snapshot.activeUnitId,
    allyIds: snapshot.allyIds,
    opponentIds: snapshot.opponentIds,
    hand: {
      retained: true,
      swapsRemaining: snapshot.hand.swapsRemaining,
      archetype: snapshot.hand.analysis.archetype
    },
    legalActions: snapshot.legalActions.slice(0, 5)
  };
  return (
    <div className="rules-packet-panel" data-testid="rules-packet-panel">
      <div className="panel-title"><KeyRound size={18} /> Bare Rules Packet</div>
      <div className="rules-metrics">
        <span><b>{snapshot.activeUnitId}</b> active unit</span>
        <span><b>{shotCount}</b> shot candidates</span>
        <span><b>{canSwap ? "swap_hand" : "shot only"}</b> legal action</span>
      </div>
      <div className="rules-targets">
        <span>allyIds <b>{snapshot.allyIds.join(" / ")}</b></span>
        <span>opponentIds <b>{snapshot.opponentIds.join(" / ")}</b></span>
      </div>
      <pre className="rules-json-preview">{JSON.stringify(preview, null, 2)}</pre>
    </div>
  );
}

function ModelDecisionStack({ state, lastDecision }) {
  const events = state.events.slice(-6).reverse();
  return (
    <div className="model-decision-stack" data-testid="model-decision-stack">
      <div className="panel-title"><Activity size={18} /> Decision Stack</div>
      {lastDecision ? (
        <div className={`decision-prime team-${String(lastDecision.team).toLowerCase()}`}>
          <span>{lastDecision.provider || "Model"}</span>
          <strong>{lastDecision.action}</strong>
          <p>{lastDecision.publicReason || lastDecision.result}</p>
        </div>
      ) : null}
      <div className="decision-list">
        {events.length ? events.map((event, index) => (
          <div className={`decision-row team-${event.team.toLowerCase()}`} key={`${event.turn}-${event.team}-${event.candidateId || index}`}>
            <i>{String(index + 1).padStart(2, "0")}</i>
            <div>
              <span>{event.provider || "Local AI"} · Team {event.team}</span>
              <strong>{event.combo?.name || "Mixed Curve"}</strong>
              <small>{event.resultLabel} into {event.targetId}</small>
            </div>
          </div>
        )) : <p className="empty-copy">Model choices appear here after the duel starts.</p>}
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
        )) : <p className="empty-copy">The duel feed will fill as models choose swap_hand or shot.</p>}
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
        <p className="empty-copy">No shots yet. Login, match, then watch the auto duel.</p>
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
