import React from "react";
import { Layers3 } from "lucide-react";

export function FunctionHand({ locale, hand, unitId }) {
  const zh = locale === "zh";
  return (
    <section className="function-hand" aria-label={zh ? "当前函数手牌" : "Current function hand"}>
      <div className="hand-label"><Layers3 size={16} /><span><strong>{zh ? "函数手牌" : "Function hand"}</strong><small>{unitId} · {zh ? "只限制可用函数类型" : "function families only"}</small></span></div>
      <div className="hand-cards">
        {(hand || []).map((card, index) => (
          <article className="function-card" key={card.instanceId || `${card.id}-${index}`}>
            <span>{index + 1} · {card.family}</span>
            <code>{card.label}</code>
            <small>{(card.tags || []).slice(0, 2).join(" / ")}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
