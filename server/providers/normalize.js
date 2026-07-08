"use strict";

function stripReasoning(value) {
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json|```/gi, "")
    .trim();
}

function parseProviderJson(raw) {
  const text = stripReasoning(raw);
  try {
    return JSON.parse(text);
  } catch (err) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw err;
  }
}

function firstString(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  return "";
}

function pickString(source, keys) {
  for (const key of keys) {
    const value = source && source[key];
    const text = firstString(value);
    if (text) return text;
  }
  return "";
}

function normalizeAction(value) {
  const action = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (["swap", "swaphand", "swap_hand", "swap_cards", "change_hand", "redraw"].includes(action)) return "swap_hand";
  if (["shot", "shoot", "fire", "attack", "function", "write_function"].includes(action)) return "shot";
  return action;
}

function normalizeTargetId(value) {
  const text = String(value || "").trim().toUpperCase();
  const match = text.match(/[AB][12]/);
  return match ? match[0] : text;
}

function pickCardSlots(source) {
  const raw =
    source?.cardSlots ??
    source?.card_slots ??
    source?.cards ??
    source?.slots ??
    source?.cardSlot ??
    source?.slot ??
    [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map((slot) => Number(slot)).filter((slot) => Number.isInteger(slot));
}

function normalizeProviderDecision(raw) {
  let parsed;
  try {
    parsed = parseProviderJson(raw);
  } catch (err) {
    throw new Error("invalid_provider_json");
  }
  const action = normalizeAction(parsed?.action || parsed?.action_type || parsed?.type || parsed?.move);
  const expression = pickString(parsed, ["expression", "formula", "function", "equation", "y", "trajectory"]);
  const wantsSwap = action === "swap_hand";
  if (parsed && !wantsSwap && expression) {
    return {
      action: "shot",
      targetId: normalizeTargetId(pickString(parsed, ["targetId", "target_id", "target", "targetUnit", "target_unit", "enemy", "aimAt"])),
      expression: stripReasoning(expression).slice(0, 600),
      cardSlots: pickCardSlots(parsed),
      publicReason: stripReasoning(pickString(parsed, ["publicReason", "public_reason", "reason", "explanation", "rationale"]) || "Provider wrote a function shot.").slice(0, 240)
    };
  }
  if (!parsed || !wantsSwap) {
    throw new Error("missing_expression");
  }
  return {
    action: "swap_hand",
    publicReason: stripReasoning(pickString(parsed, ["publicReason", "public_reason", "reason", "explanation", "rationale"]) || "Provider selected a legal hand swap.").slice(0, 240)
  };
}

module.exports = {
  parseProviderJson,
  normalizeProviderDecision,
  stripReasoning
};
