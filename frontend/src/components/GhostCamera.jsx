import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { beep } from '../lib/sound.js'
import { TIMERS, frameAspect, isMirrored, cameraConstraints, captureFrame } from '../lib/ghost.js'
import { usePhotoUrl } from './Photo.jsx'
import Icon from './Icon.jsx'
import { Button, Segmented } from './ui.jsx'

/**
 * A viewfinder inside the app, for a progress photo taken against the last one: the previous
 * picture of the pose lies over the live camera, half transparent, and the frame has that
 * picture's shape (lib/ghost.js has the why). A self-timer, because the phone is usually propped
 * against something and the person has to step back into the frame.
 *
 * `ghost` is the previous photo's row, or null — the camera and its timer work without one.
 * `onShot(file)` gets the picture once the person has looked at it and kept it; the caller
 * stores it. Nothing is stored or sent from here.
 *
 * A denied or missing camera is said in place, with the way back: the sheet this opened from
 * still offers the system camera and the library.
 */
export default function GhostCamera({ ghost, onShot, close }) {
  const sound = useStore(s => s.S.sound)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [want, setWant] = useState('user')            // which camera is asked for
  const [facing, setFacing] = useState('user')        // which one the stream says it is
  const [error, setError] = useState(null)            // 'denied' | 'unavailable'
  const [live, setLive] = useState(false)             // the stream is delivering frames
  const [opacity, setOpacity] = useState(40)
  const [delay, setDelay] = useState(3)
  const [count, setCount] = useState(null)            // seconds left on a running timer
  const [shot, setShot] = useState(null)              // { file, url } — taken, not yet kept
  const [busy, setBusy] = useState(false)
  const aspect = frameAspect(ghost)
  const ghostUrl = usePhotoUrl(ghost?.id)

  // The camera: opened for the side asked for, closed when the sheet goes or the side changes.
  useEffect(() => {
    let gone = false
    setLive(false)
    const stop = () => { streamRef.current?.getTracks().forEach(tr => tr.stop()); streamRef.current = null }
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setError('unavailable'); return }
      let stream
      try { stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(want)) }
      catch (e) { if (!gone) setError(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable'); return }
      if (gone) { stream.getTracks().forEach(tr => tr.stop()); return }
      streamRef.current = stream
      setError(null)
      setFacing(stream.getVideoTracks?.()[0]?.getSettings?.().facingMode || want)
      const v = videoRef.current
      if (!v) return
      v.srcObject = stream
      try { await v.play() } catch { /* autoplay policy: the frame arrives on its own */ }
      if (!gone) setLive(true)
    })()
    return () => { gone = true; stop() }
  }, [want])

  // The preview of a shot is an object URL: give it back when it is replaced or the sheet goes.
  useEffect(() => () => { if (shot?.url) URL.revokeObjectURL(shot.url) }, [shot])

  // The self-timer: one tick a second, a short beep on each, the picture at zero.
  useEffect(() => {
    if (count === null) return
    if (count <= 0) { setCount(null); take(); return }
    beep(sound, 880, 0.07)
    const timer = setTimeout(() => setCount(c => (c === null ? null : c - 1)), 1000)
    return () => clearTimeout(timer)
  }, [count])

  const take = async () => {
    try {
      const file = await captureFrame(videoRef.current, aspect)
      beep(sound, 1320, 0.12)
      setShot({ file, url: URL.createObjectURL(file) })
    } catch { /* no frame yet: the button is still there to press again */ }
  }
  const press = () => { if (delay > 0) setCount(delay); else take() }
  const keep = async () => {
    setBusy(true)
    try { await onShot(shot.file); close() } catch { setBusy(false) }
  }

  if (error) return <>
    <h3>{t('Camera')}</h3>
    <div className="muted small" style={{ marginBottom: 16, lineHeight: 1.5 }}>
      {error === 'denied'
        ? t('Camera access was denied — allow it in your browser and try again.')
        : t('The camera cannot be opened inside the app here. Go back and use “Take a photo” instead.')}
    </div>
    <Button variant="tinted" onClick={close}>{t('Back')}</Button>
  </>

  const box = { aspectRatio: String(aspect), width: `min(100%, calc(58vh * ${aspect}))` }
  return <>
    <h3>{ghost ? t('Line up with the last photo') : t('Camera')}</h3>
    <div className={'gc-view' + (isMirrored(facing) && !shot ? ' mirror' : '')} style={box}>
      {/* playsInline keeps iOS from going full-screen; muted satisfies autoplay rules. */}
      <video ref={videoRef} playsInline muted autoPlay style={shot ? { visibility: 'hidden' } : undefined} />
      {shot && <img className="gc-shot" src={shot.url} alt="" />}
      {!shot && ghostUrl && opacity > 0 && <img className="gc-ghost" src={ghostUrl} alt="" style={{ opacity: opacity / 100 }} />}
      {count !== null && <div className="gc-count" aria-live="assertive">{count}</div>}
    </div>

    {shot ? <>
      <div style={{ height: 14 }} />
      {busy ? <div className="nt-busy"><Icon name="camera" />{t('Saving the photo…')}</div> : <>
        <Button variant="primary" onClick={keep}>{t('Save')}</Button>
        <div style={{ height: 8 }} />
        <Button onClick={() => setShot(null)}>{t('Retake')}</Button>
      </>}
    </> : <>
      {ghost && <label className="gc-row">
        <span>{t('Last photo over the camera')}</span>
        <input type="range" min="0" max="80" step="5" value={opacity} aria-label={t('Last photo over the camera')} onChange={e => setOpacity(+e.target.value)} />
      </label>}
      <div className="gc-row">
        <span>{t('Self-timer')}</span>
        <Segmented className="seg-inline" options={TIMERS.map(s => ({ value: s, label: s ? t('{0} s', s) : t('Off') }))} value={delay} onChange={setDelay} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="primary" icon="camera" style={{ flex: 1 }} disabled={!live || count !== null} onClick={press}>{count !== null ? t('Get ready…') : t('Take the photo')}</Button>
        <button className="iconbtn" aria-label={t('Switch camera')} disabled={count !== null} onClick={() => setWant(isMirrored(facing) ? 'environment' : 'user')}><Icon name="shuffle" /></button>
      </div>
      {count !== null && <><div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => setCount(null)}>{t('Cancel')}</Button></>}
    </>}
  </>
}
