/* The service worker (public/sw.js) is a plain script outside the bundle, so nothing imports it
 * and no other test runs it. This evaluates the real file against a stand-in for the worker's
 * global scope and drives its event handlers: what a push shows, where a tap goes, and what the
 * fetch handler refuses to cache.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')

function boot({ scope = 'https://gym.test/', clients = [] } = {}) {
  const handlers = {}
  const shown = []
  const opened = []
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn },
    registration: {
      scope,
      getNotifications: async () => [],
      showNotification: async (title, options) => { shown.push({ title, options }) }
    },
    clients: { matchAll: async () => clients, openWindow: async url => { opened.push(url) }, claim: async () => {} },
    skipWaiting: async () => {}
  }
  const caches = { open: async () => ({ match: async () => undefined, put: async () => {}, add: async () => {} }), keys: async () => [], match: async () => undefined, delete: async () => true }
  const fetch = vi.fn(async () => ({ ok: true, clone: () => ({}), text: async () => '' }))
  new Function('self', 'caches', 'location', 'fetch', SRC)(self, caches, new URL(scope), fetch)
  const fire = async (type, event) => {
    let waited
    handlers[type]({ waitUntil: p => { waited = p }, ...event })
    await waited
  }
  return { handlers, shown, opened, fire, fetch }
}
const push = payload => ({ data: { json: () => payload, text: () => JSON.stringify(payload) } })
const client = () => ({ focus: vi.fn(async () => {}), postMessage: vi.fn() })
const tap = (data, close = vi.fn()) => ({ notification: { data, close } })

describe('a push becomes a notification', () => {
  it('shows the title, body and tag, and carries an in-app address for the tap', async () => {
    const w = boot()
    await w.fire('push', push({ title: 'Log food', body: 'Log what you ate.', tag: 'reminder-a', url: '#/nutrition' }))
    expect(w.shown).toEqual([{ title: 'Log food', options: { body: 'Log what you ate.', icon: 'icon-512.png', badge: 'icon-180.png', tag: 'reminder-a', renotify: true, data: { url: '#/nutrition' } } }])
  })
  it('an address that is not in-app is not carried at all', async () => {
    for (const url of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', '/nutrition', 7, null, '#/' + 'a'.repeat(200)]) {
      const w = boot()
      await w.fire('push', push({ title: 't', url }))
      expect('data' in w.shown[0].options, String(url)).toBe(false)
    }
  })
  it('a push without an address, or without a readable body, still shows something', async () => {
    const w = boot()
    await w.fire('push', push({ title: 'Rest over', tag: 'rest-timer' }))
    expect(w.shown[0]).toEqual({ title: 'Rest over', options: { body: '', icon: 'icon-512.png', badge: 'icon-180.png', tag: 'rest-timer', renotify: true } })
    await w.fire('push', { data: { json: () => { throw new Error('not json') }, text: () => 'plain words' } })
    expect(w.shown[1].title).toBe('openGym')
    expect(w.shown[1].options.body).toBe('plain words')
  })
})

describe('a tap on the notification', () => {
  it('with the app open: the window is told where to go, and focused', async () => {
    const c = client()
    const w = boot({ clients: [c] })
    const close = vi.fn()
    await w.fire('notificationclick', tap({ url: '#/nutrition' }, close))
    expect(close).toHaveBeenCalled()
    // not a copy: with the app open this is the only way the tap reaches it
    expect(c.postMessage).toHaveBeenCalledWith({ type: 'opengym:navigate', url: '#/nutrition' })
    expect(c.focus).toHaveBeenCalled()
    expect(w.opened).toEqual([])
  })
  it('with the app closed: it is opened at that address, which is also kept for the page to ask for', async () => {
    const w = boot()
    await w.fire('notificationclick', tap({ url: '#/body?do=weigh' }))
    expect(w.opened).toEqual(['./#/body?do=weigh'])
    const source = { postMessage: vi.fn() }
    w.handlers.message({ data: { type: 'opengym:ready' }, source })
    // marked as a copy: the page drops it if it was in fact opened at that address
    expect(source.postMessage).toHaveBeenCalledWith({ type: 'opengym:navigate', url: '#/body?do=weigh', replay: true })
    // handed over once
    w.handlers.message({ data: { type: 'opengym:ready' }, source })
    expect(source.postMessage).toHaveBeenCalledTimes(1)
  })
  it('a notification with no address behaves as it always did', async () => {
    const c = client()
    const open = boot({ clients: [c] })
    await open.fire('notificationclick', tap(undefined))
    expect(c.focus).toHaveBeenCalled()
    expect(c.postMessage).not.toHaveBeenCalled()
    const closed = boot()
    await closed.fire('notificationclick', tap(null))
    expect(closed.opened).toEqual(['./'])
    const source = { postMessage: vi.fn() }
    closed.handlers.message({ data: { type: 'opengym:ready' }, source })
    expect(source.postMessage).not.toHaveBeenCalled()
  })
  it('messages it does not know are ignored', () => {
    const w = boot()
    expect(() => { w.handlers.message({ data: null }); w.handlers.message({ data: { type: 'other' } }); w.handlers.message({}) }).not.toThrow()
  })
})

describe('what the fetch handler leaves alone', () => {
  const get = (w, url) => {
    const respondWith = vi.fn()
    w.handlers.fetch({ request: { url, method: 'GET', mode: 'cors' }, respondWith })
    return respondWith.mock.calls.length > 0
  }
  it('at the site root: the API is never answered from, or stored in, the cache', () => {
    const w = boot()
    expect(get(w, 'https://gym.test/api/data')).toBe(false)
    expect(get(w, 'https://gym.test/api/photo?id=abc')).toBe(false)
    expect(get(w, 'https://gym.test/assets/app.js')).toBe(true)
  })
  it('under a subpath: the API beside the app is left alone too — private photos must not reach Cache Storage', () => {
    const w = boot({ scope: 'https://host.test/gym/' })
    expect(get(w, 'https://host.test/gym/api/data')).toBe(false)
    expect(get(w, 'https://host.test/gym/api/photo?id=abc&thumb=1')).toBe(false)
    expect(get(w, 'https://host.test/gym/assets/app.js')).toBe(true)
    expect(get(w, 'https://host.test/gym/img/0001.jpg')).toBe(true)
  })
  it('other origins and anything that is not a GET are not its business', () => {
    const w = boot()
    expect(get(w, 'https://elsewhere.test/api/x')).toBe(false)
    const respondWith = vi.fn()
    w.handlers.fetch({ request: { url: 'https://gym.test/assets/app.js', method: 'POST' }, respondWith })
    expect(respondWith).not.toHaveBeenCalled()
  })
})
