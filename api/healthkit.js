/* Body data from the iPhone's Health app, delivered by a Shortcut.
 *
 * A web app cannot read HealthKit and this project ships no App Store app, so the bridge is the
 * one thing every iPhone has: a Shortcut that reads a few Health samples and POSTs them here
 * once a day. This module is the receiving end.
 *
 *   The Shortcut carries a token of its own — `ogh_…`, made on the Body screen, shown once and
 *   stored here only as a hash. It is not a session: it can add body measurements to the one
 *   profile it was made for and can read nothing, not even what it wrote. A phone lost with the
 *   Shortcut on it costs a revoke, not a sign-out everywhere.
 *
 *   What arrives is kept in a file this server alone writes, health/<uid>.json — never in the
 *   profile's state, which the app PUTs back whole and would erase it (the reason Coach
 *   proposals live in their own file too). The app fetches it, like the exercise pool, and
 *   copies new samples into the profile itself.
 *
 *   Off unless the admin turns it on. Health data is the most personal thing this server would
 *   hold, nothing in ./data is encrypted, and an admin can read all of it — the owner should
 *   have decided that on purpose.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseIngest } from './healthkit-parse.js';

export const TOKEN_PREFIX = 'ogh_';
export const MAX_TOKENS_PER_USER = 3;
export const RETENTION_DAYS = 400;
const MAX_INGEST_BYTES = 64 * 1024;
const INGESTS_PER_HOUR = 30;          // per token: a Shortcut runs once or twice a day
const BAD_TOKENS_PER_MINUTE = 30;     // for the whole instance, then every ingest waits

const safe = uid => String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
const hashOf = token => crypto.createHash('sha256').update(token).digest('hex');
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const EMPTY = () => ({ rev: 0, days: {}, height: null, lastIngest: 0 });

export function createHealth({ dataDir, atomicWrite, settings, now = () => Date.now() }) {
  const dir = path.join(dataDir, 'health');
  const tokenFile = path.join(dataDir, 'health-tokens.json');
  let tokens = [];
  try {
    const raw = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    if (raw && Array.isArray(raw.tokens)) tokens = raw.tokens.filter(t => t && t.id && t.uid && t.hash);
  } catch { /* none made yet */ }
  const saveTokens = () => atomicWrite(tokenFile, JSON.stringify({ tokens }), 0o600);

  const fileOf = uid => path.join(dir, safe(uid) + '.json');
  const read = uid => {
    try { return { ...EMPTY(), ...JSON.parse(fs.readFileSync(fileOf(uid), 'utf8')) }; }
    catch { return EMPTY(); }
  };
  const write = (uid, rec) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicWrite(fileOf(uid), JSON.stringify(rec), 0o600);
  };

  const enabled = () => settings.get().health.enabled === true;
  const used = new Map();        // token id → timestamps of recent ingests
  let bad = [];                  // timestamps of recent refused tokens, instance-wide
  const within = (list, ms) => list.filter(t => now() - t < ms);

  const health = {
    enabled,
    publicConfig: () => enabled(),
    /** For /api/data and /api/data/rev: how a device learns there is something new to fetch. */
    rev: uid => read(uid).rev || 0,
    stats: () => ({ users: new Set(tokens.map(t => t.uid)).size, tokens: tokens.length }),

    /** Makes a token for `uid`. The plain token is returned once and never again. */
    createToken(uid) {
      if (tokens.filter(t => t.uid === uid).length >= MAX_TOKENS_PER_USER) return { ok: false, code: 'cap' };
      const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
      const rec = { id: crypto.randomBytes(6).toString('hex'), uid, hash: hashOf(token), created: now(), lastUsed: 0 };
      tokens.push(rec);
      saveTokens();
      return { ok: true, token, id: rec.id, created: rec.created };
    },
    listTokens: uid => tokens.filter(t => t.uid === uid).map(t => ({ id: t.id, created: t.created, lastUsed: t.lastUsed || 0 })),
    revokeToken(uid, id) {
      const before = tokens.length;
      tokens = tokens.filter(t => !(t.uid === uid && t.id === id));
      if (tokens.length === before) return false;
      saveTokens();
      return true;
    },
    /** The account is gone, or its owner asked: the samples, and with `tokens` the tokens too. */
    dropUser(uid, { tokens: alsoTokens = true } = {}) {
      try { fs.unlinkSync(fileOf(uid)); } catch { /* nothing stored */ }
      if (alsoTokens && tokens.some(t => t.uid === uid)) { tokens = tokens.filter(t => t.uid !== uid); saveTokens(); }
    },

    /**
     * One delivery from a Shortcut. `auth` is the Authorization header as it came.
     * @returns {{ status:number, body:object }}
     */
    ingest(auth, body, { userExists = () => true } = {}) {
      if (!enabled()) return { status: 403, body: { error: 'disabled' } };
      const token = String(auth || '').startsWith('Bearer ') ? String(auth).slice(7).trim() : '';
      bad = within(bad, 60000);
      if (bad.length >= BAD_TOKENS_PER_MINUTE) return { status: 429, body: { error: 'throttled' } };
      const rec = token.startsWith(TOKEN_PREFIX) ? tokens.find(t => t.hash === hashOf(token)) : null;
      if (!rec || !userExists(rec.uid)) { bad.push(now()); return { status: 401, body: { error: 'bad token' } }; }
      const recent = within(used.get(rec.id) || [], 3600000);
      if (recent.length >= INGESTS_PER_HOUR) return { status: 429, body: { error: 'throttled' } };
      used.set(rec.id, [...recent, now()]);

      const at = now();
      const parsed = parseIngest(body, { today: isoDay(at) });
      const store = read(rec.uid);
      let changed = false;
      const applied = [];
      for (const { metric, d, v } of parsed.accepted) {
        if (metric === 'height') {
          if (!store.height || store.height.v !== v) { store.height = { v, at }; changed = true; }
          applied.push({ metric, d, v });
          continue;
        }
        const day = store.days[d] || (store.days[d] = {});
        // The same reading delivered again (the Shortcut ran twice) is not news: the timestamp
        // stays, so the app does not copy it into the profile a second time.
        if (!day[metric] || day[metric].v !== v) { day[metric] = { v, at }; changed = true; }
        applied.push({ metric, d, v });
      }
      const cutoff = isoDay(at - RETENTION_DAYS * 86400000);
      for (const d of Object.keys(store.days)) if (d < cutoff) { delete store.days[d]; changed = true; }
      store.lastIngest = at;
      if (changed) store.rev = (store.rev || 0) + 1;
      write(rec.uid, store);
      rec.lastUsed = at;
      saveTokens();
      // Write-only: the answer says what was understood, never what is stored.
      return { status: 200, body: { ok: true, accepted: applied, ignored: parsed.ignored, warnings: parsed.warnings } };
    },

    routes({ json, readBody, readSession, audit, userExists }) {
      const signedIn = (req, res) => {
        const user = readSession(req);
        if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
        return user;
      };
      const off = res => json(res, 403, { error: 'disabled' });
      return {
        // Everything the Body screen shows: the samples, and the tokens by id — never the tokens.
        'GET /api/healthkit': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          if (!enabled()) return off(res);
          const s = read(user.id);
          json(res, 200, { rev: s.rev || 0, days: s.days, height: s.height, lastIngest: s.lastIngest || 0, tokens: health.listTokens(user.id), shortcutUrl: settings.get().health.shortcutUrl || '' });
        },
        'POST /api/healthkit/token': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          if (!enabled()) return off(res);
          const r = health.createToken(user.id);
          if (!r.ok) return json(res, 409, { error: `at most ${MAX_TOKENS_PER_USER} tokens — revoke one first`, code: 'cap' });
          audit(req, 'auth.health.token', { user });
          json(res, 200, { token: r.token, id: r.id, created: r.created, tokens: health.listTokens(user.id) });
        },
        'POST /api/healthkit/token/revoke': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          const body = await readBody(req);
          if (!health.revokeToken(user.id, String(body.id || ''))) return json(res, 404, { error: 'no such token' });
          audit(req, 'auth.health.revoke', { user });
          json(res, 200, { ok: true, tokens: health.listTokens(user.id) });
        },
        // Forget what Health delivered. What the app already copied into the profile is the
        // profile's, and is deleted there.
        'POST /api/healthkit/clear': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          health.dropUser(user.id, { tokens: false });
          audit(req, 'auth.health.clear', { user });
          json(res, 200, { ok: true });
        },
        // The Shortcut's door. Authenticated by its own token and by nothing else: a browser
        // session is deliberately not accepted here, so the route can never act on a cookie.
        'POST /api/healthkit/ingest': async (req, res) => {
          if (+req.headers['content-length'] > MAX_INGEST_BYTES) return json(res, 413, { error: 'body too large' });
          const body = await readBody(req);
          const r = health.ingest(req.headers.authorization, body, { userExists });
          json(res, r.status, r.body);
        }
      };
    }
  };
  return health;
}
