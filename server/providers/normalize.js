"use strict";

function stripReasoning(value) {
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json|```/gi, "")
    .trim();
}

function normalizeProviderDecision(raw) {
  let parsed;
  try {
    parsed = JSON.parse(stripReasoning(raw));
  } catch (err) {
    throw new Error("invalid_provider_json");
  }
  const wantsSwap = parsed && (parsed.action === "swap_hand" || parsed.action === "reroll");
  if (!parsed || (!wantsSwap && typeof parsed.candidateId !== "string")) {
    throw new Error("missing_candidate_id");
  }
  return {
    action: wantsSwap ? "swap_hand" : "shot",
    candidateId: parsed.candidateId,
    publicReason: stripReasoning(
      parsed.publicReason || (wantsSwap ? "Provider selected a legal hand swap." : "Provider selected this legal shot.")
    ).slice(0, 240)
  };
}

module.exports = {
  normalizeProviderDecision,
  stripReasoning
};
