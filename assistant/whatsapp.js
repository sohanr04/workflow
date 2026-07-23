#!/usr/bin/env node
'use strict';

/**
 * WhatsApp channel: your own number <-> Claude Code (headless).
 *
 * Links to your WhatsApp account as a device (same mechanism as WhatsApp
 * Web) via QR code. You talk to your agent in WhatsApp's "Message
 * Yourself" chat; optionally allowlist other numbers too.
 *
 *   npm install            (once, in assistant/)
 *   node whatsapp.js <profile>
 *
 * profile.json options (under "whatsapp"):
 *   selfChat    — reply in your own Message Yourself chat (default true)
 *   allowFrom   — other numbers allowed to talk to the agent, E.164
 *   replyPrefix — marker on agent replies, also the self-loop guard
 */

const path = require('path');
const { loadProfile, makeLog, createClaude, startScheduler } = require('./lib/core');
const { startEventPoller, newBuyerEvents, newSupplierEvents } = require('./scripts/eventpoll');
const oc = require('./lib/openclaw');

let baileys;
let qrcode;
try {
  baileys = require('@whiskeysockets/baileys');
  qrcode = require('qrcode-terminal');
} catch {
  console.error('Missing dependencies. Run:  cd assistant && npm install');
  process.exit(1);
}
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  jidNormalizedUser,
  Browsers,
} = baileys;

const { profile, profileDir, profileName } = loadProfile(__dirname, process.argv[2]);
const log = makeLog(`${profileName}:wa`);
const wa = profile.whatsapp || {};

// The prefix marks agent replies. It doubles as the loop guard: in the
// self-chat every message is "from me", so the agent must never respond to
// messages carrying its own prefix.
const PREFIX = wa.replyPrefix || '🤖';
const digits = (s) => String(s || '').replace(/\D/g, '');
const allowFrom = (wa.allowFrom || []).map(digits);

const claude = createClaude({
  profile,
  profileDir,
  sessionsFileName: 'sessions-whatsapp.json',
  log,
});

// One message at a time per chat; extras queue in order.
const queues = new Map();
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  queues.set(key, prev.then(fn).catch((e) => log('handler error:', e.message)));
}

function extractText(m) {
  const msg = m.message || {};
  return (
    msg.conversation ||
    (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
    (msg.imageMessage && msg.imageMessage.caption) ||
    ''
  ).trim();
}

let schedulerStarted = false;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(profileDir, 'state', 'whatsapp-auth')
  );
  // Negotiate the current WhatsApp Web protocol version — connecting with a
  // stale hardcoded version is the classic cause of instant 405 failures.
  const { version } = await fetchLatestBaileysVersion();
  log(`using WhatsApp Web protocol v${version.join('.')}`);
  // Quiet Baileys' internal JSON debug logging; our own log lines remain.
  let logger;
  // WA_LOG=warn (or debug) un-silences the Baileys internals — decrypt/session
  // errors are otherwise swallowed, which makes "connected but deaf" invisible.
  try { logger = require('pino')({ level: process.env.WA_LOG || 'silent' }); } catch { /* default logger */ }
  const sock = makeWASocket({
    auth: state,
    version,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    logger,
  });
  sock.ev.on('creds.update', saveCreds);

  // WhatsApp can address the self ("Message Yourself") chat by phone-number
  // jid OR by LID alias depending on account age/privacy settings — accept
  // both, or Alfred goes silent for LID-routed accounts.
  let selfJid = null;
  const selfIds = new Set();
  // The LID alias is only populated on sock.user shortly AFTER the
  // connection opens, so re-collect identities whenever we need them.
  const refreshSelfIds = () => {
    if (!sock.user) return;
    if (sock.user.id) selfIds.add(jidNormalizedUser(sock.user.id));
    if (sock.user.lid) selfIds.add(jidNormalizedUser(sock.user.lid));
  };
  const sendTo = (jid, text) =>
    sock.sendMessage(jid, { text: `${PREFIX} ${text && text.trim() ? text : '(no response)'}` });

  sock.ev.on('connection.update', (u) => {
    if (u.qr) {
      log('Link this device: WhatsApp → Settings → Linked devices → Link a device');
      qrcode.generate(u.qr, { small: true });
    }
    if (u.connection === 'open') {
      selfJid = jidNormalizedUser(sock.user.id);
      refreshSelfIds();
      log(`linked as ${[...selfIds].join(' / ')} — message yourself on WhatsApp to talk to the agent`);
      if (!schedulerStarted) {
        schedulerStarted = true;
        // shared spawn→strip→send used by BOTH the cron scheduler and the event
        // poller: enqueue a Winston turn, drop a bare HEARTBEAT_OK, send the rest.
        const runAndSend = (prompt, opts = {}) => {
          if (!selfJid) return;
          enqueue(selfJid, async () => {
            const res = await claude.runClaude(prompt, undefined);
            if (!res.ok) {
              if (opts.silentErrors) log(`${opts.label || 'scheduled'} run failed silently:`, res.error);
              else await sendTo(selfJid, `Task failed: ${res.error}`);
              return;
            }
            let outText = res.text;
            if (opts.suppressIf) {
              const { shouldSkip, text } = oc.stripSilentToken(res.text, opts.suppressIf);
              if (shouldSkip) { log(`${opts.label || 'heartbeat'}: nothing to report`); return; }
              outText = text;
            }
            if (res.notice) outText = `${res.notice}\n${outText}`;
            await sendTo(selfJid, outText);
          });
        };
        startScheduler({
          profile, profileDir, log,
          sendToOwner: (text) => selfJid && sendTo(selfJid, text),
          runScheduled: (prompt, opts = {}) => runAndSend(prompt, opts),
        });
        // Phase 5 — INSTANT updates within ~60s, both sides of the deal.
        const bookFile = path.join(profileDir, 'memory', 'book.json');
        // BUYER side: a reply lands in the relay's buyer_events.
        startEventPoller({
          intervalMs: 60000, log, label: 'buyer-poller',
          stateFile: path.join(profileDir, 'state', 'eventpoll.json'),
          source: (since) => newBuyerEvents(since, 15),
          onEvent: (ev) => runAndSend(
            `INSTANT UPDATE — a buyer just replied. ${ev.buyer} on ${ev.ref} [${ev.replyType}]${ev.snippet ? `: "${ev.snippet}"` : ''}. Run \`node ../../scripts/status.js ${ev.ref}\` to read the LIVE thread, update your context (write a signal if it's an accept/drop), then text Sohan 1–2 tight lines: what just happened + whose move it is now. CONTEXT, not a price — he runs the negotiation. If there's genuinely nothing to flag, reply HEARTBEAT_OK.`,
            { suppressIf: 'HEARTBEAT_OK', label: 'buyer-event', silentErrors: true }
          ),
        });
        // FACTORY side: a supplier emails spr@/china@ under the SP/GBT code —
        // mapped back to the DIS deal by shared core. Catches "sold"/kills instantly
        // (the Scott SP83314-WY case) so Sohan never has to map it by hand.
        startEventPoller({
          intervalMs: 90000, log, label: 'factory-poller',
          stateFile: path.join(profileDir, 'state', 'supplierpoll.json'),
          source: (since) => newSupplierEvents(since, bookFile),
          onEvent: (ev) => runAndSend(
            `INSTANT UPDATE — the SUPPLIER emailed on ${ev.supplierCode} → deal ${ev.ref}${ev.snippet ? `: "${ev.snippet}"` : ''}.${ev.kill ? ' Looks like a KILL — stock sold/gone.' : ''} Run \`node ../../scripts/status.js ${ev.ref}\` to read the live thread (both legs), update context — if the factory KILLED the stock write a DROP signal + note (do NOT auto-close, flag it for Sohan) — then text Sohan 1–2 lines: what the factory said + what it means (dead → re-source / new cost / moving). CONTEXT, not a directive. If nothing material, HEARTBEAT_OK.`,
            { suppressIf: 'HEARTBEAT_OK', label: 'factory-event', silentErrors: true }
          ),
        });
      }
    }
    if (u.connection === 'close') {
      const err = u.lastDisconnect && u.lastDisconnect.error;
      const code = err && err.output && err.output.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log('logged out — delete profiles/' + profileName + '/state/whatsapp-auth and re-link');
        process.exit(1);
      }
      log(`connection closed (status ${code || 'unknown'}): ${err ? err.message : 'no error detail'}`);
      if (code === 405 || code === 403) {
        log('HINT: a 405/403 here usually means the Baileys library is outdated for');
        log('WhatsApp\'s current protocol — run "npm update" in assistant/ and retry.');
      }
      log('reconnecting in 3s...');
      setTimeout(() => start().catch((e) => log('reconnect failed:', e.message)), 3000);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // Log EVERY upsert (any type) so a message can never arrive invisibly —
    // if WhatsApp routes self-chat as 'append' instead of 'notify', this is
    // how we find out.
    log(`upsert type=${type} n=${messages.length} jids=${messages.map((m) => m.key && m.key.remoteJid).join(',')}`);
    if (type !== 'notify') return;
    refreshSelfIds();
    for (const m of messages) {
      const jid = m.key && m.key.remoteJid;
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue; // DMs only
      const text = extractText(m);
      const isSelfChat = selfIds.has(jidNormalizedUser(jid));
      log(`inbound: jid=${jid} fromMe=${!!m.key.fromMe} selfChat=${isSelfChat} text="${text.slice(0, 40)}"`);
      if (!text || text.startsWith(PREFIX)) continue; // empty, or our own reply
      if (isSelfChat) {
        if (wa.selfChat === false) continue;
      } else {
        // Never answer on your behalf in other people's chats: messages YOU
        // send to others are ignored, and inbound senders need allowlisting.
        if (m.key.fromMe) continue;
        if (!allowFrom.includes(digits(jid.split('@')[0]))) continue;
      }

      enqueue(jid, async () => {
        if (text === '/new') {
          claude.resetSession(jid);
          await sendTo(jid, 'Fresh start — what’s up?');
          return;
        }
        // Keep "typing…" alive for the WHOLE task. WhatsApp's indicator expires
        // in ~10s, so without refreshing, a 60–120s job looks dead right when
        // Sohan starts to worry. Plus one "still on it" ping for long jobs so
        // he can always SEE Winston is working, not crashed.
        await sock.sendPresenceUpdate('composing', jid).catch(() => {});
        let ticks = 0;
        const typing = setInterval(() => {
          sock.sendPresenceUpdate('composing', jid).catch(() => {});
          if (++ticks === 4) sendTo(jid, 'still on it — reading the boxes, hang tight ⏳').catch(() => {}); // ~32s in
        }, 8000);
        let res;
        try { res = await claude.ask(jid, text); }
        finally { clearInterval(typing); await sock.sendPresenceUpdate('paused', jid).catch(() => {}); }
        await sendTo(jid, res.ok ? res.text : `Something went wrong: ${res.error}`);
      });
    }
  });
}

start().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
