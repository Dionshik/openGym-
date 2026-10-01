import { describe, it, expect } from 'vitest'
import { editSessionFor, isEditSession, editedEnd, editedPrs, editHasWork, historyBefore } from './workout-edit.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { completeBackfill } from './backfill.js'
import { workoutVolume } from './history.js'

// A workout exactly as doFinishWorkout writes it: two routines, a note, a pinned exercise note,
// a record, an unchecked set, and one exercise that has since been deleted.
const logged = () => ({
  id: 'w2', d: '2026-09-10', start: 1_000_000, end: 1_000_000 + 47 * 60000 + 1234,
  routineIds: ['r1', 'r2'], routineId: 'r1', name: 'Push + Pull', bw: 81.5,
  entries: [
    { id: '0025', sets: [{ w: 80, r: 8, done: true }, { w: 80, r: 7, done: true }, { w: 80, r: 0, done: false }], topW: 80, target: { sets: 3, reps: 8, weight: 80, mode: 'reps' }, rid: 'r1', note: 'left shoulder tight', notePin: true },
    { id: '0027', sets: [{ w: 60, r: 10, done: true }], topW: 60, target: { sets: 1, reps: 10, weight: 60 }, rid: 'r2', noProg: true },
    { id: 'cgone', sets: [{ w: 20, r: 12, done: true }], topW: 20, target: null, n: 'My old cable thing', muscleSnapshot: { n: 'My old cable thing', bp: 'back', muscleWeights: { 'upper-back': 1 } } }
  ],
  prs: ['0025'], note: 'Good session.', vol: 80 * 15 + 600 + 240
})
// What the finish path does with a session, minus the store.
const save = (history, session) => {
  const w = buildCompletedWorkout(session, { end: editedEnd(session), prs: editedPrs(session), snapshotFor: () => null })
  w.vol = workoutVolume(w)
  return completeBackfill(history, session, w)
}

describe('editSessionFor', () => {
  it('opens the workout as a backfill session that replaces itself', () => {
    const s = editSessionFor(logged(), { workoutView: 'list' })
    expect(isEditSession(s)).toBe(true)
    expect(s).toMatchObject({ id: 'w2', d: '2026-09-10', start: 1_000_000, name: 'Push + Pull', customName: true, bw: 81.5, cur: 0, workoutView: 'list', note: 'Good session.', routineIds: ['r1', 'r2'] })
    expect(s.backfill).toEqual({ durationMin: 47, replaceId: 'w2', edit: { end: 1_000_000 + 47 * 60000 + 1234, prs: ['0025'] } })
    expect(s.entries.map(e => e.id)).toEqual(['0025', '0027', 'cgone'])
    expect(s.entries[0]).toMatchObject({ rid: 'r1', note: 'left shoulder tight', notePin: true, topW: 80 })
    expect(s.entries[1]).toMatchObject({ rid: 'r2', noProg: true })
  })

  it('shares nothing with the history, so an abandoned edit changes nothing', () => {
    const w = logged()
    const before = JSON.stringify(w)
    const s = editSessionFor(w)
    s.entries[0].sets[0].w = 999
    s.entries[0].sets.push({ w: 85, r: 5, done: true })
    s.entries[0].target.weight = 1
    s.entries[2].muscleSnapshot.bp = 'changed'
    s.backfill.edit.prs.push('x')
    s.entries.pop()
    expect(JSON.stringify(w)).toBe(before)
  })

  it('reads a workout from before routine lists, and one with no end', () => {
    const old = { id: 'w0', d: '2025-01-01', start: 500, routineId: 'r9', name: 'Legs', entries: [{ id: '0043', sets: [{ w: 100, r: 5, done: true }] }] }
    const s = editSessionFor(old)
    expect(s.routineIds).toEqual(['r9'])
    expect(s.bw).toBe(null)
    expect(s.backfill).toEqual({ durationMin: 1, replaceId: 'w0', edit: { end: 500, prs: [] } })
    expect(editSessionFor({ ...old, routineId: null }).routineIds).toEqual([])
  })

  it('a live session and a plain backfill are not edits', () => {
    expect(isEditSession({ id: 'a', entries: [] })).toBe(false)
    expect(isEditSession({ id: 'a', backfill: { durationMin: 60, replaceId: null } })).toBe(false)
    expect(isEditSession(null)).toBe(false)
  })
})

describe('saving an edit', () => {
  it('opened and saved untouched, the workout is exactly what it was — in the same place', () => {
    const history = [{ id: 'w1', d: '2026-09-08', start: 1 }, logged(), { id: 'w3', d: '2026-09-12', start: 9_000_000 }]
    const after = save(history, editSessionFor(logged()))
    expect(after.map(w => w.id)).toEqual(['w1', 'w2', 'w3'])
    expect(after[1]).toEqual(logged())
  })

  it('a forgotten exercise and a forgotten set are added; id, day, times, body weight and records stay', () => {
    const s = editSessionFor(logged())
    s.entries[1].sets.push({ w: 60, r: 9, done: true })                                              // the set
    s.entries.push({ id: '0294', target: { sets: 2, reps: 12, weight: 14 }, sets: [{ w: 14, r: 12, done: true }, { w: 14, r: 11, done: true }] })   // the exercise
    const [w] = save([logged()], s)
    expect(w).toMatchObject({ id: 'w2', d: '2026-09-10', start: 1_000_000, end: logged().end, bw: 81.5, prs: ['0025'], note: 'Good session.' })
    expect(w.entries.map(e => e.id)).toEqual(['0025', '0027', 'cgone', '0294'])
    expect(w.entries[1].sets).toHaveLength(2)
    expect(w.entries[3].topW).toBe(14)
    expect(w.vol).toBe(logged().vol + 60 * 9 + 14 * 23)
  })

  it('a corrected number changes that set and the totals, and claims no new record', () => {
    const s = editSessionFor(logged())
    s.entries[0].sets[1] = { w: 100, r: 7, done: true }                                              // typed 80, lifted 100
    const [w] = save([logged()], s)
    expect(w.entries[0].sets[1].w).toBe(100)
    expect(w.entries[0].topW).toBe(100)
    expect(w.prs).toEqual(['0025'])                                                                  // the one it had, nothing added
  })

  it('an exercise that no longer exists keeps the name and muscles the log held for it', () => {
    const [w] = save([logged()], editSessionFor(logged()))
    expect(w.entries[2].n).toBe('My old cable thing')
    expect(w.entries[2].muscleSnapshot).toEqual(logged().entries[2].muscleSnapshot)
  })

  it('a live session never writes a name or a stale snapshot onto an entry', () => {
    const live = { id: 'a', d: '2026-09-20', start: 1, name: 'x', bw: null, entries: [{ id: '0025', sets: [{ w: 50, r: 5, done: true }], target: null }] }
    const w = buildCompletedWorkout(live, { end: 2, prs: [] })
    expect('n' in w.entries[0]).toBe(false)
    expect('muscleSnapshot' in w.entries[0]).toBe(false)
  })
})

describe('historyBefore', () => {
  const earlier = { id: 'w1', d: '2026-09-08', start: 1, entries: [] }
  const sameDayEarlier = { id: 'w1b', d: '2026-09-10', start: 500, entries: [] }
  const later = { id: 'w3', d: '2026-09-12', start: 9, entries: [] }
  const workouts = [earlier, sameDayEarlier, logged(), later]

  it('while editing, history is what came before that workout — not itself, and not what followed', () => {
    const S = { workouts, active: editSessionFor(logged()) }
    expect(historyBefore(S).workouts.map(w => w.id)).toEqual(['w1', 'w1b'])
    expect(S.workouts).toHaveLength(4)                              // a view, not a change
  })

  it('a live session, a plain backfill and no session at all read the state as it is', () => {
    for (const active of [null, { id: 'live', d: '2026-09-20', start: 1, entries: [] }, { id: 'b', d: '2026-09-01', start: 1, backfill: { durationMin: 30, replaceId: null }, entries: [] }]) {
      const S = { workouts, active }
      expect(historyBefore(S)).toBe(S)
    }
  })
})

describe('editedPrs / editedEnd / editHasWork', () => {
  it('drops a record whose exercise was un-logged in the edit', () => {
    const s = editSessionFor(logged())
    expect(editedPrs(s)).toEqual(['0025'])
    s.entries[0].sets.forEach(x => { x.done = false })
    expect(editedPrs(s)).toEqual([])
    s.entries.shift()
    expect(editedPrs(s)).toEqual([])
  })

  it('ends when the workout really ended, not on a rounded minute', () => {
    expect(editedEnd(editSessionFor(logged()))).toBe(logged().end)
    // A session without the field falls back to the backfill rule.
    expect(editedEnd({ start: 100, backfill: { durationMin: 2 } })).toBe(100 + 120000)
  })

  it('an edit with nothing completed in it cannot be saved', () => {
    const s = editSessionFor(logged())
    expect(editHasWork(s)).toBe(true)
    s.entries.forEach(e => e.sets.forEach(x => { x.done = false }))
    expect(editHasWork(s)).toBe(false)
    expect(editHasWork({ entries: [] })).toBe(false)
    expect(editHasWork(null)).toBe(false)
  })
})
