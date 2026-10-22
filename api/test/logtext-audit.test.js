/* What a debug audit of "describe the workout you did" found, one case each, so none of it can
 * come back: the text reader misreading ordinary Russian gym phrasing, days read from things that
 * are not days, the unit taken from the model instead of the text, the person's own exercise lost
 * on a case ending, two job lanes that did not wake each other, an answer that expired as
 * "the server restarted", and the proxy login's username shown to members.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const logJobs = await import('../coach/logtext-jobs.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
const { setsFromText, dateFromText, piecesForItems, splitPieces, unitFromText } = await import('../coach/core/logtext-parse.js');
const { validateLog, resolveLog } = await import('../coach/core/logtext.js');
const { sameWord } = await import('../coach/core/match.js');

cfg.save({ enabled: true, provider: 'fixture' });
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

const T = '2026-10-22';       // a Thursday
const rows = (n, r) => Array(n).fill(r);
const sets = line => setsFromText(line);
const day = text => dateFromText(text, T)?.iso ?? null;

/* ------------------------------ the sets ------------------------------ */

test('a comma with no space is a list between sets, a decimal only inside a number', () => {
  assert.deepEqual(sets('80x8,85x6,90x4'), [{ reps: 8, weight: 80 }, { reps: 6, weight: 85 }, { reps: 4, weight: 90 }]);
  assert.deepEqual(sets('60x10,70x8'), [{ reps: 10, weight: 60 }, { reps: 8, weight: 70 }]);
  assert.deepEqual(sets('3х8,80'), rows(3, { reps: 8, weight: 80 }));
  assert.deepEqual(sets('3x10,3x8'), [...rows(3, { reps: 10 }), ...rows(3, { reps: 8 })]);
  assert.deepEqual(sets('22,5x8'), [{ reps: 8, weight: 22.5 }]);
  assert.deepEqual(sets('3x8 по 82,5'), rows(3, { reps: 8, weight: 82.5 }));
});

test('"разводка", "разгибания" and "разведения" are exercises, not the word "раз"', () => {
  assert.deepEqual(splitPieces('жим 3х8 80, разводка 3х12 14'), ['жим 3х8 80', 'разводка 3х12 14']);
  const text = 'жим 3х8 80\nразводка 3х12 14\nразгибания 3х15 20';
  const lines = piecesForItems(text, [{ said: 'жим' }, { said: 'разводка' }, { said: 'разгибания' }], T);
  assert.deepEqual(lines.map(sets), [rows(3, { reps: 8, weight: 80 }), rows(3, { reps: 12, weight: 14 }), rows(3, { reps: 15, weight: 20 })]);
  // "раз" itself is still the word for times.
  assert.deepEqual(sets('80 кг 10 раз'), [{ reps: 10, weight: 80 }]);
});

test('the preposition "с" is not seconds: "с паузой", "с гантелями", "с весом"', () => {
  assert.deepEqual(sets('80х8 с паузой'), [{ reps: 8, weight: 80 }]);
  assert.deepEqual(sets('5х5 с паузой 100'), rows(5, { reps: 5, weight: 100 }));
  assert.deepEqual(sets('3х12 с гантелями 10'), rows(3, { reps: 12, weight: 10 }));
  assert.deepEqual(sets('3х8 с весом 10'), rows(3, { reps: 8, weight: 10 }));
  assert.deepEqual(sets('3 по 10 с гантелями 12'), rows(3, { reps: 10, weight: 12 }));
  assert.deepEqual(sets('3 по 60 с'), rows(3, { sec: 60 }), 'at the end of the line "с" still is seconds');
});

test('several NxM groups on a line: sets × reps at a weight, group by group', () => {
  assert.deepEqual(sets('3x10 60, 2x8 70'), [...rows(3, { reps: 10, weight: 60 }), ...rows(2, { reps: 8, weight: 70 })]);
  assert.deepEqual(sets('3х5 100 кг, 1х3 120'), [...rows(3, { reps: 5, weight: 100 }), { reps: 3, weight: 120 }]);
  assert.deepEqual(sets('гантели 2x20кг 3x10'), rows(3, { reps: 10, weight: 20 }), '"2x20кг" is the load, not a set');
  assert.deepEqual(sets('8х15х3'), rows(3, { reps: 15, weight: 8 }), 'both ends small: the smaller is the sets');
  assert.deepEqual(sets('80x8, 85x6'), [{ reps: 8, weight: 80 }, { reps: 6, weight: 85 }]);
});

test('minutes: counted minutes stay minutes, a speed is a speed, a rest is not a set', () => {
  assert.deepEqual(sets('4x5 мин'), rows(4, { min: 5 }));
  assert.deepEqual(sets('3 по 1 мин'), rows(3, { min: 1 }));
  assert.deepEqual(sets('10 мин 6 км/ч'), [{ min: 10, speed: 6 }]);
  assert.deepEqual(sets('3 подхода по 8 по 80 отдых 2 мин'), rows(3, { reps: 8, weight: 80 }));
  assert.deepEqual(sets('80 кг 10 раз отдых 2 минуты'), [{ reps: 10, weight: 80 }]);
});

test('a warm-up word marks only the sets it comes before', () => {
  assert.deepEqual(sets('5х5 100 после разминки'), rows(5, { reps: 5, weight: 100 }));
  assert.deepEqual(sets('3х8 80 (разминка 2х10 40)'), [...rows(3, { reps: 8, weight: 80 }), ...rows(2, { reps: 10, weight: 40, warmup: true })]);
  assert.deepEqual(sets('разминка 2х10 по 40'), rows(2, { reps: 10, weight: 40, warmup: true }));
});

test('the set count in words, wherever it stands', () => {
  assert.deepEqual(sets('3 подхода 8 повторений 80 кг'), rows(3, { reps: 8, weight: 80 }));
  assert.deepEqual(sets('10 повторений 3 подхода 50 кг'), rows(3, { reps: 10, weight: 50 }));
  assert.deepEqual(sets('80кг 10 раз 3 подхода'), rows(3, { reps: 10, weight: 80 }));
  assert.deepEqual(sets('bench 3 sets 8 reps 80kg'), rows(3, { reps: 8, weight: 80 }));
});

test('a note in brackets, an angle or a percentage is not the load', () => {
  assert.deepEqual(sets('3х8 82.5 (+2.5)'), rows(3, { reps: 8, weight: 82.5 }));
  assert.deepEqual(sets('45° 3х10 24'), rows(3, { reps: 10, weight: 24 }));
  assert.deepEqual(sets('на наклонной 30° 3х10 24'), rows(3, { reps: 10, weight: 24 }));
  assert.deepEqual(sets('+10 кг 3х8'), rows(3, { reps: 8, weight: 10 }), 'added load alone is still the load');
});

test('a name is matched as whole words from its start: "жим" is not inside "отжимания"', () => {
  const lines = piecesForItems('отжимания 3х20\nжим 3х8 80', [{ said: 'отжимания от пола' }, { said: 'жим' }], T);
  assert.equal(lines[0], null);
  assert.deepEqual(sets(lines[1]), rows(3, { reps: 8, weight: 80 }));
});

/* ------------------------------ the day ------------------------------ */

test('an explicit date beats a weekday next to it; "last week" means last week', () => {
  assert.equal(day('Среда 14.10'), '2026-10-14');
  assert.equal(day('среда, 14 октября'), '2026-10-14');
  assert.equal(day('в среду, 14.10'), '2026-10-14');
  assert.equal(day('Wednesday, October 14'), '2026-10-14');
  assert.equal(day('Вторник 13 октября, грудь'), '2026-10-13');
  assert.equal(day('Четверг 22.10'), '2026-10-22', 'a header naming today is today');
  assert.equal(day('в среду на прошлой неделе'), '2026-10-14');
  assert.equal(day('wednesday last week'), '2026-10-14');
  assert.equal(day('в среду'), '2026-10-21');
});

test('durations, weights, distances, program names and words that start like a month are not days', () => {
  for (const t of ['Тренировка 1.5 часа\nжим 3х8 80', 'Workout 1.5 h', 'тренировка 2.5 часа, ноги', 'жим гантелей 3х10\n22.5',
    'бег\n2.5', 'подтягивания\n10/8', 'маятник 20 раз', 'Марафон 10 км', 'decline 5 sets of 8', '5/3/1\nприсед 5х5',
    'бег 3.5 км', 'жим 3x8 по 22.5']) {
    assert.equal(day(t), null, t);
  }
  assert.equal(day('жим 3х8\n13.10'), '2026-10-13', 'a recent date on a line of its own is still the day');
});

/* ------------------------------ the unit ------------------------------ */

test('the unit is what the text says; a model that assumed "kg" does not convert a pound profile', () => {
  assert.equal(unitFromText('bench 135 lbs 3x5'), 'lb');
  assert.equal(unitFromText('жим 80 кг'), 'kg');
  assert.equal(unitFromText('жим 3х8 80'), null);
  const item = { said: 'bench', names: ['barbell bench press'], create: { name: 'x' }, sets: [] };
  assert.equal(validateLog({ unit: 'kg', items: [item] }, { today: T, text: 'bench 3x8 185' }).result.unit, null);
  assert.equal(validateLog({ items: [item] }, { today: T, text: 'bench 135 lbs 3x5' }).result.unit, 'lb');
  assert.equal(validateLog({ unit: 'lb', items: [item] }, { today: T }).result.unit, 'lb', 'without the text the model’s word stands');
});

/* ------------------------------ the person's own exercises ------------------------------ */

test('their own exercise is recognised in any case: "в хаммере", "бабочку", "в гравитроне"', () => {
  assert.ok(sameWord('хаммере', 'хаммер') && sameWord('бабочку', 'бабочка') && sameWord('гравитроне', 'гравитрон'));
  assert.ok(!sameWord('жим', 'жима') && !sameWord('разводка', 'разгибания'));
  const customs = [{ id: 'c1', n: 'Хаммер' }, { id: 'c2', n: 'Бабочка' }];
  const v = validateLog({ items: [
    { said: 'жим в хаммере', names: ['lever chest press'], customId: 'c1', create: { name: 'x' }, sets: [] },
    { said: 'бабочку', names: ['lever pec deck fly'], customId: 'c2', create: { name: 'x' }, sets: [] }
  ] }, { customs, today: T });
  assert.deepEqual(v.result.items.map(i => i.customId), ['c1', 'c2']);
  // And without the model's id, the words alone still find it.
  const r = resolveLog({ items: [{ said: 'бабочку', names: ['zzz'], create: { name: 'x' }, sets: [] }] }, { customEx: customs });
  assert.equal(r.items[0].matches[0].id, 'c2');
});

/* ------------------------------ the lanes ------------------------------ */

const lookupOnly = uid => writeState(DIR, uid, sampleState({ coach: { lookupConsent: { agreedAt: '2026-10-01T10:00:00Z', version: 1 } } }));
const settle = async (uid, id) => {
  for (let i = 0; i < 200; i++) {
    const s = logJobs.get(uid, id);
    if (s.state === 'done' || s.state === 'failed') return s;
    await new Promise(r => setTimeout(r, 25));
  }
  return logJobs.get(uid, id);
};

test('a slot handed back by another lane starts a workout read that was waiting for one', async () => {
  lookupOnly('aud1');
  const held = [];
  while (jobs.acquireSlot()) held.push(1);          // every slot taken, as by two photos being read
  try {
    const { id } = logJobs.start('aud1', { text: 'barbell bench press 3x8 80' });
    await new Promise(r => setTimeout(r, 60));
    assert.equal(logJobs.get('aud1', id).state, 'queued');
    jobs.releaseSlot(); held.pop();                  // a food job finishing
    const s = await settle('aud1', id);
    assert.equal(s.state, 'done', 'the waiting read ran on the freed slot');
  } finally { while (held.length) { jobs.releaseSlot(); held.pop(); } }
});

test('an answer collected too late says it expired, not that the server restarted — and only to its owner', async () => {
  lookupOnly('aud2');
  const { id } = logJobs.start('aud2', { text: 'barbell bench press 3x8 80' });
  assert.equal((await settle('aud2', id)).state, 'done');
  logJobs.sweep(Date.now() + 30 * 60000);
  assert.equal(logJobs.get('aud2', id).state, 'done', 'still there half an hour later');
  logJobs.sweep(Date.now() + 2 * 60 * 60000);
  assert.deepEqual(logJobs.get('aud2', id), { state: 'failed', code: 'expired' });
  assert.deepEqual(logJobs.get('someone-else', id), { state: 'failed', code: 'restart' });
  assert.deepEqual(logJobs.get('aud2', 'never-was'), { state: 'failed', code: 'restart' });
});

/* ------------------------------ the proxy login ------------------------------ */

test('the username of a proxy login is never shown to members', () => {
  cfg.save({ provider: 'compatible', providerOptions: { compatible: { baseUrl: 'http://127.0.0.1:9' } } });
  try {
    cfg.saveAuth('compatible', { type: 'basic', account: 'gymproxy', data: cfg.encrypt({ token: 'gymproxy:secret' }), connectedAt: new Date().toISOString() });
    const a = cfg.accountFor('member-1');
    assert.equal(a.connected, true);
    assert.equal(a.account, null);
    assert.ok(!JSON.stringify(a).includes('gymproxy'));
    cfg.saveAuth('compatible', { type: 'apikey', account: 'household key', data: cfg.encrypt({ token: 'k' }), connectedAt: new Date().toISOString() });
    assert.equal(cfg.accountFor('member-1').account, 'household key', 'an API key’s label is still shown');
  } finally {
    cfg.saveAuth('compatible', null);
    cfg.save({ provider: 'fixture' });
  }
});
