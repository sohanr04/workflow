#!/usr/bin/env node
'use strict';

/**
 * chase.js — the north star: Winston runs the boring chasing.
 *
 * Reads the order store and surfaces what's DUE right now — deterministically,
 * with the reason shown as Sohan's own words (the `raw` instruction played back),
 * so the logic is never a black box. Most-overdue first.
 *
 * It SURFACES + offers to draft; it does NOT draft everything unprompted and it
 * NEVER sends (Sohan's gated-drafting + drafts-only floor). Winston drafts a
 * specific nudge when Sohan says so, via draft.js --reply-ref <deal_ref>.
 *
 * Two kinds come due:
 *   chase  → a nudge to a COUNTERPARTY (Cherry/Noma/Atila). Offer to draft.
 *   remind → a ping to SOHAN himself ("remind me to send the PI"). No draft.
 *
 * Commands (run from profiles/sohan/):
 *   chase.js today        # everything due now, grouped, with reasons
 *   chase.js run          # same, framed for the scheduled morning brief
 */

const store = require('./store');

const now = () => new Date();
function overdueStr(dueISO) {
  const h = (now().getTime() - new Date(dueISO).getTime()) / 36e5;
  if (h < 0) return 'not yet';
  if (h < 24) return `${Math.round(h)}h overdue`;
  return `${Math.round(h / 24)}d overdue`;
}

// Build the due list, split into counterparty chases and self-reminders.
function due(atISO) {
  const rows = store.dueForChase(atISO); // open chase|remind, due<=now, most-overdue first
  return {
    chases: rows.filter((o) => o.kind === 'chase'),
    reminders: rows.filter((o) => o.kind === 'remind'),
  };
}

function fmtChase(o) {
  const who = o.party || o.deal_ref || 'someone';
  const refPart = (o.party && o.deal_ref) ? ` · ${o.deal_ref}` : ''; // avoid rendering the ref twice
  const head = `• #${o.id} ${who}${refPart} — ${overdueStr(o.due_at)}${o.cadence_days ? ` · every ${o.cadence_days}d` : ''}`;
  const ask = o.detail ? `\n    ask: ${o.detail}` : '';
  const why = `\n    why: you said "${o.raw}"`;
  return head + ask + why;
}
function fmtRemind(o) {
  return `• #${o.id} ${overdueStr(o.due_at)} — "${o.raw}"`;
}

function render({ chases, reminders }, { brief = false } = {}) {
  if (!chases.length && !reminders.length) {
    return brief ? 'HEARTBEAT_OK' : 'Nothing due to chase. All quiet.';
  }
  const out = [];
  if (brief) out.push(`☀️ Chase list — ${chases.length} to nudge, ${reminders.length} for you.`);
  if (chases.length) {
    out.push(`CHASE (${chases.length}) — ball on them, past due:`);
    for (const o of chases) out.push(fmtChase(o));
  }
  if (reminders.length) {
    out.push(`\nYOU (${reminders.length}) — your own reminders:`);
    for (const o of reminders) out.push(fmtRemind(o));
  }
  // only offer drafting when there's a counterparty chase (reminders have no thread)
  if (chases.length) out.push('\nSay "draft #<id>" and I\'ll write the nudge (threaded, drafts-only — you send).');
  return out.join('\n');
}

if (require.main === module) {
  const [cmd] = process.argv.slice(2);
  try {
    const list = due(new Date().toISOString());
    if (cmd === 'run') console.log(render(list, { brief: true }));
    else console.log(render(list)); // 'today' / default
  } catch (e) { console.error('chase.js: ' + e.message); process.exit(1); }
}

module.exports = { due, render };
