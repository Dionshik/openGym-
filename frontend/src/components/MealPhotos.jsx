import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { mealPhotos } from '../lib/photos.js'
import { addPhoto, photoError } from '../photo-actions.js'
import { photoSheet } from './BodyPhotos.jsx'
import Photo from './Photo.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

/**
 * The photos kept beside one meal of one day — or, without `m`, beside the whole day (a day old
 * enough to have been folded into totals has no meals left to hang them on). Nothing is drawn
 * when there are none.
 */
export function MealPhotoStrip({ d, m, title }) {
  const items = useStore(s => s.photos?.items)
  const mine = mealPhotos(items, d, m)
  if (!mine.length) return null
  return <div className="ph-meal">
    {mine.map(p => <button key={p.id} onClick={() => photoSheet(p, title || fmtDate(p.d, true, true))}>
      <Photo id={p.id} thumb alt={title || ''} className="ph-thumb" />
    </button>)}
  </div>
}

// A picture of the plate, kept as it is — no AI involved, nothing read out of it.
function MealPhotoSheet({ d, m, title, close }) {
  const [busy, setBusy] = useState(false)
  const camera = useRef(null), gallery = useRef(null)
  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!file) return
    setBusy(true)
    try { await addPhoto(file, { kind: 'meal', d, m }); useUI.getState().toast(t('Photo saved')); close() }
    catch (e) { useUI.getState().toast(photoError(e)); setBusy(false) }
  }
  return <>
    <h3>{t('Photo of the meal')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{title} · {t('kept beside the diary as a picture; nothing is read out of it.')}</div>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
    <input ref={gallery} type="file" accept="image/*" hidden onChange={onFile} />
    {busy ? <div className="nt-busy"><Icon name="camera" />{t('Saving the photo…')}</div> : <>
      <Button variant="primary" icon="camera" onClick={() => camera.current.click()}>{t('Take a photo')}</Button>
      <div style={{ height: 8 }} />
      <Button icon="image" onClick={() => gallery.current.click()}>{t('Choose from library')}</Button>
    </>}
    <div className="dim small" style={{ marginTop: 12 }}>{t('Photos are kept on this server as files, not encrypted: whoever runs the server can open them.')}</div>
  </>
}
export const mealPhotoSheet = ({ d, m, title }) => useUI.getState().openSheet(close => <MealPhotoSheet d={d} m={m} title={title} close={close} />)
