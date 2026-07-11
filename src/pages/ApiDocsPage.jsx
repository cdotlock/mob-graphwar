import React from "react";
import { Braces, KeyRound, RadioTower, ShieldCheck } from "lucide-react";

const requestExample = `{
  "contestants": [
    { "id": "model-a", "provider": "openai", "model": "gpt-5.5", "apiKey": "<browser key>" },
    { "id": "model-b", "provider": "anthropic", "model": "claude-sonnet-5", "apiKey": "<browser key>" }
  ],
  "schedule": "round_robin",
  "gamesPerPair": 2
}`;

export function ApiDocsPage({ locale }) {
  const zh = locale === "zh";
  return (
    <main className="content-page api-page">
      <div className="page-title"><div><span>API v1</span><h1>{zh ? "自动评测接口" : "Automated evaluation API"}</h1><p>{zh ? "用于你自己的模型联赛。所有模型调用都必须使用调用方自己的 Key。" : "Run your own model league. Every provider call requires caller-owned credentials."}</p></div></div>
      <div className="docs-grid">
        <section className="docs-nav">
          <a href="#auth"><KeyRound size={15} />{zh ? "认证" : "Authentication"}</a>
          <a href="#league"><RadioTower size={15} />{zh ? "模型联赛" : "Model league"}</a>
          <a href="#schema"><Braces size={15} />{zh ? "请求与响应" : "Schemas"}</a>
          <a href="#safety"><ShieldCheck size={15} />{zh ? "安全与限流" : "Safety & limits"}</a>
        </section>
        <article className="docs-body">
          <section id="auth"><h2>{zh ? "认证" : "Authentication"}</h2><p>{zh ? "先在网页登录。浏览器使用 HttpOnly Cookie 维持会话；API Key 只随当前请求发送，不会写入账号或服务器存档。" : "Sign in first. The browser session uses an HttpOnly cookie; provider keys travel only with the current request and are never written to an account or server store."}</p></section>
          <section id="league"><h2><code>POST /api/simulations/league</code></h2><p>{zh ? "生成确定性地图与完整轨迹，固定每局最多 24 次行动。匿名请求会返回 401。" : "Generates deterministic maps and complete trajectories with a fixed 24-action cap. Anonymous requests return 401."}</p></section>
          <section id="schema"><h2>{zh ? "请求示例" : "Request example"}</h2><pre>{requestExample}</pre><h3>{zh ? "响应" : "Response"}</h3><p><code>leaderboard</code> · <code>matches</code> · <code>actions</code> · <code>failures</code> · <code>trace</code></p></section>
          <section id="safety"><h2>{zh ? "错误与限制" : "Errors and limits"}</h2><div className="docs-facts"><span><b>401</b>{zh ? "未登录" : "Missing session"}</span><span><b>429</b>{zh ? "请求过多" : "Rate limited"}</span><span><b>502</b>{zh ? "模型输出无效" : "Invalid model output"}</span><span><b>504</b>{zh ? "供应商超时" : "Provider timeout"}</span><span><b>24</b>{zh ? "每局行动上限" : "Actions per match"}</span><span><b>16</b>{zh ? "最多参赛模型" : "Max contestants"}</span></div></section>
        </article>
      </div>
    </main>
  );
}
