// Asking the AI to read a typed-out workout, and waiting for it.
//
// On a server the request starts a job and returns at once; the answer is collected by polling
// (api/coach/logtext-jobs.js has the why — a whole session can take a local model longer than a
// proxy waits). The demo answers with the app's own search and a phone with its own key runs
// the same pipeline itself, as the rest of the Coach does. Either way the caller gets the
// resolved draft or an Error with `code` set to the failure class.

import { api } from './api.js'
import { DEMO } from './demo.js'
import { MOBILE } from './mobile.js'
import { t } from './i18n.js'
import { todayISO } from './format.js'
import { useStore } from '../store/useStore.js'
import { lookupErrorText } from './coach-api.js'

const POLL_MS = 2000
const MAX_WAIT_MS = 30 * 60000      // a ceiling of last resort; the server's own budget ends the job first

const LOCAL = () => MOBILE && useStore.getState().coachLocal?.mode === 'byok'
const fail = (code, detail) => Object.assign(new Error(code), { code, detail: detail || null })
const sleep = (ms, signal) => new Promise(resolve => {
  const tm = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(tm); resolve() }, { once: true })
})

/**
 * @param {string} text
 * @param {{ signal?:AbortSignal, onWait?:(ms:number)=>void }} [opts]
 * @returns {{ items:object[], date:string|null, start:string|null, minutes:number|null, unit:string|null }}
 */
export async function readWorkoutText(text, { signal, onWait } = {}) {
  const today = todayISO()
  if (DEMO) return (await import('./coach-demo.js')).demoLogText(text)
  if (LOCAL()) return (await import('./coach-local.js')).localLogText(useStore.getState().S, text, today)

  let job
  try { job = (await api('/api/coach/logtext', { method: 'POST', body: JSON.stringify({ text: String(text || ''), today }) })).job }
  catch (e) { throw fail(e.data?.code || (e.status ? 'internal' : 'network')) }

  const started = Date.now()
  let misses = 0
  for (;;) {
    await sleep(POLL_MS, signal)
    if (signal?.aborted) {
      api('/api/coach/logtext/cancel', { method: 'POST', body: JSON.stringify({ id: job.id }) }).catch(() => {})
      throw fail('cancelled')
    }
    let s
    try { s = await api('/api/coach/logtext/job?id=' + encodeURIComponent(job.id)); misses = 0 }
    catch (e) {
      // A dropped poll is not a failed job: the phone walked through a dead spot.
      if (++misses > 15) throw fail(e.status ? 'internal' : 'network')
      continue
    }
    if (s.state === 'done') return s.result
    if (s.state === 'failed') throw fail(s.code || 'provider')
    onWait?.(Date.now() - started)
    if (Date.now() - started > MAX_WAIT_MS) throw fail('timeout')
  }
}

// The classes a typed-out workout can fail with that the lookup's wording does not cover.
const LOGTEXT_ERRORS = {
  empty: 'Describe the workout first.',
  busy: 'Still reading the last one — give it a moment.',
  network: 'No connection — reading a workout needs the server.',
  restart: 'The server restarted while reading — try again.'
}

/** The line a person sees for a failed read. */
export function workoutTextError(e) {
  const cls = e?.code || 'internal'
  if (LOGTEXT_ERRORS[cls]) return t(LOGTEXT_ERRORS[cls])
  return lookupErrorText(e)
}
