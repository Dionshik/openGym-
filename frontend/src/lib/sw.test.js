/* frontend/public/sw.js against a stand-in worker environment.
 *
 * The one thing the worker must never do is take the build that is already on the device away
 * without having a working one to put there: its cache is what a home-screen app reopened
 * without a network comes back from. So an install that did not get the shell fails, and the
 * previous build's cache is swept only once this build's shell is in its own. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeCache {
  constructor(name) { this.name = name; this.m = new Map() }
  async put(req, res) { this.m.set(String(req.url || req), res) }
  async add(u) { const r = await globalThis.fetch(u); if (!r.ok) throw new Error('add failed ' + u); this.m.set(String(u), r) }
  async match(req) { return this.m.get(String(req.url || req)) }
  keys() { return [...this.m.keys()] }
}
class FakeCaches {
  constructor() { this.c = new Map() }
  async open(n) { if (!this.c.has(n)) this.c.set(n, new FakeCache(n)); return this.c.get(n) }
  async keys() { return [...this.c.keys()] }
  async delete(n) { return this.c.delete(n) }
  async match(req) { for (const c of this.c.values()) { const hit = await c.match(req); if (hit) return hit } return undefined }
}

const CACHE = 'opengym-rt-__BUILD__'   // the placeholder the build rewrites (vite.config.js swStamp)
const handlers = {}
let skipWaiting = 0

// A fresh copy of the worker each time: it registers its listeners at import, so the module
// cache has to be stepped around with a query string.
async function loadSW() {
  for (const k of Object.keys(handlers)) delete handlers[k]
  skipWaiting = 0
  globalThis.self = {
    addEventListener: (type, fn) => { handlers[type] = fn },
    skipWaiting: () => { skipWaiting++ },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { getNotifications: async () => [], showNotification: async () => {}, pushManager: {} }
  }
  globalThis.location = { origin: 'https://gym.test' }
  globalThis.caches = new FakeCaches()
  await import('../../public/sw.js?load=' + Math.random())
}
// What waitUntil was handed is what the browser judges the install by, so it is awaited (and its
// rejection is the install failing).
const fire = async (type, ev = {}) => {
  const e = { ...ev, waitUntil: p => { e._done = p }, respondWith: p => { e._res = p } }
  handlers[type](e)
  if (e._done) await e._done
  return e
}
const previousBuild = async () => {
  const old = await globalThis.caches.open('opengym-rt-oldbuild')
  await old.put('index.html', { ok: true, body: 'the shell already on this device' })
  return old
}
const shellHtml = '<html><head><script src="./assets/index-new.js"></script></head></html>'

beforeEach(() => { delete globalThis.self })

describe('sw.js install and activate', () => {
  it('a precache that cannot reach the server fails the install and keeps the build on the device', async () => {
    await loadSW()
    const old = await previousBuild()
    globalThis.fetch = async () => { throw new Error('network down') }

    await expect(fire('install')).rejects.toThrow()
    expect(skipWaiting).toBe(0)

    await fire('activate')   // an activate that happens anyway must still leave the old cache alone
    expect(await globalThis.caches.keys()).toContain('opengym-rt-oldbuild')
    expect(await old.match('index.html')).toBeTruthy()
  })

  it('a redirect to a login page is never cached as the shell', async () => {
    await loadSW()
    await previousBuild()
    globalThis.fetch = async () => ({ ok: true, status: 200, redirected: true, text: async () => '<html>sign in</html>' })

    await expect(fire('install')).rejects.toThrow()
    expect(skipWaiting).toBe(0)
    expect((await globalThis.caches.open(CACHE)).keys()).not.toContain('index.html')
    expect(await globalThis.caches.keys()).toContain('opengym-rt-oldbuild')
  })

  it('a server that is restarting fails the install rather than cache its error page', async () => {
    await loadSW()
    await previousBuild()
    globalThis.fetch = async () => ({ ok: false, status: 502, redirected: false, text: async () => 'Bad Gateway' })

    await expect(fire('install')).rejects.toThrow()
    expect(await globalThis.caches.keys()).toContain('opengym-rt-oldbuild')
  })

  it('a chunk that will not cache fails the install, so the build on the device stays', async () => {
    await loadSW()
    const old = await previousBuild()
    globalThis.fetch = async u => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => shellHtml }
      : { ok: false, status: 404 })

    await expect(fire('install')).rejects.toThrow(/index-new\.js/)
    expect(skipWaiting).toBe(0)
    // The shell is written after its code, so a half-filled cache cannot read as this build.
    expect((await globalThis.caches.open(CACHE)).keys()).not.toContain('index.html')

    await fire('activate')
    expect(await globalThis.caches.keys()).toContain('opengym-rt-oldbuild')
    expect(await old.match('index.html')).toBeTruthy()
  })

  it('a chunk answered by a redirect to a login page fails the install too', async () => {
    // An auth proxy in front answers every request with its login page — 200, and `cache.add`
    // would have stored that HTML under the main bundle's URL.
    await loadSW()
    const old = await previousBuild()
    globalThis.fetch = async u => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => shellHtml }
      : { ok: true, status: 200, redirected: true, text: async () => '<html>sign in</html>' })

    await expect(fire('install')).rejects.toThrow(/index-new\.js.*redirected/)
    expect(skipWaiting).toBe(0)
    expect((await globalThis.caches.open(CACHE)).keys()).toEqual([])

    await fire('activate')
    expect(await globalThis.caches.keys()).toContain('opengym-rt-oldbuild')
    expect(await old.match('index.html')).toBeTruthy()
  })

  it('an icon that will not cache is not worth failing an install over', async () => {
    await loadSW()
    await previousBuild()
    const withIcon = '<html><head><script src="./assets/index-new.js"></script>'
      + '<link rel="stylesheet" href="./assets/index-new.css"><link rel="icon" href="./icon-512.png"></head></html>'
    globalThis.fetch = async u => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => withIcon }
      : String(u).endsWith('.png') ? { ok: false, status: 404 } : { ok: true, status: 200, clone: () => ({}) })

    await fire('install')
    expect(skipWaiting).toBe(1)
    await fire('activate')

    expect(await globalThis.caches.keys()).toEqual([CACHE])
    const c = await globalThis.caches.open(CACHE)
    expect(c.keys()).toEqual(expect.arrayContaining(['./assets/index-new.js', './assets/index-new.css', 'index.html']))
  })

  it('an install that got the shell takes over and drops the previous build', async () => {
    await loadSW()
    await previousBuild()
    globalThis.fetch = async u => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => shellHtml }
      : { ok: true, status: 200, clone: () => ({}) })

    await fire('install')
    expect(skipWaiting).toBe(1)
    await fire('activate')

    expect(await globalThis.caches.keys()).toEqual([CACHE])
    expect((await globalThis.caches.open(CACHE)).keys()).toContain('index.html')
  })
})

// The push service rotates a subscription (expiry, a key change) and the worker re-registers it,
// usually with no page open. It sent no device id, so the server's row lost it and the rest-timer
// alert for that account went to every device until a page next booted. The page leaves the id
// in a cache the worker can read (lib/push.js shareDeviceId).
describe('sw.js re-registers a rotated push subscription with the page\'s device id', () => {
  const rotated = {
    endpoint: 'https://push.example/e2',
    options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
    toJSON: () => ({ endpoint: 'https://push.example/e2', keys: { p256dh: 'p2', auth: 'a2' } })
  }
  const rotate = async () => {
    const sent = []
    globalThis.fetch = async (url, init) => { sent.push([String(url), JSON.parse(init.body)]); return { ok: true, status: 200 } }
    await fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://push.example/e1', options: rotated.options }, newSubscription: rotated })
    return sent
  }
  // The same cache name and key on both sides, read out of the two files, so the page and the
  // worker cannot drift apart without this failing.
  const constant = (src, name) => src.match(new RegExp('const ' + name + " = '([^']+)'"))?.[1]
  const pageSrc = readFileSync(new URL('./push.js', import.meta.url), 'utf8')
  const swSrc = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
  const DEVICE_CACHE = constant(pageSrc, 'DEVICE_CACHE')
  const DEVICE_URL = constant(pageSrc, 'DEVICE_URL')

  it('the page and the worker look in the same place', () => {
    expect(DEVICE_CACHE).toBeTruthy()
    expect(DEVICE_URL).toBeTruthy()
    expect(constant(swSrc, 'DEVICE_CACHE')).toBe(DEVICE_CACHE)
    expect(constant(swSrc, 'DEVICE_URL')).toBe(DEVICE_URL)
  })

  it('sends the device id the page left', async () => {
    await loadSW()
    await (await globalThis.caches.open(DEVICE_CACHE)).put(DEVICE_URL, new Response('dev1234abcd'))
    expect(await rotate()).toEqual([['api/push/subscribe', {
      subscription: { endpoint: 'https://push.example/e2', keys: { p256dh: 'p2', auth: 'a2' } },
      deviceId: 'dev1234abcd'
    }]])
  })

  it('with nothing left there, sends the subscription alone, as before', async () => {
    await loadSW()
    const sent = await rotate()
    expect(sent).toHaveLength(1)
    expect(sent[0][1]).toEqual({ subscription: { endpoint: 'https://push.example/e2', keys: { p256dh: 'p2', auth: 'a2' } } })
  })

  it('a new build\'s activate sweeps the old build\'s cache and keeps the device id', async () => {
    await loadSW()
    await previousBuild()
    await (await globalThis.caches.open(DEVICE_CACHE)).put(DEVICE_URL, new Response('dev1234abcd'))
    globalThis.fetch = async u => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => shellHtml }
      : { ok: true, status: 200, clone: () => ({}) })
    await fire('install')
    await fire('activate')
    expect((await globalThis.caches.keys()).sort()).toEqual([CACHE, DEVICE_CACHE].sort())
    expect(await (await (await globalThis.caches.open(DEVICE_CACHE)).match(DEVICE_URL)).text()).toBe('dev1234abcd')
  })
})

/* ------------------------------------------------------------------------------------------------
 * Pushes, taps and the fetch guard. This half evaluates the real file against a stand-in for the
 * worker's global scope of its own (no globals touched) and drives its event handlers: what a
 * push shows, where a tap goes (the 'opengym:navigate' / 'opengym:ready' handshake with
 * lib/deeplink.js), and what the fetch handler refuses to cache.
 * --------------------------------------------------------------------------------------------- */

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
    w.handlers.fetch({ request: { url, method: 'GET', mode: 'cors' }, respondWith, waitUntil: () => {} })
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
