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
    const hardTarget =
      has(["must", "only", "exact", "lock", "force target"]) || /必须|只打|只瞄|仅打|锁定|指定|就打/.test(raw);
    const safe = has(["safe", "avoid", "careful", "conservative"]) || /安全|避|绕开|避免|小心|别误伤|保守|稳/.test(raw);
    const forbidRisk =
      safe ||
      has(["no risk", "no volatile", "avoid volatile", "no risky", "no gamble"]) ||
      /不冒险|别冒险|不要冒险|不用冒险|禁止冒险|禁用冒险|不要高危|不用高危|禁用高危|不要volatile|不用volatile|禁用volatile/i.test(
        raw
      );
    const requiredTargetIds = hardTarget ? targetIds : [];
    const ruleSummary = [];
    if (requiredTargetIds.length) ruleSummary.push(`hard target ${requiredTargetIds.join(" then ")}`);
    if (forbidRisk) ruleSummary.push("no volatile/risk cards");
    if (safe) ruleSummary.push("avoid ally hits");
    return {
      raw,
      targetIds,
      requiredTargetIds,
      hardTarget,
      forbidRisk,
      avoidAllyHits: safe,
      ruleSummary: ruleSummary.length ? ruleSummary : ["soft guidance only"],
      safe,
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

  function summarizeRules(directive, targetRule) {
    const ruleSummary = [];
    if (targetRule) {
      ruleSummary.push(targetRule);
    } else if (directive.requiredTargetIds && directive.requiredTargetIds.length) {
      ruleSummary.push(`hard target ${directive.requiredTargetIds.join(" then ")}`);
    }
    if (directive.forbidRisk) ruleSummary.push("no volatile/risk cards");
    if (directive.avoidAllyHits) ruleSummary.push("avoid ally hits");
    return ruleSummary.length ? ruleSummary : ["soft guidance only"];
  }

  function applyTargetConstraints(targets, directive) {
    if (!directive.requiredTargetIds || !directive.requiredTargetIds.length) {
      return { targets, ruleSummary: summarizeRules(directive, null) };
    }
    const required = targets.filter((target) => directive.requiredTargetIds.includes(target.id));
    if (required.length) {
      return {
        targets: required,
        ruleSummary: summarizeRules(directive, `hard target ${directive.requiredTargetIds.join(" then ")}`)
      };
    }
    return {
      targets,
      ruleSummary: summarizeRule