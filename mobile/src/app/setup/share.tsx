// Inscription, dernière étape (facultative) : inviter des personnes par e-mail. Le partage se fait par
// groupe ; sans groupe, un groupe « Tous mes comptes » est créé au premier envoi.
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { addGroupShare, createGroup, getGroups, type CmRole, type Group } from '../../lib/api'
import { useSession } from '../../lib/session'
import { akey, groupBody, isEmail, ROLE_CHOICES, ROLE_NAME } from '../../features/accounts/logic'
import { StepHeader, useOwnAccounts } from '../../features/steps'
import { stepCount } from '../../lib/onboarding'
import { Button, Card, Chip, Field, GroupDot, H1, Msg, Row, Screen, Txt } from '../../ui/kit'
import { space } from '../../ui/theme'

const ALL = 'Tous mes comptes'

export default function SetupShare() {
  const router = useRouter()
  const { org, refresh } = useSession()
  const own = useOwnAccounts()
  const [groups, setGroups] = useState<Group[]>([])
  const [gid, setGid] = useState<number | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<CmRole>('editor')
  const [sent, setSent] = useState<{ email: string; role: CmRole; group: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    getGroups(org).then(gs => { setGroups(gs); setGid(cur => cur ?? gs[0]?.id ?? null) }).catch(() => {})
  }, [org])
  useFocusEffect(load)

  const invite = async () => {
    setErr(null); setBusy(true)
    try {
      let g = groups.find(x => x.id === gid) || null
      if (!g) {
        g = await createGroup(org, groupBody(ALL, 'blue', own.map(a => akey(a.platform, a.id))))
        setGroups(gs => [...gs, g!]); setGid(g.id)
      }
      await addGroupShare(org, g.id, email.trim(), role)
      setSent(s => [...s, { email: email.trim(), role, group: g!.name }])
      setEmail('')
    } catch (e: any) { setErr(e?.message || 'Invitation non envoyée') } finally { setBusy(false) }
  }
  const finish = () => {
    refresh()
    router.replace('/')
  }

  return (
    <Screen>
      <StepHeader n={stepCount(own.length)} />
      <View style={{ gap: space.sm, paddingTop: space.md }}>
        <H1>Inviter des personnes</H1>
        <Txt muted>Facultatif. Elles reçoivent un e-mail et voient les comptes du groupe choisi, avec l’accès que vous donnez. Vous pourrez changer ou retirer l’accès à tout moment.</Txt>
      </View>
      {err ? <Msg kind="err">{err}</Msg> : null}
      {sent.length ? (
        <Card>
          {sent.map((s, i) => <Txt key={i} small>✓ {s.email} · {ROLE_NAME[s.role]} · {s.group}</Txt>)}
        </Card>
      ) : null}
      <Card>
        {groups.length ? (
          <>
            <Txt small bold>Groupe partagé</Txt>
            <Row wrap>
              {groups.map(g => <Chip key={g.id} label={g.name} selected={g.id === gid} left={<GroupDot color={g.color} />} onPress={() => setGid(g.id)} />)}
            </Row>
          </>
        ) : <Txt small muted>Partage de tous vos comptes ({own.length}).</Txt>}
        <Field label="Adresse e-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
          autoComplete="email" placeholder="nom@exemple.fr" />
        <Txt small bold>Accès</Txt>
        <Row wrap>
          {ROLE_CHOICES.map(([v, l]) => <Chip key={v} label={l} selected={role === v} onPress={() => setRole(v)} />)}
        </Row>
        <Txt small muted>{ROLE_CHOICES.find(r => r[0] === role)?.[2]}</Txt>
        <Button kind="primary" icon="users" title="Envoyer l’invitation" loading={busy} disabled={!isEmail(email) || !own.length} onPress={invite} />
      </Card>
      <Button kind={sent.length ? 'primary' : 'ghost'} title={sent.length ? 'Terminer' : 'Passer et terminer'} onPress={finish} />
    </Screen>
  )
}
