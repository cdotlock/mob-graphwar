import React, { useState } from "react";
import { Bot, Layers3, Map, Settings2 } from "lucide-react";
import { AgentThought } from "../game/AgentThought.jsx";
import { Battlefield } from "../game/Battlefield.jsx";
import { FunctionHand } from "../game/FunctionHand.jsx";
import { GameSetup } from "../game/GameSetup.jsx";
import { Sim } from "../lib/sim.js";

export function PlayPage(props) {
  const [mobileView, setMobileView] = useState("battlefield");
  const state = props.state;
  const activeUnit = state.winner ? null : Sim.getActiveUnit(state);
  const latestEvent = state.events?.at(-1) || null;
  const displayUnitId = props.frameAction?.unitId || latestEvent?.unitId || latestEvent?.shooterId || activeUnit?.id || "A1";
  const handState = state.hands?.[displayUnitId];
  const hand = handState?.cards || Sim.getCurrentHand(state, displayUnitId) || [];
  const tabs = [
    { id: "battlefield", icon: Map, zh: "战场", en: "Battle" },
    { id: "setup", icon: Settings2, zh: "设置", en: "Setup" },
    { id: "thought", icon: Bot, zh: "思考", en: "Thought" },
    { id: "hand", icon: Layers3, zh: "手牌", en: "Hand" }
  ];
  return (
    <main className="play-page" data-mobile-view={mobileView}>
      <div className="mobile-task-tabs" role="tablist" aria-label={props.locale === "zh" ? "游戏面板" : "Game panels"}>
        {tabs.map(({ id, icon: Icon, zh, en }) => <button role="tab" aria-selected={mobileView === id} className={mobileView === id ? "active" : ""} key={id} onClick={() => setMobileView(id)}><Icon size={16} />{props.locale === "zh" ? zh : en}</button>)}
      </div>
      <div className="play-layout">
        <GameSetup {...props} />
        <div className="battle-column">
          <Battlefield state={state} locale={props.locale} playbackIndex={props.playbackIndex} playbackTotal={props.playbackTotal} rankDelta={props.rankDelta} />
          <div className="mobile-live-summary">
            <span><small>{props.locale === "zh" ? "当前函数" : "Function"}</small><code>{props.frameAction?.event?.expression || latestEvent?.expression || "y = ..."}</code></span>
            <span><small>{props.locale === "zh" ? "模型结果" : "Result"}</small><strong>{props.frameAction?.resultLabel || props.frameAction?.event?.resultLabel || latestEvent?.resultLabel || (props.locale === "zh" ? "等待开火" : "Waiting")}</strong></span>
          </div>
          <FunctionHand locale={props.locale} hand={hand} unitId={displayUnitId} />
        </div>
        <AgentThought locale={props.locale} action={props.frameAction} event={latestEvent} activeUnit={activeUnit} roster={props.match?.roster || props.roster} />
      </div>
    </main>
  );
}
