/* openGym service worker — the app shell and its hashed assets are cached at install and kept
   fresh network-first, media (img/gif) cache-first. A home-screen app reopened without a network
   comes back from here with the same bundle it last ran; the state itself lives in localStorage.
   `CACHE` carries the build hash (vite.config.js rewrites it), so every deploy is a new worker
   with its own cache and the previous build's files are dropped on activate. */
const CACHE = 'opengym-rt-__BUILD__'
// Where this instance's API lives, as a path: '/api/' at the root, '/gym/api/' under a subpath.
const API_PATH = new URL('api/', self.registration.scope).pathname

// What the shell needs to boot without a network: index.html plus every script/style/icon it
// references. Read from the served index.html so the list follows the build, not a hand-kept
// manifest that would go stale the first time a chunk is renamed.
async function precache() {
  const c = await caches.open(CACHE)
  const res = await fetch('index.html', { cache: 'no-cache' })
  if (!res.ok) return
  const html = await res.text()
  await c.put('index.html', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
    .filter(u => /\.(?:js|css|png|svg|webmanifest|json)(?:\?|$)/.test(u) && !/^(?:https?:)?\/\//.test(u))
  await Promise.all([...new Set(refs)].map(u => c.add(u).catch(() => {})))
}

self.addEventListener('install', e => {
  e.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
})

// The payload is parsed inside waitUntil: a push whose handler throws before showing anything is
// a "silent push", which Chrome counts against the site and eventually revokes. A body that is
// not JSON still shows a notification.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let data = {}
    try { data = e.data ? e.data.json() : {} } catch { data = { body: (() => { try { return e.data.text() } catch { return '' } })() } }
    // One alert per kind: a new rest-timer push replaces the last one instead of stacking
    // up in the tray (issue #172). `tag` alone should do that, but iOS keeps every one, so
    // the previous notification with the same tag is closed by hand first.
    const tag = data.tag || 'opengym'
    try { for (const n of await self.registration.getNotifications({ tag })) n.close() } catch {}
    const options = {
      body: data.body || '',
      icon: 'icon-512.png',
      badge: 'icon-180.png',
      tag,
      renotify: true
    }
    // Where a tap should land: an in-app address only ('#/nutrition'). The page checks it again
    // against the routes a notification may open (lib/deeplink.js) before going anywhere.
    if (typeof data.url === 'string' && data.url.startsWith('#/') && data.url.length <= 80) options.data = { url: data.url }
    await self.registration.showNotification(data.title || 'openGym', options)
  })())
})
// A tap that had to open the app carries its address in the URL it opens; this is the same
// address kept for the page to ask for (`opengym:ready`), in case the browser opened the app at
// its start page instead. Short-lived on purpose — a worker's globals do not outlast it anyway.
let pending = null
self.addEventListener('notificationclick', e => {
  const url = e.notification.data && typeof e.notification.data.url === 'string' ? e.notification.data.url : null
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(async clients => {
    const c = clients.find(c => 'focus' in c)
    if (!c) {
      if (url) pending = { url, at: Date.now() }
      return self.clients.openWindow(url ? './' + url : './')
    }
    if (url) c.postMessage({ type: 'opengym:navigate', url })
    return c.focus()
  }))
})
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'opengym:ready' || !pending) return
  const p = pending
  pending = null
  // `replay`: the page may already be there — it was opened at this very address — and then
  // ignores this copy rather than act on the tap twice.
  if (Date.now() - p.at < 30000 && e.source) e.source.postMessage({ type: 'opengym:navigate', url: p.url, replay: true })
})
// The push service rotated the subscription (key change, expiry): subscribe again with the same
// server key and tell the server, so the row it holds keeps pointing at this browser.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const old = e.oldSubscription || (await self.registration.pushManager.getSubscription())
    const key = e.newSubscription?.options?.applicationServerKey || old?.options?.applicationServerKey
    if (!key) return
    const sub = e.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await fetch('api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) }).catch(() => {})
  })())
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  // Never cache auth/data. The API sits beside the app, so under a subpath deployment it is
  // '/gym/api/', not '/api/': a guard on the root path alone let every API answer of such an
  // instance fall through to the cache below — profile data, and now private photos.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith(API_PATH)) return

  const isMedia = url.pathname.includes('/img/') || url.pathname.includes('/gif/')
  if (isMedia) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res })
    )))
    return
  }
  // Network first; the copy for the cache is cloned before the response is handed to the page —
  // cloning later, once the page has started reading the body, throws and caches nothing, which
  // is why the shell never used to survive an offline reload.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}) }
    return res
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit =>
    hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined)
  )))
})
