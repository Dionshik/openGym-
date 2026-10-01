/* The food diary: what was eaten, how much energy and protein / fat / carbohydrate it carried,
 * and the day's totals against a target.
 *
 * Shape (S.nutrition — read it through nutritionOf, write it through ensureNutrition):
 *
 *   { v: 1,
 *     targets: { mode, kcal, p, f, c, t, … } | null,          // the day's goal, see nutrition-targets.js
 *     log:   [{ id, d, m, n, g, k, p, f, c, r?, t }],         // one row per thing eaten
 *     days:  { 'YYYY-MM-DD': { k, p, f, c, n } },             // old days, folded to their totals
 *     rolledTo: 'YYYY-MM-DD' | null,                          // days before this live in `days` only
 *     foods: [{ id, n, brand?, code?, k, p, f, c, sv?, src, t, x? }],   // "my products", per 100 g
 *     del:   { [entryId]: t } }                               // what was deleted, for the merge
 *
 * Three decisions carry the rest:
 *
 *   - A log row holds its own numbers (k/p/f/c for the grams eaten), not a pointer to a product.
 *     Correcting a product next month must not rewrite what last month added up to, and the
 *     server, the Coach and the MCP bridge can total a day without a food table.
 *   - The diary is the busiest list in the profile — a dozen rows a day, every day — and the
 *     whole profile is sent on every change. So days older than ROLL_DAYS are folded into one
 *     small total each; the rows themselves go.
 *   - Unlike workouts, rows are deleted all the time ("that was 150 g, not 250 — delete, re-add"),
 *     and folding removes rows too. Without a record of deletions a second device would hand
 *     every one of them back on the next merge, so this list keeps tombstones (`del`).
 */

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']
export const ROLL_DAYS = 90
export const TOMB_DAYS = 45
export const NAME_MAX = 80
export const GRAMS_MAX = 5000
const DAY_MS = 86400000

const list = v => (Array.isArray(v) ? v : [])
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const num = v => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : +v; return Number.isFinite(n) ? n : 0 }
const r1 = n => Math.round(n * 10) / 10
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const isoDay = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
/** The ISO day `n` days before `iso` (noon, so a DST change cannot move the day). */
export const dayBefore = (iso, n = 1) => isoDay(new Date(iso + 'T12:00:00').getTime() - n * DAY_MS)
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export const emptyNutrition = () => ({ v: 1, targets: null, log: [], days: {}, rolledTo: null, foods: [], del: {} })

/** The diary as every reader sees it — never null, never missing a list. Does not touch S. */
export function nutritionOf(S) {
  const n = S?.nutrition
  if (!n || typeof n !== 'object') return emptyNutrition()
  return { v: 1, targets: n.targets || null, log: list(n.log), days: obj(n.days), rolledTo: n.rolledTo || null, foods: list(n.foods), del: obj(n.del) }
}
/** The diary inside a store update: created on first use, repaired if a field went missing. */
export function ensureNutrition(S) {
  S.nutrition = nutritionOf(S)
  return S.nutrition
}

/* ---------- numbers ---------- */

/** Energy the macros alone account for (Atwater: 4 / 4 / 9 kcal per gram). */
export const atwater = ({ p = 0, f = 0, c = 0 }) => Math.round(4 * p + 4 * c + 9 * f)

/**
 * A product as it may be stored: per 100 g, inside what food can physically be. Pure fat is
 * 900 kcal and nothing holds more than 100 g of macros in 100 g — a typed "2500" or a label
 * read per pack instead of per 100 g is caught here rather than on the day's total.
 * Returns null when there is no name to show for it.
 */
export function sanitizeFood(raw) {
  const n = String(raw?.n ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
  if (!n) return null
  let p = clamp(num(raw.p), 0, 100), f = clamp(num(raw.f), 0, 100), c = clamp(num(raw.c), 0, 100)
  const sum = p + f + c
  if (sum > 100) { p = p * 100 / sum; f = f * 100 / sum; c = c * 100 / sum }
  const typed = raw.k === '' || raw.k == null ? null : clamp(num(raw.k), 0, 900)
  const out = { n, k: Math.round(typed == null ? atwater({ p, f, c }) : typed), p: r1(p), f: r1(f), c: r1(c) }
  const sv = num(raw.sv)
  if (sv > 0) out.sv = Math.round(clamp(sv, 1, GRAMS_MAX))
  for (const key of ['brand', 'code']) {
    const v = String(raw[key] ?? '').trim().slice(0, key === 'code' ? 14 : 40)
    if (v) out[key] = v
  }
  return out
}

/** What `g` grams of a per-100 g product carry. */
export function scale(per100, g) {
  const q = clamp(num(g), 0, GRAMS_MAX) / 100
  return { k: Math.round(num(per100.k) * q), p: r1(num(per100.p) * q), f: r1(num(per100.f) * q), c: r1(num(per100.c) * q) }
}

/** The per-100 g values a logged row was made from — null for a row logged without a weight. */
export function per100Of(e) {
  if (!(e?.g > 0)) return null
  const q = 100 / e.g
  return { k: Math.round(e.k * q), p: r1(e.p * q), f: r1(e.f * q), c: r1(e.c * q) }
}

/* ---------- rows ---------- */

const mealOf = m => (m >= 0 && m <= 3 ? Math.floor(m) : 3)

/** A row for `g` grams of a product. `ref` names where it came from ('g:<id>' the built-in
 *  table, 'o:<id>' one of my products) so "recent" can group by product, not by spelling. */
export function entryFrom(food, g, { d, m = 3, ref, now = Date.now(), id = newId() } = {}) {
  const grams = Math.round(clamp(num(g), 1, GRAMS_MAX))
  const e = { id, d, m: mealOf(m), n: String(food.n).slice(0, NAME_MAX), g: grams, ...scale(food, grams), t: now }
  if (ref) e.r = ref
  return e
}
/** A row typed as bare numbers — "that lunch out was about 700 kcal". No weight, so g is 0. */
export function quickEntry({ n, k, p = 0, f = 0, c = 0 }, { d, m = 3, now = Date.now(), id = newId() } = {}) {
  const macros = { p: r1(clamp(num(p), 0, 1000)), f: r1(clamp(num(f), 0, 1000)), c: r1(clamp(num(c), 0, 1000)) }
  const kcal = k === '' || k == null ? atwater(macros) : Math.round(clamp(num(k), 0, 20000))
  return { id, d, m: mealOf(m), n: String(n || '').trim().slice(0, NAME_MAX), g: 0, k: kcal, ...macros, t: now }
}

const addTotals = (a, e) => ({ k: a.k + (e.k || 0), p: r1(a.p + (e.p || 0)), f: r1(a.f + (e.f || 0)), c: r1(a.c + (e.c || 0)), n: a.n + 1 })
const ZERO = () => ({ k: 0, p: 0, f: 0, c: 0, n: 0 })

/** Adds a row. A row for a day that has already been folded goes straight into that day's total. */
export function addEntry(nut, e) {
  if (nut.rolledTo && e.d < nut.rolledTo) nut.days[e.d] = addTotals(nut.days[e.d] || ZERO(), e)
  else nut.log.push(e)
  return e
}

/** Changes a row in place. A new weight rescales the numbers; anything else is taken as given. */
export function editEntry(nut, id, patch, now = Date.now()) {
  const e = nut.log.find(x => x.id === id)
  if (!e) return null
  if (patch.g != null && e.g > 0 && patch.k == null) {
    const g = Math.round(clamp(num(patch.g), 1, GRAMS_MAX))
    Object.assign(e, scale(per100Of(e), g), { g })
  }
  if (patch.m != null) e.m = mealOf(patch.m)
  if (patch.d) e.d = patch.d
  for (const key of ['k', 'p', 'f', 'c']) if (patch[key] != null) e[key] = key === 'k' ? Math.round(num(patch[key])) : r1(num(patch[key]))
  if (patch.n != null) e.n = String(patch.n).trim().slice(0, NAME_MAX)
  e.t = now
  return e
}

/** Removes a row and remembers that it did, so another device's copy of it does not come back. */
export function removeEntry(nut, id, now = Date.now()) {
  const before = nut.log.length
  nut.log = nut.log.filter(x => x.id !== id)
  if (nut.log.length !== before) nut.del[id] = now
  return nut.log.length !== before
}

/* ---------- reading a day ---------- */

/** k / p / f / c eaten on a day and how many rows that was — from the rows, or from the folded total. */
export function dayTotals(nut, d) {
  if (nut.rolledTo && d < nut.rolledTo) return { ...ZERO(), ...(nut.days[d] || {}) }
  return nut.log.reduce((a, e) => (e.d === d ? addTotals(a, e) : a), ZERO())
}
/** The day's rows as four lists — breakfast, lunch, dinner, snack — each in the order logged. */
export function byMeal(nut, d) {
  const out = [[], [], [], []]
  for (const e of nut.log) if (e.d === d) out[mealOf(e.m)].push(e)
  out.forEach(rows => rows.sort((a, b) => (a.t || 0) - (b.t || 0)))
  return out
}
/** What is left of the target. Negative when the day went over — the caller says so, not this. */
export function remaining(target, totals) {
  if (!target) return null
  return { k: Math.round((target.kcal || 0) - totals.k), p: r1((target.p || 0) - totals.p), f: r1((target.f || 0) - totals.f), c: r1((target.c || 0) - totals.c) }
}
/** Every day that has anything logged, oldest first, with its totals. */
export function loggedDays(nut) {
  const days = new Map(Object.entries(nut.days).map(([d, v]) => [d, { ...ZERO(), ...v }]))
  for (const e of nut.log) days.set(e.d, addTotals(days.get(e.d) || ZERO(), e))
  return [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, v]) => ({ d, ...v }))
}

/* ---------- what you eat often ---------- */

const keyOf = e => e.r || 'n:' + e.n.toLowerCase()
const asPick = e => ({ key: keyOf(e), n: e.n, g: e.g, per100: per100Of(e), fixed: e.g > 0 ? null : { k: e.k, p: e.p, f: e.f, c: e.c }, r: e.r || null, t: e.t || 0 })

/** The last things logged, newest first, one per product, with the weight used last time. */
export function recentFoods(nut, limit = 20) {
  const seen = new Set(), out = []
  for (const e of [...nut.log].sort((a, b) => (b.t || 0) - (a.t || 0))) {
    const k = keyOf(e)
    if (seen.has(k) || !e.n) continue
    seen.add(k)
    out.push(asPick(e))
    if (out.length >= limit) break
  }
  return out
}
/** The products logged most often, most frequent first (ties: the more recent). */
export function frequentFoods(nut, limit = 20) {
  const by = new Map()
  for (const e of nut.log) {
    if (!e.n) continue
    const k = keyOf(e), cur = by.get(k)
    if (!cur) by.set(k, { count: 1, last: e })
    else { cur.count++; if ((e.t || 0) > (cur.last.t || 0)) cur.last = e }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || (b.last.t || 0) - (a.last.t || 0)).slice(0, limit)
    .map(x => ({ ...asPick(x.last), count: x.count }))
}

/* ---------- my products ---------- */

/** Saves a product (new, or over the one with the same id). Returns the stored row, or null. */
export function saveFood(nut, raw, { src = 'own', now = Date.now(), id } = {}) {
  const clean = sanitizeFood(raw)
  if (!clean) return null
  const fid = id || raw.id || newId()
  const row = { id: fid, ...clean, src: raw.src || src, t: now }
  const i = nut.foods.findIndex(x => x.id === fid)
  if (i >= 0) nut.foods[i] = row; else nut.foods.push(row)
  return row
}
/** Hides a product from search. It stays as a tombstone so the merge does not bring it back. */
export function archiveFood(nut, id, now = Date.now()) {
  const row = nut.foods.find(x => x.id === id)
  if (!row) return false
  row.x = true; row.t = now
  return true
}
export const myFoods = nut => nut.foods.filter(x => !x.x)

/* ---------- keeping it small ---------- */

/**
 * Folds every day older than `keep` days into its total and drops the rows; forgets tombstones
 * that are older than any device could plausibly still be holding the row for.
 * Idempotent: a day is only ever folded from rows that are then removed.
 */
export function rollUp(nut, today, { keep = ROLL_DAYS, now = Date.now() } = {}) {
  const cutoff = dayBefore(today, keep)
  if (!nut.rolledTo || cutoff > nut.rolledTo) {
    const stay = []
    for (const e of nut.log) {
      if (e.d < cutoff) nut.days[e.d] = addTotals(nut.days[e.d] || ZERO(), e)
      else stay.push(e)
    }
    nut.log = stay
    nut.rolledTo = cutoff
  }
  const oldest = now - TOMB_DAYS * DAY_MS
  for (const id of Object.keys(nut.del)) if (nut.del[id] < oldest) delete nut.del[id]
  return nut
}

/* ---------- two devices ---------- */

const latestById = (a, b) => {
  const by = new Map()
  for (const x of [...list(a), ...list(b)]) {
    if (!x || x.id == null) continue
    const cur = by.get(x.id)
    if (!cur || (x.t || 0) > (cur.t || 0)) by.set(x.id, x)
  }
  return [...by.values()]
}

/**
 * Two copies of the diary, one merged copy. Rows and products: union by id, the later edit of
 * one both have. Deletions: union, and a row is gone unless it was edited after it was deleted.
 * Folding: the later fold line wins and rows behind it are dropped — the copy that folded has
 * them in its totals already. Targets: whichever was set last.
 */
export function mergeNutrition(a, b) {
  if (!a && !b) return null
  const x = nutritionOf({ nutrition: a }), y = nutritionOf({ nutrition: b })
  const del = { ...x.del }
  for (const [id, t] of Object.entries(y.del)) if (!(del[id] >= t)) del[id] = t
  const rolledTo = !x.rolledTo ? y.rolledTo : !y.rolledTo ? x.rolledTo : (x.rolledTo > y.rolledTo ? x.rolledTo : y.rolledTo)
  const log = latestById(x.log, y.log)
    .filter(e => !(del[e.id] >= (e.t || 0)) && !(rolledTo && e.d < rolledTo))
    .sort((p, q) => (p.d === q.d ? (p.t || 0) - (q.t || 0) : p.d < q.d ? -1 : 1))
  const days = { ...x.days }
  for (const [d, v] of Object.entries(y.days)) if (!days[d] || (v.n || 0) > (days[d].n || 0)) days[d] = v
  // A day one copy folded and the other still holds as rows behind the new line is only in `days`.
  for (const src of [x, y]) {
    if (!rolledTo || src.rolledTo === rolledTo) continue
    const late = {}
    for (const e of src.log) if (e.d < rolledTo && !(del[e.id] >= (e.t || 0))) late[e.d] = addTotals(late[e.d] || ZERO(), e)
    for (const [d, v] of Object.entries(late)) if (!days[d] || v.n > (days[d].n || 0)) days[d] = v
  }
  const targets = !x.targets ? y.targets : !y.targets ? x.targets : ((y.targets.t || 0) > (x.targets.t || 0) ? y.targets : x.targets)
  return { v: 1, targets: targets || null, log, days, rolledTo: rolledTo || null, foods: latestById(x.foods, y.foods), del }
}

/** Rows and products `local` holds that `server` does not — what a sign-in would otherwise drop. */
export function nutritionExtras(local, server) {
  const have = new Set(nutritionOf({ nutrition: server }).log.map(e => e.id))
  return nutritionOf({ nutrition: local }).log.filter(e => !have.has(e.id)).length
}
