#!/usr/bin/env node
'use strict';

/**
 * brain.js — Winston's self-improving memory engine.
 *
 * Fresh code, but the mechanisms are lifted from adversarially-verified,
 * peer-reviewed research (not invented):
 *
 *  • RECALL  — composite retrieval from Generative Agents (Park et al.,
 *    Stanford, ACM UIST 2023): score = recency(exp-decay) + importance(1-10)
 *    + relevance, each min-max normalized, equal weights. Beats plain grep.
 *  • LEARN   — Reflexion (Shinn et al., Princeton, NeurIPS 2023): after an
 *    outcome, store a verbal self-critique in an episodic buffer; it resurfaces
 *    (via recall) on the next relevant situation. No weight updates.
 *  • PLAYS   — MACLA (AAMAS 2026): each negotiation "play" carries a Beta(α,β)
 *    reliability posterior updated from win/loss outcomes; rank by posterior
 *    mean so Winston picks the move most likely to work.
 *  • REFLECT — Generative Agents reflection / consolidation: cluster recent
 *    lessons so the weekly review can distill them into durable buyer/supplier
 *    insight, and decay stale low-importance memories.
 *
 * The CODE does the memory mechanics (scoring, storage, Bayesian update,
 * pruning). WINSTON (the model) does the judgment (writing the lesson text,
 * rating importance, distilling reflections) by calling these commands —
 * exactly the division of labor the papers use.
 *
 * Memory lives with the agent, code lives in the repo:
 *   WINSTON_MEM_DIR (default ~/.openclaw/workspace/omoc_winston/memory)
 *     lessons.jsonl   — episodic buffer (append-only)
 *     plays.json      — the playbook with reliability posteriors
 *
 * Usage (exact commands — Winston's persona documents these):
 *   node brain.js learn "held $1.26 too long vs Nawaal's $0.90, lost the cap" --imp 8 --tags choice,nawaal,pricing
 *   node brain.js recall "quoting Nawaal a cap price" [--k 5]
 *   node brain.js play win  "counter supplier -25% first round" --cat supplier-open
 *   node brain.js play loss "hold firm on first ask"            --cat supplier-open
 *   node brain.js play rank [--cat supplier-open]
 *   node brain.js reflect   [--days 7]
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

// Memory lives with the gateway persona (Winston runs from profiles/sohan/, so
// this resolves to profiles/sohan/memory/brain — beside his other memory).
// WINSTON_MEM_DIR overrides. The old ~/.openclaw path is dead (OpenClaw can't
// use the sub); we run on the gateway now.
const MEM = process.env.WINSTON_MEM_DIR || path.join(process.cwd(), 'memory', 'brain');
const LESSONS = path.join(MEM, 'lessons.jsonl');
const PLAYS = path.join(MEM, 'plays.json');
const HALF_LIFE_DAYS = Number(process.env.WINSTON_HALFLIFE_DAYS || 30); // recency decay
const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;

function ensure() { fs.mkdirSync(MEM, { recursive: true }); }
function now() { return new Date().toISOString(); }
function daysSince(iso) { return (Date.now() - new Date(iso).getTime()) / 86400000; }
function readLessons() {
  try {
    return fs.readFileSync(LESSONS, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function readPlays() { try { return JSON.parse(fs.readFileSync(PLAYS, 'utf8')); } catch { return {}; } }
function writePlays(p) { ensure(); fs.writeFileSync(PLAYS, JSON.stringify(p, null, 2)); }

// crude but effective relevance: token overlap of query vs lesson text+tags
function tokens(s) { return new Set(String(s).toLowerCase().match(/[a-z0-9$.]+/g) || []); }
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const t of a) if (b.has(t)) n++;
  return n / Math.sqrt(a.size * b.size); // cosine-ish on sets
}
function minmax(vals) {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return (x) => (hi === lo ? (vals.length ? 0.5 : 0) : (x - lo) / (hi - lo));
}

function flag(args, name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

function cmdLearn(args) {
  const text = args[0];
  if (!text) die('usage: learn "<lesson>" --imp 1-10 --tags a,b');
  ensure();
  const rec = {
    ts: now(),
    text,
    importance: Math.max(1, Math.min(10, Number(flag(args, 'imp', 5)))),
    tags: (flag(args, 'tags', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
    type: flag(args, 'type', 'lesson'),
  };
  fs.appendFileSync(LESSONS, JSON.stringify(rec) + '\n');
  console.log(`learned (imp ${rec.importance}, tags: ${rec.tags.join(',') || '—'})`);
}

function cmdRecall(args) {
  const query = args[0] || '';
  const k = Number(flag(args, 'k', 5));
  const items = readLessons();
  if (!items.length) return console.log('(no memories yet)');
  const q = tokens(query);
  const recency = items.map((m) => Math.exp(-LAMBDA * daysSince(m.ts)));
  const importance = items.map((m) => m.importance / 10);
  const relevance = items.map((m) => overlap(q, tokens(m.text + ' ' + (m.tags || []).join(' '))));
  const nR = minmax(recency), nI = minmax(importance), nV = minmax(relevance);
  const scored = items.map((m, i) => ({
    m, score: nR(recency[i]) + nI(importance[i]) + nV(relevance[i]),
  })).sort((a, b) => b.score - a.score).slice(0, k);
  console.log(`# recall "${query}" — top ${scored.length} of ${items.length}`);
  for (const s of scored) {
    const d = Math.round(daysSince(s.m.ts));
    console.log(`- [${s.score.toFixed(2)} · imp${s.m.importance} · ${d}d] ${s.m.text}${s.m.tags?.length ? '  {' + s.m.tags.join(',') + '}' : ''}`);
  }
}

function cmdPlay(args) {
  const sub = args[0];
  if (sub === 'rank') {
    const cat = flag(args.slice(1), 'cat', null);
    const plays = readPlays();
    let rows = Object.entries(plays).map(([name, p]) => ({ name, ...p }));
    if (cat) rows = rows.filter((r) => r.cat === cat);
    if (!rows.length) return console.log('(no plays recorded yet)');
    rows.forEach((r) => { r.n = (r.alpha - 1) + (r.beta - 1); r.mean = r.alpha / (r.alpha + r.beta); });
    rows.sort((a, b) => b.mean - a.mean || b.n - a.n);
    console.log(`# plays ranked${cat ? ' (' + cat + ')' : ''} — by reliability`);
    for (const r of rows) {
      const conf = r.n >= 5 ? 'solid' : r.n >= 2 ? 'thin' : 'new';
      console.log(`- ${(r.mean * 100).toFixed(0)}% (${r.n} tries, ${conf})${r.cat ? ' [' + r.cat + ']' : ''}  ${r.name}`);
    }
    return;
  }
  // record: play win|loss "<name>" --cat c
  const outcome = sub;
  const name = args[1];
  if ((outcome !== 'win' && outcome !== 'loss') || !name) die('usage: play win|loss "<name>" --cat <category>');
  const plays = readPlays();
  const cat = flag(args.slice(2), 'cat', null);
  const p = plays[name] || { alpha: 1, beta: 1, cat };
  if (cat) p.cat = cat;
  if (outcome === 'win') p.alpha += 1; else p.beta += 1;
  p.updated = now();
  plays[name] = p;
  writePlays(plays);
  const mean = p.alpha / (p.alpha + p.beta);
  console.log(`${outcome} recorded → "${name}" now ${(mean * 100).toFixed(0)}% over ${(p.alpha - 1) + (p.beta - 1)} tries`);
}

function cmdReflect(args) {
  const days = Number(flag(args, 'days', 7));
  const items = readLessons();
  const recent = items.filter((m) => daysSince(m.ts) <= days);
  const byTag = {};
  for (const m of recent) for (const t of (m.tags.length ? m.tags : ['untagged'])) (byTag[t] ||= []).push(m);
  console.log(`# reflection — ${recent.length} lessons in last ${days}d, ${items.length} total`);
  console.log(`# distill these clusters into durable buyer/supplier insight, then update the people files:`);
  for (const [t, arr] of Object.entries(byTag).sort((a, b) => b[1].length - a[1].length)) {
    if (arr.length < 2) continue;
    console.log(`\n## ${t} (${arr.length})`);
    arr.forEach((m) => console.log(`  - ${m.text}`));
  }
  const stale = items.filter((m) => daysSince(m.ts) > 90 && m.importance <= 3).length;
  if (stale) console.log(`\n# ${stale} stale low-importance lessons (>90d, imp<=3) — safe to prune.`);
}

function die(m) { console.error('brain.js: ' + m); process.exit(1); }

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'learn') cmdLearn(args);
else if (cmd === 'recall') cmdRecall(args);
else if (cmd === 'play') cmdPlay(args);
else if (cmd === 'reflect') cmdReflect(args);
else console.log('brain.js commands: learn | recall | play (win|loss|rank) | reflect');
