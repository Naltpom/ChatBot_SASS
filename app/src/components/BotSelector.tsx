// Sélecteur de bot en pilules — factorisé entre l'Inbox et l'Analytics. Chaque
// pilule porte l'avatar de marque (brandBg + BubbleIcon), le nom du bot, et une
// éventuelle pastille « à prendre » (compteur de demandes en attente, Inbox
// uniquement). Conserve les classes .inbox-bot-* pour un rendu identique.
import type { ReactNode } from 'react'
import { BubbleIcon, brandBg } from '../ui'
import type { DesignJson } from '../types/bot'

interface BotItem {
  id: number
  name: string
  design_json?: DesignJson | null
}

export default function BotSelector({ bots, selectedId, onSelect, pending, extra }: {
  bots: BotItem[]
  selectedId: number | null
  onSelect: (id: number) => void
  // Compteur « à prendre » par bot (Inbox) — optionnel.
  pending?: Record<number, number>
  // Contenu additionnel par pilule (ex. chip « En pause » d'Analytics) — optionnel.
  extra?: (bot: BotItem) => ReactNode
}) {
  return (
    <div className="inbox-bot-picker" aria-label="Choisir un chatbot">
      {bots.map(b => {
        const d = b.design_json || {}
        const n = pending?.[b.id] || 0
        const active = b.id === selectedId
        return (
          <button key={b.id} aria-pressed={active}
                  className={`inbox-bot-tab ${active ? 'active' : ''}`}
                  onClick={() => onSelect(b.id)}>
            <span className={`bot-avatar ${d.bordered ? 'bordered' : ''}`}
                  style={{ width: 26, height: 26, background: brandBg(d), flex: '0 0 auto' }}>
              <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? 26 : 13}
                          avatarImg={d.avatarImage} />
            </span>
            <span className="inbox-bot-name">{b.name}</span>
            {extra?.(b)}
            {n > 0 && (
              <span className="tab-badge" role="img" aria-label={`${n} en attente`}>{n}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
