import type { ReactNode } from 'react'
import { PLATFORM_LABEL, type Platform, type TargetStatus } from '../api'
import { STATUS } from '../format'

export function PlatformTag({ platform, label }: { platform: Platform; label?: string }) {
  return <span className="ptag"><span aria-hidden="true" className={`dot dot-${platform}`} />{label ?? PLATFORM_LABEL[platform]}</span>
}

export function StatusText({ status }: { status: TargetStatus }) {
  const s = STATUS[status]
  return <span className={`status status-${s.tone}`}>{s.label}</span>
}

export function Msg({ kind = 'info', children }: { kind?: 'err' | 'info' | 'ok'; children: ReactNode }) {
  return <div className={`msg msg-${kind}`} role={kind === 'err' ? 'alert' : 'status'}>{children}</div>
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return <p className="muted small" role="status">{label}</p>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '36px 20px' }}>
      <h2>{title}</h2>
      {children && <div className="muted" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  )
}

export function Seg<T extends string | number>({ value, options, onChange, label }:
  { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  )
}

export function Avatar({ src, name }: { src: string | null | undefined; name: string | null | undefined }) {
  if (src) return <img className="avatar" src={src} alt="" referrerPolicy="no-referrer" />
  return (
    <span className="avatar" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
      {(name || '?').replace('@', '').slice(0, 1).toUpperCase()}
    </span>
  )
}

export function Icon({ name }: { name: 'left' | 'right' | 'upload' | 'refresh' | 'external' }) {
  const d = {
    left: 'M15 18l-6-6 6-6',
    right: 'M9 18l6-6-6-6',
    upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  }[name]
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  )
}
