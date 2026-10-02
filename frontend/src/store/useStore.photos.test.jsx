// @vitest-environment happy-dom

/* The list of stored photos in the real store: fetched only where the instance keeps photos and
   somebody is signed in, refreshed when its revision moves, never carried from one member to the
   next, and — where the store was switched off with pictures still on the server — the count the
   server reports, so the app can offer to delete them. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), apiBlob: vi.fn(() => Promise.reject(new Error('offline'))) }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const list = (rev, ids) => ({ rev, items: ids.map(id => ({ id, kind: 'body', pose: 'front', d: '2026-10-01' })), used: 1000 * ids.length, quota: 5000, maxBytes: 2000 })
const st = () => useStore.getState()

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  useStore.setState({ S: clone(DEF), user: { id: 'ann' }, ready: true, config: { photos: true }, photos: null, photosKept: 0 })
})
afterEach(() => { localStorage.clear() })

describe('fetching the list', () => {
  it('asks the server and keeps what it lists', async () => {
    api.mockResolvedValueOnce(list(3, ['a', 'b']))
    const got = await st().pullPhotos()
    expect(api).toHaveBeenCalledWith('/api/photos')
    expect(got.items.map(p => p.id)).toEqual(['a', 'b'])
    expect(st().photos).toMatchObject({ rev: 3, used: 2000, quota: 5000 })
  })
  it('asks nothing for a guest, or on an instance that keeps no photos', async () => {
    useStore.setState({ user: null })
    expect(await st().pullPhotos()).toBe(null)
    useStore.setState({ user: { id: 'ann' }, config: {} })
    expect(await st().pullPhotos()).toBe(null)
    useStore.setState({ config: null })
    expect(await st().pullPhotos()).toBe(null)
    expect(api).not.toHaveBeenCalled()
  })
  it('offline, the screen keeps what it has', async () => {
    useStore.setState({ photos: list(1, ['a']) })
    api.mockRejectedValueOnce(new Error('offline'))
    expect(await st().pullPhotos()).toBe(null)
    expect(st().photos.items).toHaveLength(1)
  })
  it('an answer that arrives after a sign-out is nobody\'s list any more', async () => {
    let answer
    api.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    const pending = st().pullPhotos()
    useStore.setState({ user: null, photos: null })           // signed out while the request was on its way
    answer(list(4, ['anns-photo']))
    expect(await pending).toBe(null)
    expect(st().photos).toBe(null)
    // nor the next member's
    api.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    useStore.setState({ user: { id: 'ann' } })
    const second = st().pullPhotos()
    useStore.setState({ user: { id: 'bob' }, photos: null })
    answer(list(4, ['anns-photo']))
    await second
    expect(st().photos).toBe(null)
  })
})

describe('changes made on this device', () => {
  it('apply at once, and start a list where none was loaded yet', () => {
    st().setPhotos(cur => ({ rev: 1, used: 500, quota: 5000, items: [...cur.items, { id: 'new' }] }))
    expect(st().photos).toMatchObject({ rev: 1, used: 500, items: [{ id: 'new' }] })
    st().setPhotos(cur => ({ rev: 2, items: cur.items.filter(p => p.id !== 'new') }))
    expect(st().photos).toMatchObject({ rev: 2, used: 500, items: [] })
  })
  it('clearing forgets the list and the count of pictures left on the server', () => {
    useStore.setState({ photos: list(2, ['a']), photosKept: 3 })
    st().clearPhotos()
    expect(st().photos).toBe(null)
    expect(st().photosKept).toBe(0)
  })
})
