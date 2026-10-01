// Editing a workout that is already in the history.
//
// "I forgot to log the last exercise" is not a new workout and not a note — it is the same
// session, missing something. So an edit reopens the logged workout on the ordinary workout
// screen: its entries and sets become the session, everything that screen can do (add an
// exercise, add a set, fix a number, write a note) is available, and saving files the result
// back where the original was. It rides on the mechanism "log a past workout" already has
// (`backfill` on the active session: no clock, no rest timers, filed by date, the original
// replaced only when the session is finished — lib/backfill.js), with one more field, `edit`,
// carrying what an edit must not lose.
//
// What an edit keeps exactly as it was: the workout's id (history, the Coach's debriefs and the
// sync merge all key on it), its day, start and end, the body weight logged with it, and the
// records it set. What it deliberately does not do, like any backfilled session: claim new
// records or move the remembered best weights — those belong to the day they were set on, and
// the progression engine reads the edited sets from the history anyway.
import { hasCompletedWork } from './workout-model.js'
import { backfillEnd } from './backfill.js'

/** A logged workout as a session the workout screen can open. Nothing of `w` is shared: an
 *  abandoned edit must leave the history exactly as it was. */
export function editSessionFor(w, { workoutView = 'cards' } = {}) {
  const routineIds = [].concat(w.routineIds ?? (w.routineId ? [w.routineId] : []))
  const end = w.end || w.start
  return {
    id: w.id, d: w.d, start: w.start,
    routineIds,
    // The name is what the user saw in their history; bringing another routine into the edit
    // must not rename it behind their back (the workout screen renames only un-named sessions).
    name: w.name, customName: true,
    bw: w.bw ?? null, cur: 0,
    entries: (w.entries || []).map(e => ({
      id: e.id,
      target: e.target ? { ...e.target } : null,
      sets: (e.sets || []).map(s => ({ ...s })),
      ...(e.topW != null ? { topW: e.topW } : {}),
      ...(e.rid ? { rid: e.rid } : {}),
      ...(e.noProg === true ? { noProg: true } : {}),
      ...(e.note ? { note: e.note, ...(e.notePin ? { notePin: true } : {}) } : {}),
      // An exercise deleted since (a custom one, or a shared one this device no longer has) is
      // only still readable because the log kept its name and muscles. They ride through the
      // edit; lib/finish-workout.js writes them back.
      ...(e.n ? { n: e.n } : {}),
      ...(e.muscleSnapshot ? { muscleSnapshot: { ...e.muscleSnapshot } } : {})
    })),
    ...(w.note ? { note: w.note } : {}),
    backfill: {
      durationMin: Math.max(1, Math.round((end - w.start) / 60000)),
      replaceId: w.id,
      edit: { end, prs: [...(w.prs || [])] }
    },
    workoutView
  }
}

export const isEditSession = active => !!active?.backfill?.edit

/** When the edited workout ended: when it really did, to the millisecond, not start + minutes. */
export const editedEnd = active => active?.backfill?.edit?.end || backfillEnd(active)

/** The records the workout held, minus any whose exercise no longer has a completed set in it. */
export function editedPrs(active) {
  const still = new Set((active?.entries || []).filter(e => (e.sets || []).some(hasCompletedWork)).map(e => e.id))
  return (active?.backfill?.edit?.prs || []).filter(id => still.has(id))
}

/**
 * The state as the workout screen should read history while an edit is open: only what came
 * before the workout being edited. Otherwise "Last time" on an exercise card is the very
 * workout on screen — or, for one edited from weeks back, a session that had not happened yet.
 * Any other session reads the state as it is.
 */
export function historyBefore(S) {
  const A = S?.active
  if (!isEditSession(A)) return S
  const earlier = w => w.id !== A.id && (w.d < A.d || (w.d === A.d && (w.start || 0) < (A.start || 0)))
  return { ...S, workouts: (S.workouts || []).filter(earlier) }
}

/** An edit that leaves nothing completed is a deletion, and History has a button for that. */
export const editHasWork = active => (active?.entries || []).some(e => (e.sets || []).some(hasCompletedWork))
