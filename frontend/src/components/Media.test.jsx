// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Media, { Thumb } from './Media.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: { gifSize: 'full' } }
  state.snapshot = () => ({
    S: state.S,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})

const EX = { id: 'bench', n: 'bench press', gif: 'bench.gif', img: 'bench.jpg' }

let host, root
beforeEach(() => {
  mocks.S = { gifSize: 'full' }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = props => act(() => root.render(<Media ex={EX} {...props} />))

describe('Media gifSize', () => {
  it('renders the full animation by default and toggles to mini in the workout', () => {
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia img')).toBeTruthy()
    expect(host.querySelector('.exmedia.mini')).toBeFalsy()
    act(() => { host.querySelector('.giftoggle').click() })
    expect(mocks.S.gifSize).toBe('mini')
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia.mini')).toBeTruthy()
  })

  it("renders nothing at all in the workout when gifSize is 'off'", () => {
    mocks.S = { gifSize: 'off' }
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia')).toBeFalsy()
    expect(host.querySelector('img')).toBeFalsy()
    expect(host.innerHTML).toBe('')
  })

  it("'off' only applies to the workout — the detail sheet (not minimizable) still shows media", () => {
    mocks.S = { gifSize: 'off' }
    mount({})
    expect(host.querySelector('.exmedia img')).toBeTruthy()
  })

  it('treats a legacy/unknown value as full', () => {
    mocks.S = { gifSize: 'huge' }
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia img')).toBeTruthy()
    expect(host.querySelector('.exmedia.mini')).toBeFalsy()
  })
})

// An exercise with no animation but two photographs — start and end of the movement.
describe('Media with two photographs', () => {
  const TWO = { id: 'fe_1', n: 'snatch', img: 'fedb/Snatch/0.jpg', img2: 'fedb/Snatch/1.jpg' }
  const shown = () => host.querySelector('.exmedia img:not(.exmedia-pre)')
  const render = (ex, props = {}) => act(() => root.render(<Media ex={ex} {...props} />))
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('flips between the two, and has the other one loading behind it', () => {
    render(TWO)
    expect(shown().getAttribute('src')).toBe('img/fedb/Snatch/0.jpg')
    expect(host.querySelector('.exmedia-pre').getAttribute('src')).toBe('img/fedb/Snatch/1.jpg')
    act(() => { vi.advanceTimersByTime(1100) })
    expect(shown().getAttribute('src')).toBe('img/fedb/Snatch/1.jpg')
    act(() => { vi.advanceTimersByTime(1100) })
    expect(shown().getAttribute('src')).toBe('img/fedb/Snatch/0.jpg')
  })

  it('a tap pauses on whichever is up, and another resumes', () => {
    render(TWO)
    act(() => { vi.advanceTimersByTime(1100) })
    act(() => { host.querySelector('.exmedia').click() })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(shown().getAttribute('src')).toBe('img/fedb/Snatch/1.jpg')
    act(() => { host.querySelector('.exmedia').click() })
    act(() => { vi.advanceTimersByTime(1100) })
    expect(shown().getAttribute('src')).toBe('img/fedb/Snatch/0.jpg')
  })

  it('obeys the same workout settings as an animation', () => {
    mocks.S = { gifSize: 'off' }
    render(TWO, { minimizable: true })
    expect(host.innerHTML).toBe('')
    mocks.S = { gifSize: 'mini' }
    render(TWO, { minimizable: true })
    expect(host.querySelector('.exmedia.mini')).toBeTruthy()
  })

  it('shows the neutral tile, not a broken image, when the photographs are not there', () => {
    render(TWO)
    act(() => { shown().dispatchEvent(new Event('error')) })
    expect(host.querySelector('.exmedia.broken')).toBeTruthy()
    expect(host.querySelector('img')).toBeFalsy()
    act(() => { vi.advanceTimersByTime(5000) })                 // and it stops flipping
    expect(host.querySelector('img')).toBeFalsy()
  })

  it('one photograph alone is not an animation, and an exercise with neither renders nothing', () => {
    render({ id: 'x', n: 'x', img: 'only.jpg' })
    expect(host.innerHTML).toBe('')
    render({ id: 'c1', n: 'mine', custom: true })
    expect(host.innerHTML).toBe('')
  })
})

describe('Thumb', () => {
  const thumb = ex => act(() => root.render(<Thumb ex={ex} />))
  it('falls back to the placeholder when the picture does not load, and tries again for another exercise', () => {
    thumb({ id: 'a', img: 'a.jpg' })
    expect(host.querySelector('img.thumb')).toBeTruthy()
    act(() => { host.querySelector('img.thumb').dispatchEvent(new Event('error')) })
    expect(host.querySelector('img')).toBeFalsy()
    expect(host.querySelector('.thumb-x')).toBeTruthy()
    thumb({ id: 'b', img: 'b.jpg' })
    expect(host.querySelector('img.thumb').getAttribute('src')).toBe('img/b.jpg')
    thumb({ id: 'c' })
    expect(host.querySelector('.thumb-x')).toBeTruthy()
  })
})
