/* The Apple Health ingest: reading what a hand-built Shortcut sends (healthkit-parse.js), and
   the token and storage rules around it (healthkit.js) — a token that can write one profile's
   body data and read nothing, off unless the admin turned it on. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dayOf, readNumber, readMetric, parseIngest } from '../healthkit-parse.js';
import { createHealth, MAX_TOKENS_PER_USER, TOKEN_PREFIX } from '../healthkit.js';
import { createSettings } from '../settings.js';

const atomicWrite = (file, content) => fs.writeFileSync(file, content);
const TODAY = '2026-10-01';

/* ------------------------------ reading ------------------------------ */

test('dayOf reads the date the way a phone writes it — and keeps the phone’s own day', () => {
  assert.equal(dayOf('2026-10-01T00:30:00+03:00'), '2026-10-01');      // still the 1st for the sender, whatever UTC says
  assert.equal(dayOf('2026-10-01'), '2026-10-01');
  assert.equal(dayOf('01.10.2026, 08:15'), '2026-10-01');
  assert.equal(dayOf('10/1/2026, 8:15 AM'), '2026-10-01');
  assert.equal(dayOf('1 окт. 2026 г., 08:15'), '2026-10-01');
  assert.equal(dayOf('1 октября 2026 г.'), '2026-10-01');
  assert.equal(dayOf('Oct 1, 2026 at 8:15 AM'), '2026-10-01');
  assert.equal(dayOf('1 October 2026'), '2026-10-01');
  for (const bad of ['', null, 'yesterday', '2026-13-40', '99.99.2026', '01.10.1820']) assert.equal(dayOf(bad), null, String(bad));
});

test('readNumber takes the first number, comma or point, and the unit beside it', () => {
  assert.deepEqual(readNumber('80,5 кг'), { n: 80.5, unit: 'кг' });
  assert.deepEqual(readNumber('176.4 lb'), { n: 176.4, unit: 'lb' });
  assert.deepEqual(readNumber('18 %'), { n: 18, unit: '%' });
  assert.deepEqual(readNumber(80.5), { n: 80.5, unit: '' });
  assert.deepEqual(readNumber('80,5' + String.fromCharCode(160) + 'кг'), { n: 80.5, unit: 'кг' });   // iOS puts a no-break space there
  assert.deepEqual(readNumber('\n81.2\n80.9\n'), { n: 81.2, unit: '' });        // a list: the first line is the newest
  for (const none of ['', null, undefined, 'кг', NaN]) assert.equal(readNumber(none), null);
});

test('readMetric converts to kilograms, percent and centimetres', () => {
  assert.equal(readMetric('weight', '80,5 кг'), 80.5);
  assert.equal(readMetric('weight', '176.4 lb'), 80);
  assert.equal(readMetric('weight', '176.4', { unit: 'lb' }), 80);
  assert.equal(readMetric('leanMass', '143 lbs'), 64.9);
  assert.equal(readMetric('bodyFat', '0.182'), 18.2);          // the fraction Health stores
  assert.equal(readMetric('bodyFat', '18,2 %'), 18.2);
  assert.equal(readMetric('height', '1,8 м'), 180);
  assert.equal(readMetric('height', '1.8'), 180);
  assert.equal(readMetric('height', '180 см'), 180);
  assert.equal(readMetric('height', '70.9 in'), 180.1);
  assert.equal(readMetric('waist', '34 in'), 86.4);
  assert.equal(readMetric('waist', '0.88 m'), 88);
});

test('readMetric drops what a body cannot be, rather than storing a misreading', () => {
  assert.equal(readMetric('weight', '8050'), null);
  assert.equal(readMetric('weight', '5'), null);
  assert.equal(readMetric('bodyFat', '182'), null);
  assert.equal(readMetric('height', '18'), null);
  assert.equal(readMetric('waist', '-88'), null);
  assert.equal(readMetric('weight', 'n/a'), null);
});

test('parseIngest: a whole delivery, field names in either language, unknown fields named back', () => {
  const r = parseIngest({ date: '2026-10-01T08:15:00+03:00', Weight: '80,5 кг', 'body fat': '0.182', Рост: '1,8 м', steps: '9000' }, { today: TODAY });
  assert.deepEqual(r.accepted, [
    { metric: 'weight', d: '2026-10-01', v: 80.5 }, { metric: 'bodyFat', d: '2026-10-01', v: 18.2 }, { metric: 'height', d: '2026-10-01', v: 180 }
  ]);
  assert.deepEqual(r.ignored, ['steps']);
  assert.deepEqual(r.warnings, []);
});

test('parseIngest: a metric’s own date beats the body’s, which beats today', () => {
  const r = parseIngest({ date: '2026-09-30', weight: '80', weightDate: '28.09.2026, 07:00', waist: '88' }, { today: TODAY });
  assert.deepEqual(r.accepted, [{ metric: 'weight', d: '2026-09-28', v: 80 }, { metric: 'waist', d: '2026-09-30', v: 88 }]);
  assert.deepEqual(parseIngest({ weight: '80' }, { today: TODAY }).accepted, [{ metric: 'weight', d: TODAY, v: 80 }]);
});

test('parseIngest: an empty field is "nothing measured", a bad one is a warning, neither stops the rest', () => {
  const r = parseIngest({ weight: '', bodyFat: 'abc', waist: '88', date: 'whenever' }, { today: TODAY });
  assert.deepEqual(r.accepted, [{ metric: 'waist', d: TODAY, v: 88 }]);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings.join(' '), /date/);
  assert.match(r.warnings.join(' '), /bodyFat/);
});

test('parseIngest: a date in the future is refused; tomorrow is a timezone, not the future', () => {
  assert.deepEqual(parseIngest({ weight: '80', date: '2026-10-02' }, { today: TODAY }).accepted, [{ metric: 'weight', d: '2026-10-02', v: 80 }]);
  const r = parseIngest({ weight: '80', date: '2027-01-01' }, { today: TODAY });
  assert.deepEqual(r.accepted, []);
  assert.match(r.warnings[0], /future/);
});

test('parseIngest: anything that is not an object is an empty delivery', () => {
  for (const junk of [null, [], 'text', 42]) assert.deepEqual(parseIngest(junk, { today: TODAY }), { accepted: [], ignored: [], warnings: [] });
});

/* ------------------------------ tokens and storage ------------------------------ */

function setup(t, { enabled = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-hk-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const settings = createSettings({ dataDir, atomicWrite });
  if (enabled) settings.patch({ health: { enabled: true } });
  let clock = Date.parse('2026-10-01T09:00:00Z');
  const health = createHealth({ dataDir, atomicWrite, settings, now: () => clock });
  return { health, dataDir, settings, tick: ms => { clock += ms; }, stored: uid => JSON.parse(fs.readFileSync(path.join(dataDir, 'health', uid + '.json'), 'utf8')) };
}
const bearer = token => 'Bearer ' + token;

test('a token is shown once and kept only as a hash', t => {
  const h = setup(t);
  const made = h.health.createToken('u1');
  assert.ok(made.ok);
  assert.ok(made.token.startsWith(TOKEN_PREFIX) && made.token.length > 40);
  const file = fs.readFileSync(path.join(h.dataDir, 'health-tokens.json'), 'utf8');
  assert.equal(file.includes(made.token), false, 'the plain token is not on disk');
  assert.deepEqual(h.health.listTokens('u1'), [{ id: made.id, created: made.created, lastUsed: 0 }]);
  assert.deepEqual(h.health.listTokens('u2'), []);
});

test('at most a few tokens per profile; revoking makes room and kills the token', t => {
  const h = setup(t);
  const made = Array.from({ length: MAX_TOKENS_PER_USER }, () => h.health.createToken('u1'));
  assert.deepEqual(h.health.createToken('u1'), { ok: false, code: 'cap' });
  assert.equal(h.health.revokeToken('u2', made[0].id), false, 'somebody else cannot revoke it');
  assert.equal(h.health.revokeToken('u1', made[0].id), true);
  assert.equal(h.health.ingest(bearer(made[0].token), { weight: '80' }).status, 401);
  assert.equal(h.health.ingest(bearer(made[1].token), { weight: '80' }).status, 200);
  assert.ok(h.health.createToken('u1').ok);
});

test('ingest stores under the token’s own profile, and answers without revealing what is stored', t => {
  const h = setup(t);
  const { token } = h.health.createToken('u1');
  const r = h.health.ingest(bearer(token), { date: '2026-10-01', weight: '80,5 кг', bodyFat: '18 %', height: '180', uid: 'u2' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.accepted.map(a => a.metric), ['weight', 'bodyFat', 'height']);
  assert.deepEqual(r.body.ignored, ['uid']);
  assert.deepEqual(Object.keys(r.body).sort(), ['accepted', 'ignored', 'ok', 'warnings']);
  const s = h.stored('u1');
  assert.equal(s.days['2026-10-01'].weight.v, 80.5);
  assert.equal(s.days['2026-10-01'].bodyFat.v, 18);
  assert.equal(s.height.v, 180);
  assert.equal(s.rev, 1);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'health', 'u2.json')), false);
  assert.equal(h.health.rev('u1'), 1);
  assert.equal(h.health.rev('u2'), 0);
  assert.ok(h.health.listTokens('u1')[0].lastUsed > 0);
});

test('the same reading delivered twice is not news: the revision and its timestamp stay', t => {
  const h = setup(t);
  const { token } = h.health.createToken('u1');
  h.health.ingest(bearer(token), { date: '2026-10-01', weight: '80.5' });
  const at = h.stored('u1').days['2026-10-01'].weight.at;
  h.tick(3600000);
  h.health.ingest(bearer(token), { date: '2026-10-01', weight: '80.5' });
  assert.equal(h.stored('u1').rev, 1);
  assert.equal(h.stored('u1').days['2026-10-01'].weight.at, at);
  h.health.ingest(bearer(token), { date: '2026-10-01', weight: '80.1' });
  assert.equal(h.stored('u1').rev, 2);
  assert.ok(h.stored('u1').days['2026-10-01'].weight.at > at);
});

test('old days are forgotten', t => {
  const h = setup(t);
  const { token } = h.health.createToken('u1');
  h.health.ingest(bearer(token), { date: '2025-01-01', weight: '82' });
  h.health.ingest(bearer(token), { date: '2026-10-01', weight: '80' });
  assert.deepEqual(Object.keys(h.stored('u1').days), ['2026-10-01']);
});

test('refused: no token, a wrong one, a session-shaped one, a deleted profile, the feature switched off', t => {
  const h = setup(t);
  const { token } = h.health.createToken('u1');
  for (const auth of [undefined, '', 'Bearer ', 'Bearer nope', bearer(token + 'x'), bearer('u1:9999999999999:0.signature'), token]) {
    assert.equal(h.health.ingest(auth, { weight: '80' }).status, 401, String(auth));
  }
  assert.equal(h.health.ingest(bearer(token), { weight: '80' }, { userExists: () => false }).status, 401);
  h.settings.patch({ health: { enabled: false } });
  assert.deepEqual(h.health.ingest(bearer(token), { weight: '80' }), { status: 403, body: { error: 'disabled' } });
  assert.equal(fs.existsSync(path.join(h.dataDir, 'health')), false, 'nothing was stored by any of them');
});

test('guessing tokens is slowed for everyone, and one Shortcut cannot flood', t => {
  const h = setup(t);
  const { token } = h.health.createToken('u1');
  for (let i = 0; i < 30; i++) assert.equal(h.health.ingest(bearer('ogh_guess' + i), {}).status, 401);
  assert.equal(h.health.ingest(bearer('ogh_guess'), {}).status, 429);
  assert.equal(h.health.ingest(bearer(token), { weight: '80' }).status, 429, 'even a good token waits');
  h.tick(61000);
  for (let i = 0; i < 30; i++) assert.equal(h.health.ingest(bearer(token), { weight: '80' }).status, 200);
  assert.equal(h.health.ingest(bearer(token), { weight: '80' }).status, 429);
  h.tick(3600001);
  assert.equal(h.health.ingest(bearer(token), { weight: '80' }).status, 200);
});

test('dropUser removes the samples and the tokens; "clear" keeps the tokens', t => {
  const h = setup(t);
  const { token } = h.health.createToken('u1');
  h.health.ingest(bearer(token), { weight: '80' });
  h.health.dropUser('u1', { tokens: false });
  assert.equal(fs.existsSync(path.join(h.dataDir, 'health', 'u1.json')), false);
  assert.equal(h.health.ingest(bearer(token), { weight: '80' }).status, 200, 'the Shortcut keeps working after a clear');
  h.health.dropUser('u1');
  assert.equal(h.health.ingest(bearer(token), { weight: '80' }).status, 401);
  assert.deepEqual(h.health.stats(), { users: 0, tokens: 0 });
});

test('tokens survive a restart', t => {
  const h = setup(t);
  const { token } = h.health.createToken('u1');
  const reborn = createHealth({ dataDir: h.dataDir, atomicWrite, settings: h.settings });
  assert.equal(reborn.ingest(bearer(token), { weight: '80' }).status, 200);
});
