/* "Describe it in your own words" — the exercise lookup.
 *
 * Two halves, tested apart because they fail apart. The core (match.js) decides what an answer
 * may contain and which catalogue rows an English name is; that is pure and needs no provider.
 * The server half (jobs.match) decides who may ask and what it costs, and runs through the
 * fixture provider like every other job test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const { coachRoutes } = await import('../coach/routes.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
const {
  buildMatchPayload, cleanText, validateMatch, rankLibrary, resolveMatch, tokens,
  BODY_PARTS, EQUIPMENT, MUSCLES, MAX_ITEMS, MAX_TEXT, EXACT_SCORE
} = await import('../coach/core/match.js');
const { LIB_BY_ID } = await import('../coach/core/library.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');
const { SCHEMAS } = await import('../coach/core/schemas.js');
const { PROMPTS } = await import('../coach/core/prompts.js');

cfg.save({ enabled: true, provider: 'fixture' });
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

const nameOf = id => LIB_BY_ID.get(id)?.n;
const item = (names, over = {}) => ({ said: names[0], names, bp: null, eq: null, create: { name: names[0], desc: '', primary: [], secondary: [] }, ...over });

/* ------------------------------ what leaves ------------------------------ */

test('the payload carries the words, the language and the names of their own exercises — and nothing else', () => {
  const S = sampleState({ lang: 'ru', customEx: [{ id: 'c1', n: 'Тяга к поясу в кроссовере', bp: 'back', desc: 'private notes' }] });
  const p = buildMatchPayload(S, '  жим лёжа,\n\tприсед  ');
  assert.deepEqual(Object.keys(p).sort(), ['coach_contract', 'custom', 'meta', 'task', 'text']);
  assert.equal(p.task, 'match');
  assert.deepEqual(p.meta, { lang: 'ru' });
  assert.equal(p.text, 'жим лёжа, присед');
  assert.deepEqual(p.custom, [{ id: 'c1', n: 'Тяга к поясу в кроссовере' }]);
  // No plan, no training, no body weight, no profile: nothing here is about the person.
  const wire = JSON.stringify(p);
  for (const leak of ['Full body A', 'workouts', 'bodyweight', 'private notes', 'goal']) assert.ok(!wire.includes(leak), leak);
});

test('the text is capped and stripped of control characters', () => {
  assert.equal(cleanText('a\u0000b\u0007c'), 'a b c');
  assert.equal(cleanText('x'.repeat(MAX_TEXT + 50)).length, MAX_TEXT);
  assert.equal(cleanText('   \n '), '');
  assert.equal(cleanText(null), '');
});

test('the lookup has its own rules, its own schema, and a system half that never changes', () => {
  const a = buildPromptParts('match', buildMatchPayload({ lang: 'en' }, 'zercher squat'));
  const b = buildPromptParts('match', buildMatchPayload({ lang: 'ru' }, 'присед'));
  assert.equal(a.task, 'match');
  assert.equal(a.system, PROMPTS.match);           // not the coaching rules
  assert.equal(a.system, b.system);                // a prefix cache can hit
  assert.ok(a.user.includes('zercher squat') && !a.system.includes('zercher squat'));
  assert.ok(!/\$ref|anyOf|oneOf|allOf/.test(JSON.stringify(SCHEMAS.match)));
  assert.equal(SCHEMAS.match.properties.items.maxItems, MAX_ITEMS);
});

test('the prompt names exactly the body parts and muscles the validator accepts', () => {
  for (const bp of BODY_PARTS) assert.ok(PROMPTS.match.includes('`' + bp + '`'), bp);
  for (const m of MUSCLES) assert.ok(PROMPTS.match.includes('`' + m + '`'), m);
  // Equipment in the prompt is a subset — the one-off machines are left out — but every value
  // it does offer has to be one the catalogue uses, or the hint is dropped on arrival.
  const offered = PROMPTS.match.split('- `eq`')[1].split('\n')[0].match(/`([^`]+)`/g).map(s => s.slice(1, -1)).filter(s => s !== 'eq');
  assert.ok(offered.length > 10);
  for (const eq of offered) assert.ok(EQUIPMENT.includes(eq), eq);
});

/* ------------------------------ the validator ------------------------------ */

test('a broken shape is an error the repair round can act on', () => {
  assert.equal(validateMatch(null).ok, false);
  assert.equal(validateMatch({ items: 'bench' }).ok, false);
  const r = validateMatch({ items: [{ said: 'x', names: [], create: { name: 'x' } }] });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /items\[0\]\.names/);
  // No exercise in the text is an answer, not a failure.
  assert.deepEqual(validateMatch({ coach_contract: 1, items: [] }), { ok: true, items: [] });
});

test('hints outside the closed lists are dropped, not trusted and not fatal', () => {
  const r = validateMatch({
    items: [{
      said: 'my   thing', names: ['Barbell Bench Press', 'barbell bench press', '', 42, 'bench press'],
      bp: 'torso', eq: 'anvil', customId: 'not-mine',
      create: { name: '', desc: 'd'.repeat(900), primary: ['chest', 'wings', 'chest'], secondary: ['chest', 'triceps', 'tail'] }
    }]
  }, { customIds: ['c1'] });
  assert.equal(r.ok, true);
  const it = r.items[0];
  assert.equal(it.said, 'my thing');
  assert.deepEqual(it.names, ['barbell bench press', 'bench press']);   // lowercased, deduped, strings only
  assert.equal(it.bp, null);
  assert.equal(it.eq, null);
  assert.ok(!('customId' in it));                                       // somebody else's id never survives
  assert.equal(it.create.name, 'barbell bench press');                  // falls back to the first name
  assert.equal(it.create.desc.length, 600);
  assert.deepEqual(it.create.primary, ['chest']);
  assert.deepEqual(it.create.secondary, ['triceps']);                   // not repeated from primary
});

test('their own exercise id is kept when it really is theirs, and the answer is capped', () => {
  const one = { said: 'x', names: ['squat'], create: { name: 'x' } };
  const r = validateMatch({ items: [{ ...one, customId: 'c1', bp: 'upper legs', eq: 'barbell' }, ...Array(20).fill(one)] }, { customIds: ['c1'] });
  assert.equal(r.items.length, MAX_ITEMS);
  assert.equal(r.items[0].customId, 'c1');
  assert.equal(r.items[0].bp, 'upper legs');
  assert.equal(r.items[0].eq, 'barbell');
});

/* ------------------------------ name → catalogue rows ------------------------------ */

test('spellings that mean one thing compare equal', () => {
  const same = (a, b) => assert.deepEqual([...tokens(a)].sort(), [...tokens(b)].sort(), `${a} / ${b}`);
  same('pull-ups', 'pullup');
  same('Lat Pull Down', 'lateral pulldown');
  same('dumbbell flyes', 'dumbbell fly');
  same('machine leg extensions', 'lever leg extension');
  same('triceps pushdown', 'tricep push-down');
  same('barbell full squat (back pov)', 'barbell full squat');
  assert.ok(tokens('press').has('press'));                // not a plural
  assert.ok(tokens('Тяга к поясу').has('тяга'));          // not only latin
});

test('the row the model named comes first, and its neighbours follow', () => {
  const r = rankLibrary(item(['barbell bench press', 'bench press']));
  assert.equal(nameOf(r[0].id), 'barbell bench press');
  assert.ok(r[0].score >= EXACT_SCORE);
  assert.ok(r.length > 1 && r.length <= 6);
  for (const m of r) assert.ok(/bench press/.test(nameOf(m.id)), nameOf(m.id));
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
});

test('everyday names land on the catalogue\'s own spelling of them', () => {
  const top = names => nameOf(rankLibrary(item(names))[0]?.id);
  assert.equal(top(['pull-up', 'pull up']), 'pull-up');
  assert.equal(top(['lever leg extension', 'leg extension']), 'lever leg extension');
  assert.equal(top(['barbell romanian deadlift', 'romanian deadlift']), 'barbell romanian deadlift');
  assert.equal(top(['dumbbell lateral raise', 'lateral raise']), 'dumbbell lateral raise');
  assert.equal(top(['cable pushdown', 'triceps pushdown']), 'cable pushdown');
  assert.match(top(['lat pulldown']), /pulldown/);
  assert.match(top(['sled 45° leg press', 'leg press']), /leg press/);
});

test('equipment and body part order rows whose names score alike', () => {
  const plain = rankLibrary(item(['deadlift']));
  const hinted = rankLibrary(item(['deadlift'], { eq: 'dumbbell' }));
  assert.ok(plain.length && hinted.length);
  assert.equal(LIB_BY_ID.get(hinted[0].id).eq, 'dumbbell');
});

test('a name with one shared word is not a match', () => {
  assert.deepEqual(rankLibrary(item(['underwater basket weaving press'])), []);
  assert.deepEqual(rankLibrary(item(['zzzz'])), []);
});

test('their own exercises are found by the model\'s id, by English name, and by their own words', () => {
  const customs = [
    { id: 'c1', n: 'Тяга к поясу в кроссовере', bp: 'back' },
    { id: 'c2', n: 'Landmine press', bp: 'shoulders' },
    { id: 'c3', n: 'Sled push', bp: 'upper legs' }
  ];
  const byId = rankLibrary(item(['cable seated row'], { said: 'моя тяга', customId: 'c1' }), { customs });
  assert.deepEqual(byId[0], { id: 'c1', score: 1, custom: true });

  const byName = rankLibrary(item(['landmine press']), { customs });
  assert.equal(byName[0].id, 'c2');
  assert.equal(byName[0].custom, true);

  const byWords = rankLibrary(item(['cable row'], { said: 'тяга к поясу в кроссовере' }), { customs });
  assert.ok(byWords.some(m => m.id === 'c1' && m.custom));
});

test('resolveMatch says when the best row is the name itself', () => {
  const S = { customEx: [] };
  const [hit, miss] = resolveMatch([item(['barbell bench press']), item(['reverse nordic curl on rings'])], S);
  assert.equal(hit.exact, true);
  assert.equal(nameOf(hit.matches[0].id), 'barbell bench press');
  assert.equal(miss.exact, false);
  assert.ok(miss.create.name);                      // the draft is there for exactly this case
});

/* ------------------------------ the server half ------------------------------ */

test('no consent, no lookup — the gate is on the server, not the sheet', async () => {
  const uid = 'm-noconsent';
  writeState(DIR, uid, sampleState({ coach: {} }));
  await assert.rejects(jobs.match(uid, 'barbell bench press'), e => e.code === 'consent');
});

test('the go-ahead given on the sheet unlocks lookups — and nothing that reads the training log', async () => {
  const uid = 'm-lookup-consent';
  writeState(DIR, uid, sampleState({ coach: { lookupConsent: { agreedAt: new Date().toISOString(), version: 1 } } }));
  const r = await jobs.match(uid, 'barbell bench press');
  assert.equal(r.items.length, 1);
  assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'consent');
});

test('nothing typed is refused before anything is spent', async () => {
  const uid = 'm-empty';
  writeState(DIR, uid, sampleState());
  await assert.rejects(jobs.match(uid, '   '), e => e.code === 'empty');
  assert.equal(jobs.matchCapState(uid).used, 0);
});

test('through the fixture: a typed list comes back as catalogue rows plus a draft', async () => {
  const uid = 'm-ok';
  writeState(DIR, uid, sampleState({ customEx: [{ id: 'cmine', n: 'Landmine twist', bp: 'waist' }] }));
  const r = await jobs.match(uid, 'barbell bench press, Landmine twist');
  assert.equal(r.items.length, 2);
  assert.equal(nameOf(r.items[0].matches[0].id), 'barbell bench press');
  assert.equal(r.items[0].exact, true);
  assert.equal(r.items[0].bp, 'chest');
  // The fixture offers a muscle the map cannot draw; it does not survive.
  assert.deepEqual(r.items[0].create.primary, ['chest']);
  assert.deepEqual(r.items[1].matches[0], { id: 'cmine', score: 1, custom: true });
  assert.equal(r.cap.used, 1);
  // It is on the instance log as its own kind, and it did not touch the Coach's daily count.
  assert.equal(cfg.load().log.at(-1).kind, 'match');
  assert.equal(jobs.capState(uid).used, 0);
  // Nothing was stored for the profile to come back to.
  assert.equal(jobs.readUser(uid).pending, null);
  assert.equal(jobs.readUser(uid).current, null);
});

test('an id that is not theirs is dropped on the way in', async () => {
  const uid = 'm-foreign';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'foreign-custom';
  try {
    const r = await jobs.match(uid, 'barbell bench press');
    assert.ok(r.items[0].matches.every(m => m.id !== 'not-yours'));
  } finally { delete process.env.FIXTURE_MODE; }
});

test('an answer the app cannot use fails as `unusable`, after the one repair round', async () => {
  const uid = 'm-invalid';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'invalid';
  try {
    await assert.rejects(jobs.match(uid, 'bench'), e => e.code === 'unusable');
    assert.equal(cfg.load().log.at(-1).outcome, 'failed');
  } finally { delete process.env.FIXTURE_MODE; }
  process.env.FIXTURE_MODE = 'invalid-then-valid';
  try {
    const r = await jobs.match(uid, 'barbell bench press');
    assert.equal(r.items.length, 1);
  } finally { delete process.env.FIXTURE_MODE; }
});

test('lookups have a daily cap of their own, and forgetting does not hand out a fresh one', async () => {
  const uid = 'm-cap';
  writeState(DIR, uid, sampleState());
  cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0, matchPerProfileDaily: 2 } });
  try {
    await jobs.match(uid, 'squat');
    await jobs.match(uid, 'squat');
    await assert.rejects(jobs.match(uid, 'squat'), e => e.code === 'cap');
    jobs.clearUser(uid);
    assert.equal(jobs.matchCapState(uid).used, 2);
    await assert.rejects(jobs.match(uid, 'squat'), e => e.code === 'cap');
  } finally { cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0, matchPerProfileDaily: 30 } }); }
});

test('one lookup per profile at a time', async () => {
  const uid = 'm-busy';
  writeState(DIR, uid, sampleState());
  const first = jobs.match(uid, 'squat');
  await assert.rejects(jobs.match(uid, 'squat'), e => e.code === 'busy');
  await first;
});

test('the route answers 200 with the items, and maps each refusal to its own status and code', async () => {
  const uid = 'm-route';
  writeState(DIR, uid, sampleState());
  let session = { id: uid };
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: () => session,
    requireAdmin: () => true
  });
  const call = async body => { const res = {}; await routes['POST /api/coach/match']({ body }, res); return res; };

  let r = await call({ text: 'barbell bench press' });
  assert.equal(r.status, 200);
  assert.equal(nameOf(r.body.items[0].matches[0].id), 'barbell bench press');

  r = await call({ text: '' });
  assert.deepEqual([r.status, r.body.code], [400, 'empty']);

  writeState(DIR, 'm-route-nc', sampleState({ coach: {} }));
  session = { id: 'm-route-nc' };
  r = await call({ text: 'squat' });
  assert.deepEqual([r.status, r.body.code], [403, 'consent']);

  session = { id: uid };
  process.env.FIXTURE_MODE = 'invalid';
  try {
    r = await call({ text: 'squat' });
    assert.deepEqual([r.status, r.body.code], [502, 'unusable']);
  } finally { delete process.env.FIXTURE_MODE; }

  session = null;
  r = await call({ text: 'squat' });
  assert.equal(r.status, 401);
});
