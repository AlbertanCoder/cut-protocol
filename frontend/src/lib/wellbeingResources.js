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
// Hours are kept coarse ("7 days a week", "24/7") on purpose — exact hours vary
// by contact method and change over time, and a wrong specific time is worse
// than an honest coarse one. Send people to the site/number for current hours.

export const WELLBEING_RESOURCES = [
  {
    name: "NEDIC — National Eating Disorder Information Centre",
    detail: "Free helpline & live chat, 7 days a week",
    phone: "1-866-633-4220",
    url: "https://nedic.ca",
  },
  {
    name: "Eating Disorder Support Network of Alberta (EDSNA)",
    detail: "Edmonton-based peer support groups, referrals & resource lists",
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
