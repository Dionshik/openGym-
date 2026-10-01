// @vitest-environment happy-dom

/* The shared exercise pool in the store: fetched when the revision the server reports is not the
   one cached here, kept for offline, and never left behind for the next profile on the device. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { EXIDX, allExercises, registerPool } from '../lib/exercises.js'

const clone = value => JSON.parse(JSON.stringify(value))
const shared = (over = {}) => ({ id: 'cshared', n: 'Sled pull-through', bp: 'upper legs', eq: 'weighted', tg: 'gluteal', primaries: ['gluteal'], secondaries: [], muscleGroups: ['gluteal'], sm: [], desc: '', ...over })
const EMPTY = { rev: 0, items: [], mine: [] }
const cached = () => JSON.parse(localStorage.getItem('gym_pool_v1'))
const signedIn = (extra = {}) => useStore.setState({ S: clone(DEF), user: { id: 'user-1' }, ready: true, config: { pool: true }, pool: EMPTY, ...extra })
const poolGets = () => api.mock.calls.filter(([path]) => path === '/api/pool')

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  registerPool([])
  useStore.setState({ S: clone(DEF), user: null, ready: false, config: null, pool: EMPTY })
})
afterEach(() => { localStorage.clear(); registerPool([]) })

describe('pulling the pool', () => {
  it('fetches, registers the exercises, and caches them for a gym with no signal', async () => {
    signedIn()
    api.mockResolvedValueOnce({ rev: 4, items: [shared()], mine: [{ id: 'cmine', status: 'pending' }] })
    await useStore.getState().pullPool(true)
    expect(useStore.getState().pool).toEqual({ rev: 4, items: [shared()], mine: [{ id: 'cmine', status: 'pending' }] })
    expect(EXIDX.cshared).toMatchObject({ n: 'Sled pull-through', pool: true })
    expect(allExercises(useStore.getState().S).some(e => e.id === 'cshared')).toBe(true)
    expect(cached().rev).toBe(4)
  })

  it('asks nobody for a guest, the demo, or a server that has no pool', async () => {
    useStore.setState({ user: null, config: { pool: true } })
    await useStore.getState().pullPool(true)
    signedIn({ config: {} })
    await useStore.getState().pullPool(true)
    signedIn({ config: null })                                   // config never loaded: an offline boot
    await useStore.getState().pullPool(true)
    expect(api).not.toHaveBeenCalled()
  })

  it('keeps the cached copy when the request fails', async () => {
    signedIn({ pool: { rev: 2, items: [shared()], mine: [] } })
    registerPool([shared()])
    api.mockRejectedValueOnce(new Error('offline'))
    await useStore.getState().pullPool(true)
    expect(useStore.getState().pool.rev).toBe(2)
    expect(EXIDX.cshared).toBeTruthy()
  })

  it('an on-demand refresh is throttled; a forced one is not', async () => {
    signedIn()
    api.mockResolvedValue({ rev: 1, items: [], mine: [] })
    await useStore.getState().pullPool(true)
    await useStore.getState().pullPool()
    await useStore.getState().pullPool()
    expect(poolGets()).toHaveLength(1)
    await useStore.getState().pullPool(true)
    expect(poolGets()).toHaveLength(2)
  })
})

describe('the revision that rides on the data calls', () => {
  it('a pull whose answer names a newer pool fetches it', async () => {
    signedIn({ pool: { rev: 1, items: [], mine: [] } })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 0 }))
    api.mockImplementation(async path => path === '/api/pool'
      ? { rev: 2, items: [shared()], mine: [] }
      : { state: { ...clone(DEF), _rev: 1 }, rev: 1, pool: 2 })
    await useStore.getState().pullState()
    await Promise.resolve(); await Promise.resolve()
    expect(poolGets()).toHaveLength(1)
    expect(useStore.getState().pool.rev).toBe(2)
  })

  it('the same revision, or a server that reports none, fetches nothing', async () => {
    signedIn({ pool: { rev: 2, items: [shared()], mine: [] } })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 0 }))
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _rev: 1 }, rev: 1, pool: 2 })
    await useStore.getState().pullState()
    signedIn({ pool: EMPTY })
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _rev: 1 }, rev: 1 })   // nothing was ever shared
    await useStore.getState().pullState()
    expect(poolGets()).toHaveLength(0)
  })
})

describe('whose pool it is', () => {
  it('setPoolMine updates this profile’s suggestions without a round trip', () => {
    signedIn({ pool: { rev: 3, items: [shared()], mine: [] } })
    useStore.getState().setPoolMine([{ id: 'cmine', status: 'pending' }])
    expect(useStore.getState().pool).toEqual({ rev: 3, items: [shared()], mine: [{ id: 'cmine', status: 'pending' }] })
    expect(cached().mine).toEqual([{ id: 'cmine', status: 'pending' }])
    expect(api).not.toHaveBeenCalled()
  })

  it('a different profile signing in on this device does not inherit the last one’s', () => {
    signedIn({ pool: { rev: 3, items: [shared()], mine: [{ id: 'cmine', status: 'rejected', note: 'private' }] } })
    registerPool([shared()])
    localStorage.setItem('gym_pool_v1', JSON.stringify(useStore.getState().pool))
    localStorage.setItem('gym_owner', 'user-1')
    useStore.getState().setUser({ id: 'user-2', name: 'Bob' })
    expect(useStore.getState().pool).toEqual(EMPTY)
    expect(localStorage.getItem('gym_pool_v1')).toBeNull()
    expect(EXIDX.cshared).toBeUndefined()
  })
})
