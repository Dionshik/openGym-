/* Online food lookup (food.js): what an Open Food Facts answer becomes, and that the server
   asks as rarely and as politely as it promises — off by default, cached, rate-limited, and
   never surprised by the database being absent. No network: fetch is a fake throughout. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFood, mapOffProduct, LIMITS } from '../food.js';
import { createSettings } from '../settings.js';

const atomicWrite = (file, content) => fs.writeFileSync(file, content);
const TVOROG = { code: '4602014004683', product_name: 'Творог', product_name_ru: 'Творог 9 %', brands: 'Дмитровский Молочный завод, Другой', serving_quantity: 180, nutriments: { 'energy-kcal_100g': 160, proteins_100g: 16, fat_100g: 9, carbohydrates_100g: 3 } };

function setup(t, { lookup = true, respond } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-food-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const settings = createSettings({ dataDir, atomicWrite });
  if (lookup) settings.patch({ food: { lookup: true, contact: 'owner@example.org' } });
  const calls = [];
  let clock = 1_000_000;
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const r = await respond(url);
    return { status: r.status, json: async () => { if (r.html) throw new Error('not json'); return r.data; } };
  };
  const food = createFood({ dataDir, atomicWrite, settings, fetch, now: () => clock, version: '9.9.9', origin: 'https://gym.example' });
  return { food, calls, settings, dataDir, tick: ms => { clock += ms; } };
}

test('mapOffProduct: a product becomes a per-100 g row, in the asked language', () => {
  assert.deepEqual(mapOffProduct(TVOROG, 'ru').food, { code: '4602014004683', n: 'Творог 9 %', k: 160, p: 16, f: 9, c: 3, brand: 'Дмитровский Молочный завод', sv: 180 });
  assert.equal(mapOffProduct(TVOROG, 'en').food.n, 'Творог');
});

test('mapOffProduct: energy in kilojoules, or missing, is worked out; nothing at all is refused', () => {
  assert.equal(mapOffProduct({ product_name: 'x', nutriments: { energy_100g: 669.44 } }).food.k, 160);
  assert.equal(mapOffProduct({ product_name: 'x', nutriments: { proteins_100g: 10, fat_100g: 10, carbohydrates_100g: 10 } }).food.k, 170);
  assert.deepEqual(mapOffProduct({ product_name: 'x', nutriments: {} }), { skip: 'nonutrition' });
  assert.deepEqual(mapOffProduct({ nutriments: { 'energy-kcal_100g': 100 } }), { skip: 'noname' });
  assert.deepEqual(mapOffProduct(null), { skip: 'noname' });
});

test('mapOffProduct: numbers that cannot be food are not offered; search hits carry brands as a list', () => {
  assert.deepEqual(mapOffProduct({ product_name: 'x', nutriments: { 'energy-kcal_100g': 4000 } }), { skip: 'nonutrition' });
  assert.deepEqual(mapOffProduct({ product_name: 'x', nutriments: { 'energy-kcal_100g': 300, proteins_100g: 90, fat_100g: 90 } }), { skip: 'nonutrition' });
  assert.equal(mapOffProduct({ product_name: 'Кефир', brands: ['Простоквашино'], nutriments: { 'energy-kcal_100g': '53', proteins_100g: '2,9' } }).food.brand, 'Простоквашино');
  // a serving in something that is not grams or millilitres is not a weight
  assert.equal('sv' in mapOffProduct({ ...TVOROG, serving_quantity_unit: 'oz' }).food, false);
});

test('off until the admin turns it on — and no request is made', async t => {
  const h = setup(t, { lookup: false, respond: async () => ({ status: 200, data: { status: 1, product: TVOROG } }) });
  assert.equal(h.food.enabled(), false);
  assert.deepEqual(await h.food.barcode('u1', '4602014004683'), { status: 403, body: { error: 'disabled' } });
  assert.deepEqual(await h.food.search('u1', 'творог'), { status: 403, body: { error: 'disabled' } });
  assert.equal(h.calls.length, 0);
});

test('FOOD_LOOKUP_DISABLED=1 keeps it off whatever the dashboard says', async t => {
  const h = setup(t, { respond: async () => ({ status: 200, data: { status: 1, product: TVOROG } }) });
  process.env.FOOD_LOOKUP_DISABLED = '1';
  t.after(() => { delete process.env.FOOD_LOOKUP_DISABLED; });
  assert.equal(h.food.enabled(), false);
  assert.equal((await h.food.barcode('u1', '4602014004683')).status, 403);
  assert.equal(h.calls.length, 0);
});

test('a barcode is asked once, with the instance named in the User-Agent, and answered from the cache after', async t => {
  const h = setup(t, { respond: async () => ({ status: 200, data: { status: 1, product: TVOROG } }) });
  const first = await h.food.barcode('u1', '4602 0140 04683', 'ru');
  assert.equal(first.status, 200);
  assert.equal(first.body.cached, false);
  assert.equal(first.body.food.n, 'Творог 9 %');
  assert.match(h.calls[0].url, /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/4602014004683\.json\?fields=/);
  assert.equal(h.calls[0].init.headers['User-Agent'], 'openGym/9.9.9 (owner@example.org)');
  const again = await h.food.barcode('u2', '4602014004683', 'ru');
  assert.equal(again.body.cached, true);
  assert.equal(h.calls.length, 1, 'the second member is served from the cache');
});

test('only digits are ever put into the URL', async t => {
  const h = setup(t, { respond: async () => ({ status: 200, data: { status: 1, product: TVOROG } }) });
  for (const bad of ['', '123', '../../etc', '4602014004683?x=1', 'abcdefghijkl', '123456789012345']) {
    assert.equal((await h.food.barcode('u1', bad)).status, 400, bad);
  }
  assert.equal(h.calls.length, 0);
});

test('not in the database: said plainly, remembered for a while, asked again later', async t => {
  let found = false;
  const h = setup(t, { respond: async () => (found ? { status: 200, data: { status: 1, product: TVOROG } } : { status: 200, data: { status: 0, status_verbose: 'product not found' } }) });
  assert.deepEqual(await h.food.barcode('u1', '4602014004683'), { status: 404, body: { error: 'notfound' } });
  assert.deepEqual(await h.food.barcode('u1', '4602014004683'), { status: 404, body: { error: 'notfound' } });
  assert.equal(h.calls.length, 1);
  found = true;
  h.tick(8 * 86400000);
  assert.equal((await h.food.barcode('u1', '4602014004683')).status, 200);
});

test('a product without nutrition values is its own answer, and a real 404 is a miss too', async t => {
  const h = setup(t, { respond: async url => (url.includes('11111111') ? { status: 404, data: null } : { status: 200, data: { status: 1, product: { product_name: 'Вода', nutriments: {} } } }) });
  assert.deepEqual(await h.food.barcode('u1', '22222222'), { status: 422, body: { error: 'nonutrition' } });
  assert.deepEqual(await h.food.barcode('u1', '11111111'), { status: 404, body: { error: 'notfound' } });
});

test('the database not answering is "unreachable", not a crash, and is not cached', async t => {
  let mode = 'throw';
  const h = setup(t, { respond: async () => { if (mode === 'throw') throw new Error('ECONNRESET'); return mode === 'html' ? { status: 503, html: true } : { status: 200, data: { status: 1, product: TVOROG } }; } });
  assert.deepEqual(await h.food.barcode('u1', '4602014004683'), { status: 502, body: { error: 'unreachable' } });
  mode = 'html';
  assert.deepEqual(await h.food.barcode('u1', '4602014004683'), { status: 502, body: { error: 'unreachable' } });
  mode = 'ok';
  assert.equal((await h.food.barcode('u1', '4602014004683')).status, 200);
});

test('one member cannot spend the whole instance’s share, and the instance stays under the database’s limit', async t => {
  let n = 0;
  const h = setup(t, { respond: async () => ({ status: 200, data: { status: 1, product: { ...TVOROG, code: String(10000000 + n++) } } }) });
  const code = i => String(20000000 + i);
  for (let i = 0; i < LIMITS.perUser; i++) assert.equal((await h.food.barcode('greedy', code(i))).status, 200);
  assert.deepEqual(await h.food.barcode('greedy', code(99)), { status: 429, body: { error: 'throttled' } });
  // other members still get through, up to the instance's own limit
  let ok = 0;
  for (let i = 0; i < 20; i++) if ((await h.food.barcode('u' + i, code(100 + i))).status === 200) ok++;
  assert.equal(ok, LIMITS.product - LIMITS.perUser);
  h.tick(61000);
  assert.equal((await h.food.barcode('greedy', code(200))).status, 200, 'a minute later the limit has passed');
});

test('search: maps the hits, drops those without nutrition and duplicates, caches the phrase', async t => {
  const hits = [
    { code: '1', product_name: 'творог', brands: ['творог'], nutriments: {} },
    { code: '4602014004683', product_name: 'Творог', brands: ['Дмитровский'], nutriments: { 'energy-kcal_100g': 160, proteins_100g: 16, fat_100g: 9, carbohydrates_100g: 3 } },
    { code: '4602014004683', product_name: 'Творог', nutriments: { 'energy-kcal_100g': 160 } },
    { code: '3', product_name: 'Творог 5%', nutriments: { 'energy-kcal_100g': 121, proteins_100g: 17 } }
  ];
  const h = setup(t, { respond: async () => ({ status: 200, data: { hits } }) });
  const r = await h.food.search('u1', '  ТВОРОГ ', 'ru');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map(x => x.code), ['4602014004683', '3']);
  assert.equal(r.body.items[0].brand, 'Дмитровский');
  assert.match(h.calls[0].url, /^https:\/\/search\.openfoodfacts\.org\/search\?q=%D1%82%D0%B2%D0%BE%D1%80%D0%BE%D0%B3&langs=ru,en&/);
  assert.equal((await h.food.search('u2', 'творог', 'ru')).body.cached, true);
  assert.equal(h.calls.length, 1);
  assert.equal((await h.food.search('u1', 'тв', 'ru')).status, 400);
});

test('search: its own, tighter limit, and unreachable when the answer is not the expected shape', async t => {
  let shape = 'ok';
  const h = setup(t, { respond: async () => (shape === 'ok' ? { status: 200, data: { hits: [] } } : { status: 200, data: { error: 'x' } }) });
  let ok = 0;
  for (let i = 0; i < 12; i++) if ((await h.food.search('u' + i, 'query number ' + i)).status === 200) ok++;
  assert.equal(ok, LIMITS.search);
  h.tick(61000);
  shape = 'bad';
  assert.deepEqual(await h.food.search('u1', 'something else'), { status: 502, body: { error: 'unreachable' } });
});

test('the cache is its own file, survives a restart, and the admin can empty it', async t => {
  const h = setup(t, { respond: async () => ({ status: 200, data: { status: 1, product: TVOROG } }) });
  await h.food.barcode('u1', '4602014004683', 'ru');
  assert.deepEqual(h.food.stats(), { products: 1, searches: 0 });
  await new Promise(r => setTimeout(r, 2200));                       // the debounced write
  const file = path.join(h.dataDir, 'off-cache.json');
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).products['4602014004683'].food);
  const reborn = createFood({ dataDir: h.dataDir, atomicWrite, settings: h.settings, now: () => 1_005_000, fetch: async () => { throw new Error('must not be asked'); } });
  assert.equal((await reborn.barcode('u1', '4602014004683', 'ru')).body.cached, true);
  reborn.clearCache();
  assert.deepEqual(reborn.stats(), { products: 0, searches: 0 });
  assert.equal(fs.existsSync(file), false);
});

test('settings: unknown fields are ignored, the shortcut link must be https, defaults are off, photo limits are bounded', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-set-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const s = createSettings({ dataDir, atomicWrite });
  const PHOTOS = { enabled: false, quotaMb: 500, mealDays: 0 };
  assert.deepEqual(s.get(), { food: { lookup: false, contact: '' }, health: { enabled: false, shortcutUrl: '' }, photos: PHOTOS });
  s.patch({ food: { lookup: 'yes', admin: true }, health: { enabled: true, shortcutUrl: 'javascript:alert(1)' }, other: 1 });
  assert.deepEqual(s.get(), { food: { lookup: false, contact: '' }, health: { enabled: true, shortcutUrl: '' }, photos: PHOTOS });
  // the photo store: a switch that must be exactly `true`, and two numbers that must be sane
  s.patch({ photos: { enabled: 1, quotaMb: '9000', mealDays: 2.5, path: '/etc' } });
  assert.deepEqual(s.get().photos, PHOTOS);
  s.patch({ photos: { enabled: true, quotaMb: 2000, mealDays: 180 } });
  assert.deepEqual(createSettings({ dataDir, atomicWrite }).get().photos, { enabled: true, quotaMb: 2000, mealDays: 180 });
  s.patch({ photos: { quotaMb: 5, mealDays: 99999 } });
  assert.deepEqual(s.get().photos, { enabled: true, quotaMb: 2000, mealDays: 180 });
  s.patch({ health: { shortcutUrl: 'https://www.icloud.com/shortcuts/abc' } });
  assert.equal(createSettings({ dataDir, atomicWrite }).get().health.shortcutUrl, 'https://www.icloud.com/shortcuts/abc');
});
