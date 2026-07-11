import React from "react";

const WIDTH = 1000;
const HEIGHT = 600;
const sx = (x) => x * 10;
const sy = (y) => HEIGHT - y * 10;

function pathData(points) {
  return (points || []).map((point, index) => `${index ? "L" : "M"}${sx(point.x).toFixed(1)},${sy(point.y).toFixed(1)}`).join(" ");
}

export function Battlefield({ state, locale, playbackIndex, playbackTotal, rankDelta }) {
  const zh = locale === "zh";
  const latestPath = state.paths?.[state.paths.length - 1];
  const teamHp = (team) => state.units.filter((unit) => unit.team === team).reduce((sum, unit) => sum + Math.max(0, unit.hp), 0);
  const result = state.winner === "A" ? (zh ? "A 队获胜" : "Team A wins") : state.winner === "B" ? (zh ? "B 队获胜" : "Team B wins") : (zh ? "平局" : "Draw");

  return (
    <section className="battlefield-panel" aria-label={zh ? "2D 战场" : "2D battlefield"}>
      <div className="battle-status">
        <span><b>{state.mapMeta?.name || "Graphwar"}</b><small>{zh ? "难度" : "difficulty"} {state.mapMeta?.difficulty || "-"}</small></span>
        <span><b>{Math.min(24, Number(state.turn) || 0)} / 24</b><small>{zh ? "行动" : "actions"}</small></span>
        <span className="team-a"><b>A {teamHp("A")} HP</b><small>A1 + A2</small></span>
        <span className="team-b"><b>B {teamHp("B")} HP</b><small>B1 + B2</small></span>
        <span><b>{playbackTotal ? `${playbackIndex + 1}/${playbackTotal}` : (zh ? "待机" : "standby")}</b><small>{zh ? "回放" : "replay"}</small></span>
      </div>
      <div className="map-canvas">
        <svg className="battlefield-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={zh ? "函数轨迹战场" : "Function trajectory battlefield"}>
          <rect className="map-paper" width={WIDTH} height={HEIGHT} />
          <g className="axes">
            <line x1="0" y1="300" x2="1000" y2="300" />
            <line x1="500" y1="0" x2="500" y2="600" />
          </g>
          <g className="obstacles">
            {(state.obstacles || []).filter((obstacle) => obstacle.solid !== false).map((obstacle) => obstacle.shape === "circle" ? (
              <circle key={obstacle.id} cx={sx(obstacle.cx)} cy={sy(obstacle.cy)} r={obstacle.r * 10} />
            ) : (
              <rect key={obstacle.id} x={sx(obstacle.x)} y={sy(obstacle.y + obstacle.h)} width={obstacle.w * 10} height={obstacle.h * 10} rx="12" />
            ))}
          </g>
          <g className="bonus-points">
            {(state.bonusPoints || []).slice(0, 3).map((point) => (
              <g key={point.id} transform={`translate(${sx(point.x)} ${sy(point.y)})`}>
                <circle r={Math.max(8, point.radius * 7)} /><circle r="3" /><text y="-13">+{point.value}</text>
              </g>
            ))}
          </g>
          <g className="trajectories">
            {(state.paths || []).slice(-8).map((path, index, list) => (
              <path key={`${path.turn}-${path.unitId}-${index}`} className={`trajectory team-${String(path.team).toLowerCase()} ${index === list.length - 1 ? "current" : ""}`} d={pathData(path.points)} />
            ))}
          </g>
          <g className="units">
            {(state.units || []).map((unit) => (
              <g key={unit.id} className={`unit team-${unit.team.toLowerCase()} ${unit.hp <= 0 ? "dead" : ""}`} transform={`translate(${sx(unit.x)} ${sy(unit.y)})`}>
                <circle className="unit-aura" r="27" /><circle className="unit-core" r="18" />
                <text className="unit-label" y="-31">{unit.id}</text><text className="unit-hp" y="5">{unit.hp}</text>
              </g>
            ))}
          </g>
          {latestPath?.points?.length ? <circle className={`impact team-${String(latestPath.team).toLowerCase()}`} cx={sx(latestPath.points.at(-1).x)} cy={sy(latestPath.points.at(-1).y)} r="7" /> : null}
        </svg>
        {state.winner ? (
          <div className={`result-banner winner-${String(state.winner).toLowerCase()}`} role="status">
            <strong>{result}</strong><span>{state.reason === "resolution_guard" ? (zh ? "24 次行动后按剩余生命值判定" : "HP result after 24 actions") : (zh ? "对方全部阵亡" : "Enemy team eliminated")}</span>
            {Number.isFinite(rankDelta) ? <b>{rankDelta > 0 ? "+" : ""}{rankDelta} RP</b> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
