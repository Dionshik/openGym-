// @vitest-environment happy-dom
// "Describe it in your own words": a mode of the exercise picker that asks the Coach's provider
// what the typed words mean. What is pinned here is the part that cannot be seen from the pure
// helpers — that the entry point exists only where the Coach does, that the go-ahead is recorded
// and pushed before anything is asked, and that a row and a draft reach the caller exactly the
// way a search result and a hand-made exercise do.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

vi.mock('./lib/coach-api.js', async () => {
  const actual = await vi.importActual('./lib/coach-api.js')
  return { ...actual, matchExercises: vi.fn(), disclosure: vi.fn(async () => ({ providerLabel: 'Fixture AI' })) }
})

import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exercisePicker } from './sheets.jsx'
import { matchExercises } from './lib/coach-api.js'
import { CATALOGUE } from './lib/exercises.js'

const mounted = []
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const rowByText = (host, text) => [...host.querySelectorAll('.item')].find(el => el.textContent.includes(text))
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

const bench = CATALOGUE.find(e => e.n === 'barbell bench press')
const answer = {
  items: [{
    said: 'жим лёжа', names: ['barbell bench press'], bp: 'chest', eq: 'barbell', exact: true,
    matches: [{ id: bench.id, score: 1 }],
    create: { name: 'жим штанги лёжа', desc: 'Лёжа на скамье.', primary: ['chest'], secondary: ['triceps'] }
  }]
}
const withCoach = (over = {}) => useStore.setState({
  S: structuredClone(DEF), user: { id: 'u1', name: 'Me' }, config: { coach: { enabled: true, providerLabel: 'Fixture AI' } },
  pushState: vi.fn(async () => {}), ...over
})

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
  matchExercises.mockReset()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('describe an exercise in your own words', () => {
  it('is not offered on an instance without a Coach, or to a guest', () => {
    useStore.setState({ S: structuredClone(DEF), user: null, config: {} })
    exercisePicker(vi.fn())
    expect(rowByText(renderTop(), 'Describe it in your own words')).toBeUndefined()

    useUI.setState({ sheets: [] })
    useStore.setState({ S: structuredClone(DEF), user: null, config: { coach: { enabled: true } } })
    exercisePicker(vi.fn())
    expect(rowByText(renderTop(), 'Describe it in your own words')).toBeUndefined()
  })

  it('records the go-ahead, pushes it, and only then asks', async () => {
    withCoach()
    const order = []
    useStore.setState({ pushState: vi.fn(async () => { order.push('push:' + !!useStore.getState().S.coach?.lookupConsent?.agreedAt) }) })
    matchExercises.mockImplementation(async () => { order.push('ask'); return answer })

    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => rowByText(host, 'Describe it in your own words').click())
    expect(host.textContent).toContain('Fixture AI')            // who it is sent to, before sending
    act(() => type(host.querySelector('textarea'), 'жим лёжа'))
    const go = button(host, 'Agree and find')                   // not yet agreed: the button says so
    expect(go).toBeTruthy()
    await act(async () => { go.click() })
    await flush()

    expect(order).toEqual(['push:true', 'ask'])
    expect(matchExercises).toHaveBeenCalledWith('жим лёжа')
    // The Coach's own consent is untouched: this go-ahead covers lookups and nothing else.
    expect(useStore.getState().S.coach.consent).toBeNull()
    expect(button(host, 'Find exercises')).toBeTruthy()         // agreed now
  })

  it('offers the resolved row like a search result: the row configures, "+" adds outright', async () => {
    withCoach({ S: { ...structuredClone(DEF), coach: { consent: { agreedAt: 'x', version: 1 } } } })
    matchExercises.mockResolvedValue(answer)
    const onPick = vi.fn()
    exercisePicker(onPick)
    const host = renderTop()
    act(() => rowByText(host, 'Describe it in your own words').click())
    act(() => type(host.querySelector('textarea'), 'жим лёжа'))
    await act(async () => { button(host, 'Find exercises').click() })
    await flush()
    expect(useStore.getState().pushState).not.toHaveBeenCalled() // already agreed: nothing to push

    const row = rowByText(host, 'barbell bench press')
    expect(row).toBeTruthy()
    act(() => row.click())
    expect(onPick).toHaveBeenLastCalledWith(bench)
    act(() => row.querySelector('button.iconbtn').click())
    expect(onPick).toHaveBeenLastCalledWith(bench, true)
    expect(row.querySelector('.tag.acc')).toBeTruthy()           // marked as added
  })

  it('opens the create form filled from the draft, and saves nothing by itself', async () => {
    withCoach({ S: { ...structuredClone(DEF), coach: { consent: { agreedAt: 'x', version: 1 } } } })
    matchExercises.mockResolvedValue(answer)
    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => rowByText(host, 'Describe it in your own words').click())
    act(() => type(host.querySelector('textarea'), 'жим лёжа'))
    await act(async () => { button(host, 'Find exercises').click() })
    await flush()

    act(() => rowByText(host, 'Create “Жим штанги лёжа”').click())
    const form = renderTop()
    expect(form.querySelector('input').value).toBe('Жим штанги лёжа')
    expect(form.querySelector('textarea').value).toBe('Лёжа на скамье.')
    const on = [...form.querySelectorAll('.chip.on')].map(c => c.textContent.trim())
    expect(on).toEqual(expect.arrayContaining(['chest', 'barbell']))
    expect(useStore.getState().S.customEx).toEqual([])           // a draft is not an exercise yet
  })

  it('says what went wrong in place, and leaves the picker usable', async () => {
    withCoach({ S: { ...structuredClone(DEF), coach: { consent: { agreedAt: 'x', version: 1 } } } })
    matchExercises.mockRejectedValue(Object.assign(new Error('x'), { code: 'cap' }))
    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => rowByText(host, 'Describe it in your own words').click())
    act(() => type(host.querySelector('textarea'), 'squat'))
    await act(async () => { button(host, 'Find exercises').click() })
    await flush()
    expect(host.querySelector('[role="alert"]').textContent).toContain('enough lookups for today')
    act(() => button(host, 'All').click())
    expect(host.querySelector('.search input')).toBeTruthy()     // back to the ordinary picker
  })

  it('says so when the text named no exercise', async () => {
    withCoach({ S: { ...structuredClone(DEF), coach: { consent: { agreedAt: 'x', version: 1 } } } })
    matchExercises.mockResolvedValue({ items: [] })
    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => rowByText(host, 'Describe it in your own words').click())
    act(() => type(host.querySelector('textarea'), 'hello'))
    await act(async () => { button(host, 'Find exercises').click() })
    await flush()
    expect(host.querySelector('.empty').textContent).toContain('No exercise found')
  })
})
