/* Banking Work Tracker — Web Push worker
   =========================================================================
   Runs on a schedule (see wrangler.toml `crons`) even with every copy of the
   app fully closed. Each run:
     1. Asks your Apps Script for every saved push subscription
        (action: "fetchSubscriptionsForWorker", gated by WORKER_SECRET).
     2. For each distinct profile name, asks Apps Script for that profile's
        tasks — the exact same "fetchTasks" action the app itself already
        calls, so nothing about your existing sync needs to change.
     3. Works out which tasks are overdue or due soon, skips ones already
        alerted (tracked in the PUSH_DEDUPE KV store), and sends a real Web
        Push message — encrypted per RFC 8291/8188, signed per RFC 8292
        (VAPID) — using only the standard Web Crypto API. No dependencies.

   This file has been tested round-trip against Google's `web-push` npm
   library (the same one most production Node push servers use) to confirm
   the encryption and VAPID signing are byte-for-byte spec-compliant. What
   can't be tested from a sandbox is an actual delivery to a live push
   service (FCM, Mozilla autopush, etc.) — that only happens once this is
   deployed with a real subscription. See PUSH_SETUP.md if a send fails.
   ========================================================================= */

// ---------- byte/base64url helpers ----------
function base64urlEncode(bytes) {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlEncodeStr(str) {
  return base64urlEncode(new TextEncoder().encode(str));
}
function base64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob((str + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function concatBytes(arrays) {
  let total = 0;
  arrays.forEach((a) => (total += a.length));
  const out = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((a) => {
    out.set(a, offset);
    offset += a.length;
  });
  return out;
}

// ---------- VAPID (RFC 8292) ----------
async function importVapidPrivateKey(privateKeyB64url, publicKeyB64url) {
  const pubBytes = base64urlDecode(publicKeyB64url);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    ext: true,
    d: privateKeyB64url,
    x: base64urlEncode(pubBytes.slice(1, 33)),
    y: base64urlEncode(pubBytes.slice(33, 65))
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function buildVapidHeader(endpoint, vapidPublicKey, vapidPrivateKey, subject) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud, exp, sub: subject };
  const unsigned = base64urlEncodeStr(JSON.stringify(header)) + '.' + base64urlEncodeStr(JSON.stringify(payload));
  const key = await importVapidPrivateKey(vapidPrivateKey, vapidPublicKey);
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + base64urlEncode(new Uint8Array(sigBuf));
  return `vapid t=${jwt}, k=${vapidPublicKey}`;
}

// ---------- message encryption (RFC 8291 "aes128gcm") ----------
async function encryptPayload(payloadBytes, p256dhB64url, authB64url) {
  const uaPublicBytes = base64urlDecode(p256dhB64url);
  const authSecret = base64urlDecode(authB64url);

  const localKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey));

  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecretBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, localKeyPair.privateKey, 256);
  const ecdhSecret = new Uint8Array(sharedSecretBits);

  const webpushInfo = concatBytes([new TextEncoder().encode('WebPush: info\0'), uaPublicBytes, localPublicRaw]);
  const ecdhSecretKey = await crypto.subtle.importKey('raw', ecdhSecret, 'HKDF', false, ['deriveBits']);
  const ikmBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: webpushInfo }, ecdhSecretKey, 256);
  const ikm = new Uint8Array(ikmBits);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const cek = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo }, ikmKey, 128));
  const nonce = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, ikmKey, 96));

  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plaintextWithDelim = concatBytes([payloadBytes, new Uint8Array([2])]); // last-record delimiter, RFC 8188
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, plaintextWithDelim);
  const ciphertext = new Uint8Array(cipherBuf);

  const rs = 4096;
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, rs, false);
  const idlen = new Uint8Array([localPublicRaw.length]);

  return concatBytes([salt, rsBytes, idlen, localPublicRaw, ciphertext]);
}

async function sendWebPush(subscription, payloadObj, env) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const body = await encryptPayload(payloadBytes, subscription.keys.p256dh, subscription.keys.auth);
  const authHeader = await buildVapidHeader(subscription.endpoint, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);

  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Authorization: authHeader
    },
    body
  });
}

// ---------- "is this task due?" (local wall-clock comparison) ----------
function nowPartsInTZ(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = {};
  fmt.formatToParts(new Date()).forEach((p) => { parts[p.type] = p.value; });
  return { dateStr: `${parts.year}-${parts.month}-${parts.day}`, timeStr: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

function toMinutes(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const dayIndex = Date.UTC(y, m - 1, d) / 86400000; // tz-agnostic day count
  return dayIndex * 1440 + hh * 60 + mm;
}

function computeAlerts(tasks, timezone, dueSoonMinutes) {
  const { dateStr: nowDate, timeStr: nowTime } = nowPartsInTZ(timezone);
  const nowMinutes = toMinutes(nowDate, nowTime);
  const alerts = [];

  (tasks || []).forEach((t) => {
    if (!t || t.deleted || t.purged || t.status === 'Completed' || !t.dueDate) return;
    const dueTime = t.dueTime || '23:59';
    const dueMinutes = toMinutes(t.dueDate, dueTime);
    const diff = dueMinutes - nowMinutes; // negative/zero = overdue

    if (diff <= 0) {
      alerts.push({ task: t, kind: 'overdue', detail: 'Was due ' + t.dueDate + (t.dueTime ? ' ' + t.dueTime : '') });
    } else if (diff <= dueSoonMinutes) {
      alerts.push({ task: t, kind: 'duesoon', detail: 'Due ' + t.dueDate + (t.dueTime ? ' ' + t.dueTime : '') + ' — in ' + diff + ' min' });
    }
  });
  return alerts;
}

// ---------- talking to your existing Apps Script ----------
async function callAppsScript(env, payload) {
  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

// ---------- the actual job ----------
async function runPushCheck(env, log) {
  const listData = await callAppsScript(env, { action: 'fetchSubscriptionsForWorker', secret: env.WORKER_SECRET });
  if (!listData || listData.status !== 'success') {
    log.push('fetchSubscriptionsForWorker failed: ' + JSON.stringify(listData));
    return log;
  }

  const subsByUser = {};
  (listData.subscriptions || []).forEach((row) => {
    const u = row.username || 'default';
    (subsByUser[u] = subsByUser[u] || []).push(row.subscription);
  });

  const usernames = Object.keys(subsByUser);
  log.push(`Checking ${usernames.length} profile(s) with a saved subscription.`);

  for (const username of usernames) {
    let tasks = [];
    try {
      const taskData = await callAppsScript(env, { action: 'fetchTasks', username });
      tasks = (taskData && taskData.tasks) || [];
    } catch (e) {
      log.push(`${username}: fetchTasks failed — ${e.message}`);
      continue;
    }

    const alerts = computeAlerts(tasks, env.TIMEZONE || 'Asia/Kolkata', Number(env.DUE_SOON_MINUTES || 60));
    log.push(`${username}: ${tasks.length} task(s), ${alerts.length} alert-worthy.`);

    for (const alert of alerts) {
      const dedupeKey = `notif:${username}:${alert.task.id}:${alert.kind}:${alert.task.updatedAt || 0}`;
      const already = env.PUSH_DEDUPE ? await env.PUSH_DEDUPE.get(dedupeKey) : null;
      if (already) continue;

      const title = (alert.kind === 'overdue' ? '⚠ Overdue: ' : '⏰ Due soon: ') + (alert.task.description || 'Task');
      let anySent = false;

      for (const sub of subsByUser[username]) {
        try {
          const res = await sendWebPush(
            sub,
            { title, body: alert.detail, tag: 'task-' + alert.task.id, url: './index.html?tab=Register' },
            env
          );
          if (res.ok) {
            anySent = true;
          } else if (res.status === 404 || res.status === 410) {
            // Subscription is dead (uninstalled, permission revoked, etc.) — prune it.
            await callAppsScript(env, { action: 'removeSubscription', endpoint: sub.endpoint }).catch(() => {});
            log.push(`${username}: pruned dead subscription (${res.status}).`);
          } else {
            log.push(`${username}: push send failed, status ${res.status}.`);
          }
        } catch (e) {
          log.push(`${username}: push send error — ${e.message}`);
        }
      }

      if (anySent && env.PUSH_DEDUPE) {
        await env.PUSH_DEDUPE.put(dedupeKey, '1', { expirationTtl: 60 * 60 * 24 * 3 });
      }
    }
  }

  return log;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPushCheck(env, []));
  },

  // GET /run?secret=... — manual trigger for testing from a browser, and
  // GET /  — a plain health check so visiting the Worker URL isn't a 404.
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/run') {
      if (url.searchParams.get('secret') !== env.WORKER_SECRET) return new Response('Forbidden', { status: 403 });
      const log = await runPushCheck(env, []);
      return new Response(log.join('\n') || 'Nothing to do.', { headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Banking Work Tracker push worker is running.', { headers: { 'Content-Type': 'text/plain' } });
  }
};
