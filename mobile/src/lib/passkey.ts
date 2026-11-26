// Clé d'accès (« passkey ») : se connecter avec l'empreinte ou le visage, à la place du code de double authentification.
// Module natif présent à partir de la version 6 de l'app ; avant, ces options n'apparaissent pas.
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Device from 'expo-device'
import { NativeModules, Platform } from 'react-native'
import { JUST_SIGNED_IN } from './auth'
import { passkeyRegisterBegin, passkeyRegisterComplete } from './api'
import { showDialog } from '../ui/dialog'

export const passkeyAvailable = (() => {
  if (Platform.OS === 'web' || !NativeModules.Passkey) return false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('react-native-passkey') as typeof import('react-native-passkey')).Passkey.isSupported()
  } catch { return false }
})()

const doneKey = (userId: number) => `cm.passkey.${userId}`
export const passkeyDone = async (userId: number) => (await AsyncStorage.getItem(doneKey(userId)).catch(() => null)) === '1'

/** Enregistre l'empreinte de ce téléphone pour le compte. Renvoie les codes de secours s'ils viennent d'être créés. */
export async function enablePasskey(userId: number): Promise<string[] | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Passkey } = require('react-native-passkey') as typeof import('react-native-passkey')
  const { options } = await passkeyRegisterBegin()
  const credential = await Passkey.create(JSON.parse(options))
  const name = (Device.deviceName || Device.modelName || 'Téléphone').slice(0, 60)
  const r = await passkeyRegisterComplete(credential, name)
  await AsyncStorage.setItem(doneKey(userId), '1').catch(() => {})
  return r.recovery_codes
}

/** Message clair pour une erreur de clé d'accès (annulée, pas d'empreinte enregistrée, etc.). */
export function passkeyError(e: unknown): string {
  const err = e as { error?: string; message?: string }
  const k = `${err?.error || ''} ${err?.message || ''}`
  if (/cancel/i.test(k)) return 'Opération annulée.'
  if (/NoCredentials|no credential/i.test(k)) return 'Aucune empreinte enregistrée pour ce compte sur ce téléphone : utilisez le code.'
  if (/NotSupported|not supported/i.test(k)) return 'Ce téléphone ne permet pas les clés d’accès.'
  return err?.message || 'Empreinte non vérifiée.'
}

const askedKey = (userId: number) => `cm.passkey.asked.${userId}`

/** Juste après une connexion (mot de passe, Google…) : propose une fois l'empreinte, comme iOS propose une clé d'accès.
 *  « Plus tard » : reproposé au plus tôt dans 30 jours. `onYes` ouvre l'activation (avec les codes de secours). */
export async function offerPasskey(userId: number, onYes: () => void) {
  try {
    const at = Number(await AsyncStorage.getItem(JUST_SIGNED_IN))
    if (!at) return
    await AsyncStorage.removeItem(JUST_SIGNED_IN)
    if (!passkeyAvailable || Date.now() - at > 10 * 60_000 || await passkeyDone(userId)) return
    const asked = Number(await AsyncStorage.getItem(askedKey(userId)))
    if (asked && Date.now() - asked < 30 * 864e5) return
    showDialog('Se connecter avec l’empreinte ?',
      'La prochaine fois, votre empreinte ou votre visage remplacera le code de connexion. Rien n’est demandé en dehors de la connexion.', [
        { text: 'Plus tard', style: 'cancel', onPress: () => { AsyncStorage.setItem(askedKey(userId), String(Date.now())).catch(() => {}) } },
        { text: 'Activer', onPress: onYes },
      ])
  } catch { /* rien */ }
}
