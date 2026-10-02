/* Every write to the food diary, the body profile and the measurements goes through here.
 *
 * Two things ride along on each of them so no caller has to remember: old diary days are folded
 * (lib/nutrition.js rollUp), and the target snapshot is refreshed — the copy of today's target
 * that readers without the formulas (the server, the Coach, the MCP bridge) take as given.
 */
import { useStore } from './store/useStore.js'
import { todayISO, uid } from './lib/format.js'
import { ensureNutrition, addEntry, editEntry, removeEntry, rollUp, saveFood, archiveFood, entryFrom, quickEntry } from './lib/nutrition.js'
import { snapshotTargets, settingsOf } from './lib/nutrition-targets.js'

function write(fn) {
  let out
  useStore.getState().update(s => {
    const nut = ensureNutrition(s)
    out = fn(nut, s)
    rollUp(nut, todayISO())
    nut.targets = snapshotTargets(s, todayISO())
  })
  return out
}

/** `grams` of a product — { n, per100: { k, p, f, c }, ref? } — on day `d`, meal `m`. */
export const logFood = (item, grams, { d, m }) => write(nut => addEntry(nut, entryFrom({ n: item.n, ...item.per100 }, grams, { d, m, ref: item.ref || undefined })))
/** A row of bare numbers: { n, k, p?, f?, c? }. */
export const logQuick = (vals, { d, m }) => write(nut => addEntry(nut, quickEntry(vals, { d, m })))
/** Several rows at once (a photographed meal, "copy the day before"): [{ item, grams } | { quick } | { copy: entry }]. */
export const logMany = (rows, { d, m }) => write(nut => rows.map(r => addEntry(nut,
  r.copy ? { ...r.copy, id: uid(), d, m, t: Date.now() }
    : r.quick ? quickEntry(r.quick, { d, m })
      : entryFrom({ n: r.item.n, ...r.item.per100 }, r.grams, { d, m, ref: r.item.ref || undefined }))))
export const changeEntry = (id, patch) => write(nut => editEntry(nut, id, patch))
export const deleteEntry = id => write(nut => removeEntry(nut, id))

/** Saves one of "my products"; returns the stored row, or null when it has no name. */
export const saveMyFood = (raw, opts) => write(nut => saveFood(nut, raw, opts))
export const archiveMyFood = id => write(nut => archiveFood(nut, id))

/** Changes the target settings (mode, goal, rate, …, or the manual numbers). */
export const setTargets = patch => write((nut, s) => { nut.targets = { ...settingsOf(s), ...patch, t: Date.now() } })

/* ---------- the body ---------- */

export const saveBodyProfile = patch => write((nut, s) => { s.bodyProfile = { ...(s.bodyProfile || {}), ...patch, t: Date.now() } })

/** One row per day: a second save on the same day edits that day's row. Empty values drop the key. */
export const saveMeasurement = (d, values) => write((nut, s) => {
  const list = Array.isArray(s.measurements) ? s.measurements : (s.measurements = [])
  let row = list.find(x => x.d === d)
  if (!row) { row = { d }; list.push(row) }
  for (const [k, v] of Object.entries(values)) { if (v > 0) row[k] = Math.round(v * 10) / 10; else delete row[k] }
  delete row.src                     // edited by hand: no longer "as Health reported it"
  row.t = Date.now()
  list.sort((a, b) => (a.d < b.d ? -1 : 1))
  if (Object.keys(row).filter(k => k !== 'd' && k !== 't').length === 0) s.measurements = list.filter(x => x !== row)
})
export const deleteMeasurement = d => write((nut, s) => { s.measurements = (s.measurements || []).filter(x => x.d !== d) })
/** A goal for one measurement, in the stored unit; nothing (or zero) removes it. */
export const setMeasureGoal = (key, v) => write((nut, s) => {
  s.measureGoals = { ...(s.measureGoals || {}), [key]: { v: v > 0 ? Math.round(v * 10) / 10 : null, t: Date.now() } }
})
