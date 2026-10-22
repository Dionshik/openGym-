// "Describe the workout you did" — the client half.
//
// The server (or the phone's own copy of the same core, api/coach/core/logtext.js) answers with
// each exercise the text mentioned — the catalogue rows its English name resolved to, the draft
// of a new exercise, and the sets copied out of the text — plus the day, if the text said one.
// This module turns that into the draft the person checks: which exercise each line most likely
// is and whether to ask, what the rows become on the workout screen, and the weights in the
// person's own unit. Pure, so the decisions are testable without a sheet.
import { EXIDX } from './exercises.js'
import { buildSets, defaultConfig, freestyleConfig, modeOf } from './history.js'
import { candidatesFor } from './exercise-match.js'
import { exercisePieces, readSet, setsFromText, unitFromText } from '../../../api/coach/core/logtext-parse.js'

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

// A catalogue name as words, without the camera angle and the "(male)" that only tell two
// recordings of one movement apart: "pull-up" and "Pull Up" are one name.
const nameKey = s => String(s || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/\((?:male|female|back pov|side pov|front pov|v\. ?\d+)\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Whether a line needs the person's say-so. It does not when:
 *  - the best match is one of their own exercises, named outright (score 1);
 *  - one of the close matches is an exercise they already log — that one, even if it ranked
 *    second: of a dozen bench presses, theirs is the one they meant;
 *  - one of the model's English names *is* the best row's name, and no row spelled the same
 *    scores as well. A score alone is not enough: "barbell squat" scores 0.98 against "barbell
 *    bench squat", a different exercise, and three squats tie on it.
 * Everything else is asked: a wrong guess filed silently would put somebody's bench press into a
 * fly's history.
 *
 * @returns {{ status:'sure'|'ask', id:string|null }}
 */
export function initialChoice(item, S, usage = usageOf(S)) {
  const ms = ((item && item.matches) || []).filter(m => EXIDX[m.id] && !EXIDX[m.id].missing)
  if (!ms.length) return { status: 'ask', id: null }
  const top = ms[0]
  if (top.custom && top.score >= 1) return { status: 'sure', id: top.id }
  const used = ms.find(m => usage[m.id] && m.score >= 0.8 && m.score >= top.score - 0.05)
  if (used) return { status: 'sure', id: used.id }
  const exactly = m => (item.names || []).some(n => nameKey(n) && nameKey(n) === nameKey(EXIDX[m.id].n))
  const named = exactly(top)
  // A tie is another row spelled exactly like this one (their own "Barbell Bench Press"). Rows
  // that only add words score the same: another recording of the movement ("barbell bench press
  // (side pov)", many since v1.4.0) or a variant of it. Neither is a second answer to the name.
  const spelled = m => String(EXIDX[m.id].n).toLowerCase().trim()
  const tied = ms.slice(1).some(m => m.score >= top.score && exactly(m) && spelled(m) === spelled(top))
  if (named && !tied) return { status: 'sure', id: top.id }
  return { status: 'ask', id: null }
}

/**
 * The draft's first answer for every line. On top of initialChoice, one rule across lines: an
 * exercise the app would be "sure" of on two lines or more is asked about on all of them. Two
 * lines of one session rarely are the same exercise, and when every line lands on one row (a
 * model that stamped one custom exercise on the whole workout) the person must not be shown
 * six ticked guesses.
 */
export function initialChoices(items, S, usage = usageOf(S)) {
  const out = (items || []).map(it => initialChoice(it, S, usage))
  const count = {}
  for (const c of out) if (c.status === 'sure') count[c.id] = (count[c.id] || 0) + 1
  return out.map(c => (c.status === 'sure' && count[c.id] > 1 ? { status: 'ask', id: null } : c))
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

/**
 * What a session of this exercise is meant to be, the way the person does it: the routine's
 * prescription when it is in one, else the last session's target (as a freestyle add does on the
 * workout screen), else the default. Always carries the id and the mode, so every label that
 * reads it back knows a run from a rep set.
 */
export function usualTarget(S, id) {
  const inRoutine = ((S && S.routines) || []).flatMap(r => r.ex || []).find(c => c && c.id === id)
  const base = inRoutine ? { ...inRoutine } : freestyleConfig(S, { id, ...defaultConfig(id) })
  const { sg: _sg, ...rest } = base
  return { ...rest, id, mode: modeOf({ ...rest, id }) }
}

/**
 * Which way an exercise is logged, from what the text said about it — reps when there are reps,
 * whatever the catalogue files it under (burpees, a jump rope); a hold when there are only
 * seconds; minutes are cardio for cardio and a hold in minutes for anything else ("планка 2
 * мин"). Null when the text gave no numbers: then the person's usual way stands.
 */
export function logMode(ex, rows, usualMode = null) {
  const work = (rows || []).filter(r => r.reps || r.sec || r.min)
  if (!work.length) return null
  if (work.some(r => r.reps)) return 'reps'
  if (work.some(r => r.sec)) return 'time'
  const cardio = (ex && modeOf({ id: ex.id }) === 'cardio') || usualMode === 'cardio'
  return cardio ? 'cardio' : 'time'
}

/**
 * One exercise of the draft as a session entry on the "log a past workout" screen. The rows the
 * text gave are filled in and ticked — they were done; an exercise the text named without
 * numbers gets the usual rows from the last time, unticked, for the person to fill.
 *
 * The target is what the session was meant to be (usualTarget), never what was done: judged
 * against itself, every session is a hit, and the progression engine would add weight after a
 * session that fell short.
 *
 * @param {{ unit:'kg'|'lb'|null }} opts  the unit the text was in; the app's own when absent
 */
export function entryFromLog(S, ex, rows, { unit = null } = {}) {
  const own = S && S.unit === 'lb' ? 'lb' : 'kg'
  const from = unit === 'lb' || unit === 'kg' ? unit : own
  const usual = usualTarget(S, ex.id)
  const given = (rows || []).filter(r => r.reps || r.sec || r.min)
  if (!given.length) return { id: ex.id, target: usual, plan: null, sets: buildSets(S, usual, { preferLast: true }) }
  const mode = logMode(ex, given, usual.mode)
  const target = usual.mode === mode ? usual : { ...defaultConfig(ex.id, mode), id: ex.id, mode }
  const w = r => convertWeight(r.weight || 0, from, own)
  const sets = given.map(r => {
    const warm = r.warmup ? { phase: 'warmup', warmup: true } : {}
    if (mode === 'cardio') return { min: r.min || target.min || 20, speed: r.speed || target.speed || 8, done: true, ...warm }
    if (mode === 'time') return { sec: r.sec || (r.min ? Math.round(r.min * 60) : target.sec || 45), w: w(r), done: true, ...warm }
    return { w: w(r), r: r.reps || 0, done: true, ...warm }
  })
  return { id: ex.id, target, plan: null, sets }
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
 * The same answer shape with no model behind it, for the demo build: the day and the sets read
 * by the server's own patterns (api/coach/core/logtext-parse.js), one exercise per line, its
 * name — the words before the first number — left to the app's own search. Honest about being
 * a search: nothing is interpreted, so nothing is drafted beyond the name.
 */
export function plainLog(text, today = null) {
  const clean = String(text || '').slice(0, MAX_LOG_TEXT)
  const { date, pieces } = exercisePieces(clean, today)
  return {
    date: date ? date.iso : null, start: null, minutes: null, unit: unitFromText(clean),
    items: pieces.slice(0, 15).map(piece => {
      const cut = piece.search(/[\d+]/)
      const said = (cut > 0 ? piece.slice(0, cut) : piece).replace(/[\s,:;—-]+$/, '').trim() || piece
      // Through the server's own row check, as validateLog does: speed from a distance, no 8000 kg.
      const sets = setsFromText(cut > 0 ? piece.slice(cut) : '').map(readSet).filter(Boolean)
      return { said, names: [said.toLowerCase()], bp: null, eq: null, matches: [], exact: false, create: { name: said, desc: '', primary: [], secondary: [] }, sets }
    })
  }
}
