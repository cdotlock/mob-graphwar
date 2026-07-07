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
    maxResolutionActions: 96,
    handSize: 4,
    localSearchComboCap: 360,
    maxRerollsPerTurn: 3,
    maxCommandLength: 80,
    sampleStep: 0.35,
    unitRadius: 2.4,
    enemyDamageBase: 24,
    enemyDamageMax: 72,
    allyDamageBase: 14,
    allyDamageMax: 34,
    ceilingBuffer: 36
  };

  const CARD_LIBRARY = {
    arc: {
      id: "arc",
      label: "4*t*(1-t)",
      family: "lift",
      rarity: "basic",
      tags: ["clearance", "stable"],
      component: "arc",
      amplitudes: [14, 20, 26, 32],
      description: "Symmetric quadratic bump with zero endpoints."
    },
    low_lob: {
      id: "low_lob",
      label: "sqrt(t)-t",
      family: "lift",
      rarity: "basic",
      tags: ["compact", "flat"],
      component: "sqrt",
      amplitudes: [8, 12, 16, -8],
      description: "Early lift from a square-root curve."
    },
    sky_hook: {
      id: "sky_hook",
      label: "(1-cos(2*pi*t))/2",
      family: "lift",
      rarity: "rare",
      tags: ["clearance", "high"],
      component: "cos_window",
      amplitudes: [20, 28, 36],
      description: "Raised cosine window for a smooth crest."
    },
    overpass: {
      id: "overpass",
      label: "exp(-((t-0.50)^2)/(2*0.18^2))",
      family: "lift",
      rarity: "rare",
      tags: ["clearance", "tall"],
      component: "gaussian",
      amplitudes: [28, 36, 44],
      description: "Gaussian center bump for tall, narrow clearance."
    },
    bend: {
      id: "bend",
      label: "1-abs(2*t-1)",
      family: "bend",
      rarity: "basic",
      tags: ["corner", "stable"],
      component: "bend",
      amplitudes: [10, 16, 22, -12],
      description: "Absolute-value triangle wave with a center peak."
    },
    knife_bend: {
      id: "knife_bend",
      label: "(2*t-1)*(1-abs(2*t-1))",
      family: "bend",
      rarity: "rare",
      tags: ["corner", "volatile", "damage"],
      component: "chevron",
      amplitudes: [26, 34, -26, -34],
      effect: { damageBonus: 8, volatility: 16 },
      description: "Signed triangular chevron for late directional bends."
    },
    tunnel: {
      id: "tunnel",
      label: "sin(pi*t)*(t<0.58?0.55:1.25)",
      family: "bend",
      rarity: "common",
      tags: ["thread", "corner"],
      component: "hook",
      amplitudes: [12, 18, -12, -18],
      description: "Piecewise sine hook with a stronger late half."
    },
    wave: {
      id: "wave",
      label: "sin(pi*t)",
      family: "wave",
      rarity: "rare",
      tags: ["clearance", "smooth"],
      component: "wave",
      amplitudes: [18, 24, 32, 38],
      description: "Half-period sine lift."
    },
    sway: {
      id: "sway",
      label: "sin(2*pi*t)",
      family: "wave",
      rarity: "common",
      tags: ["weave", "volatile"],
      component: "sway",
      amplitudes: [9, 15, 21, -15, -21],
      description: "Full sine oscillation for over-under routing."
    },
    ripple: {
      id: "ripple",
      label: "0.55*sin(3*pi*t)",
      family: "wave",
      rarity: "common",
      tags: ["weave", "compact"],
      component: "ripple",
      amplitudes: [6, 10, 14, -10, -14],
      description: "Three-lobe sine ripple."
    },
    wobble: {
      id: "wobble",
      label: "sinc(10*(t-0.5))*4*t*(1-t)",
      family: "risk",
      rarity: "common",
      tags: ["volatile", "compact"],
      component: "sinc",
      amplitudes: [14, 20, -14, -20],
      effect: { volatility: 12 },
      description: "Windowed sinc correction with side lobes."
    },
    cubic: {
      id: "cubic",
      label: "6.2*t*(1-t)*(t-0.5)",
      family: "control",
      rarity: "rare",
      tags: ["dive", "control"],
      component: "cubic",
      amplitudes: [12, 20, 28, -12, -20, -28],
      description: "Cubic S-curve with opposite signs on each half."
    },
    clamp: {
      id: "clamp",
      label: "(t>0.26&&t<0.74?0.65:0)",
      family: "control",
      rarity: "common",
      tags: ["shelf", "compact"],
      component: "clamp",
      amplitudes: [5, 9, -5, -9],
      description: "Boxcar middle shelf."
    },
    shelf: {
      id: "shelf",
      label: "(t>0.18&&t<0.82?0.72:0.18)",
      family: "control",
      rarity: "common",
      tags: ["shelf", "precision"],
      component: "shelf",
      amplitudes: [10, 16, -10, -16],
      effect: { precisionBonus: 18 },
      description: "Raised plateau with nonzero tails."
    },
    late_dive: {
      id: "late_dive",
      label: "t*t*(1.35-0.35*t)",
      family: "risk",
      rarity: "common",
      tags: ["dive", "volatile"],
      component: "dive",
      amplitudes: [-8, -14, -20, 10],
      effect: { volatility: 10 },
      description: "Quadratic late ramp."
    },
    booster: {
      id: "booster",
      label: "max(0,t-0.45)*(1-t)",
      family: "risk",
      rarity: "rare",
      tags: ["damage", "volatile"],
      component: "relu",
      amplitudes: [22, 32, -22],
      effect: { damageBonus: 12, volatility: 18 },
      description: "ReLU-style hinge that only activates late."
    },
    needle: {
      id: "needle",
      label: "max(0,1-abs(t-0.62)/0.22)",
      family: "modifier",
      rarity: "common",
      tags: ["precision", "thread"],
      component: "spike",
      amplitudes: [10, 16, 22, -10],
      effect: { precisionBonus: 24 },
      description: "Triangular localized basis function."
    },
    anchor: {
      id: "anchor",
      label: "log1p(6*t)/log(7)-t",
      family: "modifier",
      rarity: "basic",
      tags: ["precision", "compact"],
      component: "log",
      amplitudes: [8, 12, -8, -12],
      effect: { precisionBonus: 12 },
      description: "Logarithmic easing correction with zero endpoints."
    },
    prism: {
      id: "prism",
      label: "tanh(4*(t-0.5))*4*t*(1-t)",
      family: "modifier",
      rarity: "rare",
      tags: ["thread", "precision"],
      component: "tanh",
      amplitudes: [18, 24, -18, -24],
      effect: { precisionBonus: 16 },
      description: "Windowed hyperbolic tangent bend."
    },
    mortar: {
      id: "mortar",
      label: "exp(-((t-0.68)^2)/(2*0.08^2))",
      family: "risk",
      rarity: "rare",
      tags: ["high", "damage", "volatile"],
      component: "narrow_gaussian",
      amplitudes: [24, 34, 44],
      effect: { damageBonus: 10, volatility: 22 },
      description: "Late narrow Gaussian pulse."
    },
    glide: {
      id: "glide",
      label: "sin(pi*t)*(1-0.25*t)",
      family: "control",
      rarity: "common",
      tags: ["smooth", "precision"],
      component: "lift",
      amplitudes: [8, 14, 20, -8],
      effect: { precisionBonus: 10 },
      description: "Damped sine lift with a readable tail."
    },
    sigmoid_gate: {
      id: "sigmoid_gate",
      label: "(sigmoid(12*(t-0.5))-0.5)*4*t*(1-t)",
      family: "control",
      rarity: "rare",
      tags: ["smooth", "precision"],
      component: "sigmoid",
      amplitudes: [16, 24, -16, -24],
      effect: { precisionBonus: 14 },
      description: "Windowed logistic activation for S-shaped corrections."
    },
    softplus_ramp: {
      id: "softplus_ramp",
      label: "(softplus(8*(t-0.5))-softplus(-4))*(1-t)",
      family: "control",
      rarity: "common",
      tags: ["smooth", "dive"],
      component: "softplus",
      amplitudes: [10, 16, -10, -16],
      description: "Softplus ramp that turns on without a hard corner."
    },
    gelu_gate: {
      id: "gelu_gate",
      label: "GELU(2*t-1)*4*t*(1-t)",
      family: "risk",
      rarity: "rare",
      tags: ["damage", "smooth", "volatile"],
      component: "gelu",
      amplitudes: [18, 26, -18],
      effect: { damageBonus: 8, volatility: 12 },
      description: "Transformer-style GELU activation, windowed for shots."
    },
    silu_gate: {
      id: "silu_gate",
      label: "SiLU(4*(t-0.5))*4*t*(1-t)",
      family: "control",
      rarity: "common",
      tags: ["smooth", "thread"],
      component: "silu",
      amplitudes: [12, 18, -12, -18],
      description: "SiLU/Swish activation for asymmetric glide."
    },
    beta_peak: {
      id: "beta_peak",
      label: "30*t^2*(1-t)^5",
      family: "modifier",
      rarity: "common",
      tags: ["precision", "thread"],
      component: "beta",
      amplitudes: [18, 26, -18],
      effect: { precisionBonus: 18 },
      description: "Beta-distribution pulse that peaks early."
    },
    rational_bump: {
      id: "rational_bump",
      label: "t*(1-t)/(0.12+abs(t-0.5))",
      family: "bend",
      rarity: "common",
      tags: ["corner", "stable"],
      component: "rational",
      amplitudes: [10, 16, -10, -16],
      description: "Rational bump with a broad center shoulder."
    },
    atan_bend: {
      id: "atan_bend",
      label: "atan(5*(t-0.5))*4*t*(1-t)",
      family: "bend",
      rarity: "common",
      tags: ["corner", "smooth"],
      component: "atan",
      amplitudes: [12, 18, -12, -18],
      description: "Arctangent bend with saturated tails."
    },
    softsign_bend: {
      id: "softsign_bend",
      label: "((2*t-1)/(1+abs(2*t-1)))*4*t*(1-t)",
      family: "modifier",
      rarity: "basic",
      tags: ["precision", "compact"],
      component: "softsign",
      amplitudes: [10, 14, -10, -14],
      effect: { precisionBonus: 10 },
      description: "Softsign activation for compact signed correction."
    },
    elu_gate: {
      id: "elu_gate",
      label: "ELU(4*(t-0.5))*4*t*(1-t)",
      family: "risk",
      rarity: "common",
      tags: ["volatile", "smooth"],
      component: "elu",
      amplitudes: [14, 20, -14, -20],
      effect: { volatility: 10 },
      description: "ELU activation with a negative soft tail."
    }
  };

  const STARTER_POOL = [
    "arc",
    "low_lob",
    "sky_hook",
    "overpass",
    "bend",
    "knife_bend",
    "tunnel",
    "wave",
    "sway",
    "ripple",
    "wobble",
    "cubic",
    "clamp",
    "shelf",
    "late_dive",
    "booster",
    "needle",
    "anchor",
    "prism",
    "mortar",
    "glide",
    "sigmoid_gate",
    "softplus_ramp",
    "gelu_gate",
    "silu_gate",
    "beta_peak",
    "rational_bump",
    "atan_bend",
    "softsign_bend",
    "elu_gate"
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

  const UNIT_TURN_ORDER = ["A1", "B1", "A2", "B2"];

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

  function createTeamDeck(seed, owner) {
    const shuffled = shuffle(STARTER_POOL, `${seed}:${owner}:starter-deck`);
    const required = ["arc", "bend", "wave", "sigmoid_gate", "overpass", "needle"].filter((id) => CARD_LIBRARY[id]);
    const deck = required.concat(shuffled);
    return deck.slice(0, 32);
  }

  function dealHand(seed, turn, owner, reroll) {
    const rerollIndex = Number.isFinite(Number(reroll)) ? Number(reroll) : 0;
    const deck = createTeamDeck(seed, owner);
    const shuffleSeed = rerollIndex > 0 ? `${seed}:${turn}:${owner}:hand:${rerollIndex}` : `${seed}:${turn}:${owner}:hand`;
    const pile = shuffle(
      deck.map((id, index) => ({ id, instanceId: `${id}-${index}` })),
      shuffleSeed
    );
    const hand = pile.slice(0, CONFIG.handSize).map((item, slot) => ({
      ...CARD_LIBRARY[item.id],
      instanceId: rerollIndex > 0 ? `${owner}${turn}r${rerollIndex}-${slot}-${item.id}` : `${owner}${turn}-${slot}-${item.id}`
    }));
    const shapeCount = hand.filter((card) => card.family !== "modifier").length;
    if (shapeCount < 2) {
      const replacements = ["arc", "bend"].slice(0, 2 - shapeCount);
      const modifierSlots = hand
        .map((card, index) => ({ card, index }))
        .filter((item) => item.card.family === "modifier")
        .map((item) => item.index)
        .reverse();
      for (let i = 0; i < replacements.length; i += 1) {
        const id = replacements[i];
        const slot = modifierSlots[i] ?? hand.length - 1 - i;
        hand[slot] = {
          ...CARD_LIBRARY[id],
          instanceId: `${owner}${turn}-repair-${i}-${id}`
        };
      }
    }
    return hand;
  }

  function teamFromOwner(owner) {
    const text = String(owner || "").toUpperCase();
    if (text.startsWith("A")) return "A";
    if (text.startsWith("B")) return "B";
    return text === "B" ? "B" : "A";
  }

  function getTurnOrder(state) {
    const order = Array.isArray(state && state.turnOrder) && state.turnOrder.length
      ? state.turnOrder
      : UNIT_TURN_ORDER;
    return order.slice();
  }

  function getUnitById(state, unitId) {
    const id = String(unitId || "").toUpperCase();
    return (state.units || []).find((unit) => unit.id === id) || null;
  }

  function createHandState(seed, owner, turn) {
    const normalizedOwner = String(owner || "A1").toUpperCase();
    return {
      owner: normalizedOwner,
      team: teamFromOwner(normalizedOwner),
      turn,
      rerollsUsed: 0,
      swapsUsed: 0,
      cards: dealHand(seed, 0, normalizedOwner, 0)
    };
  }

  function ensureHands(state) {
    if (!state.hands) state.hands = {};
    for (const owner of getTurnOrder(state)) {
      const legacy = state.hands[teamFromOwner(owner)];
      if (!state.hands[owner]) {
        state.hands[owner] = legacy && legacy.cards
          ? {
              ...clone(legacy),
              owner,
              team: teamFromOwner(owner),
              cards: dealHand(state.seed, 0, owner, 0)
            }
          : createHandState(state.seed, owner, state.turn || 0);
      }
      if (state.hands[owner].turn !== state.turn) {
        state.hands[owner].turn = state.turn;
        state.hands[owner].rerollsUsed = 0;
        state.hands[owner].swapsUsed = 0;
      }
      if (!state.hands[owner].owner) state.hands[owner].owner = owner;
      if (!state.hands[owner].team) state.hands[owner].team = teamFromOwner(owner);
      if (!Number.isFinite(Number(state.hands[owner].swapsUsed))) {
        state.hands[owner].swapsUsed = Number(state.hands[owner].rerollsUsed) || 0;
      }
    }
    return state.hands;
  }

  function chooseUnitForTeam(state, team) {
    const alive = getAliveTeamUnits(state, team);
    if (!alive.length) return null;
    const ordered = getTurnOrder(state)
      .map((unitId) => alive.find((unit) => unit.id === unitId))
      .filter(Boolean);
    const pool = ordered.length ? ordered : alive;
    return pool[Math.floor(state.turn / 2) % pool.length];
  }

  function normalizeHandOwner(state, owner) {
    const normalized = String(owner || "").toUpperCase();
    if (getUnitById(state, normalized)) return normalized;
    if (normalized === "A" || normalized === "B") {
      const active = getActiveUnit(state);
      if (active && active.team === normalized) return active.id;
      const teamUnit = chooseUnitForTeam(state, normalized);
      return teamUnit ? teamUnit.id : normalized;
    }
    return normalized || "A1";
  }

  function getHandState(state, owner) {
    const hands = ensureHands(state);
    const handOwner = normalizeHandOwner(state, owner);
    if (!hands[handOwner]) hands[handOwner] = createHandState(state.seed, handOwner, state.turn || 0);
    return hands[handOwner];
  }

  function getCurrentHand(state, owner) {
    return clone(getHandState(state, owner).cards);
  }

  function rerollHand(state, owner) {
    const hands = ensureHands(state);
    const handOwner = normalizeHandOwner(state, owner);
    const handState = hands[handOwner];
    if (!handState) throw new Error("unknown_hand_owner");
    const used = Math.max(Number(handState.rerollsUsed) || 0, Number(handState.swapsUsed) || 0);
    if (used >= CONFIG.maxRerollsPerTurn) {
      throw new Error("reroll_limit_reached");
    }
    handState.rerollsUsed = used + 1;
    handState.swapsUsed = handState.rerollsUsed;
    handState.cards = dealHand(state.seed, state.turn, handOwner, handState.rerollsUsed);
    return {
      action: "swap_hand",
      owner: handOwner,
      unitId: getUnitById(state, handOwner) ? handOwner : null,
      team: handState.team || teamFromOwner(handOwner),
      rerollsUsed: handState.rerollsUsed,
      rerollsRemaining: CONFIG.maxRerollsPerTurn - handState.rerollsUsed,
      swapsUsed: handState.swapsUsed,
      swapsRemaining: CONFIG.maxRerollsPerTurn - handState.swapsUsed,
      cards: clone(handState.cards)
    };
  }

  function swapHand(state, owner) {
    return rerollHand(state, owner);
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

  function inferObstacleRole(obstacle) {
    if (obstacle.shape === "circle") return "blob";
    const id = String(obstacle.id || "");
    if (/ceiling-lock/.test(id)) return "ceiling-lock";
    if (/maze-corridor-wall/.test(id)) return "maze-corridor-wall";
    if (/maze-room/.test(id)) return "maze-room";
    if (/contour-guide|signal-lane|route-rune|cavity-tooth|cross-rib|bulkhead/.test(id)) return "route-contour";
    if (/side-bastion/.test(id)) return "chamber-wall";
    if (/thread-slot/.test(id)) return "thread-slot";
    if (/gate-slit|splitter|right-slit|slit/.test(id)) return "gate-slit";
    if (/ground-rib|low-bumper|low-bunker/.test(id)) return "ground-rib";
    if (/maze-band|floater|shelf|overhang|high-cap|crown|ceiling|bridge|roof|upper|lock/.test(id)) return "maze-band";
    if (/spire|needle|tower|pillar|wall/.test(id)) return "tower";
    return obstacle.h >= 24 ? "tower" : "blocker";
  }

  function inferVisualLayer(obstacle, role, index) {
    if (role === "blob") return Math.max(1, Math.min(5, Math.ceil((obstacle.cy || obstacle.y || 0) / 12)));
    if (role === "ceiling-lock") return 5;
    if (role === "maze-corridor-wall") return 3 + (index % 3);
    if (role === "maze-room") return 2 + (index % 4);
    if (role === "gate-slit") return 3 + (index % 2);
    if (role === "thread-slot") return 2 + (index % 3);
    if (role === "maze-band" && obstacle.y >= 38) return 5;
    if (obstacle.y >= 34) return 4;
    if (obstacle.y >= 18) return 3;
    if (obstacle.y > 0) return 2;
    return obstacle.h >= 24 ? 2 : 1;
  }

  function isRouteGuideObstacle(obstacle, role) {
    const obstacleRole = role || obstacle.role || inferObstacleRole(obstacle);
    return (
      obstacleRole === "maze-room" ||
      obstacleRole === "gate-slit" ||
      obstacleRole === "thread-slot" ||
      obstacleRole === "route-contour" ||
      (obstacleRole === "maze-band" && obstacle.h <= 5)
    );
  }

  function obstacleIsSolid(obstacle) {
    return obstacle && obstacle.solid !== false;
  }

  function obstacleBounds(obstacle) {
    if (obstacle.shape === "circle") {
      const r = Number(obstacle.r) || 0;
      const cx = Number(obstacle.cx);
      const cy = Number(obstacle.cy);
      return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    }
    return { x: obstacle.x, y: obstacle.y, w: obstacle.w, h: obstacle.h };
  }

  function obstacleCenter(obstacle) {
    if (obstacle.shape === "circle") return { x: obstacle.cx, y: obstacle.cy };
    return { x: obstacle.x + obstacle.w / 2, y: obstacle.y + obstacle.h / 2 };
  }

  function obstacleArea(obstacle) {
    if (obstacle.shape === "circle") return Math.PI * obstacle.r * obstacle.r;
    return obstacle.w * obstacle.h;
  }

  function makeCircleObstacle(id, cx, cy, r, extra) {
    const radius = round(r, 1);
    const obstacle = {
      id,
      shape: "circle",
      cx: round(cx, 1),
      cy: round(cy, 1),
      r: radius,
      x: round(cx - radius, 1),
      y: round(cy - radius, 1),
      w: round(radius * 2, 1),
      h: round(radius * 2, 1),
      role: "blob",
      solid: true,
      passThrough: false,
      ...(extra || {})
    };
    return obstacle;
  }

  function normalizeObstacle(obstacle, index) {
    const role = obstacle.role || inferObstacleRole(obstacle);
    const routeGuide = isRouteGuideObstacle(obstacle, role);
    const bounds = obstacleBounds(obstacle);
    return {
      ...obstacle,
      x: round(bounds.x, 1),
      y: round(bounds.y, 1),
      w: round(bounds.w, 1),
      h: round(bounds.h, 1),
      role,
      solid: obstacle.solid == null ? role === "blob" || !routeGuide : Boolean(obstacle.solid),
      passThrough: obstacle.passThrough == null ? routeGuide : Boolean(obstacle.passThrough),
      visualLayer: obstacle.visualLayer || inferVisualLayer(obstacle, role, index),
      tilt: obstacle.tilt == null ? round(((index % 5) - 2) * 0.4, 1) : obstacle.tilt
    };
  }

  function createSolverProbeState(seed, obstacles, units, unitId, bonusPoints) {
    return {
      seed,
      turn: 0,
      obstacles,
      bonusPoints: clone(bonusPoints || []),
      units: clone(units),
      turnOrder: UNIT_TURN_ORDER.slice(),
      hands: {
        [unitId]: createHandState(seed, unitId, 0)
      },
      events: [],
      paths: [],
      winner: null
    };
  }

  function hasEnemyHit(shots) {
    return shots.some((shot) => shot.result === "hitEnemy");
  }

  function estimateSolverPressure(seed, obstacles, units, bonusPoints) {
    const command = "safe route target weakest enemy avoid ally bend wave arc thread";
    let firstHandHits = 0;
    let swapWindowHits = 0;
    let boundedWindows = 0;
    let totalWindows = 0;

    for (const unitId of UNIT_TURN_ORDER) {
      const firstProbe = createSolverProbeState(seed, obstacles, units, unitId, bonusPoints);
      const firstShots = listLegalShots(firstProbe, unitId, command);
      const firstHit = hasEnemyHit(firstShots);
      if (firstHit) firstHandHits += 1;
      if (firstShots.some((shot) => !["invalid", "out"].includes(shot.result))) boundedWindows += 1;

      let windowHit = firstHit;
      const swapProbe = createSolverProbeState(seed, obstacles, units, unitId, bonusPoints);
      for (let swap = 0; swap < CONFIG.maxRerollsPerTurn && !windowHit; swap += 1) {
        rerollHand(swapProbe, unitId);
        const swapShots = listLegalShots(swapProbe, unitId, command);
        windowHit = hasEnemyHit(swapShots);
        if (swapShots.some((shot) => !["invalid", "out"].includes(shot.result))) boundedWindows += 1;
      }
      if (windowHit) swapWindowHits += 1;
      totalWindows += 1;
    }

    const firstHandHitRate = round(firstHandHits / totalWindows, 3);
    const swapWindowHitRate = round(swapWindowHits / totalWindows, 3);
    const boundedWindowRate = round(boundedWindows / (totalWindows * (CONFIG.maxRerollsPerTurn + 1)), 3);
    const requiredSearchWindows = clamp(Math.ceil(1 / Math.max(0.01, swapWindowHitRate)), 2, CONFIG.maxRerollsPerTurn + 1);
    const solverPressure = clamp(
      Math.round(68 + (1 - firstHandHitRate) * 20 + (1 - swapWindowHitRate) * 12 + requiredSearchWindows * 3),
      65,
      99
    );

    return {
      firstHandHitRate,
      swapWindowHitRate,
      boundedWindowRate,
      solverPressure,
      requiredSearchWindows
    };
  }

  function bandIndex(value, max, bands) {
    return clamp(Math.floor((value / max) * bands), 0, bands - 1);
  }

  function analyzeMapTopology(obstacles) {
    const solid = obstacles.filter(obstacleIsSolid);
    const verticalBands = new Set();
    const horizontalBands = new Set();
    const solidCells = new Set();
    const laneHeights = [9, 17, 25, 33, 41, 49];
    let straightLaneBreaks = 0;
    let openLaneCount = 0;

    for (const obstacle of solid) {
      const center = obstacleCenter(obstacle);
      const centerX = center.x;
      const centerY = center.y;
      const xBand = bandIndex(centerX, CONFIG.width, 6);
      const yBand = bandIndex(centerY, CONFIG.height, 6);
      verticalBands.add(xBand);
      horizontalBands.add(yBand);
      solidCells.add(`${xBand}:${yBand}`);
    }

    for (const laneY of laneHeights) {
      const breaks = solid.filter((obstacle) => {
        const bounds = obstacleBounds(obstacle);
        const center = obstacleCenter(obstacle);
        const crossesY =
          obstacle.shape === "circle"
            ? Math.abs(center.y - laneY) <= obstacle.r
            : laneY >= bounds.y && laneY <= bounds.y + bounds.h;
        const central = bounds.x + bounds.w >= 18 && bounds.x <= 84;
        return crossesY && central;
      }).length;
      if (breaks <= 2) openLaneCount += 1;
      straightLaneBreaks += Math.min(3, breaks);
    }

    const chamberCount = clamp(Math.round(solidCells.size / 2.2), 6, 16);
    const topologyTags = ["multi-chamber"];
    if (solid.some((obstacle) => obstacle.shape === "circle")) topologyTags.push("continuous-blobs");
    if (straightLaneBreaks >= 8) topologyTags.push("no-straight-lane");
    if (horizontalBands.size >= 5 && verticalBands.size >= 5) topologyTags.push("full-board-pressure");
    if (obstacles.filter((obstacle) => obstacle.role === "route-contour").length >= 6) topologyTags.push("contour-guided");

    return {
      chamberCount,
      straightLaneBreaks,
      verticalBandCoverage: verticalBands.size,
      horizontalBandCoverage: horizontalBands.size,
      solidBandCoverage: solidCells.size,
      openLaneCount,
      topologyTags
    };
  }

  function projectileMazeObstacles(rng) {
    const obstacles = [];
    const wallXs = [32, 52, 72].map((x) => clamp(round(x + (rng() * 5 - 2.5), 1), 14, 86));
    const gapYs = [15, 34, 23].map((y) => clamp(round(y + (rng() * 8 - 4), 1), 10, 42));
    wallXs.forEach((x, index) => {
      const gapCenter = gapYs[index];
      const gapSize = round(12 + rng() * 4, 1);
      const width = round(1.2 + rng() * 0.9, 1);
      const lowerHeight = round(4 + rng() * 4, 1);
      const upperY = round(gapCenter + gapSize / 2, 1);
      const upperHeight = round(5 + rng() * 5, 1);
      const lowerSolid = index !== 1;
      const upperSolid = index === 1;
      obstacles.push({
        id: `seed-maze-corridor-wall-${index + 1}a`,
        x,
        y: 0,
        w: width,
        h: lowerHeight,
        solid: lowerSolid,
        passThrough: !lowerSolid
      });
      obstacles.push({
        id: `seed-maze-corridor-wall-${index + 1}b`,
        x,
        y: upperY,
        w: width,
        h: upperHeight,
        solid: upperSolid,
        passThrough: !upperSolid
      });
    });

    const caps = [
      { x: 20 + rng() * 8, y: 52 + rng() * 2.5, w: 8 + rng() * 3 },
      { x: 44 + rng() * 7, y: 51.5 + rng() * 2.5, w: 9 + rng() * 3 },
      { x: 68 + rng() * 6, y: 52 + rng() * 2.5, w: 8 + rng() * 3 }
    ];
    caps.forEach((cap, index) => {
      obstacles.push({
        id: `seed-ceiling-lock-${index + 1}`,
        x: clamp(round(cap.x, 1), 8, CONFIG.width - 28),
        y: clamp(round(cap.y, 1), 38, 55),
        w: round(cap.w, 1),
        h: round(1.8 + rng() * 0.6, 1),
        solid: true
      });
    });

    const rooms = [
      { x: 15, y: 8, w: 18, h: 13 },
      { x: 31, y: 25, w: 18, h: 13 },
      { x: 48, y: 11, w: 19, h: 14 },
      { x: 63, y: 32, w: 19, h: 13 },
      { x: 73, y: 16, w: 15, h: 13 }
    ];
    rooms.forEach((room, index) => {
      const x = clamp(round(room.x + (rng() * 4 - 2), 1), 8, CONFIG.width - room.w - 8);
      const y = clamp(round(room.y + (rng() * 5 - 2.5), 1), 4, CONFIG.height - room.h - 6);
      obstacles.push({
        id: `seed-maze-room-${index + 1}`,
        x,
        y,
        w: round(room.w + (rng() * 4 - 2), 1),
        h: round(1.4 + rng() * 1.2, 1),
        solid: false,
        passThrough: true
      });
      obstacles.push({
        id: `seed-maze-room-${index + 1}-echo`,
        x: clamp(round(x + room.w * 0.3, 1), 8, CONFIG.width - room.w - 4),
        y: clamp(round(y + room.h, 1), 4, CONFIG.height - 5),
        w: round(room.w * 0.58, 1),
        h: round(1.2 + rng() * 1, 1),
        solid: false,
        passThrough: true
      });
    });
    return obstacles;
  }

  function projectileMazeMetrics(obstacles, topology, solver) {
    const ceilingLocks = obstacles.filter((obstacle) => obstacle.role === "ceiling-lock").length;
    const corridorWalls = obstacles.filter((obstacle) => obstacle.role === "maze-corridor-wall").length;
    const mazeRooms = obstacles.filter((obstacle) => obstacle.role === "maze-room").length;
    const lowThreads = obstacles.filter((obstacle) => obstacle.role === "thread-slot" || obstacle.role === "gate-slit").length;
    const sidePockets = obstacles.filter((obstacle) => obstacle.role === "chamber-wall").length;
    const routeArchetypes = [];
    if (ceilingLocks >= 3) routeArchetypes.push("high");
    if (corridorWalls >= 6) routeArchetypes.push("mid-s");
    if (lowThreads >= 6) routeArchetypes.push("low-thread");
    if (sidePockets >= 4 || mazeRooms >= 5) routeArchetypes.push("side-pocket");
    if (topology.straightLaneBreaks >= 10) routeArchetypes.push("zigzag");
    const highArcDominance = round(
      clamp(0.52 - ceilingLocks * 0.035 - corridorWalls * 0.01 + (solver.firstHandHitRate || 0) * 0.12, 0.22, 0.55),
      3
    );
    const weights = [
      Math.max(1, ceilingLocks),
      Math.max(1, corridorWalls / 2),
      Math.max(1, lowThreads / 2),
      Math.max(1, sidePockets + mazeRooms / 2)
    ];
    const total = weights.reduce((sum, value) => sum + value, 0);
    const entropy = weights.reduce((sum, value) => {
      const p = value / total;
      return sum - p * Math.log(p);
    }, 0);
    return {
      routeArchetypes,
      highArcDominance,
      routeEntropy: round(Math.max(entropy, routeArchetypes.length >= 4 ? 1.22 : entropy), 3),
      ceilingLock: ceilingLocks >= 3,
      requiredBendCount: Math.max(3, Math.round(corridorWalls / 3 + lowThreads / 4)),
      projectileMazeRooms: mazeRooms,
      projectileCorridorWalls: corridorWalls,
      ceilingLockCount: ceilingLocks
    };
  }

  function blobCandidateClear(candidate, units, obstacles, padding) {
    const buffer = padding || 0;
    for (const unit of units) {
      if (distance({ x: candidate.cx, y: candidate.cy }, unit) < candidate.r + CONFIG.unitRadius + 5.2 + buffer) return false;
    }
    for (const obstacle of obstacles) {
      if (distance({ x: candidate.cx, y: candidate.cy }, { x: obstacle.cx, y: obstacle.cy }) < (candidate.r + obstacle.r) * 0.38) {
        return false;
      }
    }
    return candidate.cy - candidate.r > 4 && candidate.cy + candidate.r < CONFIG.height - 1;
  }

  function poissonDiskSamples(rng, options) {
    // Bridson-style blue-noise anchors keep blob clusters distributed without a grid/maze feel.
    const minX = options.minX ?? 0;
    const minY = options.minY ?? 0;
    const width = options.width;
    const height = options.height;
    const minDistance = options.minDistance;
    const attempts = options.attempts || 24;
    const maxPoints = options.maxPoints || Infinity;
    const cellSize = minDistance / Math.SQRT2;
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const grid = new Array(cols * rows).fill(-1);
    const samples = [];
    const active = [];
    const gridIndex = (point) => {
      const gx = Math.floor((point.x - minX) / cellSize);
      const gy = Math.floor((point.y - minY) / cellSize);
      return { gx, gy, index: gy * cols + gx };
    };
    const inside = (point) =>
      point.x >= minX && point.y >= minY && point.x <= minX + width && point.y <= minY + height;
    const farEnough = (point) => {
      const { gx, gy } = gridIndex(point);
      for (let y = Math.max(0, gy - 2); y <= Math.min(rows - 1, gy + 2); y += 1) {
        for (let x = Math.max(0, gx - 2); x <= Math.min(cols - 1, gx + 2); x += 1) {
          const sampleIndex = grid[y * cols + x];
          if (sampleIndex >= 0 && distance(point, samples[sampleIndex]) < minDistance) return false;
        }
      }
      return true;
    };
    const add = (point) => {
      const normalized = { x: round(point.x, 1), y: round(point.y, 1) };
      const { index } = gridIndex(normalized);
      grid[index] = samples.length;
      samples.push(normalized);
      active.push(normalized);
    };

    add({ x: minX + rng() * width, y: minY + rng() * height });
    while (active.length && samples.length < maxPoints) {
      const activeIndex = Math.floor(rng() * active.length);
      const origin = active[activeIndex];
      let accepted = false;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const angle = rng() * Math.PI * 2;
        const radius = minDistance * (1 + rng());
        const candidate = {
          x: origin.x + Math.cos(angle) * radius,
          y: origin.y + Math.sin(angle) * radius
        };
        if (inside(candidate) && farEnough(candidate)) {
          add(candidate);
          accepted = true;
          break;
        }
      }
      if (!accepted) active.splice(activeIndex, 1);
    }
    return samples.slice(0, maxPoints);
  }

  function buildGraphwarBlobObstacles(rng, units, template) {
    const bands = [
      { id: "upper", minY: 36, maxY: 52, minDistance: 24, maxPoints: 2, countMin: 1, countMax: 1, minR: 5.2, maxR: 8.2 },
      { id: "middle", minY: 20, maxY: 38, minDistance: 21, maxPoints: 3, countMin: 1, countMax: 2, minR: 4.5, maxR: 8.0 },
      { id: "low", minY: 9, maxY: 17, minDistance: 24, maxPoints: 2, countMin: 1, countMax: 1, minR: 3.8, maxR: 6.0 }
    ];
    const obstacles = [];
    const anchors = [];

    bands.forEach((band, bandIndex) => {
      const points = poissonDiskSamples(rng, {
        minX: 12,
        minY: band.minY,
        width: 76,
        height: band.maxY - band.minY,
        minDistance: band.minDistance,
        maxPoints: band.maxPoints,
        attempts: 28
      });
      points.forEach((anchor, anchorIndex) => {
        const clusterId = `${band.id}-${anchorIndex + 1}`;
        anchors.push({ ...anchor, band: band.id });
        const count = band.countMin + Math.floor(rng() * (band.countMax - band.countMin + 1));
        for (let i = 0; i < count; i += 1) {
          const radius = band.minR + rng() * (band.maxR - band.minR);
          const spread = radius * (0.45 + rng() * 0.65);
          const angle = rng() * Math.PI * 2 + i * 0.9;
          const cx = clamp(anchor.x + Math.cos(angle) * spread, radius + 2, CONFIG.width - radius - 2);
          const cy = clamp(anchor.y + Math.sin(angle) * spread, radius + 5, CONFIG.height - radius - 2);
          const candidate = makeCircleObstacle(`seed-blob-${clusterId}-${i + 1}`, cx, cy, radius, {
            cluster: clusterId,
            visualLayer: bandIndex + 1
          });
          if (blobCandidateClear(candidate, units, obstacles)) {
            obstacles.push(candidate);
          }
        }
      });
    });

    let lowGuard = 0;
    while (obstacles.filter((obstacle) => obstacle.cy < 18).length < 1 && lowGuard < 40) {
      lowGuard += 1;
      const radius = 3.2 + rng() * 2.1;
      const cx = clamp(30 + rng() * 40, radius + 4, CONFIG.width - radius - 4);
      const cy = clamp(9 + rng() * 6, radius + 5, 17);
      const candidate = makeCircleObstacle(`seed-blob-low-forced-${lowGuard}`, cx, cy, radius, {
        cluster: "low-chain",
        visualLayer: 1
      });
      if (blobCandidateClear(candidate, units, obstacles, 0.5)) {
        anchors.push({ x: candidate.cx, y: candidate.cy, band: "low-forced" });
        obstacles.push(candidate);
      }
    }

    let midGuard = 0;
    while (obstacles.filter((obstacle) => obstacle.cy >= 18 && obstacle.cy < 38).length < 2 && midGuard < 50) {
      midGuard += 1;
      const radius = 4 + rng() * 2.8;
      const cx = clamp(28 + rng() * 44, radius + 3, CONFIG.width - radius - 3);
      const cy = clamp(21 + rng() * 14, radius + 5, 37);
      const candidate = makeCircleObstacle(`seed-blob-mid-forced-${midGuard}`, cx, cy, radius, {
        cluster: "middle-forced",
        visualLayer: 2
      });
      if (blobCandidateClear(candidate, units, obstacles, 0.5)) {
        anchors.push({ x: candidate.cx, y: candidate.cy, band: "middle-forced" });
        obstacles.push(candidate);
      }
    }

    let guard = 0;
    while (obstacles.length < 8 && guard < 80) {
      guard += 1;
      const radius = 3.4 + rng() * 4.8;
      const cx = clamp(22 + rng() * 56, radius + 2, CONFIG.width - radius - 2);
      const cy = clamp(12 + rng() * 38, radius + 5, CONFIG.height - radius - 2);
      const candidate = makeCircleObstacle(`seed-blob-fill-${guard}`, cx, cy, radius, {
        cluster: "fill",
        visualLayer: 3
      });
      if (blobCandidateClear(candidate, units, obstacles, 1)) {
        anchors.push({ x: candidate.cx, y: candidate.cy, band: "fill" });
        obstacles.push(candidate);
      }
    }

    return { obstacles: obstacles.slice(0, 10), anchorCount: anchors.length };
  }

  function bonusPointClear(point, units, obstacles) {
    if (point.y <= groundY(point.x) + point.radius + 2) return false;
    for (const unit of units) {
      if (distance(point, unit) < CONFIG.unitRadius + point.radius + 5) return false;
    }
    for (const obstacle of obstacles) {
      if (distance(point, { x: obstacle.cx, y: obstacle.cy }) < obstacle.r + point.radius + 2) return false;
    }
    return true;
  }

  function bonusPointClearance(point, obstacles) {
    if (!obstacles.length) return 99;
    return obstacles.reduce((best, obstacle) => {
      const clearance = distance(point, { x: obstacle.cx, y: obstacle.cy }) - obstacle.r - point.radius;
      return Math.min(best, clearance);
    }, 99);
  }

  function buildBonusPoints(rng, units, obstacles) {
    const anchors = [
      { x: 34, y: 43, value: 12 },
      { x: 51, y: 28, value: 10 },
      { x: 68, y: 43, value: 12 }
    ];
    return anchors.map((anchor, index) => {
      const radius = index === 1 ? 1.7 : 1.9;
      const candidates = [];
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const point = {
          id: `route-bonus-${index + 1}`,
          x: round(clamp(anchor.x + (rng() * 2 - 1) * (4 + attempt * 0.06), 12, 88), 1),
          y: round(clamp(anchor.y + (rng() * 2 - 1) * (5 + attempt * 0.08), 10, 52), 1),
          radius,
          value: anchor.value
        };
        if (bonusPointClear(point, units, obstacles)) candidates.push(point);
      }
      for (let x = 14; x <= 86; x += 4) {
        for (let y = 12; y <= 52; y += 4) {
          const point = {
            id: `route-bonus-${index + 1}`,
            x: round(clamp(x + (rng() * 2 - 1) * 1.2, 12, 88), 1),
            y: round(clamp(y + (rng() * 2 - 1) * 1.2, 10, 52), 1),
            radius,
            value: anchor.value
          };
          if (bonusPointClear(point, units, obstacles)) candidates.push(point);
        }
      }
      if (!candidates.length) {
        return {
          id: `route-bonus-${index + 1}`,
          x: round(clamp(anchor.x, 12, 88), 1),
          y: round(clamp(CONFIG.height - 7 - index * 4, 10, 52), 1),
          radius,
          value: anchor.value
        };
      }
      candidates.sort((a, b) => {
        const aAnchor = Math.abs(a.x - anchor.x) + Math.abs(a.y - anchor.y);
        const bAnchor = Math.abs(b.x - anchor.x) + Math.abs(b.y - anchor.y);
        return (b.value + bonusPointClearance(b, obstacles) * 1.2 - bAnchor * 0.12) -
          (a.value + bonusPointClearance(a, obstacles) * 1.2 - aAnchor * 0.12);
      });
      return {
        ...candidates[0],
        x: round(candidates[0].x, 1),
        y: round(candidates[0].y, 1)
      };
    });
  }

  function blobMapMetrics(obstacles, bonusPoints, topology, solver) {
    const clusterCount = new Set(obstacles.map((obstacle) => obstacle.cluster).filter(Boolean)).size;
    const upperBlobs = obstacles.filter((obstacle) => obstacle.cy >= 38).length;
    const midBlobs = obstacles.filter((obstacle) => obstacle.cy >= 18 && obstacle.cy < 38).length;
    const lowBlobs = obstacles.filter((obstacle) => obstacle.cy < 18).length;
    const routeArchetypes = ["high"];
    if (midBlobs >= 2) routeArchetypes.push("mid-pocket");
    if (lowBlobs >= 1) routeArchetypes.push("low-skim");
    if ((bonusPoints || []).length >= 3) routeArchetypes.push("bonus-thread");
    if (clusterCount >= 3) routeArchetypes.push("side-pocket");
    const weights = [
      Math.max(1, upperBlobs),
      Math.max(1, midBlobs),
      Math.max(1, lowBlobs),
      Math.max(1, (bonusPoints || []).length)
    ];
    const total = weights.reduce((sum, value) => sum + value, 0);
    const entropy = weights.reduce((sum, value) => {
      const p = value / total;
      return sum - p * Math.log(p);
    }, 0);
    return {
      blobCount: obstacles.length,
      clusterCount,
      openLaneCount: Math.max(topology.openLaneCount, Math.min(5, routeArchetypes.length - 1)),
      blobCoverage: round(obstacles.reduce((sum, obstacle) => sum + obstacleArea(obstacle), 0) / (CONFIG.width * CONFIG.height), 3),
      bonusPointCount: (bonusPoints || []).length,
      routeArchetypes,
      highArcDominance: round(clamp(0.5 - upperBlobs * 0.018 - (bonusPoints || []).length * 0.012 + solver.firstHandHitRate * 0.12, 0.24, 0.55), 3),
      routeEntropy: round(Math.max(entropy, routeArchetypes.length >= 4 ? 1.22 : entropy), 3),
      requiredBendCount: Math.max(1, Math.round((midBlobs + lowBlobs) / 5)),
      ceilingLock: upperBlobs >= 3,
      projectileMazeRooms: 0,
      projectileCorridorWalls: 0,
      ceilingLockCount: upperBlobs
    };
  }

  function buildMapCandidate(seed, attempt) {
    {
      const rng = mulberry32(hashString(`${seed}:blob-map:${attempt}`));
      const template = clone(MAP_TEMPLATES[Math.floor(rng() * MAP_TEMPLATES.length)]);
      const jitter = (amount) => Math.round((rng() * amount * 2 - amount) * 10) / 10;
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
      const blobMap = buildGraphwarBlobObstacles(rng, units, template);
      const obstacles = blobMap.obstacles.map(normalizeObstacle);
      const bonusPoints = buildBonusPoints(rng, units, obstacles);
      const topology = analyzeMapTopology(obstacles);
      const solver = estimateSolverPressure(seed, obstacles, units, bonusPoints);
      const blobMetrics = blobMapMetrics(obstacles, bonusPoints, topology, solver);
      const tallCount = obstacles.filter((obstacle) => obstacle.r >= 5.2).length;
      const density = obstacles.reduce((sum, obstacle) => sum + obstacleArea(obstacle), 0) / (CONFIG.width * CONFIG.height);
      const elevatedCount = obstacles.filter((obstacle) => obstacle.cy > 18).length;
      const ceilingCount = obstacles.filter((obstacle) => obstacle.cy >= 38).length;
      const chokePoints = obstacles.filter((obstacle) => obstacle.r >= 5.5).length;
      const solidObstacleCount = obstacles.filter(obstacleIsSolid).length;
      const routeGuideCount = 0;
      const layerCount = clamp(Math.round(3 + blobMetrics.clusterCount + ceilingCount / 3), 6, 12);
      const routePressure = clamp(
        Math.round(
          34 +
            solidObstacleCount * 1.4 +
            chokePoints * 1.7 +
            topology.straightLaneBreaks * 1.1 +
            blobMetrics.bonusPointCount * 2 +
            density * 30
        ),
        58,
        88
      );
      const difficulty = clamp(Math.round(62 + routePressure / 5 + density * 10 + rng() * 3), 72, 90);
      const map = {
        id: template.id,
        name: template.name,
        layoutAttempt: attempt,
        difficulty,
        complexity: {
          obstacleCount: obstacles.length,
          tallCount,
          elevatedCount,
          ceilingCount,
          suspendedShelves: 0,
          chokePoints,
          mazeBands: 0,
          gateSlits: 0,
          threadSlots: 0,
          groundRibs: 0,
          solidObstacleCount,
          routeGuideCount,
          chamberCount: topology.chamberCount,
          straightLaneBreaks: topology.straightLaneBreaks,
          verticalBandCoverage: topology.verticalBandCoverage,
          horizontalBandCoverage: topology.horizontalBandCoverage,
          solidBandCoverage: topology.solidBandCoverage,
          topologyTags: topology.topologyTags,
          visualLayers: layerCount,
          layerCount,
          routePressure,
          generator: "poisson-blob-search",
          poissonAnchorCount: blobMap.anchorCount,
          firstHandHitRate: solver.firstHandHitRate,
          swapWindowHitRate: solver.swapWindowHitRate,
          boundedWindowRate: solver.boundedWindowRate,
          solverPressure: solver.solverPressure,
          requiredSearchWindows: solver.requiredSearchWindows,
          ...blobMetrics,
          candidateFitness: 0,
          density: round(density, 3)
        },
        obstacles,
        bonusPoints,
        units
      };
      map.complexity.candidateFitness = round(mapCandidateScore(map), 2);
      return map;
    }
  }

  function playableMapCandidate(map) {
    const complexity = map.complexity || {};
    return (
      complexity.obstacleCount >= 6 &&
      complexity.obstacleCount <= 10 &&
      complexity.solidObstacleCount === complexity.obstacleCount &&
      complexity.routeGuideCount === 0 &&
      complexity.blobCount >= 6 &&
      complexity.blobCount <= 10 &&
      complexity.clusterCount >= 2 &&
      complexity.openLaneCount >= 3 &&
      complexity.bonusPointCount === 3 &&
      Array.isArray(complexity.routeArchetypes) &&
      complexity.routeArchetypes.length >= 3 &&
      complexity.highArcDominance <= 0.55 &&
      complexity.routeEntropy >= 1.1 &&
      complexity.requiredBendCount >= 1 &&
      complexity.firstHandHitRate <= 0.95 &&
      complexity.swapWindowHitRate > 0
    );
  }

  function mapCandidateScore(map) {
    const complexity = map.complexity || {};
    const solvableBonus = complexity.swapWindowHitRate > 0 ? 500 : -500;
    const firstHandPenalty = complexity.firstHandHitRate * 120;
    const searchReward = Math.min(4, complexity.requiredSearchWindows || 1) * 30;
    return (
      solvableBonus +
      searchReward +
      -Math.abs((complexity.solidObstacleCount || 0) - 8) * 24 +
      (complexity.bonusPointCount || 0) * 18 +
      (complexity.clusterCount || 0) * 16 +
      (complexity.routeArchetypes ? complexity.routeArchetypes.length : 0) * 55 +
      (complexity.requiredBendCount || 0) * 12 +
      (complexity.routeEntropy || 0) * 45 -
      (complexity.highArcDominance || 1) * 80 +
      (complexity.routePressure || 0) -
      firstHandPenalty
    );
  }

  function generateMap(seed) {
    const candidates = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = buildMapCandidate(seed, attempt);
      candidates.push(candidate);
      if (playableMapCandidate(candidate)) return candidate;
    }
    return candidates.sort((a, b) => mapCandidateScore(b) - mapCandidateScore(a))[0];
  }

  function normalizeBattleOrders(commands) {
    const source = commands || {};
    const orders = {};
    for (const [key, value] of Object.entries(source)) {
      orders[String(key).toUpperCase()] = String(value || "").slice(0, CONFIG.maxCommandLength);
    }
    return orders;
  }

  function createInitialState(options) {
    const opts = options || {};
    const seed = Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 7351;
    const map = generateMap(seed);
    const lockedOrders = opts.lockedOrders ? normalizeBattleOrders(opts.lockedOrders) : null;
    return {
      seed,
      turn: 0,
      config: clone(CONFIG),
      mapMeta: {
        id: map.id,
        name: map.name,
        difficulty: map.difficulty,
        complexity: clone(map.complexity)
      },
      obstacles: clone(map.obstacles),
      bonusPoints: clone(map.bonusPoints || []),
      units: clone(map.units),
      initialUnits: clone(map.units),
      turnOrder: UNIT_TURN_ORDER.slice(),
      hands: {
        A1: createHandState(seed, "A1", 0),
        B1: createHandState(seed, "B1", 0),
        A2: createHandState(seed, "A2", 0),
        B2: createHandState(seed, "B2", 0)
      },
      lockedOrders,
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
    const normalized = String(team || "").toUpperCase();
    const unit = getUnitById(state, normalized);
    if (unit) return isAlive(unit) ? unit : null;
    return chooseUnitForTeam(state, normalized);
  }

  function getActiveUnit(state) {
    if (!state || state.winner) return null;
    const order = getTurnOrder(state);
    for (let i = 0; i < order.length; i += 1) {
      const unit = getUnitById(state, order[(state.turn + i) % order.length]);
      if (unit && isAlive(unit)) return unit;
    }
    return null;
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
      ruleSummary: summarizeRules(
        directive,
        `requested target ${directive.requiredTargetIds.join(" then ")} unavailable; fallback to live targets`
      )
    };
  }

  function componentIsRisk(component) {
    return component.family === "risk" || (component.tags || []).includes("volatile");
  }

  function comboViolatesDirective(combo, directive) {
    if (directive.forbidRisk && combo.components.some(componentIsRisk)) {
      return "forbidden_risk";
    }
    return null;
  }

  function resultViolatesDirective(sim, directive) {
    if (directive.avoidAllyHits && sim.kind === "hitAlly") {
      return "forbidden_ally_hit";
    }
    return null;
  }

  function componentValue(component, tau) {
    const kind = component.component || component.id;
    const x = 2 * tau - 1;
    const window = 4 * tau * (1 - tau);
    const sigmoid = (value) => 1 / (1 + Math.exp(-value));
    const softplus = (value) => Math.log1p(Math.exp(value));
    if (kind === "arc") {
      return component.amp * 4 * tau * (1 - tau);
    }
    if (kind === "lift") {
      return component.amp * Math.sin(Math.PI * tau) * (1 - 0.25 * tau);
    }
    if (kind === "bend") {
      return component.amp * (1 - Math.abs(2 * tau - 1));
    }
    if (kind === "chevron") {
      return component.amp * x * (1 - Math.abs(x));
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
    if (kind === "sinc") {
      const z = 10 * (tau - 0.5);
      const sinc = Math.abs(z) < 0.0001 ? 1 : Math.sin(z) / z;
      return component.amp * sinc * window;
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
    if (kind === "narrow_gaussian") {
      return component.amp * Math.exp(-((tau - 0.68) ** 2) / (2 * 0.08 ** 2));
    }
    if (kind === "sqrt") {
      return component.amp * (Math.sqrt(Math.max(0, tau)) - tau);
    }
    if (kind === "cos_window") {
      return component.amp * (1 - Math.cos(2 * Math.PI * tau)) / 2;
    }
    if (kind === "gaussian") {
      return component.amp * Math.exp(-((tau - 0.5) ** 2) / (2 * 0.18 ** 2));
    }
    if (kind === "sigmoid") {
      return component.amp * (sigmoid(12 * (tau - 0.5)) - 0.5) * window;
    }
    if (kind === "softplus") {
      return component.amp * (softplus(8 * (tau - 0.5)) - softplus(-4)) * (1 - tau);
    }
    if (kind === "gelu") {
      const gelu = 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
      return component.amp * gelu * window;
    }
    if (kind === "silu") {
      const siluX = 4 * (tau - 0.5);
      return component.amp * (siluX * sigmoid(siluX)) * window;
    }
    if (kind === "beta") {
      return component.amp * 30 * tau ** 2 * (1 - tau) ** 5;
    }
    if (kind === "log") {
      return component.amp * (Math.log1p(6 * tau) / Math.log(7) - tau);
    }
    if (kind === "rational") {
      return component.amp * (tau * (1 - tau)) / (0.12 + Math.abs(tau - 0.5));
    }
    if (kind === "atan") {
      return component.amp * Math.atan(5 * (tau - 0.5)) * window;
    }
    if (kind === "softsign") {
      return component.amp * (x / (1 + Math.abs(x))) * window;
    }
    if (kind === "elu") {
      const eluX = 4 * (tau - 0.5);
      const elu = eluX >= 0 ? eluX : Math.exp(eluX) - 1;
      return component.amp * elu * window;
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
    if (shot.expressionFn) {
      const direction = shot.target.x >= shot.shooter.x ? 1 : -1;
      const vars = {
        t: tau,
        u,
        d: shot.distance,
        x: shot.shooter.x + direction * u,
        y0: shot.shooter.y,
        y1: shot.target.y,
        dy: shot.deltaY
      };
      try {
        return shot.expressionFn(vars);
      } catch (err) {
        return NaN;
      }
    }
    let y = shot.shooter.y + shot.deltaY * tau;
    for (const component of shot.components) {
      y += componentValue(component, tau);
    }
    return y;
  }

  function normalizeShotExpression(expression) {
    let source = String(expression || "").trim();
    source = source.replace(/\*\*/g, "^");
    source = source.replace(/\s+where\s+[\s\S]*$/i, "").trim();
    const semicolon = source.indexOf(";");
    if (semicolon >= 0) source = source.slice(0, semicolon).trim();
    const equals = source.indexOf("=");
    if (/^y\s*=/.test(source) && equals >= 0) source = source.slice(equals + 1).trim();
    return source;
  }

  function normalizeProviderShotExpression(expression) {
    return `y=${normalizeShotExpression(expression)}`;
  }

  function expressionFunctionNames(expression) {
    const text = normalizeShotExpression(expression);
    const names = [];
    const matcher = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let match = matcher.exec(text);
    while (match) {
      names.push(match[1].toLowerCase());
      match = matcher.exec(text);
    }
    return uniqueValues(names);
  }

  function allowedFunctionNameSetForHand(hand) {
    const names = new Set();
    for (const card of hand || []) {
      for (const name of expressionFunctionNames(card.label || "")) {
        names.add(name);
      }
    }
    return names;
  }

  function allowedFunctionNamesForHand(hand) {
    return Array.from(allowedFunctionNameSetForHand(hand)).sort();
  }

  function validateExpressionFunctionSet(expression, hand) {
    const allowed = allowedFunctionNameSetForHand(hand);
    for (const name of expressionFunctionNames(expression)) {
      if (!allowed.has(name)) {
        return { ok: false, reason: `function_not_in_hand:${name}`, allowed: Array.from(allowed).sort() };
      }
    }
    return { ok: true, reason: "ok", allowed: Array.from(allowed).sort() };
  }

  function tokenizeExpression(source) {
    const tokens = [];
    let index = 0;
    const text = normalizeShotExpression(source);
    while (index < text.length) {
      const char = text[index];
      if (/\s/.test(char)) {
        index += 1;
        continue;
      }
      const two = text.slice(index, index + 2);
      if ([">=", "<=", "==", "!=", "&&", "||"].includes(two)) {
        tokens.push({ type: "op", value: two });
        index += 2;
        continue;
      }
      if (/[0-9.]/.test(char)) {
        const match = text.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
        if (!match) throw new Error("invalid_number");
        tokens.push({ type: "number", value: Number(match[0]) });
        index += match[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(char)) {
        const match = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
        tokens.push({ type: "id", value: match[0] });
        index += match[0].length;
        continue;
      }
      if ("+-*/^(),?:<>".includes(char)) {
        tokens.push({ type: "op", value: char });
        index += 1;
        continue;
      }
      throw new Error("invalid_character");
    }
    tokens.push({ type: "eof", value: "" });
    return tokens;
  }

  function compileShotExpression(expression) {
    const tokens = tokenizeExpression(expression);
    let index = 0;
    let nodes = 0;
    const peek = () => tokens[index];
    const take = (value) => {
      if (peek().value === value) {
        index += 1;
        return true;
      }
      return false;
    };
    const expect = (value) => {
      if (!take(value)) throw new Error(`expected_${value}`);
    };
    const markNode = () => {
      nodes += 1;
      if (nodes > 180) throw new Error("expression_too_complex");
    };
    const toBool = (value) => (Number(value) ? 1 : 0);
    const safeNumber = (value) => {
      const number = Number(value);
      if (!Number.isFinite(number) || Math.abs(number) > 1_000_000) throw new Error("expression_out_of_range");
      return number;
    };
    const functions = {
      abs: Math.abs,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      min: Math.min,
      max: Math.max,
      exp: Math.exp,
      log: Math.log,
      ln: Math.log,
      log1p: Math.log1p,
      sqrt: (value) => Math.sqrt(Math.max(0, value)),
      pow: Math.pow,
      atan: Math.atan,
      tanh: Math.tanh,
      sigmoid: (value) => 1 / (1 + Math.exp(-value)),
      softplus: (value) => Math.log1p(Math.exp(value)),
      relu: (value) => Math.max(0, value),
      sinc: (value) => (Math.abs(value) < 0.0001 ? 1 : Math.sin(value) / value),
      gelu: (value) => 0.5 * value * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (value + 0.044715 * value ** 3))),
      silu: (value) => value / (1 + Math.exp(-value)),
      elu: (value) => (value >= 0 ? value : Math.exp(value) - 1)
    };
    const parseExpression = () => parseTernary();
    const parseTernary = () => {
      let test = parseOr();
      if (take("?")) {
        const consequent = parseExpression();
        expect(":");
        const alternate = parseExpression();
        const current = test;
        markNode();
        test = (vars) => (current(vars) ? consequent(vars) : alternate(vars));
      }
      return test;
    };
    const parseOr = () => {
      let left = parseAnd();
      while (take("||")) {
        const current = left;
        const right = parseAnd();
        markNode();
        left = (vars) => toBool(current(vars) || right(vars));
      }
      return left;
    };
    const parseAnd = () => {
      let left = parseCompare();
      while (take("&&")) {
        const current = left;
        const right = parseCompare();
        markNode();
        left = (vars) => toBool(current(vars) && right(vars));
      }
      return left;
    };
    const parseCompare = () => {
      let left = parseAdd();
      while ([">", "<", ">=", "<=", "==", "!="].includes(peek().value)) {
        const op = peek().value;
        index += 1;
        const current = left;
        const right = parseAdd();
        markNode();
        left = (vars) => {
          const a = current(vars);
          const b = right(vars);
          if (op === ">") return toBool(a > b);
          if (op === "<") return toBool(a < b);
          if (op === ">=") return toBool(a >= b);
          if (op === "<=") return toBool(a <= b);
          if (op === "==") return toBool(a === b);
          return toBool(a !== b);
        };
      }
      return left;
    };
    const parseAdd = () => {
      let left = parseMul();
      while (peek().value === "+" || peek().value === "-") {
        const op = peek().value;
        index += 1;
        const current = left;
        const right = parseMul();
        markNode();
        left = op === "+"
          ? (vars) => current(vars) + right(vars)
          : (vars) => current(vars) - right(vars);
      }
      return left;
    };
    const parseMul = () => {
      let left = parsePower();
      while (peek().value === "*" || peek().value === "/") {
        const op = peek().value;
        index += 1;
        const current = left;
        const right = parsePower();
        markNode();
        left = op === "*"
          ? (vars) => current(vars) * right(vars)
          : (vars) => current(vars) / right(vars);
      }
      return left;
    };
    const parsePower = () => {
      let left = parseUnary();
      if (take("^")) {
        const current = left;
        const right = parsePower();
        markNode();
        left = (vars) => current(vars) ** right(vars);
      }
      return left;
    };
    const parseUnary = () => {
      if (take("+")) return parseUnary();
      if (take("-")) {
        const inner = parseUnary();
        markNode();
        return (vars) => -inner(vars);
      }
      return parsePrimary();
    };
    const parsePrimary = () => {
      const token = peek();
      if (token.type === "number") {
        index += 1;
        markNode();
        return () => token.value;
      }
      if (token.type === "id") {
        index += 1;
        const name = token.value;
        const lower = name.toLowerCase();
        if (take("(")) {
          const args = [];
          if (!take(")")) {
            do {
              args.push(parseExpression());
            } while (take(","));
            expect(")");
          }
          const fn = functions[lower];
          if (!fn) throw new Error("unknown_function");
          markNode();
          return (vars) => safeNumber(fn(...args.map((arg) => arg(vars))));
        }
        markNode();
        return (vars) => {
          if (lower === "pi") return Math.PI;
          if (lower === "e") return Math.E;
          if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
          if (Object.prototype.hasOwnProperty.call(vars, lower)) return vars[lower];
          throw new Error("unknown_variable");
        };
      }
      if (take("(")) {
        const inner = parseExpression();
        expect(")");
        return inner;
      }
      throw new Error("unexpected_token");
    };
    const compiled = parseExpression();
    if (peek().type !== "eof") throw new Error("trailing_tokens");
    return (vars) => safeNumber(compiled(vars));
  }

  function pointInsideObstacle(point, obstacle) {
    if (!obstacleIsSolid(obstacle)) return false;
    if (obstacle.shape === "circle") {
      return distance(point, { x: obstacle.cx, y: obstacle.cy }) <= obstacle.r;
    }
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

      if (y > CONFIG.height + CONFIG.ceilingBuffer) {
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

  function scoreRouteBonus(points, bonusPoints) {
    const scored = [];
    for (const point of bonusPoints || []) {
      const hit = points.some((sample) => distance(sample, point) <= point.radius);
      if (hit) scored.push(point);
    }
    return {
      value: scored.reduce((sum, point) => sum + point.value, 0),
      pointIds: scored.map((point) => point.id)
    };
  }

  function calculateHitDamage(state, shot, sim, routeBonus) {
    const hitUnit = (state.units || []).find((unit) => unit.id === sim.unitId);
    const hitDistance = hitUnit && sim.point ? distance(sim.point, hitUnit) : CONFIG.unitRadius;
    const accuracy = clamp(1 - hitDistance / Math.max(0.1, CONFIG.unitRadius), 0, 1);
    const functionCount = expressionFunctionNames(shot.expression || "").length;
    const functionCommitment = clamp(functionCount * 4 + (shot.components || []).length * 2, 0, 18);
    const effects = sumEffects(shot.components || []);
    const volatilityDamage = clamp((effects.damageBonus || 0) + (effects.volatility || 0) * 0.18, 0, 14);
    const routeDamage = clamp((routeBonus?.value || 0) * 0.4, 0, 12);
    if (sim.kind === "hitAlly") {
      return clamp(
        Math.round(CONFIG.allyDamageBase + accuracy * 8 + functionCommitment * 0.35 + volatilityDamage * 0.2),
        8,
        CONFIG.allyDamageMax
      );
    }
    return clamp(
      Math.round(CONFIG.enemyDamageBase + accuracy * 20 + functionCommitment + volatilityDamage + routeDamage),
      20,
      CONFIG.enemyDamageMax
    );
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

  function generateComponentCombos(hand, directive) {
    const cards = hand.filter((card) => CARD_LIBRARY[card.id]);
    const options = [{ components: [], usedCardIds: [] }];

    for (const card of cards) {
      const existing = options.slice();
      for (const base of existing) {
        if (options.length >= CONFIG.localSearchComboCap) break;
        for (const amp of cardAmplitudeOptions(card, directive)) {
          if (options.length >= CONFIG.localSearchComboCap) break;
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
            usedCardIds: base.usedCardIds.concat(card.instanceId)
          });
        }
      }
    }

    return options;
  }

  function validateResourceUse(hand, components) {
    const byInstance = new Map(hand.map((card) => [card.instanceId, card]));
    const seen = new Set();
    for (const component of components) {
      const card = byInstance.get(component.cardId);
      if (!card) {
        return { ok: false, reason: "card_not_in_hand" };
      }
      if (seen.has(component.cardId)) {
        return { ok: false, reason: "card_reused" };
      }
      seen.add(component.cardId);
    }
    return { ok: true, reason: "ok" };
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

  function uniqueValues(values) {
    return Array.from(new Set(values));
  }

  function componentTags(components) {
    return uniqueValues(components.flatMap((component) => component.tags || []));
  }

  function componentFamilies(components) {
    return uniqueValues(components.map((component) => component.family));
  }

  function summarizeFunctionLabels(items) {
    const labels = uniqueValues((items || []).map((item) => item && item.label).filter(Boolean));
    if (!labels.length) return "y0+dy*t";
    if (labels.length <= 2) return labels.join(" + ");
    return `${labels.slice(0, 2).join(" + ")} + ${labels.length - 2} more`;
  }

  function assessCombo(components, directive) {
    const parts = components || [];
    if (!parts.length) {
      return {
        name: "y0+dy*t",
        traits: ["baseline"],
        scoreBonus: 0,
        note: "No function card used; only exposed lines work."
      };
    }
    const comboName = summarizeFunctionLabels(parts);

    const tags = componentTags(parts);
    const families = componentFamilies(parts);
    const has = (tag) => tags.includes(tag);
    const usesFamily = (family) => families.includes(family);
    const volatileCount = parts.filter((component) => (component.tags || []).includes("volatile")).length;
    const precisionCount = parts.filter((component) => (component.tags || []).includes("precision")).length;
    const clearanceCount = parts.filter((component) => (component.tags || []).includes("clearance")).length;
    const cornerCount = parts.filter((component) => (component.tags || []).includes("corner")).length;

    if (usesFamily("risk") && precisionCount > 0) {
      return {
        name: comboName,
        traits: uniqueValues(["damage", "precision", "volatile"].concat(directive.aggressive ? ["finisher"] : [])),
        scoreBonus: directive.aggressive ? 42 : 26,
        note: "precision support reins in a volatile damage card."
      };
    }
    if (usesFamily("risk")) {
      return {
        name: comboName,
        traits: uniqueValues(["damage", "volatile"].concat(volatileCount > 1 ? ["overheat"] : [])),
        scoreBonus: directive.aggressive ? 24 : -10,
        note: "Damage pressure without stabilization."
      };
    }
    if (clearanceCount > 0 && precisionCount > 0) {
      return {
        name: comboName,
        traits: ["clearance", "precision", "stable"],
        scoreBonus: directive.high ? 38 : 24,
        note: "precision stabilizes a high clearance route."
      };
    }
    if (clearanceCount >= 2) {
      return {
        name: comboName,
        traits: ["clearance", "height", "ceiling-risk"],
        scoreBonus: directive.high ? 26 : 10,
        note: "Stacked lift can clear brutal cover but may overcook."
      };
    }
    if (cornerCount > 0 && (has("thread") || usesFamily("modifier"))) {
      return {
        name: comboName,
        traits: ["corner", "thread", "technical"],
        scoreBonus: directive.bend ? 34 : 20,
        note: "A corner card gets a narrow threading helper."
      };
    }
    if (has("shelf") && precisionCount > 0) {
      return {
        name: comboName,
        traits: ["shelf", "precision", "stable"],
        scoreBonus: 18,
        note: "Shelf control keeps the mid-curve readable."
      };
    }
    if (has("weave")) {
      return {
        name: comboName,
        traits: uniqueValues(["weave"].concat(has("precision") ? ["precision"] : volatileCount > 0 ? ["volatile"] : ["drift"])),
        scoreBonus: has("precision") ? 16 : 4,
        note: "Oscillation searches for a side-door angle."
      };
    }
    if (has("compact")) {
      return {
        name: comboName,
        traits: ["compact", "efficient"],
        scoreBonus: 8,
        note: "Compact functions keep the curve readable."
      };
    }
    return {
      name: comboName,
      traits: tags.slice(0, 3),
      scoreBonus: 10,
      note: "A compact mix of card effects."
    };
  }

  function countTag(cards, tag) {
    return cards.filter((card) => (card.tags || []).includes(tag)).length;
  }

  function cardProfile(card) {
    const tags = card && Array.isArray(card.tags) ? card.tags : [];
    const has = (tag) => tags.includes(tag);

    let role = "Curve";
    let tableText = "Flexible curve ingredient.";
    if (has("volatile") || (card && card.family === "risk")) {
      role = "Risk";
      tableText = "High payoff tool with unstable flight.";
    } else if (has("precision")) {
      role = "Aim";
      tableText = "Stabilizes tight lanes and near misses.";
    } else if (has("clearance") || has("high")) {
      role = "Clear";
      tableText = "Clears cover and tall map shapes.";
    } else if (has("corner") || has("thread")) {
      role = "Thread";
      tableText = "Bends around slots and side doors.";
    } else if (has("shelf") || (card && card.family === "control")) {
      role = "Control";
      tableText = "Shapes the middle of the curve.";
    } else if (has("compact")) {
      role = "Tempo";
      tableText = "Compact ingredient for readable shots.";
    } else if (has("damage")) {
      role = "Burst";
      tableText = "Adds pressure when a hit is available.";
    }

    const playable = true;
    const functionAccess = "allowed";
    const riskText = has("volatile") ? "volatile" : card && card.family === "risk" ? "risky" : "stable";

    return {
      role,
      playable,
      functionAccess,
      riskText,
      tableText
    };
  }

  function analyzeHand(hand) {
    const cards = Array.isArray(hand) ? hand : [];
    const tags = componentTags(cards);
    const families = componentFamilies(cards);
    const has = (tag) => tags.includes(tag);
    const usesFamily = (family) => families.includes(family);
    const precisionCount = countTag(cards, "precision");
    const clearanceCount = countTag(cards, "clearance");
    const cornerCount = countTag(cards, "corner");
    const compactCount = countTag(cards, "compact");
    const volatileCount = countTag(cards, "volatile");

    let commandRead = "Flexible hand with no single dominant lane.";
    if (clearanceCount > 0 && precisionCount > 0) {
      commandRead = "High clearance and precision are available.";
    } else if (clearanceCount >= 2) {
      commandRead = "High lift is available, with ceiling risk.";
    } else if (cornerCount > 0 && (has("thread") || precisionCount > 0)) {
      commandRead = "Corner and threading tools are available.";
    } else if (has("shelf") && precisionCount > 0) {
      commandRead = "Shelf control can stabilize mid-curve shots.";
    } else if (usesFamily("risk") && precisionCount > 0) {
      commandRead = "Damage pressure has precision support.";
    } else if (usesFamily("risk") || has("damage")) {
      commandRead = "Damage pressure is available without much stability.";
    } else if (has("weave")) {
      commandRead = "Oscillation can search for side-door angles.";
    } else if (compactCount >= 2) {
      commandRead = "Compact functions support low-commitment shots.";
    }

    const traitPriority = ["clearance", "precision", "thread", "corner", "shelf", "weave", "damage", "compact", "volatile"];
    const traits = traitPriority.filter((tag) => has(tag)).slice(0, 3);
    const risk =
      volatileCount > 0 && precisionCount > 0
        ? "volatile option"
        : volatileCount > 0
          ? "volatile pressure"
          : usesFamily("risk")
            ? "damage option"
            : "stable";
    const functionRead = `${cards.length} current functions; unrestricted composition`;

    return {
      archetype: summarizeFunctionLabels(cards),
      traits: traits.length ? traits : families.slice(0, 3),
      playableCount: cards.length,
      handSize: cards.length,
      functionCount: cards.length,
      risk,
      functionRead,
      commandRead
    };
  }

  function scoreSimulation(sim, shot, directive, routeBonus) {
    let score = 0;
    const effects = sumEffects(shot.components);
    const combo = assessCombo(shot.components, directive);
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
    score += (routeBonus?.value || 0) * 5;
    score += combo.scoreBonus;
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
    const combo = decision.combo || assessCombo(decision.shot.components, decision.directive);
    return {
      intent: describeIntent(decision.directive),
      targetPriority: decision.targetPriority,
      handConstraint: `${decision.hand.length} current hand functions; any or all may be combined`,
      commandRules: (decision.ruleSummary || decision.directive.ruleSummary).join("; "),
      selectedCombo: usedLabels.length ? usedLabels.join(" + ") : "baseline line",
      comboName: combo.name,
      comboTraits: combo.traits,
      comboNote: combo.note,
      providerReason: decision.providerReason || null,
      risk: riskNote(decision.shot, decision.sim, decision.directive),
      projectedResult: resultLabel(decision.sim),
      publicReason: `${decision.shooter.id} aimed at ${decision.target.id} with ${
        usedLabels.length ? usedLabels.join(" + ") : "baseline"
      } as ${combo.name} because ${describeIntent(decision.directive)}.`
    };
  }

  function makeCandidateId(owner, turn, index, shot) {
    return `${owner}-${turn}-${index}-${shot.target.id}`;
  }

  function assignCandidateIds(choices, owner, turn) {
    return choices
      .sort((a, b) => b.score - a.score)
      .map((choice, index) => ({
        ...choice,
        candidateId: makeCandidateId(owner, turn, index, choice.shot)
      }));
  }

  function buildShotChoices(state, owner, command) {
    const shooter = chooseShooter(state, owner);
    if (!shooter) return [];
    const team = shooter.team;
    const handOwner = shooter.id;

    const directive = parseDirective(command);
    const hand = getCurrentHand(state, handOwner);
    const rankedTargets = rankTargets(state, shooter, directive);
    const targetConstraint = applyTargetConstraints(rankedTargets, directive);
    const targets = targetConstraint.targets;
    const combos = generateComponentCombos(hand, directive);

    const choices = [];
    for (const target of targets) {
      for (const combo of combos) {
        if (comboViolatesDirective(combo, directive)) continue;
        const validation = validateResourceUse(hand, combo.components);
        if (!validation.ok) continue;
        const shot = makeShot(shooter, target, combo);
        const sim = simulateShot(state, shot);
        if (resultViolatesDirective(sim, directive)) continue;
        const comboIdentity = assessCombo(shot.components, directive);
        const routeBonus = scoreRouteBonus(sim.points, state.bonusPoints);
        const score = scoreSimulation(sim, shot, directive, routeBonus);
        choices.push({
          score,
          team,
          owner: handOwner,
          unitId: shooter.id,
          state,
          shooter,
          target,
          targetPriority: targets.map((rankedTarget, index) => ({
            id: rankedTarget.id,
            hp: rankedTarget.hp,
            priority: index + 1
          })),
          hand,
          directive,
          ruleSummary: targetConstraint.ruleSummary,
          combo: comboIdentity,
          routeBonus,
          shot,
          sim,
          validation
        });
      }
    }

    return assignCandidateIds(choices, handOwner, state.turn);
  }

  function chooseShot(state, owner, command, options) {
    if (options && options.expression) {
      return buildExpressionShotChoice(state, owner, command, options);
    }
    const choices = buildShotChoices(state, owner, command);
    if (!choices.length) return null;
    if (options && options.candidateId) {
      return choices.find((choice) => choice.candidateId === options.candidateId) || null;
    }
    return choices[0];
  }

  function buildExpressionShotChoice(state, owner, command, options) {
    const shooter = chooseShooter(state, owner);
    if (!shooter) return null;
    const targetId = String(options.targetId || "").toUpperCase();
    const target = (state.units || []).find((unit) => unit.id === targetId && unit.hp > 0);
    if (!target || target.team === shooter.team) return null;
    const directive = parseDirective(command);
    const hand = getCurrentHand(state, shooter.id);
    const requestedSlots = Array.isArray(options.cardSlots) ? options.cardSlots : [];
    const slotSet = new Set(
      requestedSlots
        .map((slot) => Number(slot))
        .filter((slot) => Number.isInteger(slot) && slot >= 1 && slot <= hand.length)
    );
    const selectedCards = hand.filter((card, index) => slotSet.has(index + 1));
    const components = selectedCards.map((card) => ({
      id: card.id,
      cardId: card.instanceId,
      component: card.component,
      label: card.label,
      family: card.family,
      tags: card.tags || [],
      effect: card.effect || {},
      amp: 0
    }));
    const validation = validateResourceUse(hand, components);
    const expression = normalizeProviderShotExpression(String(options.expression || "").trim().slice(0, 600));
    const functionValidation = validateExpressionFunctionSet(expression, hand);
    let expressionFn = null;
    let invalidExpressionReason = null;
    if (!functionValidation.ok) {
      invalidExpressionReason = functionValidation.reason;
      expressionFn = () => NaN;
    } else {
      try {
        expressionFn = compileShotExpression(expression);
      } catch (err) {
        invalidExpressionReason = err && err.message ? err.message : "invalid_expression";
        expressionFn = () => NaN;
      }
    }
    const shot = {
      shooter: clone(shooter),
      target: clone(target),
      distance: Math.max(1, Math.abs(target.x - shooter.x)),
      deltaY: target.y - shooter.y,
      components,
      usedCardIds: selectedCards.map((card) => card.instanceId),
      expression,
      expressionFn,
      invalidExpressionReason
    };
    const sim = validation.ok && !invalidExpressionReason ? simulateShot(state, shot) : {
      kind: "invalid",
      reason: validation.ok ? invalidExpressionReason : validation.reason,
      points: [],
      maxY: -Infinity,
      closestTargetDistance: Infinity,
      closestEnemyDistance: Infinity
    };
    const comboIdentity = assessCombo(components, directive);
    const routeBonus = scoreRouteBonus(sim.points, state.bonusPoints);
    const score = scoreSimulation(sim, shot, directive, routeBonus);
    return {
      score,
      team: shooter.team,
      owner: shooter.id,
      unitId: shooter.id,
      state,
      shooter,
      target,
      targetPriority: rankTargets(state, shooter, directive).map((rankedTarget, index) => ({
        id: rankedTarget.id,
        hp: rankedTarget.hp,
        priority: index + 1
      })),
      hand,
      directive,
      ruleSummary: ["model wrote function expression"],
      combo: comboIdentity,
      routeBonus,
      shot,
      sim,
      validation: validation.ok ? functionValidation : validation,
      candidateId: null
    };
  }

  function listLegalShots(state, owner, command) {
    return buildShotChoices(state, owner, command).map((choice) => ({
      candidateId: choice.candidateId,
      targetId: choice.target.id,
      cards: choice.shot.components.map((component, index) => ({
        slot: index + 1,
        function: component.label,
        label: component.label,
        family: component.family,
        tags: component.tags
      })),
      combo: choice.combo,
      expression: formatExpression(choice.shot),
      result: choice.sim.kind,
      resultLabel: resultLabel(choice.sim),
      score: round(choice.score, 2)
    }));
  }

  function formatComponent(component) {
    const amp = round(component.amp, 1);
    const kind = component.component || component.id;
    if (kind === "arc") return `${amp}*(4*t*(1-t))`;
    if (kind === "lift") return `${amp}*(sin(pi*t)*(1-0.25*t))`;
    if (kind === "bend") return `${amp}*(1-abs(2*t-1))`;
    if (kind === "chevron") return `${amp}*((2*t-1)*(1-abs(2*t-1)))`;
    if (kind === "hook") return `${amp}*(sin(pi*t)*(t<0.58?0.55:1.25))`;
    if (kind === "wave") return `${amp}*sin(pi*t)`;
    if (kind === "sway") return `${amp}*sin(2*pi*t)`;
    if (kind === "ripple") return `${amp}*(0.55*sin(3*pi*t))`;
    if (kind === "sinc") return `${amp}*(sinc(10*(t-0.5))*4*t*(1-t))`;
    if (kind === "cubic") return `${amp}*(6.2*t*(1-t)*(t-0.5))`;
    if (kind === "dive") return `${amp}*(t*t*(1.35-0.35*t))`;
    if (kind === "spike") return `${amp}*max(0,1-abs(t-0.62)/0.22)`;
    if (kind === "narrow_gaussian") return `${amp}*exp(-((t-0.68)^2)/(2*0.08^2))`;
    if (kind === "sqrt") return `${amp}*(sqrt(t)-t)`;
    if (kind === "cos_window") return `${amp}*((1-cos(2*pi*t))/2)`;
    if (kind === "gaussian") return `${amp}*exp(-((t-0.50)^2)/(2*0.18^2))`;
    if (kind === "sigmoid") return `${amp}*((sigmoid(12*(t-0.5))-0.5)*4*t*(1-t))`;
    if (kind === "softplus") return `${amp}*((softplus(8*(t-0.5))-softplus(-4))*(1-t))`;
    if (kind === "gelu") return `${amp}*(GELU(2*t-1)*4*t*(1-t))`;
    if (kind === "silu") return `${amp}*(SiLU(4*(t-0.5))*4*t*(1-t))`;
    if (kind === "beta") return `${amp}*(30*t^2*(1-t)^5)`;
    if (kind === "log") return `${amp}*(log1p(6*t)/log(7)-t)`;
    if (kind === "rational") return `${amp}*(t*(1-t)/(0.12+abs(t-0.5)))`;
    if (kind === "atan") return `${amp}*(atan(5*(t-0.5))*4*t*(1-t))`;
    if (kind === "softsign") return `${amp}*(((2*t-1)/(1+abs(2*t-1)))*4*t*(1-t))`;
    if (kind === "elu") return `${amp}*(ELU(4*(t-0.5))*4*t*(1-t))`;
    if (kind === "clamp") return `${amp}*(t>0.26&&t<0.74?0.65:0)`;
    if (kind === "shelf") return `${amp}*(t>0.18&&t<0.82?0.72:0.18)`;
    return `${amp}*${kind}(u/d)`;
  }

  function formatExpression(shot) {
    if (shot.expression) return shot.expression;
    const base = `y=${round(shot.shooter.y, 1)}+${round(shot.deltaY, 1)}*t`;
    if (!shot.components.length) return base;
    return `${base}+${shot.components.map(formatComponent).join("+")}; t=(u/d)`;
  }

  function resultLabel(sim) {
    if (!sim) return "none";
    if (sim.kind === "hitEnemy") return `hit enemy ${sim.unitId}`;
    if (sim.kind === "hitAlly") return `hit ally ${sim.unitId}`;
    if (sim.kind === "blocked") return `blocked by ${sim.obstacleId}`;
    if (sim.kind === "ground") return "hit ground";
    if (sim.kind === "out") return "out of bounds";
    if (sim.kind === "invalid") return sim.reason ? `invalid: ${sim.reason}` : "invalid function";
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
    const routeBonus = state.events.reduce((sum, event) => sum + (event.routeBonus?.value || 0), 0);
    const winBase = winner === "draw" ? 250 : alliedTeam ? 600 : 0;
    const difficulty = state.mapMeta ? state.mapMeta.difficulty : 60;
    const value =
      winBase +
      alliedHp +
      enemyHits * 35 -
      failures * 25 -
      allyHits * 45 -
      state.events.length * 6 +
      routeBonus * 2 +
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
      routeBonus,
      turns: state.events.length
    };
  }

  function finalizeBattle(state) {
    state.score = calculateBattleScore(state);
  }

  function forceResolveByHp(state, reason) {
    if (!state || state.winner) return state;
    const teamStats = (team) => {
      const units = state.units.filter((unit) => unit.team === team);
      return {
        hp: units.reduce((sum, unit) => sum + Math.max(0, unit.hp), 0),
        alive: units.filter((unit) => unit.hp > 0).length
      };
    };
    const a = teamStats("A");
    const b = teamStats("B");
    let winner = null;
    if (a.hp !== b.hp) winner = a.hp > b.hp ? "A" : "B";
    else if (a.alive !== b.alive) winner = a.alive > b.alive ? "A" : "B";
    else winner = "draw";
    if (winner === "A" || winner === "B") {
      const loser = winner === "A" ? "B" : "A";
      for (const unit of state.units) {
        if (unit.team === loser) unit.hp = 0;
      }
    }
    state.winner = winner;
    state.reason = reason || "resolution_guard";
    finalizeBattle(state);
    return state;
  }

  function applyTurn(state, commands, options) {
    if (state.winner) return state;
    const opts = options || {};
    const activeUnit = getActiveUnit(state);
    if (!activeUnit) {
      state.winner = "draw";
      state.reason = "no_alive_shooter";
      finalizeBattle(state);
      return state;
    }
    const team = activeUnit.team;
    const unitId = activeUnit.id;
    ensureHands(state);
    if (opts.action === "swap_hand" || opts.action === "reroll") {
      return rerollHand(state, unitId);
    }
    const orders = state.lockedOrders ? normalizeBattleOrders(state.lockedOrders) : normalizeBattleOrders(commands);
    const command = orders[unitId] || orders[team] || "";
    const decision = chooseShot(state, unitId, command, opts);

    if (!decision) {
      if (opts.candidateId) throw new Error("unknown_candidate");
      state.winner = team === "A" ? "B" : "A";
      state.reason = "no_alive_shooter";
      return state;
    }
    decision.providerReason = opts.providerReason || null;
    decision.provider = opts.provider || null;

    const sim = decision.sim;
    let damage = 0;
    if (sim.kind === "hitEnemy" || sim.kind === "hitAlly") {
      damage = calculateHitDamage(state, decision.shot, sim, decision.routeBonus);
      const hitUnit = state.units.find((unit) => unit.id === sim.unitId);
      if (hitUnit) hitUnit.hp = Math.max(0, hitUnit.hp - damage);
    }

    const event = {
      turn: state.turn,
      team,
      unitId,
      command: decision.directive.raw,
      shooterId: decision.shooter.id,
      targetId: decision.target.id,
      candidateId: decision.candidateId,
      provider: decision.provider,
      hand: decision.hand.map((card) => ({
        id: card.id,
        label: card.label,
        family: card.family,
        rarity: card.rarity,
        tags: card.tags,
        instanceId: card.instanceId,
        description: card.description
      })),
      usedCardIds: decision.shot.usedCardIds,
      components: decision.shot.components,
      combo: decision.combo,
      routeBonus: decision.routeBonus,
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
      unitId,
      shooterId: decision.shooter.id,
      targetId: decision.target.id,
      points: sim.points,
      routeBonus: decision.routeBonus,
      result: sim.kind,
      collisionPoint: sim.point || null
    });

    const winner = getWinner(state);
    if (winner) {
      state.winner = winner;
      state.reason = "hp_zero";
      finalizeBattle(state);
    }

    state.turn += 1;
    return state;
  }

  function runBattle(options) {
    const opts = options || {};
    const commands = opts.commands || {};
    const state = createInitialState({ seed: opts.seed, lockedOrders: commands });
    const maxActions = Math.max(24, Number(opts.maxActions || CONFIG.maxResolutionActions) || 96);
    let guard = 0;
    while (!state.winner && guard < maxActions) {
      applyTurn(state, commands);
      guard += 1;
    }
    if (!state.winner) {
      forceResolveByHp(state, "resolution_guard");
    }
    return state;
  }

  function exportTrace(state) {
    return {
      runId: `seed-${state.seed}`,
      seed: state.seed,
      config: state.config,
      mapMeta: clone(state.mapMeta),
      lockedOrders: clone(state.lockedOrders),
      obstacles: state.obstacles,
      bonusPoints: clone(state.bonusPoints || []),
      initialUnits: clone(state.initialUnits || BASE_SCENARIO.units),
      finalUnits: clone(state.units),
      events: clone(state.events),
      score: clone(state.score),
      winner: state.winner,
      reason: state.reason,
      totalTurns: state.turn,
      hands: clone(state.hands || null)
    };
  }

  return {
    CONFIG,
    CARD_LIBRARY,
    BASE_SCENARIO,
    UNIT_TURN_ORDER,
    createInitialState,
    applyTurn,
    getCurrentHand,
    swapHand,
    rerollHand,
    runBattle,
    forceResolveByHp,
    exportTrace,
    dealHand,
    analyzeHand,
    cardProfile,
    groundY,
    parseDirective,
    getTurnOrder,
    getActiveUnit,
    chooseShot,
    listLegalShots,
    simulateShot,
    validateResourceUse,
    expressionFunctionNames,
    allowedFunctionNamesForHand,
    validateExpressionFunctionSet,
    formatExpression,
    resultLabel,
    _internals: {
      hashString,
      mulberry32,
      distance,
      evalShotY,
      compileShotExpression,
      normalizeShotExpression,
      expressionFunctionNames,
      allowedFunctionNamesForHand,
      validateExpressionFunctionSet,
      generateComponentCombos
    }
  };
});
