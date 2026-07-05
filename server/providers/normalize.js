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
  if (!parsed || (parsed.action !== "reroll" && typeof parsed.candidateId !== "string")) {
    throw new Error("missing_candidate_id");
  }
  return {
    action: parsed.action === "reroll" ? "reroll" : "shot",
    candidateId: parsed.candidateId,
    publicReason: stripReasoning(
      parsed.publicReason || (parsed.action === "reroll" ? "Provider selected a legal reroll." : "Provider selected this legal shot.")
    ).slice(0, 240)
  };
}

module.exports = {
  normalizeProviderDecision,
  stripReasoning
};
