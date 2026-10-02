import { useEffect, useState } from 'react'
import { acquire, release } from '../lib/photo-urls.js'

/**
 * The object URL of one stored photo, or null until it has arrived (and for good if it cannot
 * be fetched). Fetched with the session (lib/photo-urls.js) — never an address an <img> could be
 * pointed at directly, which a paired phone could not authenticate. No id, no request.
 */
export function usePhotoUrl(id, thumb = false) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!id) return
    let gone = false
    setUrl(null)
    acquire(id, thumb).then(u => { if (!gone) setUrl(u) }).catch(() => {})
    return () => { gone = true; release(id, thumb) }
  }, [id, thumb])
  return id ? url : null
}

/**
 * One stored photo. Renders an empty box of the same shape until the picture arrives, and stays
 * one if it cannot be fetched.
 */
export default function Photo({ id, thumb = false, alt = '', className = '', onClick }) {
  const url = usePhotoUrl(id, thumb)
  const cls = 'ph ' + className
  if (!url) return <div className={cls + ' ph-wait'} aria-label={alt} role="img" onClick={onClick} />
  return <img className={cls} src={url} alt={alt} onClick={onClick} draggable={false} />
}
