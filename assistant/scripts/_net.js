'use strict';

/**
 * _net.js — network hardening shared by Winston's readers (graph.js, deals.js).
 *
 * Symptom this fixes: intermittent `fetch failed` in waves, worse from the
 * pm2/gateway process than a plain shell. Root cause is IPv6/IPv4 selection
 * (Node picks a dead IPv6 route and the connect times out). Fix = Happy
 * Eyeballs (try both families in parallel) + retry on transient errors.
 *
 * Additive only. Does NOT touch auth, creds, or token caching.
 */

// 1) Happy Eyeballs globally — the actual root fix. Built into Node (18.18+/20+),
//    applies to fetch/undici too. Wrapped so an older Node can't crash on it.
try { require('net').setDefaultAutoSelectFamily(true); } catch { /* older node */ }

// 2) Optional undici keepalive Agent with a connect timeout. Node bundles
//    undici for fetch but only exposes `require('undici')` when it's installed,
//    so this is best-effort — if absent, the autoSelectFamily above still holds.
try {
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({
    connect: { timeout: 10000, autoSelectFamily: true },
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 60000,
  }));
} catch { /* undici not installed — fine */ }

const TRANSIENT = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'ENETUNREACH',
  'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT',
]);

function isTransient(e) {
  if (!e) return false;
  const code = e.code || (e.cause && e.cause.code) || '';
  return String(e.message || '').includes('fetch failed') || TRANSIENT.has(code);
}

// Retry wrapper: up to `tries` attempts, 200ms→2s backoff, retrying transient
// network errors and 5xx/429. Non-transient errors throw immediately. On final
// exhaustion, re-throws the last error (caller surfaces .cause).
async function retryFetch(url, opts, { tries = 5, base = 200 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status >= 500 || res.status === 429) {
        last = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (e) {
      last = e;
      if (!isTransient(e)) throw e;
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, Math.min(base * 2 ** i, 2000)));
  }
  throw last;
}

module.exports = { retryFetch, isTransient };
