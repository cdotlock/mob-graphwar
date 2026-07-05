(function initApp() {
  "use strict";

  const Sim = window.GraphwarSim;
  const svg = document.getElementById("battlefield");
  const seedInput = document.getElementById("seedInput");
  const commandA = document.getElementById("commandA");
  const commandB = document.getElementById("commandB");
  const commandCountA = document.getElementById("commandCountA");
  const commandCountB = document.getElementById("commandCountB");
  const statusStrip = document.getElementById("statusStrip");
  const shotSummary = document.getElementById("shotSummary");
  const handCards = document.getElementById("handCards");
  const handTitle = document.getElementById("handTitle");
  const handHint = document.getElementById("handHint");
  const thinkingPanel = document.getElementById("thinkingPanel");
  const mapBadge = document.getElementById("mapBadge");
  const activeBadge = document.getElementById("activeBadge");
  const eventLog = document.getElementById("eventLog");
  const resetBtn = document.getElementById("resetBtn");
  const nextBtn = document.getElementById("nextBtn");
  const runBtn = document.getElementById("runBtn");
  const autoBtn = document.getElementById("autoBtn");
  const copyTraceBtn = document.getElementById("copyTraceBtn");
  const providerEnabled = document.getElementById("providerEnabled");
  const providerSelect = document.getElementById("providerSelect");
  const providerModel = document.getElementById("providerModel");
  const providerKey = document.getElementById("providerKey");
  const providerStatus = document.getElementById("providerStatus");

  let state = Sim.createInitialState({ seed: Number(seedInput.value) });
  let autoTimer = null;
  let busy = false;

  function commands() {
    return {
      A: commandA.value.slice(0, Sim.CONFIG.maxCommandLength),
      B: commandB.value.slice(0, Sim.CONFIG.maxCommandLength)
    };
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function unitColor(team) {
    return team === "A" ? "var(--team-a)" : "var(--team-b)";
  }

  function pathClass(team) {
    return team === "A" ? "path-a" : "path-b";
  }

  function updateCommandCounts() {
    commandCountA.textContent = `${commandA.value.length}/80`;
    commandCountB.textContent = `${commandB.value.length}/80`;
  }

  function statusItem(label, value) {
    return `<div class="status-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function renderStatus() {
    const aHp = state.units
      .filter((unit) => unit.team === "A")
      .map((unit) => `${unit.name}:${unit.hp}`)
      .join(" ");
    const bHp = state.units
      .filter((unit) => unit.team === "B")
      .map((unit) => `${unit.name}:${unit.hp}`)
      .join(" ");
    const nextTeam = state.winner ? "-" : state.turn % 2 === 0 ? "A" : "B";
    const energy = state.winner ? "-" : Sim.getEnergy(state.turn);
    const score = state.score ? `${state.score.rank} / ${state.score.value}` : "pending";
    statusStrip.innerHTML = [
      statusItem("Turn", `${state.turn}/${Sim.CONFIG.maxTurns}`),
      statusItem("Next", nextTeam),
      statusItem("Energy", energy),
      statusItem("Map", `${state.mapMeta.name} ${state.mapMeta.difficulty}`),
      statusItem("Team A HP", aHp),
      statusItem("Team B HP", bHp),
      statusItem("Rank", score),
      statusItem("Result", state.winner ? `${state.winner} (${state.reason})` : "running")
    ].join("");
    mapBadge.textContent = `${state.mapMeta.name} - difficulty ${state.mapMeta.difficulty}`;
    activeBadge.textContent = state.winner ? `Final rank ${score}` : `Team ${nextTeam} locks next shot`;
  }

  function terrainPath() {
    const pts = [];
    for (let x = 0; x <= Sim.CONFIG.width; x += 1) {
      pts.push(`${sx(x)},${sy(Sim.groundY(x))}`);
    }
    return `M0,600 L${pts.join(" L")} L1000,600 Z`;
  }

  function renderGrid() {
    const parts = [];
    for (let x = 0; x <= 100; x += 10) {
      parts.push(`<line class="grid-line" x1="${sx(x)}" y1="0" x2="${sx(x)}" y2="600" />`);
    }
    for (let y = 0; y <= 60; y += 10) {
      parts.push(`<line class="grid-line" x1="0" y1="${sy(y)}" x2="1000" y2="${sy(y)}" />`);
    }
    parts.push(`<line class="axis-line" x1="0" y1="${sy(0)}" x2="1000" y2="${sy(0)}" />`);
    return parts.join("");
  }

  function renderObstacles() {
    return state.obstacles
      .map((obstacle) => {
        const x = sx(obstacle.x);
        const y = sy(obstacle.y + obstacle.h);
        const w = obstacle.w * 10;
        const h = obstacle.h * 10;
        return `<rect class="obstacle" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"><title>${esc(
          obstacle.id
        )}</title></rect>`;
      })
      .join("");
  }

  function renderUnits() {
    return state.units
      .map((unit) => {
        const dead = unit.hp <= 0 ? " dead" : "";
        return `
          <g>
            <circle class="unit${dead}" cx="${sx(unit.x)}" cy="${sy(unit.y)}" r="${Sim.CONFIG.unitRadius * 10}" fill="${
              unit.hp <= 0 ? "#8d949c" : unitColor(unit.team)
            }">
              <title>${esc(unit.name)} HP ${unit.hp}</title>
            </circle>
            <text class="unit-label" x="${sx(unit.x)}" y="${sy(unit.y) - 30}" text-anchor="middle">${esc(
              unit.name
            )} ${unit.hp}</text>
          </g>`;
      })
      .join("");
  }

  function renderPaths() {
    const total = Math.max(1, state.paths.length);
    return state.paths
      .map((path, index) => {
        const age = total - index - 1;
        const opacity = Math.max(0.16, 1 - age * 0.12);
        const width = index === total - 1 ? 3.5 : 2;
        const marker = path.collisionPoint
          ? renderCollision(path, index === total - 1)
          : "";
        return `
          <polyline class="${pathClass(path.team)}" points="${pointList(path.points)}" stroke-width="${width}" opacity="${opacity.toFixed(
            2
          )}">
            <title>Turn ${path.turn} ${path.team}: ${esc(path.result)}</title>
          </polyline>
          ${marker}`;
      })
      .join("");
  }

  function renderCollision(path, fresh) {
    const point = path.collisionPoint;
    const color = path.team === "A" ? "var(--blue)" : "var(--red)";
    const teamColor = path.team === "A" ? "var(--team-a)" : "var(--team-b)";
    if (path.result === "hitEnemy" || path.result === "hitAlly") {
      return `<circle class="hit-ring" cx="${sx(point.x)}" cy="${sy(point.y)}" r="${
        fresh ? 25 : 18
      }" stroke="${teamColor}" opacity="${fresh ? 0.95 : 0.45}" />`;
    }
    const x = sx(point.x);
    const y = sy(point.y);
    return `
      <g opacity="${fresh ? 0.95 : 0.45}">
        <line class="miss-mark" x1="${x - 10}" y1="${y - 10}" x2="${x + 10}" y2="${y + 10}" />
        <line class="miss-mark" x1="${x + 10}" y1="${y - 10}" x2="${x - 10}" y2="${y + 10}" />
      </g>`;
  }

  function renderBattlefield() {
    svg.innerHTML = `
      <rect x="0" y="0" width="1000" height="600" fill="#07110c" />
      ${renderGrid()}
      <path class="terrain" d="${terrainPath()}" />
      ${renderObstacles()}
      ${renderPaths()}
      ${renderUnits()}
    `;
  }

  function renderShotSummary() {
    const event = state.events[state.events.length - 1];
    if (!event) {
      shotSummary.innerHTML = `
        <div class="summary-row"><span>Status</span><strong>No shots yet</strong></div>
        <div class="summary-row"><span>Rule</span><code>Lock Shot resolves exactly one AI function.</code></div>
      `;
      thinkingPanel.innerHTML = `
        <div class="thinking-row"><span>Intent</span><strong>Waiting for first lock-in</strong></div>
        <div class="thinking-row"><span>Constraint</span><strong>Current hand is visible below the board</strong></div>
      `;
      renderCurrentHand();
      return;
    }

    shotSummary.innerHTML = [
      summaryRow("Turn", `${event.turn} / Team ${event.team}`),
      summaryRow("Shooter", `${event.shooterId} -> ${event.targetId}`),
      summaryRow("Command", event.command || "(empty)"),
      summaryRow("Result", `${event.resultLabel}, damage ${event.damage}`),
      summaryRow("Energy", `${event.cost}/${event.energy}`),
      summaryRow("Agent", event.provider || "Local"),
      summaryRow("Rules", event.thinking?.commandRules || "soft guidance only"),
      summaryRow("Combo", comboSummary(event)),
      summaryRow("Expression", `<code>${esc(event.expression)}</code>`, true),
      summaryRow("Closest", `${event.closestTargetDistance}u, maxY ${event.maxY}`)
    ].join("");

    renderThinking(event);
    renderCurrentHand();
  }

  function summaryRow(label, value, raw) {
    return `<div class="summary-row"><span>${esc(label)}</span><strong>${raw ? value : esc(value)}</strong></div>`;
  }

  function comboSummary(event) {
    if (!event.combo) return event.components.map((component) => component.label).join(" + ") || "baseline";
    const traits = (event.combo.traits || []).join(" / ");
    return `${event.combo.name}${traits ? ` - ${traits}` : ""}`;
  }

  function cardMarkup(card, used) {
    const tags = (card.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("");
    return `
      <article class="card ${esc(card.rarity || "basic")}${used ? " used" : ""}">
        <div class="card-meta"><span>${esc(card.family)}</span><span>${esc(card.rarity || "basic")}</span></div>
        <h3>${esc(card.label)} <small>${card.cost}E</small></h3>
        <p>${esc(card.description)}</p>
        <div class="tag-row">${tags}</div>
      </article>`;
  }

  function renderCurrentHand() {
    const event = state.events[state.events.length - 1];
    if (state.winner && event) {
      handTitle.textContent = `Final Shot Hand - Team ${event.team}`;
      handHint.textContent = "Used cards glow";
      handCards.innerHTML = event.hand.map((card) => cardMarkup(card, event.usedCardIds.includes(card.instanceId))).join("");
      return;
    }
    const team = state.turn % 2 === 0 ? "A" : "B";
    const hand = Sim.dealHand(state.seed, state.turn, team);
    handTitle.textContent = `Cu