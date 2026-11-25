// Clé d'accès (« passkey ») : se connecter avec l'empreinte ou le visage, à la place du code de double authentification.
// Module natif présent à partir de la version 6 de l'app ; avant, ces options n'apparaissent pas.
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Device from 'expo-device'
import { NativeModules, Platform } from 'react-native'
import { passkeyRegisterBegin, passkeyRegisterComplete } from './api'

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
