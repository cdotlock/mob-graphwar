(function initGraphwarSim(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GraphwarSim = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function graphwarFactory() {
  "use strict";

  const CONFIG = {
    width: 100,
    height: 60,
    viewPadding: 0,
    maxTurns: 14,
    handSize: 4,
    baseEnergy: 4,
    maxEnergy: 7,
    maxCommandLength: 80,
    sampleStep: 0.35,
    unitRadius: 2.4,
    hitDamage: 46,
    allyDamage: 30
  };

  const CARD_LIBRARY = {
    arc: {
      id: "arc",
      label: "Arc",
      cost: 2,
      rarity: "basic",
      description: "Parabolic lift. Best for clearing towers."
    },
    bend: {
      id: "bend",
      label: "Bend",
      cost: 2,
      rarity: "basic",
      description: "Sharp triangular lift or dip."
    },
    wave: {
      id: "wave",
      label: "Wave",
      cost: 3,
      rarity: "rare",
      description: "Half sine wave for smooth high arcs."
    },
    sway: {
      id: "sway",
      label: "Sway",
      cost: 3,
      rarity: "common",
      description: "Full sine wave for vertical weaving."
    },
    cubic: {
      id: "cubic",
      label: "Cubic",
      cost: 3,
      rarity: "rare",
      description: "Early rise and late dive, or the reverse."
    },
    clamp: {
      id: "clamp",
      label: "Clamp",
      cost: 1,
      rarity: "common",
      description: "Flattens the middle of a shot."
    }
  };

  const DECK = [
    "arc",
    "arc",
    "arc",
    "bend",
    "bend",
    "bend",
    "wave",
    "wave",
    "sway",
    "sway",
    "cubic",
    "clamp"
  ];

  const BASE_SCENARIO = {
    obstacles: [
      { id: "central-tower", x: 43, y: 0, w: 7, h: 32 },
      { id: "right-wall", x: 61, y: 0, w: 6, h: 19 },
      { id: "upper-block", x: 52, y: 34, w: 13, h: 5 }
    ],
    units: [
      { id: "A1", team: "A", name: "A1", x: 14, y: 13, hp: 100 },
      { id: "A2", team: "A", name: "A2", x: 24, y: 9, hp: 100 },
      { id: "B1", team: "B", name: "B1", x: 86, y: 13, hp: 100 },
      { id: "B2", team: "B", name: "B2", x: 75, y: 22, hp: 100 }
    ]
  };

  function hashString(value) {
    let hash = 2166136261;
    const input = String(value);
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function nextRandom() {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function round(value, digits) {
    const scale = 10 ** (digits || 2);
    return Math.round(value * scale) / scale;
  }

  function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function groundY(x) {
    return 4.2 + 1.2 * Math.sin(x / 8) + 0.8 * Math.sin(x / 17 + 1.5);
  }

  function dealHand(seed, turn, team) {
    const rng = mulberry32(hashString(`${seed}:${turn}:${team}:hand`));
    const pile = DECK.map((id, index) => ({ id, instanceId: `${id}-${index}` }));
    for (let i = pile.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const temp = pile[i];
      pile[i] = pile[j];
      pile[j] = temp;
    }
    return pile.slice(0, CONFIG.handSize).map((item, slot) => ({
      ...CARD_LIBRARY[item.id],
      instanceId: `${team}${turn}-${slot}-${item.id}`
    }));
  }

  function getEnergy(turn) {
    return Math.min(CONFIG.maxEnergy, CONFIG.baseEnergy + Math.floor(turn / 3));
  }

  function parseDirective(command) {
    const raw = String(command || "").slice(0, CONFIG.maxCommandLength);
    const text = raw.toLowerCase();
    const has = (terms) => terms.some((term) => text.includes(term));
    const targetIds = Array.from(new Set((raw.match(/[AB][12]/gi) || []).map((id) => id.toUpperCase())));
    return {
      raw,
      targetIds,
      safe: has(["safe", "avoid", "careful"]) || /安全|避|绕开|避免|小心|别误伤/.test(raw),
      aggressive: has(["aggressive", "finish", "force", "kill"]) || /激进|击杀|收割|强打/.test(raw),
      high:
        has(["high", "lob", "arc", "over"]) || /高|上缘|高抛|高弧|越过|越塔|越墙|绕塔|绕墙/.test(raw),
      low: has(["low", "direct", "flat"]) || /低|直线|贴地/.test(raw),
      weakest: has(["weak", "low hp", "finish"]) || /残血|低血|收割/.test(raw),
      nearest: has(["near", "close"]) || /最近|近的/.test(raw),
      bend: has(["bend", "sharp", "zig"]) || /弯|折|拐/.test(raw)
    };
  }

  function createInitialState(options) {
    const opts = options || {};
    return {
      seed: Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 7351,
      turn: 0,
      config: clone(CONFIG),
      obstacles: clone(BASE_SCENARIO.obstacles),
      units: clone(BASE_SCENARIO.units),
      events: [],
      paths: [],
      winner: null,
      reason: "running"
    };
  }

  function isAlive(unit) {
    return unit.hp > 0;
  }

  function getTeamUnits(state, team) {
    return state.units.filter((unit) => unit.team === team);
  }

  function getAliveTeamUnits(state, team) {
    return getTeamUnits(state, team).filter(isAlive);
  }

  function getWinner(state) {
    const aAlive = getAliveTeamUnits(state, "A").length > 0;
    const bAlive = getAliveTeamUnits(state, "B").length > 0;
    if (aAlive && !bAlive) return "A";
    if (bAlive && !aAlive) return "B";
    if (!aAlive && !bAlive) return "draw";
    return null;
  }

  function chooseShooter(state, team) {
    const alive = getAliveTeamUnits(state, team);
    if (!alive.length) return null;
    return alive[Math.floor(state.turn / 2) % alive.length];
  }

  function rankTargets(state, shooter, directive) {
    const enemies = state.units.filter((unit) => unit.team !== shooter.team && isAlive(unit));
    return enemies
      .map((enemy) => {
        let score = 0;
        if (directive.targetIds.includes(enemy.id)) score += 360 - directive.targetIds.indexOf(enemy.id) * 40;
        if (directive.weakest) score += (100 - enemy.hp) * 2;
        if (directive.nearest) score -= distance(shooter, enemy) * 1.8;
        score -= enemy.hp * 0.12;
        score -= distance(shooter, enemy) * 0.12;
        if (directive.aggressive) score += (100 - enemy.hp) * 0.6;
        return { enemy, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.enemy);
  }

  function componentValue(component, tau) {
    if (component.id === "arc") {
      return component.amp * 4 * tau * (1 - tau);
    }
    if (component.id === "bend") {
      return component.amp * (1 - Math.abs(2 * tau - 1));
    }
    if (component.id === "wave") {
      return component.amp * Math.sin(Math.PI * tau);
    }
    if (component.id === "sway") {
      return component.amp * Math.sin(Math.PI * 2 * tau);
    }
    if (component.id === "cubic") {
      return component.amp * 6.2 * tau * (1 - tau) * (tau - 0.5);
    }
    if (component.id === "clamp") {
      const shelf = tau > 0.26 && tau < 0.74 ? component.amp : 0;
      return shelf * 0.65;
    }
    return 0;
  }

  function evalShotY(shot, u) {
    const tau = clamp(u / shot.distance, 0, 1);
    let y = shot.shooter.y + shot.deltaY * tau;
    for (const component of shot.components) {
      y += componentValue(component, tau);
    }
    return y;
  }

  function pointInsideObstacle(point, obstacle) {
    return (
      point.x >= obstacle.x &&
      point.x <= obstacle.x + obstacle.w &&
      point.y >= obstacle.y &&
      point.y <= obstacle.y + obstacle.h
    );
  }

  function simulateShot(state, shot) {
    const points = [];
    const direction = shot.target.x >= shot.shooter.x ? 1 : -1;
    const maxU = direction > 0 ? CONFIG.width - shot.shooter.x : shot.shooter.x;
    let closestTargetDistance = Infinity;
    let closestEnemyDistance = Infinity;
    let maxY = -Infinity;

    for (let u = 0; u <= maxU; u += CONFIG.sampleStep) {
      const x = shot.shooter.x + direction * u;
      const y = evalShotY(shot, u);
      const point = { x: round(x, 3), y: round(y, 3) };
      points.push(point);
      maxY = Math.max(maxY, y);

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return {
          kind: "invalid",
          reason: "non_finite",
          points,
          maxY,
          closestTargetDistance,
          closestEnemyDistance
        };
      }

      const targetDist = distance(point, shot.target);
      closestTargetDistance = Math.min(closestTargetDistance, targetDist);

      for (const unit of state.units) {
        if (!isAlive(unit) || unit.id === shot.shooter.id) continue;
        const unitDist = distance(point, unit);
        if (unit.team !== shot.shooter.team) {
          closestEnemyDistance = Math.min(closestEnemyDistance, unitDist);
        }
        if (u > 1.1 && unitDist <= CONFIG.unitRadius) {
          return {
            kind: unit.team === shot.shooter.team ? "hitAlly" : "hitEnemy",
            unitId: unit.id,
            unitTeam: unit.team,
            point,
            points,
            maxY,
            closestTargetDistance,
            closestEnemyDistance
          };
        }
      }

      for (const obstacle of state.obstacles) {
        if (pointInsideObstacle(point, obstacle)) {
          return {
            kind: "blocked",
            obstacleId: obstacle.id,
            point,
            points,
            maxY,
            closestTargetDistance,
            closestEnemyDistance
          };
        }
      }

      if (y < groundY(x)) {
        return {
          kind: "ground",
          point,
          points,
          maxY,
          closestTargetDistance,
          closestEnemyDistance
        };
      }

      if (y > CONFIG.height + 18) {
        return {
          kind: "out",
          reason: "ceiling",
          point,
          points,
          maxY,
          closestTargetDistance,
          closestEnemyDistance
        };
      }
    }

    return {
      kind: "miss",
      point: points[points.length - 1],
      points,
      maxY,
      closestTargetDistance,
      closestEnemyDistance
    };
  }

  function cardAmplitudeOptions(card, directive) {
    if (card.id === "arc" || card.id === "wave") {
      if (directive.low && !directive.high) return [8, 12, -8];
      if (directive.high) return [18, 24, 30, 36, -10];
      return [12, 18, 24, -8];
    }
    if (card.id === "bend") {
      if (directive.bend) return [14, 20, 26, -14, -20];
      return [9, 15, 21, -10];
    }
    if (card.id === "sway") {
      return [8, 13, 18, -8, -13, -18];
    }
    if (card.id === "cubic") {
      return [10, 18, 26, -10, -18, -26];
    }
    if (card.id === "clamp") {
      return [5, 10, -5, -10];
    }
    return [0];
  }

  function generateComponentCombos(hand, energy, directive) {
    const cards = hand.filter((card) => CARD_LIBRARY[card.id]);
    const options = [{ components: [], cost: 0, usedCardIds: [] }];

    for (const card of cards) {
      const existing = options.slice();
      for (const base of existing) {
        if (base.components.length >= 2) continue;
        const nextCost = base.cost + card.cost;
        if (nextCost > energy) continue;
        for (const amp of cardAmplitudeOptions(card, directive)) {
          options.push({
            components: base.components.concat({
              id: card.id,
              cardId: card.instanceId,
              label: card.label,
              amp
            }),
            cost: nextCost,
            usedCardIds: base.usedCardIds.concat(card.instanceId)
          });
        }
      }
    }

    return options;
  }

  function validateResourceUse(hand, components, energy) {
    const byInstance = new Map(hand.map((card) => [card.instanceId, card]));
    const seen = new Set();
    let cost = 0;
    for (const component of components) {
      const card = byInstance.get(component.cardId);
      if (!card) {
        return { ok: false, reason: "card_not_in_hand", cost };
      }
      if (seen.has(component.cardId)) {
        return { ok: false, reason: "card_reused", cost };
      }
      seen.add(component.cardId);
      cost += card.cost;
    }
    if (cost > energy) {
      return { ok: false, reason: "not_enough_energy", cost };
    }
    if (components.length > 2) {
      return { ok: false, reason: "too_many_components", cost };
    }
    return { ok: true, reason: "ok", cost };
  }

  function scoreSimulation(sim, shot, directive) {
    let score = 0;
    if (sim.kind === "hitEnemy") {
      score += sim.unitId === shot.target.id ? 1000 : 720;
      if (directive.aggressive) score += 80;
    } else if (sim.kind === "hitAlly") {
      score -= directive.safe ? 1300 : 850;
    } else if (sim.kind === "blocked") {
      score -= 360;
    } else if (sim.kind === "ground") {
      score -= 260;
    } else if (sim.kind === "out" || sim.kind === "invalid") {
      score -= 420;
    } else {
      score -= 140;
    }

    score -= sim.closestTargetDistance * (directive.aggressive ? 7 : 9);
    score -= shot.cost * 7;
    if (directive.safe) {
      score -= Math.max(0, 10 - sim.closestEnemyDistance) * 0.5;
    }
    if (directive.high) {
      score += clamp(sim.maxY - Math.max(shot.shooter.y, shot.target.y), 0, 30) * 1.5;
    }
    if (directive.low) {
      score -= Math.max(0, sim.maxY - 32) * 1.2;
    }
    if (directive.bend) {
      score += shot.components.filter((component) => component.id === "bend").length * 35;
    }
    return score;
  }

  function makeShot(shooter, target, combo) {
    const d = Math.max(1, Math.abs(target.x - shooter.x));
    return {
      shooter: clone(shooter),
      target: clone(target),
      distance: d,
      deltaY: target.y - shooter.y,
      components: clone(combo.components),
      cost: combo.cost,
      usedCardIds: combo.usedCardIds.slice()
    };
  }

  function chooseShot(state, team, command) {
    const shooter = chooseShooter(state, team);
    if (!shooter) return null;

    const directive = parseDirective(command);
    const hand = dealHand(state.seed, state.turn, team);
    const energy = getEnergy(state.turn);
    const targets = rankTargets(state, shooter, directive);
    const combos = generateComponentCombos(hand, energy, directive);

    let best = null;
    for (const target of targets) {
      for (const combo of combos) {
        const validation = validateResourceUse(hand, combo.components, energy);
        if (!validation.ok) continue;
        const shot = makeShot(shooter, target, combo);
        const sim = simulateShot(state, shot);
        const score = scoreSimulation(sim, shot, directive);
        if (!best || score > best.score) {
          best = {
            score,
            team,
            shooter,
            target,
            hand,
            energy,
            directive,
            shot,
            sim,
            validation
          };
        }
      }
    }

    return best;
  }

  function formatComponent(component) {
    const amp = round(component.amp, 1);
    if (component.id === "arc") return `${amp}*arc(u/d)`;
    if (component.id === "bend") return `${amp}*bend(u/d)`;
    if (component.id === "wave") return `${amp}*sin(pi*u/d)`;
    if (component.id === "sway") return `${amp}*sin(2*pi*u/d)`;
    if (component.id === "cubic") return `${amp}*cubic(u/d)`;
    if (component.id === "clamp") return `${amp}*shelf(u/d)`;
    return `${amp}*${component.id}(u/d)`;
  }

  function formatExpression(shot) {
    const base = `y=${round(shot.shooter.y, 1)}+${round(shot.deltaY, 1)}*(u/d)`;
    if (!shot.components.length) return base;
    return `${base}+${shot.components.map(formatComponent).join("+")}`;
  }

  function resultLabel(sim) {
    if (!sim) return "none";
    if (sim.kind === "hitEnemy") return `hit enemy ${sim.unitId}`;
    if (sim.kind === "hitAlly") return `hit ally ${sim.unitId}`;
    if (sim.kind === "blocked") return `blocked by ${sim.obstacleId}`;
    if (sim.kind === "ground") return "hit ground";
    if (sim.kind === "out") return "out of bounds";
    if (sim.kind === "invalid") return "invalid function";
    return "miss";
  }

  function applyTurn(state, commands) {
    if (state.winner) return state;
    const team = state.turn % 2 === 0 ? "A" : "B";
    const command = commands && commands[team] ? commands[team] : "";
    const decision = chooseShot(state, team, command);

    if (!decision) {
      state.winner = team === "A" ? "B" : "A";
      state.reason = "no_alive_shooter";
      return state;
    }

    const sim = decision.sim;
    let damage = 0;
    if (sim.kind === "hitEnemy" || sim.kind === "hitAlly") {
      damage = sim.kind === "hitEnemy" ? CONFIG.hitDamage : CONFIG.allyDamage;
      const hitUnit = state.units.find((unit) => unit.id === sim.unitId);
      if (hitUnit) hitUnit.hp = Math.max(0, hitUnit.hp - damage);
    }

    const event = {
      turn: state.turn,
      team,
      command: decision.directive.raw,
      shooterId: decision.shooter.id,
      targetId: decision.target.id,
      energy: decision.energy,
      cost: decision.shot.cost,
      hand: decision.hand.map((card) => ({
        id: card.id,
        label: card.label,
        cost: card.cost,
        instanceId: card.instanceId,
        description: card.description
      })),
      usedCardIds: decision.shot.usedCardIds,
      components: decision.shot.components,
      expression: formatExpression(decision.shot),
      result: sim.kind,
      resultLabel: resultLabel(sim),
      damage,
      score: round(decision.score, 2),
      closestTargetDistance: round(sim.closestTargetDistance, 2),
      maxY: round(sim.maxY, 2),
      collisionPoint: sim.point || null
    };

    state.events.push(event);
    state.paths.push({
      turn: state.turn,
      team,
      shooterId: decision.shooter.id,
      targetId: decision.target.id,
      points: sim.points,
      result: sim.kind,
      collisionPoint: sim.point || null
    });

    const winner = getWinner(state);
    if (winner) {
      state.winner = winner;
      state.reason = "hp_zero";
    } else if (state.turn + 1 >= CONFIG.maxTurns) {
      state.winner = "draw";
      state.reason = "max_turns";
    }

    state.turn += 1;
    return state;
  }

  function runBattle(options) {
    const opts = options || {};
    const state = createInitialState({ seed: opts.seed });
    const commands = opts.commands || {};
    while (!state.winner && state.turn < CONFIG.maxTurns) {
      applyTurn(state, commands);
    }
    return state;
  }

  function exportTrace(state) {
    return {
      runId: `seed-${state.seed}`,
      seed: state.seed,
      config: state.config,
      obstacles: state.obstacles,
      initialUnits: clone(BASE_SCENARIO.units),
      finalUnits: clone(state.units),
      events: clone(state.events),
      winner: state.winner,
      reason: state.reason,
      totalTurns: state.turn
    };
  }

  return {
    CONFIG,
    CARD_LIBRARY,
    BASE_SCENARIO,
    createInitialState,
    applyTurn,
    runBattle,
    exportTrace,
    dealHand,
    getEnergy,
    groundY,
    parseDirective,
    chooseShot,
    simulateShot,
    validateResourceUse,
    formatExpression,
    resultLabel,
    _internals: {
      hashString,
      mulberry32,
      distance,
      evalShotY,
      generateComponentCombos
    }
  };
});
