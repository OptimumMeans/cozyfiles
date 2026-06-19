# Guestbook backend (optional)

The guestbook egg works with ZERO backend. By default it stores entries in the
visitor's own `localStorage`, so each person sees only what they signed on that
device. That is the intended default: nothing to deploy, nothing to pay for.

If you want ONE shared wall that every visitor reads and writes, you can deploy
the bundled Cloudflare Worker in `workers/guestbook.js` and point the site at
it. This is fully optional and you (the site owner) have to deploy it yourself.
Until you do, the guestbook stays local-only and the indicator reads `local`.

## What the worker does

`workers/guestbook.js` is a small, self-contained Cloudflare Worker:

- `GET /`  returns recent entries newest-first as JSON `{ entries: [...] }`,
  capped (200 returned, 500 stored).
- `POST /` accepts one entry `{ name, msg, at?, id? }`, validates and length-caps
  it, strips markup and control characters, applies a best-effort per-IP rate
  limit (one post per 15s), and stores it in a KV namespace.
- `OPTIONS` handles the CORS preflight. Only allow-listed site origins get CORS
  headers (edit `ALLOWED_ORIGINS` in the worker for your domains).

Storage is a single KV key (`wall`) holding the entries array. That is simple
and fine for a low-traffic curio. For heavy traffic, switch to per-entry keys.

## Deploy with Wrangler

Prereqs: a Cloudflare account and the Wrangler CLI
(`npm install -g wrangler`, then `wrangler login`).

1. Create a project folder anywhere (it does NOT need to be in this repo) and
   copy `workers/guestbook.js` into it as the entry module.

2. Create a `wrangler.toml` next to it:

   ```toml
   name = "cozyfiles-guestbook"
   main = "guestbook.js"
   compatibility_date = "2024-11-01"

   # filled in by the create-namespace step below
   [[kv_namespaces]]
   binding = "GUESTBOOK"
   id = "PASTE_THE_ID_FROM_STEP_3"
   ```

   The binding name MUST be `GUESTBOOK` - the worker reads `env.GUESTBOOK`.

3. Create the KV namespace and copy the printed id into `wrangler.toml`:

   ```sh
   wrangler kv namespace create GUESTBOOK
   ```

   (Optional: `wrangler kv namespace create GUESTBOOK --preview` for a preview id
   if you want `wrangler dev` to use a separate store.)

4. Edit `ALLOWED_ORIGINS` near the top of `guestbook.js` so it lists exactly the
   origins your site is served from, for example:

   ```js
   const ALLOWED_ORIGINS = new Set([
     'https://optimummeans.github.io',
     'https://cozyfiles.us',
     'https://www.cozyfiles.us',
   ]);
   ```

   A request from an origin not in this set receives no CORS headers, so the
   browser blocks the cross-origin read. (The local dev origins are only there
   for testing and can be removed for production.)

5. Test locally, then deploy:

   ```sh
   wrangler dev      # serves on http://127.0.0.1:8787
   wrangler deploy   # prints your https://cozyfiles-guestbook.<you>.workers.dev URL
   ```

6. Smoke-test the live worker:

   ```sh
   # should return {"entries":[]}
   curl https://cozyfiles-guestbook.<you>.workers.dev/

   # should return {"ok":true,"entry":{...}}
   curl -X POST https://cozyfiles-guestbook.<you>.workers.dev/ \
     -H 'Content-Type: application/json' \
     -d '{"name":"you","msg":"hello wall"}'
   ```

## Point the site at your worker

The guestbook reads the endpoint in this order (first non-empty wins):

1. `localStorage` key `cozyfiles.guestbook.endpoint` (per-device override, no
   redeploy needed). In the site's browser console:

   ```js
   localStorage.setItem('cozyfiles.guestbook.endpoint',
     'https://cozyfiles-guestbook.<you>.workers.dev');
   ```

   Remove it to go back to local-only:

   ```js
   localStorage.removeItem('cozyfiles.guestbook.endpoint');
   ```

2. The `DEFAULT_ENDPOINT` constant near the top of
   `js/apps/eggs/guestbook.js`. Set it to your worker URL to make sharing the
   default for ALL visitors, then commit and deploy the site:

   ```js
   const DEFAULT_ENDPOINT = 'https://cozyfiles-guestbook.<you>.workers.dev';
   ```

Only `http(s)` URLs are accepted; anything else is ignored and the guestbook
stays local-only.

## How the indicator reads

The little badge in the guestbook title bar tells you which mode is live:

- `local`  - no endpoint configured; entries are per-device only (the default).
- `synced` - an endpoint is configured and the last GET/POST round-trip
  succeeded; you are on the shared wall.
- `local` (warm color) - an endpoint is configured but currently unreachable;
  your entry was saved on this device and will sync on a later successful load.

## Graceful fallback (important)

On ANY network error the client keeps the user's entry in `localStorage` and
never loses it. A configured-but-down backend degrades to local-only rather than
dropping a signature, and a later successful load merges the device's pending
entries back into the shared wall (deduped by id). You can therefore deploy,
break, or remove the backend at any time without losing data or breaking the
egg.
