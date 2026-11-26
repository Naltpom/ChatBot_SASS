// Miniature choisie dans la vidéo : un curseur fait défiler les images, celle affichée devient la miniature
// (TikTok : video_cover_timestamp_ms ; Instagram : thumb_offset, sauf image envoyée à part).
import { useEffect, useRef, useState } from 'react'

const FRAME = 1 / 30   // une image à 30 i/s

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60), r = s - m * 60
  return `${m}:${r.toFixed(2).padStart(5, '0')}`
}

export function FramePicker({ src, duration, value, onChange, disabled }: {
  src: string | null; duration: number | null; value: number | null; onChange: (ms: number | null) => void; disabled?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [len, setLen] = useState(duration || 0)
  const [t, setT] = useState(value != null ? value / 1000 : 0)
  useEffect(() => { if (duration) setLen(duration) }, [duration])
  useEffect(() => {
    const v = video.current
    if (v && Math.abs(v.currentTime - t) > 0.001) v.currentTime = t
  }, [t])
  const seek = (s: number) => {
    const x = Math.max(0, Math.min(len ? len - 0.05 : s, s))
    setT(x)
    if (value != null) onChange(Math.round(x * 1000))
  }
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row-nw" style={{ gap: 12, alignItems: 'flex-start' }}>
        {src ? (
          <video ref={video} src={src} muted playsInline preload="auto"
                 onLoadedMetadata={e => { if (!duration) setLen(e.currentTarget.duration); e.currentTarget.currentTime = t }}
                 style={{ width: 108, height: 192, objectFit: 'cover', borderRadius: 10, background: '#000', flex: 'none' }} />
        ) : <span aria-hidden="true" style={{ width: 108, height: 192, borderRadius: 10, background: 'var(--surface-2)', flex: 'none' }} />}
        <div className="col grow" style={{ gap: 8, minWidth: 0 }}>
          <span className="strong">{value != null ? `Image à ${fmtTime(value / 1000)}` : 'Choix automatique de la plateforme'}</span>
          <input type="range" min={0} max={Math.max(len - 0.05, 0)} step={FRAME} value={t} disabled={disabled || !len}
                 aria-label="Position de la miniature dans la vidéo" onChange={e => seek(Number(e.target.value))} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" disabled={disabled || !len} onClick={() => seek(t - FRAME)} aria-label="Image précédente">◀ image</button>
            <button type="button" className="btn btn-sm" disabled={disabled || !len} onClick={() => seek(t + FRAME)} aria-label="Image suivante">image ▶</button>
            <button type="button" className="btn btn-sm" disabled={disabled || !len} onClick={() => seek(0)}>Début</button>
            <button type="button" className="btn btn-sm" disabled={disabled || !len} onClick={() => seek(len)}>Fin</button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-primary" disabled={disabled || !len}
                    onClick={() => onChange(Math.round(t * 1000))}>{value != null && Math.round(t * 1000) === value ? 'Image choisie ✓' : 'Utiliser cette image'}</button>
            {value != null && <button type="button" className="btn btn-sm btn-ghost" disabled={disabled} onClick={() => onChange(null)}>Choix automatique</button>}
          </div>
          {!src && <span className="field-hint">Aperçu indisponible : réglez la position au curseur ({len ? fmtTime(t) : 'durée inconnue'}).</span>}
        </div>
      </div>
    </div>
  )
}
