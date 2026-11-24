// Petits composants partagés : marque, messages, fenêtre, interrupteur, dates.
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

/** Chapeau Chapote (même marque que chapote.fr et cm.chapote.fr). */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6.5" fill="#1d1d1f" />
      <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" />
        <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" />
      </g>
    </svg>
  )
}

export function Brand({ to }: { to?: string }) {
  const inner = <><BrandMark size={28} /><span>Chapote Emails</span></>
  return to !== undefined ? <Link to={to} className="brand">{inner}</Link> : <span className="brand">{inner}</span>
}

export function Msg({ kind = 'info', children }: { kind?: 'err' | 'info' | 'ok' | 'warn'; children: ReactNode }) {
  return <div className={`msg msg-${kind}`} role={kind === 'err' ? 'alert' : 'status'}>{children}</div>
}

export function Toggle({ checked, onChange, label, hint, disabled }:
  { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span /></span>
      <span className="col" style={{ gap: 2 }}>
        <span>{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
    </label>
  )
}

/** Fenêtre centrée (feuille pleine largeur sur mobile). Échap et clic à côté ferment. */
export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    box.current?.focus()
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.() }
  }, [])
  return createPortal(
    <div className="sheet-back" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" ref={box} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="sheet-title">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Fermer" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

const DT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
export function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : DT.format(d)
}

export function Skeleton({ h = 72, n = 1 }: { h?: number; n?: number }) {
  return <>{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} aria-hidden="true" />)}</>
}
