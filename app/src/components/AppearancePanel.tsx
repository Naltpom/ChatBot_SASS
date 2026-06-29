// Panneau d'apparence auto-suffisant : barre de sous-onglets (Couleurs / Lanceur
// / En-tête / Fenêtre / Conversation) + <AppearanceForm section=… />. Extrait de
// bot-tabs/AppearanceTab pour être PARTAGÉ entre l'onglet Apparence du dashboard
// et l'éditeur d'apparence embarqué (pages/embed/EmbedAppearance).
//
// CONTRÔLE : le `design` est piloté par le parent (remontée via onChange) ; le
// SEUL état local est le sous-onglet actif. `renderExtra(section)` est un point
// d'extension optionnel rendu SOUS le formulaire (AppearanceTab y branche la
// carte « Déclencheurs proactifs » pour la section Conversation, sans dupliquer
// l'état du sous-onglet).
import { ReactNode, useState } from 'react'
import AppearanceForm, { AppearanceSection } from './AppearanceForm'
import type { DesignJson } from '../types/bot'

// Sous-onglets PAR ZONE du widget (mêmes libellés/ordre que l'historique).
const AF_TABS: { value: AppearanceSection; label: string }[] = [
  { value: 'colors', label: 'Couleurs' },
  { value: 'launcher', label: 'Lanceur' },
  { value: 'header', label: 'En-tête' },
  { value: 'window', label: 'Fenêtre' },
  { value: 'conversation', label: 'Conversation' },
]

interface Props {
  design: DesignJson
  botName: string
  onChange: (partial: Partial<DesignJson>) => void
  // Renommage du bot — optionnel (l'embed peut ne pas exposer le nom).
  onNameChange?: (name: string) => void
  // Verrou White-label sur « Propulsé par » (renvoi facturation). Défaut : non verrouillé.
  whiteLabelLocked?: boolean
  onUpgrade?: () => void
  // Restreint/ordonne les sous-onglets affichés (défaut : les 5).
  sections?: AppearanceSection[]
  // Extension optionnelle rendue sous le formulaire, pilotée par le sous-onglet actif.
  renderExtra?: (section: AppearanceSection) => ReactNode
}

const noop = () => {}

export default function AppearancePanel({
  design, botName, onChange, onNameChange, whiteLabelLocked = false, onUpgrade,
  sections, renderExtra,
}: Props) {
  const tabs = sections && sections.length
    ? AF_TABS.filter(t => sections.includes(t.value))
    : AF_TABS
  const [afTab, setAfTab] = useState<AppearanceSection>(tabs[0]?.value ?? 'colors')
  // Garde-fou : si `sections` change et exclut l'onglet actif, on retombe sur le 1er.
  const active = tabs.some(t => t.value === afTab) ? afTab : (tabs[0]?.value ?? 'colors')

  return (
    <div className="col g18">
      {/* Barre de sous-onglets en pilules larges (maquette) — pilule active en
          blanc surélevé. Style identique à l'onglet Apparence historique. */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 11, padding: 3, maxWidth: 600 }}>
        {tabs.map(t => {
          const on = t.value === active
          return (
            <button key={t.value} onClick={() => setAfTab(t.value)} type="button"
                    style={{
                      flex: 1, fontSize: 12.5, fontWeight: 700, padding: '8px 4px', borderRadius: 8,
                      border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      background: on ? 'var(--surface)' : 'transparent',
                      color: on ? 'var(--acc)' : 'var(--mut)',
                      boxShadow: on ? '0 1px 2px rgba(28,63,92,.08)' : 'none',
                    }}>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* La section rend sa propre mosaïque de cartes (2 colonnes). */}
      <AppearanceForm design={design} botName={botName} section={active}
                      onChange={onChange} onNameChange={onNameChange ?? noop}
                      whiteLabelLocked={whiteLabelLocked} onUpgrade={onUpgrade ?? noop} />

      {renderExtra?.(active)}
    </div>
  )
}
