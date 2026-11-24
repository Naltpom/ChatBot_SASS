// Après l'inscription ou la 1re connexion sur ce téléphone, une seule fois : notifications, verrouillage par
// empreinte / visage, double authentification. Tout est facultatif (« Plus tard »).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { call } from '../lib/http'
import { useLock } from '../lib/lock'
import { enablePush, pushUnsupported } from '../lib/push'
import { useSession } from '../lib/session'
import { Button, Card, H1, Icon, Msg, Row, Screen, Txt, type IconName } from '../ui/kit'
import { space, useTheme } from '../ui/theme'

import { onboardedKey } from '../lib/onboarding'

function Step({ icon, title, text, done, action }: { icon: IconName; title: string; text: string; done: boolean; action: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <Card>
      <Row gap={space.md}>
        <Icon name={done ? 'check' : icon} size={24} color={done ? c.ok : c.text} />
        <View style={{ flex: 1 }}>
          <Txt bold>{title}</Txt>
          <Txt small muted>{text}</Txt>
        </View>
      </Row>
      {done ? null : action}
    </Card>
  )
}

export default function Onboarding() {
  const router = useRouter()
  const { me } = useSession()
  const lock = useLock()
  const [push, setPush] = useState(false)
  const [twofa, setTwofa] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Relu au retour de l'écran de double authentification.
  useFocusEffect(useCallback(() => { call<{ enabled: boolean }>('/api/auth/2fa/status').then(s => setTwofa(s.enabled)).catch(() => {}) }, []))

  const finish = async () => {
    if (me) await AsyncStorage.setItem(onboardedKey(me.id), '1').catch(() => {})
    router.replace('/')
  }
  const noPush = pushUnsupported()

  return (
    <Screen>
      <View style={{ gap: space.sm, paddingTop: space.md }}>
        <H1>Sécuriser votre compte</H1>
        <Txt muted>Trois réglages rapides, tous facultatifs. Vous les retrouvez dans Réglages.</Txt>
      </View>
      {msg ? <Msg kind="err">{msg}</Msg> : null}
      <Step icon="bell" title="Notifications" done={push}
        text={noPush || 'Vidéo publiée, échec, brouillon TikTok, nouveaux commentaires.'}
        action={noPush ? null : <Button kind="primary" title="Activer les notifications" onPress={async () => {
          const r = await enablePush(); if (typeof r === 'string') setMsg(r); else setPush(r.enabled)
        }} />} />
      <Step icon="shield" title={`Déverrouiller avec ${lock.label.toLowerCase()}`} done={lock.enabled}
        text={lock.supported ? 'Demandé à l’ouverture et au retour dans l’app après une minute.' : 'Aucune empreinte ni visage enregistré sur ce téléphone (ou Expo Go).'}
        action={lock.supported ? <Button title="Activer" onPress={async () => { const e = await lock.setEnabled(true); if (e) setMsg(e) }} /> : null} />
      <Step icon="eye-off" title="Double authentification" done={twofa}
        text="Un code de votre application d’authentification en plus, à chaque connexion."
        action={<Button title="Configurer" onPress={() => router.push({ pathname: '/account', params: { section: '2fa' } })} />} />
      <Txt small muted>Cet appareil reste connecté tant que vous ouvrez l’app au moins une fois tous les 7 jours (vous êtes prévenu la veille).</Txt>
      <Button kind="primary" title="Continuer" onPress={finish} />
    </Screen>
  )
}
