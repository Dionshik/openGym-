// @vitest-environment happy-dom
/* The in-app viewfinder with a stand-in for the camera: that it asks for one and gives it back,
 * lays the previous photo over the live picture (mirrored together with it), counts down before
 * the shot, hands over nothing until the person keeps it — and says so plainly where a camera
 * cannot be opened. What a real camera delivers cannot be checked here.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/api.js', () => ({ api: vi.fn(), apiBlob: vi.fn(async () => new Blob(['prev'], { type: 'image/jpeg' })) }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn() }))
vi.mock('../lib/ghost.js', async original => ({ ...(await original()), captureFrame: vi.fn(async () => new File(['shot'], 'camera.jpg', { type: 'image/jpeg' })) }))

import { DEF, useStore } from '../store/useStore.js'
import { captureFrame } from '../lib/ghost.js'
import { releaseAll } from '../lib/photo-urls.js'
import GhostCamera from './GhostCamera.jsx'

const PREV = { id: 'a'.repeat(24), kind: 'body', pose: 'front', d: '2026-09-01', w: 1200, h: 1600 }
let host, root, tracks, asked, facing
const button = label => [...host.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === label)
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
const mount = async props => {
  await act(async () => { root.render(<GhostCamera ghost={PREV} onShot={async () => {}} close={() => {}} {...props} />) })
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), sound: false } })
  tracks = []; asked = []; facing = 'user'
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn(async c => {
      asked.push(c.video.facingMode.ideal)
      const side = c.video.facingMode.ideal
      const track = { stop: vi.fn(), getSettings: () => ({ facingMode: side }) }
      tracks.push(track)
      // happy-dom only lets a real MediaStream be given to a <video>
      const stream = new MediaStream()
      stream.getTracks = () => [track]
      stream.getVideoTracks = () => [track]
      return stream
    })
  } })
  HTMLMediaElement.prototype.play = vi.fn(async () => {})
  let n = 0
  URL.createObjectURL = vi.fn(() => 'blob:' + (++n))
  URL.revokeObjectURL = vi.fn()
  captureFrame.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); releaseAll(); vi.useRealTimers() })

describe('the viewfinder', () => {
  it('opens the front camera, takes the previous photo\'s shape, and lays that photo over the picture', async () => {
    await mount()
    expect(asked).toEqual(['user'])
    const view = host.querySelector('.gc-view')
    expect(parseFloat(view.style.aspectRatio)).toBe(0.75)
    expect(view.classList.contains('mirror')).toBe(true)        // front camera: preview and overlay flipped together
    const ghost = host.querySelector('.gc-ghost')
    expect(ghost).toBeTruthy()
    expect(ghost.style.opacity).toBe('0.4')
    expect(host.querySelector('video')).toBeTruthy()
  })

  it('the overlay can be faded out entirely, and is absent when there is no previous photo', async () => {
    await mount()
    const slider = host.querySelector('input[type=range]')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '0'); slider.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(host.querySelector('.gc-ghost')).toBeNull()
    act(() => root.unmount())
    root = createRoot(host)
    await mount({ ghost: null })
    expect(host.querySelector('.gc-ghost')).toBeNull()
    expect(host.querySelector('input[type=range]')).toBeNull()
    expect(parseFloat(host.querySelector('.gc-view').style.aspectRatio)).toBe(0.75)
  })

  it('switching to the rear camera closes the first stream and stops mirroring', async () => {
    await mount()
    await act(async () => { button('Switch camera').click() })
    await settle()
    expect(asked).toEqual(['user', 'environment'])
    expect(tracks[0].stop).toHaveBeenCalled()
    expect(host.querySelector('.gc-view').classList.contains('mirror')).toBe(false)
  })

  it('gives the camera back when the sheet goes', async () => {
    await mount()
    act(() => root.unmount())
    expect(tracks[0].stop).toHaveBeenCalled()
    root = createRoot(host)
  })
})

describe('taking the picture', () => {
  it('counts down, then shows the shot for a decision — nothing is handed over until it is kept', async () => {
    const onShot = vi.fn(async () => {}), close = vi.fn()
    await mount({ onShot, close })
    await act(async () => { button('Take the photo').click() })
    expect(host.querySelector('.gc-count').textContent).toBe('3')
    expect(captureFrame).not.toHaveBeenCalled()
    for (const left of ['2', '1']) {
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(host.querySelector('.gc-count').textContent).toBe(left)
    }
    await act(async () => { vi.advanceTimersByTime(1000) })
    await settle()
    expect(captureFrame).toHaveBeenCalledTimes(1)
    expect(captureFrame.mock.calls[0][1]).toBe(0.75)
    expect(host.querySelector('.gc-shot')).toBeTruthy()
    expect(host.querySelector('.gc-view').classList.contains('mirror')).toBe(false)   // the kept picture is the true one
    expect(onShot).not.toHaveBeenCalled()

    await act(async () => { button('Save').click() })
    await settle()
    expect(onShot).toHaveBeenCalledTimes(1)
    expect(onShot.mock.calls[0][0]).toBeInstanceOf(File)
    expect(close).toHaveBeenCalled()
  })

  it('with the timer off the shot is immediate; retaking throws it away', async () => {
    const onShot = vi.fn(async () => {})
    await mount({ onShot })
    await act(async () => { button('Off').click() })
    await act(async () => { button('Take the photo').click() })
    await settle()
    expect(captureFrame).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.gc-shot')).toBeTruthy()
    await act(async () => { button('Retake').click() })
    expect(host.querySelector('.gc-shot')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    expect(onShot).not.toHaveBeenCalled()
  })

  it('a running countdown can be cancelled', async () => {
    await mount()
    await act(async () => { button('Take the photo').click() })
    await act(async () => { button('Cancel').click() })
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(captureFrame).not.toHaveBeenCalled()
    expect(host.querySelector('.gc-count')).toBeNull()
  })

  it('a save that fails keeps the shot on screen for another try', async () => {
    const onShot = vi.fn(async () => { throw new Error('offline') }), close = vi.fn()
    await mount({ onShot, close })
    await act(async () => { button('Off').click() })
    await act(async () => { button('Take the photo').click() })
    await settle()
    await act(async () => { button('Save').click() })
    await settle()
    expect(close).not.toHaveBeenCalled()
    expect(host.querySelector('.gc-shot')).toBeTruthy()
    expect(button('Save')).toBeTruthy()
  })
})

describe('where a camera cannot be opened', () => {
  it('a refused permission is said in place, with the way back', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }) })
    await mount()
    expect(host.textContent).toContain('Camera access was denied')
    expect(host.querySelector('video')).toBeNull()
    expect(button('Back')).toBeTruthy()
  })
  it('a browser with no camera API says to use the system camera instead', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    await mount()
    expect(host.textContent).toContain('The camera cannot be opened inside the app here')
  })
})
