// Erreurs inattendues : au lieu de fermer l'app, on affiche le message (à envoyer pour corriger)
// et on le garde pour l'écran Réglages.
import AsyncStorage from '@react-native-async-storage/async-storage'

type Listener = (e: { message: string; stack?: string }) => void
const listeners = new Set<Listener>()
export const onCrash = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export const CRASH_KEY = 'cm.last-error'

export function remember(e: unknown) {
  const err = e as { message?: string; stack?: string }
  const info = { message: String(err?.message || e), stack: String(err?.stack || '').split('\n').slice(0, 8).join('\n'), at: new Date().toISOString() }
  AsyncStorage.setItem(CRASH_KEY, JSON.stringify(info)).catch(() => {})
  return info
}

let installed = false
export function installCrashHandler() {
  if (installed) return
  installed = true
  const g = globalThis as unknown as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } }
  const eu = g.ErrorUtils
  if (!eu) return
  const prev = eu.getGlobalHandler()
  eu.setGlobalHandler((e, fatal) => {
    const info = remember(e)
    if (fatal && listeners.size) { listeners.forEach(fn => fn(info)); return }
    prev(e, fatal)
  })
}
