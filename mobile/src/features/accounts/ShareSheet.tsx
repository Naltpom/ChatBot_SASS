// « Partager » un compte, un groupe ou tout l'espace (comme cm/src/components/ShareSheet.tsx) :
// une adresse e-mail et un niveau d'accès. Accès immédiat si la personne a un compte Chapote, sinon invitation.
import { useEffect, useState } from 'react'
import { Share as RNShare, View } from 'react-native'
import { accountAccess, addGroupShare, createInviteLink, getGroupShares, removeGroupShare, share, type CmRole, type GroupShare, type Person, type ShareWhat } from '../../lib/api'
import { useSession } from '../../lib/session'
import { Avatar, Button, Field, Label, Msg, Row, Sheet, Txt } from '../../ui/kit'
import { space } from '../../ui/theme'
import { Choice } from '../library/ui'
import { ROLE_CHOICES, ROLE_NAME, isEmail, roleHint, shareDoneText } from './logic'
import { t } from '../../lib/i18n'

export function ShareSheet({ what, label, onClose, onDone, org: orgProp }: { what: ShareWhat; label: string; onClose: () => void; onDone?: (text: string) => void; org?: number | null }) {
  const { org: sessionOrg, setOrg, refresh, me } = useSession()
  const org = orgProp !== undefined ? orgProp : sessionOrg
  const groupId = 'group_id' in what ? what.group_id : null
  const [shares, setShares] = useState<GroupShare[] | null>(null)
  const loadShares = () => { if (groupId != null) getGroupShares(org, groupId).then(setShares).catch(() => setShares(null)) }
  useEffect(() => { loadShares() }, [groupId, org]) // eslint-disable-line react-hooks/exhaustive-deps
  const [access, setAccess] = useState<Person[] | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<CmRole>('editor')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const loadAccess = () => {
    if ('platform' in what) accountAccess(org, what.platform, what.account_id).then(setAccess).catch(() => setAccess(null))
  }
  useEffect(loadAccess, [org, JSON.stringify(what)]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const to = email.trim()
    setErr(''); setOk('')
    if (!isEmail(to)) { setErr(t('Adresse e-mail invalide.')); return }
    setBusy(true)
    try {
      if (groupId != null) {
        // Partage par groupe (docs §10) : invitation à accepter par la personne.
        await addGroupShare(org, groupId, to, role)
        const text = t('Invitation envoyée à {email} pour {cible}.', { email: to, cible: label })
        setEmail(''); setOk(text); loadShares(); onDone?.(text)
        return
      }
      const r = await share(org, to, role, what)
      const text = t(shareDoneText(r, to, label))
      if (r.org_id !== org) { await refresh(); setOrg(r.org_id) }
      setEmail(''); setOk(text); loadAccess(); onDone?.(text)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const people = (access || []).filter(p => p.email !== me?.email)
  const removeShare = async (s: GroupShare) => {
    if (groupId == null) return
    try { await removeGroupShare(org, groupId, s.id); loadShares() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <Sheet visible title={t('Partager {nom}', { nom: label })} onClose={onClose}
      footer={<Button kind="primary" icon="users" title={t('Partager')} loading={busy} disabled={!email.trim()} onPress={submit} />}>
      <Field label={t('Adresse e-mail')} value={email} onChangeText={setEmail} placeholder={t('prenom@exemple.fr')} keyboardType="email-address"
        autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" autoFocus returnKeyType="send" onSubmitEditing={submit} />
      <View accessibilityRole="radiogroup" accessibilityLabel={t('Accès')}>
        <Label>{t('Accès')}</Label>
        {ROLE_CHOICES.map(([v, l, d]) => <Choice key={v} radio label={t(l)} hint={t(roleHint(v, d, label))} checked={role === v} onPress={() => setRole(v)} />)}
      </View>
      {err ? <Msg kind="err">{err}</Msg> : null}
      {ok ? <Msg kind="ok">{ok}</Msg> : null}
      {people.length ? (
        <View style={{ gap: space.sm }}>
          <Txt small bold>{t('Ont déjà accès')}</Txt>
          {people.map(p => (
            <Row key={p.email} gap={space.sm}>
              <Avatar src={null} name={p.name || p.email} size={32} />
              <Txt small numberOfLines={1} style={{ flex: 1 }}>{p.name || p.email}{p.pending ? t(' · invitation envoyée') : ''}</Txt>
              <Txt small muted>{t(ROLE_NAME[p.role])}{p.scope.all && p.role !== 'admin' ? t(' · tout') : ''}</Txt>
            </Row>
          ))}
        </View>
      ) : null}
      {groupId != null ? (
        <View style={{ gap: space.sm }}>
          <Label>{t('Ou par message')}</Label>
          <Txt small muted>{t('Un lien à envoyer sur WhatsApp, SMS ou Slack, avec l’accès choisi plus haut. Valable 7 jours.')}</Txt>
          <Button icon="link" title={t('Envoyer un lien d’invitation')} onPress={async () => {
            setErr('')
            try {
              const l = await createInviteLink(org, groupId, role)
              await RNShare.share({ message: t('Rejoins « {groupe} » sur Chapote CM ({role}) : {url}', { groupe: l.group_name, role: t(l.role_label), url: l.url }) })
            } catch (e) { setErr((e as Error).message) }
          }} />
        </View>
      ) : null}
      <Txt small faint>{t('Gérer ou retirer un accès : écran Personnes.')}</Txt>
      {shares && shares.length ? (
        <View style={{ gap: 6 }}>
          <Label>{t('Personnes de ce groupe')}</Label>
          {shares.map(sh => (
            <Row key={sh.id} style={{ justifyContent: 'space-between' }}>
              <Txt small style={{ flex: 1 }}>{sh.name || sh.email}{sh.pending ? t(' · invitation envoyée') : ''} · {sh.role === 'admin' ? t('Admin') : sh.role === 'editor' ? t('Peut publier') : t('Lecture seule')}</Txt>
              <Button small kind="danger" title={t('Retirer')} onPress={() => removeShare(sh)} />
            </Row>
          ))}
        </View>
      ) : null}
    </Sheet>
  )
}
