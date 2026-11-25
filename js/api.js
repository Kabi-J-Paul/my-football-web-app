/* Pitchify — ExerciseDB V1 client (free tier, no API key required)
   Base: https://oss.exercisedb.dev/api/v1
   Handles: timeout, jittered backoff on 403/429/5xx, caching, single-flight,
   pagination no-progress guard, dedupe. Error details carry endpoint + status
   + a body snippet (mirrors a production REST client's diagnostics). */
const PitchAPI = (() => {
  'use strict';

  const BASE = 'https://oss.exercisedb.dev/api/v1';
  const PAGE_SIZE = 25;          // API hard cap (silently clamps anything above)
  const TIMEOUT_MS = 8000;
  const RETRY_DELAYS = [0, 1000, 3000];  // ms before jitter — browser-sized
  const RETRYABLE = new Set([403, 500, 502, 503, 504]); // 429 handled separately
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
  const CACHE_KEY = 'pitchify:cache';
  const inflight = new Map();

  /** Origin of the most recent completed request: 'live' | 'cache' */
  let lastSource = 'live';

  class ApiError extends Error {
    constructor(message, code = 'UNKNOWN', status = 0, detail = '') {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
      this.detail = detail; // "GET /exercises?limit=25 -> 503: {body…}"
    }
    get isOffline() { return this.code === 'NETWORK' || this.code === 'TIMEOUT'; }
    get isRateLimited() { return this.code === 'RATE_LIMITED'; }
  }

  /* ---------- storage (safe: falls back to memory) ---------- */
  const memStore = {};
  const hasLS = (() => {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
    catch (e) { return false; }
  })();

  function storeGet(key) {
    try {
      if (hasLS) { const v = localStorage.getItem(key); return v === null ? (key in memStore ? memStore[key] : null) : v; }
      return key in memStore ? memStore[key] : null;
    } catch (e) { return key in memStore ? memStore[key] : null; }
  }
  function storeSet(key, value) {
    memStore[key] = value;
    try { if (hasLS) localStorage.setItem(key, value); } catch (e) { /* quota — memory keeps working */ }
  }

  /* ---------- response cache ---------- */
  function cacheRead(key) {
    try {
      const raw = storeGet(CACHE_KEY + ':' + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (entry.v !== 'v1' || Date.now() - entry.ts > CACHE_TTL) return null;
      return entry.data;
    } catch (e) { return null; }
  }
  function cacheWrite(key, data) {
    try { storeSet(CACHE_KEY + ':' + key, JSON.stringify({ v: 'v1', ts: Date.now(), data })); }
    catch (e) { /* ignore */ }
  }

  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
  function jitter(ms) { return ms + Math.floor(Math.random() * ms * 0.2); }

  /** "GET /path?query -> 503: <body, capped at 300 chars>" — the detail line
      we attach to every ApiError so failures are diagnosable from the console. */
  function describe(label, status, body) {
    let snippet = '';
    try {
      snippet = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    } catch (e) { snippet = ''; }
    if (snippet.length > 300) snippet = snippet.slice(0, 300) + '…';
    return label + ' -> ' + status + (snippet ? ': ' + snippet : '');
  }

  /* ---------- core request ---------- */
  async function request(path, params = {}, { cache = false, retries = 2 } = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
    const key = url.toString();
    const label = 'GET ' + path + url.search;

    if (cache) {
      const hit = cacheRead(key);
      if (hit) { lastSource = 'cache'; return hit; }
    }
    if (inflight.has(key)) return inflight.get(key);

    const job = (async () => {
      const maxTries = 1 + Math.min(retries, RETRY_DELAYS.length - 1);
      let attempt = 0;
      /* eslint-disable no-constant-condition */
      while (true) {
        attempt++;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        let res;
        try {
          res = await fetch(key, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        } catch (err) {
          clearTimeout(timer);
          if (attempt >= maxTries) {
            if (err.name === 'AbortError') {
              throw new ApiError('The request timed out. The API may be slow right now.', 'TIMEOUT', 0,
                label + ' -> no response within ' + (TIMEOUT_MS / 1000) + 's');
            }
            throw new ApiError('Could not reach the API. Check your internet connection.', 'NETWORK', 0,
              label + ' -> ' + (err.message || 'network error'));
          }
          await sleep(jitter(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]));
          continue;
        }
        clearTimeout(timer);

        if (res.status === 429 && attempt < maxTries) {
          const wait = Math.min(Number(res.headers.get('Retry-After')) * 1000 || 6000, 15000);
          await sleep(wait);
          continue;
        }
        if (RETRYABLE.has(res.status) && attempt < maxTries) {
          await sleep(jitter(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]));
          continue;
        }

        let body = null;
        try { body = await res.json(); } catch (e) { /* non-JSON body */ }

        if (!res.ok) {
          const err = (body && body.error) || {};
          const detail = describe(label, res.status, body);
          if (res.status === 429) {
            throw new ApiError('Too many requests — the API is rate limiting us. Wait a few seconds and try again.', 'RATE_LIMITED', 429, detail);
          }
          if (res.status === 404) {
            throw new ApiError(err.message || 'That exercise could not be found.', err.code || 'NOT_FOUND', 404, detail);
          }
          if (res.status >= 500) {
            throw new ApiError('The API returned a server error. Please try again.', err.code || 'SERVER_ERROR', res.status, detail);
          }
          throw new ApiError(err.message || 'Request failed (HTTP ' + res.status + ').', err.code || 'HTTP_ERROR', res.status, detail);
        }

        lastSource = 'live';
        if (cache) cacheWrite(key, body);
        return body;
      }
      /* eslint-enable no-constant-condition */
    })();

    inflight.set(key, job);
    try { return await job; } finally { inflight.delete(key); }
  }

  /* ---------- helpers ---------- */
  function dedupe(items) {
    const seen = new Set();
    const out = [];
    for (const it of items) {
      const id = it && it.exerciseId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(it);
    }
    return out;
  }

  function unwrap(body, what) {
    if (!body || body.success !== true || body.data === undefined) {
      throw new ApiError('The API returned an unexpected response.', 'BAD_RESPONSE', 0,
        what + ' -> envelope was ' + JSON.stringify(body).slice(0, 300));
    }
    return body.data;
  }

  /** Cursors we have already consumed — a repeat means no forward progress. */
  let cursorSeen = new Set();

  /* ---------- public API ---------- */
  return {
    ApiError,
    PAGE_SIZE,

    /** Health check — note: no `success` envelope on this endpoint */
    async liveness() {
      const body = await request('/liveness', {}, { retries: 1 });
      if (!body || !body.status) throw new ApiError('Liveness check failed.', 'BAD_RESPONSE');
      return body; // { status, environment }
    },

    /** Paged, filtered list. Returns { items, meta } */
    async fetchPage(params = {}) {
      const query = {
        name: params.name,
        bodyParts: params.bodyParts,
        equipments: params.equipments,
        targetMuscles: params.targetMuscles,
        secondaryMuscles: params.secondaryMuscles,
        limit: params.limit || PAGE_SIZE,
        after: params.after,
      };
      const body = await request('/exercises', query, { cache: !query.after });
      const items = unwrap(body, 'list');
      const meta = body.meta || {};
      /* No-progress guard: a cursor we already consumed, or a server echoing
         the same cursor back, would make "Load more" loop forever. */
      if (query.after && (cursorSeen.has(query.after) || meta.nextCursor === query.after)) {
        meta.hasNextPage = false;
        meta.nextCursor = null;
      }
      if (query.after) cursorSeen.add(query.after); else cursorSeen = new Set();
      return { items: dedupe(items), meta };
    },

    /** Fuzzy search — light records only { exerciseId, name, gifUrl } */
    async search(term, threshold) {
      const body = await request('/exercises/search', { search: term, threshold: threshold || 0.5 }, { cache: true });
      return dedupe(unwrap(body, 'search'));
    },

    /** Full detail for one exercise */
    async getExercise(id) {
      if (!id) throw new ApiError('No exercise id given.', 'BAD_REQUEST', 400);
      const body = await request('/exercises/' + encodeURIComponent(id), {}, { cache: true });
      return unwrap(body, 'detail');
    },

    /** Dropdown lists (cached 24h) */
    async bodyParts() {
      const body = await request('/bodyparts', {}, { cache: true });
      return unwrap(body, 'bodyparts');
    },
    async equipments() {
      const body = await request('/equipments', {}, { cache: true });
      return unwrap(body, 'equipments');
    },
    async muscles() {
      const body = await request('/muscles', {}, { cache: true });
      return unwrap(body, 'muscles');
    },

    dedupe,
    /** 'live' | 'cache' — where the most recent completed call got its data */
    getSource: () => lastSource,
    /** Warm cache / clear it */
    clearCache() {
      try {
        const rm = [];
        for (let i = 0; i < (hasLS ? localStorage.length : 0); i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(CACHE_KEY + ':') === 0) rm.push(k);
        }
        rm.forEach(k => localStorage.removeItem(k));
      } catch (e) { /* ignore */ }
    },
  };
})();
