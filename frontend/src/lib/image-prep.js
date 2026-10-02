/* A photograph, made small enough to send.
 *
 * A phone camera hands over 3–12 megabytes; the server takes five in total, and a vision model
 * scales anything large back down before it looks at it anyway. So the picture is redrawn at
 * about a thousand pixels on its long edge and re-encoded as JPEG — one or two hundred
 * kilobytes — which is also the format every provider and every local model server accepts.
 * Nothing else happens to it, and this module keeps nothing: the caller gets the bytes and a
 * preview URL to revoke when the sheet closes.
 *
 * Two callers, two outputs. `fileToJpeg` is for the AI: always JPEG, a thousand pixels.
 * `preparePhoto` is for a picture the member keeps (api/photos.js): larger, with a thumbnail,
 * and in WebP where the browser can really produce one — see encodeCanvas for why "can" has to
 * be checked rather than assumed. Redrawing on a canvas is also what removes the camera's
 * metadata, the GPS position included: a canvas has pixels and nothing else to write out.
 */

export const MAX_EDGE = 1024
export const JPEG_QUALITY = 0.8

/** The size a w×h picture is drawn at so its long edge is at most `max`. Never scales up. */
export function fitSize(w, h, max = MAX_EDGE) {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 }
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

async function bitmapOf(file) {
  if (typeof createImageBitmap === 'function') {
    // 'from-image' is the default, said out loud: a phone photo is stored sideways with a note to
    // rotate it, and the redrawn copy has no such note — it has to be upright in its pixels.
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* a format this decoder refuses (HEIC on some browsers) — try <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('undecodable'))
      img.src = url
    })
  } finally { URL.revokeObjectURL(url) }
}

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
  r.onerror = () => reject(new Error('unreadable'))
  r.readAsDataURL(blob)
})

/**
 * { data, mime, bytes, url } — base64 JPEG without the data: prefix, and an object URL for the
 * preview (the caller revokes it). Throws Error('undecodable') for a file that is not a picture
 * this browser can read.
 */
export async function fileToJpeg(file, { max = MAX_EDGE, quality = JPEG_QUALITY } = {}) {
  const src = await bitmapOf(file)
  const { w, h } = fitSize(src.width || src.naturalWidth, src.height || src.naturalHeight, max)
  if (!w || !h) throw new Error('undecodable')
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  // JPEG has no transparency: a cut-out PNG would otherwise come out on black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(src, 0, 0, w, h)
  src.close?.()
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('undecodable')
  return { data: await toBase64(blob), mime: 'image/jpeg', bytes: blob.size, url: URL.createObjectURL(blob) }
}

/* ---------- a picture to keep ---------- */

// Long edge and quality per use. A body photo is looked at closely and compared; a meal photo
// is a reminder of a plate; a thumbnail fills a timeline. Resolution is the big lever — 1280
// instead of 1600 pixels is a third fewer bytes, more than the choice of format saves.
export const PRESETS = {
  body: { max: 1600, quality: 0.82 },
  meal: { max: 1280, quality: 0.8 },
  thumb: { max: 320, quality: 0.7 }
}

const toBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality))
// Whether this browser's canvas encodes WebP: unknown until tried once, then remembered.
let webpWorks = null
export const _resetEncoderProbe = () => { webpWorks = null }

/**
 * WebP if the browser makes one, JPEG otherwise.
 *
 * Asking is not enough. A browser that cannot encode the requested type does not fail — it
 * returns a PNG, silently (Safari and every iOS browser do this for WebP). A photograph as PNG
 * is about ten times the size of the JPEG it replaced, so the type of what came back is checked,
 * not the type that was asked for, and the same check holds for the JPEG fallback.
 */
async function encodeCanvas(canvas, quality) {
  if (webpWorks !== false) {
    const blob = await toBlob(canvas, 'image/webp', quality)
    if (blob && blob.type === 'image/webp') { webpWorks = true; return blob }
    webpWorks = false
  }
  const blob = await toBlob(canvas, 'image/jpeg', quality)
  if (!blob || blob.type !== 'image/jpeg') throw new Error('unencodable')
  return blob
}

function draw(src, max) {
  const { w, h } = fitSize(src.width || src.naturalWidth, src.height || src.naturalHeight, max)
  if (!w || !h) throw new Error('undecodable')
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(src, 0, 0, w, h)
  return { canvas, w, h }
}

/**
 * A picture ready to be stored: { image, thumb, mime, w, h, bytes, url } — the picture and its
 * thumbnail as base64 without the data: prefix, and an object URL of the picture for a preview
 * (the caller revokes it). `kind` is 'body' or 'meal'. Throws Error('undecodable') for a file
 * this browser cannot read, Error('unencodable') if it can produce neither format.
 */
export async function preparePhoto(file, kind = 'body') {
  const preset = PRESETS[kind] || PRESETS.body
  const src = await bitmapOf(file)
  try {
    const full = draw(src, preset.max)
    const blob = await encodeCanvas(full.canvas, preset.quality)
    const small = await encodeCanvas(draw(src, PRESETS.thumb.max).canvas, PRESETS.thumb.quality)
    return { image: await toBase64(blob), thumb: await toBase64(small), mime: blob.type, w: full.w, h: full.h, bytes: blob.size, url: URL.createObjectURL(blob) }
  } finally { src.close?.() }
}
