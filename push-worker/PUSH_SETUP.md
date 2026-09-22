# Web Push setup — Banking Work Tracker

This makes task alerts arrive **even when the app is fully closed** — no tab
open, no PWA running, nothing. It's a genuinely different mechanism from the
in-app notifications you already have (those only fire while the app's JS is
actually running, which stops the moment you close it).

## How it fits together

```
Your phone/PWA  --subscribes-->  Push service (Chrome/FCM, Firefox, etc.)
       |                                        ^
       | saves subscription                     | delivers push
       v                                        |
 Your Apps Script  <--- every 15 min, checks --- Cloudflare Worker (new)
 (existing Sheet backend)   your tasks & sends alerts
```

Three pieces, all things you already have an account for except Cloudflare
(free):

1. **This app** (already updated) — subscribes the device to push and saves
   that subscription through your existing Apps Script.
2. **Your Apps Script** — gets three new actions (below) to store
   subscriptions and hand them to the Worker. Nothing existing changes.
3. **A new Cloudflare Worker** — the actual "sender." Runs on a timer,
   checks tasks, sends push messages. This is the piece that had to be new
   infrastructure — sending real Web Push requires signing/encrypting each
   message (VAPID + RFC 8291), which needs a server; there's no way to do
   that from static GitHub Pages files alone.

**What's covered:** overdue and due-soon task alerts (the flagship case).
**Not yet covered:** holiday alerts — those currently live only in your
browser's local storage, not in your Sheet, so the Worker can't see them
yet. Happy to wire that up too once this is working; it's a smaller
follow-on (sync holidays to the Sheet the same way tasks already are).

---

## Step 1 — VAPID keys (already generated for you)

These identify your app to the push services. The public one is not
secret — it's already embedded in `app.js` and `wrangler.toml`. **Keep the
private one private** — it's the only credential that lets someone send
push messages pretending to be your app.

```
Public:  BPhpwyza70t8kNJFT28ZUC7xNi_ycIJEi3ZlEsHfxCf9_EFtEHgBtRaeQbNiO9fwJ54RGiVTS-0zM2jBTHUsTak
Private: MwcrXJYTM6Vh6zqlyytGi36uHX10GXW9iy-gFvkpOeQ
```

You don't need to do anything with these right now except keep the private
one handy for Step 4. (If you'd rather generate your own pair instead of
using these: `npx web-push generate-vapid-keys`, then update the public key
in `app.js`'s `CONFIG.VAPID_PUBLIC_KEY` and in `wrangler.toml` to match.)

## Step 2 — Add the Apps Script actions

1. Open your Apps Script project (script.google.com — the one behind your
   Cloud Sync URL).
2. Add `AppsScript_PushBackend.gs.txt` as a new script file (rename to
   `.gs`). Full instructions are in the comment at the top of that file —
   the short version is: paste it in, set your own secret on the
   `PUSH_WORKER_SECRET` line, hook one `if` block into your existing
   `doPost`, redeploy.
3. **Write down the secret you chose** — you'll paste the exact same string
   into the Worker in Step 4.

This adds a new "PushSubscriptions" tab to your Sheet automatically the
first time it's used — nothing about your existing Tasks data is touched.

## Step 3 — Create the Cloudflare Worker

Free tier is enough for this (well under the free request/cron limits).

```bash
cd push-worker
npm install
npx wrangler login          # opens a browser to connect your Cloudflare account
npx wrangler kv namespace create PUSH_DEDUPE
```

That last command prints something like:
```
{ binding = "PUSH_DEDUPE", id = "abcd1234..." }
```
Copy that `id` into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

## Step 4 — Configure and deploy the Worker

Edit `wrangler.toml`:
- `APPS_SCRIPT_URL` → your Apps Script's `/exec` URL (the same one already
  in the app's Config → Connection).
- `VAPID_SUBJECT` → `mailto:your-real-email@example.com` (push services use
  this to contact you if something's misbehaving — it's not shown to you,
  just required by the spec).
- `TIMEZONE` → defaults to `Asia/Kolkata`; change if that's not right.
- `DUE_SOON_MINUTES` → how far ahead "due soon" looks (default 60).

Then set the two values that must stay secret (never put these in
`wrangler.toml`, which you might commit somewhere):

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
# paste: MwcrXJYTM6Vh6zqlyytGi36uHX10GXW9iy-gFvkpOeQ

npx wrangler secret put WORKER_SECRET
# paste the exact same secret you set in AppsScript_PushBackend.gs
```

Deploy:
```bash
npx wrangler deploy
```

It'll print your Worker's URL (`https://btw-push-worker.<your-subdomain>.workers.dev`).
You don't need to do anything with that URL day-to-day — the cron trigger
runs on its own — but it's useful for testing next.

## Step 5 — Turn it on in the app

1. Redeploy the updated app files (this build) to GitHub Pages, same as
   always.
2. Open the app → **Config → Push Notifications** → tap the toggle. It'll
   ask for notification permission if you haven't already granted it.
3. "Push alerts on" means the subscription was saved successfully through
   your Apps Script. If it fails, the toast will say why — most likely
   Cloud Sync isn't set up yet, or Step 2's Apps Script redeploy didn't
   happen.

## Step 6 — Test it end to end

Fastest way to check the whole pipeline without waiting for the cron timer
or a real overdue task:

```
https://btw-push-worker.<your-subdomain>.workers.dev/run?secret=<your WORKER_SECRET>
```

Open that URL in a browser. It runs the check immediately and prints a
plain-text log — e.g. `koteswara: 4 task(s), 2 alert-worthy.` If you have
a genuinely overdue task and push is subscribed, you should get a real
notification within a few seconds, closed app and all.

To watch it live: `npx wrangler tail` while you hit the `/run` URL above.

## Troubleshooting

- **"Push alerts on" but no notification ever arrives** — check
  `wrangler tail` during a `/run` call. A `403`/`Forbidden` from Apps
  Script means the two secrets don't match (Step 2 vs Step 4). A `404`
  or connection error on `APPS_SCRIPT_URL` means that URL is wrong or the
  Apps Script deployment is stale — redeploy it (Step 2.3).
- **Browser says push isn't supported** — Web Push needs the app installed
  or at least running over HTTPS (GitHub Pages is fine) in a Chromium or
  Firefox-based browser; iOS Safari needs the app added to the home screen
  first (iOS 16.4+).
- **Notifications stop after a while on Android** — same battery
  optimization issue as before; exempting the browser/PWA from battery
  optimization keeps both this and the old in-app alerts more reliable, but
  push specifically doesn't actually need the app to be running at all, so
  this matters less here than it did before.
