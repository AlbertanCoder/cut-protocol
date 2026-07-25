// Brain v3 — refusal policy (Stage D). Canned refusal lines keyed by category.
// injection reuses the off_topic line (don't disclose what tripped the guard —
// that just teaches an attacker the boundary); medical, minor and ed_risk are
// distinct, because "I can only help with food" is the wrong answer to all three.
const REFUSALS = {
  off_topic: "I can only help with food, meals, and diet planning. What would you like to plan or adjust?",
  injection: "I can only help with food, meals, and diet planning. What would you like to plan or adjust?",
  medical: "I'm not a clinician and can't give medical, supplement, or dosing advice — please check with a doctor or dietitian. I'm happy to help with your meal plan, though.",

  // A self-declared minor asking about losing weight. This is a paediatric
  // question, not a meal-planning one, and the honest answer names why.
  minor: "This app is built for adults, and calorie targets for anyone still growing need a doctor or a paediatric dietitian — I'd get it wrong. I can still help with recipe and cooking ideas.",

  // Disordered-eating risk. A bare "I can only help with food" here is the worst
  // possible reply: the person told us something hard and got a wall. So this
  // one does NOT stonewall — it names what it can't do, stays warm, and points
  // at the Wellbeing tab, which holds the self-check and the Alberta/Canada
  // support resources. Deliberately no phone numbers or org names inline: those
  // live in one place (the Wellbeing tab) so they can be kept current, rather
  // than drifting in a copy pasted into a refusal string.
  ed_risk:
    "I'm not able to help with that one — planning around very low intake or around purging, fasting or compensating isn't something I can do safely, and I'd rather say so than give you something harmful.\n\n" +
    "If any of that is on your mind right now, the Wellbeing tab has a short self-check and links to real support you can reach today. Talking to someone beats doing this alone.\n\n" +
    "I'm still here for ordinary meal and recipe questions whenever you want them.",
};

function refusalText(key) {
  return REFUSALS[key] || REFUSALS.off_topic;
}

module.exports = { REFUSALS, refusalText };
