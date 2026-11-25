// Verrouillage de l'app par empreinte, visage ou code du téléphone (réglage, désactivé par défaut).
// Demandé seulement après plus de 5 minutes hors de l'app. L'heure de départ est gardée sur le téléphone :
// une app fermée par Android en arrière-plan, redémarrée par une mise à jour ou reconnectée ne redemande rien avant.
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, View } from 'react-native'
import { Button, H2, Icon, Txt } from '../ui/kit'
import { useSession } from './session'
import { space, useTheme } from '../ui/theme'

const lockKey = (userId: number) => `cm.lock.${userId}`
const GRACE_MS = 5 * 60_000
const seenKey = (userId: number) => `cm.lock.seen.${userId}`
const markSeen = (userId: number) => AsyncStorage.setItem(seenKey(userId), String(Date.now())).catch(() => {})
const awayTooLong = async (userId: number) => {
  const v = Number(await AsyncStorage.getItem(seenKey(userId)).catch(() => null))
  return !v || Date.now() - v > GRACE_MS
}
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
  const { me } = useSession()
  const [enabled, setEnabledState] = useState(false)
  const [locked, setLocked] = useState(false)
  const [supported, setSupported] = useState(false)
  const [label, setLabel] = useState('Empreinte ou visage')
  const lockedRef = useRef(false)
  useEffect(() => { lockedRef.current = locked }, [locked])

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
    })()
  }, [])
  // Réglage propre à chaque compte : un autre compte sur ce téléphone part désactivé ; déconnecté, rien n'est verrouillé.
  useEffect(() => {
    if (!me) { setEnabledState(false); setLocked(false); return }
    const id = me.id
    AsyncStorage.getItem(lockKey(id)).then(async v => {
      const on = v === '1'
      setEnabledState(on)
      if (on && await awayTooLong(id)) setLocked(true)
    }).catch(() => {})
  }, [me?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const unlock = useCallback(async () => {
    if (await check('Déverrouiller Chapote CM')) { setLocked(false); if (me) markSeen(me.id) }
  }, [me?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (locked) unlock() }, [locked, unlock])
  useEffect(() => {
    if (!enabled || !me) return
    const id = me.id
    // Tant que l'app est ouverte et déverrouillée : « vue à l'instant », relu toutes les 30 secondes.
    if (!lockedRef.current) markSeen(id)
    const t = setInterval(() => { if (!lockedRef.current && AppState.currentState === 'active') markSeen(id) }, 30_000)
    const sub = AppState.addEventListener('change', async s => {
      if (s === 'background' && !lockedRef.current) markSeen(id)
      if (s === 'active' && !lockedRef.current && await awayTooLong(id)) setLocked(true)
    })
    return () => { clearInterval(t); sub.remove() }
  }, [enabled, me?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const setEnabled = async (v: boolean): Promise<string | null> => {
    if (v && !supported) return 'Aucune empreinte ni visage enregistré sur ce téléphone.'
    if (!(await check(v ? 'Activer le verrouillage' : 'Désactiver le verrouillage'))) return 'Vérification annulée.'
    setEnabledState(v)
    if (me) { await AsyncStorage.setItem(lockKey(me.id), v ? '1' : '0').catch(() => {}); markSeen(me.id) }
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
