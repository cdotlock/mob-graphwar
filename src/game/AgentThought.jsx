import React from "react";
import { Bot, Crosshair, FunctionSquare, Sparkles } from "lucide-react";

export function AgentThought({ locale, action, event, activeUnit, roster }) {
  const zh = locale === "zh";
  const team = action?.team || event?.team || activeUnit?.team || "A";
  const unitId = action?.unitId || event?.unitId || activeUnit?.id || "A1";
  const seat = roster?.find((item) => item.unitId === unitId) || roster?.find((item) => item.team === team);
  const expression = action?.event?.expression || action?.expression || event?.expression || "y = ...";
  const thought = action?.modelThought || event?.thinking?.providerReason || action?.publicReason || event?.thinking?.publicReason || (zh ? "等待模型输出" : "Waiting for model output");
  const result = action?.resultLabel || action?.event?.resultLabel || event?.resultLabel || (zh ? "尚未开火" : "No shot yet");
  const target = action?.event?.targetId || action?.targetId || event?.targetId || "-";
  const damage = Number(action?.event?.damage ?? event?.damage);

  return (
    <aside className={`thought-panel team-${String(team).toLowerCase()}`} aria-label={zh ? "智能体思考" : "Agent reasoning"}>
      <div className="panel-heading">
        <div><Bot size={17} /><span><strong>{zh ? "智能体思考" : "Agent reasoning"}</strong><small>{seat?.model || seat?.provider || "model"}</small></span></div>
        <span className="active-agent">{unitId}</span>
      </div>
      <div className="thought-body">
        <section className="thought-block primary">
          <span><Sparkles size={14} />{zh ? "模型想法" : "Model thought"}</span>
          <p>{thought}</p>
        </section>
        <section className="thought-block function-output">
          <span><FunctionSquare size={14} />{zh ? "本回合函数" : "Function"}</span>
          <code>{expression}</code>
        </section>
        <div className="thought-facts">
          <span><small>{zh ? "动作" : "Action"}</small><b>{action?.action || (event ? "shot" : "-")}</b></span>
          <span><small>{zh ? "目标" : "Target"}</small><b>{target}</b></span>
          <span><small>{zh ? "伤害" : "Damage"}</small><b>{Number.isFinite(damage) ? damage : "-"}</b></span>
          <span><small>{zh ? "精度" : "Precision"}</small><b>{Number.isFinite(event?.proximityAccuracy) ? `${Math.round(event.proximityAccuracy * 100)}%` : "-"}</b></span>
        </div>
        <section className="thought-block result-output">
          <span><Crosshair size={14} />{zh ? "服务端判定" : "Server result"}</span>
          <p>{result}</p>
        </section>
      </div>
    </aside>
  );
}
