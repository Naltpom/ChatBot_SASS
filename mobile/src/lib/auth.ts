// Connexion de l'app : par le navigateur intégré (même compte que le site : Google, double
// authentification…) ou par le formulaire e-mail / mot de passe. Les deux finissent par un jeton
// d'appareil gardé dans le coffre du téléphone (voir api/src/routers/cm_mobile.py).
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as Linking from 'expo-linking'
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
  const redirect = Linking.createURL('auth')
  const url = `${API_URL}/api/cm/mobile/connect?` + new URLSearchParams({ redirect_uri: redirect, challenge, state }).toString()
  const result = await WebBrowser.openAuthSessionAsync(url, redirect)
  if (result.type !== 'success') return null
  const back = parseReturn(result.url)
  if (!back.code || back.state !== state) throw new ApiError(400, 'Connexion interrompue : recommencez.')
  return store(await callPublic<DeviceOut>('/api/cm/mobile/token', { code: back.code, verifier, ...deviceInfo() }))
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
