/* A profile's state, seen together with the instance's shared exercise pool.
 *
 * Everything in the Coach resolves an exercise id against two places: the built-in catalogue
 * and the profile's own `customEx`. A shared exercise (api/pool.js) is in neither — it lives
 * in the instance's pool and is only *referenced* by a routine or a workout. Left alone, the
 * payload would send an id with no name, the validator would call it unknown, and the plan
 * fingerprint would disagree with the client's (which resolves the id through its own
 * registry) — so every proposal would read as stale.
 *
 * Rather than teach each of those about a third source, the state they are handed is given
 * the shared rows as if they were the profile's own. Only the rows it actually uses: the
 * library slice sends every custom exercise to the model uncapped, and a pool of a few hundred
 * would otherwise ride along on every job.
 *
 * Pure, like the rest of core/: the server passes rows read from pool.json, a phone running
 * the Coach itself passes the pool its store holds.
 */
import { libraryHas } from './library.js';

/** Every exercise id a state names: routines, logged workouts, the workout in progress. */
function referenced(S) {
  const ids = new Set();
  const take = list => { for (const e of list || []) if (e && typeof e.id === 'string') ids.add(e.id); };
  for (const r of S.routines || []) take(r && r.ex);
  for (const w of S.workouts || []) take(w && w.entries);
  take(S.active && S.active.entries);
  return ids;
}

/**
 * @param S     the profile's state (not mutated)
 * @param rows  the pool's served rows — `{ id, n, bp, eq, … }`, approved and retired alike
 * @param all   include every row rather than only the referenced ones (the exercise lookup
 *              resolves names against the whole pool; nothing of it is sent to the provider)
 */
export function withPoolRows(S, rows, { all = false } = {}) {
  if (!S || !Array.isArray(rows) || !rows.length) return S;
  const own = new Set((S.customEx || []).map(c => c && c.id));
  const used = all ? null : referenced(S);
  const add = rows.filter(r => r && typeof r.id === 'string' && !own.has(r.id) && !libraryHas(r.id) &&
    (all ? !r.retired : used.has(r.id)));
  return add.length ? { ...S, customEx: [...(S.customEx || []), ...add] } : S;
}
