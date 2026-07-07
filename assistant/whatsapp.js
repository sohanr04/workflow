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
  try { logger = require('pino')({ level: 'error' }); } catch { /* default logger */ }
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
  const sendTo = (jid, text) =>
    sock.sendMessage(jid, { text: `${PREFIX} ${text && text.trim() ? text : '(no response)'}` });

  sock.ev.on('connection.update', (u) => {
    if (u.qr) {
      log('Link this device: WhatsApp → Settings → Linked devices → Link a device');
      qrcode.generate(u.qr, { small: true });
    }
    if (u.connection === 'open') {
      selfJid = jidNormalizedUser(sock.user.id);
      selfIds.add(selfJid);
      if (sock.user.lid) selfIds.add(jidNormalizedUser(sock.user.lid));
      log(`linked as ${[...selfIds].join(' / ')} — message yourself on WhatsApp to talk to the agent`);
      if (!schedulerStarted) {
        schedulerStarted = true;
        startScheduler({
          profile,
          profileDir,
          log,
          sendToOwner: (text) => selfJid && sendTo(selfJid, text),
          runScheduled: (prompt) => {
            if (!selfJid) return;
            enqueue(selfJid, async () => {
              const res = await claude.runClaude(prompt, undefined);
              await sendTo(selfJid, res.ok ? res.text : `Scheduled task failed: ${res.error}`);
            });
          },
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
    if (type !== 'notify') return;
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
        await sock.sendPresenceUpdate('composing', jid).catch(() => {});
        const res = await claude.ask(jid, text);
        await sendTo(jid, res.ok ? res.text : `Something went wrong: ${res.error}`);
      });
    }
  });
}

start().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
