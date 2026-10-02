/* Stored photos, on screen.
 *
 * A stored photo cannot be an <img src="api/photo?id=…">: the paired phone app authenticates
 * with a header an image request cannot carry. So every picture is fetched with the session
 * (lib/api.js apiBlob) and shown from an object URL, in every build alike.
 *
 * An object URL keeps its Blob in memory until it is revoked, and a timeline of thumbnails
 * mounts and unmounts the same pictures constantly. This is a small reference-counted cache:
 * a picture on screen holds its URL, one that left the screen stays for a while in case it comes
 * back, and beyond KEEP unused entries the oldest are revoked. Everything is revoked on
 * sign-out — a picture must not outlive the session that was allowed to see it.
 *
 * Nothing here touches disk, localStorage or Cache Storage.
 */
import { apiBlob } from './api.js'

const KEEP = 60
const cache = new Map()   // key → { promise, url, refs, used }
let tick = 0
const keyOf = (id, thumb) => id + (thumb ? ':t' : '')

/** A URL for one stored photo, fetched once. Pair every acquire with a release. */
export function acquire(id, thumb = false) {
  const key = keyOf(id, thumb)
  let e = cache.get(key)
  if (!e) {
    e = { url: null, refs: 0, used: 0, promise: null }
    e.promise = apiBlob(`/api/photo?id=${encodeURIComponent(id)}${thumb ? '&thumb=1' : ''}`)
      .then(blob => {
        // Released while it was on its way (sign-out, the photo deleted): no URL is made for an
        // entry nobody will ever revoke, and whoever was waiting gets nothing to show.
        if (cache.get(key) !== e) throw new Error('released')
        e.url = URL.createObjectURL(blob)
        return e.url
      })
      .catch(err => { if (cache.get(key) === e) cache.delete(key); throw err })   // a failed fetch is tried again next time
    cache.set(key, e)
  }
  e.refs += 1
  e.used = ++tick
  return e.promise
}

export function release(id, thumb = false) {
  const e = cache.get(keyOf(id, thumb))
  if (!e) return
  e.refs = Math.max(0, e.refs - 1)
  trim()
}

function trim() {
  const idle = [...cache.entries()].filter(([, e]) => e.refs === 0 && e.url).sort((a, b) => a[1].used - b[1].used)
  for (const [key, e] of idle.slice(0, Math.max(0, idle.length - KEEP))) { URL.revokeObjectURL(e.url); cache.delete(key) }
}

/** A photo was deleted: its URLs go now, whoever still shows them. */
export function forget(id) {
  for (const thumb of [false, true]) {
    const e = cache.get(keyOf(id, thumb))
    if (!e) continue
    if (e.url) URL.revokeObjectURL(e.url)
    cache.delete(keyOf(id, thumb))
  }
}

/** Sign-out, or another profile on this device. */
export function releaseAll() {
  for (const e of cache.values()) if (e.url) URL.revokeObjectURL(e.url)
  cache.clear()
}

export const cacheSize = () => cache.size
