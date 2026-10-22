// @vitest-environment happy-dom
/* Reading a typed-out workout through the server: a job, then a poll. Cancel has to mean it —
 * an answer that arrives on the poll that was in flight when the person cancelled must not open
 * the draft, and the server must be told to stop. An answer collected too late reads as such,
 * not as a server restart.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./api.js', () => ({ api: vi.fn() }))

import { api } from './api.js'
import { readWorkoutText, workoutTextError } from './workout-text-api.js'

beforeEach(() => api.mockReset())

describe('cancelling a read', () => {
  it('an answer that lands after Cancel is dropped, and the server is told to stop', async () => {
    const ctl = new AbortController()
    api.mockImplementation(async (p) => {
      const path = String(p || '')
      if (path === '/api/coach/logtext') return { job: { id: 'j1' } }
      if (path.startsWith('/api/coach/logtext/job')) { ctl.abort(); return { state: 'done', result: { items: [], date: null } } }
      return { ok: true }
    })
    await expect(readWorkoutText('жим 3х8 80', { signal: ctl.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(api.mock.calls.some(([p]) => p === '/api/coach/logtext/cancel')).toBe(true)
  }, 10000)

  it('a Cancel that happened before the wait ends it at once', async () => {
    const ctl = new AbortController()
    api.mockImplementation(async (p) => {
      const path = String(p || '')
      if (path === '/api/coach/logtext') { ctl.abort(); return { job: { id: 'j2' } } }
      return { state: 'running' }
    })
    const started = Date.now()
    await expect(readWorkoutText('жим', { signal: ctl.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('what a failure says', () => {
  it('an expired answer is not a restart', () => {
    expect(workoutTextError({ code: 'expired' })).toMatch(/waited too long/)
    expect(workoutTextError({ code: 'restart' })).toMatch(/restarted/)
  })
})
