// @vitest-environment happy-dom
/* What the phone sends for a picture that is to be kept. The part that matters is the one a
 * unit test can actually reach without a real encoder: that the type of what the canvas
 * returned is what decides the format — never the type that was asked for — because a browser
 * that cannot encode WebP answers with a PNG and says nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fitSize, preparePhoto, fileToJpeg, PRESETS, _resetEncoderProbe } from './image-prep.js'

let asked        // every toBlob call: [type, quality, width, height]
let encoder      // type asked for → type of the blob the "browser" returns (null = no blob)
const realCreate = document.createElement.bind(document)

beforeEach(() => {
  asked = []
  _resetEncoderProbe()
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3000, height: 4000, close: vi.fn() })))
  vi.spyOn(document, 'createElement').mockImplementation(tag => {
    if (tag !== 'canvas') return realCreate(tag)
    const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(_) {} }) }
    canvas.toBlob = (cb, type, quality) => {
      asked.push([type, quality, canvas.width, canvas.height])
      const out = encoder(type)
      cb(out ? new Blob(['x'.repeat(canvas.width)], { type: out }) : null)
    }
    return canvas
  })
  URL.createObjectURL = vi.fn(() => 'blob:preview')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const file = new Blob(['raw camera bytes'], { type: 'image/jpeg' })

describe('fitSize', () => {
  it('scales the long edge down and never up', () => {
    expect(fitSize(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 })
    expect(fitSize(4000, 3000, 1280)).toEqual({ w: 1280, h: 960 })
    expect(fitSize(800, 600, 1600)).toEqual({ w: 800, h: 600 })
    expect(fitSize(0, 10)).toEqual({ w: 0, h: 0 })
  })
})

describe('a picture to keep', () => {
  it('a browser that encodes WebP gets WebP, for the picture and the thumbnail', async () => {
    encoder = type => type
    const p = await preparePhoto(file, 'body')
    expect(p.mime).toBe('image/webp')
    expect([p.w, p.h]).toEqual([1200, 1600])
    expect(asked).toEqual([['image/webp', PRESETS.body.quality, 1200, 1600], ['image/webp', PRESETS.thumb.quality, 240, 320]])
    expect(typeof p.image).toBe('string')
    expect(typeof p.thumb).toBe('string')
    expect(p.thumb.length).toBeLessThan(p.image.length)
    expect(p.url).toBe('blob:preview')
  })

  it('a browser that answers a WebP request with a PNG (Safari) is given JPEG instead — and is not asked twice', async () => {
    encoder = type => (type === 'image/webp' ? 'image/png' : type)
    const p = await preparePhoto(file, 'body')
    expect(p.mime).toBe('image/jpeg')
    // the probe once, then JPEG for the picture and straight to JPEG for the thumbnail
    expect(asked.map(a => a[0])).toEqual(['image/webp', 'image/jpeg', 'image/jpeg'])
    asked = []
    const again = await preparePhoto(file, 'meal')
    expect(again.mime).toBe('image/jpeg')
    expect(asked.map(a => a[0])).toEqual(['image/jpeg', 'image/jpeg'])
  })

  it('a browser that returns nothing for WebP falls back the same way', async () => {
    encoder = type => (type === 'image/webp' ? null : type)
    expect((await preparePhoto(file, 'body')).mime).toBe('image/jpeg')
  })

  it('a browser that cannot produce a JPEG either fails loudly rather than upload a PNG', async () => {
    encoder = () => 'image/png'
    await expect(preparePhoto(file, 'body')).rejects.toThrow('unencodable')
  })

  it('a meal photo is smaller than a body photo', async () => {
    encoder = type => type
    const m = await preparePhoto(file, 'meal')
    expect([m.w, m.h]).toEqual([960, 1280])
    expect(asked[0]).toEqual(['image/webp', PRESETS.meal.quality, 960, 1280])
    expect(PRESETS.meal.max).toBeLessThan(PRESETS.body.max)
  })

  it('the photo is read upright: the orientation the camera recorded is applied before redrawing', async () => {
    encoder = type => type
    await preparePhoto(file, 'body')
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
  })

  it('a file that is not a picture is refused', async () => {
    encoder = type => type
    createImageBitmap.mockResolvedValueOnce({ width: 0, height: 0 })
    await expect(preparePhoto(file, 'body')).rejects.toThrow('undecodable')
  })
})

describe('a picture for the AI stays what it was', () => {
  it('always JPEG at a thousand pixels, whatever the browser could do', async () => {
    encoder = type => type
    const p = await fileToJpeg(file)
    expect(p.mime).toBe('image/jpeg')
    expect(asked).toEqual([['image/jpeg', 0.8, 768, 1024]])
  })
})
