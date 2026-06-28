// En-tête de l'éditeur de bot (refonte Chapote) — lien retour, avatar navy, nom
// éditable inline (perm appearance ; sinon lecture seule), pills statut + mode,
// ligne « domaine · clé publique » mono, et bouton « Activer le bot » si inactif.
// Présentationnel : bot/handlers viennent de BotPage (useBotEditor).
import { Btn, BubbleIcon, brandBg, modeChip, statusChip } from '../../ui'
import type { Bot, BotUpdate } from '../../types/bot'

export default function BotHeader({
  bot, design, site, orgName, isAdminView, hasPerm, patch, canActivate, activateBot, onBack,
}: {
  bot: Bot
  design: Record<string, any>
  site: string
  orgName: string
  isAdminView: boolean
  hasPerm: (perm: string) => boolean
  patch: (fields: BotUpdate) => void
  canActivate: boolean
  activateBot: () => void
  onBack: () => void
}) {
  const d = design
  return (
    <div>
      <button className="back-link" onClick={onBack}>
        {isAdminView ? `← Bots de ${orgName}` : '← Mes chatbots'}
      </button>
      <div className="bot-head">
        <span className={`bot-avatar ${d.bordered ? 'bordered' : ''}`}
              style={{ width: 46, height: 46, borderRadius: 13, background: brandBg(d) }}>
          <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? 46 : 22} avatarImg={d.avatarImage} />
        </span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Nom éditable inline (perm appearance) — sinon affiché en lecture seule */}
            {hasPerm('appearance') ? (
              <input type="text" value={bot.name} placeholder="Nom du bot"
                     onChange={e => patch({ name: e.target.value })}
                     style={{
                       fontFamily: 'var(--display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.02em',
                       color: 'var(--ink)', border: '1px solid transparent', borderRadius: 8,
                       padding: '1px 8px', marginLeft: -8, background: 'transparent', width: 340, maxWidth: '100%',
                       boxShadow: 'none',
                     }} />
            ) : (
              <span className="bot-head-title" style={{ marginBottom: 0, fontSize: 25 }}>{bot.name}</span>
            )}
            {statusChip(bot.is_active)}
            {modeChip(bot.mode)}
          </div>
          <div className="bot-head-key" style={{ marginTop: 3, fontSize: 13, color: 'var(--mut)' }}>{site} · {bot.public_key}</div>
        </div>
        {canActivate && (
          <Btn kind="primary" onClick={activateBot}>Activer le bot</Btn>
        )}
      </div>
    </div>
  )
}
