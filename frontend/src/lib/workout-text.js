// "Describe the workout you did" — the client half.
//
// The server (or the phone's own copy of the same core, api/coach/core/logtext.js) answers with
// each exercise the text mentioned — the catalogue rows its English name resolved to, the draft
// of a new exercise, and the sets copied out of the text — plus the day, if the text said one.
// This module turns that into the draft the person checks: which exercise each line most likely
// is and whether to ask, what the rows become on the workout screen, and the weights in the
// person's own unit. Pure, so the decisions are testable without a sheet.
import { EXIDX } from './exercises.js'
import { buildSets, defaultConfig, modeOf } from './history.js'
import { candidatesFor } from './exercise-match.js'

export const MAX_LOG_TEXT = 1500     // api/coach/core/logtext.js MAX_LOG_TEXT — the server cuts there too
export const LB_PER_KG = 2.20462

/** Exercise id → how many times it is in the person's routines and logged workouts. */
export function usageOf(S) {
  const u = {}
  for (const r of (S && S.routines) || []) for (const e of r.ex || []) u[e.id] = (u[e.id] || 0) + 1
  for (const w of (S && S.workouts) || []) for (const e of w.entries || []) u[e.id] = (u[e.id] || 0) + 1
  return u
}

/**
 * The exercises one line could be, best first — the lookup's candidates, with one change: an
 * exercise this person has logged before moves ahead of near-equal rows they never did. "Bench
 * press" is a dozen rows in the catalogue and one of them is *theirs*; that is the one they meant
 * nine times out of ten. Only the leading rows are reordered, so a used exercise that is a poor
 * match does not jump the list.
 */
export function logCandidates(item, S, usage = usageOf(S)) {
  const rows = candidatesFor(item, S)
  const head = rows.slice(0, 3)
  const used = head.filter(e => usage[e.id])
  return [...used, ...head.filter(e => !usage[e.id]), ...rows.slice(3)]
}

/**
 * Whether a line needs the person's say-so. It does not when the model's name *is* a catalogue
 * row, or it named one of their own exercises — or when the best candidate is an exercise they
 * already log and it is the row the lookup ranked first. Everything else is asked: a wrong
 * guess filed silently would put somebody's bench press into a fly's history.
 *
 * @returns {{ status:'sure'|'ask', id:string|null }}
 */
export function initialChoice(item, S, usage = usageOf(S)) {
  const best = (item && item.matches && item.matches[0]) || null
  const known = best && EXIDX[best.id] && !EXIDX[best.id].missing ? best.id : null
  if (known && (item.exact || (best.custom && best.score >= 1))) return { status: 'sure', id: known }
  if (known && usage[known] && best.score >= 0.8) return { status: 'sure', id: known }
  return { status: 'ask', id: null }
}

/** A weight read in one unit, in the other — to the quarter, the smallest plate either side. */
export function convertWeight(w, from, to) {
  if (!(w > 0) || !from || !to || from === to) return w || 0
  const v = from === 'lb' ? w / LB_PER_KG : w * LB_PER_KG
  return Math.round(v * 4) / 4
}

/** How the rows read on the draft: "3 × 8 · 80 kg" when they are all alike, "80×8, 85×6" when not. */
export function setsLine(rows, unit) {
  const work = (rows || []).filter(r => !r.warmup)
  if (!work.length) return ''
  const one = r => r.min ? `${r.min} min${r.speed ? ' @ ' + r.speed + ' km/h' : ''}`
    : r.sec ? `${r.sec} s${r.weight ? ' · ' + r.weight + ' ' + unit : ''}`
      : `${r.reps}${r.weight ? ' × ' + r.weight + ' ' + unit : ''}`
  const same = work.every(r => one(r) === one(work[0]))
  if (same) {
    const r = work[0]
    if (r.min || r.sec) return `${work.length} × ${one(r)}`
    return `${work.length} × ${r.reps}${r.weight ? ' · ' + r.weight + ' ' + unit : ''}`
  }
  return work.map(r => r.min || r.sec ? one(r) : `${r.weight ? r.weight + '×' : ''}${r.reps}`).join(', ')
}

/** Which way an exercise is logged, given what the text said about it. */
export function logMode(ex, rows) {
  if (!ex) return 'reps'
  const own = modeOf({ id: ex.id })
  if (own === 'cardio') return 'cardio'
  const work = (rows || []).filter(r => !r.warmup)
  if (work.length && work.every(r => r.sec && !r.reps)) return 'time'
  if (work.length && work.every(r => r.min && !r.reps && !r.sec)) return 'cardio'
  return 'reps'
}

/**
 * One exercise of the draft as a session entry on the "log a past workout" screen. The rows the
 * text gave are filled in and ticked — they were done; an exercise the text named without
 * numbers gets the usual rows from the last time, unticked, for the person to fill.
 *
 * @param {{ unit:'kg'|'lb'|null }} opts  the unit the text was in; the app's own when absent
 */
export function entryFromLog(S, ex, rows, { unit = null } = {}) {
  const own = S && S.unit === 'lb' ? 'lb' : 'kg'
  const from = unit === 'lb' || unit === 'kg' ? unit : own
  const mode = logMode(ex, rows)
  const cfg = { ...defaultConfig(ex.id, mode) }
  // A run typed as minutes under an exercise the catalogue does not file as cardio still logs
  // as one; said on the config, or modeOf would read it back as reps.
  if (mode === 'cardio' && modeOf({ id: ex.id }) !== 'cardio') cfg.mode = 'cardio'
  const given = (rows || []).filter(r => r.reps || r.sec || r.min)
  const w = r => convertWeight(r.weight || 0, from, own)
  const work = given.filter(r => !r.warmup)
  if (work.length) {
    cfg.sets = work.length
    const first = work[0]
    if (mode === 'reps') { cfg.reps = first.reps || cfg.reps; cfg.weight = w(first) }
    else if (mode === 'time') { cfg.sec = first.sec || cfg.sec; cfg.weight = w(first) }
    else { cfg.min = first.min || cfg.min; if (first.speed) cfg.speed = first.speed }
  }
  const sets = given.length
    ? given.map(r => {
      const warm = r.warmup ? { phase: 'warmup', warmup: true } : {}
      if (mode === 'cardio') return { min: r.min || cfg.min || 20, speed: r.speed || cfg.speed || 8, done: true, ...warm }
      if (mode === 'time') return { sec: r.sec || cfg.sec || 45, w: w(r), done: true, ...warm }
      return { w: w(r), r: r.reps || 0, done: true, ...warm }
    })
    : buildSets(S, { ...cfg, id: ex.id }, { preferLast: true })
  return { id: ex.id, target: cfg, plan: null, sets }
}

/** The draft's lines that still need an answer before the workout can be opened. */
export const unresolved = choices => (choices || []).filter(c => c.status === 'ask').length

/** Every chosen line, in the text's order, as session entries. Lines left out are skipped. */
export function entriesFromDraft(S, items, choices, { unit = null } = {}) {
  const out = []
  ;(items || []).forEach((item, i) => {
    const c = choices[i]
    if (!c || c.status === 'skip' || !c.id) return
    const ex = EXIDX[c.id]
    if (!ex || ex.missing) return
    out.push(entryFromLog(S, ex, item.sets, { unit }))
  })
  return out
}

/**
 * The same answer shape with no model behind it, for the demo build: one exercise per line or
 * comma, its numbers read by a pattern ("3x8 80", "3×8 по 80") and its name left to the app's
 * own search. Honest about being a search — nothing is interpreted, so nothing is drafted
 * beyond the name, and no day is read.
 */
export function plainLog(text) {
  const parts = String(text || '').slice(0, MAX_LOG_TEXT).split(/[,;\n]+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 15)
  return {
    date: null, start: null, minutes: null, unit: null,
    items: parts.map(part => {
      const m = part.match(/(\d+)\s*[xх×*]\s*(\d+)(?:\s*(?:по|@|at)?\s*(\d+(?:[.,]\d+)?))?/i)
      const said = part.replace(/\d+\s*[xх×*]\s*\d+(?:\s*(?:по|@|at)?\s*\d+(?:[.,]\d+)?)?(?:\s*(?:kg|кг|lb))?/i, '').trim() || part
      const sets = m ? Array.from({ length: Math.min(30, +m[1]) }, () => ({ reps: +m[2], ...(m[3] ? { weight: +m[3].replace(',', '.') } : {}) })) : []
      return { said, names: [said.toLowerCase()], bp: null, eq: null, matches: [], exact: false, create: { name: said, desc: '', primary: [], secondary: [] }, sets }
    })
  }
}
