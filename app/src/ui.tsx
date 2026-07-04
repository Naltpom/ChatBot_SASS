import { Children, Fragment, isValidElement, ReactNode, useEffect, useId, useRef } from 'react'
import { Pause } from 'lucide-react'
import type { BotBillingStatus, DesignJson } from './types/bot'

export function Card({ children, className = '', nopad = false, style, onClick }: {
  children: ReactNode; className?: string; nopad?: boolean; style?: React.CSSProperties; onClick?: () => void
}) {
  // Card cliquable = opérable au clavier (role button, Enter/Espace). Le test
  // e.target === e.currentTarget évite de déclencher l'ouverture quand la
  // touche vient d'un contrôle interne (bouton copier, menu, input).
  const interactive = onClick ? {
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        onClick()
      }
    },
  } : {}
  return (
    <div className={`card ${nopad ? 'nopad' : ''} ${className}`} style={style} onClick={onClick} {...interactive}>
      {children}
    </div>
  )
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

// Local au module (aucun import externe) — gouverne tone/deltaTone des Chip/Stat.
type Tone = 'acc' | 'go' | 'warn' | 'danger' | 'mut' | 'info'

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

export function Toggle({ on, onChange, disabled, label }: {
  on: boolean; onChange: (v: boolean) => void; disabled?: boolean
  // `label` : nom accessible (a11y). Le bouton n'a aucun texte visible, donc sans
  // lui un lecteur d'écran annonce un interrupteur anonyme. À renseigner avec le
  // libellé visible adjacent (toggle-row .tl, etc.).
  label?: string
}) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} role="switch"
            aria-checked={on} aria-label={label} disabled={disabled}
            onClick={() => !disabled && onChange(!on)}>
      <span className="knob" />
    </button>
  )
}

// ---------- Modale accessible (role=dialog) ----------
// Sélecteur des éléments focalisables d'une boîte de dialogue (piège à focus).
const DIALOG_FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Hook a11y de boîte de dialogue : focus à l'ouverture, piège à focus (Tab boucle),
// Échap ferme (via onClose), restauration du focus au déclencheur à la fermeture.
// Retourne une ref à poser sur le conteneur du dialogue (qui doit avoir tabIndex=-1).
// Pensé pour être consommé par <Modal> ET par des modales au markup sur-mesure.
export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(onClose?: () => void) {
  const ref = useRef<T>(null)
  // Ref vers le dernier onClose : évite de relancer l'effet (et de re-voler le
  // focus) à chaque rendu quand l'appelant passe une closure recréée.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)).filter(el => el.offsetParent !== null)
    // Focus initial : 1er contrôle, sinon le conteneur lui-même.
    ;(focusables()[0] ?? node).focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); return }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) { e.preventDefault(); node!.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === node)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
    // onClose passé via ref : dépendances vides => effet monté une seule fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return ref
}

// Boîte de dialogue modale réutilisable. Overlay + carte centrée, sémantique
// role="dialog" + aria-modal + titre relié (aria-labelledby). Le piège à focus,
// le focus à l'ouverture, Échap et le retour de focus sont gérés par useDialogA11y.
// `onClose` (Échap) : passer `undefined` pour neutraliser la fermeture (ex. action
// en cours). Le clic sur l'overlay ne ferme PAS.
export function Modal({ title, onClose, children, maxWidth = 460 }: {
  title: ReactNode; onClose?: () => void; children: ReactNode; maxWidth?: number
}) {
  const titleId = useId()
  const ref = useDialogA11y<HTMLDivElement>(onClose)
  return (
    <div className="modal-overlay">
      <div ref={ref} className="modal-card" style={{ maxWidth }}
           role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

// Un <label> implicite s'associe au PREMIER élément labelable du sous-arbre :
// si c'est un bouton (Seg, ColorDots, icon-pick…), le titre du Field écrase
// son nom accessible et un clic sur le titre le déclenche. On ne rend donc un
// <label> que si le premier contrôle rencontré dans le JSX statique est un
// input/select/textarea NATIF ; bouton, <label> imbriqué ou composant opaque
// (Seg, Chip, Btn…) → wrapper <div role="group"> nommé via aria-labelledby.
function labelIsSafe(node: ReactNode): boolean | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue
    const t = child.type
    const kids = (child.props as { children?: ReactNode })?.children
    if (t === Fragment) {
      const r = labelIsSafe(kids)
      if (r !== null) return r
      continue
    }
    if (typeof t !== 'string') return false // composant : contenu inconnu, prudence
    if (t === 'input' || t === 'select' || t === 'textarea') return true
    if (t === 'button' || t === 'label') return false
    const r = labelIsSafe(kids)
    if (r !== null) return r
  }
  return null
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const id = useId()
  if (labelIsSafe(children)) {
    return (
      <label style={{ display: 'block' }}>
        <span className="field-label">{label}</span>
        {children}
        {hint && <div className="field-hint">{hint}</div>}
      </label>
    )
  }
  return (
    <div role="group" aria-labelledby={id}>
      <span className="field-label" id={id}>{label}</span>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
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
        return <button type="button" key={v} className={v === value ? 'active' : ''}
                       aria-pressed={v === value} onClick={() => onChange(v)}>{lab}</button>
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
    <div className={`meter ${tone !== 'acc' ? tone : ''} ${height === 6 ? 'h6' : ''}`}>
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

// Mini bar chart empilé (IA vs Arbre par défaut), sans lib. aLabel/bLabel ne
// changent que le tooltip.
export function Bars({ data, height = 120, aLabel = 'IA', bLabel = 'Arbre' }: {
  data: { label: string; a: number; b?: number }[]; height?: number; aLabel?: string; bLabel?: string
}) {
  const max = Math.max(1, ...data.map(d => d.a + (d.b || 0)))
  return (
    <div className="bars" style={{ height }}>
      {data.map((d, i) => {
        const hA = Math.round((d.a / max) * (height - 22))
        const hB = Math.round(((d.b || 0) / max) * (height - 22))
        return (
          <div key={i} className="bar-col" title={`${d.label} — ${aLabel} ${d.a} · ${bLabel} ${d.b || 0}`}>
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

// ---------- Icônes de bulle configurables ----------
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
  // Icônes étendues — doivent rester identiques au dict SVG de widget/widget.js
  // (parité de rendu).
  if (kind === 'bot') {
    return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
      </svg>
    )
  }
  if (kind === 'message') {
    return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    )
  }
  if (kind === 'headset') {
    return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
        <rect x="2.5" y="13" width="4" height="7" rx="1.6" />
        <rect x="17.5" y="13" width="4" height="7" rx="1.6" />
      </svg>
    )
  }
  if (kind === 'smile') {
    return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8" />
        <path d="M9 9.5h.01M15 9.5h.01" />
      </svg>
    )
  }
  if (kind === 'zap') {
    return (
      <svg style={s} viewBox="0 0 24 24" fill="currentColor">
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
      </svg>
    )
  }
  return (
    <svg style={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3C7 3 3 6.6 3 11c0 2.2 1 4.2 2.7 5.6-.1 1-.5 2.1-1.4 3 1.7-.1 3.1-.7 4.1-1.4 1.1.4 2.3.7 3.6.7 5 0 9-3.6 9-7.9S17 3 12 3z" />
    </svg>
  )
}

// ---------- Chips de statut / mode ----------
export function statusChip(isActive: boolean) {
  if (!isActive) return <Chip tone="mut"><Pause size={11} /> En pause</Chip>
  return <Chip tone="go">● En ligne</Chip>
}

// Chip de FACTURATION d'un bot — DISTINCT de statusChip (widget on/off). Un bot
// peut être is_active=true tout en étant 'inactive' côté paiement (« Paiement
// requis »). Réutilise la primitive Chip. Rien à afficher si billing OFF
// (status null/undefined), 'active' (payé, état nominal — pas de bruit visuel)
// ou 'trialing' (statut LEGACY résiduel, traité comme actif — plus de badge essai).
//   - 'inactive'  -> « Paiement requis » (danger) : Checkout annulé/abandonné ou résilié.
//   - 'past_due'  -> « Impayé » (warn) : abonnement en relance.
//   - 'suspended' -> « Bloqué » (danger) : blocage admin (abus). Widget coupé.
// `trialEnd` : param LEGACY conservé pour la signature des appelants (plus utilisé).
export function billingChip(status?: BotBillingStatus | null, trialEnd?: number | null) {
  void trialEnd
  if (!status || status === 'active' || status === 'trialing') return null
  if (status === 'inactive') return <Chip tone="danger">Paiement requis</Chip>
  if (status === 'past_due') return <Chip tone="warn">Impayé</Chip>
  if (status === 'suspended') return <Chip tone="danger">Bloqué</Chip>
  return null
}

export function modeChip(mode: string) {
  if (mode === 'tree') return <Chip tone="mut">Arbre</Chip>
  if (mode === 'ai') return <Chip tone="acc">IA</Chip>
  return <Chip tone="acc">Hybride</Chip>
}

// Dégradé de marque d'un bot (design_json)
export function brandBg(design: DesignJson | null | undefined) {
  const c1 = design?.primaryColor || '#1C3F5C'
  const c2 = design?.secondaryColor
  return c2 ? `linear-gradient(135deg, ${c1}, ${c2})` : c1
}

// Avatar d'organisation : initiales + couleur stable dérivée du nom.
// Palette alignée sur la charte Chapote : navy, mint, violet IA, corail humain
// + deux nuances complémentaires sobres.
const ORG_COLORS = ['#1C3F5C', '#2F9E79', '#8C6DFF', '#E86A5F', '#2563EB', '#15344b']
export function orgInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
}
export function orgColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ORG_COLORS[h % ORG_COLORS.length]
}
