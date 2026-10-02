import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api.js', () => ({ apiBlob: vi.fn() }))
import { apiBlob } from './api.js'
import { acquire, release, forget, releaseAll, cacheSize } from './photo-urls.js'

let made, revoked
beforeEach(() => {
  made = 0; revoked = []
  apiBlob.mockReset()
  apiBlob.mockImplementation(async path => ({ path }))
  vi.stubGlobal('URL', Object.assign(function () {}, { createObjectURL: () => 'blob:' + (++made), revokeObjectURL: u => revoked.push(u) }))
})
afterEach(() => { releaseAll(); vi.unstubAllGlobals() })

describe('pictures on screen', () => {
  it('a photo is fetched with the session once, however many places show it', async () => {
    const [a, b] = await Promise.all([acquire('p1'), acquire('p1')])
    expect(a).toBe(b)
    expect(apiBlob).toHaveBeenCalledTimes(1)
    expect(apiBlob).toHaveBeenCalledWith('/api/photo?id=p1')
  })
  it('the thumbnail and the picture are two different fetches', async () => {
    await acquire('p1'); await acquire('p1', true)
    expect(apiBlob.mock.calls.map(c => c[0])).toEqual(['/api/photo?id=p1', '/api/photo?id=p1&thumb=1'])
  })
  it('one that left the screen is kept for its return, and not revoked while anything shows it', async () => {
    await acquire('p1'); await acquire('p1')
    release('p1')
    expect(revoked).toEqual([])
    release('p1')
    expect(revoked).toEqual([])                 // idle, but well within what is kept
    await acquire('p1')
    expect(apiBlob).toHaveBeenCalledTimes(1)
  })
  it('beyond what is kept, the longest-unused idle pictures are revoked — never one still on screen', async () => {
    const held = await acquire('held')
    for (let i = 0; i < 70; i++) { await acquire('p' + i); release('p' + i) }
    expect(revoked).toHaveLength(10)
    expect(revoked).not.toContain(held)
    expect(revoked[0]).toBe('blob:2')            // p0: the first one to go idle
    expect(cacheSize()).toBe(61)
  })
  it('a fetch that failed is tried again next time instead of being remembered', async () => {
    apiBlob.mockRejectedValueOnce(Object.assign(new Error('HTTP 404'), { status: 404 }))
    await expect(acquire('gone')).rejects.toThrow('HTTP 404')
    release('gone')
    expect(cacheSize()).toBe(0)
    await expect(acquire('gone')).resolves.toBe('blob:1')
  })
  it('a fetch still on its way when everything is released makes no URL that nobody would revoke', async () => {
    let arrive
    apiBlob.mockReturnValueOnce(new Promise(resolve => { arrive = resolve }))
    const waiting = acquire('slow')
    releaseAll()                                 // sign-out while the picture was downloading
    arrive({ bytes: 1 })
    await expect(waiting).rejects.toThrow('released')
    expect(made).toBe(0)
    expect(cacheSize()).toBe(0)
    // the same when only that photo was deleted meanwhile
    apiBlob.mockReturnValueOnce(new Promise(resolve => { arrive = resolve }))
    const second = acquire('slow')
    forget('slow')
    arrive({ bytes: 1 })
    await expect(second).rejects.toThrow('released')
    expect(made).toBe(0)
  })
  it('a deleted photo loses both its URLs at once', async () => {
    await acquire('p1'); await acquire('p1', true)
    forget('p1')
    expect(revoked).toEqual(['blob:1', 'blob:2'])
    expect(cacheSize()).toBe(0)
  })
  it('sign-out revokes everything, shown or not', async () => {
    await acquire('a'); await acquire('b'); release('b')
    releaseAll()
    expect(revoked.sort()).toEqual(['blob:1', 'blob:2'])
    expect(cacheSize()).toBe(0)
    release('a')                                 // a component unmounting afterwards must not throw
  })
})
