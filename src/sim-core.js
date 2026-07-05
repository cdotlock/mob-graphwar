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
    maxTurns: 16,
    handSize: 5,
    baseEnergy: 4,
    maxEnergy: 8,
    maxCardsPerShot: 3,
    maxShapeCards: 2,
    maxModifierCards: 1,
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
      family: "lift",
      cost: 2,
      rarity: "basic",
      tags: ["clearance", "stable"],
      component: "arc",
      amplitudes: [14, 20, 26, 32],
      description: "Reliable parabolic lift for clearing towers."
    },
    low_lob: {
      id: "low_lob",
      label: "Low Lob",
      family: "lift",
      cost: 1,
      rarity: "basic",
      tags: ["cheap", "flat"],
      component: "arc",
      amplitudes: [7, 10, 13, -7],
      description: "Cheap shallow lift when energy is tight."
    },
    sky_hook: {
      id: "sky_hook",
      label: "Sky Hook",
      family: "lift",
      cost: 3,
      rarity: "rare",
      tags: ["clearance", "high"],
      component: "arc",
      amplitudes: [28, 36, 44],
      description: "Big over-wall lift with a high ceiling."
    },
    overpass: {
      id: "overpass",
      label: "Overpass",
      family: "lift",
      cost: 4,
      rarity: "rare",
      tags: ["clearance", "expensive"],
      component: "arc",
      amplitudes: [38, 46, 54],
      description: "Huge arc that solves brutal central cover."
    },
    bend: {
      id: "bend",
      label: "Bend",
      family: "bend",
      cost: 2,
      rarity: "basic",
      tags: ["corner", "stable"],
      component: "bend",
      amplitudes: [10, 16, 22, -12],
      description: "Sharp triangular lift or dip."
    },
    knife_bend: {
      id: "knife_bend",
      label: "Knife Bend",
      family: "bend",
      cost: 3,
      rarity: "rare",
      tags: ["corner", "volatile", "damage"],
      component: "bend",
      amplitudes: [24, 31, -22],
      effect: { damageBonus: 8, volatility: 16 },
      description: "Hard bend with extra damage and extra risk."
    },
    tunnel: {
      id: "tunnel",
      label: "Tunnel",
      family: "bend",
      cost: 2,
      rarity: "common",
      tags: ["thread", "corner"],
      component: "hook",
      amplitudes: [12, 18, -12, -18],
      description: "Asymmetric hook for threading around slots."
    },
    wave: {
      id: "wave",
      label: "Wave",
      family: "wave",
      cost: 3,
      rarity: "rare",
      tags: ["clearance", "smooth"],
      component: "wave",
      amplitudes: [18, 24, 32, 38],
      description: "Half sine wave for smooth high arcs."
    },
    sway: {
      id: "sway",
      label: "Sway",
      family: "wave",
      cost: 3,
      rarity: "common",
      tags: ["weave", "volatile"],
      component: "sway",
      amplitudes: [9, 15, 21, -15, -21],
      description: "Full sine wave for vertical weaving."
    },
    ripple: {
      id: "ripple",
      label: "Ripple",
      family: "wave",
      cost: 2,
      rarity: "common",
      tags: ["weave", "cheap"],
      component: "ripple",
      amplitudes: [6, 10, 14, -10, -14],
      description: "Small oscillation for nudging a curve."
    },
    wobble: {
      id: "wobble",
      label: "Wobble",
      family: "risk",
      cost: 1,
      rarity: "common",
      tags: ["volatile", "cheap"],
      component: "ripple",
      amplitudes: [12, 18, -12, -18],
      effect: { volatility: 12 },
      description: "Cheap unstable correction with odd misses."
    },
    cubic: {
      id: "cubic",
      label: "Cubic",
      family: "control",
      cost: 3,
      rarity: "rare",
      tags: ["dive", "control"],
      component: "cubic",
      amplitudes: [12, 20, 28, -12, -20, -28],
      description: "Early rise and late dive, or the reverse."
    },
    clamp: {
      id: "clamp",
      label: "Clamp",
      family: "control",
      cost: 1,
      rarity: "common",
      tags: ["shelf", "cheap"],
      component: "clamp",
      amplitudes: [5, 9, -5, -9],
      description: "Flattens the middle of a shot."
    },
    shelf: {
      id: "shelf",
      label: "Shelf",
      family: "control",
      cost: 2,
      rarity: "common",
      tags: ["shelf", "precision"],
      component: "shelf",
      amplitudes: [10, 16, -10, -16],
      effect: { precisionBonus: 18 },
      description: "Holds the mid-curve steady near ledges."
    },
    late_dive: {
      id: "late_dive",
      label: "Late Dive",
      family: "risk",
      cost: 2,
      rarity: "common",
      tags: ["dive", "volatile"],
      component: "dive",
      amplitudes: [-8, -14, -20, 10],
      effect: { volatility: 10 },
      description: "Drops late to punish elevated targets."
    },
    booster: {
      id: "booster",
      label: "Booster",
      family: "risk",
      cost: 2,
      rarity: "rare",
      tags: ["damage", "volatile"],
      component: "arc",
      amplitudes: [18, 28, 38, -18],
      effect: { damageBonus: 12, volatility: 18 },
      description: "Adds force, damage, and risk."
    },
    needle: {
      id: "needle",
      label: "Needle",
      family: "modifier",
      cost: 2,
      rarity: "common",
      tags: ["precision", "thread"],
      component: "spike",
      amplitudes: [10, 16, 22, -10],
      effect: { precisionBonus: 24 },
      description: "Narrow mid-flight correction for tight shots."
    },
    anchor: {
      id: "anchor",
      label: "Anchor",
      family: "modifier",
      cost: 1,
      rarity: "basic",
      tags: ["precision", "cheap"],
      component: "clamp",
      amplitudes: [4, 7, -4, -7],
      effect: { precisionBonus: 12 },
      description: "Small stabilizer that favors clean paths."
    },
    prism: {
      id: "prism",
      label: "Prism",
      family: "modifier",
      cost: 3,
      rarity: "rare",
      tags: ["thread", "precision"],
      component: "hook",
      amplitudes: [18, 24, -18, -24],
      effect: { precisionBonus: 16 },
      description: "Late hook for side-door angles."
    },
    mortar: {
      id: "mortar",
      label: "Mortar",
      family: "risk",
      cost: 3,
      rarity: "rare",
      tags: ["high", "damage", "volatile"],
      component: "spike",
      amplitudes: [24, 34, 44],
      effect: { damageBonus: 10, volatility: 22 },
      description: "Tall punchy crest that can overcook."
    },
    glide: {
      id: "glide",
      label: "Glide",
      family: "control",
      cost: 2,
      rarity: "common",
      tags: ["smooth", "precision"],
      component: "lift",
      amplitudes: [8, 14, 20, -8],
      effect: { precisionBonus: 10 },
      description: "Smooth early lift that keeps the tail readable."
    }
  };

  const STARTER_POOL = [
    "arc",
    "arc",
    "low_lob",
    "bend",
    "bend",
    "wave",
    "sway",
    "ripple",
    "cubic",
    "clamp",
    "shelf",
    "late_dive",
    "needle",
    "anchor",
    "tunnel",
    "glide",
    "sky_hook",
    "knife_bend",
    "wobble",
    "booster",
    "prism",
    "mortar",
    "overpass"
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

  const MAP_TEMPLATES = [
    {
      id: "basalt-gate",
      name: "Basalt Gate",
      difficulty: 74,
      obstacles: [
        { id: "gate-spire", x: 42, y: 0, w: 7, h: 35 },
        { id: "right-slit", x: 61, y: 0, w: 6, h: 22 },
        { id: "bridge-block", x: 52, y: 35, w: 15, h: 5 },
        { id: "left-lip", x: 30, y: 17, w: 8, h: 4 }
      ],
      units: [
        { id: "A1", team: "A", name: "A1", x: 13, lift: 9 },
        { id: "A2", team: "A", name: "A2", x: 24, lift: 6 },
        { id: "B1", team: "B", name: "B1", x: 87, lift: 8 },
        { id: "B2", team: "B", name: "B2", x: 76, lift: 17 }
      ]
    },
    {
      id: "needle-canyon",
      name: "Needle Canyon",
      difficulty: 81,
      obstacles: [
        { id: "left-needle", x: 35, y: 0, w: 5, h: 31 },
        { id: "center-needle", x: 50, y: 0, w: 6, h: 42 },
        { id: "right-needle", x: 66, y: 0, w: 5, h: 28 },
        { id: "ceiling-slab", x: 42, y: 43, w: 20, h: 4 }
      ],
      units: [
        { id: "A1", team: "A", name: "A1", x: 12, lift: 8 },
        { id: "A2", team: "A", name: "A2", x: 23, lift: 13 },
        { id: "B1", team: "B", name: "B1", x: 88, lift: 9 },
        { id: "B2", team: "B", name: "B2", x: 77, lift: 15 }
      ]
    },
    {
      id: "upper-lock",
      name: "Upper Lock",
      difficulty: 78,
      obstacles: [
        { id: "lock-tower", x: 45, y: 0, w: 8, h: 29 },
        { id: "upper-lock", x: 49, y: 31, w: 19, h: 6 },
        { id: "low-wall", x: 61, y: 0, w: 5, h: 16 },
        { id: "left-shelf", x: 28, y: 21, w: 10, h: 4 }
      ],
      units: [
        { id: "A1", team: "A", name: "A1", x: 14, lift: 8 },
        { id: "A2", team: "A", name: "A2", x: 25, lift: 18 },
        { id: "B1", team: "B", name: "B1", x: 86, lift: 7 },
        { id: "B2", team: "B", name: "B2", x: 73, lift: 14 }
      ]
    },
    {
      id: "split-roof",
      name: "Split Roof",
      difficulty: 86,
      obstacles: [
        { id: "left-roof", x: 33, y: 25, w: 15, h: 5 },
        { id: "center-pillar", x: 49, y: 0, w: 8, h: 39 },
        { id: "right-roof", x: 58, y: 32, w: 15, h: 5 },
        { id: "right-pillar", x: 70, y: 0, w: 6, h: 24 },
        { id: "low-bunker", x: 24, y: 0, w: 6, h: 14 }
      ],
      units: [
        { id: "A1", team: "A", name: "A1", x: 12, lift: 7 },
        { id: "A2", team: "A", name: "A2", x: 26, lift: 20 },
        { id: "B1", team: "B", name: "B1", x: 88, lift: 8 },
        { id: "B2", team: "B", name: "B2", x: 74, lift: 19 }
      ]
    }
  ];

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

  function shuffle(items, seed) {
    const rng = mulberry32(hashString(seed));
    const pile = items.slice();
    for (let i = pile.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const temp = pile[i];
      pile[i] = pile[j];
      pile[j] = temp;
    }
    return pile;
  }

  function createTeamDeck(seed, team) {
    const shuffled = shuffle(STARTER_POOL, `${seed}:${team}:starter-deck`);
    const required = ["arc", "bend", "wave", "low_lob", "anchor", "needle"];
    const deck = required.concat(shuffled);
    return deck.slice(0, 24);
  }

  function dealHand(seed, turn, team) {
    const deck = createTeamDeck(seed, team);
    const pile = shuffle(
      deck.map((id, index) => ({ id, instanceId: `${id}-${index}` })),
      `${seed}:${turn}:${team}:hand`
    );
    const hand = pile.slice(0, CONFIG.handSize).map((item, slot) => ({
      ...CARD_LIBRARY[item.id],
      instanceId: `${team}${turn}-${slot}-${item.id}`
    }));
    const shapeCount = hand.filter((card) => card.family !== "modifier").length;
    if (shapeCount < 2) {
      const replacements = ["arc", "bend"].slice(0, 2 - shapeCount);
      for (let i = 0; i < replacements.length; i += 1) {
        const id = replacements[i];
        hand[hand.length - 1 - i] = {
          ...CARD_LIBRARY[id],
          instanceId: `${team}${turn}-repair-${i}-${id}`
        };
      }
    }
    return hand;
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

  function generateMap(seed) {
    const rng = mulberry32(hashString(`${seed}:map`));
    const template = clone(MAP_TEMPLATES[Math.floor(rng() * MAP_TEMPLATES.length)]);
    const jitter = (amount) => Math.round((rng() * amount * 2 - amount) * 10) / 10;
    const obstacles = template.obstacles.map((obstacle, index) => ({
      ...obstacle,
      x: clamp(round(obstacle.x + jitter(index === 0 ? 2 : 4), 1), 8, CONFIG.width - obstacle.w - 8),
      h: clamp(round(obstacle.h + jitter(4), 1), 10, 45)
    }));
    const units = template.units.map((unit, index) => {
      const x = clamp(round(unit.x + jitter(index % 2 === 0 ? 2 : 3), 1), 6, CONFIG.width - 6);
      return {
        id: unit.id,
        team: unit.team,
        name: unit.name,
        x,
        y: round(groundY(x) + unit.lift + rng() * 2.2, 1),
        hp: 100
      };
    });
    const tallCount = obstacles.filter((obstacle) => obstacle.h >= 24).length;
    const density = obstacles.reduce((sum, obstacle) => sum + obstacle.w * obstacle.h, 0) / (CONFIG.width * CONFIG.height);
    const difficulty = clamp(Math.round(template.difficulty + tallCount * 2 + density * 80 + rng() * 5), 60, 95);
    return {
      id: template.id,
      name: template.name,
      difficulty,
      obstacles,
      units
    };
  }

  function createInitialState(options) {
    const opts = options || {};
    const seed = Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 7351;
    const map = generateMap(seed);
    return {
      seed,
      turn: 0,
      config: clone(CONFIG),
      mapMeta: {
        id: map.id,
        name: map.name,
        difficulty: map.difficulty
      },
      obstacles: clone(map.obstacles),
      units: clone(map.units),
      initialUnits: clone(map.units),
      events: [],
      paths: [],
      score: null,
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
    const kind = component.component || component.id;
    if (kind === "arc") {
      return component.amp * 4 * tau * (1 - tau);
    }
    if (kind === "lift") {
      return component.amp * Math.sin(Math.PI * tau) * (1 - 0.25 * tau);
    }
    if (kind === "bend") {
      return component.amp * (1 - Math.abs(2 * tau - 1));
    }
    if (kind === "hook") {
      return component.amp * Math.sin(Math.PI * tau) * (tau < 0.58 ? 0.55 : 1.25);
    }
    if (kind === "wave") {
      return component.amp * Math.sin(Math.PI * tau);
    }
    if (kind === "sway") {
      return component.amp * Math.sin(Math.PI * 2 * tau);
    }
    if (kind === "ripple") {
      return component.amp * Math.sin(Math.PI * 3 * tau) * 0.55;
    }
    if (kind === "cubic") {
      return component.amp * 6.2 * tau * (1 - tau) * (tau - 0.5);
    }
    if (kind === "dive") {
      return component.amp * tau * tau * (1.35 - 0.35 * tau);
    }
    if (kind === "spike") {
      const spike = Math.max(0, 1 - Math.abs(tau - 0.62) / 0.22);
      return component.amp * spike;
    }
    if (kind === "clamp") {
      const shelf = tau > 0.26 && tau < 0.74 ? component.amp : 0;
      return shelf * 0.65;
    }
    if (kind === "shelf") {
      const shelf = tau > 0.18 && tau < 0.82 ? component.amp : component.amp * 0.25;
      return shelf * 0.72;
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
    const values = Array.isArray(card.amplitudes) ? card.amplitudes.slice() : [0];
    if (directive.high && card.tags.includes("clearance")) {
      return values.concat(values.filter((amp) => amp > 0).map((amp) => round(amp * 1.18, 1)));
    }
    if (directive.low && !directive.high) {
      return values.filter((amp) => amp <= 16);
    }
    if (directive.bend && card.tags.includes("corner")) {
      return values.concat(values.filter((amp) => Math.abs(amp) >= 16).map((amp) => round(amp * 1.1, 1)));
    }
    return values;
  }

  function generateComponentCombos(hand, energy, directive) {
    const cards = hand.filter((card) => CARD_LIBRARY[card.id]);
    const options = [{ components: [], cost: 0, usedCardIds: [] }];

    for (const card of cards) {
      const existing = options.slice();
      for (const base of existing) {
        if (base.components.length >= CONFIG.maxCardsPerShot) continue;
        const nextCost = base.cost + card.cost;
        if (nextCost > energy) continue;
        const nextComponents = base.components.concat({
          id: card.id,
          cardId: card.instanceId,
          label: card.label,
          family: card.family,
          tags: card.tags.slice(),
          effect: card.effect || null,
          component: card.component,
          amp: 0
        });
        const shapeCount = nextComponents.filter((component) => component.family !== "modifier").length;
        const modifierCount = nextComponents.filter((component) => component.family === "modifier").length;
        if (shapeCount > CONFIG.maxShapeCards || modifierCount > CONFIG.maxModifierCards) continue;
        for (const amp of cardAmplitudeOptions(card, directive)) {
          options.push({
            components: base.components.concat({
              id: card.id,
              cardId: card.instanceId,
              label: card.label,
              family: card.family,
              tags: card.tags.slice(),
              effect: card.effect || null,
              component: card.component,
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
    if (components.length > CONFIG.maxCardsPerShot) {
      return { ok: false, reason: "too_many_components", cost };
    }
    const shapeCount = components.filter((component) => component.family !== "modifier").length;
    const modifierCount = components.filter((component) => component.family === "modifier").length;
    if (shapeCount > CONFIG.maxShapeCards) {
      return { ok: false, reason: "too_many_shape_cards", cost };
    }
    if (modifierCount > CONFIG.maxModifierCards) {
      return { ok: false, reason: "too_many_modifier_cards", cost };
    }
    return { ok: true, reason: "ok", cost };
  }

  function sumEffects(components) {
    return components.reduce(
      (totals, component) => {
        const effect = component.effect || {};
        totals.damageBonus += effect.damageBonus || 0;
        totals.precisionBonus += effect.precisionBonus || 0;
        totals.volatility += effect.volatility || 0;
        return totals;
      },
      { damageBonus: 0, precisionBonus: 0, volatility: 0 }
    );
  }

  function scoreSimulation(sim, shot, directive) {
    let score = 0;
    const effects = sumEffects(shot.components);
    if (sim.kind === "hitEnemy") {
      score += sim.unitId === shot.target.id ? 1000 : 720;
      score += effects.damageBonus * 3;
      if (directive.aggressive) score += 80;
    } else if (sim.kind === "hitAlly") {
      score -= directive.safe ? 1300 : 850;
      score -= effects.volatility * 8;
    } else if (sim.kind === "blocked") {
      score -= 360 + effects.volatility * 5;
    } else if (sim.kind === "ground") {
      score -= 260 + effects.volatility * 4;
    } else if (sim.kind === "out" || sim.kind === "invalid") {
      score -= 420 + effects.volatility * 5;
    } else {
      score -= 140;
    }

    score -= Math.max(0, sim.closestTargetDistance - effects.precisionBonus / 20) * (directive.aggressive ? 7 : 9);
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
      score += shot.components.filter((component) => component.tags.includes("corner")).length * 35;
    }
    if (shot.components.some((component) => component.tags.includes("precision"))) score += 16;
    if (shot.components.some((component) => component.tags.includes("clearance")) && directive.high) score += 24;
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

  function describeIntent(directive) {
    const parts = [];
    if (directive.targetIds.length) parts.push(`priority ${directive.targetIds.join(" then ")}`);
    if (directive.high) parts.push("high clearance");
    if (directive.safe) parts.push("avoid allies");
    if (directive.aggressive) parts.push("finish damage");
    if (directive.low) parts.push("low path");
    return parts.length ? parts.join(", ") : "balanced shot";
  }

  function riskNote(shot, sim, directive) {
    const volatile = shot.components.filter((component) => component.tags.includes("volatile")).length;
    if (sim.kind === "hitAlly") return "ally path risk materialized";
    if (sim.kind === "blocked") return "cover was still too tight";
    if (sim.kind === "ground") return "curve dropped into terrain";
    if (sim.kind === "out") return "curve overcooked above the board";
    if (volatile) return directive.safe ? "volatile card accepted despite safe command" : "volatile card used for payoff";
    if (sim.closestTargetDistance <= CONFIG.unitRadius + 1) return "clean firing line";
    return "miss distance was the main risk";
  }

  function buildThinking(decision) {
    const usedLabels = decision.shot.components.map((component) => component.label);
    return {
      intent: describeIntent(decision.directive),
      targetPriority: decision.targetPriority,
      handConstraint: `${decision.hand.length} cards, ${decision.energy} energy, ${CONFIG.maxShapeCards} shapes + ${CONFIG.maxModifierCards} modifier max`,
      selectedCombo: usedLabels.length ? usedLabels.join(" + ") : "baseline line",
      risk: riskNote(decision.shot, decision.sim, decision.directive),
      projectedResult: resultLabel(decision.sim),
      publicReason: `${decision.shooter.id} aimed at ${decision.target.id} with ${
        usedLabels.length ? usedLabels.join(" + ") : "baseline"
      } because ${describeIntent(decision.directive)}.`
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
            state,
            shooter,
            target,
            targetPriority: targets.map((rankedTarget, index) => ({
              id: rankedTarget.id,
              hp: rankedTarget.hp,
              priority: index + 1
            })),
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
    const kind = component.component || component.id;
    if (kind === "arc") return `${amp}*arc(u/d)`;
    if (kind === "lift") return `${amp}*lift(u/d)`;
    if (kind === "bend") return `${amp}*bend(u/d)`;
    if (kind === "hook") return `${amp}*hook(u/d)`;
    if (kind === "wave") return `${amp}*sin(pi*u/d)`;
    if (kind === "sway") return `${amp}*sin(2*pi*u/d)`;
    if (kind === "ripple") return `${amp}*ripple(u/d)`;
    if (kind === "cubic") return `${amp}*cubic(u/d)`;
    if (kind === "dive") return `${amp}*dive(u/d)`;
    if (kind === "spike") return `${amp}*spike(u/d)`;
    if (kind === "clamp" || kind === "shelf") return `${amp}*shelf(u/d)`;
    return `${amp}*${kind}(u/d)`;
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

  function calculateBattleScore(state) {
    const winner = state.winner;
    const alliedTeam = winner === "A" || winner === "B" ? winner : null;
    const alliedHp = alliedTeam
      ? state.units.filter((unit) => unit.team === alliedTeam).reduce((sum, unit) => sum + unit.hp, 0)
      : 0;
    const enemyHits = state.events.filter((event) => event.result === "hitEnemy").length;
    const allyHits = state.events.filter((event) => event.result === "hitAlly").length;
    const failures = state.events.filter((event) => ["blocked", "ground", "out", "miss", "invalid"].includes(event.result)).length;
    const winBase = winner === "draw" ? 250 : alliedTeam ? 600 : 0;
    const difficulty = state.mapMeta ? state.mapMeta.difficulty : 60;
    const value =
      winBase +
      alliedHp +
      enemyHits * 35 -
      failures * 25 -
      allyHits * 45 -
      state.events.length * 6 +
      Math.round(difficulty * (alliedTeam ? 2.2 : 0.9));
    let rank = "D";
    if (winner !== "draw" && value >= 980) rank = "S";
    else if (winner !== "draw" && value >= 850) rank = "A";
    else if (value >= 680) rank = "B";
    else if (value >= 480) rank = "C";
    return {
      value: Math.max(0, Math.round(value)),
      rank,
      winner,
      difficulty,
      enemyHits,
      allyHits,
      failures,
      turns: state.events.length
    };
  }

  function finalizeBattle(state) {
    state.score = calculateBattleScore(state);
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
      const effects = sumEffects(decision.shot.components);
      damage = sim.kind === "hitEnemy" ? CONFIG.hitDamage + effects.damageBonus : CONFIG.allyDamage;
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
        family: card.family,
        rarity: card.rarity,
        tags: card.tags,
        cost: card.cost,
        instanceId: card.instanceId,
        description: card.description
      })),
      usedCardIds: decision.shot.usedCardIds,
      components: decision.shot.components,
      expression: formatExpression(decision.shot),
      thinking: buildThinking(decision),
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
      finalizeBattle(state);
    } else if (state.turn + 1 >= CONFIG.maxTurns) {
      state.winner = "draw";
      state.reason = "max_turns";
      finalizeBattle(state);
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
      mapMeta: clone(state.mapMeta),
      obstacles: state.obstacles,
      initialUnits: clone(state.initialUnits || BASE_SCENARIO.units),
      finalUnits: clone(state.units),
      events: clone(state.events),
      score: clone(state.score),
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
