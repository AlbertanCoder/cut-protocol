// Brain v3 — refusal policy (Stage D). Canned refusal lines keyed by category.
// injection reuses the off_topic line (don't disclose what tripped the guard —
// that just teaches an attacker the boundary); medical is a distinct redirect.
const REFUSALS = {
  off_topic: "I can only help with food, meals, and diet planning. What would you like to plan or adjust?",
  injection: "I can only help with food, meals, and diet planning. What would you like to plan or adjust?",
  medical: "I'm not a clinician and can't give medical, supplement, or dosing advice — please check with a doctor or dietitian. I'm happy to help with your meal plan, though.",
};

function refusalText(key) {
  return REFUSALS[key] || REFUSALS.off_topic;
}

module.exports = { REFUSALS, refusalText };
