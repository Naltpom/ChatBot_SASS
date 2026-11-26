// Connexion de l'app : par le navigateur intégré (même compte que le site : Google, double
// authentification…) ou par le formulaire e-mail / mot de passe. Les deux finissent par un jeton
// d'appareil gardé dans le coffre du téléphone (voir api/src/routers/cm_mobile.py).
import { isChallenge } from './session-logic'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { Platform } from 'react-native'
import { API_URL, ApiError, callPublic, currentDevice, forgetDevice, saveDevice } from './http'
import { base64url, parseReturn } from './session-logic'
import type { Me, TwoFAChallenge } from './api'

interface DeviceOut { refresh_token: string; session: string; expires_in: number; user: Me }

const deviceInfo = () => ({
  name: Device.deviceName || Device.modelName || (Platform.OS === 'ios' ? 'iPhone' : 'Android'),
  platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null,
})

async function store(out: DeviceOut): Promise<Me> {
  await saveDevice(out.refresh_token, out.session, out.expires_in)
  // Connexion qui vient d'avoir lieu : l'app propose ensuite l'empreinte (voir offerPasskey).
  await AsyncStorage.setItem(JUST_SIGNED_IN, String(Date.now())).catch(() => {})
  return out.user
}
export const JUST_SIGNED_IN = 'cm.just-signed-in'

/** Navigateur intégré → page « Autoriser » de l'API → retour dans l'app avec un code (PKCE). */
export async function loginWithBrowser(): Promise<Me | null> {
  const verifier = base64url(Crypto.getRandomBytes(48))
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(verifier))
  const challenge = base64url(new Uint8Array(digest))
  const state = base64url(Crypto.getRandomBytes(12))
  // Toujours chapotecm:// (jamais exp://) : dans Expo Go, un lien exp:// rechargeait tout le projet (page
  // blanche). Sur iPhone, la page de connexion se ferme d'elle-même sur ce lien ; sinon l'app reprend la
  // connexion quand on revient (pickUp).
  const redirect = 'chapotecm://auth'
  const url = `${API_URL}/api/cm/mobile/connect?` + new URLSearchParams({ redirect_uri: redirect, challenge, state }).toString()
  // Gardé sur le téléphone : si l'app redémarre au retour (Expo Go), la connexion se termine à l'ouverture.
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify({ verifier, at: Date.now() })).catch(() => {})
  const result = await WebBrowser.openAuthSessionAsync(url, redirect)
  if (result.type === 'success') {
    const back = parseReturn(result.url)
    if (back.code && back.state === state) {
      await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => {})
      return store(await callPublic<DeviceOut>('/api/cm/mobile/token', { code: back.code, verifier, ...deviceInfo() }))
    }
  }
  // Retour automatique raté (Expo Go…) ou page fermée à la main : l'app reprend la connexion elle-même.
  return pickUp(verifier, 4)
}

const PENDING_KEY = 'cm.pending-login'

async function pickUp(verifier: string, tries: number): Promise<Me | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const out = await callPublic<DeviceOut>('/api/cm/mobile/token/pending', { verifier, ...deviceInfo() })
      await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => {})
      return store(out)
    } catch (e: any) {
      if (e?.status !== 404) throw e
    }
    if (i < tries - 1) await new Promise(r => setTimeout(r, 1000))
  }
  return null
}

/** À l'ouverture de l'écran de connexion : finit une connexion commencée il y a moins de 3 minutes. */
export async function resumeBrowserLogin(): Promise<Me | null> {
  const raw = await SecureStore.getItemAsync(PENDING_KEY).catch(() => null)
  if (!raw) return null
  try {
    const { verifier, at } = JSON.parse(raw) as { verifier: string; at: number }
    if (Date.now() - at > 180_000) { await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => {}); return null }
    return await pickUp(verifier, 2)
  } catch {
    return null
  }
}

/** Google natif (app installée) : jeton d'identité envoyé à /api/auth/google, comme le bouton du site. */
export async function loginWithGoogle(): Promise<Me | TwoFAChallenge | null> {
  const { googleIdToken } = await import('./google')
  const credential = await googleIdToken()
  if (!credential) return null
  const r = await callPublic<Me | TwoFAChallenge>('/api/auth/google', { credential }, true)
  if (isChallenge(r)) return r
  return finishCookieLogin()
}

/** Formulaire : mot de passe, puis éventuellement le code de double authentification. */
export async function loginWithPassword(email: string, password: string): Promise<Me | TwoFAChallenge> {
  const r = await callPublic<Me | TwoFAChallenge>('/api/auth/login', { email, password }, true)
  if (isChallenge(r)) return r
  return finishCookieLogin()
}

/** Création du compte dans l'app (le nom est complété à l'étape « Vos informations »). */
export async function signUpWithPassword(email: string, password: string): Promise<Me> {
  await callPublic<Me>('/api/auth/register', { name: email.split('@')[0].slice(0, 60) || 'Nouveau compte', email, password, account_type: 'perso', invites: [] }, true)
  return finishCookieLogin()
}

/** Lien de réinitialisation du mot de passe envoyé par e-mail. */
export async function sendPasswordLink(email: string): Promise<void> {
  await callPublic('/api/auth/password/forgot', { email }, false)
}

/** Second facteur par l'empreinte (clé d'accès du téléphone), à la place du code. */
export async function loginWithPasskey(challenge: string): Promise<Me> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Passkey } = require('react-native-passkey') as typeof import('react-native-passkey')
  const { options } = await callPublic<{ options: string }>('/api/cm/mobile/passkey/login/begin', { challenge })
  // Sans liste de clés : le téléphone propose ses clés chapote.fr (Google, Samsung Pass…). Avec la liste,
  // Samsung Pass ne retrouvait pas la clé. Le serveur vérifie de toute façon qu'elle appartient à ce compte.
  const credential = await Passkey.get({ ...JSON.parse(options), allowCredentials: [] })
  await callPublic<Me>('/api/cm/mobile/passkey/login/complete', { challenge, credential }, true)
  return finishCookieLogin()
}

export async function loginWithCode(challenge: string, code: string, recovery = false): Promise<Me> {
  await callPublic<Me>(recovery ? '/api/auth/2fa/login/recovery' : '/api/auth/2fa/login/totp', { challenge, code }, true)
  return finishCookieLogin()
}

/** Le cookie posé par /api/auth/login (gardé par le téléphone) sert une fois : créer l'appareil, puis il est effacé. */
async function finishCookieLogin(): Promise<Me> {
  try {
    return await store(await callPublic<DeviceOut>('/api/cm/mobile/devices', deviceInfo(), true))
  } finally {
    await callPublic('/api/auth/logout', {}, true).catch(() => {})
  }
}

export async function logout(): Promise<void> {
  const token = currentDevice()
  if (token) await callPublic('/api/cm/mobile/logout', { refresh_token: token }).catch(() => {})
  await forgetDevice()
}
