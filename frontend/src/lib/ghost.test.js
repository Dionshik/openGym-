// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ASPECT, TIMERS, cameraAvailable, frameAspect, coverCrop, isMirrored, cameraConstraints, captureFrame } from './ghost.js'

afterEach(() => { vi.restoreAllMocks() })

describe('the frame has the previous photo\'s shape', () => {
  it('takes the stored photo\'s own aspect, so the two can be laid over each other', () => {
    expect(frameAspect({ w: 1200, h: 1600 })).toBe(0.75)
    expect(frameAspect({ w: 900, h: 1600 })).toBe(0.5625)
    expect(frameAspect({ w: 1000, h: 1000 })).toBe(1)
  })
  it('3:4 when there is no photo to follow, or one whose size was never recorded', () => {
    expect(frameAspect(null)).toBe(DEFAULT_ASPECT)
    expect(frameAspect({})).toBe(DEFAULT_ASPECT)
    expect(frameAspect({ w: 0, h: 0 })).toBe(DEFAULT_ASPECT)
  })
  it('never wider than a square nor taller than a phone screen', () => {
    expect(frameAspect({ w: 4000, h: 1000 })).toBe(1)
    expect(frameAspect({ w: 500, h: 4000 })).toBe(9 / 16)
  })
})

describe('the shot is the part of the video that was on screen', () => {
  it('a landscape stream in a portrait frame: the full height, the middle of the width', () => {
    expect(coverCrop(1920, 1080, 3 / 4)).toEqual({ sx: 555, sy: 0, sw: 810, sh: 1080 })
  })
  it('a portrait stream in a squarer frame: the full width, the middle of the height', () => {
    expect(coverCrop(1080, 1920, 3 / 4)).toEqual({ sx: 0, sy: 240, sw: 1080, sh: 1440 })
  })
  it('a stream that already has the shape is taken whole', () => {
    expect(coverCrop(1440, 1920, 3 / 4)).toEqual({ sx: 0, sy: 0, sw: 1440, sh: 1920 })
    expect(coverCrop(1000, 1000, 1)).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 1000 })
  })
  it('the cut always has the frame\'s shape and stays inside the video', () => {
    for (const [vw, vh] of [[640, 480], [1280, 720], [720, 1280], [3840, 2160], [1, 1], [7, 5000]]) {
      for (const aspect of [9 / 16, 3 / 4, 1]) {
        const c = coverCrop(vw, vh, aspect)
        expect(c.sx >= 0 && c.sy >= 0 && c.sx + c.sw <= vw && c.sy + c.sh <= vh, `${vw}x${vh} @${aspect}`).toBe(true)
        if (Math.min(c.sw, c.sh) > 50) expect(Math.abs(c.sw / c.sh - aspect)).toBeLessThan(0.02)
      }
    }
  })
  it('a stream that has not delivered a frame yet has nothing to cut', () => {
    expect(coverCrop(0, 0, 3 / 4)).toBe(null)
    expect(coverCrop(1920, 1080, 0)).toBe(null)
    expect(coverCrop(undefined, 1080, 3 / 4)).toBe(null)
  })
})

describe('the camera', () => {
  it('is offered only where a page can open one', () => {
    expect(cameraAvailable({ mediaDevices: { getUserMedia: () => {} } })).toBe(true)
    expect(cameraAvailable({ mediaDevices: {} })).toBe(false)
    expect(cameraAvailable({})).toBe(false)             // plain http: the browser leaves mediaDevices out
    expect(cameraAvailable(null)).toBe(false)
  })
  it('the preview is mirrored unless the stream is known to be the rear camera', () => {
    expect(isMirrored('user')).toBe(true)
    expect(isMirrored(undefined)).toBe(true)             // a laptop webcam does not say
    expect(isMirrored('environment')).toBe(false)
  })
  it('asks for the named side, video only', () => {
    expect(cameraConstraints('environment')).toMatchObject({ audio: false, video: { facingMode: { ideal: 'environment' } } })
  })
  it('the self-timer offers none, a short one and one long enough to walk back into the frame', () => {
    expect(TIMERS).toEqual([0, 3, 10])
  })
})

describe('captureFrame', () => {
  const stubCanvas = blob => {
    const drawn = []
    const real = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(tag => {
      if (tag !== 'canvas') return real(tag)
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...a) => drawn.push(a) }), toBlob: (cb, type, q) => { canvas.asked = [type, q]; cb(blob) } }
      stubCanvas.last = canvas
      return canvas
    })
    return drawn
  }
  it('draws exactly the visible part of the frame, unmirrored, and hands back a JPEG file', async () => {
    const drawn = stubCanvas(new Blob(['jpeg'], { type: 'image/jpeg' }))
    const video = { videoWidth: 1920, videoHeight: 1080 }
    const file = await captureFrame(video, 3 / 4)
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
    expect([stubCanvas.last.width, stubCanvas.last.height]).toEqual([810, 1080])
    expect(drawn).toEqual([[video, 555, 0, 810, 1080, 0, 0, 810, 1080]])
    expect(stubCanvas.last.asked).toEqual(['image/jpeg', 0.95])
  })
  it('refuses before the stream has a frame, or when the browser gives no picture back', async () => {
    stubCanvas(null)
    await expect(captureFrame({ videoWidth: 0, videoHeight: 0 }, 3 / 4)).rejects.toThrow('noframe')
    await expect(captureFrame({ videoWidth: 640, videoHeight: 480 }, 3 / 4)).rejects.toThrow('noframe')
  })
})
