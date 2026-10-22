/* The added rows that repeat an upstream exercise's name (v1.4.0 grew about fifty): they stay in
 * the Coach's library so a plan that names one is still understood, and are never offered —
 * not in the slice a prompt gets, not by the exercise lookup. The same rows the app hides
 * (frontend/src/lib/exercises.js EXTRA_SHADOWED; the parity is checked on that side). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY, LIB_BY_ID, BROWSABLE, librarySlice } from '../coach/core/library.js';
import { rankLibrary } from '../coach/core/match.js';

const hidden = LIBRARY.filter(e => e.hidden);
const twin = h => BROWSABLE.find(e => e.n.toLowerCase() === h.n.toLowerCase());

test('the library keeps the hidden rows: each resolves by id and none is browsable', () => {
  assert.ok(hidden.length > 0, 'no hidden rows: the test proves nothing');
  for (const h of hidden) {
    assert.equal(LIB_BY_ID.get(h.id), h, `${h.id} still resolves`);
    assert.ok(!BROWSABLE.includes(h));
  }
  assert.ok(hidden.some(h => twin(h)), 'at least one repeats the name letter for letter');
});

test('a slice offers no hidden row, unless the person already trains it', () => {
  const S = { customEx: [] };
  const offered = new Set(librarySlice(S, [], { max: LIBRARY.length }).map(e => e.id));
  assert.ok(hidden.every(h => !offered.has(h.id)));
  const h = hidden[0];
  assert.ok(librarySlice(S, [], { keep: [h.id] }).some(e => e.id === h.id), 'kept: their plan names it');
});

test('the lookup never answers with a hidden row, so a repeated name is no tie', () => {
  const h = hidden.find(x => twin(x));
  const rows = rankLibrary({ names: [h.n], said: h.n });
  assert.ok(rows.length > 0);
  assert.ok(rows.every(m => !LIB_BY_ID.get(m.id)?.hidden));
  assert.equal(rows[0].id, twin(h).id);
});
