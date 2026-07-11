import React, { useMemo, useState } from "react";
import { Bot, KeyRound, RefreshCw, Search, Swords } from "lucide-react";

export function GameSetup({ locale, profile, config, providers, busy, status, error, onChange, onRefreshModels, onMatch, onOpenAuth }) {
  const [search, setSearch] = useState("");
  const selectedProvider = providers.find((provider) => provider.id === config.provider) || providers[0];
  const models = useMemo(() => {
    const list = Array.isArray(selectedProvider?.models) ? selectedProvider.models : [];
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? list.filter((model) => `${model.label || ""} ${model.id || ""}`.toLowerCase().includes(needle))
      : list;
    const selected = list.find((model) => model.id === config.model);
    const compact = filtered.slice(0, needle ? 80 : 28);
    return selected && !compact.some((model) => model.id === selected.id) ? [selected, ...compact] : compact;
  }, [config.model, search, selectedProvider]);
  const zh = locale === "zh";

  return (
    <aside className="setup-panel" aria-label={zh ? "对战设置" : "Match setup"}>
      <div className="panel-heading">
        <div><Bot size={17} /><span><strong>{zh ? "你的 AI 指挥官" : "Your AI commander"}</strong><small>A1 + A2 / one model</small></span></div>
        <span className={profile ? "status-dot online" : "status-dot"}>{profile ? profile.rank?.rating : "guest"}</span>
      </div>

      <div className="setup-scroll">
        <label>{zh ? "供应商" : "Provider"}
          <select value={config.provider} onChange={(event) => {
            const provider = providers.find((item) => item.id === event.target.value);
            onChange({ ...config, provider: event.target.value, model: provider?.model || provider?.models?.[0]?.id || "" });
            setSearch("");
          }}>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </label>

        <label>{zh ? "搜索模型" : "Search models"}
          <span className="input-with-icon"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={zh ? "输入模型名" : "Model name"} /></span>
        </label>

        <label>{zh ? "模型" : "Model"}
          <span className="select-action"><select value={config.model} onChange={(event) => onChange({ ...config, model: event.target.value })}>
            {models.length ? models.map((model) => (
              <option key={model.id} value={model.id}>{model.label || model.id}{model.free ? " · free" : ""}</option>
            )) : <option value={config.model}>{config.model || (zh ? "输入 Key 后刷新" : "Refresh after key")}</option>}
          </select><button className="icon-button" onClick={() => onRefreshModels(config.provider, config.apiKey)} title={zh ? "拉取最新模型" : "Refresh models"} aria-label={zh ? "拉取最新模型" : "Refresh models"}><RefreshCw size={15} /></button></span>
        </label>

        <label>{zh ? "API Key（只存本机）" : "API key (this browser only)"}
          <span className="input-with-icon"><KeyRound size={15} /><input type="password" value={config.apiKey} onChange={(event) => onChange({ ...config, apiKey: event.target.value })} autoComplete="off" placeholder="sk-..." /></span>
          <small className="field-note">{zh ? "账号、排行榜和服务器存档都不会保存它。" : "Never saved to your account, leaderboard, or server store."}</small>
        </label>

        <label className="prompt-field">{zh ? "开局指令" : "Standing prompt"}
          <textarea value={config.standingOrder} onChange={(event) => onChange({ ...config, standingOrder: event.target.value.slice(0, 80) })} maxLength={80} placeholder={zh ? "例如：优先打残血，精确绕开队友" : "e.g. prioritize weak enemies, avoid allies"} />
          <small className="counter">{config.standingOrder.length}/80</small>
        </label>

        <label>{zh ? "挂机局数" : "Games"}
          <input type="number" min="1" max="25" value={config.autoRounds} onChange={(event) => onChange({ ...config, autoRounds: Math.max(1, Math.min(25, Number(event.target.value) || 1)) })} />
        </label>
      </div>

      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <p className="setup-status">{status}</p>
      {profile ? (
        <button className="match-command" disabled={busy || !config.apiKey.trim()} onClick={onMatch}>
          <Swords size={18} /> <span>{busy ? (zh ? "匹配中..." : "Matching...") : (zh ? "随机匹配" : "Random Match")}</span>
        </button>
      ) : (
        <button className="match-command" onClick={onOpenAuth}><Swords size={18} /><span>{zh ? "登录后开始" : "Sign in to play"}</span></button>
      )}
    </aside>
  );
}
