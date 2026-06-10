// Primitives UI portées du prototype Kertios Chat (primitives.jsx + widget.jsx).
// Icônes : lucide-react, même librairie qu'ao_scrapping.
import { ReactNode } from 'react'
import { AlertTriangle, Pause } from 'lucide-react'

export function Card({ children, className = '', nopad = false, style, onClick }: {
  children: ReactNode; className?: string; nopad?: boolean; style?: React.CSSProperties; onClick?: () => void
}) {
  return <div className={`card ${nopad ? 'nopad' : ''} ${className}`} style={style} onClick={onClick}>{children}</div>
}

export function SectionTitle({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <div className="section-title">{children}</div>
        {sub && <div className="section-sub">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

export type Tone = 'acc' | 'go' | 'warn' | 'danger' | 'mut' | 'info'

export function Chip({ children, tone = 'acc' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`chip chip-${tone}`}>{children}</span>
}

export function Btn({ children, kind = 'primary', small = false, onClick, disabled, style, type = 'button' }: {
  children: ReactNode; kind?: 'primary' | 'ghost' | 'soft' | 'danger'; small?: boolean
  onClick?: (e: React.MouseEvent) => void; disabled?: boolean; style?: React.CSSProperties
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} className={`btn btn-${kind} ${small ? 'small' : ''}`} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  )
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} disabled={disabled}
            onClick={() => !disabled && onChange(!on)}>
      <span className="knob" />
    </button>
  )
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </label>
  )
}

export function Seg({ options, value, onChange, small = false }: {
  options: ({ value: string; label: ReactNode } | string)[]
  value: string; onChange: (v: string) => void; small?: boolean
}) {
  return (
    <div className={`seg ${small ? 'small' : ''}`}>
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.value
        const lab = typeof o === 'string' ? o : o.label
        return <button key={v} className={v === value ? 'active' : ''} onClick={() => onChange(v)}>{lab}</button>
      })}
    </div>
  )
}

export function Stat({ label, value, delta, deltaTone = 'go', sub, icon }: {
  label: ReactNode; value: ReactNode; delta?: ReactNode; deltaTone?: Tone; sub?: ReactNode; icon?: ReactNode
}) {
  return (
    <Card className="stat-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="stat-label">{label}</div>
        {icon && <span style={{ fontSize: 15, opacity: .8 }}>{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        {delta && <Chip tone={deltaTone}>{delta}</Chip>}
        {sub && <span className="sub">{sub}</span>}
      </div>
    </Card>
  )
}

export function Meter({ pct, tone = 'acc', height = 8 }: { pct: number; tone?: 'acc' | 'warn' | 'danger'; height?: number }) {
  return (
    <div className={`meter ${tone !== 'acc' ? tone : ''} ${height === 5 ? 'h5' : height === 6 ? 'h6' : ''}`}>
      <div style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

export function Divider() {
  return <div className="divider" />
}

export function InfoBox({ children, tone = 'info', title }: { children: ReactNode; tone?: 'info' | 'warn' | 'danger' | 'go'; title?: ReactNode }) {
  return (
    <div className={`infobox ${tone}`}>
      {title && <div className="ib-title">{title}</div>}
      {children}
    </div>
  )
}

// Mini bar chart empilé (IA vs Arbre), sans lib — porté de Bars (primitives.jsx)
export function Bars({ data, height = 120 }: {
  data: { label: string; a: number; b?: number }[]; height?: number
}) {
  const max = Math.max(1, ...data.map(d => d.a + (d.b || 0)))
  return (
    <div className="bars" style={{ height }}>
      {data.map((d, i) => {
        const hA = Math.round((d.a / max) * (height - 22))
        const hB = Math.round(((d.b || 0) / max) * (height - 22))
        return (
          <div key={i} className="bar-col" title={`${d.label} — IA ${d.a} · Arbre ${d.b || 0}`}>
            <div className="bar-stack">
              <div style={{ height: hA, background: 'var(--acc)' }} />
              <div style={{ height: hB, background: 'var(--acc-bd)' }} />
            </div>
            <div className="bar-lbl">{d.label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Icônes de bulle configurables (widget.jsx) ----------
export function BubbleIcon({ kind, size = 26, avatarImg }: { kind?: string; size?: number; avatarImg?: string | null }) {
  const s: React.CSSProperties = { width: size, height: size, display: 'block' }
  if (kind === 'image' && avatarImg) {
    return <img src={avatarImg} alt="" style={{ ...s, borderRadius: '35%', objectFit: 'cover' }} />
  }
  if (kind === 'spark') {
    return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" fill="currentColor" stroke="none" />
        <circle cx="19" cy="5" r="1.6" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'help') {
    return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9.2" fill="none" />
        <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.9c-.8.35-1 .9-1 1.7" fill="none" />
        <circle cx="12" cy="16.8" r="1.15" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  return (
    <svg style={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3C7 3 3 6.6 3 11c0 2.2 1 4.2 2.7 5.6-.1 1-.5 2.1-1.4 3 1.7-.1 3.1-.7 4.1-1.4 1.1.4 2.3.7 3.6.7 5 0 9-3.6 9-7.9S17 3 12 3z" />
    </svg>
  )
}

// ---------- Chips de statut / mode (pages-bots-list.jsx) ----------
export function statusChip(isActive: boolean, degraded = false) {
  if (!isActive) return <Chip tone="mut"><Pause size={11} /> En pause</Chip>
  if (degraded) return <Chip tone="warn"><AlertTriangle size={11} /> Dégradé</Chip>
  return <Chip tone="go">● En ligne</Chip>
}

export function modeChip(mode: string) {
  if (mode === 'tree') return <Chip tone="mut">Arbre</Chip>
  if (mode === 'ai') return <Chip tone="acc">IA</Chip>
  return <Chip tone="acc">Hybride</Chip>
}

// Dégradé de marque d'un bot (design_json)
export function brandBg(design: Record<string, any>) {
  const c1 = design?.primaryColor || '#0d9488'
  const c2 = design?.secondaryColor
  return c2 ? `linear-gradient(135deg, ${c1}, ${c2})` : c1
}

// Avatar d'organisation : initiales + couleur stable dérivée du nom
const ORG_COLORS = ['#0d9488', '#4f46e5', '#0e7490', '#7c3aed', '#b45309', '#be185d']
export function orgInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
}
export function orgColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ORG_COLORS[h % ORG_COLORS.length]
}
