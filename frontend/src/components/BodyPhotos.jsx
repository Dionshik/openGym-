import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { DEMO } from '../lib/demo.js'
import { todayISO, fmtDate, fmtNum } from '../lib/format.js'
import { POSES, photosAvailable, bodyByPose, comparePair, daysBetween, nearestWeight, sizeText } from '../lib/photos.js'
import { addPhoto, removePhotos, clearAllPhotos, photoError } from '../photo-actions.js'
import { confirmSheet } from '../sheets.jsx'
import { cameraAvailable } from '../lib/ghost.js'
import Photo from './Photo.jsx'
import GhostCamera from './GhostCamera.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Names live here, in t() calls, so the string check finds them.
const POSE_NAME = { front: () => t('Front view'), side: () => t('Side view'), back: () => t('Back view'), flex: () => t('Flexed') }
const poseName = pose => (POSE_NAME[pose] ? POSE_NAME[pose]() : pose)
const NONE = []

/**
 * Progress photos on the Body screen: by pose, because a change only shows between two pictures
 * taken the same way. Present only where the instance stores photos and somebody is signed in —
 * a guest, the demo and the stand-alone app have nowhere to keep them.
 */
export default function BodyPhotos() {
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const photos = useStore(s => s.photos)
  const pullPhotos = useStore(s => s.pullPhotos)
  const available = photosAvailable({ config, user, demo: DEMO })
  const kept = useStore(s => s.photosKept)
  const [pose, setPose] = useState('front')
  useEffect(() => { if (available) pullPhotos() }, [available])
  // The admin switched photo storage off again, but this member's pictures are still on the
  // server. They cannot be shown or picked any more — but they can, and must be able to, go.
  if (!available) return user && !DEMO && kept > 0 ? <LeftBehind count={kept} /> : null
  const items = photos?.items || []
  const mine = bodyByPose(items, pose)
  const used = sizeText(photos?.used), quota = sizeText(photos?.quota)

  return <div className="card">
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{t('Progress photos')}</h2>
      <Button size="sm" icon="camera" onClick={() => addBodyPhotoSheet(pose)}>{t('Add')}</Button>
    </div>
    <div className="chips nt-chips" style={{ margin: '4px 0 10px' }}>
      {POSES.map(p => <button key={p} className={'chip' + (p === pose ? ' on' : '')} onClick={() => setPose(p)}>{poseName(p)}{bodyByPose(items, p).length > 0 && <span className="dim"> {bodyByPose(items, p).length}</span>}</button>)}
    </div>
    {!mine.length && <div className="muted small">{t('The same pose, the same light and the same distance every few weeks show what the scale and the tape do not.')}</div>}
    {mine.length > 0 && <div className="ph-strip">
      {[...mine].reverse().map(p => <button key={p.id} className="ph-cell" onClick={() => photoSheet(p, poseName(p.pose) + ' · ' + fmtDate(p.d, true, true))}>
        <Photo id={p.id} thumb alt={poseName(p.pose) + ', ' + fmtDate(p.d, false, true)} className="ph-thumb" />
        <span>{fmtDate(p.d, false, true)}</span>
      </button>)}
    </div>}
    {mine.length > 1 && <><div style={{ height: 10 }} /><Button icon="columns" onClick={() => compareSheet(pose)}>{t('Compare')}</Button></>}
    <div className="dim small" style={{ marginTop: 10 }}>
      {photos && photos.quota > 0 && <>{t('{0} {1} of {2} {3} used.', fmtNum(used.n), used.unit, fmtNum(quota.n), quota.unit)} </>}
      {t('Photos are kept on this server as files, not encrypted: whoever runs the server can open them.')}
    </div>
  </div>
}

function LeftBehind({ count }) {
  const remove = () => confirmSheet({
    title: t('Delete your stored photos?'), message: t('All {0} are removed from the server and cannot be brought back.', count), confirmText: t('Delete'), danger: true,
    onConfirm: async () => {
      try { await clearAllPhotos(); useUI.getState().toast(t('Photos deleted')) }
      catch { useUI.getState().toast(t('Could not delete the photos. Check the connection and try again.')) }
    }
  })
  return <div className="card">
    <h2 style={{ margin: 0 }}>{t('Progress photos')}</h2>
    <div className="muted small" style={{ margin: '6px 0 10px', lineHeight: 1.45 }}>{t('Photo storage is switched off on this server, but {0} of your photos are still kept there.', count)}</div>
    <Button variant="danger" icon="trash" onClick={remove}>{t('Delete them')}</Button>
  </div>
}

// Before the shot: which pose, which day, how to make it comparable — and the last picture of
// that pose, which is the best instruction there is.
function AddSheet({ pose: firstPose, close }) {
  // The selector returns what is in the store or nothing — never a fresh [] of its own, which
  // would look like a change on every read and re-render without end.
  const items = useStore(s => s.photos?.items) || NONE
  const [pose, setPose] = useState(firstPose)
  const [d, setD] = useState(todayISO())
  const [busy, setBusy] = useState(false)
  const camera = useRef(null), gallery = useRef(null)
  const last = bodyByPose(items, pose).at(-1)
  // One way in for a picture, wherever it came from. Throws again after saying what went wrong,
  // so the in-app camera can keep its shot on screen for another try.
  const save = async file => {
    setBusy(true)
    try {
      await addPhoto(file, { kind: 'body', d: d && d <= todayISO() ? d : todayISO(), pose })
      useUI.getState().toast(t('Photo saved'))
      close()
    } catch (e) { useUI.getState().toast(photoError(e)); setBusy(false); throw e }
  }
  const onFile = ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (file) save(file).catch(() => {})
  }
  // The viewfinder inside the app: the last photo of this pose over the live camera, and a
  // self-timer. Offered where the browser can open a camera into the page; the system camera
  // and the library stay below it either way.
  const inApp = cameraAvailable()
  const shoot = () => useUI.getState().openSheet(c => <GhostCamera ghost={last || null} onShot={save} close={c} />)
  return <>
    <h3>{t('Progress photo')}</h3>
    <div className="chips nt-chips" style={{ margin: '4px 0 12px' }}>
      {POSES.map(p => <button key={p} className={'chip' + (p === pose ? ' on' : '')} disabled={busy} onClick={() => setPose(p)}>{poseName(p)}</button>)}
    </div>
    {last && <div className="ph-prev">
      <Photo id={last.id} thumb alt={t('Last time')} className="ph-thumb" />
      <div>
        <div>{t('Last time')}: {fmtDate(last.d, true, true)}</div>
        <div className="muted small">{t('Stand the same way, at the same distance, in the same light.')}</div>
      </div>
    </div>}
    {!last && <div className="muted small" style={{ marginBottom: 12 }}>{t('Stand relaxed, the whole torso in the frame, the light in front of you. Remember the spot: the next photo is taken from there.')}</div>}
    <div className="row between" style={{ marginBottom: 14 }}>
      <div className="sect-t" style={{ margin: 0 }}>{t('Date')}</div>
      <input type="date" className="timef" value={d} max={todayISO()} aria-label={t('Date')} disabled={busy} onChange={e => setD(e.target.value)} />
    </div>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
    <input ref={gallery} type="file" accept="image/*" hidden onChange={onFile} />
    {busy ? <div className="nt-busy"><Icon name="camera" />{t('Saving the photo…')}</div> : <>
      {inApp && <>
        <Button variant="primary" icon="columns" onClick={shoot}>{last ? t('Line up with the last photo') : t('Camera with a self-timer')}</Button>
        <div style={{ height: 8 }} />
      </>}
      <Button variant={inApp ? 'plain' : 'primary'} icon="camera" onClick={() => camera.current.click()}>{t('Take a photo')}</Button>
      <div style={{ height: 8 }} />
      <Button icon="image" onClick={() => gallery.current.click()}>{t('Choose from library')}</Button>
    </>}
    {inApp && last && <div className="dim small" style={{ marginTop: 12 }}>{t('“Line up with the last photo” shows it over the camera, half transparent, so you can stand exactly as you did then.')}</div>}
    <div className="dim small" style={{ marginTop: 12 }}>{t('The photo is made smaller on this device and its location data is removed before it is sent.')}</div>
  </>
}
export const addBodyPhotoSheet = (pose = 'front') => useUI.getState().openSheet(close => <AddSheet pose={pose} close={close} />)

function weightLine(S, p) {
  const w = nearestWeight(S, p.d)
  return w ? `${fmtNum(w.w)} ${S.unit}` : null
}

// One stored photo, full size, with the way to delete it. `title` is the caller's: a pose and a
// date for a body photo, a meal and a date for a meal photo.
function PhotoSheet({ photo, title, close }) {
  const S = useStore(s => s.S)
  const remove = () => confirmSheet({
    title: t('Delete this photo?'), message: t('It is removed from the server and cannot be brought back.'), confirmText: t('Delete'), danger: true,
    onConfirm: async () => {
      try { await removePhotos([photo.id]); close() }
      catch (e) { useUI.getState().toast(photoError(e)) }
    }
  })
  return <>
    <h3>{title}</h3>
    {photo.kind === 'body' && weightLine(S, photo) && <div className="muted small" style={{ marginBottom: 8 }}>{t('Body weight')}: {weightLine(S, photo)}</div>}
    <Photo id={photo.id} alt={title} className="ph-full" />
    <div style={{ height: 12 }} />
    <Button variant="danger" icon="trash" onClick={remove}>{t('Delete')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}
export const photoSheet = (photo, title) => useUI.getState().openSheet(close => <PhotoSheet photo={photo} title={title} close={close} />)

// Two pictures of one pose side by side: the first and the latest to begin with, each side
// steppable through the whole series.
function CompareSheet({ pose, close }) {
  const S = useStore(s => s.S)
  // The selector returns what is in the store or nothing — never a fresh [] of its own, which
  // would look like a change on every read and re-render without end.
  const items = useStore(s => s.photos?.items) || NONE
  const pair = comparePair(items, pose)
  const [a, setA] = useState(0)
  const [b, setB] = useState(pair ? pair.all.length - 1 : 0)
  if (!pair) return <><h3>{t('Compare')}</h3><Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button></>
  const all = pair.all
  const left = all[Math.min(a, all.length - 1)], right = all[Math.min(b, all.length - 1)]
  const days = daysBetween(left.d, right.d)
  const wl = nearestWeight(S, left.d), wr = nearestWeight(S, right.d)
  const side = (p, i, set) => <div className="ph-side">
    <Photo id={p.id} alt={fmtDate(p.d, false, true)} className="ph-half" />
    <div className="row between ph-nav">
      <button className="iconbtn" aria-label={t('Earlier')} disabled={i <= 0} onClick={() => set(i - 1)}><Icon name="chevronLeft" /></button>
      <span className="small">{fmtDate(p.d, false, true)}</span>
      <button className="iconbtn" aria-label={t('Later')} disabled={i >= all.length - 1} onClick={() => set(i + 1)}><Icon name="chevronRight" /></button>
    </div>
    {weightLine(S, p) && <div className="dim small" style={{ textAlign: 'center' }}>{weightLine(S, p)}</div>}
  </div>
  return <>
    <h3>{poseName(pose)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>
      {days === 0 ? t('The same day') : t('{0} days apart', Math.abs(days))}
      {wl && wr && wl.d !== wr.d && <> · {t('Body weight')}: {(wr.w - wl.w > 0 ? '+' : '') + fmtNum(Math.round((wr.w - wl.w) * 10) / 10)} {S.unit}</>}
    </div>
    <div className="ph-cmp">{side(left, Math.min(a, all.length - 1), setA)}{side(right, Math.min(b, all.length - 1), setB)}</div>
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}
const compareSheet = pose => useUI.getState().openSheet(close => <CompareSheet pose={pose} close={close} />)
