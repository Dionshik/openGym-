// Asking the AI about food, and waiting for it.
//
// On a server the request starts a job and returns at once; the answer is collected by polling
// (api/coach/food-jobs.js has the why — a local vision model outlasts any proxy's patience).
// The demo answers from a script and a phone with its own key runs the same pipeline itself,
// exactly as the rest of the Coach does (see coach-api.js). Either way the caller gets the
// validated result or an Error with `code` set to the failure class.

import { api } from './api.js'
import { DEMO } from './demo.js'
import { MOBILE } from './mobile.js'
import { t } from './i18n.js'
import { useStore } from '../store/useStore.js'
import { FOOD_ERRORS } from './food-ai.js'

const POLL_MS = 2000
const MAX_WAIT_MS = 30 * 60000      // a ceiling of last resort; the server's own budget ends the job first

const LOCAL = () => MOBILE && useStore.getState().coachLocal?.mode === 'byok'
const fail = (code, detail) => Object.assign(new Error(code), { code, detail: detail || null })
const sleep = (ms, signal) => new Promise(resolve => {
  const tm = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(tm); resolve() }, { once: true })
})

/**
 * @param {{ kind:'meal'|'label'|'suggest', caption?:string, image?:string, context?:object }} req
 * @param {{ signal?:AbortSignal, onWait?:(ms:number)=>void }} [opts]  `onWait` ticks while a job runs
 * @returns the kind's result: { items, note } | { food, note } | { ideas }
 */
export async function runFood(req, { signal, onWait } = {}) {
  const body = { ...req, lang: useStore.getState().S.lang || 'en' }
  if (DEMO) return (await import('./coach-demo.js')).demoFood(body)
  if (LOCAL()) return (await import('./coach-local.js')).localFood(useStore.getState().S, body)

  let job
  try { job = (await api('/api/coach/food', { method: 'POST', body: JSON.stringify(body) })).job }
  catch (e) { throw fail(e.data?.code || (e.status ? 'internal' : 'network')) }

  const started = Date.now()
  let misses = 0
  for (;;) {
    await sleep(POLL_MS, signal)
    if (signal?.aborted) {
      api('/api/coach/food/cancel', { method: 'POST', body: JSON.stringify({ id: job.id }) }).catch(() => {})
      throw fail('cancelled')
    }
    let s
    try { s = await api('/api/coach/food/job?id=' + encodeURIComponent(job.id)); misses = 0 }
    catch (e) {
      // A dropped poll is not a failed job: the phone walked through a dead spot. Keep asking
      // for a while before giving up on it.
      if (++misses > 15) throw fail(e.status ? 'internal' : 'network')
      continue
    }
    if (s.state === 'done') return s.result
    if (s.state === 'failed') throw fail(s.code || 'provider')
    onWait?.(Date.now() - started)
    if (Date.now() - started > MAX_WAIT_MS) throw fail('timeout')
  }
}

/** The line a person sees for a failed food request; a provider's own words (a phone with its
 *  own key, where the person is the operator) follow on the next line. */
export function foodErrorText(e) {
  const base = t(FOOD_ERRORS[e?.code] || FOOD_ERRORS.internal)
  const why = LOCAL() && e?.detail ? String(e.detail).trim().slice(0, 300) : ''
  return why ? `${base}\n${why}` : base
}
