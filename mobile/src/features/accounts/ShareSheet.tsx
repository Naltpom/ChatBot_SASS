// « Partager » un compte, un groupe ou tout l'espace (comme cm/src/components/ShareSheet.tsx) :
// une adresse e-mail et un niveau d'accès. Accès immédiat si la personne a un compte Chapote, sinon invitation.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { accountAccess, addGroupShare, getGroupShares, removeGroupShare, share, type CmRole, type GroupShare, type Person, type ShareWhat } from '../../lib/api'
import { useSession } from '../../lib/session'
import { Avatar, Button, Field, Label, Msg, Row, Sheet, Txt } from '../../ui/kit'
import { space } from '../../ui/theme'
import { Choice } from '../library/ui'
import { ROLE_CHOICES, ROLE_NAME, isEmail, roleHint, shareDoneText } from './logic'

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
    if (!isEmail(to)) { setErr('Adresse e-mail invalide.'); return }
    setBusy(true)
    try {
      if (groupId != null) {
        // Partage par groupe (docs §10) : invitation à accepter par la personne.
        await addGroupShare(org, groupId, to, role)
        const text = `Invitation envoyée à ${to} pour ${label}.`
        setEmail(''); setOk(text); loadShares(); onDone?.(text)
        return
      }
      const r = await share(org, to, role, what)
      const text = shareDoneText(r, to, label)
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
    <Sheet visible title={`Partager ${label}`} onClose={onClose}
      footer={<Button kind="primary" icon="users" title="Partager" loading={busy} disabled={!email.trim()} onPress={submit} />}>
      <Field label="Adresse e-mail" value={email} onChangeText={setEmail} placeholder="prenom@exemple.fr" keyboardType="email-address"
        autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" autoFocus returnKeyType="send" onSubmitEditing={submit} />
      <View accessibilityRole="radiogroup" accessibilityLabel="Accès">
        <Label>Accès</Label>
        {ROLE_CHOICES.map(([v, l, d]) => <Choice key={v} radio label={l} hint={roleHint(v, d, label)} checked={role === v} onPress={() => setRole(v)} />)}
      </View>
      {err ? <Msg kind="err">{err}</Msg> : null}
      {ok ? <Msg kind="ok">{ok}</Msg> : null}
      {people.length ? (
        <View style={{ gap: space.sm }}>
          <Txt small bold>Ont déjà accès</Txt>
          {people.map(p => (
            <Row key={p.email} gap={space.sm}>
              <Avatar src={null} name={p.name || p.email} size={32} />
              <Txt small numberOfLines={1} style={{ flex: 1 }}>{p.name || p.email}{p.pending ? ' · invitation envoyée' : ''}</Txt>
              <Txt small muted>{ROLE_NAME[p.role]}{p.scope.all && p.role !== 'admin' ? ' · tout' : ''}</Txt>
            </Row>
          ))}
        </View>
      ) : null}
      <Txt small faint>Gérer ou retirer un accès : écran Personnes.</Txt>
      {shares && shares.length ? (
        <View style={{ gap: 6 }}>
          <Label>Personnes de ce groupe</Label>
          {shares.map(sh => (
            <Row key={sh.id} style={{ justifyContent: 'space-between' }}>
              <Txt small style={{ flex: 1 }}>{sh.name || sh.email}{sh.pending ? ' · invitation envoyée' : ''} · {sh.role === 'admin' ? 'Admin' : sh.role === 'editor' ? 'Peut publier' : 'Lecture seule'}</Txt>
              <Button small kind="danger" title="Retirer" onPress={() => removeShare(sh)} />
            </Row>
          ))}
        </View>
      ) : null}
    </Sheet>
  )
}
