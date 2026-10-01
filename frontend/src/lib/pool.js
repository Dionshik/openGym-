// The shared exercise pool, from the client's side (the server's is api/pool.js).
//
// A custom exercise is its owner's alone until they suggest it; a moderator then approves it
// (after which every profile on the instance has it) or declines it with a note. The store holds
// the pool itself (store/useStore.js `pool`); this module is the calls, and the few decisions
// about a single exercise that are worth testing without a screen.
import { api } from './api.js'
import { BODYPARTS } from './exercises.js'
import { ALL_EQUIPMENT } from './equipment.js'
import { DEMO } from './demo.js'

/** Is there a pool to talk to at all? Signed in, on a server that has one. Never guests, never the demo. */
export const poolAvailable = (config, user) => !DEMO && !!user && config?.pool === true

/** May this exercise be put to a moderator as it stands? → null, or the reason it may not. */
export function suggestBlocker(ex) {
  if (!ex || !ex.custom) return 'not-custom'
  if (!String(ex.n || '').trim()) return 'name'
  if (!BODYPARTS.includes(ex.bp)) return 'bp'
  // Imported exercises (CSV, Hevy) arrive with `eq: "custom"` — nobody ever said what they are
  // done with, and "custom" is not something another person can filter by.
  if (!ALL_EQUIPMENT.includes(ex.eq)) return 'eq'
  return null
}

// What is sent: the fields the pool keeps, by name. The server allowlists again; this is so the
// request does not carry what it would only throw away.
const FIELDS = ['id', 'n', 'bp', 'eq', 'tg', 'primaries', 'secondaries', 'muscleGroups', 'sm', 'desc']
export const toSuggestion = ex => Object.fromEntries(FIELDS.filter(k => ex[k] != null).map(k => [k, ex[k]]))

/** How a suggestion of this profile's stands: { id, status, note? } or null if it never made one. */
export const suggestionOf = (pool, id) => (pool?.mine || []).find(m => m.id === id) || null

const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) })
export const suggestExercise = ex => post('/api/pool/submit', { exercise: toSuggestion(ex) })
export const withdrawSuggestion = id => post('/api/pool/withdraw', { id })

/* ---------- admins and moderators ---------- */
export const modPool = () => api('/api/mod/pool')
export const approveSuggestion = (id, edits) => post('/api/mod/pool/review', { id, action: 'approve', ...(edits ? { edits: toSuggestion(edits) } : {}) })
export const declineSuggestion = (id, note) => post('/api/mod/pool/review', { id, action: 'reject', note: note || '' })
export const updateShared = (id, exercise) => post('/api/mod/pool/update', { id, exercise: toSuggestion(exercise) })
export const retireShared = (id, retired = true) => post('/api/mod/pool/retire', { id, retired })

// The server's refusals, by the `code` it sends, in the app's voice. Source strings — pass
// through t(). An unknown code falls back to the generic line rather than to server English.
export const POOL_ERRORS = {
  name: 'An exercise with this name is already in the library.',
  eq: 'Pick the equipment for this exercise first — edit it, then suggest it.',
  bp: 'Pick a body part for this exercise first — edit it, then suggest it.',
  cap: 'You already have ten suggestions waiting — let those be looked at first.',
  taken: 'Somebody else already suggested an exercise with this id.',
  builtin: 'This exercise replaces a built-in one on your device and cannot be shared.',
  shared: 'This exercise is already shared with everyone.',
  decided: 'Somebody already decided this one.',
  full: 'The shared pool is full.'
}
export const poolErrorText = e => POOL_ERRORS[e?.data?.code] || (e && e.status == null ? 'No connection — try again when you are back online.' : 'That did not work — try again.')

/** The moderator's three lists out of everything the server holds, each newest first. */
export function splitModPool(items) {
  const by = k => (a, b) => (b[k] || 0) - (a[k] || 0)
  const all = Array.isArray(items) ? items : []
  return {
    pending: all.filter(r => r.status === 'pending').sort((a, b) => (a.at || 0) - (b.at || 0)),   // oldest first: a queue
    shared: all.filter(r => r.status === 'approved' || r.status === 'retired').sort(by('reviewedAt')),
    declined: all.filter(r => r.status === 'rejected').sort(by('reviewedAt'))
  }
}
