// Eating-disorder + mental-health support resources — Alberta / Canada.
//
// SINGLE SOURCE OF TRUTH. Both the Profile "Outside help" card and the sidebar
// Wellbeing check render this list, so a number can never drift between the two.
// These are safety-critical: every entry was verified against the organisation's
// own site or Alberta Health Services on 2026-07-24. If you change one, re-verify
// it — do not guess hours or numbers.
//
// Cut Protocol is not affiliated with, endorsed by, or partnered with any of
// these organisations; they are listed as a courtesy.
//
// Deliberately Canadian/Alberta-first: the app is used from Alberta, so the US
// NEDA (whose telephone helpline closed in 2023) is not the right primary line.
//
// Hours are kept coarse ("24/7") WHERE THAT IS TRUE, and specific where a
// coarse answer would send someone to a line that doesn't pick up. Correction
// 2026-07-24: this file previously said NEDIC was a "Free helpline & live chat,
// 7 days a week". Only the LIVE CHAT is 7 days — the phone line is closed on
// weekends, so anyone calling 1-866-633-4220 on a Saturday in crisis got
// nothing. A comfortable round number is not worth that. When a service's hours
// differ by contact method, say so per method.
//
// Where the hours below are still coarse (24/7), they are genuinely 24/7.

export const WELLBEING_RESOURCES = [
  {
    name: "NEDIC — National Eating Disorder Information Centre",
    // Verified 2026-07-24 against nedic.ca. Phone and chat have DIFFERENT
    // hours; do not collapse them back into one line.
    detail: "Live chat 7 days a week. Phone line Mon–Thu 9am–9pm ET, Fri 9am–5pm ET, closed weekends",
    phone: "1-866-633-4220",
    url: "https://nedic.ca",
  },
  {
    name: "Eating Disorder Support Network of Alberta (EDSNA)",
    // Their peer support groups are 18+ — worth stating up front so someone
    // under 18 isn't turned away at the door.
    detail: "Edmonton-based peer support groups (18+), referrals & resource lists",
    email: "info@edsna.ca",
    url: "https://edsna.ca",
  },
  {
    name: "Alberta Mental Health Help Line",
    detail: "Confidential support, 24/7",
    phone: "1-877-303-2642",
  },
  {
    name: "Health Link Alberta",
    detail: "Health advice from a registered nurse, 24/7",
    phone: "811",
  },
  {
    name: "988 Suicide Crisis Helpline",
    detail: "Call or text, 24/7, if you're in crisis",
    phone: "988",
  },
];

// Shown wherever the list appears, so the app never implies a partnership.
export const WELLBEING_RESOURCES_NOTE =
  "Free and confidential. Cut Protocol isn't affiliated with these organisations and never sees whether you contact them.";
