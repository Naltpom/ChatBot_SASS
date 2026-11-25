// Rejoindre un groupe avec un lien d'invitation (chapotecm://join?t=…, ou lien collé dans l'app).
// Pas connecté : le lien est gardé, et l'écran revient après la connexion.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { acceptInviteLink, previewInviteLink } from '../lib/api'
import { useSession } from '../lib/session'
import { StickyFooter } from '../features/steps'
import { Button, Card, GroupDot, H1, Msg, Row, Screen, Skeleton, Txt } from '../ui/kit'
import { space } from '../ui/theme'

export const PENDING_JOIN = 'cm.pending-join'

export default function Join() {
  const { t } = useLocalSearchParams<{ t?: string }>()
  const router = useRouter()
  const { me, refresh, reloadGroups } = useSession()
  const [info, setInfo] = useState<Awaited<ReturnType<typeof previewInviteLink>> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!t) { setErr('Lien incomplet.'); return }
    if (!me) { AsyncStorage.setItem(PENDING_JOIN, t).catch(() => {}); return }
    AsyncStorage.removeItem(PENDING_JOIN).catch(() => {})
    previewInviteLink(t).then(setInfo).catch(e => setErr(e?.message || 'Lien invalide'))
  }, [t, me])
  const join = async () => {
    if (!t) return
    setErr(null)
    try {
      await acceptInviteLink(t)
      await refresh(); await reloadGroups()
      router.replace('/')
    } catch (e: any) { setErr(e?.message || 'Impossible de rejoindre') }
  }
  return (
    <Screen footer={info ? (
      <StickyFooter>
        <Button kind="primary" title={`Rejoindre « ${info.group_name} »`} onPress={join} style={{ minHeight: 52 }} />
        <Button kind="ghost" title="Plus tard" onPress={() => router.replace('/')} />
      </StickyFooter>
    ) : undefined}>
      <Stack.Screen options={{ title: 'Invitation' }} />
      {err ? <Msg kind="err">{err}</Msg> : null}
      {!me ? (
        <View style={{ gap: space.md, paddingTop: space.md }}>
          <H1>Une invitation vous attend</H1>
          <Txt muted>Connectez-vous ou créez votre compte : vous reviendrez ici pour rejoindre le groupe.</Txt>
          <Button kind="primary" title="Se connecter ou créer un compte" onPress={() => router.replace('/login')} />
        </View>
      ) : !info && !err ? <Skeleton h={160} /> : null}
      {info ? (
        <View style={{ gap: space.md, paddingTop: space.md }}>
          <H1>On vous invite à rejoindre « {info.group_name} »</H1>
          <Card>
            <Row gap={space.sm}><GroupDot color={info.group_color} size={12} /><Txt bold>{info.group_name}</Txt></Row>
            <Txt small muted>{info.accounts} compte{info.accounts > 1 ? 's' : ''}{info.owner ? ` de ${info.owner}` : ''}{info.invited_by ? ` · invité par ${info.invited_by}` : ''}</Txt>
            <Txt small>Votre accès : <Txt small bold>{info.role_label}</Txt></Txt>
          </Card>
        </View>
      ) : null}
    </Screen>
  )
}
