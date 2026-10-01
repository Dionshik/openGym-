import { useEffect, useState } from 'react'
import { imgSrc, gifSrc, img2Src } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// Custom exercises have no media — the animation stays blank by design (issue #11).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12). Settings can also turn workout media off entirely
// (gifSize 'off') — then nothing renders here and the exercise card closes up, exactly like
// a custom exercise without media. Any other/legacy value behaves as 'full'.
//
// Some exercises have no animation but two photographs — the start and the end of the movement
// (`img`, `img2`). Those are shown the same way, flipping between the two; tap pauses on
// whichever is up. It is the same component rather than a second one so that everything above
// (size, minimise, the "off" setting, the fallback tile) applies to them unchanged.
const FRAME_MS = 1100

export default function Media({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  const [frame, setFrame] = useState(0)
  // 'gif' → the animation failed, the still is showing; 'all' → the still failed too. Media is
  // fetched from wherever the build points (a mount, a CDN): a dropped connection, an expired
  // session on a gated instance or a CDN hiccup used to leave the browser's broken-image glyph
  // on a white block. Now the still stands in for the animation, a neutral tile stands in for
  // both, and a tap tries again — no text, so nothing new to translate.
  const [failed, setFailed] = useState(null)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  const frames = !ex.gif && !!ex.img && !!ex.img2
  const absent = (!ex.gif && !frames) || (minimizable && gifSize === 'off')
  useEffect(() => {
    if (!frames || absent || !playing || failed) return
    const timer = setInterval(() => setFrame(f => 1 - f), FRAME_MS)
    return () => clearInterval(timer)
  }, [frames, absent, playing, failed])
  if (absent) return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const showGif = playing && failed == null
  // Two photographs have no still to fall back to: either both are there or neither is.
  const onError = () => setFailed(frames ? 'all' : showGif ? 'gif' : 'all')
  const src = frames ? (frame ? img2Src(ex) : imgSrc(ex)) : (showGif ? gifSrc(ex) : imgSrc(ex))
  const onTap = () => {
    if (failed) { setFailed(null); setPlaying(true); return }
    setPlaying(p => !p)
  }
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (failed === 'all' ? ' broken' : '')} id={id} onClick={onTap}>
      {failed === 'all'
        ? <div className="exmedia-x"><Icon name="dumbbell" /></div>
        : <img decoding="async" draggable={false} src={src} alt={exerciseNameFor(ex)} onError={onError} />}
      {/* The other photograph, loaded but not shown, so the first flip does not blink. */}
      {frames && !failed && <img className="exmedia-pre" aria-hidden="true" alt="" draggable={false} src={frame ? imgSrc(ex) : img2Src(ex)} onError={onError} />}
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && !failed && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

export function Thumb({ ex }) {
  // A picture that does not load is the placeholder, not the browser's broken-image glyph: an
  // instance that has not fetched its media yet should look unfinished, not broken. Keyed on
  // the file, so a list row reused for another exercise tries again.
  const [failedSrc, setFailedSrc] = useState(null)
  if (!ex.img || failedSrc === ex.img) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" draggable={false} src={imgSrc(ex)} alt="" onError={() => setFailedSrc(ex.img)} />
}
