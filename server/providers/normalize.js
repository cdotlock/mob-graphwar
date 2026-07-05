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
  if (!parsed || typeof parsed.candidateId !== "string") {
    throw new Error("missing_candidate_id");
  }
  return {
    candidateId: parsed.candidateId,
    publicReason: stripReasoning(parsed.publicReason || "Provider selected this legal shot.").slice(0, 240)
  };
}

module.exports = {
  normalizeProviderDecision,
  stripReasoning
};
