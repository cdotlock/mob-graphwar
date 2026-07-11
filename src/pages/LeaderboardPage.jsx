import React from "react";
import { FlaskConical, Trophy } from "lucide-react";

function Ladder({ locale, title, icon: Icon, rows, raw }) {
  const zh = locale === "zh";
  return (
    <section className="ladder-section">
      <div className="page-section-heading"><Icon size={19} /><span><strong>{title}</strong><small>{raw ? "raw · no prompt · reasoning off" : (zh ? "模型 + 提示词组合" : "model + prompt combinations")}</small></span></div>
      <div className="ladder-table" role="table">
        <div className="ladder-head" role="row"><span>#</span><span>{zh ? "指挥官 / 模型" : "Commander / model"}</span><span>{zh ? "场次" : "Games"}</span><span>{zh ? "分数" : "Rating"}</span></div>
        {rows.length ? rows.map((row, index) => (
          <div className="ladder-row" role="row" key={row.id}>
            <b>{index + 1}</b>
            <span><strong>{row.displayName}</strong><small>{row.benchmark ? `${row.benchmark.platform} · ${row.benchmark.promptPolicy} · ${row.benchmark.thinkingMode}` : (row.providers || []).join(" · ") || "prompt hash pending"}</small></span>
            <span>{row.games || 0}</span><strong>{row.rating}</strong>
          </div>
        )) : <p className="empty-state">{zh ? "还没有排位数据" : "No ranked data yet"}</p>}
      </div>
    </section>
  );
}

export function LeaderboardPage({ locale, players, onRefresh }) {
  const raw = players.filter((player) => player.benchmark);
  const ranked = players.filter((player) => !player.benchmark);
  const zh = locale === "zh";
  return (
    <main className="content-page leaderboard-page">
      <div className="page-title"><div><span>{zh ? "公开排位" : "Public ranked ladder"}</span><h1>{zh ? "最佳模型 + 最佳提示词" : "Best model + best prompt"}</h1><p>{zh ? "玩家组合与无提示词 Raw 基线分开比较。" : "Player combinations and raw model baselines are kept separate."}</p></div><button className="secondary-command" onClick={onRefresh}>{zh ? "刷新" : "Refresh"}</button></div>
      <div className="leaderboard-columns">
        <Ladder locale={locale} title={zh ? "排位组合" : "Ranked combinations"} icon={Trophy} rows={ranked} />
        <Ladder locale={locale} title={zh ? "Raw 模型基线" : "Raw model baselines"} icon={FlaskConical} rows={raw} raw />
      </div>
    </main>
  );
}
