import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import Bot from "lucide-react/dist/esm/icons/bot.js";
import Cpu from "lucide-react/dist/esm/icons/cpu.js";
import Gauge from "lucide-react/dist/esm/icons/gauge.js";
import KeyRound from "lucide-react/dist/esm/icons/key-round.js";
import ListOrdered from "lucide-react/dist/esm/icons/list-ordered.js";
import LogIn from "lucide-react/dist/esm/icons/log-in.js";
import PauseCircle from "lucide-react/dist/esm/icons/pause-circle.js";
import PlayCircle from "lucide-react/dist/esm/icons/play-circle.js";
import RadioTower from "lucide-react/dist/esm/icons/radio-tower.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Shield from "lucide-react/dist/esm/icons/shield.js";
import SkipBack from "lucide-react/dist/esm/icons/skip-back.js";
import SkipForward from "lucide-react/dist/esm/icons/skip-forward.js";
import Swords from "lucide-react/dist/esm/icons/swords.js";
import Trophy from "lucide-react/dist/esm/icons/trophy.js";
import X from "lucide-react/dist/esm/icons/x.js";
import "./arena.css";

const Sim = window.GraphwarSim;

const DEFAULT_ROSTER = [
  { unitId: "A1", team: "A", control: "human", commanderId: "you", displayName: "You", provider: "local" },
  { unitId: "A2", team: "A", control: "human", commanderId: "you", displayName: "You", provider: "local" },
  { unitId: "B1", team: "B", control: "ai", commanderId: "ai-opponent", displayName: "AI Rival", provider: "openrouter", model: "openrouter/free" },
  { unitId: "B2", team: "B", control: "ai", commanderId: "ai-opponent", displayName: "AI Rival", provider: "openrouter", model: "openrouter/free" }
];

const MODEL_PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", model: "openrouter/free" },
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

function MotionSection({ children, className = "", initial, animate, exit, transition, ...props }) {
  return (
    <section className={`motion-lite ${className}`.trim()} {...props}>
      {children}
    </section>
  );
}

function MotionDiv({ children, className = "", initial, animate, exit, transition, ...props }) {
  return (
    <div className={`motion-lite ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

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

function teamBattleStats(state, team) {
  const events = (state.events || []).filter((event) => event.team === team);
  const hits = events.filter((event) => event.result === "hitEnemy").length;
  const failures = events.filter((event) => ["blocked", "ground", "out", "miss", "invalid"].includes(event.result)).length;
  const damage = events.reduce((sum, event) => sum + (Number(event.damage) || 0), 0);
  const swapsUsed = Object.entries(state.hands || {})
    .filter(([unitId]) => String(unitId).startsWith(team))
    .reduce((sum, [, handState]) => sum + (Number(handState?.swapsUsed ?? handState?.rerollsUsed) || 0), 0);
  const accuracy = events.length ? Math.round((hits / events.length) * 100) : 0;
  return {
    shots: events.length,
    hits,
    failures,
    damage,
    swapsUsed,
    accuracy
  };
}

function battleMomentum(state) {
  const teamA = teamHealth(state, "A");
  const teamB = teamHealth(state, "B");
  const statsA = teamBattleStats(state, "A");
  const statsB = teamBattleStats(state, "B");
  const hpSwing = teamA.hp - teamB.hp;
  const damageSwing = statsA.damage - statsB.damage;
  const hitSwing = statsA.hits - statsB.hits;
  const pressureSwing = Math.max(-100, Math.min(100, Math.round(hpSwing * 0.34 + damageSwing * 0.42 + hitSwing * 8)));
  return {
    leader: pressureSwing > 8 ? "A" : pressureSwing < -8 ? "B" : "EVEN",
    pressureSwing,
    trackPercent: Math.max(8, Math.min(92, 50 + pressureSwing / 2)),
    teamA,
    teamB,
    statsA,
    statsB
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
    provider: "openrouter",
    model: "openrouter/free",
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
  const [activeMode, setActiveMode] = useState("play");
  const [authModalOpen, setAuthModalOpen] = useState(false);
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
    loadLeaderboard().catch(() => {});
  }, []);

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
        setAuthModalOpen(false);
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
      setAuthModalOpen(false);
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
        body: JSON.stringify({
          preferredProvider: login.provider,
          allowAiFill: opts.allowAiFill !== false,
          standingOrder: login.standingOrder
        })
      });
      const payload = await response.json();
      if (response.status === 202) {
        setQueueState({ ...payload, polling: true });
        setMessage(`Waiting for humans. ${payload.queueSize}/2 commanders queued.`);
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
      setMessage(payload.match.filledByAi ? "AI filled opponent commander. Auto duel launching." : "Ranked team commander match ready. Auto duel launching.");
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
      const userProvider = login.apiKey.trim() || login.provider === "openrouter" ? login.provider : "local";
      const response = await fetch("/api/simulations/league", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rounds: 4,
          contestants: [
            {
              id: "your-model",
              label: userProvider === "local" ? "Your Local Baseline" : `${login.provider} ${login.model}`,
              provider: userProvider,
              model: login.model,
              apiKey: login.apiKey,
              command: login.standingOrder || "safe high arc target weakest enemy avoid ally"
            },
            {
              id: "router-pressure",
              label: "OpenRouter Free Pressure",
              provider: "openrouter",
              model: "openrouter/free",
              command: "bend through center target weakest enemy"
            },
            {
              id: "router-control",
              label: "OpenRouter Free Control",
              provider: "openrouter",
              model: "openrouter/free",
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

  function selectGameMode(mode) {
    const id = typeof mode === "string" ? mode : mode.id;
    const target = typeof mode === "string" ? mode : mode.target;
    setActiveMode(id);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-game-section="${target}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

      <ProductTabs
        activeMode={activeMode}
        profile={profile}
        match={match}
        queueState={queueState}
        autoBattle={autoBattle}
        onSelect={setActiveMode}
        onOpenAuth={() => setAuthModalOpen(true)}
      />

      <section className="app-view-stack">
        {activeMode === "play" ? (
          <PlayView
            login={login}
            profile={profile}
            sessionToken={sessionToken}
            match={match}
            queueState={queueState}
            autoBattle={autoBattle}
            busy={busy}
            battleState={battleState}
            battlePlayback={battlePlayback}
            playbackPaused={playbackPaused}
            playbackSpeed={playbackSpeed}
            playbackDeck={playbackDeck}
            activeTeam={activeTeam}
            activeUnitId={activeUnitId}
            displayTeam={displayTeam}
            displayUnitId={displayUnitId}
            activeHand={activeHand}
            latestEvent={latestEvent}
            visibleDecision={visibleDecision}
            message={message}
            onOpenAuth={() => setAuthModalOpen(true)}
            onJoin={joinMatch}
            onSync={syncCurrentRoom}
            onTogglePlayback={togglePlayback}
            onStepPlayback={stepPlayback}
            onPlaybackSpeed={changePlaybackSpeed}
          />
        ) : null}
        {activeMode === "leaderboard" ? (
          <LeaderboardView
            players={leaderboard}
            profile={profile}
            leagueResult={leagueResult}
            onRefresh={loadLeaderboard}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        ) : null}
        {activeMode === "lab" ? (
          <LabView
            result={leagueResult}
            busy={leagueBusy}
            state={battleState}
            activeUnitId={displayUnitId}
            standingOrder={login.standingOrder}
            onRun={runLeague}
          />
        ) : null}
      </section>

      <AuthModal
        open={authModalOpen}
        login={login}
        setLogin={setLogin}
        profile={profile}
        sessionToken={sessionToken}
        busy={busy}
        onSubmit={signIn}
        onRestore={restoreProfile}
        onClose={() => setAuthModalOpen(false)}
      />
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

function ProductTabs({ activeMode, profile, match, queueState, autoBattle, onSelect, onOpenAuth }) {
  const tabs = [
    {
      id: "play",
      label: "Play",
      status: profile ? (queueState ? "queue live" : match ? "room armed" : "ready") : "sign in required",
      icon: Swords
    },
    {
      id: "leaderboard",
      label: "Leaderboard",
      status: profile ? `${profile.rank.tier} ${profile.rank.rating}` : "public ladder",
      icon: Trophy
    },
    {
      id: "lab",
      label: "Lab",
      status: autoBattle ? `${autoBattle.resolvedTurns} turns` : "model league",
      icon: Cpu
    }
  ];
  return (
    <nav className="product-tabs" data-testid="product-tabs" aria-label="Mob Graphwar product tabs">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            type="button"
            className={`product-tab ${activeMode === tab.id ? "active" : ""}`}
            aria-current={activeMode === tab.id ? "page" : undefined}
            onClick={() => onSelect(tab.id)}
            key={tab.id}
          >
            <Icon size={18} />
            <span>{tab.label}</span>
            <small>{tab.status}</small>
          </button>
        );
      })}
      {!profile ? (
        <button type="button" className="product-tab auth-shortcut" onClick={onOpenAuth}>
          <LogIn size={18} />
          <span>Sign in</span>
          <small>unlock ranked</small>
        </button>
      ) : null}
    </nav>
  );
}

function PlayView({
  login,
  profile,
  sessionToken,
  match,
  queueState,
  autoBattle,
  busy,
  battleState,
  battlePlayback,
  playbackPaused,
  playbackSpeed,
  playbackDeck,
  activeTeam,
  activeUnitId,
  displayTeam,
  displayUnitId,
  activeHand,
  latestEvent,
  visibleDecision,
  message,
  onOpenAuth,
  onJoin,
  onSync,
  onTogglePlayback,
  onStepPlayback,
  onPlaybackSpeed
}) {
  return (
    <section className="game-grid play-view map-first" data-testid="play-view">
      <aside className="lobby-panel compact game-panel" data-game-section="launch">
        <LaunchBay
          login={login}
          profile={profile}
          sessionToken={sessionToken}
          match={match}
          queueState={queueState}
          autoBattle={autoBattle}
          busy={busy}
          onOpenAuth={onOpenAuth}
          onJoin={onJoin}
          onSync={onSync}
        />
        <RosterCard match={match} />
      </aside>

      <section className="battle-panel game-panel" data-game-section="watch">
        <BattleHeader state={battleState} activeTeam={activeTeam} activeUnitId={activeUnitId} message={message} />
        <SpectatorHud state={battleState} activeTeam={activeTeam} match={match} />
        <BattlePlaybackHud
          playback={battlePlayback}
          paused={playbackPaused}
          speed={playbackSpeed}
          canControl={playbackDeck.length > 0}
          onToggle={onTogglePlayback}
          onStep={onStepPlayback}
          onSpeed={onPlaybackSpeed}
        />
        <section className="arena-stage" aria-label="AI duel stage">
          <VersusBanner state={battleState} match={match} activeTeam={activeTeam} />
          <Battlefield
            state={battleState}
            match={match}
            activeTeam={activeTeam}
            activeUnitId={activeUnitId}
            latestEvent={latestEvent}
            playback={battlePlayback}
            lastDecision={visibleDecision}
          />
          <BattleDetailsDrawer
            state={battleState}
            match={match}
            activeTeam={activeTeam}
            activeUnitId={activeUnitId}
            latestEvent={latestEvent}
            playback={battlePlayback}
            lastDecision={visibleDecision}
            profile={profile}
            autoBattle={autoBattle}
          />
        </section>
      </section>

      <aside className="tactical-panel game-panel" data-game-section="intel">
        <HandRack hand={activeHand} activeTeam={displayTeam} activeUnitId={displayUnitId} />
        <Timeline state={battleState} />
        <AutoDuelPanel autoBattle={autoBattle} state={battleState} />
        <PostMatchRecap autoBattle={autoBattle} state={battleState} profile={profile} playback={battlePlayback} />
        <ModelDecisionStack state={battleState} lastDecision={visibleDecision} />
        <ModelWarFeed state={battleState} lastDecision={visibleDecision} />
        <ShotIntel event={latestEvent} state={battleState} />
      </aside>
    </section>
  );
}

function AuthModal({ open, login, setLogin, profile, sessionToken, busy, onSubmit, onRestore, onClose }) {
  if (!open) return null;
  return (
    <div className="auth-modal-backdrop" role="presentation">
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <div className="auth-modal-header">
          <div>
            <span>Account / Model Setup</span>
            <strong id="auth-modal-title">{profile ? "Update ranked model" : "Sign in to play ranked"}</strong>
          </div>
          <button type="button" className="icon-button" aria-label="Close account setup" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <LoginCard
          login={login}
          setLogin={setLogin}
          profile={profile}
          sessionToken={sessionToken}
          busy={busy}
          onSubmit={onSubmit}
          onRestore={onRestore}
        />
      </section>
    </div>
  );
}

function LeaderboardView({ players, profile, leagueResult, onRefresh, onOpenAuth }) {
  return (
    <section className="leaderboard-view" data-testid="leaderboard-view">
      <div className="leaderboard-hero">
        <div>
          <span>Ranked competition</span>
          <strong>Commander Rank</strong>
          <p>Player Elo tracks the full package: account, selected model, standing order, and ranked match outcomes.</p>
        </div>
        {!profile ? <button type="button" onClick={onOpenAuth}>Sign in to play ranked</button> : null}
      </div>
      <div className="leaderboard-layout">
        <LeaderboardPanel players={players} profile={profile} onRefresh={onRefresh} />
        <LeagueBoardGrid leagueResult={leagueResult} />
      </div>
    </section>
  );
}

function LeagueBoardGrid({ leagueResult }) {
  const rows = leagueResult?.leaderboard || [];
  const previewRows = rows.slice(0, 4);
  const cards = [
    {
      title: "Model League",
      label: "model identity",
      copy: "Controlled simulations compare provider/model choices across shared seeds and prompt packs.",
      rows: previewRows.map((row) => ({ name: row.label, metric: row.rating }))
    },
    {
      title: "Prompt League",
      label: "prompt hash",
      copy: "Prompt League fixes model and seed pools, then ranks standing orders by prompt hash.",
      rows: []
    },
    {
      title: "Pair League",
      label: "model + prompt",
      copy: "Pair League ranks the combined strategy, because the best model and best prompt may not be the best pair.",
      rows: []
    }
  ];
  return (
    <div className="league-board-grid" data-testid="league-board-grid">
      {cards.map((card) => (
        <article className="league-board-card" key={card.title}>
          <span>{card.label}</span>
          <strong>{card.title}</strong>
          <p>{card.copy}</p>
          <div className="league-board-rows">
            {card.rows.length ? card.rows.map((row) => (
              <small key={row.name}><b>{row.metric}</b>{row.name}</small>
            )) : <small><b>pending</b>run Lab simulations to populate</small>}
          </div>
        </article>
      ))}
    </div>
  );
}

function LabView({ result, busy, state, activeUnitId, standingOrder, onRun }) {
  return (
    <section className="lab-view" data-testid="lab-view">
      <div className="lab-hero">
        <span>Model evaluation lab</span>
        <strong>Find the best model, prompt, and model + prompt pair.</strong>
        <p>Use controlled simulations for repeatable model league results before pushing strategies into ranked.</p>
      </div>
      <div className="lab-grid">
        <LeagueLab result={result} busy={busy} onRun={onRun} />
        <SimulationApiPanel />
        <RulesPacketPanel state={state} activeUnitId={activeUnitId} standingOrder={standingOrder} />
        <MapTopologyScanner state={state} />
      </div>
    </section>
  );
}

function GameModeNav({ activeMode, profile, match, queueState, autoBattle, onSelect }) {
  const modes = [
    {
      id: "launch",
      target: "launch",
      label: "Launch",
      status: profile ? (queueState ? "queue live" : match ? "room armed" : "one order") : "login",
      icon: PlayCircle
    },
    {
      id: "watch",
      target: "watch",
      label: "Watch",
      status: autoBattle ? `${autoBattle.resolvedTurns} turns` : match ? "auto duel" : "exhibition",
      icon: Swords
    },
    {
      id: "intel",
      target: "intel",
      label: "Intel",
      status: "cards + rules",
      icon: KeyRound
    },
    {
      id: "ladder",
      target: "ladder",
      label: "Ladder",
      status: profile ? `${profile.rank.tier} ${profile.rank.rating}` : "unrated",
      icon: Trophy
    }
  ];
  const renderMode = (mode, compact = false) => {
    const Icon = mode.icon;
    return (
      <button
        type="button"
        className={`mode-tab ${activeMode === mode.id ? "active" : ""}`}
        aria-current={activeMode === mode.id ? "page" : undefined}
        onClick={() => onSelect(mode)}
        key={mode.id}
      >
        <Icon size={compact ? 17 : 19} />
        <span>{mode.label}</span>
        <small>{mode.status}</small>
      </button>
    );
  };
  return (
    <>
      <nav className="game-mode-nav" data-testid="game-mode-nav" aria-label="Spectator mode navigation">
        <div>
          <span>Spectator deck</span>
          <strong>{profile ? profile.displayName : "Guest viewer"}</strong>
        </div>
        <div className="mode-tab-strip">
          {modes.map((mode) => renderMode(mode))}
        </div>
      </nav>
      <nav className="mobile-mode-nav" data-testid="mobile-mode-nav" aria-label="Mobile spectator mode navigation">
        {modes.map((mode) => renderMode(mode, true))}
      </nav>
    </>
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
  profile,
  sessionToken,
  match,
  queueState,
  autoBattle,
  busy,
  onOpenAuth,
  onJoin,
  onSync
}) {
  return (
    <section className="launch-bay" data-testid="launch-bay">
      <div className="launch-header">
        <div>
          <span>Ranked duel</span>
          <strong>{profile ? `${profile.rank.tier} ${profile.rank.rating}` : "Login to arm model"}</strong>
        </div>
        <b>{match?.filledByAi ? "AI" : match ? "A/B" : "READY"}</b>
      </div>
      <CompactLaunchSummary
        login={login}
        profile={profile}
        sessionToken={sessionToken}
        match={match}
        queueState={queueState}
        autoBattle={autoBattle}
      />
      {profile ? (
        <MatchCard
          profile={profile}
          match={match}
          queueState={queueState}
          busy={busy}
          onJoin={onJoin}
          onSync={onSync}
          onOpenAuth={onOpenAuth}
        />
      ) : (
        <LockedPlayCard onOpenAuth={onOpenAuth} />
      )}
    </section>
  );
}

function CompactLaunchSummary({ login, profile, sessionToken, match, queueState, autoBattle }) {
  const selectedProvider = profile?.providers?.[login.provider];
  const modelReady = Boolean(selectedProvider?.configured || login.apiKey.trim());
  const items = [
    { label: "Account", value: profile && sessionToken ? profile.handle || profile.displayName : profile ? "restore token" : "guest" },
    { label: "Model", value: modelReady ? selectedProvider?.model || login.model : "local fallback" },
    { label: "Room", value: autoBattle ? "settled" : match ? match.status : queueState ? `${queueState.queueSize}/2 queued` : "idle" },
    { label: "Control", value: "Watch-only after launch" }
  ];
  return (
    <div className="compact-launch-summary" data-testid="compact-launch-summary">
      {items.map((item) => (
        <span key={item.label}>
          <b>{item.label}</b>
          <strong>{item.value}</strong>
        </span>
      ))}
    </div>
  );
}

function LockedPlayCard({ onOpenAuth }) {
  return (
    <div className="locked-play-card" data-testid="locked-play-card">
      <div>
        <span>Ranked locked</span>
        <strong>Sign in to play ranked</strong>
        <p>Guests can inspect the public ladder, but ranked 2v2 needs an account, model choice, and one standing order.</p>
      </div>
      <button type="button" onClick={onOpenAuth}>Sign in to play ranked</button>
    </div>
  );
}

function WatchLoopBrief() {
  const steps = [
    { label: "Configure model", value: "BYOK or local fallback" },
    { label: "Write one standing order", value: "80 characters before queue" },
    { label: "Watch auto duel", value: "No mid-fight commands" },
    { label: "Study replay", value: "Rank, frames, rules proof" }
  ];
  return (
    <div className="watch-loop-brief" data-testid="watch-loop-brief" aria-label="Watch-only game loop">
      <div>
        <span>Product loop</span>
        <strong>One prompt, then spectate the model war.</strong>
      </div>
      <div className="watch-loop-steps">
        {steps.map((step, index) => (
          <span key={step.label}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <strong>{step.label}</strong>
            <small>{step.value}</small>
          </span>
        ))}
      </div>
    </div>
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
      value: queueState ? `${queueState.queueSize}/2 commanders` : match ? "closed" : "idle",
      ready: Boolean(queueState || match || autoBattle),
      active: Boolean(queueState && !match)
    },
    {
      label: "Matched",
      value: match ? (match.filledByAi ? "AI opponent" : "ranked_team_1v1") : "waiting",
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
        <option value="openrouter">OpenRouter</option>
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
        <span>{queueState ? `${queueState.queueSize}/2 commanders queued` : match?.filledByAi ? "AI opponent commander active" : "Queue idle"}</span>
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
        <button disabled={!profile || busy} onClick={() => onJoin({ allowAiFill: false })}>Start Ranked: Humans</button>
        <button disabled={!profile || busy} onClick={() => onJoin({ allowAiFill: true })}>Start Ranked: AI Fill</button>
      </div>
    </div>
  );
}

function MobileSpectatorDock({ profile, queueState, match, state, activeUnitId, autoBattle }) {
  const dock = {
    ranked: profile ? `${profile.rank.tier} ${profile.rank.rating}` : "guest",
    queue: queueState ? `${queueState.queueSize}/2` : match ? match.status : "idle",
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
  const commanders = ["A", "B"].map((team) => {
    const seats = roster.filter((seat) => seat.team === team);
    const first = seats[0] || null;
    return {
      team,
      seats,
      commanderId: first?.commanderId || first?.playerId || `${team}-pending`,
      displayName: first?.displayName || `Team ${team}`,
      control: first?.control || "waiting",
      provider: first?.provider || "pending",
      model: first?.model || ""
    };
  });
  return (
    <div className="roster-card">
      <div className="panel-title"><Shield size={18} /> Team Commander Seats</div>
      {roster.length ? commanders.map((commander) => (
        <div className={`seat seat-${commander.team.toLowerCase()}`} key={commander.team}>
          <span>Team Commander {commander.team} / {commander.seats.map((seat) => seat.unitId).join(" + ")}</span>
          <strong>{commander.displayName}</strong>
          <small>{commander.control} · {commander.provider}{commander.model ? ` / ${commander.model}` : ""} · {commander.commanderId}</small>
        </div>
      )) : <p className="empty-copy">Join matchmaking to claim Team A and find one Team B commander.</p>}
    </div>
  );
}

function LeaderboardPanel({ players, profile, onRefresh }) {
  return (
    <div className="leaderboard-panel" data-testid="leaderboard-panel" data-game-section="ladder">
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

function DuelBroadcastScorebug({ state, match, activeTeam, latestEvent, playback, lastDecision }) {
  const roster = match?.roster?.length ? match.roster : DEFAULT_ROSTER;
  const momentum = battleMomentum(state);
  const action = playback?.action || lastDecision || null;
  const recentUnit = action?.unitId || latestEvent?.unitId || latestEvent?.shooterId || "standby";
  const recentTeam = action?.team || latestEvent?.team || activeTeam || "A";
  const recentVerb = action?.action === "swap_hand" ? "SWAP HAND" : action?.action ? String(action.action).toUpperCase() : latestEvent ? "SHOT" : "WAITING";
  const recentDamage = Number(latestEvent?.damage || action?.event?.damage || 0);
  const result = latestEvent?.resultLabel || action?.resultLabel || action?.result || (state.winner ? battleResultLabel(state.winner) : "models reading the board");
  const damageRace = `${momentum.statsA.damage}-${momentum.statsB.damage}`;
  const teamNames = (team) => roster.filter((seat) => seat.team === team).map((seat) => seat.displayName).join(" / ") || `Team ${team}`;
  const teamBlock = (team) => {
    const health = team === "A" ? momentum.teamA : momentum.teamB;
    const stats = team === "A" ? momentum.statsA : momentum.statsB;
    const hpPct = health.max ? Math.max(0, Math.min(100, (health.hp / health.max) * 100)) : 0;
    return (
      <article className={`scorebug-team team-${team.toLowerCase()} ${activeTeam === team ? "active" : ""}`} key={team}>
        <div className="scorebug-team-head">
          <span>Team {team}</span>
          <strong>{teamNames(team)}</strong>
        </div>
        <div className="scorebug-hp-rail" aria-label={`Team ${team} HP`}>
          <i style={{ width: `${hpPct}%` }} />
        </div>
        <div className="scorebug-team-stats">
          <span><b>{health.hp}</b>HP</span>
          <span><b>{stats.damage}</b>DMG</span>
          <span><b>{stats.accuracy}%</b>accuracy</span>
          <span><b>{stats.swapsUsed}</b>swaps</span>
        </div>
      </article>
    );
  };
  return (
    <section className={`duel-broadcast-scorebug leader-${String(momentum.leader).toLowerCase()}`} data-testid="duel-broadcast-scorebug" aria-label="Live duel scoreboard">
      {["A", "B"].map(teamBlock)}
      <div className="scorebug-center">
        <span>Momentum</span>
        <strong>{momentum.leader === "EVEN" ? "Even fight" : `Team ${momentum.leader} pressure`}</strong>
        <div className="momentum-track" aria-label="Battle momentum">
          <i style={{ width: `${momentum.trackPercent}%` }} />
          <b />
        </div>
        <div className="scorebug-center-metrics">
          <span className="damage-race"><b>{damageRace}</b> damageRace</span>
          <span><b>{state.turn}/{Sim.CONFIG.maxTurns}</b> tempo</span>
          <span><b>{state.mapMeta?.difficulty || 0}</b> map</span>
        </div>
      </div>
      <div className={`recent-model-action team-${String(recentTeam).toLowerCase()}`}>
        <span>Recent model action</span>
        <strong>{recentUnit} · {recentVerb}</strong>
        <small>{result}{recentDamage ? ` · ${recentDamage} damage` : ""}</small>
      </div>
    </section>
  );
}

function CombatCinematicLayer({ state, match, activeTeam, activeUnitId, latestEvent, playback, lastDecision }) {
  const roster = match?.roster?.length ? match.roster : DEFAULT_ROSTER;
  const latestPath = state.paths[state.paths.length - 1] || null;
  const action = playback?.action || null;
  const teamA = teamHealth(state, "A");
  const teamB = teamHealth(state, "B");
  const actionCombo = typeof action?.event?.combo === "string" ? action.event.combo : action?.event?.combo?.name;
  const actingUnitId = action?.unitId || latestEvent?.unitId || latestEvent?.shooterId || (activeUnitId === "-" ? "A1" : activeUnitId);
  const actingSeat = roster.find((seat) => seat.unitId === actingUnitId);
  const actingTeam = action?.team || latestEvent?.team || actingSeat?.team || activeTeam || (String(actingUnitId).startsWith("B") ? "B" : "A");
  const targetId = latestEvent?.targetId || action?.targetId || action?.event?.targetId || (actingTeam === "A" ? "B1" : "A1");
  const targetSeat = roster.find((seat) => seat.unitId === targetId);
  const combo = latestEvent?.combo?.name || action?.combo?.name || actionCombo || lastDecision?.result || "Awaiting function combo";
  const result = latestEvent?.resultLabel || action?.resultLabel || lastDecision?.publicReason || (state.winner ? battleResultLabel(state.winner) : "Models reading route pressure");
  const pathLabel = latestPath ? `${latestPath.points.length} point trajectory` : "trajectory pending";
  const frameLabel = playback?.active ? `frame ${playback.index}/${playback.total}` : state.winner ? "settled" : "live sim";
  const laneTeam = String(actingTeam || activeTeam || "A").toLowerCase();
  const complexity = state.mapMeta?.complexity || {};
  const side = (team, health) => {
    const seats = roster.filter((seat) => seat.team === team);
    const focusSeat = seats.find((seat) => seat.unitId === actingUnitId || seat.unitId === targetId) || seats[0];
    const hpPct = health.max ? Math.max(0, Math.min(100, (health.hp / health.max) * 100)) : 0;
    return {
      seats,
      focusSeat,
      hpPct,
      health,
      active: actingTeam === team,
      modelLine: seats.map((seat) => seat.provider).join(" / ") || "local"
    };
  };
  const sides = { A: side("A", teamA), B: side("B", teamB) };
  return (
    <MotionSection
      className={`combat-cinematic-layer team-${laneTeam}`}
      data-testid="combat-cinematic-layer"
      aria-label="AI strike lane"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      {["A", "B"].map((team) => (
        <article className={`cinematic-team-card team-${team.toLowerCase()} ${sides[team].active ? "active" : ""}`} key={team}>
          <div>
            <span>Team {team}</span>
            <strong>{sides[team].focusSeat?.displayName || `Team ${team}`}</strong>
          </div>
          <small>{sides[team].modelLine}</small>
          <div className="cinematic-hp-rail" aria-label={`Team ${team} health`}>
            <i style={{ width: `${sides[team].hpPct}%` }} />
          </div>
          <b>{sides[team].health.hp}/{sides[team].health.max} HP</b>
          <small>{sides[team].health.alive} models online</small>
        </article>
      ))}
      <div className="cinematic-core">
        <span>AI STRIKE LANE</span>
        <strong>{actingUnitId} {actingSeat?.displayName || "model"}</strong>
        <div className="cinematic-vs-rail" aria-hidden="true">
          <i />
          <b>VS</b>
          <i />
        </div>
        <small>{frameLabel} / pressure {complexity.routePressure || 0}</small>
      </div>
      <article className="strike-vector-card">
        <span><b>MODEL LOCK</b>{actingSeat ? `${actingUnitId} ${actingSeat.provider}${actingSeat.model ? ` / ${actingSeat.model}` : ""}` : actingUnitId}</span>
        <span><b>TARGET VECTOR</b>{targetSeat ? `${targetId} ${targetSeat.displayName}` : targetId}</span>
        <span><b>FUNCTION COMBO</b>{combo}</span>
        <span><b>TRAJECTORY</b>{pathLabel}</span>
        <strong>{result}</strong>
      </article>
    </MotionSection>
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
    <MotionSection
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
      <MotionDiv
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
      </MotionDiv>
    </MotionSection>
  );
}

function MapTopologyScanner({ state }) {
  const complexity = state.mapMeta?.complexity || {};
  const topologyTags = Array.isArray(complexity.topologyTags) ? complexity.topologyTags : [];
  const routeArchetypes = Array.isArray(complexity.routeArchetypes) ? complexity.routeArchetypes : [];
  const highArcDominance = Math.round((complexity.highArcDominance || 0) * 100);
  const routeEntropy = Number.isFinite(Number(complexity.routeEntropy)) ? Number(complexity.routeEntropy).toFixed(2) : "0.00";
  const ceilingLock = complexity.ceilingLock ? "locked sky" : "open sky";
  const coverage = [
    { label: "chambers", value: complexity.chamberCount || 0 },
    { label: "lane breaks", value: complexity.straightLaneBreaks || 0 },
    { label: "solid cells", value: complexity.solidBandCoverage || 0 },
    { label: "x bands", value: complexity.verticalBandCoverage || 0 },
    { label: "y bands", value: complexity.horizontalBandCoverage || 0 },
    { label: "solver", value: complexity.solverPressure || 0 }
  ];
  const firstHand = Math.round((complexity.firstHandHitRate || 0) * 100);
  const swapWindow = Math.round((complexity.swapWindowHitRate || 0) * 100);
  return (
    <section className="map-topology-scanner" data-testid="map-topology-scanner" aria-label="Map topology scanner">
      <div className="topology-prime">
        <span>Graphwar-grade route maze</span>
        <strong>{state.mapMeta.name} / difficulty {state.mapMeta.difficulty}</strong>
        <small>{complexity.obstacleCount || 0} total blockers · {complexity.solidObstacleCount || 0} solid · {complexity.routeGuideCount || 0} guides</small>
      </div>
      <div className="topology-lane-grid">
        {coverage.map((item) => (
          <span key={item.label}><b>{item.value}</b>{item.label}</span>
        ))}
      </div>
      <div className="topology-pressure-strip">
        <span><b>{complexity.routePressure || 0}</b> route pressure</span>
        <span><b>{firstHand}%</b> first hand</span>
        <span><b>{swapWindow}%</b> swap window</span>
        <span><b>{highArcDominance}%</b> high arc</span>
      </div>
      <div className="route-diversity-strip">
        <span><b>{routeArchetypes.length}</b> routeArchetypes</span>
        <span><b>{routeEntropy}</b> routeEntropy</span>
        <span><b>{ceilingLock}</b> ceilingLock</span>
        <span><b>{complexity.requiredBendCount || 0}</b> bends</span>
      </div>
      <div className="route-archetype-strip" aria-label="routeArchetypes">
        {routeArchetypes.length ? routeArchetypes.map((route) => <span key={route}>{route}</span>) : <span>route archetypes pending</span>}
      </div>
      <div className="topology-tags" aria-label="topologyTags">
        {topologyTags.length ? topologyTags.map((tag) => <span key={tag}>{tag}</span>) : <span>topology pending</span>}
      </div>
    </section>
  );
}

function ModelRulesTicker({ state, playback, activeUnitId, standingOrder }) {
  const snapshot = rulesSnapshot(state, activeUnitId, standingOrder);
  const rulesDigest = playback?.action?.rulesDigest || {
    promptPolicy: "bare_rules_only",
    activeUnitId: snapshot.activeUnitId,
    team: snapshot.team,
    objective: snapshot.objective,
    handRetained: snapshot.hand.retained,
    handSize: snapshot.hand.cards.length,
    handArchetype: snapshot.hand.analysis.archetype,
    swapsUsed: snapshot.hand.swapsUsed,
    swapsRemaining: snapshot.hand.swapsRemaining,
    legalActionCount: snapshot.legalActions.length,
    legalShotCount: snapshot.legalActions.filter((action) => action.action === "shot").length,
    canSwap: snapshot.legalActions.some((action) => action.action === "swap_hand"),
    allyIds: snapshot.allyIds,
    opponentIds: snapshot.opponentIds
  };
  return (
    <section className="model-rules-ticker" data-testid="model-rules-ticker" aria-label="Bare rules contract visible to models">
      <div className="rules-contract-pill primary">
        <span>No hidden prompt</span>
        <strong>{rulesDigest.promptPolicy}</strong>
        <small>{rulesDigest.objective || "eliminate opposing team while avoiding allies"}</small>
      </div>
      <div className="rules-contract-pill">
        <span>Active model</span>
        <strong>{rulesDigest.activeUnitId || snapshot.activeUnitId}</strong>
        <small>Team {rulesDigest.team || snapshot.team}</small>
      </div>
      <div className="rules-contract-pill">
        <span>Retained hand</span>
        <strong>{rulesDigest.handRetained ? "handRetained" : "not retained"}</strong>
        <small>{rulesDigest.handSize || 0} cards · {rulesDigest.handArchetype || "mixed"}</small>
      </div>
      <div className="rules-contract-pill">
        <span>Swap economy</span>
        <strong>{rulesDigest.swapsRemaining ?? 0} left</strong>
        <small>{rulesDigest.canSwap ? "swap_hand legal" : "shot only"}</small>
      </div>
      <div className="rules-contract-pill">
        <span>Legal actions</span>
        <strong>{rulesDigest.legalShotCount ?? 0} legalShotCount</strong>
        <small>{rulesDigest.legalActionCount ?? 0} total actions</small>
      </div>
      <div className="rules-contract-pill wide">
        <span>Visible units</span>
        <strong>{(rulesDigest.allyIds || []).join(" / ")} vs {(rulesDigest.opponentIds || []).join(" / ")}</strong>
        <small>rulesDigest from replay frame or live rules packet</small>
      </div>
    </section>
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

function BattleDetailsDrawer({ state, match, profile, activeTeam, activeUnitId, latestEvent, playback, lastDecision, autoBattle }) {
  return (
    <details className="secondary-battle-panels" data-testid="battle-details-drawer">
      <summary>
        <span>Battle details</span>
        <strong>model telemetry, replay, agent seats</strong>
      </summary>
      <div className="secondary-battle-grid">
        <DuelBroadcastScorebug
          state={state}
          match={match}
          activeTeam={activeTeam}
          latestEvent={latestEvent}
          playback={playback}
          lastDecision={lastDecision}
        />
        <CombatCinematicLayer
          state={state}
          match={match}
          activeTeam={activeTeam}
          activeUnitId={activeUnitId}
          latestEvent={latestEvent}
          playback={playback}
          lastDecision={lastDecision}
        />
        <ArenaDirectorHud
          state={state}
          match={match}
          profile={profile}
          activeTeam={activeTeam}
          activeUnitId={activeUnitId}
          latestEvent={latestEvent}
          autoBattle={autoBattle}
          playback={playback}
        />
        <LiveModelTelemetryPanel
          state={state}
          match={match}
          playback={playback}
          lastDecision={lastDecision}
          activeUnitId={activeUnitId}
        />
        <BattleBroadcastPanel
          state={state}
          match={match}
          activeTeam={activeTeam}
          activeUnitId={activeUnitId}
          latestEvent={latestEvent}
          playback={playback}
          lastDecision={lastDecision}
        />
        <AgentBattleMatrix state={state} match={match} activeTeam={activeTeam} activeUnitId={activeUnitId} lastDecision={lastDecision} />
        <BattleReplayRail state={state} />
        <DuelCommanders state={state} match={match} activeTeam={activeTeam} lastDecision={lastDecision} />
      </div>
    </details>
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
  return (
    <g className="battlefield-backdrop" aria-hidden="true">
      <rect x="0" y="0" width="1000" height="600" fill="url(#skyField)" />
      <rect className="map-playable-ground" x="24" y="26" width="952" height="548" rx="18" />
      {Array.from({ length: 9 }, (_, i) => <line key={`x-${i}`} className="grid-line" x1={80 + i * 105} y1="44" x2={80 + i * 105} y2="560" />)}
      {Array.from({ length: 5 }, (_, i) => <line key={`y-${i}`} className="grid-line" x1="44" y1={88 + i * 96} x2="956" y2={88 + i * 96} />)}
    </g>
  );
}

function isRouteGuideObstacle(obstacle) {
  return ["route-contour", "gate-slit", "thread-slot"].includes(obstacle.role);
}

function RouteGuideLayer({ state }) {
  const obstacles = state.obstacles || [];
  const guides = obstacles.filter(isRouteGuideObstacle).slice(0, 28);
  return (
    <g className="route-guide-layer" data-testid="route-maze-layer" aria-hidden="true">
      {guides.map((obstacle) => {
        if (obstacle.role === "gate-slit") {
          const x = sx(obstacle.x + obstacle.w / 2);
          return (
            <line
              key={obstacle.id}
              className={`route-guide gate-slit layer-${obstacle.visualLayer || 1}`}
              x1={x}
              y1={sy(obstacle.y + obstacle.h)}
              x2={x}
              y2={sy(obstacle.y)}
            />
          );
        }
        if (obstacle.role === "thread-slot") {
          return (
            <path
              key={obstacle.id}
              className={`route-guide thread-slot layer-${obstacle.visualLayer || 1}`}
              d={`M${sx(obstacle.x)},${sy(obstacle.y + obstacle.h / 2)} L${sx(obstacle.x + obstacle.w)},${sy(obstacle.y + obstacle.h / 2)}`}
            />
          );
        }
        return (
          <rect
            key={obstacle.id}
            className={`route-guide route-contour layer-${obstacle.visualLayer || 1}`}
            x={sx(obstacle.x)}
            y={sy(obstacle.y + obstacle.h)}
            width={obstacle.w * 10}
            height={Math.max(4, obstacle.h * 10)}
            rx="7"
          />
        );
      })}
    </g>
  );
}

function FlatMapObstacleLayer({ state }) {
  const solids = (state.obstacles || []).filter((obstacle) => !isRouteGuideObstacle(obstacle));
  return (
    <g className="flat-map-obstacle-layer" aria-hidden="true">
      {solids.map((obstacle) => (
        <rect
          key={obstacle.id}
          className={`map-obstacle ${obstacle.role || "blocker"} layer-${obstacle.visualLayer || 1}`}
          x={sx(obstacle.x)}
          y={sy(obstacle.y + obstacle.h)}
          width={obstacle.w * 10}
          height={Math.max(5, obstacle.h * 10)}
          rx={obstacle.role === "maze-room" ? 10 : 5}
        />
      ))}
    </g>
  );
}

function MapLegend() {
  const items = [
    { label: "passable ground", className: "ground" },
    { label: "solid blockers", className: "blocker" },
    { label: "route lanes", className: "lane" },
    { label: "current shot", className: "shot" }
  ];
  return (
    <div className="map-legend" data-testid="map-legend" aria-label="Map legend">
      {items.map((item) => (
        <span className={item.className} key={item.label}>
          <i />
          <b>{item.label}</b>
        </span>
      ))}
    </div>
  );
}

function Battlefield({ state, match, activeTeam, activeUnitId, latestEvent, playback, lastDecision }) {
  const latestPath = state.paths[state.paths.length - 1];
  const impactPoint = latestEvent?.collisionPoint || latestPath?.collisionPoint || null;
  const activeLabel = activeUnitId === "-" ? "standby" : `${activeUnitId} / Team ${activeTeam}`;
  const resultLabel = state.winner ? battleResultLabel(state.winner) : "live route view";
  return (
    <div className="battlefield-frame" data-testid="battlefield-frame">
      <div className="map-status-strip" data-testid="map-status-strip">
        <span><b>{state.mapMeta.name}</b> difficulty {state.mapMeta.difficulty}</span>
        <span>Turn {state.turn}/{Sim.CONFIG.maxTurns}</span>
        <span>{activeLabel}</span>
        <span>{resultLabel}</span>
      </div>
      <MapLegend />
      <svg className="battlefield simple-map" viewBox="0 0 1000 600" role="img" aria-label="Mob Graphwar ranked battlefield">
        <defs>
          <linearGradient id="arenaGround" x1="0" x2="1">
            <stop offset="0%" stopColor="#16382f" />
            <stop offset="62%" stopColor="#244737" />
            <stop offset="100%" stopColor="#10221f" />
          </linearGradient>
          <linearGradient id="skyField" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#071017" />
            <stop offset="55%" stopColor="#09141f" />
            <stop offset="100%" stopColor="#0b1118" />
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
        <RouteGuideLayer state={state} />
        <FlatMapObstacleLayer state={state} />
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

function PostMatchRecap({ autoBattle, state, profile, playback }) {
  const score = state.score;
  const rankDelta = Number.isFinite(Number(autoBattle?.rankDelta)) ? Number(autoBattle.rankDelta) : null;
  const modelTurns = autoBattle?.modelTurns || [];
  const proofTurn = modelTurns.find((turn) => turn.rulesDigest) || null;
  const rulesDigest = proofTurn?.rulesDigest || playback?.action?.rulesDigest || null;
  const finalEvent = autoBattle?.finalEvent || state.events[state.events.length - 1] || null;
  const result = autoBattle ? battleResultLabel(autoBattle.winner) : state.winner ? battleResultLabel(state.winner) : "Awaiting ranked result";
  return (
    <div className="post-match-recap" data-testid="post-match-recap">
      <div className="panel-title"><Trophy size={18} /> Post Match Recap</div>
      <div className="recap-headline">
        <div>
          <span>{autoBattle ? "Rank delta" : "Rank delta pending"}</span>
          <strong>{rankDelta === null ? "Pending" : `${rankDelta > 0 ? "+" : ""}${rankDelta}`}</strong>
          <small>{profile ? `${profile.rank.tier} ${profile.rank.rating}` : "Guest spectator"}</small>
        </div>
        <div>
          <span>Result</span>
          <strong>{result}</strong>
          <small>{score ? `${score.rank} · ${score.value}` : "No ranked score yet"}</small>
        </div>
      </div>
      <div className="recap-proof-grid">
        <span><b>Bare-rules proof</b>{rulesDigest?.promptPolicy || "waiting for model turn"}</span>
        <span><b>Legal shots</b>{Number.isFinite(Number(rulesDigest?.legalShotCount)) ? rulesDigest.legalShotCount : "-"}</span>
        <span><b>Hand</b>{rulesDigest?.handRetained ? `${rulesDigest.handSize} retained` : "pending"}</span>
        <span><b>Swaps</b>{Number.isFinite(Number(rulesDigest?.swapsRemaining)) ? `${rulesDigest.swapsRemaining} left` : "-"}</span>
      </div>
      <p>
        {finalEvent
          ? `${finalEvent.provider || "Local AI"} closed with ${finalEvent.resultLabel || finalEvent.result}.`
          : "Finish a ranked room to see the model's decisive action, rules packet proof, and rank outcome."}
      </p>
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
          <strong>awaiting launch order</strong>
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

function SimulationApiPanel() {
  const curl = `curl -X POST /api/simulations/league \\
  -H "content-type: application/json" \\
  -d '{"rounds":4,"contestants":[{"id":"router-a","provider":"openrouter","model":"openrouter/free","command":"thread the maze"},{"id":"router-b","provider":"openrouter","model":"openrouter/free","command":"bend center"}]}'`;
  return (
    <div className="simulation-api-panel" data-testid="simulation-api-panel">
      <div className="panel-title"><RadioTower size={18} /> Simulation API</div>
      <p className="empty-copy">The exported league endpoint lets AI models auto-run ranked seeds and compare rating without touching live player rooms.</p>
      <div className="api-contract-grid">
        <span><b>Endpoint</b>/api/simulations/league</span>
        <span><b>Method</b>POST</span>
        <span><b>Contract</b>bare_rules_only</span>
        <span><b>Mode</b>watch-only</span>
      </div>
      <code>{curl}</code>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
