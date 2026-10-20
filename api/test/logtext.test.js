/* "Describe the workout you did": a typed-out session in, a past workout's draft out.
 *
 * The core (logtext.js) decides what an answer may contain — which numbers are a set, which day
 * "on Friday" is — and the lane (logtext-jobs.js) who may ask and what it costs. The lane runs
 * through the fixture provider like every other job test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const logJobs = await import('../coach/logtext-jobs.js');
const { coachRoutes } = await import('../coach/routes.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
const {
  buildLogPayload, cleanLogText, readSet, readWhen, validateLog, resolveLog, isISODate, MAX_LOG_TEXT, MAX_LOG_ITEMS, MAX_LOG_SETS
} = await import('../coach/core/logtext.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');
const { SCHEMAS } = await import('../coach/core/schemas.js');
const { PROMPTS } = await import('../coach/core/prompts.js');

cfg.save({ enabled: true, provider: 'fixture' });
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

const lookupOnly = (uid, over = {}) => writeState(DIR, uid, sampleState({
  lang: 'ru', coach: { lookupConsent: { agreedAt: '2026-10-01T10:00:00Z', version: 1 } }, ...over
}));
const settle = async (uid, id) => {
  for (let i = 0; i < 200; i++) {
    const s = logJobs.get(uid, id);
    if (s.state === 'done' || s.state === 'failed') return s;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('the job never finished');
};
const today = () => new Date().toISOString().slice(0, 10);
const item = (over = {}) => ({ said: 'жим', names: ['barbell bench press'], create: { name: 'Жим' }, sets: [], ...over });

/* ------------------------------ what leaves ------------------------------ */

test('the payload is the words, the language, the unit, today and the names of the person’s own exercises — no training', () => {
  const S = sampleState({ lang: 'ru', unit: 'lb', customEx: [{ id: 'c1', n: 'Мой тренажёр', bp: 'back' }] });
  const p = buildLogPayload(S, 'вчера\n  жим 3x8 80\n\nприсед 5x5 100 ', { today: '2026-10-16' });
  assert.deepEqual(p, {
    coach_contract: 1, task: 'logtext',
    meta: { lang: 'ru', unit: 'lb', today: '2026-10-16', weekday: 'friday' },
    text: 'вчера, жим 3x8 80, присед 5x5 100',
    custom: [{ id: 'c1', n: 'Мой тренажёр' }]
  });
  const leaked = JSON.stringify(p);
  for (const secret of ['Full body A', 'w1', 'rpe', '78.5', 'muscle']) assert.ok(!leaked.includes(secret), `${secret} must not leave`);
  assert.equal(buildLogPayload(S, 'x', { today: 'garbage' }).meta.today, null);
  assert.equal(cleanLogText('a'.repeat(MAX_LOG_TEXT + 50)).length, MAX_LOG_TEXT);
});

test('a standalone prompt with its own flat schema, and a system half that never changes', () => {
  const a = buildPromptParts('logtext', buildLogPayload(sampleState(), 'bench 3x8 80', { today: '2026-10-16' }));
  const b = buildPromptParts('logtext', buildLogPayload(sampleState(), 'squat 5x5 100', { today: '2026-10-15' }));
  assert.equal(a.task, 'logtext');
  assert.equal(a.system, b.system, 'the rules are byte-identical across jobs (prefix cache)');
  assert.equal(a.system, PROMPTS.logtext, 'no coaching rules ride along');
  assert.ok(!a.system.includes('2026-10-16'));
  assert.equal(SCHEMAS.logtext.properties.items.maxItems, MAX_LOG_ITEMS);
  assert.equal(SCHEMAS.logtext.properties.items.items.properties.sets.maxItems, MAX_LOG_SETS);
});

/* ------------------------------ what a set is ------------------------------ */

test('readSet: numbers are read from what a model writes, a misread is dropped rather than clamped', () => {
  assert.deepEqual(readSet({ reps: 8, weight: 80 }), { reps: 8, weight: 80 });
  assert.deepEqual(readSet({ reps: '8', weight: '82,5 kg' }), { reps: 8, weight: 82.5 });
  assert.deepEqual(readSet({ reps: 10, weight: 0 }), { reps: 10 }, 'no load is no weight field');
  assert.deepEqual(readSet({ reps: 12, weight: 31.13 }), { reps: 12, weight: 31.25 }, 'to the quarter, the smallest plate');
  assert.deepEqual(readSet({ sec: 60 }), { sec: 60 });
  assert.deepEqual(readSet({ min: 30, km: 5 }), { min: 30, speed: 10 }, 'speed worked out from distance and time');
  assert.deepEqual(readSet({ reps: 5, weight: 60, warmup: true }), { reps: 5, weight: 60, warmup: true });
  assert.equal(readSet({ reps: 9000 }), null);
  assert.equal(readSet({ weight: 80 }), null, 'a weight with nothing done under it is not a set');
  assert.equal(readSet({}), null);
  assert.equal(readSet('3x8'), null);
  assert.deepEqual(readSet({ reps: 8, weight: 5000 }), { reps: 8 }, 'an impossible load is dropped, the reps kept');
});

/* ------------------------------ which day ------------------------------ */

test('readWhen: the arithmetic is done here, against the person’s today — never by the model', () => {
  const fri = '2026-10-16';     // a Friday
  assert.equal(readWhen({ daysAgo: 0 }, fri), fri);
  assert.equal(readWhen({ daysAgo: 1 }, fri), '2026-10-15');
  assert.equal(readWhen({ daysAgo: '2' }, fri), '2026-10-14');
  assert.equal(readWhen({ weekday: 'Monday' }, fri), '2026-10-12');
  assert.equal(readWhen({ weekday: 'friday' }, fri), '2026-10-09', 'the same weekday is last week’s — today is "today"');
  assert.equal(readWhen({ weekday: 'saturday' }, fri), '2026-10-10');
  assert.equal(readWhen({ date: '2026-10-12' }, fri), '2026-10-12');
  assert.equal(readWhen({ date: '2026-10-12', daysAgo: 1 }, fri), '2026-10-12', 'a date wins');
  assert.equal(readWhen({ date: '2026-12-01' }, fri), null, 'the future is the model getting the year wrong');
  assert.equal(readWhen({ date: '2026-02-30' }, fri), null);
  assert.equal(readWhen({ date: '2020-01-01' }, fri), null, 'more than a year back');
  assert.equal(readWhen({ daysAgo: -1 }, fri), null);
  assert.equal(readWhen({ daysAgo: 1.5 }, fri), null);
  assert.equal(readWhen({ weekday: 'someday' }, fri), null);
  assert.equal(readWhen({ daysAgo: 1 }, null), null, 'no today, no arithmetic');
  assert.equal(readWhen(null, fri), null);
  assert.equal(readWhen({ daysAgo: 0 }, '2026-01-01'), '2026-01-01');
  assert.equal(readWhen({ daysAgo: 1 }, '2026-01-01'), '2025-12-31', 'across a year');
  assert.equal(readWhen({ daysAgo: 1 }, '2028-03-01'), '2028-02-29', 'a leap day');
  assert.ok(isISODate('2028-02-29') && !isISODate('2027-02-29'));
});

/* ------------------------------ the answer ------------------------------ */

test('validateLog: exercises read like a lookup, their rows checked, the day worked out, the rest optional', () => {
  const v = validateLog({
    coach_contract: 1, when: { daysAgo: 1 }, unit: 'kg', minutes: '70', start: '7:30',
    items: [
      item({ sets: [{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }, {}, { reps: 9000 }] }),
      item({ said: 'подтягивания', names: ['pull-up'], customId: 'not-yours', sets: [{ reps: 10 }] }),
      item({ said: 'планка', names: ['front plank'], sets: undefined })
    ]
  }, { customIds: ['c1'], today: '2026-10-16' });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.result.items[0].sets, [{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }]);
  assert.equal(v.result.items[1].customId, undefined, 'a custom id that is not theirs is dropped');
  assert.deepEqual(v.result.items[2].sets, [], 'an exercise without numbers is still an exercise');
  assert.deepEqual([v.result.date, v.result.start, v.result.minutes, v.result.unit], ['2026-10-15', '07:30', 70, 'kg']);

  const bare = validateLog({ coach_contract: 1, items: [] }, { today: '2026-10-16' });
  assert.deepEqual(bare.result, { items: [], date: null, start: null, minutes: null, unit: null });
  assert.equal(validateLog({ coach_contract: 1, items: [], unit: 'stone', start: '25:00', minutes: 9999 }).result.unit, null);
});

test('validateLog: a broken shape goes back for repair; past the caps the rest is cut', () => {
  assert.equal(validateLog([]).ok, false);
  assert.equal(validateLog({ items: 'bench' }).ok, false);
  assert.match(validateLog({ items: [{ said: 'x', sets: [] }] }).errors[0], /names/);
  assert.match(validateLog({ items: [item({ sets: '3x8' })] }).errors[0], /sets must be an array/);
  const many = validateLog({ items: Array.from({ length: 20 }, () => item({ sets: Array.from({ length: 40 }, () => ({ reps: 5 })) })) });
  assert.equal(many.result.items.length, MAX_LOG_ITEMS);
  assert.equal(many.result.items[0].sets.length, MAX_LOG_SETS);
});

test('resolveLog: each exercise resolved against the catalogue and the person’s own, the rows kept beside it', () => {
  const v = validateLog({ items: [item({ sets: [{ reps: 5, weight: 100 }] }), item({ said: 'мой тренажёр', names: ['zzz'], customId: 'c1' })] }, { customIds: ['c1'], today: '2026-10-16' });
  const r = resolveLog(v.result, { customEx: [{ id: 'c1', n: 'Мой тренажёр' }] });
  assert.equal(r.items[0].matches[0].id, '0025', 'barbell bench press');
  assert.equal(r.items[0].exact, true);
  assert.deepEqual(r.items[0].sets, [{ reps: 5, weight: 100 }]);
  assert.equal(r.items[1].matches[0].id, 'c1');
  assert.ok(r.items[1].create.name);
});

/* ------------------------------ the lane ------------------------------ */

test('a described workout is read through the lane: exercises resolved, rows and day back, the lookup count spent', async () => {
  lookupOnly('log1');
  const { id } = logJobs.start('log1', { text: 'yesterday barbell bench press 3x8 80, barbell full squat 5x5 100, pull-up', today: today() });
  const s = await settle('log1', id);
  assert.equal(s.state, 'done', JSON.stringify(s));
  const [bench, squat, pull] = s.result.items;
  assert.equal(bench.matches[0].id, '0025');
  assert.deepEqual(bench.sets, Array(3).fill({ reps: 8, weight: 80 }));
  assert.equal(squat.matches[0].id, '0043');
  assert.equal(squat.sets.length, 5);
  assert.equal(pull.matches[0].id, '0652');
  assert.deepEqual(pull.sets, []);
  const y = new Date(Date.parse(today()) - 86400000).toISOString().slice(0, 10);
  assert.equal(s.result.date, y);
  assert.deepEqual(s.cap, { used: 1, limit: 30 }, 'the lookup count, not the Coach’s own cap');
  assert.equal(jobs.capState('log1').used, 0);
  // Counts and outcomes only in the job log — never what was typed.
  const logged = cfg.load().log.filter(e => e.kind === 'logtext');
  assert.ok(logged.length && logged.every(e => e.outcome && !JSON.stringify(e).includes('bench')));
});

test('the rows a model invents are dropped on the way back, and an answer with no usable shape fails after one repair', async () => {
  lookupOnly('log2');
  process.env.FIXTURE_MODE = 'logtext-junk';
  try {
    const s = await settle('log2', logJobs.start('log2', { text: 'barbell bench press 2x5 60' }).id);
    assert.deepEqual(s.result.items[0].sets, [{ reps: 5, weight: 60 }, { reps: 5, weight: 60 }]);
    process.env.FIXTURE_MODE = 'logtext-broken';
    const b = await settle('log2', logJobs.start('log2', { text: 'bench' }).id);
    assert.deepEqual([b.state, b.code], ['failed', 'unusable']);
  } finally { delete process.env.FIXTURE_MODE; }
});

test('refused before anything is spent: no go-ahead, nothing to read, one at a time, the daily count', async () => {
  writeState(DIR, 'log3', sampleState({ coach: {} }));
  assert.throws(() => logJobs.start('log3', { text: 'bench 3x8 80' }), e => e.code === 'consent');
  lookupOnly('log4');
  assert.throws(() => logJobs.start('log4', { text: ' \n ' }), e => e.code === 'empty');
  const { id } = logJobs.start('log4', { text: 'barbell bench press 3x8 80' });
  assert.throws(() => logJobs.start('log4', { text: 'again' }), e => e.code === 'busy');
  await settle('log4', id);
  cfg.save({ caps: { ...cfg.load().caps, matchPerProfileDaily: 1 } });
  try {
    assert.throws(() => logJobs.start('log4', { text: 'again' }), e => e.code === 'cap');
  } finally { cfg.save({ caps: { ...cfg.load().caps, matchPerProfileDaily: 30 } }); }
  assert.deepEqual(logJobs.get('log4', 'nope'), { state: 'failed', code: 'restart' });
  assert.deepEqual(logJobs.get('someone-else', id), { state: 'failed', code: 'restart' }, 'another profile cannot collect it');
});

test('the person’s date is used when it is believable, the server’s otherwise', async () => {
  lookupOnly('log5');
  const far = logJobs.start('log5', { text: 'yesterday barbell bench press 1x5 60', today: '1999-01-02' });
  const s = await settle('log5', far.id);
  const y = new Date(Date.parse(today()) - 86400000).toISOString().slice(0, 10);
  assert.equal(s.result.date, y, 'a client clock years off is ignored');
});

test('cancelling and forgetting: the job ends, and a forget drops what was waiting to be collected', async () => {
  lookupOnly('log6');
  const a = logJobs.start('log6', { text: 'barbell bench press 3x8 80' });
  assert.deepEqual(logJobs.cancel('log6', a.id), { ok: true });
  assert.equal(logJobs.get('log6', a.id).code, 'cancelled');
  const b = logJobs.start('log6', { text: 'barbell bench press 3x8 80' });
  await settle('log6', b.id);
  jobs.clearUser('log6');
  assert.equal(logJobs.get('log6', b.id).code, 'restart');
});

function fakeRes() { return { code: null, body: null }; }
const routes = coachRoutes({
  json: (res, code, obj) => { res.code = code; res.body = obj; },
  readBody: async req => req.body || {},
  readSession: req => req.user || null,
  requireAdmin: (req, res) => (req.user?.admin ? req.user : (res.code = 403, null))
});

test('POST /api/coach/logtext answers 202 with a job; the poll collects it; refusals carry their class', async () => {
  lookupOnly('log7');
  const res = fakeRes();
  await routes['POST /api/coach/logtext']({ user: { id: 'log7' }, body: { text: 'barbell deadlift 3x5 140', today: today() } }, res);
  assert.equal(res.code, 202, JSON.stringify(res.body));
  assert.match(res.body.job.id, /^[0-9a-f]{18}$/);
  await settle('log7', res.body.job.id);
  const poll = fakeRes();
  await routes['GET /api/coach/logtext/job']({ user: { id: 'log7' }, url: '/api/coach/logtext/job?id=' + res.body.job.id }, poll);
  assert.equal(poll.body.state, 'done');
  assert.equal(poll.body.result.items[0].matches[0].id, '0032');

  const empty = fakeRes();
  await routes['POST /api/coach/logtext']({ user: { id: 'log7' }, body: { text: '' } }, empty);
  assert.deepEqual([empty.code, empty.body.code], [400, 'empty']);
  const anon = fakeRes();
  await routes['POST /api/coach/logtext']({ body: { text: 'x' } }, anon);
  assert.equal(anon.code, 401);
  writeState(DIR, 'log8', sampleState({ coach: {} }));
  const noConsent = fakeRes();
  await routes['POST /api/coach/logtext']({ user: { id: 'log8' }, body: { text: 'bench' } }, noConsent);
  assert.deepEqual([noConsent.code, noConsent.body.code], [403, 'consent']);
  const cancel = fakeRes();
  await routes['POST /api/coach/logtext/cancel']({ user: { id: 'log7' }, body: { id: 'nope' } }, cancel);
  assert.deepEqual(cancel.body, { ok: true });
});

test('nothing typed reaches a disk: not the profile, not the job log', async () => {
  lookupOnly('log9');
  const marker = 'УНИКАЛЬНЫЙМАРКЕРТЕКСТА';
  const { id } = logJobs.start('log9', { text: `barbell bench press 3x8 80, ${marker}` });
  await settle('log9', id);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(DIR)) assert.ok(!fs.readFileSync(f, 'utf8').includes(marker), `${path.basename(f)} holds the text`);
});
