#!/usr/bin/env node
'use strict';

/**
 * dealctx.js — re-ground a deal in its REAL current state before acting.
 *
 * The deals-engine is great at BIRTH (spotting a new deal from buyer interest)
 * but blind to LIFECYCLE — it ages a birth snapshot on a clock, so it nudges to
 * "chase" deals that already died, were already handled, or are waiting on the
 * factory, not us. This tool fixes that: before Winston nudges about ANY deal,
 * he runs `dealctx <ref>` to pull the FULL thread (across all 3 boxes) + what he
 * learned about the counterparty, and judges the true state from the actual
 * conversation — never off the stale row.
 *
 * Usage:  node dealctx.js <style-code/ref>     e.g. dealctx.js DIS-26-3592
 */

const { execFileSync } = require('child_process');
const path = require('path');

const ref = process.argv[2];
if (!ref) { console.error('usage: dealctx <style-code / ref>'); process.exit(1); }
const dir = __dirname;

function run(script, args) {
  try {
    return execFileSync('node', [path.join(dir, script), ...args],
      { encoding: 'utf8', timeout: 90000 }).trim();
  } catch (e) { return `(${script} unavailable: ${(e.stderr || e.message || '').toString().slice(0, 200)})`; }
}

console.log(`=== DEAL CONTEXT — ${ref} ===\n`);
console.log('## FULL THREAD (all 3 boxes, oldest → newest — this is the truth, not the board row)');
console.log(run('graph.js', ['thread', ref]));
console.log('\n## WHAT YOU\'VE LEARNED about this counterparty (memory)');
console.log(run('brain.js', ['recall', ref]));
console.log('\n## JUDGE — before you nudge, answer these FROM THE THREAD ABOVE:');
console.log('- What was actually said last, by whom, and when? (quote it)');
console.log('- What is genuinely pending, and who really owes the next move RIGHT NOW?');
console.log('- Alive, dead, or waiting on them?');
console.log('  • real current action + ball truly on us  → ONE text: quote the last message + the exact next move + a ready draft.');
console.log('  • silent 2-3d+ and you cannot tell if it is dead  → ASK Sohan, quoting the last exchange. (Default to ASK when unsure.)');
console.log('  • already handled / waiting on them / dead  → stay silent (note it if dead).');
console.log('- NEVER nudge off the stale board row alone. The thread decides.');
