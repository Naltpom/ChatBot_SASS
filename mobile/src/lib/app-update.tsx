// Mises à jour sans réinstaller (EAS Update).
// - À l'ouverture : pendant l'écran de démarrage, on cherche et télécharge une nouvelle version
//   (4 secondes au plus). Si elle arrive à temps, l'app redémarre dessus avant de s'afficher : rien à faire.
//   Sinon le téléchargement continue en fond et la version s'applique à la prochaine ouverture.
// - Au retour dans l'app : téléchargement en fond, puis un petit bandeau discret propose de redémarrer.
// Ne concerne que le code de l'app ; un changement natif (nouveau module, permission) demande une nouvelle version du store.
import * as Updates from 'expo-updates'
import { useEffect, useRef, useState } from 'react'
import { AppState, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, Txt } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'
import { t } from './i18n'

const LAUNCH_WAIT_MS = 4000
const enabled = !__DEV__ && Updates.isEnabled

async function fetchNew(): Promise<boolean> {
  const found = await Updates.checkForUpdateAsync()
  if (!found.isAvailable) return false
  const got = await Updates.fetchUpdateAsync()
  return got.isNew
}

/** Vérification au lancement : résolue dès que l'écran de démarrage peut disparaître. */
export const launchUpdateChecked: Promise<void> = !enabled ? Promise.resolve() : new Promise<void>(resolve => {
  let done = false
  const finish = () => { if (!done) { done = true; resolve() } }
  setTimeout(finish, LAUNCH_WAIT_MS)
  fetchNew()
    .then(isNew => { if (isNew && !done) { done = true; return Updates.reloadAsync() } })
    .catch(() => {})
    .finally(finish)
})

export function useAppUpdate(): boolean {
  const [ready, setReady] = useState(false)
  const busy = useRef(false)
  useEffect(() => {
    if (!enabled) return
    const check = async () => {
      if (busy.current) return
      busy.current = true
      try { if (await fetchNew()) setReady(true) } catch { /* hors ligne : on réessaiera */ } finally { busy.current = false }
    }
    // Au lancement, la vérification ci-dessus a déjà eu lieu ; on regarde seulement au retour dans l'app.
    const sub = AppState.addEventListener('change', s => { if (s === 'active') check() })
    return () => sub.remove()
  }, [])
  return ready
}

/** Bandeau discret en bas de l'écran quand une nouvelle version est téléchargée. */
export function UpdateBanner({ visible }: { visible: boolean }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [hidden, setHidden] = useState(false)
  if (!visible || hidden) return null
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 72, alignItems: 'center', paddingHorizontal: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: c.ink, borderRadius: radius.lg,
        paddingLeft: space.md, paddingRight: 6, paddingVertical: 6, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, elevation: 6 }}>
        <Icon name="refresh" size={16} color={c.onInk} />
        <Txt small color={c.onInk}>{t('Nouvelle version prête')}</Txt>
        <Pressable onPress={() => { Updates.reloadAsync().catch(() => {}) }} accessibilityRole="button"
          style={{ backgroundColor: c.primary, borderRadius: radius.md, paddingHorizontal: 12, minHeight: 36, justifyContent: 'center' }}>
          <Txt small bold color={c.onPrimary}>{t('Redémarrer')}</Txt>
        </Pressable>
        <Pressable onPress={() => setHidden(true)} accessibilityRole="button" accessibilityLabel={t('Plus tard')} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="close" size={16} color={c.onInk} />
        </Pressable>
      </View>
    </View>
  )
}
