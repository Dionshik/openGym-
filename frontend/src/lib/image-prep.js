/* A photograph, made small enough to send.
 *
 * A phone camera hands over 3–12 megabytes; the server takes five in total, and a vision model
 * scales anything large back down before it looks at it anyway. So the picture is redrawn at
 * about a thousand pixels on its long edge and re-encoded as JPEG — one or two hundred
 * kilobytes — which is also the format every provider and every local model server accepts.
 * Nothing else happens to it, and nothing is kept: the caller gets the bytes and a preview URL
 * to revoke when the sheet closes.
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
    try { return await createImageBitmap(file) } catch { /* a format this decoder refuses (HEIC on some browsers) — try <img> */ }
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
