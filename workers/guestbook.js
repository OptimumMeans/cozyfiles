// guestbook.js - a deployable Cloudflare Worker that backs the cozyfiles
// guestbook egg with a shared, cross-visitor store.
//
// This is OPTIONAL. The site works with zero backend (localStorage). Deploy
// this only when you want one shared wall for every visitor. See
// docs/GUESTBOOK-BACKEND.md for the full walkthrough.
//
// Contract (matches js/apps/eggs/guestbook.js):
//   GET  /  -> 200, JSON { entries: [...] } newest-first, capped.
//   POST /  -> body { name, msg, at?, id? } -> 201 { ok: true, entry }.
//   OPTIONS -> CORS preflight.
//
// Storage: a single KV namespace bound as GUESTBOOK. We keep the whole wall in
// one key ("wall") as a JSON array. The guestbook is low-volume (a curio on a
// band site), so one key is simpler than one-key-per-entry and avoids list
// pagination. If you expect heavy traffic, switch to per-entry keys + list().
//
// Rate limiting: one short-lived KV key per client IP. A post within the window
// is rejected with 429. This is best-effort (KV is eventually consistent), not
// a hard security control; it just blunts casual flooding.

// ---- tunables ---------------------------------------------------------------
const WALL_KEY = 'wall';        // KV key holding the entries array
const MAX_ENTRIES = 500;        // hard cap on stored entries (oldest dropped)
const GET_LIMIT = 200;          // how many newest entries a GET returns
const NAME_MAX = 40;
const MSG_MAX = 140;
const AT_MAX = 40;
const ID_MAX = 80;
const RATE_LIMIT_SECONDS = 15;  // min seconds between posts from one IP

// Allowed site origins for CORS. Add your custom domain here. A request from an
// origin not in this set gets no CORS headers (browsers then block the read),
// but localhost is allowed so you can test against a local dev server.
const ALLOWED_ORIGINS = new Set([
  'https://optimummeans.github.io',
  'https://cozyfiles.us',
  'https://www.cozyfiles.us',
  'http://127.0.0.1:8904',
  'http://localhost:8904',
]);

// ---- helpers ----------------------------------------------------------------

// Pick the CORS origin to echo back. We echo the exact request origin only when
// it is allow-listed, which keeps credentials-less cross-origin reads working
// without opening the endpoint to every site.
function corsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  return ALLOWED_ORIGINS.has(origin) ? origin : '';
}

function corsHeaders(request) {
  const origin = corsOrigin(request);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  });
}

// Strip anything that could break out of text context. The client also escapes
// on render, but we never trust the client: store only plain, single-line text.
// Removes angle brackets and control chars, collapses whitespace runs.
function clean(s, max) {
  return String(s == null ? '' : s)
    // strip ASCII control chars (0x00-0x1F and 0x7F) -> space
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/[<>]/g, '')                     // no markup, ever
    .replace(/\s+/g, ' ')                     // collapse whitespace
    .trim()
    .slice(0, max);
}

// Build a clean, stored entry from arbitrary POST input. Returns null if the
// required fields are empty after cleaning.
function buildEntry(input) {
  if (!input || typeof input !== 'object') return null;
  const name = clean(input.name, NAME_MAX);
  const msg = clean(input.msg, MSG_MAX);
  if (!name || !msg) return null;
  const at = clean(input.at, AT_MAX) || stamp();
  // Prefer a valid client-supplied id so the client's optimistic cached entry
  // reconciles with what GET later returns (otherwise the poster sees their own
  // message twice after sync). Fall back to a server id if none was sent.
  const id = clean(input.id, ID_MAX) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { name, msg, at, id };
}

// Human-friendly UTC timestamp matching the client's "YYYY-MM-DD HH:MM" shape.
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Read the wall array from KV. Tolerates a missing or corrupt value.
async function readWall(env) {
  try {
    const raw = await env.GUESTBOOK.get(WALL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeWall(env, entries) {
  // keep only the newest MAX_ENTRIES (array is oldest-first)
  const capped = entries.slice(-MAX_ENTRIES);
  await env.GUESTBOOK.put(WALL_KEY, JSON.stringify(capped));
  return capped;
}

// Best-effort per-IP rate limit using a short-TTL KV key. Returns true if the
// caller is currently rate-limited (should be rejected).
async function isRateLimited(env, ip) {
  if (!ip) return false; // unknown IP: do not lock anyone out
  const key = `rl:${ip}`;
  const hit = await env.GUESTBOOK.get(key);
  if (hit) return true;
  // set a tombstone that expires after the window
  await env.GUESTBOOK.put(key, '1', { expirationTtl: RATE_LIMIT_SECONDS });
  return false;
}

// ---- handlers ---------------------------------------------------------------

async function handleGet(request, env) {
  const all = await readWall(env);
  // oldest-first, capped to the most recent GET_LIMIT. The client model is
  // oldest-first (it reverses for display and caps with slice(-N), which must
  // drop the OLDEST not the newest), so returning oldest-first keeps both sides
  // in agreement on order and on which entries the cap sheds.
  const recent = all.slice(-GET_LIMIT);
  return json({ entries: recent }, 200, request);
}

async function handlePost(request, env) {
  // reject obviously-wrong content types early
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) {
    return json({ ok: false, error: 'expected application/json' }, 415, request);
  }

  // cap the body size before parsing (defense against huge payloads)
  let input;
  try {
    const text = await request.text();
    if (text.length > 4096) {
      return json({ ok: false, error: 'payload too large' }, 413, request);
    }
    input = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400, request);
  }

  const entry = buildEntry(input);
  if (!entry) {
    return json({ ok: false, error: 'name and message are required' }, 422, request);
  }

  // per-IP rate limit (CF-Connecting-IP is set by Cloudflare's edge)
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (await isRateLimited(env, ip)) {
    return json({ ok: false, error: 'slow down a sec' }, 429, request);
  }

  const wall = await readWall(env);
  wall.push(entry); // oldest-first storage
  await writeWall(env, wall);

  return json({ ok: true, entry }, 201, request);
}

// ---- entry point ------------------------------------------------------------
export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // Misconfiguration guard: if the KV binding is missing, fail loudly so the
    // client falls back to localStorage instead of silently losing posts.
    if (!env || !env.GUESTBOOK) {
      return json({ ok: false, error: 'KV namespace GUESTBOOK is not bound' }, 500, request);
    }

    try {
      if (request.method === 'GET') return await handleGet(request, env);
      if (request.method === 'POST') return await handlePost(request, env);
    } catch (err) {
      return json({ ok: false, error: 'server error' }, 500, request);
    }

    return json({ ok: false, error: 'method not allowed' }, 405, request);
  },
};
