// Se connecter avec l'empreinte ou le visage, à la place du code de double authentification.
// Sans gestionnaire de clés (Google, Samsung Pass, Dashlane) : le serveur donne une clé secrète, rangée dans la puce
// sécurisée du téléphone et protégée par l'empreinte (expo-secure-store, requireAuthentication). À la connexion, le
// téléphone demande l'empreinte pour la lire, et l'app l'envoie au serveur (qui n'en garde que l'empreinte SHA-256).
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Device from 'expo-device'
import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { bioEnable } from './api'
import { JUST_SIGNED_IN } from './auth-flag'
import { showDialog } from '../ui/dialog'
import { t } from './i18n'

export const passkeyAvailable = (() => {
  if (Platform.OS === 'web') return false
  try { return SecureStore.canUseBiometricAuthentication() } catch { return false }
})()

const secretKey = (userId: number) => `cm.bio.${userId}`
const doneKey = (userId: number) => `cm.bio.on.${userId}`
interface Stored { id: number; secret: string }

/** Ce téléphone a une empreinte active pour ce compte (sans demander l'empreinte). */
export const passkeyDone = async (userId: number) => (await AsyncStorage.getItem(doneKey(userId)).catch(() => null)) != null
/** Numéro de la clé de ce téléphone (pour la reconnaître dans la liste). */
export const passkeyIdHere = async (userId: number) => Number(await AsyncStorage.getItem(doneKey(userId)).catch(() => null)) || null
/** Oublie la clé de ce téléphone (retirée du compte, ou empreinte du téléphone changée). */
export async function forgetPasskey(userId: number) {
  await AsyncStorage.removeItem(doneKey(userId)).catch(() => {})
  await SecureStore.deleteItemAsync(secretKey(userId)).catch(() => {})
}

/** Active l'empreinte sur ce téléphone. Renvoie les codes de secours s'ils viennent d'être créés. */
export async function enablePasskey(userId: number): Promise<string[] | null> {
  // L'empreinte est demandée tout de suite : on voit que c'est bien elle qui servira (et on évite une clé inutile).
  const ok = await LocalAuthentication.authenticateAsync({ promptMessage: t('Activer la connexion par empreinte'), cancelLabel: t('Annuler') })
  if (!ok.success) throw new Error(ok.error === 'user_cancel' || ok.error === 'system_cancel' ? 'cancel' : (ok.error || t('Empreinte non vérifiée.')))
  const name = (Device.deviceName || Device.modelName || t('Téléphone')).slice(0, 80)
  const r = await bioEnable(name)
  const value: Stored = { id: r.id, secret: r.secret }
  await SecureStore.setItemAsync(secretKey(userId), JSON.stringify(value), {
    requireAuthentication: true, authenticationPrompt: t('Activer la connexion par empreinte'),
  })
  await AsyncStorage.setItem(doneKey(userId), String(r.id))
  return r.recovery_codes
}

/** Lit la clé de ce téléphone : le téléphone demande l'empreinte. */
export async function readPasskey(userId: number): Promise<Stored> {
  const raw = await SecureStore.getItemAsync(secretKey(userId), { requireAuthentication: true, authenticationPrompt: t('Connexion à Chapote CM') })
  if (!raw) { await forgetPasskey(userId); throw new Error('NoKey') }
  return JSON.parse(raw) as Stored
}

/** Message clair pour une erreur d'empreinte. */
export function passkeyError(e: unknown): string {
  const k = `${(e as { code?: string })?.code || ''} ${(e as Error)?.message || ''}`
  if (/cancel|annul/i.test(k)) return t('Opération annulée.')
  if (/NoKey|invalidat|not found|introuvable/i.test(k)) return t('L’empreinte n’est plus active sur ce téléphone (empreintes du téléphone changées ?) : utilisez le code, puis réactivez-la dans Réglages.')
  if (/lockout|too many/i.test(k)) return t('Trop d’essais : réessayez dans un moment, ou utilisez le code.')
  return (e as Error)?.message || t('Empreinte non vérifiée.')
}

/** Numéro du compte contenu dans le défi de double authentification (jeton signé, lu sans le vérifier). */
export function challengeUser(challenge: string): number | null {
  try {
    const json = JSON.parse(b64urlDecode(challenge.split('.')[1]))
    return Number(json.sub) || null
  } catch { return null }
}

const askedKey = (userId: number) => `cm.passkey.asked.${userId}`

/** Juste après une connexion : propose une fois l'empreinte. « Plus tard » : reproposé au plus tôt dans 30 jours. */
export async function offerPasskey(userId: number, onYes: () => void) {
  try {
    const at = Number(await AsyncStorage.getItem(JUST_SIGNED_IN))
    if (!at) return
    await AsyncStorage.removeItem(JUST_SIGNED_IN)
    if (!passkeyAvailable || Date.now() - at > 10 * 60_000 || await passkeyDone(userId)) return
    const asked = Number(await AsyncStorage.getItem(askedKey(userId)))
    if (asked && Date.now() - asked < 30 * 864e5) return
    showDialog(t('Se connecter avec l’empreinte ?'),
      t('La prochaine fois, votre empreinte ou votre visage remplacera le code de connexion. Rien n’est demandé en dehors de la connexion.'), [
        { text: t('Plus tard'), style: 'cancel', onPress: () => { AsyncStorage.setItem(askedKey(userId), String(Date.now())).catch(() => {}) } },
        { text: t('Activer'), onPress: onYes },
      ])
  } catch { /* rien */ }
}

/** Décodage base64url (texte ASCII), sans dépendre de atob. */
function b64urlDecode(s: string): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let bits = 0, n = 0, out = ''
  for (const ch of s.replace(/=+$/, '')) {
    const v = A.indexOf(ch)
    if (v < 0) continue
    bits = (bits << 6) | v; n += 6
    if (n >= 8) { n -= 8; out += String.fromCharCode((bits >> n) & 0xff) }
  }
  return out
}
