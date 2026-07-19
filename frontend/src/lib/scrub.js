// Belt-and-suspenders redaction for anything that reaches a bug report.
// The activity log is already body-free (see bugLog.js), so this mostly
// guards free-text the user typed and any data that slipped into an error
// message. It NEVER lets an email, a bodyweight, or a token leave the app.

export function scrub(text) {
  let s = String(text ?? "");
  // Email addresses.
  s = s.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]");
  // Bodyweights ("212 lb", "88.4 kg", "95 kilograms").
  s = s.replace(/\b\d{2,3}(?:\.\d+)?\s?(?:kg|kgs|kilograms?|lb|lbs|pounds?)\b/gi, "[weight]");
  // API keys / bearer tokens / JWT-ish blobs.
  s = s.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
  s = s.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, "[redacted]");
  s = s.replace(/\beyJ[A-Za-z0-9._-]{10,}\b/g, "[redacted]"); // JWT
  return s;
}
