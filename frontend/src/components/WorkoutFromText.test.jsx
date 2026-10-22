// @vitest-environment happy-dom
/* The draft of a workout read from text. Two things a person on a phone reported: the
 * "Change" on a line the app was sure of did nothing they could see, and nothing said where
 * the day goes. "Change" is a button of its own now and unfolds the alternatives; the box says
 * where the day goes and shows the format. The keyboard is put away before the wait.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/workout-text-api.js', () => ({ readWorkoutText: vi.fn(), workoutTextError: e => String(e?.code || e) }))
vi.mock('../lib/coach-api.js', () => ({ disclosure: vi.fn(async () => ({ providerLabel: 'Test AI' })) }))

import { readWorkoutText } from '../lib/workout-text-api.js'
import { DEF, useStore } from '../store/useStore.js'
import { CATALOGUE } from '../lib/exercises.js'
import WorkoutFromText from './WorkoutFromText.jsx'

const BENCH = CATALOGUE.find(e => e.n === 'barbell bench press').id
const INCLINE = CATALOGUE.find(e => e.n === 'barbell incline bench press').id

const mounted = []
function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
const type = (el, v) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(() => {
  document.body.innerHTML = ''
  readWorkoutText.mockReset()
  const S = JSON.parse(JSON.stringify(DEF))
  S.coach = { lookupConsent: { agreedAt: '2026-10-01T00:00:00Z', version: 1 } }
  useStore.setState({ S, user: { id: 'u1' }, ready: true, config: {} })
})
afterEach(() => { mounted.splice(0).forEach(r => act(() => r.unmount())) })

const open = async () => {
  const host = render(<WorkoutFromText onOpen={vi.fn()} onCreate={vi.fn()} onSearch={vi.fn()} close={vi.fn()} />)
  await settle()
  return host
}

describe('writing it', () => {
  it('says where the day goes and in what format, in the hint and in the box', async () => {
    const host = await open()
    const box = host.querySelector('textarea')
    expect(box.placeholder.split('\n')[0]).toBe('13.10')
    expect(box.placeholder.split('\n').length).toBeGreaterThan(3)
    expect(host.textContent).toMatch(/first line/)
  })

  it('puts the keyboard away before the wait', async () => {
    readWorkoutText.mockImplementation(() => new Promise(() => {}))
    const host = await open()
    const box = host.querySelector('textarea')
    type(box, 'жим 3x8 80')
    box.focus()
    expect(document.activeElement).toBe(box)
    await act(async () => { button(host, 'Read the workout').click() })
    expect(document.activeElement).not.toBe(box)
  })
})

describe('checking it', () => {
  const answer = {
    date: '2026-10-13', start: null, minutes: null, unit: 'kg',
    items: [{
      said: 'жим лёжа', names: ['barbell bench press'], bp: 'chest', eq: 'barbell', exact: true,
      matches: [{ id: BENCH, score: 1 }, { id: INCLINE, score: 0.8 }],
      create: { name: 'Жим лёжа', desc: '', primary: [], secondary: [] },
      sets: [{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }, { reps: 8, weight: 80 }]
    }]
  }
  const toReview = async (a = answer) => {
    readWorkoutText.mockResolvedValue(a)
    const host = await open()
    type(host.querySelector('textarea'), '13.10\nжим лёжа 3х8 по 80')
    await act(async () => { button(host, 'Read the workout').click() })
    await settle()
    return host
  }

  it('shows the sets read for each line and the day from the text', async () => {
    const host = await toReview()
    expect(host.textContent).toContain('3 × 8 · 80 kg')
    expect(host.querySelector('input[type=date]').value).toBe('2026-10-13')
    expect(host.textContent).not.toMatch(/No day in the text/)
  })

  it('“Change” is a button that unfolds the alternatives, and “Close” folds them again', async () => {
    const host = await toReview()
    expect(host.textContent).not.toContain('Find it in the library')
    const change = button(host, 'Change')
    expect(change).toBeTruthy()
    expect(change.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { change.click() })
    expect(host.textContent).toContain('Find it in the library')
    expect(host.textContent).toContain('Leave this line out')
    await act(async () => { button(host, 'Close').click() })
    expect(host.textContent).not.toContain('Find it in the library')
  })

  it('says so when the text had no day, and when a line had no sets', async () => {
    const host = await toReview({ ...answer, date: null, items: [{ ...answer.items[0], sets: [] }] })
    expect(host.textContent).toMatch(/No day in the text/)
    expect(host.textContent).toMatch(/no sets in the text/)
  })
})
