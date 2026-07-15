#!/usr/bin/env node
'use strict';

/**
 * Telegram channel: Telegram bot <-> Claude Code (headless).
 *
 *   node gateway.js <profile>        e.g. node gateway.js sohan
 *
 * One process per person; profile = persona + memory + config under
 * profiles/<name>/. See whatsapp.js for the WhatsApp channel.
 */

const { loadProfile, makeLog, createClaude, startScheduler } = require('./lib/core');
const oc = require('./lib/openclaw');

const { profile, profileDir, profileName } = loadProfile(__dirname, process.argv[2]);
const log = makeLog(profileName);

const token = process.env[profile.botTokenEnv];
if (!token) {
  console.error(`Missing bot token: set ${profile.botTokenEnv} in assistant/.env`);
  process.exit(1);
}
// Overridable for tests (test/e2e.js points this at a local mock).
const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const API = `${API_BASE}/bot${token}`;

const claude = createClaude({ profile, profileDir, log });

// ---------------------------------------------------------------------------
// Telegram helpers
// ---------------------------------------------------------------------------

async function tg(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description}`);
  return data.result;
}

// Telegram messages cap at 4096 chars; send as plain text (Claude's markdown
// often has unbalanced entities that break Telegram's parsers).
async function send(chatId, text) {
  const body = text && text.trim() ? text : '(no response)';
  for (let i = 0; i < body.length; i += 4000) {
    await tg('sendMessage', { chat_id: chatId, text: body.slice(i, i + 4000) });
  }
}

// Keep the "typing..." indicator alive while Claude thinks.
function typing(chatId) {
  const tick = () => tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  tick();
  const timer = setInterval(tick, 5000);
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

// One message at a time per chat; extras queue up in order.
const queues = new Map();

function enqueue(chatId, fn) {
  const prev = queues.get(chatId) || Promise.resolve();
  const next = prev.then(fn).catch((e) => log('handler error:', e.message));
  queues.set(chatId, next);
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const fromId = msg.from && msg.from.id;
  const text = (msg.text || '').trim();
  if (!text) return;

  const allowed = profile.allowedUserIds || [];
  if (allowed.length === 0) {
    // Setup mode: tell the owner their id so they can allowlist themselves.
    await send(
      chatId,
      `Hey! I'm not activated yet. Your Telegram user id is ${fromId}.\n\n` +
      `Add it to "allowedUserIds" in profiles/${profileName}/profile.json and restart me.`
    );
    return;
  }
  if (!allowed.includes(fromId)) {
    log(`ignoring message from unauthorized user ${fromId}`);
    return;
  }

  if (text === '/start' || text === '/help') {
    await send(
      chatId,
      `Hi ${profile.displayName}! I'm your assistant.\n\n` +
      `Just talk to me normally. Commands:\n` +
      `/new — start a fresh conversation\n` +
      `/id — show your Telegram user id`
    );
    return;
  }
  if (text === '/id') {
    await send(chatId, `Your Telegram user id: ${fromId}`);
    return;
  }
  if (text === '/new') {
    claude.resetSession(chatId);
    await send(chatId, 'Fresh start — what’s up?');
    return;
  }

  const stopTyping = typing(chatId);
  try {
    const res = await claude.ask(chatId, text);
    await send(chatId, res.ok ? res.text : `Something went wrong: ${res.error}`);
  } finally {
    stopTyping();
  }
}

// ---------------------------------------------------------------------------
// Long-poll loop
// ---------------------------------------------------------------------------

// In a Telegram DM, chat id == user id, so the first allowlisted user is
// where proactive messages (reminders, briefings) go.
const ownerChatId = () => (profile.allowedUserIds || [])[0];

async function main() {
  const me = await tg('getMe');
  log(`telegram gateway up for ${profile.displayName} — bot @${me.username}`);
  if ((profile.allowedUserIds || []).length === 0) {
    log('SETUP MODE: no allowedUserIds yet. Message the bot to get your id.');
  }

  startScheduler({
    profile,
    profileDir,
    log,
    sendToOwner: (text) => {
      const chatId = ownerChatId();
      if (chatId) return send(chatId, text);
    },
    runScheduled: (prompt, opts = {}) => {
      const chatId = ownerChatId();
      if (!chatId) return;
      enqueue(chatId, async () => {
        const stopTyping = typing(chatId);
        try {
          // Fresh session: persona + memory still load via the profile dir.
          const res = await claude.runClaude(prompt, undefined);
          if (!res.ok) {
            if (opts.silentErrors) log('scheduled run failed silently:', res.error);
            else await send(chatId, `Scheduled task failed: ${res.error}`);
            return;
          }
          let outText = res.text;
          if (opts.suppressIf) {
            const { shouldSkip, text } = oc.stripSilentToken(res.text, opts.suppressIf);
            if (shouldSkip) { log('heartbeat: nothing to report'); return; }
            outText = text;
          }
          if (res.notice) outText = `${res.notice}\n${outText}`;
          await send(chatId, outText);
        } finally {
          stopTyping();
        }
      });
    },
  });

  let offset = 0;
  for (;;) {
    try {
      const updates = await tg('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message'],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) enqueue(u.message.chat.id, () => handleMessage(u.message));
      }
    } catch (e) {
      log('poll error (retrying in 5s):', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
