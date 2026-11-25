// Fin de la première visite : une réussite claire, et la demande de notifications au moment où elle a du sens.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Platform as RNPlatform, View } from 'react-native'
import { enablePush } from '../../lib/push'
import { StickyFooter } from '../../features/steps'
import { Card, H1, Icon, Msg, Screen, Txt, Button } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'

export default function Done() {
  const router = useRouter()
  const { c } = useTheme()
  const { when, accounts } = useLocalSearchParams<{ when?: string; accounts?: string }>()
  const [err, setErr] = useState<string | null>(null)
  const finish = () => router.replace('/')
  const notify = async () => {
    setErr(null)
    const r = await enablePush()
    if (typeof r === 'string') { setErr(r); return }
    finish()
  }
  return (
    <Screen footer={
      <StickyFooter>
        <Button kind="primary" icon="bell" title={RNPlatform.OS === 'ios' ? 'Continuer' : 'Me prévenir quand elle part'} onPress={notify} style={{ minHeight: 52 }} />
        {RNPlatform.OS === 'ios' ? null : <Button kind="ghost" title="Plus tard" onPress={finish} />}
      </StickyFooter>
    }>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={{ alignItems: 'center', gap: space.md, paddingTop: 72 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.okBg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={36} color={c.ok} strokeWidth={2.6} />
        </View>
        <H1>C’est programmé !</H1>
        <Txt muted center>{when ? `Votre vidéo partira ${when}` : 'Votre vidéo est dans le planning'}{accounts ? ` sur ${accounts}` : ''}. Vous n’avez plus rien à faire.</Txt>
      </View>
      <Card style={{ borderRadius: radius.lg }}>
        <Txt bold>Être prévenu quand elle est en ligne ?</Txt>
        <Txt small muted>Une notification quand la vidéo est publiée, si un envoi échoue, ou quand un brouillon TikTok attend votre validation. Réglable par type dans Réglages.</Txt>
      </Card>
      {err ? <Msg kind="err">{err}</Msg> : null}
    </Screen>
  )
}
