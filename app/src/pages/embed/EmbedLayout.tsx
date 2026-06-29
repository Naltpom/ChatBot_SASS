// Cadre épuré des fenêtres embarquées (/embed/*) ouvertes par le plugin
// WordPress dans une iframe/popup : pas de chrome dashboard (ni Layout ni nav),
// juste un en-tête minimal optionnel + les états loading/erreur. Présentationnel.
import { CSSProperties, ReactNode } from 'react'

const NAVY = '#1C3F5C'
const MUT = '#6B7B8D'
const FAINT = '#9AA7B4'
const BORDER = '#E8ECF0'
const MINT = '#2F9E79'

interface Props {
  children?: ReactNode
  // En-tête minimal : titre (nom du bot) à gauche, slot d'actions/état à droite.
  title?: ReactNode
  right?: ReactNode
  // États de page : message d'erreur (remplace le contenu) / chargement.
  error?: string | null
  loading?: boolean
  loadingLabel?: string
}

const PAGE: CSSProperties = {
  fontFamily: "'Inter',system-ui,sans-serif",
  background: '#F9F9FB', color: NAVY, minHeight: '100vh',
  display: 'flex', flexDirection: 'column',
}

export default function EmbedLayout({ children, title, right, error, loading, loadingLabel }: Props) {
  if (error) {
    return (
      <div style={{ ...PAGE, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, padding: '28px 24px', boxShadow: '0 18px 50px -28px rgba(28,63,92,.3)' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Édition indisponible</div>
          <p style={{ fontSize: 13.5, color: MUT, lineHeight: 1.55, margin: 0 }}>{error}</p>
        </div>
      </div>
    )
  }
  if (loading) {
    return (
      <div style={{ ...PAGE, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ color: FAINT, fontSize: 13.5 }}>{loadingLabel || 'Chargement…'}</div>
      </div>
    )
  }
  return (
    <div style={PAGE}>
      {(title || right) && (
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 18px', background: 'rgba(249,249,251,.92)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${BORDER}`, position: 'sticky', top: 0, zIndex: 30 }}>
          <div style={{ minWidth: 0, fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>{right}</div>
        </header>
      )}
      <main style={{ flex: '1 1 auto', minHeight: 0, padding: '18px' }}>{children}</main>
    </div>
  )
}

// Petite pastille d'état (Enregistré / Modifié / Enregistrement…) réutilisée par
// les en-têtes d'éditeur embarqué.
export function StatusPill({ tone, children }: { tone: 'saved' | 'dirty' | 'busy'; children: ReactNode }) {
  const c = tone === 'saved' ? { bg: 'rgba(47,158,121,.12)', fg: '#1C7A5C' }
    : tone === 'dirty' ? { bg: 'rgba(232,168,46,.14)', fg: '#9A6A12' }
      : { bg: 'rgba(28,63,92,.08)', fg: NAVY }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 999, background: c.bg, color: c.fg }}>
      {children}
    </span>
  )
}

// Barre d'enregistrement (slot `right` de l'en-tête) : pastille d'état +
// bouton « Enregistrer ». Partagée par les éditeurs embarqués (arbre/apparence).
export function EmbedSaveBar({ saving, dirty, onSave }: { saving: boolean; dirty: boolean; onSave: () => void }) {
  return (
    <>
      {saving
        ? <StatusPill tone="busy">Enregistrement…</StatusPill>
        : dirty
          ? <StatusPill tone="dirty">● Modifié</StatusPill>
          : <StatusPill tone="saved">✓ Enregistré</StatusPill>}
      <button type="button" onClick={onSave} disabled={saving || !dirty}
              style={{
                background: dirty && !saving ? MINT : '#C7D0D9', color: '#fff', border: 'none',
                borderRadius: 10, padding: '8px 16px', fontSize: 13.5, fontWeight: 700,
                fontFamily: 'inherit', cursor: dirty && !saving ? 'pointer' : 'default',
              }}>
        Enregistrer
      </button>
    </>
  )
}

// Bannière d'erreur d'enregistrement (rendue en tête de contenu). No-op si pas
// de message.
export function SaveErrorBanner({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div style={{ marginBottom: 14, fontSize: 13, color: '#9A2820', background: '#FEF2F1', border: '1px solid #F8D7D3', borderRadius: 10, padding: '10px 13px' }}>
      {message}
    </div>
  )
}
