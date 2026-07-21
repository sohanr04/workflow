#!/usr/bin/env node
'use strict';

/**
 * draft.js — save a ready-to-send draft into the spr@ Outlook DRAFTS folder.
 *
 * DELIBERATE LIMITS (the guardrail is this file):
 *   - Creates DRAFTS ONLY. There is NO send call anywhere in this file — the
 *     Graph /send and /sendMail endpoints are never referenced. Sohan reviews
 *     in Outlook and presses send himself.
 *   - FROM is hardcoded to spr@ — the only box Winston may draft in.
 *   - The identity wall is enforced in code: a draft whose recipients mix a
 *     supplier domain with a buyer (non-supplier external) domain is REFUSED.
 *
 * Mirrors the relay's own draft-mode behaviour (factory.ts drafts into spr@
 * Drafts as new "RE: <subject>" messages — threading via subject, which is how
 * the team already works).
 *
 * Usage (from profiles/sohan/):
 *   node ../../scripts/draft.js "RE: DIS-26-3964 · Men's Padded Vest" \
 *        --to leciao@choiceclothing.co.za --cc auto --body "Hi Lecia, ..."
 *   --cc auto  = the team CC per protocol (Parker, Joyce, Kylie)
 *   --body -   = read the body from stdin (for long drafts)
 */

const { getToken } = require('./graph');
const { retryFetch } = require('./_net');

const FROM_BOX = 'spr@grandempirehk.com'; // hardcoded — the only draftable box
const TEAM_CC = ['Mpr@grandempirehk.com', 'joyce-wong@grandempirehk.com', 'Kylie-yan@grandempirehk.com'];
const US = ['grandempirehk.com', 'district-stock.com'];
const SUPPLIER_DOMAINS = new Set([
  'stockpapa.cn', 'gbestgarment.com', 'tailormax.com', 'bentagarment.com',
  'wintopstock.com', 'royalgarment.cn', 'wellroyalgarment.com', 'hpromise.cn',
]);
const dom = (a) => String(a || '').toLowerCase().split('@')[1] || '';
const isUs = (a) => US.some((d) => dom(a).endsWith(d));
const isSupplier = (a) => !isUs(a) && (SUPPLIER_DOMAINS.has(dom(a)) || dom(a).endsWith('.cn'));

function die(m) { console.error('draft.js: ' + m); process.exit(1); }
function flag(args, name) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : undefined; }

(async () => {
  const args = process.argv.slice(2);
  const subject = args[0];
  if (!subject || subject.startsWith('--')) die('usage: draft.js "<subject>" --to a@b[,c@d] --cc auto|x@y[,..] --body "..." (or --body - for stdin)');
  const to = (flag(args, 'to') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!to.length) die('missing --to');
  let cc = (flag(args, 'cc') || 'auto');
  cc = cc === 'none' ? []
    : cc === 'auto' || cc === ''
      ? TEAM_CC.filter((a) => !to.some((t) => t.toLowerCase() === a.toLowerCase()))
      : cc.split(',').map((s) => s.trim()).filter(Boolean);
  let body = flag(args, 'body');
  if (body === '-' || body === undefined) { try { body = require('fs').readFileSync(0, 'utf8'); } catch { body = ''; } }
  body = String(body || '').trim();
  if (!body) die('missing --body');

  // ── the identity wall, enforced in code ────────────────────────────────────
  const all = [...to, ...cc];
  const hasSupplier = all.some(isSupplier);
  const hasBuyer = all.some((a) => !isUs(a) && !isSupplier(a));
  if (hasSupplier && hasBuyer) die('REFUSED: recipients mix a supplier with a buyer — a supplier must never appear on a buyer email (identity wall).');
  if (all.some((a) => /^(mpr|npr)@grandempirehk\.com$/i.test(a) && false)) { /* Parker on CC is allowed per protocol */ }

  // plain text → simple HTML paragraphs (keeps Outlook formatting clean)
  const html = body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

  const tok = await getToken();
  const res = await retryFetch(`https://graph.microsoft.com/v1.0/users/${FROM_BOX}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: to.map((a) => ({ emailAddress: { address: a } })),
      ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
    }),
  });
  const j = await res.json();
  if (!res.ok || j.error) die(`Graph refused (${res.status}): ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 200)}`);
  // POST /messages creates the message IN THE DRAFTS FOLDER (isDraft: true). Not sent.
  console.log(`✓ DRAFT saved to ${FROM_BOX} → Drafts (not sent)`);
  console.log(`  subject: ${j.subject}`);
  console.log(`  to: ${to.join(', ')}`);
  console.log(`  cc: ${cc.join(', ') || '(none)'}`);
  console.log(`  → open Outlook → Drafts → review → YOU press send.`);
})().catch((e) => die(e.message));
