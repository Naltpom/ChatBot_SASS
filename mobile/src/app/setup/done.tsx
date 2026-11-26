// Fin de la première visite : une réussite claire, et la demande de notifications au moment où elle a du sens.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useEffect, useRef, useState } from 'react'
import { Animated, Platform as RNPlatform, View } from 'react-native'
import { t } from '../../lib/i18n'
import { enablePush } from '../../lib/push'
import { StickyFooter } from '../../features/steps'
import { Card, H1, Icon, Msg, Screen, Txt, Button } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'

export default function Done() {
  const router = useRouter()
  const { c } = useTheme()
  const { when, accounts } = useLocalSearchParams<{ when?: string; accounts?: string }>()
  const [err, setErr] = useState<string | null>(null)
  // Célébration : la 1re vidéo programmée est le moment fort de l'inscription.
  const pop = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
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
        <Button kind="primary" icon="bell" title={RNPlatform.OS === 'ios' ? t('Continuer') : t('Me prévenir quand elle part')} onPress={notify} style={{ minHeight: 52 }} />
        {RNPlatform.OS === 'ios' ? null : <Button kind="ghost" title={t('Plus tard')} onPress={finish} />}
      </StickyFooter>
    }>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={{ alignItems: 'center', gap: space.md, paddingTop: 72 }}>
        <Animated.View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: c.okBg, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pop }] }}>
          <Icon name="check" size={48} color={c.ok} strokeWidth={2.6} />
        </Animated.View>
        <H1>{t('C’est programmé !')}</H1>
        <Txt muted center>{when
          ? (accounts ? t('Votre vidéo partira {when} sur {accounts}.', { when, accounts }) : t('Votre vidéo partira {when}.', { when }))
          : (accounts ? t('Votre vidéo est dans le planning sur {accounts}.', { accounts }) : t('Votre vidéo est dans le planning.'))}
          {' '}{t('Chapote s’occupe de la suite, même téléphone éteint.')}</Txt>
      </View>
      <Card style={{ borderRadius: radius.lg }}>
        <Txt bold>{t('Être prévenu quand elle est en ligne ?')}</Txt>
        <Txt small muted>{t('Une notification quand la vidéo est publiée, si un envoi échoue, ou quand un brouillon TikTok attend votre validation. Réglable par type dans Réglages.')}</Txt>
      </Card>
      {err ? <Msg kind="err">{err}</Msg> : null}
    </Screen>
  )
}
