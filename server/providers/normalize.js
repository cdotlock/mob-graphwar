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

function normalizeProviderDecision(raw) {
  let parsed;
  try {
    parsed = parseProviderJson(raw);
  } catch (err) {
    throw new Error("invalid_provider_json");
  }
  const wantsSwap = parsed && parsed.action === "swap_hand";
  if (parsed && !wantsSwap && typeof parsed.expression === "string") {
    return {
      action: "shot",
      targetId: typeof parsed.targetId === "string" ? parsed.targetId.trim() : "",
      expression: stripReasoning(parsed.expression).slice(0, 600),
      cardSlots: Array.isArray(parsed.cardSlots)
        ? parsed.cardSlots.map((slot) => Number(slot)).filter((slot) => Number.isInteger(slot))
        : [],
      publicReason: stripReasoning(parsed.publicReason || "Provider wrote a function shot.").slice(0, 240)
    };
  }
  if (!parsed || !wantsSwap) {
    throw new Error("missing_expression");
  }
  return {
    action: "swap_hand",
    publicReason: stripReasoning(parsed.publicReason || "Provider selected a legal hand swap.").slice(0, 240)
  };
}

module.exports = {
  parseProviderJson,
  normalizeProviderDecision,
  stripReasoning
};
