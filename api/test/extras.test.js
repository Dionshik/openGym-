/* The body profile and the nutrition summary in a Coach payload.
 *
 * Like the allowlist test in payload.test.js, most of this asserts on absence: a profile that
 * agreed to the Coach before these existed must send exactly what it sent then, and one that
 * shares its nutrition must still never send what it ate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payload = await import('../coach/core/payload.js');
const { grantedExtras, bodySection, nutritionSection } = await import('../coach/core/extras.js');
const { OPTIONAL_CATEGORIES, DATA_CATEGORIES } = await import('../coach/core/categories.js');
const { PROMPTS } = await import('../coach/core/prompts.js');

const TODAY = new Date();
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const ago = n => iso(new Date(TODAY.getTime() - n * 86400000));
const day = iso(TODAY);

const BODY = {
  body: 'female',                                                   // the muscle-map figure — not the person
  bodyProfile: { sex: 'm', born: TODAY.getFullYear() - 30, heightCm: 180.4, activity: 'moderate', t: 1 },
  measurements: [
    { d: ago(90), waist: 95, bodyFat: 24 },
    { d: ago(40), waist: 92, upperArmLeft: 38, bodyFat: 22 },
    { d: ago(3), waist: 89.5, bodyFat: 20.4, leanMass: 64 }
  ]
};
const row = (id, d, k, over = {}) => ({ id, d, m: 1, n: 'Куриная грудка SECRETFOOD', g: 150, k, p: 40, f: 10, c: 50, r: 'off:4607025392408', t: 1, ...over });
const NUTRITION = {
  nutrition: {
    v: 1,
    targets: { mode: 'auto', goal: 'lose', kcal: 2319, p: 144, f: 64, c: 292, tdee: 2759, basis: 'adaptive', t: 1 },
    log: [
      row('a', ago(1), 2200), row('b', ago(2), 2400), row('c', ago(3), 2000), row('d', ago(4), 300),      // the last one: a day barely started
      row('today', day, 9000), row('old', ago(30), 9000)
    ],
    days: {}, rolledTo: null, del: {},
    foods: [{ id: 'f1', n: 'My private product', code: '4607025392408', k: 100, p: 1, f: 1, c: 1 }]
  }
};
const consent = extra => ({ coach: { consent: { agreedAt: '2026-01-01T00:00:00Z', version: 1, ...(extra ? { extra } : {}) }, profile: { goal: 'muscle', daysPerWeek: 3 } } });
const build = (S, kind = 'review') => payload.build(S, { handle: 'h'.repeat(16), kind });

test('there are two optional categories, and they are not among the ones consent covers', () => {
  assert.deepEqual([...OPTIONAL_CATEGORIES], ['bodyProfile', 'nutrition']);
  for (const k of OPTIONAL_CATEGORIES) assert.ok(!DATA_CATEGORIES.includes(k));
});

test('a profile that agreed to the Coach and switched nothing on sends neither — whatever it has stored', () => {
  const S = sampleState({ ...BODY, ...NUTRITION, ...consent() });
  assert.deepEqual(grantedExtras(S), []);
  for (const kind of ['review', 'create', 'debrief']) {
    const p = build(S, kind);
    assert.equal('bodyProfile' in p, false, kind);
    assert.equal('nutrition' in p, false, kind);
    const wire = JSON.stringify(p);
    // ("waist" alone is no marker: it is also the catalogue's word for the abs body part.)
    for (const leak of ['heightCm', 'bodyFat', 'changeCm', 'dailyActivity', 'SECRETFOOD', '2319', 'private product']) assert.ok(!wire.includes(leak), `${kind} leaked ${leak}`);
  }
});

test('a switch without the Coach’s own consent grants nothing', () => {
  assert.deepEqual(grantedExtras({ coach: { consent: { extra: { bodyProfile: 'x', nutrition: 'x' } } } }), []);
  assert.deepEqual(grantedExtras({ coach: { foodConsent: { agreedAt: 'x' } } }), []);
  assert.deepEqual(grantedExtras(null), []);
  assert.deepEqual(grantedExtras(sampleState(consent({ nutrition: 'x', somethingElse: 'x' }))), ['nutrition']);
});

test('each switch opens its own section and not the other', () => {
  const onlyBody = build(sampleState({ ...BODY, ...NUTRITION, ...consent({ bodyProfile: '2026-10-01' }) }));
  assert.ok(onlyBody.bodyProfile);
  assert.equal('nutrition' in onlyBody, false);
  const onlyFood = build(sampleState({ ...BODY, ...NUTRITION, ...consent({ nutrition: '2026-10-01' }) }));
  assert.ok(onlyFood.nutrition);
  assert.equal('bodyProfile' in onlyFood, false);
});

test('the body section: age not birth year, the person’s sex not the diagram’s, measurements with their movement', () => {
  const b = bodySection({ ...BODY }, day);
  assert.deepEqual(Object.keys(b).sort(), ['age', 'bodyFatPercent', 'dailyActivity', 'heightCm', 'measurements', 'sex']);
  assert.equal(b.sex, 'male');                          // S.body said 'female' and was not asked
  assert.equal(b.age, 30);
  assert.equal(b.heightCm, 180);
  assert.equal(b.dailyActivity, 'moderate');
  assert.equal(b.bodyFatPercent, 20.4);
  // waist: latest 89.5; the earliest reading inside eight weeks is the one from 40 days ago
  assert.deepEqual(b.measurements.waist, { cm: 89.5, changeCm: -2.5, sinceDays: 37 });
  assert.deepEqual(b.measurements.upperArmLeft, { cm: 38 });
  assert.ok(!JSON.stringify(b).includes(String(TODAY.getFullYear() - 30)), 'the birth year itself is not sent');
});

test('the body section is absent when there is nothing to say, and never invents a sex', () => {
  assert.equal(bodySection({ body: 'male' }, day), null);
  assert.equal(bodySection({}, day), null);
  assert.deepEqual(bodySection({ bodyProfile: { heightCm: 170, sex: 'x', activity: 'superhuman' } }, day), { heightCm: 170 });
});

test('the nutrition section: the target, and two-week averages over whole days only', () => {
  const n = nutritionSection({ ...NUTRITION }, day);
  assert.deepEqual(n.target, { kcal: 2319, proteinG: 144, fatG: 64, carbsG: 292, goal: 'lose' });
  assert.deepEqual(n.expenditure, { kcal: 2759, basis: 'measured from intake and weight trend' });
  // three whole days (2200, 2400, 2000); the 300 kcal day, today and the month-old day are out
  assert.deepEqual(n.intake, { days: 14, loggedDays: 3, kcal: 2200, proteinG: 40, fatG: 10, carbsG: 50 });
});

test('the nutrition section says how much, never what: no food name, no barcode, no product', () => {
  const wire = JSON.stringify(build(sampleState({ ...NUTRITION, ...consent({ nutrition: '2026-10-01' }) })));
  for (const leak of ['SECRETFOOD', 'Куриная', '4607025392408', 'private product', 'off:', '"log"', '"foods"']) assert.ok(!wire.includes(leak), leak);
});

test('folded days count; too few logged days means no averages; an empty diary means no section', () => {
  const folded = { nutrition: { targets: null, log: [], days: { [ago(1)]: { k: 2000, p: 100, f: 60, c: 200, n: 9 }, [ago(2)]: { k: 2200, p: 120, f: 70, c: 220, n: 8 }, [ago(5)]: { k: 2400, p: 140, f: 80, c: 240, n: 7 } }, rolledTo: day } };
  assert.deepEqual(nutritionSection(folded, day).intake, { days: 14, loggedDays: 3, kcal: 2200, proteinG: 120, fatG: 70, carbsG: 220 });
  assert.equal(nutritionSection({ nutrition: { targets: null, log: [row('a', ago(1), 2200)], days: {} } }, day), null);
  assert.equal(nutritionSection({ nutrition: null }, day), null);
  assert.equal(nutritionSection({}, day), null);
  // a manual target is the user's own number: there is no "goal" behind it to report
  assert.equal(nutritionSection({ nutrition: { targets: { mode: 'manual', goal: 'lose', kcal: 2000, p: 150, f: 60, c: 200 }, log: [], days: {} } }, day).target.goal, null);
});

test('the prompt tells the Coach how to read them and where the line is', () => {
  assert.match(PROMPTS.common, /`bodyProfile` and `nutrition` are present only when the person chose to share them/);
  assert.match(PROMPTS.common, /Never write a diet/);
});
