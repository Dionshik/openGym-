/* Looking packaged food up in Open Food Facts, on the members' behalf.
 *
 * This is the one place the server talks to a third party for a feature that is not the Coach,
 * so it is built to be easy to reason about:
 *
 *   Off unless the admin turns it on (settings.food.lookup), and FOOD_LOOKUP_DISABLED=1 keeps it
 *   off whatever the dashboard says. An instance that never asked for it makes no such request.
 *
 *   The phones never call the database. They ask this server; it asks Open Food Facts with one
 *   outgoing address and the User-Agent the database's operators ask for, and answers from a
 *   cache whenever it can. What leaves is a barcode or a search phrase — never who asked.
 *
 *   The database limits clients per address (15 product reads and 10 searches a minute) and
 *   bans the ones that ignore it. Both limits are kept here for the whole instance, with a
 *   smaller one per member so one person cannot spend everybody's share.
 *
 *   Failing is normal. A product that is not there, a database that does not answer, a limit
 *   reached: each is a short, specific answer the app turns into "add it by hand".
 *
 * The cache is its own file, off-cache.json — the data in it is Open Food Facts' (Open Database
 * License) and must not be mixed into anybody's profile or the built-in table.
 */
import fs from 'node:fs';
import path from 'node:path';

const PRODUCT_URL = code => `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,product_name_ru,product_name_en,generic_name,brands,serving_quantity,serving_quantity_unit,nutriments`;
const SEARCH_URL = (q, langs) => `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&langs=${langs}&page_size=25&fields=code,product_name,generic_name,brands,serving_quantity,serving_quantity_unit,nutriments`;

const DAY = 86400000;
const HIT_TTL = 90 * DAY;        // a product's label does not change often
const MISS_TTL = 7 * DAY;        // somebody may add it to the database next week
const SEARCH_TTL = DAY;
const MAX_PRODUCTS = 5000;
const MAX_SEARCHES = 300;
const TIMEOUT_MS = 8000;
export const LIMITS = { product: 12, search: 8, perUser: 6 };   // per minute; under the database's own 15 / 10

const num = v => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
const r1 = n => Math.round(n * 10) / 10;
const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * One Open Food Facts product as the app's per-100 g row, or why it cannot be one.
 *
 * @returns {{ food: { code, n, brand?, k, p, f, c, sv? } } | { skip: 'noname' | 'nonutrition' }}
 */
export function mapOffProduct(p, lang = 'en') {
  if (!p || typeof p !== 'object') return { skip: 'noname' };
  const name = clean(p['product_name_' + lang] || p.product_name || p.product_name_en || p.generic_name, 80);
  if (!name) return { skip: 'noname' };
  const nt = p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {};
  const pr = num(nt.proteins_100g), fat = num(nt.fat_100g), carb = num(nt.carbohydrates_100g);
  let kcal = num(nt['energy-kcal_100g']);
  // Older entries carry energy in kilojoules only.
  if (kcal == null && num(nt.energy_100g) != null) kcal = num(nt.energy_100g) / 4.184;
  if (kcal == null && (pr != null || fat != null || carb != null)) kcal = 4 * (pr || 0) + 4 * (carb || 0) + 9 * (fat || 0);
  if (kcal == null) return { skip: 'nonutrition' };
  // The same bounds the app's own product form applies: what cannot be food is not offered.
  if (kcal < 0 || kcal > 950 || (pr || 0) + (fat || 0) + (carb || 0) > 105) return { skip: 'nonutrition' };
  const food = { code: clean(p.code, 14), n: name, k: Math.round(kcal), p: r1(Math.max(0, pr || 0)), f: r1(Math.max(0, fat || 0)), c: r1(Math.max(0, carb || 0)) };
  const brand = clean(Array.isArray(p.brands) ? p.brands[0] : String(p.brands || '').split(',')[0], 40);
  if (brand && brand.toLowerCase() !== name.toLowerCase()) food.brand = brand;
  const sv = num(p.serving_quantity);
  const unit = String(p.serving_quantity_unit || 'g').toLowerCase();
  if (sv > 0 && sv <= 2000 && (unit === 'g' || unit === 'ml')) food.sv = Math.round(sv);
  return { food };
}

/** n events per minute, as a sliding list of timestamps. */
function bucket(limit) {
  let hits = [];
  return now => {
    hits = hits.filter(t => now - t < 60000);
    if (hits.length >= limit) return false;
    hits.push(now);
    return true;
  };
}

export function createFood({ dataDir, atomicWrite, settings, fetch: fetchImpl = globalThis.fetch, now = () => Date.now(), version = 'dev', origin = '' }) {
  const file = path.join(dataDir, 'off-cache.json');
  let cache = { products: {}, searches: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') cache = { products: raw.products || {}, searches: raw.searches || {} };
  } catch { /* nothing cached yet */ }

  // The cache is a convenience: written a little after a change rather than on every lookup,
  // and a write that fails costs a repeated lookup, nothing else.
  let saveTimer = null;
  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { atomicWrite(file, JSON.stringify(cache), 0o600); } catch (e) { console.error('food cache write failed', e.message); }
    }, 2000);
    saveTimer.unref?.();
  };
  const trimTo = (map, max) => {
    const keys = Object.keys(map);
    if (keys.length <= max) return;
    keys.sort((a, b) => map[a].at - map[b].at).slice(0, keys.length - max).forEach(k => { delete map[k]; });
  };

  const enabled = () => settings.get().food.lookup === true && process.env.FOOD_LOOKUP_DISABLED !== '1';
  const productGate = bucket(LIMITS.product), searchGate = bucket(LIMITS.search);
  const userGates = new Map();
  const userOk = uid => {
    if (!userGates.has(uid)) userGates.set(uid, bucket(LIMITS.perUser));
    return userGates.get(uid)(now());
  };
  const agent = () => {
    const contact = settings.get().food.contact || origin || 'self-hosted instance';
    return `openGym/${version} (${contact})`;
  };
  const ask = async url => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': agent(), Accept: 'application/json' }, signal: ctl.signal });
      let data = null;
      try { data = await res.json(); } catch { /* an error page, not JSON */ }
      return { status: res.status, data };
    } finally { clearTimeout(timer); }
  };

  const food = {
    enabled,
    publicConfig: () => ({ lookup: enabled() }),
    stats: () => ({ products: Object.keys(cache.products).length, searches: Object.keys(cache.searches).length }),
    /** Admin: forget everything cached (the data is not ours to keep against the owner's wish). */
    clearCache() { cache = { products: {}, searches: {} }; try { fs.unlinkSync(file); } catch { /* none */ } },

    /** @returns {{ status:number, body:object }} — the route's answer, so tests need no server. */
    async barcode(uid, rawCode, lang) {
      if (!enabled()) return { status: 403, body: { error: 'disabled' } };
      const code = String(rawCode == null ? '' : rawCode).replace(/[\s-]/g, '');
      if (!/^\d{8,14}$/.test(code)) return { status: 400, body: { error: 'badcode' } };
      const hit = cache.products[code];
      if (hit && now() - hit.at < (hit.food ? HIT_TTL : MISS_TTL)) {
        return hit.food ? { status: 200, body: { food: hit.food, cached: true } } : { status: hit.why === 'nonutrition' ? 422 : 404, body: { error: hit.why || 'notfound' } };
      }
      if (!userOk(uid) || !productGate(now())) return { status: 429, body: { error: 'throttled' } };
      let r;
      try { r = await ask(PRODUCT_URL(code)); } catch { return { status: 502, body: { error: 'unreachable' } }; }
      const remember = entry => { cache.products[code] = { at: now(), ...entry }; trimTo(cache.products, MAX_PRODUCTS); save(); };
      if (r.status === 404 || (r.status === 200 && r.data && r.data.status === 0)) { remember({ why: 'notfound' }); return { status: 404, body: { error: 'notfound' } }; }
      if (r.status !== 200 || !r.data || !r.data.product) return { status: 502, body: { error: 'unreachable' } };
      const m = mapOffProduct({ ...r.data.product, code }, lang === 'ru' ? 'ru' : 'en');
      if (m.skip) { remember({ why: 'nonutrition' }); return { status: 422, body: { error: 'nonutrition' } }; }
      remember({ food: m.food });
      return { status: 200, body: { food: m.food, cached: false } };
    },

    async search(uid, rawQ, lang) {
      if (!enabled()) return { status: 403, body: { error: 'disabled' } };
      const q = clean(rawQ, 60).toLowerCase();
      if (q.length < 3) return { status: 400, body: { error: 'short' } };
      const langs = lang === 'ru' ? 'ru,en' : 'en';
      const key = langs + '|' + q;
      const hit = cache.searches[key];
      if (hit && now() - hit.at < SEARCH_TTL) return { status: 200, body: { items: hit.items, cached: true } };
      if (!userOk(uid) || !searchGate(now())) return { status: 429, body: { error: 'throttled' } };
      let r;
      try { r = await ask(SEARCH_URL(q, langs)); } catch { return { status: 502, body: { error: 'unreachable' } }; }
      if (r.status !== 200 || !r.data || !Array.isArray(r.data.hits)) return { status: 502, body: { error: 'unreachable' } };
      const seen = new Set();
      const items = [];
      for (const h of r.data.hits) {
        const m = mapOffProduct(h, lang === 'ru' ? 'ru' : 'en');
        const id = m.food && (m.food.code || m.food.n.toLowerCase());
        if (!m.food || seen.has(id)) continue;
        seen.add(id);
        items.push(m.food);
        if (items.length >= 20) break;
      }
      cache.searches[key] = { at: now(), items };
      trimTo(cache.searches, MAX_SEARCHES);
      save();
      return { status: 200, body: { items, cached: false } };
    },

    routes({ json, readBody, readSession }) {
      const signedIn = (req, res) => {
        const user = readSession(req);
        if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
        return user;
      };
      return {
        // POST, not GET: what somebody eats does not belong in a URL that proxies and logs keep.
        'POST /api/food/barcode': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          const body = await readBody(req);
          const r = await food.barcode(user.id, body.code, body.lang);
          json(res, r.status, r.body);
        },
        'POST /api/food/search': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          const body = await readBody(req);
          const r = await food.search(user.id, body.q, body.lang);
          json(res, r.status, r.body);
        }
      };
    }
  };
  return food;
}
