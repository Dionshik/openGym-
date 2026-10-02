/* Keeping and deleting a stored photo (api/photos.js). The only writers of the store's photo list.
 *
 * A picture is prepared on the phone first — shrunk, re-encoded, its metadata gone
 * (lib/image-prep.js) — and only then sent. There is no offline queue: a photo needs the server
 * at the moment it is taken, and says so when it has none.
 */
import { useStore } from './store/useStore.js'
import { api } from './lib/api.js'
import { t } from './lib/i18n.js'
import { preparePhoto } from './lib/image-prep.js'
import { forget } from './lib/photo-urls.js'

/** Stores `file` as { kind, d, pose } or { kind, d, m }. Returns the stored row; throws on failure. */
export async function addPhoto(file, meta) {
  const p = await preparePhoto(file, meta.kind)
  try {
    const r = await api('/api/photos', { method: 'POST', body: JSON.stringify({ ...meta, image: p.image, thumb: p.thumb, w: p.w, h: p.h }) })
    useStore.getState().setPhotos(cur => ({ rev: r.rev, used: r.used, quota: r.quota, items: [...cur.items, r.photo] }))
    return r.photo
  } finally { URL.revokeObjectURL(p.url) }
}

/**
 * Deletes every stored photo of the signed-in member — also on a server whose photo store was
 * switched off again, which is the one case where they cannot be picked one by one. Throws when
 * the server could not be reached: the caller must not say "deleted" then.
 */
export async function clearAllPhotos() {
  await api('/api/photos/clear', { method: 'POST', body: '{}' })
  useStore.getState().clearPhotos()
}

export async function removePhotos(ids) {
  const r = await api('/api/photos/delete', { method: 'POST', body: JSON.stringify({ ids }) })
  ids.forEach(forget)
  useStore.getState().setPhotos(cur => ({ rev: r.rev, used: r.used, quota: r.quota || cur.quota, items: cur.items.filter(p => !ids.includes(p.id)) }))
  return r.removed
}

/** What went wrong, in words for the person who just tried to keep a photo. */
export function photoError(e) {
  const code = e?.data?.code || (e?.data?.error === 'disabled' ? 'disabled' : e?.message)
  if (code === 'quota') return t('Your photo storage is full. Delete some photos to make room.')
  if (code === 'throttled') return t('Too many photos in one hour — try again later.')
  if (code === 'expired') return t('This server keeps meal photos for {0} days only — that day is older.', e.data.days)
  if (code === 'disabled') return t('Photos are switched off on this server.')
  if (code === 'toolarge' || code === 'badimage' || code === 'undecodable' || code === 'unencodable') return t('This picture could not be read. Try another one.')
  return t('Could not save the photo. Check the connection and try again.')
}
