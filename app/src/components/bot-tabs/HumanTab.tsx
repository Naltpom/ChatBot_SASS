// Onglet « Humain » (relais / handoff) de BotPage — présentationnel.
import { Btn, Card, Field, InfoBox, SectionTitle } from '../../ui'
import ModuleLockBanner from '../billing/ModuleLockBanner'
import type { Bot, BotUpdate } from '../../types/bot'

export default function HumanTab({
  bot, patch, hasPerm, switchTab, aiTabRelevant, locked, onUpgrade,
}: {
  bot: Bot
  patch: (fields: BotUpdate) => void
  hasPerm: (perm: string | null) => boolean
  switchTab: (t: string) => void
  aiTabRelevant: boolean
  // Module 'inbox' verrouillé : relais humain / live chat visible mais non éditable.
  locked: boolean
  onUpgrade: () => void
}) {
  return (
    <div className="col g18">
      <SectionTitle sub="Bascule la conversation vers un conseiller en dernier recours. Le visiteur passe en file d'attente et vos équipes sont notifiées.">
        Relais humain
      </SectionTitle>

      <ModuleLockBanner locked={locked} label="Live chat / Inbox" onUpgrade={onUpgrade} />
      <div className="col g18">
      {hasPerm('context') ? (
        <Card style={{ maxWidth: 720 }}>
          <div className="card-title">Notification de relais</div>
          <Field label="Webhook de notification (Slack)"
                 hint={bot.handoff_webhook_url && !/^https:\/\//.test(bot.handoff_webhook_url)
                   ? <span style={{ color: 'var(--danger)' }}>L'adresse doit commencer par https://</span>
                   : undefined}>
            <input type="text" className="mono" placeholder="https://hooks.slack.com/services/…"
                   value={bot.handoff_webhook_url || ''}
                   onChange={e => patch({ handoff_webhook_url: e.target.value })} />
          </Field>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Appelé à chaque demande de conseiller (payload {'{"text": …}'} compatible Slack —
            fonctionne aussi avec Mattermost ou un connecteur Teams). Les admins de l'organisation
            reçoivent aussi un email ; sans SMTP configuré côté serveur, cette notification email
            est uniquement journalisée.
          </div>
          <div style={{ marginTop: 12 }}>
            <InfoBox tone="info" title="Cette URL est un secret">
              Un webhook Slack contient un jeton dans son chemin : il n'apparaît jamais dans les
              exports config.json et n'est visible qu'avec la permission Contexte.
            </InfoBox>
          </div>
        </Card>
      ) : (
        <Card style={{ maxWidth: 720 }}>
          <InfoBox tone="warn" title="Permission requise">
            La configuration du relais humain nécessite la permission Contexte sur ce bot.
          </InfoBox>
        </Card>
      )}

      <Card style={{ maxWidth: 720 }}>
        <div className="card-title">Comment activer le relais</div>
        <div className="col" style={{ gap: 10 }}>
          <InfoBox tone="info">
            Ajoutez un nœud de type <strong>« Conseiller »</strong> dans l'onglet Arbre, ou une
            action IA de type <strong>« Conseiller humain »</strong> dans l'onglet Actions : le
            visiteur est mis en relation, l'IA se met en retrait et la conversation apparaît dans
            votre boîte de réception.
          </InfoBox>
          <div className="row g10" style={{ flexWrap: 'wrap' }}>
            <Btn kind="soft" small onClick={() => switchTab('tree')}>Ouvrir l'arbre</Btn>
            {aiTabRelevant && (
              <Btn kind="soft" small onClick={() => switchTab('actions')}>Ouvrir les actions</Btn>
            )}
          </div>
        </div>
      </Card>
      </div>
    </div>
  )
}
