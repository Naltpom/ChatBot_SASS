// Connexion de l'app : par le navigateur intégré (même compte que le site : Google, double
// authentification…) ou par le formulaire e-mail / mot de passe. Les deux finissent par un jeton
// d'appareil gardé dans le coffre du téléphone (voir api/src/routers/cm_mobile.py).
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
  return out.user
}

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
  if ('twofa_required' in r) return r
  return finishCookieLogin()
}

/** Formulaire : mot de passe, puis éventuellement le code de double authentification. */
export async function loginWithPassword(email: string, password: string): Promise<Me | TwoFAChallenge> {
  const r = await callPublic<Me | TwoFAChallenge>('/api/auth/login', { email, password }, true)
  if ('twofa_required' in r) return r
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
