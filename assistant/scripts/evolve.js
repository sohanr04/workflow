#!/usr/bin/env node
'use strict';

/**
 * evolve.js — Winston's weekly self-evolution, ported from Hermes
 * (NousResearch/hermes-agent-self-evolution, vendored at sohan-os/evolution/).
 *
 * Hermes' loop: score an agent's real outputs with an LLM-judge rubric →
 * reflectively MUTATE the instruction/persona → validate HARD CONSTRAINTS →
 * promote only if it improves AND passes the gates, human-reviewed (a PR, never
 * an auto-deploy). We keep that exact shape but run it ON THE SUB: the judging
 * and mutation happen inside Winston's own Sunday `claude -p` turn (mirroring
 * Hermes' custom claude_code provider that bills the subscription, not the API).
 *
 * The evolution DATASET is Winston's own memory — this is where it ties into
 * brain.js: the Reflexion lessons + MACLA play win/loss records ARE the trace
 * Hermes evolves from. So the two systems compound: brain.js accumulates what
 * worked, evolve.js distills it into a sharper persona each week.
 *
 * Two commands:
 *   gather              — assemble the week's evidence + rubric + constraints
 *                         into a prompt Winston reasons over (his Sunday turn).
 *                         Output ends in a GATED proposal, never an auto-edit.
 *   check <proposal>    — the Hermes ConstraintValidator, in JS. Verify a
 *                         proposed persona BEFORE Sohan applies it: size, growth
 *                         vs baseline, non-empty, and — critically — that it
 *                         still contains every IMMUTABLE guardrail. Evolution
 *                         that would delete its own safety rules is REJECTED.
 *
 * Usage (from profiles/sohan/):
 *   node ../../scripts/evolve.js gather
 *   node ../../scripts/evolve.js check memory/evolve/2026-07-19-proposal.md
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const CWD = process.cwd();                 // profiles/sohan when Winston runs it
const PERSONA = path.join(CWD, 'CLAUDE.md');

// ── Hermes fitness rubric (core/fitness.py) — weights are verbatim ──────────
const RUBRIC = {
  weights: { correctness: 0.5, procedure_following: 0.3, conciseness: 0.2 },
  // composite = 0.5*correctness + 0.3*procedure + 0.2*conciseness − length_penalty
};

// ── Hermes hard constraints (core/constraints.py), tuned for a persona ──────
const CONSTRAINTS = {
  maxBytes: 15000,        // size limit — persona must stay lean enough to hold
  maxGrowthRatio: 0.25,   // growth limit — an evolved persona can't balloon
  // Immutable guardrails: substrings that MUST survive every mutation. If a
  // proposed persona drops any of these, the evolution deleted a safety rail
  // and is rejected outright. (Matched case-insensitively, whitespace-loose.)
  immutable: [
    'never send',            // draft-only rule
    'suspect list',          // board-is-suspect deal-tracking discipline
    'never invent',          // no fabricated numbers
    'Parker',                // Parker signs off on prices
    'default to ask',        // ask-when-unsure
  ],
};

function run(cmd, args) {
  try { return execFileSync(cmd, args, { cwd: CWD, encoding: 'utf8', timeout: 60000, env: process.env }).trim(); }
  catch (e) { return `(unavailable: ${(e.stderr || e.message || '').toString().slice(0, 160)})`; }
}

function personaExcerpt(maxChars = 3500) {
  try {
    const t = fs.readFileSync(PERSONA, 'utf8');
    return t.length > maxChars ? t.slice(0, maxChars) + '\n…(truncated)…' : t;
  } catch { return '(CLAUDE.md not found)'; }
}

function recentJournal(days = 7) {
  const jdir = path.join(CWD, 'memory', 'journal');
  try {
    const files = fs.readdirSync(jdir).filter((f) => f.endsWith('.md')).sort().slice(-days);
    return files.map((f) => `### ${f}\n${fs.readFileSync(path.join(jdir, f), 'utf8').trim()}`).join('\n\n') || '(no journal entries this week)';
  } catch { return '(no journal dir yet)'; }
}

function cmdGather() {
  const reflect = run('node', [path.join(DIR, 'brain.js'), 'reflect', '--days', '7']);
  const plays = run('node', [path.join(DIR, 'brain.js'), 'play', 'rank']);
  const journal = recentJournal(7);
  const persona = personaExcerpt();
  const stamp = new Date().toISOString().slice(0, 10);

  console.log(`# WEEKLY SELF-EVOLUTION — Winston — ${stamp}
# (Hermes loop, on the sub: score → reflective mutation → constraint gate → HUMAN-GATED proposal)

You are reviewing your OWN week to get sharper. Work in four steps, in order.

## STEP 1 — SCORE this week (Hermes LLM-judge rubric, 0.0–1.0 each)
Judge how you operated on the desk this week on three dimensions, then compute
the composite EXACTLY as Hermes does:
  composite = ${RUBRIC.weights.correctness}*correctness
            + ${RUBRIC.weights.procedure_following}*procedure_following
            + ${RUBRIC.weights.conciseness}*conciseness
            − length_penalty
- correctness: did your chases/drafts/calls actually move money & get the facts right?
- procedure_following: did you re-ground via dealctx before nudging, ask-when-unsure,
  never invent a number, protect margin?
- conciseness: trader-tight, or bloated? (length_penalty > 0 if you padded.)
Give each score + one line of evidence from the week below.

## STEP 2 — REFLECT (this is the evolution dataset — YOUR real memory)
### Clustered lessons (brain.js reflect):
${reflect}

### Play track record (brain.js play rank — what actually worked/failed):
${plays}

### This week on the desk (journal):
${journal}

## STEP 3 — MUTATE (reflective mutation → the FULL evolved persona)
From the evidence, produce a COMPLETE proposed CLAUDE.md — your current persona
with 1–3 targeted sharpenings folded in, each tied to a concrete lesson or a
losing play above. Change only what the evidence justifies; keep everything else
byte-for-byte. This is a full-artifact evolution (Hermes-style), not a note.
Current persona (excerpt — read the full file for the real mutation):
---
${persona}
---

## STEP 4 — GATE (do NOT self-promote)
Write the full proposed persona to memory/evolve/${stamp}-proposal.md, then run:
  node ../../scripts/evolve.js check memory/evolve/${stamp}-proposal.md
The gate rejects it if it breaks size/growth or DROPS an immutable guardrail (a
mutation that deletes a safety rule is never valid). Fix until it PASSES. Then
text Sohan ONE line: "weekly evolution ready — N sharpenings, biggest: <x>.
diff at memory/evolve/${stamp}-proposal.md — review + say apply." He promotes it
by replacing CLAUDE.md. You never overwrite CLAUDE.md yourself.`);
}

function cmdCheck(file) {
  if (!file) { console.error('usage: check <proposal-file>'); process.exit(1); }
  let text;
  try { text = fs.readFileSync(path.isAbsolute(file) ? file : path.join(CWD, file), 'utf8'); }
  catch (e) { console.error(`check: cannot read ${file}: ${e.message}`); process.exit(1); }

  const results = [];
  const bytes = Buffer.byteLength(text, 'utf8');
  results.push({ name: 'size', pass: bytes <= CONSTRAINTS.maxBytes, msg: `${bytes}B (limit ${CONSTRAINTS.maxBytes})` });

  let baseBytes = null;
  try { baseBytes = Buffer.byteLength(fs.readFileSync(PERSONA, 'utf8'), 'utf8'); } catch { /* no baseline */ }
  if (baseBytes != null) {
    const cap = Math.round(baseBytes * (1 + CONSTRAINTS.maxGrowthRatio));
    results.push({ name: 'growth', pass: bytes <= cap, msg: `${bytes}B vs baseline ${baseBytes}B (cap ${cap}B, +${(CONSTRAINTS.maxGrowthRatio * 100)}%)` });
  }

  results.push({ name: 'non-empty', pass: text.trim().length > 0, msg: `${text.trim().length} chars` });

  const hay = text.toLowerCase().replace(/\s+/g, ' ');
  const missing = CONSTRAINTS.immutable.filter((g) => !hay.includes(g.toLowerCase()));
  results.push({
    name: 'immutable-guardrails',
    pass: missing.length === 0,
    msg: missing.length ? `DROPPED: ${missing.join(', ')} — evolution cannot delete a safety rule` : 'all guardrails intact',
  });

  let ok = true;
  console.log(`# constraint check — ${file}`);
  for (const r of results) { if (!r.pass) ok = false; console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}: ${r.msg}`); }
  console.log(ok ? '\nPASS — safe for Sohan to review & promote.' : '\nFAIL — fix the proposal before proposing it.');
  process.exit(ok ? 0 : 1);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'gather') cmdGather();
else if (cmd === 'check') cmdCheck(args[0]);
else console.log('evolve.js commands: gather | check <proposal-file>');
