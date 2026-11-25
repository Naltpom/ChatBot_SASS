// « Sécuriser votre compte », une fois après la connexion : trois interrupteurs, rien de plus.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Switch, View } from 'react-native'
import { call } from '../lib/http'
import { useLock } from '../lib/lock'
import { onboardedKey, stepTitle } from '../lib/onboarding'
import { disablePush, enablePush, getPush, pushUnsupported } from '../lib/push'
import { useSession } from '../lib/session'
import { useOwnAccounts } from '../features/steps'
import { TwoFASheet } from '../features/TwoFASheet'
import { Button, Card, Divider, H1, Msg, Row, Screen, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'

function Line({ title, hint, value, onChange, disabled }: { title: string; hint?: string | null; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme()
  return (
    <Row style={{ justifyContent: 'space-between', minHeight: 56 }}>
      <View style={{ flex: 1 }}>
        <Txt bold>{title}</Txt>
        {hint ? <Txt small muted>{hint}</Txt> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={title} trackColor={{ true: c.primary }} />
    </Row>
  )
}

export default function Onboarding() {
  const router = useRouter()
  const { me } = useSession()
  const own = useOwnAccounts()
  const { from } = useLocalSearchParams<{ from?: string }>()
  const lock = useLock()
  const [push, setPush] = useState(false)
  const [twofa, setTwofa] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    getPush().then(p => setPush(p.enabled)).catch(() => {})
    call<{ totp_enabled: boolean }>('/api/auth/2fa/status').then(s => setTwofa(s.totp_enabled)).catch(() => {})
  }, [])
  const noPush = pushUnsupported()

  const togglePush = async (v: boolean) => {
    setMsg(null)
    if (!v) { setPush((await disablePush().catch(() => ({ enabled: false }))).enabled); return }
    const r = await enablePush()
    if (typeof r === 'string') setMsg(r); else setPush(r.enabled)
  }
  const finish = async () => {
    if (me) await AsyncStorage.setItem(onboardedKey(me.id), '1').catch(() => {})
    // Nouveau compte (ou retour depuis l'étape 2) : on continue les étapes ; sinon l'app.
    router.replace(from === 'welcome' || !own.length ? '/welcome' : '/')
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: stepTitle(1, own.length) }} />
      <View style={{ paddingTop: space.md }}><H1>Sécuriser votre compte</H1></View>
      {msg ? <Msg kind="err">{msg}</Msg> : null}
      <Card>
        <Line title="Notifications" hint={noPush} value={push} onChange={togglePush} disabled={!!noPush} />
        <Divider />
        <Line title={`Déverrouillage par ${lock.label.toLowerCase()}`} hint={lock.supported ? null : 'Indisponible sur ce téléphone.'}
          value={lock.enabled} disabled={!lock.supported} onChange={async v => { const e = await lock.setEnabled(v); if (e) setMsg(e) }} />
        <Divider />
        <Line title="Double authentification" value={twofa} onChange={() => setSheet(true)} />
      </Card>
      <Button kind="primary" title="Continuer" onPress={finish} />
      <TwoFASheet visible={sheet} enabled={twofa} onClose={() => setSheet(false)} onChanged={setTwofa} />
    </Screen>
  )
}
