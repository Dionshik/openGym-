// @vitest-environment happy-dom
// The moderation screen: what an admin or a moderator does with the exercises members suggest.
// The server decides who may be here and what each call does (api/test/server-pool.test.js);
// this pins the screen itself — that it stays shut to a member, that each button makes the call
// it says it makes, and that a decision refreshes this device's own copy of the pool.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ user: null, calls: [], items: [], sheets: [], pullPool: null, toasts: [], forms: [], confirms: [] }))
vi.mock('../lib/api.js', () => ({
  api: (path, opts) => {
    mocks.calls.push([path, opts?.body ? JSON.parse(opts.body) : null])
    if (path === '/api/mod/pool') return Promise.resolve({ rev: 1, items: mocks.items })
    if (path === '/api/admin/invites') return Promise.resolve({ invites: [{ code: 'MYCODE123', createdBy: 'mod' }], invite_only: true })
    return Promise.resolve({ ok: true })
  }
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: mocks.user, S: {}, pullPool: mocks.pullPool })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: m => mocks.toasts.push(m), openSheet: render => mocks.sheets.push(render) })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  confirmSheet: cfg => mocks.confirms.push(cfg),
  poolExSheet: (row, onSubmit, title) => mocks.forms.push({ row, onSubmit, title })
}))
vi.mock('./AdminCoach.jsx', () => ({ default: () => null }))

import Moderation from './Moderation.jsx'

const mounted = []
function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const posted = path => mocks.calls.filter(c => c[0] === path).map(c => c[1])
const row = (over = {}) => ({ id: 'c1', n: 'Ring reverse nordic', bp: 'upper legs', eq: 'body weight', tg: 'quadriceps', primaries: ['quadriceps'], secondaries: [], desc: 'Lean back.', status: 'pending', by: 'u-ann', byName: 'Ann', at: 5, ...over })

beforeEach(() => {
  document.body.innerHTML = ''
  Object.assign(mocks, { user: { id: 'mod', name: 'Modest', admin: false, mod: true }, calls: [], sheets: [], toasts: [], forms: [], confirms: [], pullPool: vi.fn() })
  mocks.items = [
    row(),
    row({ id: 'c2', n: 'Sled pull-through', status: 'approved', reviewedAt: 9 }),
    row({ id: 'c3', n: 'Old thing', status: 'retired', reviewedAt: 3 }),
    row({ id: 'c4', n: 'Bench again', status: 'rejected', note: 'The library has it.', reviewedAt: 2 })
  ]
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Moderation', () => {
  it('renders nothing and asks the server nothing for a member who is not a moderator', async () => {
    mocks.user = { id: 'u', name: 'Ann', admin: false, mod: false }
    const page = render(<Moderation />)
    await settle()
    expect(page.textContent).toBe('')
    expect(mocks.calls).toEqual([])
  })

  it('shows the queue with who suggested it, what is shared, and the moderator’s own invite codes', async () => {
    const page = render(<Moderation />)
    await settle()
    expect(page.textContent).toContain('1 waiting · 1 shared')
    expect(page.textContent).toContain('Ring reverse nordic')
    expect(page.textContent).toContain('suggested by Ann')
    expect(page.textContent).toContain('Sled pull-through')
    expect(page.textContent).toContain('MYCODE123')
    // Declined ones are folded away until asked for.
    expect(page.textContent).not.toContain('The library has it.')
    act(() => button(page, 'Show (1)').click())
    expect(page.textContent).toContain('The library has it.')
  })

  it('approve makes the approve call, then reloads the queue and this device’s pool', async () => {
    const page = render(<Moderation />)
    await settle()
    act(() => button(page, 'Approve').click())
    await settle()
    expect(posted('/api/mod/pool/review')).toEqual([{ id: 'c1', action: 'approve' }])
    expect(mocks.calls.filter(c => c[0] === '/api/mod/pool')).toHaveLength(2)
    expect(mocks.pullPool).toHaveBeenCalledWith(true)
  })

  it('"correct and approve" opens the exercise form and sends what comes back as the edit', async () => {
    const page = render(<Moderation />)
    await settle()
    act(() => button(page, 'Correct and approve').click())
    expect(mocks.forms).toHaveLength(1)
    expect(mocks.forms[0].row.id).toBe('c1')
    await act(async () => { mocks.forms[0].onSubmit({ id: 'c1', n: 'Reverse nordic (rings)', bp: 'upper legs', eq: 'body weight', tg: 'quadriceps', primaries: ['quadriceps'], secondaries: [], muscleGroups: ['quadriceps'], sm: [], desc: '' }) })
    await settle()
    const [sent] = posted('/api/mod/pool/review')
    expect(sent).toMatchObject({ id: 'c1', action: 'approve' })
    expect(sent.edits.n).toBe('Reverse nordic (rings)')
  })

  it('decline asks for the reason and sends it', async () => {
    const page = render(<Moderation />)
    await settle()
    act(() => button(page, 'Decline').click())
    expect(mocks.sheets).toHaveLength(1)
    const sheet = render(mocks.sheets[0](() => {}))
    const area = sheet.querySelector('textarea')
    act(() => {
      Object.getOwnPropertyDescriptor(area.constructor.prototype, 'value').set.call(area, '  Same as the sissy squat.  ')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => button(sheet, 'Decline').click())
    await settle()
    expect(posted('/api/mod/pool/review')).toEqual([{ id: 'c1', action: 'reject', note: 'Same as the sissy squat.' }])
  })

  it('retiring asks first, and a retired exercise can be offered again', async () => {
    const page = render(<Moderation />)
    await settle()
    act(() => page.querySelector('button[aria-label="Retire"]').click())
    expect(posted('/api/mod/pool/retire')).toEqual([])           // nothing until confirmed
    expect(mocks.confirms).toHaveLength(1)
    await act(async () => { mocks.confirms[0].onConfirm() })
    await settle()
    expect(posted('/api/mod/pool/retire')).toEqual([{ id: 'c2', retired: true }])
    act(() => page.querySelector('button[aria-label="Offer again"]').click())
    await settle()
    expect(posted('/api/mod/pool/retire')[1]).toEqual({ id: 'c3', retired: false })
  })
})
