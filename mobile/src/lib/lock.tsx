// Verrouillage de l'app par empreinte, visage ou code du téléphone (réglage, désactivé par défaut).
// Demandé à l'ouverture et au retour dans l'app après plus d'une minute ailleurs.
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, View } from 'react-native'
import { Button, H2, Icon, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'

const KEY = 'cm.lock'
const GRACE_MS = 60_000
const available = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LA = available ? require('expo-local-authentication') as typeof import('expo-local-authentication') : null

interface LockCtx { enabled: boolean; supported: boolean; label: string; setEnabled: (v: boolean) => Promise<string | null> }
const Ctx = createContext<LockCtx>({ enabled: false, supported: false, label: 'Empreinte ou visage', setEnabled: async () => null })
export const useLock = () => useContext(Ctx)

async function check(prompt: string) {
  if (!LA) return true
  const r = await LA.authenticateAsync({ promptMessage: prompt, cancelLabel: 'Annuler', disableDeviceFallback: false })
  return r.success
}

export function LockProvider({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  const [enabled, setEnabledState] = useState(false)
  const [locked, setLocked] = useState(false)
  const [supported, setSupported] = useState(false)
  const [label, setLabel] = useState('Empreinte ou visage')
  const leftAt = useRef<number | null>(null)

  useEffect(() => {
    (async () => {
      if (LA) {
        const hw = await LA.hasHardwareAsync().catch(() => false)
        const enrolled = await LA.isEnrolledAsync().catch(() => false)
        setSupported(hw && enrolled)
        const types = await LA.supportedAuthenticationTypesAsync().catch(() => [] as number[])
        const face = types.includes(LA.AuthenticationType.FACIAL_RECOGNITION)
        const finger = types.includes(LA.AuthenticationType.FINGERPRINT)
        setLabel(face && !finger ? 'Reconnaissance du visage' : finger && !face ? 'Empreinte digitale' : 'Empreinte ou visage')
      }
      const on = (await AsyncStorage.getItem(KEY).catch(() => null)) === '1'
      setEnabledState(on)
      if (on) setLocked(true)
    })()
  }, [])

  const unlock = useCallback(async () => { if (await check('Déverrouiller Chapote CM')) setLocked(false) }, [])
  useEffect(() => { if (locked) unlock() }, [locked, unlock])
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (!enabled) return
      if (s === 'background') leftAt.current = Date.now()
      if (s === 'active' && leftAt.current && Date.now() - leftAt.current > GRACE_MS) setLocked(true)
      if (s === 'active') leftAt.current = null
    })
    return () => sub.remove()
  }, [enabled])

  const setEnabled = async (v: boolean): Promise<string | null> => {
    if (v && !supported) return 'Aucune empreinte ni visage enregistré sur ce téléphone.'
    if (!(await check(v ? 'Activer le verrouillage' : 'Désactiver le verrouillage'))) return 'Vérification annulée.'
    setEnabledState(v)
    await AsyncStorage.setItem(KEY, v ? '1' : '0').catch(() => {})
    return null
  }

  return (
    <Ctx.Provider value={{ enabled, supported, label, setEnabled }}>
      {children}
      {locked ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg }}>
          <Icon name="shield" size={48} color={c.muted} />
          <H2>Chapote CM est verrouillée</H2>
          <Txt muted center>{label} ou code du téléphone.</Txt>
          <Button kind="primary" title="Déverrouiller" onPress={unlock} />
        </View>
      ) : null}
    </Ctx.Provider>
  )
}
