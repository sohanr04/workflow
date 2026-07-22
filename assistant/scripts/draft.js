#!/usr/bin/env node
'use strict';

/**
 * draft.js — save a ready-to-send buyer/factory reply into the spr@ DRAFTS
 * folder, the way the relay does it: THREADED onto the real message and with
 * the offer PHOTOS re-attached.
 *
 * DELIBERATE LIMITS (the guardrail is this file):
 *   - Creates DRAFTS ONLY. There is NO send call anywhere in this file — the
 *     Graph /send and /sendMail endpoints are never referenced. Sohan reviews
 *     in Outlook and presses send himself.
 *   - FROM is hardcoded to spr@ — the only box Winston may draft in.
 *   - Identity wall in code: a draft whose recipients mix a supplier domain
 *     with a buyer (non-supplier external) domain is REFUSED.
 *
 * Two things it does that the old version didn't (Sohan, 2026-07-22 — "he
 * doesn't reply on the right threads and add attachments"):
 *   1. THREADING — with --reply-to <messageId>, it uses Graph `createReply` on
 *      the spr@ copy of that message, so the draft is a real reply (same
 *      conversation, quoted history) not a fresh "RE:" that starts a new thread.
 *      Strictly better than the relay, which is subject-only. Falls back to a
 *      fresh "RE:" draft if the id isn't in spr@ (says so).
 *   2. PHOTOS — with --photos <REF>, it finds the DIS blast in districtstock@
 *      Sent Items by ref and re-attaches its product images to the draft, EXACTLY
 *      as the relay's sentOfferPhotos() does (mirrors lib/factory.ts).
 *
 * Usage (from profiles/sohan/):
 *   node ../../scripts/draft.js --reply-to <buyerMsgId> --to leciao@choiceclothing.co.za \
 *        --cc auto --photos DIS-80553-LLJ --body "Hi Lecia, ..."
 *   node ../../scripts/draft.js "RE: DIS-... · Product" --to a@b --cc auto --body "..."  (no thread)
 *   --cc auto   = team CC per protocol (Parker, Joyce, Kylie)
 *   --body -    = read the body from stdin
 *   --photos X  = re-attach the DIS-X blast's product photos (like the relay)
 *   --attach-from <id> [--attach-box spr|china|dis] = also copy images off another message
 */

const { getToken, BOXES } = require('./graph');
const { retryFetch } = require('./_net');

const FROM_BOX = 'spr@grandempirehk.com'; // hardcoded — the only draftable box
const OUTBOUND = BOXES.dis || 'empire-districtstock@grandempirehk.com'; // where blasts are Sent
const TEAM_CC = ['Mpr@grandempirehk.com', 'joyce-wong@grandempirehk.com', 'Kylie-yan@grandempirehk.com'];
const US = ['grandempirehk.com', 'district-stock.com'];
const SUPPLIER_DOMAINS = new Set([
  'stockpapa.cn', 'gbestgarment.com', 'tailormax.com', 'bentagarment.com',
  'wintopstock.com', 'royalgarment.cn', 'wellroyalgarment.com', 'hpromise.cn',
]);
const dom = (a) => String(a || '').toLowerCase().split('@')[1] || '';
const isUs = (a) => US.some((d) => dom(a).endsWith(d));
const isSupplier = (a) => !isUs(a) && (SUPPLIER_DOMAINS.has(dom(a)) || dom(a).endsWith('.cn'));

const IMG_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
function imageMimeFor(name, contentType) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (IMG_MIME[ext]) return IMG_MIME[ext];
  if (/^image\//i.test(contentType || '')) return contentType;
  return null;
}

function die(m) { console.error('draft.js: ' + m); process.exit(1); }
function flag(args, name) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : undefined; }

const GBASE = 'https://graph.microsoft.com/v1.0';
async function gGet(url, tok) {
  const r = await retryFetch(GBASE + url, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GET ${url} → ${r.status} ${(j.error && j.error.message) || ''}`.slice(0, 160));
  return j;
}
async function gPost(url, tok, bodyObj) {
  const r = await retryFetch(GBASE + url, {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`POST ${url} → ${r.status} ${(j.error && j.error.message) || ''}`.slice(0, 160));
  return j;
}
async function gPatch(url, tok, bodyObj) {
  const r = await retryFetch(GBASE + url, {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`PATCH ${url} → ${r.status} ${(j.error && j.error.message) || ''}`.slice(0, 160)); }
}

// pull the product photos off a message (image fileAttachments only) — mirrors
// the relay's sentOfferPhotos(): listAttachments → image mime → contentBytes.
async function imagesFrom(box, msgId, tok) {
  const j = await gGet(`/users/${box}/messages/${msgId}/attachments`, tok);
  const out = [];
  for (const a of j.value || []) {
    if (a['@odata.type'] && !/fileAttachment/i.test(a['@odata.type'])) continue;
    const mime = imageMimeFor(a.name, a.contentType);
    if (!mime || !a.contentBytes) continue;
    out.push({ name: a.name, contentType: mime, contentBytes: a.contentBytes });
  }
  return out;
}

// find the latest spr@ message carrying this ref — the thread to reply INTO.
// Winston always knows the ref; he shouldn't have to dig out a raw message id.
async function threadMsgForRef(ref, tok) {
  const q = encodeURIComponent(`"${ref}"`);
  const j = await gGet(`/users/${FROM_BOX}/messages?$search=${q}&$select=id,subject,receivedDateTime&$top=10`, tok);
  const msgs = (j.value || []).sort((a, b) => (b.receivedDateTime || '').localeCompare(a.receivedDateTime || ''));
  return msgs[0] ? msgs[0].id : null;
}

// find the DIS blast for a ref in districtstock@ Sent Items and return its photos
// (the same source the relay re-attaches from).
async function blastPhotos(ref, tok) {
  const q = encodeURIComponent(`"${ref}"`);
  const j = await gGet(`/users/${OUTBOUND}/mailFolders/sentitems/messages?$search=${q}&$select=id,subject&$top=5`, tok);
  const msgs = j.value || [];
  // prefer OUR outgoing offer (not an RE:/FW: riding the same code)
  const m = msgs.find((v) => !/^(re|fw|fwd):/i.test(v.subject || '')) || msgs[0];
  if (!m) return { photos: [], subject: null };
  return { photos: await imagesFrom(OUTBOUND, m.id, tok), subject: m.subject || null };
}

(async () => {
  const args = process.argv.slice(2);
  let replyTo = flag(args, 'reply-to');
  const replyRef = flag(args, 'reply-ref');
  let subject = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  if (!subject && !replyTo && !replyRef) die('usage: draft.js "<subject>" | --reply-ref DIS-XXX | --reply-to <msgId> ... --to a@b --cc auto --body "..." [--photos DIS-REF]');

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

  // ── identity wall, enforced in code ─────────────────────────────────────────
  const all = [...to, ...cc];
  if (all.some(isSupplier) && all.some((a) => !isUs(a) && !isSupplier(a))) {
    die('REFUSED: recipients mix a supplier with a buyer — a supplier must never appear on a buyer email (identity wall).');
  }

  const html = body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  const tok = await getToken();

  // ── resolve --reply-ref → the spr@ thread message id (Winston passes the ref) ─
  let refNote = '';
  if (replyRef && !replyTo) {
    try {
      replyTo = await threadMsgForRef(replyRef.toUpperCase(), tok);
      if (!replyTo) refNote = ` — ⚠️ no spr@ message found for ${replyRef} to thread onto; saved fresh`;
    } catch (e) { refNote = ` — ⚠️ thread lookup failed (${e.message.slice(0, 50)})`; }
  }

  // ── gather photos to re-attach (like the relay) ────────────────────────────
  let photos = [];
  let photoNote = '';
  const photosRef = flag(args, 'photos') || replyRef; // default to the reply ref
  if (photosRef) {
    try { const bp = await blastPhotos(photosRef.toUpperCase(), tok); photos = bp.photos; }
    catch (e) { photoNote = ` (photo lookup failed: ${e.message.slice(0, 60)})`; }
  }
  const attachFrom = flag(args, 'attach-from');
  if (attachFrom) {
    const abox = BOXES[flag(args, 'attach-box') || 'spr'] || flag(args, 'attach-box') || FROM_BOX;
    try { photos = photos.concat(await imagesFrom(abox, attachFrom, tok)); }
    catch (e) { photoNote += ` (attach-from failed: ${e.message.slice(0, 60)})`; }
  }

  // ── create the draft: threaded reply if we can, else a fresh "RE:" ──────────
  let draftId, threaded = false, threadNote = '';
  if (replyTo) {
    try {
      // createReply on the spr@ copy → a real threaded reply draft, from spr@
      const rep = await gPost(`/users/${FROM_BOX}/messages/${replyTo}/createReply`, tok, {});
      draftId = rep.id;
      const cur = await gGet(`/users/${FROM_BOX}/messages/${draftId}?$select=body`, tok);
      const quoted = (cur.body && cur.body.content) || '';
      await gPatch(`/users/${FROM_BOX}/messages/${draftId}`, tok, {
        toRecipients: to.map((a) => ({ emailAddress: { address: a } })),
        ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
        body: { contentType: 'HTML', content: html + quoted }, // our note above the quoted thread
      });
      threaded = true;
    } catch (e) {
      threadNote = ` — ⚠️ couldn't thread (${e.message.slice(0, 70)}); saved as a fresh RE: draft instead`;
    }
  }
  if (!draftId) {
    if (!subject && replyRef) subject = `RE: ${replyRef}`; // sane fallback if the thread wasn't found
    if (!subject) die('--reply-to failed and no fallback subject given — pass "<subject>" as the first arg too');
    const fresh = await gPost(`/users/${FROM_BOX}/messages`, tok, {
      subject, body: { contentType: 'HTML', content: html },
      toRecipients: to.map((a) => ({ emailAddress: { address: a } })),
      ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
    });
    draftId = fresh.id;
  }

  // ── attach the photos to the draft ─────────────────────────────────────────
  let attached = 0;
  for (const p of photos) {
    try {
      await gPost(`/users/${FROM_BOX}/messages/${draftId}/attachments`, tok, {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: p.name, contentType: p.contentType, contentBytes: p.contentBytes,
      });
      attached++;
    } catch { /* skip a photo that fails to attach */ }
  }

  console.log(`✓ DRAFT saved to ${FROM_BOX} → Drafts (not sent)${threadNote}${refNote}`);
  console.log(`  ${threaded ? 'THREADED reply onto the buyer\'s message' : 'fresh message'}${threaded ? '' : ` · subject: ${subject}`}`);
  console.log(`  to: ${to.join(', ')}`);
  console.log(`  cc: ${cc.join(', ') || '(none)'}`);
  console.log(`  photos re-attached: ${attached}${photos.length && attached < photos.length ? `/${photos.length}` : ''}${photoNote}`);
  console.log(`  → open Outlook → Drafts → review → YOU press send.`);
})().catch((e) => die(e.message));
