import { createPortal } from 'react-dom'
import { PlatformLogo } from './PlatformLogo'
import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PLATFORM_LABEL, type GroupColor, type Platform, type TargetStatus } from '../api'
import { STATUS, signed } from '../format'
import { t } from '../i18n'

/** Chapeau Chapote (même marque que chapote.fr). */
/** Logo Chapote CM : trois cartes de vidéos verticales empilées, la première avec le bouton lecture,
 *  blanc sur la couleur de l'app (orange par défaut). Même dessin que l'icône d'onglet (public/favicon.svg) et que l'app mobile. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ width: size, height: size }}>
      <rect width="24" height="24" rx="6.2" style={{ fill: 'var(--logo, #F05A28)' }} />
      <rect x="5" y="6.2" width="7.4" height="12.2" rx="1.8" fill="#fff" opacity=".45" />
      <rect x="8.3" y="5.4" width="7.4" height="12.2" rx="1.8" fill="#fff" opacity=".7" />
      <rect x="11.6" y="4.6" width="7.4" height="12.8" rx="1.8" fill="#fff" />
      <path d="M14.3 8.8v4.6l3.6-2.3z" style={{ fill: 'var(--logo, #F05A28)' }} />
    </svg>
  )
}

export function Brand({ to }: { to?: string }) {
  const inner = <><BrandMark size={28} /><span>Chapote CM</span></>
  return to !== undefined ? <Link to={to} className="brand" aria-label={t('Chapote CM, accueil')}>{inner}</Link> : <span className="brand">{inner}</span>
}

export function PlatformTag({ platform, label }: { platform: Platform; label?: string | null }) {
  return <span className="ptag"><PlatformLogo platform={platform} size={14} /><span>{label ?? PLATFORM_LABEL[platform]}</span></span>
}

export function GroupDot({ color }: { color: GroupColor | null | undefined }) {
  return <span aria-hidden="true" className={`gdot g-${color || 'slate'}`} />
}

export function StatusText({ status }: { status: TargetStatus }) {
  const s = STATUS[status]
  return <span className={`status status-${s.tone}`}>{t(s.label)}</span>
}

export function Delta({ value, suffix = '' }: { value: number | null | undefined; suffix?: string }) {
  if (value == null) return null
  return <span className={value > 0 ? 'delta-up' : value < 0 ? 'delta-down' : 'muted'}>{signed(value)}{suffix}</span>
}

export function Msg({ kind = 'info', children }: { kind?: 'err' | 'info' | 'ok'; children: ReactNode }) {
  return <div className={`msg msg-${kind}`} role={kind === 'err' ? 'alert' : 'status'}>{children}</div>
}

export function Loading({ label = t('Chargement…') }: { label?: string }) {
  return <p className="muted small" role="status">{label}</p>
}

/** Blocs gris animés pendant le chargement (évite les sauts de mise en page). */
export function Skeleton({ h = 80, n = 1, style }: { h?: number; n?: number; style?: React.CSSProperties }) {
  return <>{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: h, ...style }} aria-hidden="true" />)}</>
}

export function Empty({ title, icon = 'calendar', children }: { title: string; icon?: IconName; children?: ReactNode }) {
  return (
    <div className="card empty">
      <span className="empty-ico"><Icon name={icon} size={24} /></span>
      <h2>{title}</h2>
      {children && <div className="muted" style={{ maxWidth: 460 }}>{children}</div>}
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

export function Avatar({ src, name, platform, size }: { src: string | null | undefined; name: string | null | undefined; platform?: Platform; size?: 'sm' }) {
  const cls = `avatar${size === 'sm' ? ' avatar-sm' : ''}`
  const img = src
    ? <img className={cls} src={src} alt="" referrerPolicy="no-referrer" loading="lazy" />
    : <span className={cls} aria-hidden="true">{(name || '?').replace('@', '').slice(0, 1).toUpperCase()}</span>
  if (!platform) return img
  return <span className="avatar-wrap">{img}<span className="pbadge"><PlatformLogo platform={platform} size={size === 'sm' ? 12 : 16} /></span></span>
}

/** Feuille qui monte du bas sur mobile, fenêtre centrée sur ordinateur. Échap et clic à côté ferment. */
export function Sheet({ title, onClose, children, labelledBy = 'sheet-title' }: { title: ReactNode; onClose: () => void; children: ReactNode; labelledBy?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  // Une seule fois à l'ouverture (onClose change à chaque rendu du parent : ne pas reprendre le focus).
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    box.current?.focus()
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.() }
  }, [])
  // Rendue dans <body> : un parent avec backdrop-filter / transform (barre du haut) servirait sinon de
  // repère au position: fixed, et la fenêtre serait coupée dans ce parent.
  return createPortal(
    <div className="sheet-back" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={box} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id={labelledBy}>{title}</h2>
          <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={t('Fermer')} onClick={onClose}><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export type IconName = 'left' | 'right' | 'down' | 'up' | 'upload' | 'refresh' | 'external' | 'home' | 'calendar' | 'chart'
  | 'users' | 'plus' | 'close' | 'video' | 'eye' | 'eye-off' | 'heart' | 'comment' | 'share' | 'bookmark' | 'check'
  | 'layers' | 'clock' | 'logout' | 'grid' | 'list' | 'trend' | 'edit' | 'trash' | 'bolt' | 'shield' | 'link' | 'menu' | 'search' | 'star' | 'settings' | 'folder' | 'info'

const PATHS: Record<IconName, string> = {
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9 6.75 19.6l1-5.8L3.5 9.7l5.9-.9z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  home: 'M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  video: 'M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM16 10l5-3v10l-5-3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  heart: 'M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z',
  comment: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  share: 'M17 2l4 4-4 4M3 12v-1a5 5 0 0 1 5-5h13M7 22l-4-4 4-4M21 12v1a5 5 0 0 1-5 5H3',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  menu: 'M4 7h16M4 12h16M4 17h16',
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d={PATHS[name]} /></svg>
  )
}
