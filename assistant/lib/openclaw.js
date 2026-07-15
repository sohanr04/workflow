'use strict';

/**
 * openclaw.js — runtime mechanisms ported from OpenClaw into Winston's gateway.
 *
 * Winston runs on the bespoke gateway (claude -p = Claude Code = Sohan's SUB),
 * NOT on OpenClaw itself (Anthropic blocks third-party subscription use). So we
 * take the parts of OpenClaw's runtime the gateway lacks and reimplement them
 * here, faithful to the originals. Each block cites the exact OpenClaw source
 * (openclaw@2026.3.28, dist/plugin-sdk/src/...).
 *
 * What's ported and WHY it matters for a deal desk:
 *   1. Heartbeat token discipline  (auto-reply/heartbeat.d.ts, tokens.d.ts)
 *      — skip the expensive patrol when nothing is pending; strip the OK token
 *        out of mixed replies so a real report isn't swallowed.
 *   2. Identifier-preserving summaries (agents/pi-extensions/
 *        compaction-safeguard-quality.d.ts) — when Winston condenses a thread
 *        into deals.md, NEVER lose a price, qty, or deal code. Audit + flag.
 *   3. Model fallback (auto-reply/fallback-state.d.ts, compact-reasons.d.ts)
 *      — a transient opus overload shouldn't drop a chase; fail over to sonnet.
 *   4. Resume re-injection (auto-reply/reply/post-compaction-context.d.ts)
 *      — after Claude Code auto-compacts a long session, re-assert today's real
 *        date + the desk rules so Winston reads the right daily files.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. HEARTBEAT / SILENT-REPLY TOKENS
//    from dist/plugin-sdk/src/auto-reply/tokens.d.ts + heartbeat.d.ts
// ─────────────────────────────────────────────────────────────────────────────

const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';
const SILENT_REPLY_TOKEN = 'NO_REPLY';
const DEFAULT_HEARTBEAT_ACK_MAX_CHARS = 300;

/**
 * OpenClaw: isHeartbeatContentEffectivelyEmpty — a HEARTBEAT.md (or, for us, a
 * pending-work signal) with only whitespace / comment (#) / blank lines has no
 * actionable task, so the whole LLM call can be skipped. Saves sub usage on
 * every quiet tick.
 */
function isHeartbeatContentEffectivelyEmpty(content) {
  if (content == null) return false; // missing → let the agent decide
  const meaningful = String(content)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length && !l.startsWith('#'));
  return meaningful.length === 0;
}

/**
 * OpenClaw: stripSilentToken / stripHeartbeatToken — remove a trailing silence
 * token from mixed-content text. If nothing meaningful remains, the message is
 * silent (skip). This FIXES the gateway's old `text.includes(token)` check,
 * which wrongly suppressed real reports that merely mentioned the token
 * ("chased Cherry. HEARTBEAT_OK" used to vanish).
 */
function stripSilentToken(text, token = HEARTBEAT_TOKEN) {
  if (!text) return { shouldSkip: true, text: '', didStrip: false };
  const re = new RegExp(`(^|\\s|[.!,:;-]|\\b)${token}\\s*$`, 'i');
  const didStrip = re.test(text.trim());
  let remaining = text.trim();
  // strip every trailing occurrence (models sometimes repeat it)
  for (;;) {
    const next = remaining.replace(new RegExp(`${token}\\s*$`, 'i'), '').trim();
    if (next === remaining) break;
    remaining = next.replace(/[.!,:;\-\s]+$/, '').trim();
  }
  const shouldSkip = remaining.length === 0;
  return { shouldSkip, text: remaining, didStrip };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. IDENTIFIER-PRESERVING SUMMARY AUDIT
//    from dist/plugin-sdk/src/agents/pi-extensions/compaction-safeguard-quality.d.ts
//        (extractOpaqueIdentifiers, auditSummaryQuality)
//    Tuned for the trade: prices, quantities, deal/style codes, box refs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull the identifiers that must survive any condensation of a deal thread:
 * prices ($1.80, 2.45), quantities (450k, 6,000pcs), deal/style codes
 * (gbt26-3873, DIS-26-3592), and percentages. These are the tokens whose loss
 * turns a summary into a lie.
 */
function extractOpaqueIdentifiers(text) {
  if (!text) return [];
  const out = new Set();
  const grab = (re) => { let m; while ((m = re.exec(text))) out.add(m[0]); };
  grab(/\$\s?\d+(?:\.\d+)?/g);                       // $1.80  $2
  grab(/\b\d+(?:[.,]\d+)?\s?(?:k|pcs|pieces|units|ctns?|cartons?)\b/gi); // 450k, 6,000pcs
  grab(/\b\d{1,3}(?:,\d{3})+\b/g);                   // 12,000
  grab(/\b\d+(?:\.\d+)?%/g);                         // 10%
  grab(/\b[a-z]{2,5}-?\d{2,}[a-z0-9-]*\b/gi);        // gbt26-3873, DIS-26-3592
  return [...out];
}

/**
 * auditSummaryQuality — given a condensed summary, the identifiers it MUST
 * retain, and the latest open ask, return { ok, reasons }. ok:false means the
 * summary dropped something material and should be regenerated (or the raw
 * numbers re-appended). This is the guardrail Sohan asked for: never shorten a
 * price or an ID out of existence.
 */
function auditSummaryQuality({ summary, identifiers = [], latestAsk = null }) {
  const reasons = [];
  const hay = (summary || '').toLowerCase();
  const missing = identifiers.filter((id) => !hay.includes(String(id).toLowerCase()));
  if (missing.length) reasons.push(`dropped identifiers: ${missing.join(', ')}`);
  if (latestAsk && !hay.includes(String(latestAsk).toLowerCase().slice(0, 24))) {
    reasons.push('latest open ask not represented');
  }
  if (!hay.trim()) reasons.push('empty summary');
  return { ok: reasons.length === 0, reasons, missing };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MODEL FALLBACK
//    from dist/plugin-sdk/src/auto-reply/fallback-state.d.ts
//        + agents/pi-embedded-runner/compact-reasons.d.ts (classifyReason)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * classifyRetryable — is this failure a transient capacity/network fault worth
 * failing over for (vs. a hard auth/usage error that a retry can't fix)?
 * Mirrors OpenClaw's compact-reasons classifier intent.
 */
function classifyRetryable(errText) {
  const e = String(errText || '').toLowerCase();
  if (/401|invalid.*(auth|api key)|authenticate|usage limit|quota/.test(e)) {
    return { retryable: false, reason: 'auth/usage — fallback would not help' };
  }
  if (/overloaded|429|rate.?limit|529/.test(e)) return { retryable: true, reason: 'overloaded' };
  if (/50\d|timeout|timed out|econnreset|socket hang|network|fetch failed/.test(e)) {
    return { retryable: true, reason: 'transient network/5xx' };
  }
  return { retryable: false, reason: 'non-transient' };
}

/**
 * buildFallbackNotice — the one-line "⚠️ opus was overloaded, ran on sonnet"
 * banner OpenClaw prepends so a degraded answer is never silent.
 */
function buildFallbackNotice({ selectedModel, activeModel, reason }) {
  if (!activeModel || activeModel === selectedModel) return null;
  return `⚠️ ${selectedModel} ${reason}; ran on ${activeModel}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. RESUME / POST-COMPACTION RE-INJECTION
//    from dist/plugin-sdk/src/auto-reply/reply/post-compaction-context.d.ts
//    (substitutes real date so the agent reads the correct daily files)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A short system preamble to prepend on session resume. After Claude Code
 * auto-compacts a long thread it can lose the anchor; this re-asserts who
 * Winston is, today's REAL date (so he greps today's journal/deals, not a
 * training-cutoff guess), and the one rule that must never decay.
 */
function buildResumePreamble(nowMs) {
  const d = nowMs ? new Date(nowMs) : new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return [
    `[desk context — today is ${date}]`,
    'You are Winston on the Grand Empire deal desk. The board is a SUSPECT LIST:',
    're-ground any deal via `node ../../scripts/dealctx.js <code>` before nudging.',
    'Never invent a price or a number; grep the record and cite the date.',
  ].join(' ');
}

module.exports = {
  HEARTBEAT_TOKEN,
  SILENT_REPLY_TOKEN,
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  isHeartbeatContentEffectivelyEmpty,
  stripSilentToken,
  extractOpaqueIdentifiers,
  auditSummaryQuality,
  classifyRetryable,
  buildFallbackNotice,
  buildResumePreamble,
};
