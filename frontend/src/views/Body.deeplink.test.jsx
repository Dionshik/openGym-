// @vitest-environment happy-dom
/* A tapped reminder lands on the Body screen with what it was about (`/body?do=weigh`). This runs
 * that through the REAL router, because the bug it guards against lived between the two: the
 * screen replaced the address and armed a timer to open the sheet, and the re-render caused by
 * that very replace cancelled the timer — the sheet opened only if the timer won a race, which
 * in a backgrounded window (where a tapped notification finds the app) it does not. A test with
 * a mocked router cannot see that; the location there never changes.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.reject(new Error('offline'))), apiBlob: vi.fn(() => Promise.reject(new Error('offline'))), apiBase: () => '' }))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Body from './Body.jsx'

let host, root, where, go
function Probe() {
  const loc = useLocation()
  where = loc.pathname + loc.search
  go = useNavigate()
  return null
}
const mount = async (entry, strict = false) => {
  const tree = <MemoryRouter initialEntries={[entry]}><Probe /><Routes><Route path="/body" element={<Body />} /><Route path="*" element={null} /></Routes></MemoryRouter>
  await act(async () => { root.render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree) })
  // long enough for a transition to commit and for any stray timer to have fired
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
}
const sheets = () => useUI.getState().sheets
const titleOf = sheet => {
  const el = document.createElement('div')
  const r = createRoot(el)
  act(() => r.render(sheet.render(() => {})))
  const text = el.querySelector('h3')?.textContent
  act(() => r.unmount())
  return text
}

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: null, ready: true, config: null, health: null, coachLocal: null, photos: null })
  useUI.setState({ sheets: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('a reminder tap on the Body screen', () => {
  it('opens the weigh-in sheet exactly once and leaves a clean address', async () => {
    await mount('/body?do=weigh')
    expect(where).toBe('/body')
    expect(sheets()).toHaveLength(1)
  })

  it('opens the measurement sheet for do=measure', async () => {
    await mount('/body?do=measure')
    expect(sheets()).toHaveLength(1)
    expect(titleOf(sheets()[0])).toBe('Measurements')
  })

  it('once, too, under StrictMode\'s doubled effects', async () => {
    await mount('/body?do=weigh', true)
    expect(where).toBe('/body')
    expect(sheets()).toHaveLength(1)
  })

  it('arriving from another screen while the app is open works the same', async () => {
    await mount('/body')
    expect(sheets()).toHaveLength(0)
    await act(async () => { go('/body?do=measure') })
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    expect(where).toBe('/body')
    expect(sheets()).toHaveLength(1)
    // a second tap later is a second request, not a leftover of the first
    act(() => useUI.setState({ sheets: [] }))
    await act(async () => { go('/body?do=weigh') })
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    expect(sheets()).toHaveLength(1)
  })

  it('an action it does not know opens nothing and still cleans the address', async () => {
    await mount('/body?do=delete')
    expect(where).toBe('/body')
    expect(sheets()).toHaveLength(0)
  })

  it('the plain screen opens nothing', async () => {
    await mount('/body')
    expect(sheets()).toHaveLength(0)
  })
})

describe('do=photo, which depends on what the instance offers', () => {
  it('where photos are kept and someone is signed in, the photo sheet opens', async () => {
    useStore.setState({ user: { id: 'u1' }, config: { photos: true } })
    await mount('/body?do=photo')
    expect(sheets()).toHaveLength(1)
    expect(titleOf(sheets()[0])).toBe('Progress photo')
  })

  it('on a cold start the config is not loaded yet: it waits for it, then opens once', async () => {
    useStore.setState({ user: { id: 'u1' }, config: null, ready: false })
    await mount('/body?do=photo')
    expect(where).toBe('/body')
    expect(sheets()).toHaveLength(0)
    await act(async () => { useStore.setState({ config: { photos: true }, ready: true }) })
    expect(sheets()).toHaveLength(1)
    // nothing left over to fire on a later change
    await act(async () => { useStore.setState({ config: { photos: true, pool: true } }) })
    expect(sheets()).toHaveLength(1)
  })

  it('where photos are not kept it opens nothing, and does not fire later if they are switched on', async () => {
    useStore.setState({ user: { id: 'u1' }, config: {}, ready: true })
    await mount('/body?do=photo')
    expect(sheets()).toHaveLength(0)
    await act(async () => { useStore.setState({ config: { photos: true } }) })
    expect(sheets()).toHaveLength(0)
  })

  it('a guest has no stored photos to add to', async () => {
    useStore.setState({ user: null, config: { photos: true }, ready: true })
    await mount('/body?do=photo')
    expect(sheets()).toHaveLength(0)
  })
})
