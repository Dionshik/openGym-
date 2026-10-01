// @vitest-environment happy-dom
// Editing a workout that is already in the history — through the real sheet, the real store and
// the real finish path. lib/workout-edit.test.js pins the pure half (what a session is built
// from and what is written back); this pins the wiring: the button reopens the workout as the
// active session, saving replaces the original in place without the end-of-workout ceremony or
// touching the remembered weights, and a discarded edit leaves the history as it was.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { workoutDetailSheet, finishWorkout } from './sheets.jsx'
import { setNav } from './lib/nav.js'

const mounted = []
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const S = () => useStore.getState().S

const w1 = () => ({ id: 'w1', d: '2026-09-08', start: 1000, end: 1000 + 30 * 60000, routineIds: [], routineId: null, name: 'Monday', bw: null, entries: [{ id: '0043', sets: [{ w: 100, r: 5, done: true }], topW: 100, target: null }], prs: [], vol: 500 })
const w2 = () => ({
  id: 'w2', d: '2026-09-10', start: 5_000_000, end: 5_000_000 + 45 * 60000, routineIds: [], routineId: null, name: 'Push', bw: 80,
  entries: [{ id: '0025', sets: [{ w: 80, r: 8, done: true }, { w: 80, r: 6, done: true }], topW: 80, target: { sets: 2, reps: 8, weight: 80 } }],
  prs: ['0025'], vol: 80 * 14
})
const w3 = () => ({ id: 'w3', d: '2026-09-12', start: 9_000_000, end: 9_000_000 + 20 * 60000, routineIds: [], routineId: null, name: 'Friday', bw: null, entries: [{ id: '0043', sets: [{ w: 105, r: 5, done: true }], topW: 105, target: null }], prs: [], vol: 525 })

let nav
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav = vi.fn()
  setNav(nav)
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: { ...structuredClone(DEF), workouts: [w1(), w2(), w3()], exWeights: { '0025': { w: 80, d: '2026-09-10' } } }, user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }); setNav(() => {}) })

const openEdit = () => {
  workoutDetailSheet(S().workouts[1])
  const host = mountTopSheet()
  act(() => button(host, 'Edit workout').click())
  return host
}

describe('edit a logged workout', () => {
  it('reopens it on the workout screen as a session that replaces itself, and leaves the history alone meanwhile', () => {
    openEdit()
    const A = S().active
    expect(A).toMatchObject({ id: 'w2', d: '2026-09-10', name: 'Push', bw: 80 })
    expect(A.backfill).toMatchObject({ replaceId: 'w2', edit: { end: w2().end, prs: ['0025'] } })
    expect(A.entries[0].sets).toEqual(w2().entries[0].sets)
    expect(nav).toHaveBeenCalledWith('/workout')
    expect(S().workouts).toEqual([w1(), w2(), w3()])          // untouched until saved
    expect(useUI.getState().sheets).toHaveLength(0)            // the detail sheet closed itself
  })

  it('carries a note that was typed in the sheet a moment before', () => {
    workoutDetailSheet(S().workouts[1])
    const host = mountTopSheet()
    act(() => type(host.querySelector('textarea'), 'Forgot the curls.'))
    act(() => button(host, 'Edit workout').click())
    expect(S().active.note).toBe('Forgot the curls.')
    expect(S().workouts[1].note).toBe('Forgot the curls.')
  })

  it('is refused while another workout is running', () => {
    useStore.setState(s => ({ S: { ...s.S, active: { id: 'live', d: '2026-09-20', start: 1, entries: [] } } }))
    workoutDetailSheet(S().workouts[1])
    const host = mountTopSheet()
    act(() => button(host, 'Edit workout').click())
    expect(S().active.id).toBe('live')
    expect(useUI.getState().toastMsg).toBe('Finish the current workout first.')
    expect(nav).not.toHaveBeenCalled()
  })

  it('saving files the corrected workout back in its place — no fanfare, no moved weights, no new record', () => {
    openEdit()
    // The forgotten exercise, and a number typed wrong on the day.
    act(() => useStore.getState().update(s => {
      s.active.entries.push({ id: '0294', target: { sets: 1, reps: 12, weight: 14 }, sets: [{ w: 14, r: 12, done: true }] })
      s.active.entries[0].sets[1] = { w: 90, r: 6, done: true }
    }))
    nav.mockClear()
    act(() => finishWorkout())

    expect(S().active).toBe(null)
    expect(S().workouts.map(w => w.id)).toEqual(['w1', 'w2', 'w3'])
    const saved = S().workouts[1]
    expect(saved).toMatchObject({ id: 'w2', d: '2026-09-10', start: w2().start, end: w2().end, bw: 80, name: 'Push', prs: ['0025'] })
    expect(saved.entries.map(e => e.id)).toEqual(['0025', '0294'])
    expect(saved.entries[0].sets[1].w).toBe(90)
    expect(saved.vol).toBe(80 * 8 + 90 * 6 + 14 * 12)
    // A heavier set written into the past does not become the remembered best…
    expect(S().exWeights['0025']).toEqual({ w: 80, d: '2026-09-10' })
    expect(S().exWeights['0294']).toBeUndefined()
    // …and there is no "workout complete" sheet: a toast, and back to the history.
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toBe('Workout updated')
    expect(nav).toHaveBeenCalledWith('/history')
  })

  it('saving with sets left unchecked does not ask "finish early?" — they were unchecked on the day', () => {
    openEdit()
    act(() => useStore.getState().update(s => { s.active.entries[0].sets.push({ w: 80, r: 0, done: false }) }))
    act(() => finishWorkout())
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(S().active).toBe(null)
    expect(S().workouts[1].entries[0].sets).toHaveLength(3)
  })

  it('cannot be saved empty: that is a deletion, and the workout is still there', () => {
    openEdit()
    act(() => useStore.getState().update(s => { s.active.entries.forEach(e => e.sets.forEach(x => { x.done = false })) }))
    act(() => finishWorkout())
    expect(S().active).not.toBe(null)
    expect(S().workouts).toEqual([w1(), w2(), w3()])
    expect(useUI.getState().toastMsg).toMatch(/at least one completed set/)
  })

  it('discarding the session (what the ✕ on the workout screen does) loses the edit, not the workout', () => {
    openEdit()
    act(() => useStore.getState().update(s => { s.active.entries[0].sets[0].w = 5; s.active = null }))
    expect(S().workouts).toEqual([w1(), w2(), w3()])
  })
})
