/* Reading the list of stored photos (api/photos.js lists them; the store keeps the list).
 *
 * Each row: { id, kind: 'body' | 'meal', d, pose? | m?, mime, w, h, bytes, at, thumb }.
 * A body photo belongs to a pose, because a change only shows between two pictures taken the
 * same way; a meal photo belongs to a day and a meal, not to a diary row — rows are folded away
 * after three months and the picture should outlive them.
 */

export const POSES = ['front', 'side', 'back', 'flex']
const list = v => (Array.isArray(v) ? v : [])
const DAY = 86400000
const noon = iso => new Date(iso + 'T12:00:00').getTime()
const byDay = (a, b) => (a.d === b.d ? (a.at || 0) - (b.at || 0) : a.d < b.d ? -1 : 1)

/** Stored photos exist only for someone signed in to an instance that keeps them. */
export const photosAvailable = ({ config, user, demo = false } = {}) => !!user && !demo && config?.photos === true

/** Body photos of one pose, oldest first. */
export const bodyByPose = (items, pose) => list(items).filter(p => p && p.kind === 'body' && (p.pose || 'front') === pose).sort(byDay)
/** The poses that have at least one photo, in the fixed order. */
export const posesUsed = items => POSES.filter(pose => list(items).some(p => p && p.kind === 'body' && (p.pose || 'front') === pose))
/** Photos of one meal on one day, in the order they were taken; without `m`, of the whole day. */
export const mealPhotos = (items, d, m) => list(items).filter(p => p && p.kind === 'meal' && p.d === d && (m == null || (p.m || 0) === m)).sort(byDay)

/** Whole days from one date to another (negative when `to` is earlier). */
export const daysBetween = (from, to) => Math.round((noon(to) - noon(from)) / DAY)

/**
 * The two pictures a comparison opens on: the first of the pose and the latest. null with fewer
 * than two — one picture has nothing to be compared with.
 */
export function comparePair(items, pose) {
  const all = bodyByPose(items, pose)
  return all.length < 2 ? null : { before: all[0], after: all.at(-1), all }
}

/** The weigh-in nearest to a day, within `within` days of it: { w, d } or null. */
export function nearestWeight(S, d, within = 7) {
  let best = null
  for (const b of list(S?.bodyweight)) {
    if (!b || !(b.w > 0) || !b.d) continue
    const gap = Math.abs(daysBetween(b.d, d))
    if (gap <= within && (!best || gap < best.gap)) best = { w: b.w, d: b.d, gap }
  }
  return best ? { w: best.w, d: best.d } : null
}

/** "1.4 MB" — how full the member's store is, for the line under the timeline. */
export function sizeText(bytes) {
  const mb = (bytes || 0) / 1024 / 1024
  return mb >= 1024 ? { n: Math.round(mb / 102.4) / 10, unit: 'GB' } : { n: mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10, unit: 'MB' }
}
