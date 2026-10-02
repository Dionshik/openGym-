// @vitest-environment happy-dom
/* A photo sent to the AI to be read is not kept — that has been said next to the Send button
 * since the feature existed, and the server holds it to that (api/test/food-ai.test.js). Where
 * the instance stores photos, the draft offers to keep the picture with the entry. This pins the
 * one thing that offer must never do: keep it without being asked.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ addPhoto: vi.fn(() => Promise.resolve({ id: 'x' })), photoError: vi.fn(() => 'could not save') }))
vi.mock('./photo-actions.js', () => ({ addPhoto: (...a) => mocks.addPhoto(...a), photoError: (...a) => mocks.photoError(...a) }))
vi.mock('./lib/api.js', () => ({ api: vi.fn(() => Promise.reject(new Error('offline'))), apiBlob: vi.fn(), apiBase: () => '' }))

import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { nutritionOf } from './lib/nutrition.js'
import { Draft } from './nutrition-ai.jsx'

const D = '2026-10-02'
const FILE = new Blob(['plate'], { type: 'image/jpeg' })
const draft = () => ({ note: '', rows: [{ key: 0, n: 'Buckwheat', g: 200, per100: { k: 110, p: 4, f: 1, c: 21 }, src: 'table', ref: 'g:u1' }] })

let host, root
beforeEach(() => {
  localStorage.clear()
  mocks.addPhoto.mockClear()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: null, config: null })
  useUI.setState({ sheets: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const show = keep => act(() => root.render(<Draft draft={draft()} setDraft={() => {}} meal={2} setMeal={() => {}} d={D} close={() => {}} back={() => {}} keep={keep} />))
const add = () => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Add to')).click())
const logged = () => nutritionOf(useStore.getState().S).log

describe('keeping the photo of a meal the AI read', () => {
  it('where photos are not kept, the draft does not offer it and nothing is uploaded', () => {
    show(null)
    expect(host.textContent).not.toContain('Save the photo with this entry')
    add()
    expect(logged()).toHaveLength(1)
    expect(mocks.addPhoto).not.toHaveBeenCalled()
  })

  it('offered but left off — the default — the entry is logged and the photo is not kept', () => {
    show({ on: false, set: () => {}, file: FILE })
    expect(host.textContent).toContain('Save the photo with this entry')
    expect(host.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false')
    add()
    expect(logged()).toHaveLength(1)
    expect(mocks.addPhoto).not.toHaveBeenCalled()
  })

  it('switched on, the original picture goes to the photo store under the day and meal of the entry', () => {
    show({ on: true, set: () => {}, file: FILE })
    add()
    expect(logged()).toHaveLength(1)
    expect(mocks.addPhoto).toHaveBeenCalledTimes(1)
    expect(mocks.addPhoto).toHaveBeenCalledWith(FILE, { kind: 'meal', d: D, m: 2 })
  })

  it('the switch reports the change to its owner rather than deciding by itself', () => {
    const set = vi.fn()
    show({ on: false, set, file: FILE })
    act(() => host.querySelector('[role="switch"]').click())
    expect(set).toHaveBeenCalledWith(true)
    expect(mocks.addPhoto).not.toHaveBeenCalled()
  })

  it('a photo that fails to save does not cost the entry', async () => {
    mocks.addPhoto.mockRejectedValueOnce(Object.assign(new Error('HTTP 409'), { data: { code: 'quota' } }))
    show({ on: true, set: () => {}, file: FILE })
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Add to')).click(); await Promise.resolve() })
    expect(logged()).toHaveLength(1)
    expect(mocks.photoError).toHaveBeenCalled()
  })

  it('with nothing left in the draft, neither an entry nor a photo is made', () => {
    act(() => root.render(<Draft draft={{ note: '', rows: [] }} setDraft={() => {}} meal={2} setMeal={() => {}} d={D} close={() => {}} back={() => {}} keep={{ on: true, set: () => {}, file: FILE }} />))
    add()
    expect(logged()).toHaveLength(0)
    expect(mocks.addPhoto).not.toHaveBeenCalled()
  })
})
