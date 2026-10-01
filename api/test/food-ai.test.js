/* The food diary's provider calls: a plate read, a label read, a meal suggested.
 *
 * Three layers, tested apart because they fail apart. The core (food.js) decides what an answer
 * may contain — and holds a guessing model to what food can physically be. The adapters decide
 * how a photograph travels to each provider. The job lane (food-jobs.js) decides who may ask,
 * what it costs, and — the property this file exists for — that the photograph never reaches
 * a disk. The last runs through the fixture provider like every other job test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const foodJobs = await import('../coach/food-jobs.js');
const { coachRoutes } = await import('../coach/routes.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
const {
  cleanPer100, buildFoodPayload, cleanSuggestContext, checkImage, validateMeal, validateLabel, validateSuggest,
  FOOD_KINDS, MAX_ITEMS, MAX_CAPTION, MAX_OWN_FOODS, MAX_IMAGE_B64
} = await import('../coach/core/food.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');
const { attemptOnce } = await import('../coach/core/pipeline.js');
const { SCHEMAS } = await import('../coach/core/schemas.js');
const { PROMPTS } = await import('../coach/core/prompts.js');
const anthropic = (await import('../coach/core/adapters/anthropic.js')).default;
const openai = (await import('../coach/core/adapters/openai.js')).default;
const gemini = (await import('../coach/core/adapters/gemini.js')).default;
const compatible = (await import('../coach/core/adapters/compatible.js')).default;
const { adapterFor } = await import('../coach/adapters/index.js');

cfg.save({ enabled: true, provider: 'fixture' });
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('SECRET-PLATE-PIXELS-'.repeat(40))]).toString('base64');
const consented = (uid, over = {}) => writeState(DIR, uid, sampleState({ lang: 'ru', coach: { foodConsent: { agreedAt: '2026-10-01T10:00:00Z', version: 1 } }, ...over }));
const settle = async (uid, id) => {
  for (let i = 0; i < 200; i++) {
    const s = foodJobs.get(uid, id);
    if (s.state === 'done' || s.state === 'failed') return s;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('the job never finished');
};

/* ------------------------------ what food can be ------------------------------ */

test('cleanPer100 keeps a sane food as given', () => {
  assert.deepEqual(cleanPer100({ kcal: 165, p: 31, f: 3.6, c: 0 }), { k: 165, p: 31, f: 3.6, c: 0 });
  assert.deepEqual(cleanPer100({ kcal: '121', p: '17,2', f: 5, c: 1.8 }), { k: 121, p: 17.2, f: 5, c: 1.8 });
});

test('cleanPer100 holds a guess to what food can physically be', () => {
  // energy that contradicts the macros is replaced by what the macros add up to, and flagged
  assert.deepEqual(cleanPer100({ kcal: 900, p: 3.4, f: 0.6, c: 19.9 }), { k: 99, p: 3.4, f: 0.6, c: 19.9, fixed: true });
  // more than 100 g of macros in 100 g is scaled back to 100
  const over = cleanPer100({ kcal: 400, p: 60, f: 60, c: 80 });
  assert.ok(Math.abs(over.p + over.f + over.c - 100) < 0.2);
  // nothing holds more energy than pure fat
  assert.equal(cleanPer100({ kcal: 4000, p: 0, f: 0, c: 0 }).k, 900);
  // no energy given: worked out from the macros
  assert.deepEqual(cleanPer100({ p: 10, f: 10, c: 10 }), { k: 170, p: 10, f: 10, c: 10, fixed: true });
  // spirits: energy and no macros is not a contradiction
  assert.deepEqual(cleanPer100({ kcal: 231, p: 0, f: 0, c: 0 }), { k: 231, p: 0, f: 0, c: 0 });
  assert.deepEqual(cleanPer100({ kcal: 'abc', p: -5, f: null, c: undefined }), { k: 0, p: 0, f: 0, c: 0 });
});

/* ------------------------------ what leaves ------------------------------ */

test('a meal payload carries the caption, the language and whether there is a photo — nothing about the person', () => {
  const p = buildFoodPayload('meal', { caption: '  гречка с курицей,\n тарелка 300 г ', lang: 'ru', hasPhoto: true });
  assert.deepEqual(p, { coach_contract: 1, task: 'meal', meta: { lang: 'ru' }, photo: true, caption: 'гречка с курицей, тарелка 300 г' });
  assert.equal(buildFoodPayload('meal', { caption: 'x'.repeat(MAX_CAPTION + 80) }).caption.length, MAX_CAPTION);
  assert.deepEqual(buildFoodPayload('label', { lang: 'ru', caption: 'ignored' }), { coach_contract: 1, task: 'label', meta: { lang: 'ru' }, photo: true });
});

test('a suggestion payload is numbers and short names: what the client sent, cut to size', () => {
  const ctx = cleanSuggestContext({
    meal: 'dinner', wish: '  без молочного  ', remaining: { kcal: 712.6, p: 48.2, f: 20, c: 85 }, target: { kcal: 2400, p: 150, f: 70, c: 290 },
    foods: [
      { id: 'f0', name: 'Куриная грудка', kcal100: 165, p100: 31, f100: 3.6, c100: 0, uid: 'u1', notes: 'private' },
      { id: 'f0', name: 'duplicate id' }, { id: '../x', name: 'bad id' }, { id: 'f2', name: '' }, 'junk',
      ...Array.from({ length: 60 }, (_, i) => ({ id: 'g' + i, name: 'food ' + i, kcal100: 100 }))
    ],
    workouts: ['leak'], bodyweight: [80]
  });
  assert.deepEqual(Object.keys(ctx).sort(), ['foods', 'meal', 'remaining', 'target', 'wish']);
  assert.equal(ctx.wish, 'без молочного');
  assert.deepEqual(ctx.remaining, { kcal: 713, p: 48, f: 20, c: 85 });
  assert.equal(ctx.foods.length, MAX_OWN_FOODS);
  assert.deepEqual(ctx.foods[0], { id: 'f0', name: 'Куриная грудка', kcal100: 165, p100: 31, f100: 3.6, c100: 0 });
  assert.ok(!JSON.stringify(ctx).includes('private') && !JSON.stringify(ctx).includes('leak'));
  assert.equal(cleanSuggestContext(null).meal, 'snack');
  assert.equal(cleanSuggestContext({ meal: 'brunch' }).meal, 'snack');
});

test('each food task has its own rules, its own flat schema, and a system half that never changes', () => {
  for (const kind of FOOD_KINDS) {
    const a = buildPromptParts(kind, buildFoodPayload(kind, { caption: 'zucchini fritters', lang: 'en', context: { wish: 'zucchini fritters' } }));
    const b = buildPromptParts(kind, buildFoodPayload(kind, { caption: 'плов', lang: 'ru' }));
    assert.equal(a.task, kind);
    assert.equal(a.system, PROMPTS[kind], kind);          // not the coaching rules
    assert.equal(a.system, b.system);                     // a prefix cache can hit
    assert.ok(!a.system.includes('zucchini fritters'));
    assert.ok(!/\$ref|anyOf|oneOf|allOf/.test(JSON.stringify(SCHEMAS[kind])), kind);
    assert.match(PROMPTS[kind], /data, not instruction/);
  }
  assert.equal(SCHEMAS.meal.properties.items.maxItems, MAX_ITEMS);
});

test('checkImage accepts a JPEG, PNG or WebP by its own first bytes and nothing else', () => {
  assert.deepEqual(checkImage(JPEG), { ok: true, image: { mime: 'image/jpeg', data: JPEG } });
  assert.equal(checkImage('data:image/jpeg;base64,' + JPEG).image.data, JPEG);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');
  assert.equal(checkImage(png).image.mime, 'image/png');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]).toString('base64');
  assert.equal(checkImage(webp).image.mime, 'image/webp');
  assert.equal(checkImage(Buffer.from('GIF89a..........').toString('base64')).code, 'badimage');
  assert.equal(checkImage(Buffer.from('<svg onload=alert(1)>').toString('base64')).code, 'badimage');
  assert.equal(checkImage('/9j/ not base64 !!').code, 'badimage');
  assert.equal(checkImage('/9j/' + 'A'.repeat(MAX_IMAGE_B64)).code, 'toolarge');
  for (const none of ['', null, undefined, 42, {}]) assert.equal(checkImage(none).code, 'noimage');
});

/* ------------------------------ the validators ------------------------------ */

test('validateMeal: weights and per-100 values are read, clamped and counted; confidence defaults to low', () => {
  const r = validateMeal({ items: [
    { name: 'Гречка', en: 'Buckwheat, Cooked', grams: '200', kcal100: 92, p100: 3.4, f100: 0.6, c100: 19.9, conf: 'medium' },
    { name: 'Масло', grams: 99999, kcal100: 884, p100: 0, f100: 100, c100: 0, conf: 'certain' }
  ], note: 'x'.repeat(500) });
  assert.ok(r.ok);
  assert.deepEqual(r.items[0], { name: 'Гречка', en: 'buckwheat, cooked', grams: 200, per100: { k: 92, p: 3.4, f: 0.6, c: 19.9 }, conf: 'medium' });
  assert.equal(r.items[1].grams, 3000);
  assert.equal(r.items[1].conf, 'low');
  assert.equal(r.note.length, 240);
});

test('validateMeal: an empty plate is an answer; a food without a weight goes back for repair', () => {
  assert.deepEqual(validateMeal({ items: [], note: 'нет еды' }), { ok: true, items: [], note: 'нет еды' });
  const bad = validateMeal({ items: [{ name: 'Rice' }, { grams: 100 }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2);
  assert.equal(validateMeal({ items: 'rice' }).ok, false);
  assert.equal(validateMeal([]).ok, false);
  assert.equal(validateMeal({ items: Array.from({ length: 30 }, () => ({ name: 'x', grams: 10, kcal100: 10 })) }).items.length, MAX_ITEMS);
});

test('validateLabel: copies a per-100 g panel, converts kilojoules and a per-serving panel', () => {
  assert.deepEqual(validateLabel({ found: true, name: 'Творог 5%', brand: 'Простоквашино', per: '100g', kcal: 121, protein: 17.2, fat: 5, carbs: 1.8, servingGrams: 180, note: '' }),
    { ok: true, food: { n: 'Творог 5%', k: 121, p: 17.2, f: 5, c: 1.8, brand: 'Простоквашино', sv: 180 }, note: '' });
  assert.equal(validateLabel({ found: true, kj: 506, protein: 17.2, fat: 5, carbs: 1.8 }).food.k, 121);
  // 180 g serving: 219 kcal, 31 g protein → per 100 g
  const s = validateLabel({ found: true, per: 'serving', kcal: 219, protein: 31, fat: 9, carbs: 3.2, servingGrams: 180 }).food;
  assert.deepEqual([s.k, s.p, s.f, s.c, s.sv], [122, 17.2, 5, 1.8, 180]);
});

test('validateLabel: no panel is an answer; per serving without the serving weight, or no numbers, goes back', () => {
  assert.deepEqual(validateLabel({ found: false, note: 'нет таблицы' }), { ok: true, food: null, note: 'нет таблицы' });
  assert.match(validateLabel({ found: true, per: 'serving', kcal: 219 }).errors[0], /servingGrams/);
  assert.equal(validateLabel({ found: true, name: 'x' }).ok, false);
  // printed energy that contradicts the printed macros: kept consistent, and the user is asked to look
  assert.equal(validateLabel({ found: true, kcal: 800, protein: 10, fat: 5, carbs: 20 }).food.check, true);
});

test('validateSuggest: only the user’s own ids are kept as ids; a foreign one becomes an ordinary food', () => {
  const r = validateSuggest({ ideas: [
    { title: 'Ужин', why: 'закрывает белок', items: [{ id: 'f0', name: 'Куриная грудка', grams: 153 }, { id: 'not-yours', name: 'Помидор', grams: 120, kcal100: 18, p100: 0.9, f100: 0.2, c100: 3.9 }, { name: 'no weight' }] },
    { title: 'empty', items: [] }
  ] }, { ids: ['f0'] });
  assert.ok(r.ok);
  assert.equal(r.ideas.length, 1);
  assert.equal(r.ideas[0].items[0].id, 'f0');
  assert.equal('id' in r.ideas[0].items[1], false);
  assert.deepEqual(r.ideas[0].items[1].per100, { k: 18, p: 0.9, f: 0.2, c: 3.9 });
  assert.equal(r.ideas[0].items.length, 2);
  assert.deepEqual(validateSuggest({ ideas: [] }), { ok: true, ideas: [] });
  assert.equal(validateSuggest({ ideas: [{ title: 'x', items: [{ name: 'no grams' }] }] }).ok, false);
});

/* ------------------------------ how a photograph travels ------------------------------ */

function capture() {
  const calls = [];
  const f = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => '{}' }; };
  f.calls = calls;
  return f;
}
const env = { ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', GEMINI_API_KEY: 'k', OPENAI_COMPAT_API_KEY: 'k' };
const cfgCompat = { provider: 'compatible', providerOptions: { compatible: { baseUrl: 'http://ollama.lan:11434/' } } };
const IMG = [{ mime: 'image/jpeg', data: JPEG }];

test('Anthropic: the picture is a base64 image block ahead of the text', async () => {
  const f = capture();
  await anthropic.invoke({ cfg: {}, env, fetch: f, model: 'm', prompt: 'P', system: 'S', images: IMG, maxTokens: 3000 });
  assert.deepEqual(f.calls[0].messages[0].content, [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } }, { type: 'text', text: 'P' }]);
  assert.equal(f.calls[0].max_tokens, 3000);
});

test('OpenAI and every compatible server: a data: URL in an image_url part after the text', async () => {
  for (const [adapter, c] of [[openai, {}], [compatible, cfgCompat]]) {
    const f = capture();
    await adapter.invoke({ cfg: c, env, fetch: f, model: 'm', prompt: 'P', system: 'S', images: IMG });
    assert.deepEqual(f.calls[0].messages[1].content, [{ type: 'text', text: 'P' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + JPEG } }], adapter.id);
  }
});

test('Gemini: inline_data ahead of the text', async () => {
  const f = capture();
  await gemini.invoke({ cfg: {}, env, fetch: f, model: 'm', prompt: 'P', system: 'S', images: IMG });
  assert.deepEqual(f.calls[0].contents[0].parts, [{ inline_data: { mime_type: 'image/jpeg', data: JPEG } }, { text: 'P' }]);
});

test('without a picture every provider gets the plain request it always got', async () => {
  for (const [adapter, c] of [[anthropic, {}], [openai, {}], [compatible, cfgCompat], [gemini, {}]]) {
    const f = capture();
    await adapter.invoke({ cfg: c, env, fetch: f, model: 'm', prompt: 'P', system: 'S' });
    const body = f.calls[0];
    const user = adapter.id === 'gemini' ? body.contents[0].parts : adapter.id === 'anthropic' ? body.messages[0].content : body.messages[1].content;
    assert.deepEqual(user, adapter.id === 'gemini' ? [{ text: 'P' }] : 'P', adapter.id);
    assert.ok(!JSON.stringify(body).includes('image'), adapter.id);
  }
});

test('a provider that cannot be sent pictures is refused before anything is spent; a blind model is told apart from a broken one', async () => {
  let called = 0;
  const blindCli = { id: 'claude', spawns: true, invoke: async () => { called++; return { code: 0, text: '{}' }; } };
  const r = await attemptOnce({ adapter: blindCli, cfg: {}, kind: 'meal', payload: buildFoodPayload('meal', { hasPhoto: true }), images: IMG });
  assert.deepEqual(r, { ok: false, errorClass: 'novision' });
  assert.equal(called, 0);
  assert.equal(adapterFor('claude').images, undefined);
  assert.equal(adapterFor('codex').images, undefined);
  for (const id of ['anthropic', 'openai', 'gemini', 'compatible', 'fixture']) assert.equal(adapterFor(id).images, true, id);

  const refuses = { id: 'compatible', spawns: false, images: true, invoke: async () => ({ code: 1, text: '', stderr: '400 this model does not support image input' }) };
  assert.equal((await attemptOnce({ adapter: refuses, cfg: {}, kind: 'meal', payload: buildFoodPayload('meal', { hasPhoto: true }), images: IMG })).errorClass, 'novision');
  // the same words about a text-only request are an ordinary provider failure
  assert.equal((await attemptOnce({ adapter: refuses, cfg: {}, kind: 'meal', payload: buildFoodPayload('meal', { caption: 'rice' }) })).errorClass, 'provider');
});

/* ------------------------------ the job lane ------------------------------ */

test('a described meal: the draft comes back clamped, and the food cap — not the Coach’s — is what it cost', async () => {
  consented('food1');
  const before = jobs.capState('food1').used;
  const { id } = foodJobs.start('food1', { kind: 'meal', caption: 'гречка с курицей', lang: 'ru' });
  const s = await settle('food1', id);
  assert.equal(s.state, 'done');
  assert.equal(s.result.items.length, 2);
  assert.equal(s.result.items[0].name, 'гречка с курицей');
  assert.equal(s.result.items[1].grams, 200);                       // "200" as text
  assert.deepEqual(s.result.items[1].per100, { k: 99, p: 3.4, f: 0.6, c: 19.9, fixed: true });   // 900 kcal of buckwheat, corrected
  assert.equal(s.result.items[1].conf, 'low');                      // "certain" is not a level
  assert.equal(s.result.note, 'Estimated from the description.');
  assert.deepEqual(jobs.foodCapState('food1'), { used: 1, limit: 30 });
  assert.equal(jobs.capState('food1').used, before);
});

test('a photographed meal runs, and the photograph is nowhere on disk afterwards — not in the profile, not in the log', async () => {
  consented('food2');
  const { id } = foodJobs.start('food2', { kind: 'meal', image: JPEG, caption: 'обед' });
  const s = await settle('food2', id);
  assert.equal(s.state, 'done');
  assert.equal(s.result.note, 'Estimated from the photo.');
  const needle = JPEG.slice(40, 120), plain = 'SECRET-PLATE-PIXELS';
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(DIR);
  assert.ok(files.length > 0);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!text.includes(needle) && !text.includes(plain), `the photograph leaked into ${path.relative(DIR, f)}`);
    assert.ok(!text.includes('обед'), `the caption leaked into ${path.relative(DIR, f)}`);
  }
  // the instance log has the kind and the outcome, as for every other call
  const last = cfg.load().log.at(-1);
  assert.deepEqual([last.kind, last.outcome, last.uid], ['meal', 'ready', 'food2']);
});

test('a label and a suggestion run through the same lane', async () => {
  consented('food3');
  const label = await settle('food3', foodJobs.start('food3', { kind: 'label', image: JPEG }).id);
  assert.equal(label.state, 'done');
  // the fixture's label is per 180 g serving in kilojoules: 911 kJ → 121 kcal per 100 g
  assert.deepEqual([label.result.food.n, label.result.food.k, label.result.food.p, label.result.food.sv], ['Fixture curd 5%', 121, 17.2, 180]);

  const idea = await settle('food3', foodJobs.start('food3', { kind: 'suggest', context: { meal: 'dinner', remaining: { kcal: 700, p: 50, f: 20, c: 80 }, target: { kcal: 2400, p: 150, f: 70, c: 290 }, foods: [{ id: 'f0', name: 'Куриная грудка', kcal100: 165, p100: 31, f100: 3.6, c100: 0 }] } }).id);
  assert.equal(idea.state, 'done');
  assert.equal(idea.result.ideas[0].items[0].id, 'f0');
  assert.equal('id' in idea.result.ideas[0].items[1], false);        // "not-yours" was not theirs
});

test('refused before anything is spent: no go-ahead, nothing to read, a bad picture, an unknown kind', () => {
  writeState(DIR, 'food4', sampleState({ coach: { consent: { agreedAt: '2026-10-01T10:00:00Z', version: 1 } } }));
  // the Coach's full consent does not cover a photograph of dinner
  assert.throws(() => foodJobs.start('food4', { kind: 'meal', caption: 'rice' }), e => e.code === 'consent');
  consented('food5');
  assert.throws(() => foodJobs.start('food5', { kind: 'meal' }), e => e.code === 'empty');
  assert.throws(() => foodJobs.start('food5', { kind: 'label' }), e => e.code === 'noimage');
  assert.throws(() => foodJobs.start('food5', { kind: 'meal', image: 'bm90IGFuIGltYWdl' }), e => e.code === 'badimage');
  assert.throws(() => foodJobs.start('food5', { kind: 'meal', image: '/9j/' + 'A'.repeat(MAX_IMAGE_B64) }), e => e.code === 'toolarge');
  assert.throws(() => foodJobs.start('food5', { kind: 'plan', caption: 'x' }), e => e.code === 'kind');
  assert.deepEqual(jobs.foodCapState('food5').used, 0, 'none of them counted');
});

test('one at a time per profile, a daily cap of its own, and a job nobody knows reads as a restart', async () => {
  consented('food6');
  const first = foodJobs.start('food6', { kind: 'meal', caption: 'rice' });
  assert.throws(() => foodJobs.start('food6', { kind: 'meal', caption: 'more rice' }), e => e.code === 'busy');
  await settle('food6', first.id);
  cfg.save({ caps: { ...cfg.load().caps, foodPerProfileDaily: 2 } });
  await settle('food6', foodJobs.start('food6', { kind: 'meal', caption: 'rice' }).id);
  assert.throws(() => foodJobs.start('food6', { kind: 'meal', caption: 'rice' }), e => e.code === 'cap');
  cfg.save({ caps: { ...cfg.load().caps, foodPerProfileDaily: 30 } });
  assert.deepEqual(foodJobs.get('food6', 'no-such-job'), { state: 'failed', code: 'restart' });
  assert.deepEqual(foodJobs.get('somebody-else', first.id), { state: 'failed', code: 'restart' }, 'another profile cannot collect it');
});

test('an answer with no usable shape fails as "unusable" after the one repair round; an empty plate is a result', async () => {
  consented('food7');
  process.env.FIXTURE_MODE = 'meal-broken';
  const broken = await settle('food7', foodJobs.start('food7', { kind: 'meal', caption: 'rice' }).id);
  assert.deepEqual(broken, { state: 'failed', code: 'unusable' });
  process.env.FIXTURE_MODE = 'meal-empty';
  const empty = await settle('food7', foodJobs.start('food7', { kind: 'meal', image: JPEG }).id);
  assert.deepEqual(empty.result, { items: [], note: 'No food in the picture.' });
  process.env.FIXTURE_MODE = 'label-none';
  const none = await settle('food7', foodJobs.start('food7', { kind: 'label', image: JPEG }).id);
  assert.deepEqual(none.result, { food: null, note: 'No nutrition panel in the picture.' });
  process.env.FIXTURE_MODE = '';
});

test('cancelling and forgetting: the job ends, and a forget drops what was waiting to be collected', async () => {
  consented('food8');
  process.env.FIXTURE_MODE = 'timeout';
  const { id } = foodJobs.start('food8', { kind: 'meal', caption: 'rice' });
  assert.deepEqual(foodJobs.cancel('food8', id), { ok: true });
  assert.deepEqual(foodJobs.get('food8', id), { state: 'failed', code: 'cancelled' });
  process.env.FIXTURE_MODE = '';
  // free again at once
  const done = foodJobs.start('food8', { kind: 'meal', caption: 'rice' });
  await settle('food8', done.id);
  jobs.clearUser('food8');
  assert.deepEqual(foodJobs.get('food8', done.id), { state: 'failed', code: 'restart' });
  assert.deepEqual(jobs.foodCapState('food8').used, 2, 'forgetting does not hand out a fresh cap');
});

test('a provider that takes no pictures refuses the photo and still reads a description', async () => {
  consented('food9');
  // A connected provider whose adapter cannot attach a picture — what the subscription CLIs are.
  const fixture = adapterFor('fixture');
  fixture.images = false;
  try {
    assert.throws(() => foodJobs.start('food9', { kind: 'meal', image: JPEG }), e => e.code === 'novision');
    assert.equal(jobs.foodCapState('food9').used, 0, 'the refusal cost nothing');
    const told = await settle('food9', foodJobs.start('food9', { kind: 'meal', caption: 'rice' }).id);
    assert.equal(told.state, 'done');
  } finally { fixture.images = true; }
  assert.deepEqual([cfg.publicConfig().food, cfg.publicConfig().vision], [true, true]);
});

test('the vision model is its own setting and falls back to the text model', () => {
  cfg.save({ provider: 'compatible', models: { compatible: 'qwen3:14b' }, visionModels: {} });
  try {
    assert.equal(cfg.visionModelFor(), 'qwen3:14b');
    cfg.save({ visionModels: { compatible: 'qwen2.5vl:7b' } });
    assert.equal(cfg.visionModelFor(), 'qwen2.5vl:7b');
    assert.equal(cfg.modelFor(), 'qwen3:14b');
  } finally { cfg.save({ provider: 'fixture', models: {}, visionModels: {} }); }
});

/* ------------------------------ the routes ------------------------------ */

function fakeRes() { return { code: null, body: null }; }
const routes = coachRoutes({
  json: (res, code, obj) => { res.code = code; res.body = obj; },
  readBody: async req => req.body || {},
  readSession: req => req.user || null,
  requireAdmin: (req, res) => (req.user?.admin ? req.user : (res.code = 403, null))
});

test('POST /api/coach/food starts a job and answers 202; the poll collects it; refusals carry their class', async () => {
  consented('food10');
  const res = fakeRes();
  await routes['POST /api/coach/food']({ user: { id: 'food10' }, body: { kind: 'meal', caption: 'rice', lang: 'ru' } }, res);
  assert.equal(res.code, 202);
  assert.match(res.body.job.id, /^[0-9a-f]{18}$/);
  assert.deepEqual(res.body.cap, { used: 1, limit: 30 });
  await settle('food10', res.body.job.id);
  const poll = fakeRes();
  await routes['GET /api/coach/food/job']({ user: { id: 'food10' }, url: '/api/coach/food/job?id=' + res.body.job.id }, poll);
  assert.equal(poll.body.state, 'done');

  const bad = fakeRes();
  await routes['POST /api/coach/food']({ user: { id: 'food10' }, body: { kind: 'label' } }, bad);
  assert.deepEqual([bad.code, bad.body.code], [400, 'noimage']);
  const anon = fakeRes();
  await routes['POST /api/coach/food']({ body: { kind: 'meal', caption: 'rice' } }, anon);
  assert.equal(anon.code, 401);
  writeState(DIR, 'food11', sampleState());
  const noConsent = fakeRes();
  await routes['POST /api/coach/food']({ user: { id: 'food11' }, body: { kind: 'meal', caption: 'rice' } }, noConsent);
  assert.deepEqual([noConsent.code, noConsent.body.code], [403, 'consent']);
});

test('the admin’s vision check: only for an admin, and the built-in provider says plainly that it looks at nothing', async () => {
  const denied = fakeRes();
  await routes['POST /api/admin/coach/test-vision']({ user: { id: 'u1' } }, denied);
  assert.equal(denied.code, 403);
  const res = fakeRes();
  await routes['POST /api/admin/coach/test-vision']({ user: { id: 'adm', admin: true } }, res);
  assert.equal(res.body.ok, true);
  assert.match(res.body.note, /looks at nothing/);
});
