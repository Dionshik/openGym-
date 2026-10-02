// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// "Reset everything" is one dialog with two truths. A guest's data lives in this browser only.
// A signed-in profile pushes the empty state to the server like any other change, so the wipe
// reaches every device that syncs with it — and the Coach's own files have to go too: the
// per-profile one on the server, and the device one when the Coach runs with the phone's own key.
const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, coachLocal: null, config: null }
  state.clearPhotos = vi.fn()
  state.replaceState = vi.fn()
  state.confirmSheet = vi.fn()
  state.forgetCoach = vi.fn(() => Promise.resolve({ ok: true }))
  state.api = vi.fn(() => Promise.resolve({ ok: true }))
  state.toast = vi.fn()
  state.snapshot = () => ({
    S: state.S,
    user: state.user,
    coachLocal: state.coachLocal,
    config: state.config,
    clearPhotos: state.clearPhotos,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: state.replaceState, setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' }, workouts: [] }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../lib/coach-api.js', () => ({ forgetCoach: (...a) => mocks.forgetCoach(...a) }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: (...a) => mocks.confirmSheet(...a), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.user = null
  mocks.coachLocal = null
  mocks.config = null
  mocks.clearPhotos.mockClear()
  mocks.replaceState.mockClear()
  mocks.confirmSheet.mockClear()
  mocks.forgetCoach.mockClear()
  mocks.api.mockClear()
  mocks.toast.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings />))
const resetRow = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Reset everything'))
const openDialog = () => {
  act(() => { resetRow().click() })
  expect(mocks.confirmSheet).toHaveBeenCalledTimes(1)
  return mocks.confirmSheet.mock.calls[0][0]
}
const serverForgetCalls = () => mocks.api.mock.calls.filter(([path]) => path === '/api/coach/forget')
const photoClearCalls = () => mocks.api.mock.calls.filter(([path]) => path === '/api/photos/clear')

describe('Settings — reset everything', () => {
  it('guest: says the wipe is local, resets to the defaults, never calls the Coach', () => {
    mount()
    const dialog = openDialog()
    expect(dialog.title).toBe('Reset everything?')
    expect(dialog.message).toBe('Deletes your plan, workouts and body weight on this device. This cannot be undone.')
    act(() => { dialog.onConfirm() })
    expect(mocks.replaceState).toHaveBeenCalledTimes(1)
    expect(mocks.replaceState.mock.calls[0]).toEqual([{ reminder: { time: '17:30' }, workouts: [] }, true])
    expect(serverForgetCalls()).toHaveLength(0)
    expect(mocks.forgetCoach).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('All data reset')
  })

  it('signed in: says the wipe reaches the server and every device, and forgets the Coach on the server too', () => {
    mocks.user = { uid: 'u1', name: 'Ana' }
    mount()
    const dialog = openDialog()
    expect(dialog.message).toBe('Deletes your plan, workouts and body weight from your profile on this server and on every signed-in device. This cannot be undone.')
    act(() => { dialog.onConfirm() })
    expect(serverForgetCalls()).toHaveLength(1)
    expect(serverForgetCalls()[0][1]).toEqual({ method: 'POST', body: '{}' })
    expect(mocks.forgetCoach).not.toHaveBeenCalled()   // no device Coach here
    expect(mocks.replaceState).toHaveBeenCalledTimes(1)
    expect(mocks.replaceState.mock.calls[0][1]).toBe(true)
    expect(mocks.toast).toHaveBeenCalledWith('All data reset')
    // This instance keeps no photos, so the dialog said nothing about them — but the server is
    // still asked: pictures may be left from a time the store was on, and the route answers
    // (or is a 404 on an older server) either way.
    expect(photoClearCalls()).toHaveLength(1)
  })

  // Stored photos are files on the server, outside the profile's state: the empty state pushed
  // by the reset would leave every one of them behind.
  it('signed in where photos are kept: says so, and deletes them from the server and from this screen', async () => {
    mocks.user = { uid: 'u1', name: 'Ana' }
    mocks.config = { photos: true }
    mount()
    const dialog = openDialog()
    expect(dialog.message).toBe('Deletes your plan, workouts, body weight and stored photos from your profile on this server and on every signed-in device. This cannot be undone.')
    await act(async () => { dialog.onConfirm(); await Promise.resolve(); await Promise.resolve() })
    expect(photoClearCalls()).toHaveLength(1)
    expect(photoClearCalls()[0][1]).toEqual({ method: 'POST', body: '{}' })
    expect(mocks.clearPhotos).toHaveBeenCalledTimes(1)
    expect(mocks.replaceState).toHaveBeenCalledTimes(1)
  })

  // The profile reset is pushed again until it lands; the photo call is made once. Promised gone
  // and not reached, the photos are still there — and the person has to be told.
  it('photos promised gone but the server not reached: the reset goes ahead and says the photos are still there', async () => {
    mocks.user = { uid: 'u1', name: 'Ana' }
    mocks.config = { photos: true }
    mocks.api.mockImplementation(path => (path === '/api/photos/clear' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ ok: true })))
    mount()
    const dialog = openDialog()
    await act(async () => { dialog.onConfirm(); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.replaceState).toHaveBeenCalledTimes(1)
    expect(mocks.clearPhotos).not.toHaveBeenCalled()
    expect(mocks.toast.mock.calls.map(c => c[0]).some(m => /stored photos could not be deleted/.test(m))).toBe(true)
    mocks.api.mockImplementation(() => Promise.resolve({ ok: true }))
  })

  it('an older server without the photo route is not an error worth a word', async () => {
    mocks.user = { uid: 'u1', name: 'Ana' }
    mocks.api.mockImplementation(path => (path === '/api/photos/clear' ? Promise.reject(Object.assign(new Error('not found'), { status: 404 })) : Promise.resolve({ ok: true })))
    mount()
    const dialog = openDialog()
    await act(async () => { dialog.onConfirm(); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.toast.mock.calls.map(c => c[0])).toEqual(['All data reset'])
    mocks.api.mockImplementation(() => Promise.resolve({ ok: true }))
  })

  it('a guest on an instance that keeps photos has none there to delete', () => {
    mocks.config = { photos: true }
    mount()
    const dialog = openDialog()
    expect(dialog.message).toBe('Deletes your plan, workouts and body weight on this device. This cannot be undone.')
    act(() => { dialog.onConfirm() })
    expect(photoClearCalls()).toHaveLength(0)
  })

  it('signed in: a failing Coach call does not block the reset', async () => {
    mocks.user = { uid: 'u1', name: 'Ana' }
    mocks.api.mockRejectedValueOnce(new Error('offline'))
    mount()
    const dialog = openDialog()
    await act(async () => { dialog.onConfirm(); await Promise.resolve() })
    expect(serverForgetCalls()).toHaveLength(1)
    expect(mocks.replaceState).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('All data reset')
  })

  // A paired phone running the Coach with its own key has Coach data in both homes.
  it('paired phone with its own key: clears the Coach on the server and on the device', () => {
    mocks.user = { uid: 'u1', name: 'Ana' }
    mocks.coachLocal = { mode: 'byok', provider: 'anthropic' }
    mount()
    const dialog = openDialog()
    act(() => { dialog.onConfirm() })
    expect(serverForgetCalls()).toHaveLength(1)
    expect(mocks.forgetCoach).toHaveBeenCalledTimes(1)
    expect(mocks.replaceState).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('All data reset')
  })

  it('own key, no server: clears the device Coach without touching the server', () => {
    mocks.coachLocal = { mode: 'byok', provider: 'anthropic' }
    mount()
    const dialog = openDialog()
    act(() => { dialog.onConfirm() })
    expect(serverForgetCalls()).toHaveLength(0)
    expect(mocks.forgetCoach).toHaveBeenCalledTimes(1)
    expect(mocks.replaceState).toHaveBeenCalledTimes(1)
  })
})
