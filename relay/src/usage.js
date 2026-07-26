// Usage ledger + budget enforcement.
//
// Append-only JSONL rather than SQLite: no native dependency to build on a
// Windows box, the file is readable with Notepad when Shad wants to see where
// the money went, and an append is atomic enough for a single-process relay.
//
// WHAT IS RECORDED: model, token counts, computed USD, timestamp, outcome.
// WHAT IS NOT: message content, system prompts, tool inputs, or any part of the
// request or response body. Meal logs and body-composition data are health
// information; they have no business sitting in a log file on a VPS, and a
// relay does not need them to do its job.
const fs = require("node:fs");
const path = require("node:path");
const { costUsd } = require("./pricing.js");

// Day and month keys in UTC. Deliberately NOT local time: a service that rolls
// its daily cap at the host's midnight behaves differently after a timezone or
// DST change, and "why did my budget reset at 5pm" is a bad thing to debug.
function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7); // YYYY-MM
}

class UsageLedger {
  constructor({ file, monthlyUsd, dailyUsd, perRequestUsd }) {
    this.file = file;
    this.caps = { monthlyUsd, dailyUsd, perRequestUsd };
    this.totals = new Map(); // key -> usd
    this._load();
  }

  // Rebuild running totals at boot by replaying the file. Keeps the hot path an
  // in-memory lookup instead of an O(n) file scan per request, and means a
  // restart cannot silently reset the month's spend to zero.
  _load() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return; // first run
      throw e;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row;
      try {
        row = JSON.parse(trimmed);
      } catch {
        // A torn final line (power loss mid-append) must not stop the relay
        // from booting. Skip it; the lost row is at most one request's spend.
        continue;
      }
      const usd = Number(row.usd);
      if (!Number.isFinite(usd) || !row.at) continue;
      const d = new Date(row.at);
      if (Number.isNaN(d.getTime())) continue;
      this._add(dayKey(d), usd);
      this._add(monthKey(d), usd);
    }
  }

  _add(key, usd) {
    this.totals.set(key, (this.totals.get(key) || 0) + usd);
  }

  spent(key) {
    return this.totals.get(key) || 0;
  }

  get today() {
    return this.spent(dayKey());
  }
  get month() {
    return this.spent(monthKey());
  }

  /**
   * Admission control. Runs BEFORE the upstream call, against an upper-bound
   * estimate. Returns {allowed:true} or {allowed:false, reason} where reason is
   * honest and specific enough to act on — a bare "429" tells the user nothing
   * about whether to wait an hour or a month.
   *
   * Budget state is deliberately absent from the /healthz endpoint but present
   * here, because the caller who just got denied has already proven they hold a
   * valid token.
   */
  check(estimateUsd) {
    if (estimateUsd > this.caps.perRequestUsd) {
      return {
        allowed: false,
        reason:
          `This single request could cost up to $${estimateUsd.toFixed(4)}, ` +
          `over the per-request cap of $${this.caps.perRequestUsd.toFixed(2)}.`,
        scope: "per-request",
      };
    }
    if (this.today + estimateUsd > this.caps.dailyUsd) {
      return {
        allowed: false,
        reason:
          `Today's spending limit is used up ($${this.today.toFixed(4)} of ` +
          `$${this.caps.dailyUsd.toFixed(2)}). It resets at midnight UTC.`,
        scope: "daily",
      };
    }
    if (this.month + estimateUsd > this.caps.monthlyUsd) {
      return {
        allowed: false,
        reason:
          `This month's spending limit is used up ($${this.month.toFixed(4)} of ` +
          `$${this.caps.monthlyUsd.toFixed(2)}).`,
        scope: "monthly",
      };
    }
    return { allowed: true };
  }

  /**
   * Book ACTUAL spend from the upstream response's usage block. Called after
   * every call that reached Anthropic — including ones whose body failed to
   * parse downstream, because the tokens were spent either way.
   */
  record({ model, usage, outcome = "ok", durationMs = null }) {
    const u = usage || {};
    const usd = costUsd(model, u);
    const row = {
      at: new Date().toISOString(),
      model,
      outcome,
      durationMs,
      input: Number(u.input_tokens) || 0,
      output: Number(u.output_tokens) || 0,
      cacheWrite: Number(u.cache_creation_input_tokens) || 0,
      cacheRead: Number(u.cache_read_input_tokens) || 0,
      usd: Number(usd.toFixed(8)),
    };
    this._add(dayKey(), row.usd);
    this._add(monthKey(), row.usd);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify(row)}\n`, "utf8");
    return row;
  }

  /**
   * Denials are recorded too, at zero cost. Without this row there is no way to
   * tell "the cap held and the client backed off" from "the relay was never
   * reached" when reconciling against the Anthropic console in Stage 5.
   */
  recordDenied({ model, scope, estimateUsd }) {
    const row = {
      at: new Date().toISOString(),
      model,
      outcome: `denied:${scope}`,
      estimateUsd: Number(estimateUsd.toFixed(8)),
      usd: 0,
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify(row)}\n`, "utf8");
    return row;
  }
}

module.exports = { UsageLedger, dayKey, monthKey };
