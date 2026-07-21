#!/usr/bin/env node
'use strict';

/**
 * rephrase.js — pass a drafted email through the OpenAI CLI (codex) to rephrase
 * it, with a hard guard: every price, quantity, ref and $ figure must survive
 * EXACTLY, or we fall back to the original draft.
 *
 * Why: Sohan wants outgoing drafts rephrased by the OpenAI CLI (installed +
 * authed on the host). Winston composes the draft (facts, numbers, To/CC),
 * this tool restyles the prose only.
 *
 * Usage (from profiles/sohan/):
 *   node ../../scripts/rephrase.js "Hi Cherry, can we please do $2.00 ..."
 *   echo "<draft>" | node ../../scripts/rephrase.js
 * Output: the rephrased email text (or the ORIGINAL + a warning line if the
 * rephrase lost a number / the CLI is unavailable).
 */

const { execFileSync } = require('child_process');
const { extractOpaqueIdentifiers } = require('../lib/openclaw');

function readInput() {
  const arg = process.argv.slice(2).join(' ').trim();
  if (arg) return arg;
  try { return require('fs').readFileSync(0, 'utf8').trim(); } catch { return ''; }
}

const draft = readInput();
if (!draft) { console.error('rephrase.js: no draft given (arg or stdin)'); process.exit(1); }

const PROMPT =
  'Rephrase the following business email. RULES: keep every number, price, ' +
  'quantity, style code, name and date EXACTLY as written — do not add, drop or ' +
  'round any figure. Keep the same meaning, greeting and sign-off structure. ' +
  'Tone: warm, brief, direct trade English. Return ONLY the rephrased email ' +
  'text, no commentary, no quotes, no markdown.\n\n---\n' + draft;

let out = '';
try {
  // codex exec = non-interactive one-shot on the host's ChatGPT auth.
  out = execFileSync('codex', ['exec', '--skip-git-repo-check', PROMPT], {
    encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  // codex may prefix session/log lines; keep from the first greeting-looking line
  const lines = out.split('\n');
  const start = lines.findIndex((l) => /^(hi|hello|dear|good\s)/i.test(l.trim()));
  if (start > 0) out = lines.slice(start).join('\n').trim();
} catch (e) {
  console.log(draft);
  console.error(`\n[rephrase unavailable (${(e.message || '').slice(0, 80)}) — original draft returned]`);
  process.exit(0);
}

// ── the guard: every identifier in the original must survive ─────────────────
const need = extractOpaqueIdentifiers(draft);
const hay = out.toLowerCase();
const missing = need.filter((id) => !hay.includes(String(id).toLowerCase()));
if (!out || missing.length) {
  console.log(draft);
  console.error(`\n[rephrase REJECTED — ${missing.length ? 'lost: ' + missing.join(', ') : 'empty output'} — original draft returned]`);
} else {
  console.log(out);
}
