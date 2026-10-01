// "Describe it in your own words" — the client half.
//
// The server (or the phone's own copy of the same core, api/coach/core/match.js) answers with,
// per exercise the text mentioned: the catalogue rows the model's English name resolved to, and
// the draft of a new exercise in case none of them is it. This module turns that answer into
// what the picker shows. Pure, so the two decisions it makes are testable without a sheet:
// which rows are offered, and what a draft may prefill.
import { EXIDX, BODYPARTS, allExercises, searchExercises } from './exercises.js'
import { ALL_EQUIPMENT } from './equipment.js'
import { MUSCLES, inMuscleOrder } from './muscles.js'

export const MAX_TEXT = 600          // api/coach/core/match.js MAX_TEXT — the server cuts there too
export const MAX_CANDIDATES = 6
// Bumping this re-asks on the sheet: it means what a lookup sends, or to whom, changed.
export const LOOKUP_CONSENT_VERSION = 1
// How many rows the app's own search may add under the ones the Coach resolved.
const OWN_SEARCH_ROWS = 3

/**
 * The exercises one interpreted item could be, best first.
 *
 * The resolved rows lead. Under them come hits from the app's own search on the words as they
 * were typed: that search knows the translated exercise names and the user's spelling, which
 * the model's English name does not — "жим лёжа" finds the row by its Russian name even when
 * the English guess landed on a neighbour. An id that resolves to nothing (a catalogue row this
 * build does not have) is dropped rather than shown as "Unknown exercise".
 */
export function candidatesFor(item, S) {
  const out = []
  const seen = new Set()
  const add = ex => { if (ex && !ex.missing && !seen.has(ex.id)) { seen.add(ex.id); out.push(ex) } }
  for (const m of (item && item.matches) || []) add(EXIDX[m.id])
  const said = String((item && item.said) || '').trim()
  if (said && out.length < MAX_CANDIDATES) {
    const own = searchExercises(allExercises(S), said)
    // A phrase that matches half the catalogue ("press") is not evidence of anything.
    if (own.length <= 40) own.slice(0, OWN_SEARCH_ROWS).forEach(add)
  }
  return out.slice(0, MAX_CANDIDATES)
}

/**
 * What the "create your own exercise" form starts from. Every field is checked against the
 * list the form itself offers — a body part with no chip or a muscle the map cannot draw would
 * otherwise be saved without ever having been shown.
 */
export function draftFor(item) {
  const c = (item && item.create) || {}
  const primaries = inMuscleOrder((Array.isArray(c.primary) ? c.primary : []).filter(m => MUSCLES.includes(m)))
  const secondaries = inMuscleOrder((Array.isArray(c.secondary) ? c.secondary : []).filter(m => MUSCLES.includes(m) && !primaries.includes(m)))
  const name = String(c.name || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return {
    n: name ? name[0].toUpperCase() + name.slice(1) : '',
    bp: BODYPARTS.includes(item && item.bp) ? item.bp : '',
    eq: ALL_EQUIPMENT.includes(item && item.eq) ? item.eq : '',
    desc: String(c.desc || '').trim().slice(0, 1000),
    primaries: item && item.bp === 'cardio' ? [] : primaries,
    secondaries
  }
}

/**
 * The same answer shape with no model behind it: the text split the way a person lists things,
 * each piece left to the app's own search. It is what the demo build shows, and it is honest
 * about being a search — nothing is interpreted, so nothing is drafted beyond the name.
 */
export function plainMatch(text) {
  const parts = String(text || '').slice(0, MAX_TEXT).split(/[,;\n]+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8)
  return {
    items: parts.map(said => ({
      said, names: [said.toLowerCase()], bp: null, eq: null, matches: [], exact: false,
      create: { name: said, desc: '', primary: [], secondary: [] }
    }))
  }
}

/** Has this profile agreed to its words being sent — on the sheet itself, or to the Coach as a whole? */
export const hasLookupConsent = S => !!(S && S.coach && ((S.coach.consent && S.coach.consent.agreedAt) ||
  (S.coach.lookupConsent && S.coach.lookupConsent.agreedAt && S.coach.lookupConsent.version === LOOKUP_CONSENT_VERSION)))
