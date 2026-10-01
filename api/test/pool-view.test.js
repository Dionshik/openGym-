/* A profile's state seen together with the shared pool (core/pool-view.js), and the two places
 * on the server that depend on it: the plan fingerprint and the payload a job sends. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const { withPoolRows } = await import('../coach/core/pool-view.js');
const payload = await import('../coach/core/payload.js');
const { hashPlan } = await import('../coach/core/plan-hash.js');
const { readPoolRows, cleanExercise } = await import('../pool.js');
const jobs = await import('../coach/jobs.js');

const row = (over = {}) => ({ id: 'cshared', n: 'Sled pull-through', bp: 'upper legs', eq: 'weighted', tg: 'gluteal', primaries: ['gluteal'], secondaries: [], muscleGroups: ['gluteal'], sm: [], desc: '', ...over });
const state = (ex = []) => sampleState({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }, ...ex] }], week: { 1: 'r1' } });

test('only the shared rows a profile actually uses are filed with its own', () => {
  const rows = [row(), row({ id: 'cunused', n: 'Unused' })];
  const S = state([{ id: 'cshared', sets: 3, reps: 8 }]);
  const seen = withPoolRows(S, rows);
  assert.deepEqual(seen.customEx.map(c => c.id), ['cshared']);
  assert.equal(S.customEx.length, 0);                              // the input is not mutated
  // Named in a logged workout or the one in progress counts as used too.
  assert.deepEqual(withPoolRows({ ...state(), workouts: [{ entries: [{ id: 'cunused' }] }] }, rows).customEx.map(c => c.id), ['cunused']);
  assert.deepEqual(withPoolRows({ ...state(), active: { entries: [{ id: 'cshared' }] } }, rows).customEx.map(c => c.id), ['cshared']);
});

test('the profile’s own copy wins, a built-in id is never shadowed, and nothing to add changes nothing', () => {
  const mine = { id: 'cshared', n: 'My own name', bp: 'upper legs', custom: true };
  const S = { ...state([{ id: 'cshared', sets: 3, reps: 8 }]), customEx: [mine] };
  assert.equal(withPoolRows(S, [row()]), S);                       // same object: nothing was added
  assert.equal(withPoolRows(state([{ id: '0001', sets: 1, reps: 1 }]), [row({ id: '0001' })]).customEx.length, 0);
  const plain = state();
  assert.equal(withPoolRows(plain, []), plain);
  assert.equal(withPoolRows(plain, null), plain);
  assert.equal(withPoolRows(null, [row()]), null);
});

test('`all` is the whole pool minus what is retired — for resolving a name, not for sending', () => {
  const seen = withPoolRows(state(), [row(), row({ id: 'cold', n: 'Old', retired: true })], { all: true });
  assert.deepEqual(seen.customEx.map(c => c.id), ['cshared']);
});

test('a plan that uses a shared cardio exercise fingerprints as cardio, not as a loaded lift', () => {
  // The client resolves the id through its own registry and gets `cardio`. Without the pool row
  // the server falls back to `reps`, the two hashes differ, and every proposal reads as stale.
  const cardio = row({ id: 'crow', n: 'Rowing sprints', bp: 'cardio', eq: 'leverage machine', tg: 'cardiovascular system' });
  const S = state([{ id: 'crow', sets: 1, min: 20, speed: 9 }]);
  const blind = payload.canonicalPlan(S).routines[0].ex[1];
  const seeing = payload.canonicalPlan(withPoolRows(S, [cardio])).routines[0].ex[1];
  assert.equal(blind.mode, 'reps');
  assert.equal(seeing.mode, 'cardio');
  assert.equal(seeing.min, 20);
  assert.notEqual(hashPlan(payload.canonicalPlan(S)), hashPlan(payload.canonicalPlan(withPoolRows(S, [cardio]))));
});

test('readPoolRows serves approved and retired rows off the disk, and readState files them', () => {
  assert.deepEqual(readPoolRows(DIR), []);                         // no pool.json yet
  fs.writeFileSync(path.join(DIR, 'pool.json'), JSON.stringify({
    rev: 3, items: [
      { ...row(), status: 'approved', by: 'u-ann', byName: 'Ann', at: 1 },
      { ...row({ id: 'cwait', n: 'Waiting' }), status: 'pending', by: 'u-ann', byName: 'Ann', at: 2 },
      { ...row({ id: 'cno', n: 'Declined' }), status: 'rejected', by: 'u-ann', byName: 'Ann', note: 'dup' },
      { ...row({ id: 'cold', n: 'Old' }), status: 'retired', by: null }
    ]
  }));
  const rows = readPoolRows(DIR);
  assert.deepEqual(rows.map(r => [r.id, !!r.retired]), [['cshared', false], ['cold', true]]);
  assert.ok(!JSON.stringify(rows).includes('Ann'));                // not who suggested it

  const uid = 'u-pool-reader';
  writeState(DIR, uid, state([{ id: 'cshared', sets: 3, reps: 8 }, { id: 'cwait', sets: 3, reps: 8 }]));
  const S = jobs.readState(uid);
  assert.deepEqual(S.customEx.map(c => c.id), ['cshared']);        // the pending one is nobody’s yet

  // …and what a job would send names the exercise instead of an id nobody can read.
  const p = payload.build(S, { handle: 'h'.repeat(16), kind: 'review' });
  assert.ok(JSON.stringify(p).includes('Sled pull-through'));
});

test('the sanitiser keeps an exercise and drops what rides on it', () => {
  const c = cleanExercise({ ...row(), custom: true, by: 'someone', status: 'approved', st: ['x'], primaries: ['gluteal', 'wings'] });
  assert.equal(c.ok, true);
  assert.deepEqual(Object.keys(c.ex).sort(), ['bp', 'desc', 'eq', 'id', 'muscleGroups', 'n', 'primaries', 'secondaries', 'sm', 'tg']);
  assert.deepEqual(c.ex.primaries, ['gluteal']);
  assert.equal(cleanExercise(null).ok, false);
  assert.equal(cleanExercise([]).ok, false);
});
