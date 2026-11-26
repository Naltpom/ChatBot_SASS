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
import { t } from '../lib/i18n'

export const PENDING_JOIN = 'cm.pending-join'

export default function Join() {
  const { t: token } = useLocalSearchParams<{ t?: string }>()
  const router = useRouter()
  const { me, refresh, reloadGroups } = useSession()
  const [info, setInfo] = useState<Awaited<ReturnType<typeof previewInviteLink>> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!token) { setErr(t('Lien incomplet.')); return }
    if (!me) { AsyncStorage.setItem(PENDING_JOIN, token).catch(() => {}); return }
    AsyncStorage.removeItem(PENDING_JOIN).catch(() => {})
    previewInviteLink(token).then(setInfo).catch(e => setErr(e?.message || t('Lien invalide')))
  }, [token, me])
  const join = async () => {
    if (!token) return
    setErr(null)
    try {
      await acceptInviteLink(token)
      await refresh(); await reloadGroups()
      router.replace('/')
    } catch (e: any) { setErr(e?.message || t('Impossible de rejoindre')) }
  }
  return (
    <Screen footer={info ? (
      <StickyFooter>
        <Button kind="primary" title={t('Rejoindre « {groupe} »', { groupe: info.group_name })} onPress={join} style={{ minHeight: 52 }} />
        <Button kind="ghost" title={t('Plus tard')} onPress={() => router.replace('/')} />
      </StickyFooter>
    ) : undefined}>
      <Stack.Screen options={{ title: t('Invitation') }} />
      {err ? <Msg kind="err">{err}</Msg> : null}
      {!me ? (
        <View style={{ gap: space.md, paddingTop: space.md }}>
          <H1>{t('Une invitation vous attend')}</H1>
          <Txt muted>{t('Connectez-vous ou créez votre compte : vous reviendrez ici pour rejoindre le groupe.')}</Txt>
          <Button kind="primary" title={t('Se connecter ou créer un compte')} onPress={() => router.replace('/login')} />
        </View>
      ) : !info && !err ? <Skeleton h={160} /> : null}
      {info ? (
        <View style={{ gap: space.md, paddingTop: space.md }}>
          <H1>{t('On vous invite à rejoindre « {groupe} »', { groupe: info.group_name })}</H1>
          <Card>
            <Row gap={space.sm}><GroupDot color={info.group_color} size={12} /><Txt bold>{info.group_name}</Txt></Row>
            <Txt small muted>{info.accounts > 1 ? t('{n} comptes', { n: info.accounts }) : t('{n} compte', { n: info.accounts })}{info.owner ? t(' de {nom}', { nom: info.owner }) : ''}{info.invited_by ? t(' · invité par {nom}', { nom: info.invited_by }) : ''}</Txt>
            <Txt small>{t('Votre accès : ')}<Txt small bold>{t(info.role_label)}</Txt></Txt>
          </Card>
        </View>
      ) : null}
    </Screen>
  )
}
