// Demandes de reprise de compte : reçues (accepter / refuser, après confirmation) et envoyées
// (en attente, refusée, sans réponse → réclamation au support de Chapote).
import { useState } from 'react'
import { View } from 'react-native'
import {
  acceptAccountRequest, cancelAccountRequest, declineAccountRequest, disputeAccountRequest, PLATFORM_LABEL, type AccountRequest,
} from '../../lib/api'
import { Button, Card, Field, Row, Sheet, Txt } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'
import { showDialog } from '../../ui/dialog'
import { t } from '../../lib/i18n'

const STATUS: Record<AccountRequest['status'], string> = {
  pending: 'en attente de réponse', accepted: 'acceptée', declined: 'refusée', cancelled: 'annulée', expired: 'sans réponse',
}

export function AccountRequests({ data, onChanged }: {
  data: { incoming: AccountRequest[]; outgoing: AccountRequest[] } | null
  onChanged: (text: string | null, err?: string) => void
}) {
  const { c } = useTheme()
  const [dispute, setDispute] = useState<AccountRequest | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const outgoing = (data?.outgoing || []).filter(r => r.status !== 'accepted' || Date.now() - Date.parse(r.created_at) < 7 * 864e5)
  if (!data || (!data.incoming.length && !outgoing.length)) return null
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); onChanged(ok) } catch (e) { onChanged(null, (e as Error).message) } finally { setBusy(false) }
  }
  const name = (r: AccountRequest) => `${r.account_name || t('Compte')} (${PLATFORM_LABEL[r.platform]})`
  const accept = (r: AccountRequest) => showDialog(t('Donner {compte} ?', { compte: name(r) }),
    t('{personne} récupère le compte et ses publications à venir. L’historique reste chez vous.', { personne: r.requester?.name || r.requester?.email || t('Cette personne') }), [
      { text: t('Annuler'), style: 'cancel' },
      { text: t('Accepter'), onPress: () => act(() => acceptAccountRequest(r.id), r.account_name ? t('{compte} a été transféré.', { compte: r.account_name }) : t('Le compte a été transféré.')) },
    ])
  const decline = (r: AccountRequest) => showDialog(t('Refuser la demande ?'), t('Le compte reste dans votre espace. La personne pourra s’adresser au support de Chapote.'), [
    { text: t('Annuler'), style: 'cancel' },
    { text: t('Refuser'), style: 'destructive', onPress: () => act(() => declineAccountRequest(r.id), t('Demande refusée.')) },
  ])

  return (
    <Card accessibilityLabel={t('Demandes de reprise de compte')} style={{ gap: space.md }}>
      <Txt bold size={17} accessibilityRole="header">{t('Demandes de reprise')}</Txt>
      {data.incoming.map(r => (
        <View key={`i${r.id}`} style={{ gap: space.sm }}>
          <Txt small>
            <Txt small bold>{r.requester?.name || r.requester?.email || t('Quelqu’un')}</Txt>
            {r.requester?.name && r.requester.email ? ` (${r.requester.email})` : ''}{t(' demande le compte ')}<Txt small bold>{name(r)}</Txt>.
            {' '}{t('Cette personne vient de se connecter au compte chez {plateforme}.', { plateforme: PLATFORM_LABEL[r.platform] })}
          </Txt>
          {r.message ? <Txt small muted>« {r.message} »</Txt> : null}
          <Row gap={space.sm}>
            <Button small kind="primary" title={t('Accepter')} flex disabled={busy} onPress={() => accept(r)} />
            <Button small title={t('Refuser')} flex disabled={busy} onPress={() => decline(r)} />
          </Row>
          <Txt size={12} muted>{t('Sans réponse sous 7 jours, la personne pourra faire une réclamation au support.')}</Txt>
        </View>
      ))}
      {outgoing.map(r => (
        <View key={`o${r.id}`} style={{ gap: 6 }}>
          <Txt small>{t('Votre demande pour ')}<Txt small bold>{name(r)}</Txt>{t(' : ')}<Txt small bold color={r.status === 'declined' ? c.danger : r.status === 'accepted' ? c.ok : c.text}>{t(STATUS[r.status])}</Txt>.</Txt>
          {r.disputed ? <Txt size={12} muted>{t('Réclamation envoyée : le support vous répond par e-mail.')}</Txt> : null}
          <Row gap={space.sm} wrap>
            {r.can_dispute ? <Button small kind="secondary" title={t('Faire une réclamation')} disabled={busy} onPress={() => { setText(''); setDispute(r) }} /> : null}
            {r.status === 'pending' ? <Button small kind="ghost" title={t('Annuler la demande')} disabled={busy}
              onPress={() => act(() => cancelAccountRequest(r.id), t('Demande annulée.'))} /> : null}
          </Row>
          {r.status === 'pending' && !r.can_dispute ? <Txt size={12} muted>{t('L’espace actuel du compte a 7 jours pour répondre. Réclamation possible au bout de 3 jours sans réponse.')}</Txt> : null}
        </View>
      ))}
      <Sheet visible={!!dispute} title={t('Réclamation au support')} onClose={() => setDispute(null)}>
        <Txt muted>{t('Expliquez pourquoi ce compte vous revient (par exemple : c’est votre marque, la personne a quitté l’équipe). Le support de Chapote vérifie et vous répond par e-mail.')}</Txt>
        <Field label={t('Votre message')} value={text} onChangeText={setText} multiline maxLength={2000} placeholder={t('Au moins quelques mots')} />
        <Button kind="primary" title={t('Envoyer au support')} disabled={busy || text.trim().length < 10} onPress={() => {
          const r = dispute
          if (!r) return
          setDispute(null)
          act(() => disputeAccountRequest(r.id, text.trim()), t('Réclamation envoyée au support : réponse par e-mail sous 5 jours ouvrés.'))
        }} />
      </Sheet>
    </Card>
  )
}
