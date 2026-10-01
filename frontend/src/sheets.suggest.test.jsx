// @vitest-environment happy-dom
// "Suggest for everyone" on a custom exercise, and what a shared exercise looks like to everyone
// else. The server side is api/test/server-pool.test.js; the registry is lib/pool.test.js. What
// is left to pin is the sheet: the button exists only where there is a pool to suggest to, it
// shows how the suggestion stands, and a shared exercise is never offered Edit or Delete.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const calls = vi.hoisted(() => ({ list: [], answer: null }))
vi.mock('./lib/api.js', async () => {
  const actual = await vi.importActual('./lib/api.js')
  return {
    ...actual,
    api: vi.fn(async (path, opts) => {
      calls.list.push([path, opts?.body ? JSON.parse(opts.body) : null])
      if (calls.answer instanceof Error) throw calls.answer
      return calls.answer
    })
  }
})

import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exerciseDetailSheet } from './sheets.jsx'
import { registerCustom, registerPool, EXIDX } from './lib/exercises.js'

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
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

const mine = { id: 'cmine', n: 'Ring reverse nordic', bp: 'upper legs', eq: 'body weight', tg: 'quadriceps', primaries: ['quadriceps'], secondaries: [], muscleGroups: ['quadriceps'], sm: [], desc: 'Lean back.', custom: true }
const setup = ({ user = { id: 'u1', name: 'Ann' }, config = { pool: true }, pool = { rev: 0, items: [], mine: [] }, customEx = [mine] } = {}) => {
  const S = { ...structuredClone(DEF), customEx }
  registerCustom(customEx)
  registerPool(pool.items)
  useStore.setState({ S, user, config, pool, pullPool: vi.fn(async () => {}) })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
  calls.list = []
  calls.answer = { ok: true, mine: [{ id: 'cmine', status: 'pending' }] }
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }); registerCustom([]); registerPool([]) })

describe('suggest a custom exercise for everyone', () => {
  it('is not offered to a guest, or on a server without a pool', () => {
    setup({ user: null })
    exerciseDetailSheet(EXIDX.cmine)
    expect(button(renderTop(), 'Suggest for everyone')).toBeUndefined()

    useUI.setState({ sheets: [] })
    setup({ config: {} })
    exerciseDetailSheet(EXIDX.cmine)
    expect(button(renderTop(), 'Suggest for everyone')).toBeUndefined()
  })

  it('sends the exercise and shows it as waiting', async () => {
    setup()
    exerciseDetailSheet(EXIDX.cmine)
    const host = renderTop()
    expect(useStore.getState().pullPool).toHaveBeenCalled()      // the status is refreshed on open
    await act(async () => { button(host, 'Suggest for everyone').click() })
    await flush()
    expect(calls.list).toEqual([['/api/pool/submit', { exercise: { id: 'cmine', n: 'Ring reverse nordic', bp: 'upper legs', eq: 'body weight', tg: 'quadriceps', primaries: ['quadriceps'], secondaries: [], muscleGroups: ['quadriceps'], sm: [], desc: 'Lean back.' } }]])
    expect(useStore.getState().pool.mine).toEqual([{ id: 'cmine', status: 'pending' }])
    expect(host.textContent).toContain('Waiting for a moderator')
    expect(button(host, 'Suggest for everyone')).toBeUndefined()
    // …and can be taken back while nobody has decided.
    calls.answer = { ok: true, mine: [] }
    await act(async () => { button(host, 'Take the suggestion back').click() })
    await flush()
    expect(calls.list.at(-1)).toEqual(['/api/pool/withdraw', { id: 'cmine' }])
    expect(button(host, 'Suggest for everyone')).toBeTruthy()
  })

  it('an imported exercise with no equipment is stopped before the server is asked', async () => {
    const imported = { ...mine, id: 'im1', eq: 'custom' }
    setup({ customEx: [imported] })
    exerciseDetailSheet(EXIDX.im1)
    const host = renderTop()
    await act(async () => { button(host, 'Suggest for everyone').click() })
    await flush()
    expect(calls.list).toEqual([])
    expect(useUI.getState().toastMsg).toMatch(/equipment/)
  })

  it('shows a decline with the moderator’s note, and lets it be sent again', async () => {
    setup({ pool: { rev: 0, items: [], mine: [{ id: 'cmine', status: 'rejected', note: 'The library has it as sissy squat.' }] } })
    exerciseDetailSheet(EXIDX.cmine)
    const host = renderTop()
    expect(host.textContent).toContain('Not approved')
    expect(host.textContent).toContain('The library has it as sissy squat.')
    await act(async () => { button(host, 'Suggest again').click() })
    await flush()
    expect(calls.list[0][0]).toBe('/api/pool/submit')
    expect(host.textContent).toContain('Waiting for a moderator')
  })

  it('says why the server refused, in the app’s words', async () => {
    setup()
    calls.answer = Object.assign(new Error('x'), { status: 409, data: { code: 'name' } })
    exerciseDetailSheet(EXIDX.cmine)
    const host = renderTop()
    await act(async () => { button(host, 'Suggest for everyone').click() })
    await flush()
    expect(useUI.getState().toastMsg).toBe('An exercise with this name is already in the library.')
    expect(button(host, 'Suggest for everyone')).toBeTruthy()
  })
})

describe('a shared exercise, on somebody else’s device', () => {
  it('is marked shared, shows its description, and offers neither Edit, Delete nor Suggest', () => {
    const shared = { id: 'cshared', n: 'Sled pull-through', bp: 'upper legs', eq: 'weighted', tg: 'gluteal', primaries: ['gluteal'], secondaries: [], muscleGroups: ['gluteal'], sm: [], desc: 'Walk backwards.' }
    setup({ customEx: [], pool: { rev: 1, items: [shared], mine: [] } })
    exerciseDetailSheet(EXIDX.cshared)
    const host = renderTop()
    expect(host.textContent).toContain('shared')
    expect(host.textContent).toContain('Walk backwards.')
    expect(button(host, 'Add to my plan')).toBeTruthy()
    for (const label of ['Edit', 'Delete', 'Suggest for everyone']) expect(button(host, label), label).toBeUndefined()
  })
})
