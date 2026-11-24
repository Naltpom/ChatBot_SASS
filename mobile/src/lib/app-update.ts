// Nouvelles versions sans réinstaller : à l'ouverture et au retour dans l'app, on regarde s'il y a une
// mise à jour (EAS Update), on la télécharge, puis une fenêtre propose de redémarrer. Ne concerne que
// le code de l'app ; un changement natif (nouveau module, permission) demande un nouvel APK.
import * as Updates from 'expo-updates'
import { useEffect, useRef } from 'react'
import { Alert, AppState } from 'react-native'

export function useAppUpdate() {
  const busy = useRef(false)
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return
    const check = async () => {
      if (busy.current) return
      busy.current = true
      try {
        const found = await Updates.checkForUpdateAsync()
        if (!found.isAvailable) return
        const got = await Updates.fetchUpdateAsync()
        const id = (got.manifest as { id?: string } | undefined)?.id || 'nouvelle'
        if (!got.isNew || asked.current === id) return
        asked.current = id
        Alert.alert('Nouvelle version', 'Une nouvelle version de Chapote CM est prête.', [
          { text: 'Plus tard', style: 'cancel' },
          { text: 'Redémarrer', onPress: () => { Updates.reloadAsync().catch(() => {}) } },
        ])
      } catch {
        // pas de réseau, serveur de mises à jour indisponible : on réessaiera au prochain retour
      } finally {
        busy.current = false
      }
    }
    check()
    const sub = AppState.addEventListener('change', s => { if (s === 'active') check() })
    return () => sub.remove()
  }, [])
}
