import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell.jsx";
import { AuthModal } from "./components/AuthModal.jsx";
import { api } from "./lib/api.js";
import { Sim } from "./lib/sim.js";
import {
  clearLocalProviderKey,
  ephemeralProviderConfig,
  loadLocalProviderConfig,
  providerMetadataPayload,
  saveLocalProviderConfig
} from "./lib/local-config.js";
import { ApiDocsPage } from "./pages/ApiDocsPage.jsx";
import { LeaderboardPage } from "./pages/LeaderboardPage.jsx";
import { PlayPage } from "./pages/PlayPage.jsx";

const LOCALE_KEY = "mob-graphwar-locale";
const LEGACY_TOKEN_KEY = "mob-graphwar-session-token";
const FALLBACK_PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", model: "openrouter/free", models: [{ id: "openrouter/free", label: "Auto / Free", free: true }] },
  { id: "openai", label: "OpenAI", model: "gpt-5.5", models: [{ id: "gpt-5.5", label: "GPT-5.5" }] },
  { id: "anthropic", label: "Anthropic", model: "claude-sonnet-5", models: [{ id: "claude-sonnet-5", label: "Claude Sonnet 5" }] },
  { id: "gemini", label: "Gemini", model: "gemini-3.5-flash", models: [{ id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" }] },
  { id: "xai", label: "Grok / xAI", model: "grok-4.3", models: [{ id: "grok-4.3", label: "Grok 4.3" }] },
  { id: "moonshot", label: "Kimi", model: "kimi-k2.7-code", models: [{ id: "kimi-k2.7-code", label: "Kimi K2.7 Code" }] },
  { id: "zhipu", label: "Z.ai", model: "glm-5.2", models: [{ id: "glm-5.2", label: "GLM-5.2" }] },
  { id: "deepseek", label: "DeepSeek", model: "deepseek-v4-flash", models: [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }] },
  { id: "stepfun", label: "StepFun", model: "step-3.7-flash", models: [{ id: "step-3.7-flash", label: "Step 3.7 Flash" }] },
  { id: "minimax", label: "MiniMax", model: "MiniMax-M3", models: [{ id: "MiniMax-M3", label: "MiniMax M3" }] },
  { id: "mimo", label: "MiMo", model: "mimo-v2.5-pro", models: [{ id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" }] }
];
const DEFAULT_ROSTER = [
  { unitId: "A1", team: "A", displayName: "You", provider: "browser", model: "local setup" },
  { unitId: "A2", team: "A", displayName: "You", provider: "browser", model: "local setup" },
  { unitId: "B1", team: "B", displayName: "AI Rival", provider: "openrouter", model: "openrouter/free" },
  { unitId: "B2", team: "B", displayName: "AI Rival", provider: "openrouter", model: "openrouter/free" }
];

function exhibitionState() {
  const state = Sim.createInitialState({ seed: 7402 });
  for (let index = 0; index < 4 && !state.winner; index += 1) {
    Sim.applyTurn(state, { A: "precise route", B: "avoid allies" });
  }
  return state;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function App() {
  const [locale, setLocale] = useState(() => window.localStorage.getItem(LOCALE_KEY) || "zh");
  const [page, setPage] = useState("play");
  const [profile, setProfile] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authValues, setAuthValues] = useState({ handle: "", displayName: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [config, setConfig] = useState(() => loadLocalProviderConfig());
  const [providers, setProviders] = useState(FALLBACK_PROVIDERS);
  const [players, setPlayers] = useState([]);
  const [match, setMatch] = useState(null);
  const [state, setState] = useState(exhibitionState);
  const [frames, setFrames] = useState([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [rankDelta, setRankDelta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const activeFrame = frames[frameIndex] || null;
  const closeAuth = useCallback(() => setAuthOpen(false), []);
  const openAuth = useCallback(() => {
    setAuthError("");
    setAuthOpen(true);
  }, []);

  useEffect(() => {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
    Promise.allSettled([restoreSession(), loadProviders(), loadLeaderboard()]);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LOCALE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    saveLocalProviderConfig(window.localStorage, config);
  }, [config]);

  useEffect(() => {
    if (!frames.length) return undefined;
    setFrameIndex(0);
    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        const next = Math.min(frames.length - 1, current + 1);
        setState(frames[next]?.state || state);
        if (next === frames.length - 1) window.clearInterval(timer);
        return next;
      });
    }, 260);
    return () => window.clearInterval(timer);
  }, [frames]);

  async function restoreSession() {
    try {
      const payload = await api("/api/session/status");
      if (!payload.authenticated) return null;
      setProfile(payload.player);
      setStatus(locale === "zh" ? `已恢复 ${payload.player.displayName}` : `Restored ${payload.player.displayName}`);
      return payload.player;
    } catch (requestError) {
      if (requestError.status !== 401) setError(requestError.message);
      return null;
    }
  }

  async function loadProviders() {
    try {
      const payload = await api("/api/providers");
      const available = (payload.providers || []).filter((provider) => provider.id !== "local");
      if (available.length) setProviders(available);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function loadLeaderboard() {
    try {
      const payload = await api("/api/leaderboard?limit=100");
      setPlayers(payload.players || []);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function refreshModels(providerId, apiKey) {
    if (!apiKey?.trim()) {
      setError(locale === "zh" ? "先输入当前供应商的 API Key" : "Enter this provider's API key first");
      return;
    }
    setError("");
    try {
      const payload = await api(`/api/providers/${providerId}/models`, {
        method: "POST",
        body: JSON.stringify({ apiKey })
      });
      setProviders((current) => current.map((provider) => provider.id === providerId ? { ...provider, models: payload.models || [] } : provider));
      const models = payload.models || [];
      if (models.length && !models.some((model) => model.id === config.model)) setConfig((current) => ({ ...current, model: models[0].id }));
      setStatus(locale === "zh" ? `已更新 ${models.length} 个模型` : `Updated ${models.length} models`);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    setAuthError("");
    try {
      const payload = await api(authMode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          handle: authValues.handle,
          displayName: authValues.displayName,
          password: authValues.password,
          ...providerMetadataPayload(config)
        })
      });
      setProfile(payload.player);
      setAuthOpen(false);
      setStatus(locale === "zh" ? "登录成功，可以开始匹配" : "Signed in. Ready to match.");
      await loadLeaderboard();
    } catch (requestError) {
      setAuthError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setProfile(null);
      setConfig(clearLocalProviderKey());
      setMatch(null);
      setFrames([]);
      setRankDelta(null);
      setState(exhibitionState());
      setStatus(locale === "zh" ? "已退出，浏览器中的 API Key 已清除" : "Signed out and local API key cleared");
    }
  }

  function applyBattlePayload(payload) {
    const latestAutoBattle = payload.autoBattle || payload.autoBattles?.at(-1) || null;
    const room = payload.match;
    setMatch(room);
    setRankDelta(Number.isFinite(Number(payload.rankDelta)) ? Number(payload.rankDelta) : null);
    if (payload.player) setProfile(payload.player);
    if (latestAutoBattle?.frames?.length) {
      setFrames(latestAutoBattle.frames);
      setState(latestAutoBattle.frames[0].state);
    } else if (room?.state) {
      setFrames([]);
      setState(room.state);
    }
  }

  async function resolveAiMatch(room) {
    const payload = await api(`/api/match/${room.id}/auto-duel`, {
      method: "POST",
      body: JSON.stringify({
        standingOrder: config.standingOrder,
        command: config.standingOrder,
        providerConfig: ephemeralProviderConfig(config)
      })
    });
    applyBattlePayload(payload);
    setStatus(locale === "zh" ? "对局完成，正在回放模型函数" : "Match complete. Replaying model functions.");
    await loadLeaderboard();
  }

  async function resolveHumanMatch(room) {
    setStatus(locale === "zh" ? "已匹配人类对手，等待双方模型自动行动..." : "Human matched. Both models are acting automatically...");
    for (let guard = 0; guard < 120; guard += 1) {
      const payload = await api(`/api/match/${room.id}/step`, {
        method: "POST",
        body: JSON.stringify({ providerConfig: ephemeralProviderConfig(config) })
      });
      if (payload.match?.state) {
        setMatch(payload.match);
        setState(payload.match.state);
      }
      if (payload.step?.resolved || payload.match?.status === "resolved") {
        applyBattlePayload(payload);
        setStatus(locale === "zh" ? "人类排位对局完成，正在回放双方函数" : "Human ranked match complete. Replaying both models.");
        await loadLeaderboard();
        return payload;
      }
      await delay(payload.step?.waiting ? 900 : 220);
    }
    throw new Error("opponent_connection_timeout");
  }

  async function findMatch() {
    if (!profile) return openAuth();
    if (!config.apiKey.trim()) {
      setError(locale === "zh" ? "API Key 不能为空；它只会保存在这个浏览器。" : "API key is required and stays in this browser.");
      return;
    }
    setBusy(true);
    setError("");
    setFrames([]);
    setRankDelta(null);
    try {
      await api("/api/profile/providers", { method: "POST", body: JSON.stringify(providerMetadataPayload(config)) });
      const common = {
        preferredProvider: config.provider,
        standingOrder: config.standingOrder,
        rounds: config.autoRounds
      };
      if (config.autoRounds > 1) {
        const batch = await api("/api/match/join", {
          method: "POST",
          body: JSON.stringify({ ...common, allowAiFill: true, providerConfig: ephemeralProviderConfig(config) })
        });
        applyBattlePayload(batch);
        setStatus(locale === "zh" ? `挂机完成 ${batch.batch?.roundsCompleted || config.autoRounds} 局` : `Completed ${batch.batch?.roundsCompleted || config.autoRounds} games`);
        await loadLeaderboard();
        return;
      }

      setStatus(locale === "zh" ? "正在寻找人类对手..." : "Looking for a human opponent...");
      let queued = await api("/api/match/join", { method: "POST", body: JSON.stringify({ ...common, allowAiFill: false }) });
      if (queued.status === "queued") {
        await delay(3500);
        const polled = await api(`/api/matchmaking/${profile.id}`);
        queued = polled.status === "matched" ? { match: polled.match } : await api("/api/match/join", {
          method: "POST",
          body: JSON.stringify({ ...common, allowAiFill: true })
        });
      }
      if (!queued.match) throw new Error("match_not_ready");
      setMatch(queued.match);
      setState(queued.match.state);
      if (!queued.match.filledByAi) {
        await resolveHumanMatch(queued.match);
        return;
      }
      await resolveAiMatch(queued.match);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const roster = useMemo(() => match?.roster || DEFAULT_ROSTER, [match]);
  const pageContent = page === "leaderboard" ? (
    <LeaderboardPage locale={locale} players={players} onRefresh={loadLeaderboard} />
  ) : page === "api" ? (
    <ApiDocsPage locale={locale} />
  ) : (
    <PlayPage
      locale={locale}
      profile={profile}
      config={config}
      providers={providers}
      busy={busy}
      status={status}
      error={error}
      onChange={setConfig}
      onRefreshModels={refreshModels}
      onMatch={findMatch}
      onOpenAuth={openAuth}
      state={state}
      match={match}
      roster={roster}
      frameAction={activeFrame?.action || null}
      playbackIndex={frameIndex}
      playbackTotal={frames.length}
      rankDelta={rankDelta}
    />
  );

  return (
    <AppShell locale={locale} activePage={page} onNavigate={setPage} onToggleLocale={() => setLocale((current) => current === "zh" ? "en" : "zh")} profile={profile} onOpenAuth={openAuth} onLogout={logout}>
      {pageContent}
      <AuthModal open={authOpen} locale={locale} mode={authMode} values={authValues} busy={busy} error={authError} onModeChange={setAuthMode} onChange={setAuthValues} onSubmit={submitAuth} onClose={closeAuth} />
    </AppShell>
  );
}
