/* Copying what the Health shortcut delivered into the profile.
 *
 * The server keeps the deliveries in a file of its own (api/healthkit.js) — it never writes the
 * profile. This is where they become weigh-ins and measurements, on the device, as an ordinary
 * edit that syncs like any other.
 *
 * Two rules keep it from fighting the person:
 *
 *   What was typed by hand wins. A day that already has a manual weigh-in keeps it; a reading
 *   from Health only ever fills an empty day or replaces an earlier reading from Health.
 *
 *   Nothing is applied twice. `healthSync.applied` remembers how far the deliveries have been
 *   copied, by the server's own timestamp of each reading — so a weigh-in the person deleted
 *   afterwards stays deleted instead of coming back on the next pull.
 */

const LB = 0.45359237
const r1 = n => Math.round(n * 10) / 10
const MEASURES = ['bodyFat', 'leanMass', 'waist']

const readings = health => Object.entries(health?.days || {}).flatMap(([d, day]) =>
  Object.entries(day || {}).map(([metric, r]) => ({ d, metric, v: r?.v, at: r?.at || 0 })))

/** Is there anything in `health` this profile has not copied yet? */
export function healthPending(S, health) {
  const cursor = S?.healthSync?.applied || 0
  return readings(health).some(r => r.at > cursor && r.v > 0) || ((health?.height?.at || 0) > cursor && health.height.v > 0)
}

/**
 * Copies the new readings into S (mutating it — call inside a store update).
 * @returns {{ weighIns:number, measures:number, height:boolean }} what was actually written
 */
export function applyHealth(S, health) {
  const cursor = S.healthSync?.applied || 0
  const out = { weighIns: 0, measures: 0, height: false }
  let newest = cursor
  if (!Array.isArray(S.bodyweight)) S.bodyweight = []
  if (!Array.isArray(S.measurements)) S.measurements = []

  for (const r of readings(health).sort((a, b) => a.at - b.at)) {
    if (!(r.at > cursor) || !(r.v > 0)) continue
    newest = Math.max(newest, r.at)
    if (r.metric === 'weight') {
      const w = r1(S.unit === 'lb' ? r.v / LB : r.v)
      const have = S.bodyweight.find(b => b.d === r.d)
      if (!have) { S.bodyweight.push({ d: r.d, w, t: r.at, src: 'hk' }); out.weighIns++ }
      else if (have.src === 'hk') { have.w = w; have.t = r.at; out.weighIns++ }
    } else if (MEASURES.includes(r.metric)) {
      let row = S.measurements.find(m => m.d === r.d)
      if (!row) { row = { d: r.d, t: r.at, src: 'hk' }; S.measurements.push(row) }
      // A value the person measured themselves that day stays; an empty slot, or a row that is
      // Health's own, takes the reading.
      if (row.src === 'hk' || !(row[r.metric] > 0)) { row[r.metric] = r.v; row.t = Math.max(row.t || 0, r.at); out.measures++ }
    }
  }
  const h = health?.height
  if (h && h.at > cursor && h.v > 0) {
    newest = Math.max(newest, h.at)
    if (!(S.bodyProfile?.heightCm > 0)) { S.bodyProfile = { ...(S.bodyProfile || {}), heightCm: h.v, t: h.at }; out.height = true }
  }
  S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
  S.measurements.sort((a, b) => (a.d < b.d ? -1 : 1))
  if (newest > cursor) S.healthSync = { ...(S.healthSync || {}), applied: newest }
  return out
}
