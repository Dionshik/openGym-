/* Taking a progress photo against the last one.
 *
 * A change shows between two pictures only if they were taken the same way, and the surest way
 * to take one the same way is to see the previous one while framing: it is laid over the live
 * camera, half transparent, and the person lines themselves up with their own outline. That needs
 * a viewfinder inside the app (components/GhostCamera.jsx) — the system camera a file input opens
 * cannot be drawn over.
 *
 * Two things have to hold for the overlay to mean anything, and both are decided here:
 *
 *   The frame has the previous picture's shape. A stored photo is, say, 3:4; a phone's video
 *   stream is 4:3, 16:9 or their portrait twins. The viewfinder box takes the photo's aspect, the
 *   video fills it the way `object-fit: cover` does, and the shot is cut to exactly the part of
 *   the frame that was on screen (coverCrop) — so the new picture has the same shape as the old
 *   one and what was lined up stays lined up.
 *
 *   A mirrored preview mirrors the overlay too. The front camera is shown mirrored, as every
 *   phone shows it; the stored pictures are not. Flipping only the video would put the outline's
 *   left arm over the person's right.
 *
 * The frame grabbed from a video stream is smaller than a still from the system camera — one to
 * two thousand pixels on the long edge — which is what a stored body photo is scaled to anyway
 * (lib/image-prep.js).
 */

export const DEFAULT_ASPECT = 3 / 4
export const TIMERS = [0, 3, 10]
const MIN_ASPECT = 9 / 16

/** Whether this browser can open a camera into the page at all (needs HTTPS or localhost). */
export const cameraAvailable = (nav = typeof navigator !== 'undefined' ? navigator : null) =>
  !!(nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function')

/**
 * The shape of the viewfinder, width ÷ height: the previous photo's own, so the two can be laid
 * over each other. Kept between a tall phone frame and a square — a panorama that somebody
 * imported is no frame to stand in — and 3:4 when there is no previous photo to follow.
 */
export function frameAspect(photo) {
  const a = photo && photo.w > 0 && photo.h > 0 ? photo.w / photo.h : DEFAULT_ASPECT
  return Math.min(1, Math.max(MIN_ASPECT, a))
}

/**
 * The part of a `vw`×`vh` video frame that a box of `aspect` shows under object-fit: cover —
 * centred, as wide or as tall as the frame allows. { sx, sy, sw, sh } in whole pixels; null for
 * a frame with no size (the stream has not delivered one yet).
 */
export function coverCrop(vw, vh, aspect) {
  if (!(vw > 0) || !(vh > 0) || !(aspect > 0)) return null
  let sw = vw, sh = Math.round(vw / aspect)
  if (sh > vh) { sh = vh; sw = Math.round(vh * aspect) }
  sw = Math.max(1, Math.min(vw, sw)); sh = Math.max(1, Math.min(vh, sh))
  return { sx: Math.floor((vw - sw) / 2), sy: Math.floor((vh - sh) / 2), sw, sh }
}

/** A preview is mirrored unless the stream is known to be the rear camera. */
export const isMirrored = facing => facing !== 'environment'

/** What to ask the browser for: the given camera, at the best size it will give. */
export const cameraConstraints = facing => ({
  video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1920 } },
  audio: false
})

/**
 * The frame the video is showing, cut to the viewfinder, as a JPEG file ready for the same path
 * a picked photo takes (photo-actions.js addPhoto). Never mirrored: the preview may be, the
 * picture that is kept is the true one. Rejects with Error('noframe') before the stream has
 * delivered a frame.
 */
export async function captureFrame(video, aspect) {
  const crop = coverCrop(video.videoWidth, video.videoHeight, aspect)
  if (!crop) throw new Error('noframe')
  const canvas = document.createElement('canvas')
  canvas.width = crop.sw; canvas.height = crop.sh
  canvas.getContext('2d').drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95))
  if (!blob) throw new Error('noframe')
  return new File([blob], 'camera.jpg', { type: 'image/jpeg' })
}
