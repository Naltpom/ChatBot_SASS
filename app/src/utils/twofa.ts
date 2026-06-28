// Helpers 2FA côté front : appels API d'enrôlement/gestion + cérémonies
// WebAuthn (passkeys) via @simplewebauthn/browser. Les options renvoyées par
// l'API sont une CHAÎNE JSON (py_webauthn options_to_json) : on la parse avant
// de la passer à startRegistration/startAuthentication.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { api } from '../api'
import type { User } from '../types/auth'

export interface TwoFAStatus {
  totp_enabled: boolean
  passkeys: { id: number; name: string; created_at: string | null; last_used_at: string | null }[]
  recovery_remaining: number
  required: boolean
  enabled: boolean
}

export const getStatus = () => api<TwoFAStatus>('/api/auth/2fa/status')

// --- TOTP (authenticator) ---
export const totpSetup = () =>
  api<{ secret: string; otpauth_uri: string }>('/api/auth/2fa/totp/setup', { method: 'POST' })

export const totpEnable = (code: string) =>
  api<{ recovery_codes: string[] }>('/api/auth/2fa/totp/enable', { method: 'POST', body: { code } })

export const totpDisable = (code: string) =>
  api('/api/auth/2fa/totp/disable', { method: 'POST', body: { code } })

export const regenerateRecovery = (code: string) =>
  api<{ recovery_codes: string[] }>('/api/auth/2fa/recovery/regenerate', { method: 'POST', body: { code } })

// --- Passkeys (WebAuthn) : enrôlement ---
export async function addPasskey(name: string): Promise<void> {
  const { options } = await api<{ options: string }>('/api/auth/2fa/webauthn/register/begin', { method: 'POST' })
  const credential = await startRegistration(JSON.parse(options))
  await api('/api/auth/2fa/webauthn/register/complete', { method: 'POST', body: { name, credential } })
}

export const listPasskeys = () =>
  api<{ id: number; name: string; created_at: string | null; last_used_at: string | null }[]>(
    '/api/auth/2fa/webauthn/credentials')

export const deletePasskey = (id: number) =>
  api(`/api/auth/2fa/webauthn/credentials/${id}`, { method: 'DELETE' })

// --- Login : 2nd facteur (échange du challenge : pose le cookie de session,
// renvoie l'User) ---
export const loginTotp = (challenge: string, code: string) =>
  api<User>('/api/auth/2fa/login/totp', { method: 'POST', body: { challenge, code } })

export const loginRecovery = (challenge: string, code: string) =>
  api<User>('/api/auth/2fa/login/recovery', { method: 'POST', body: { challenge, code } })

export async function loginPasskey(challenge: string): Promise<User> {
  const { options } = await api<{ options: string }>('/api/auth/2fa/login/webauthn/begin',
    { method: 'POST', body: { challenge } })
  const credential = await startAuthentication(JSON.parse(options))
  return api<User>('/api/auth/2fa/login/webauthn/complete',
    { method: 'POST', body: { challenge, credential } })
}

// True si le navigateur supporte WebAuthn (sinon on masque les passkeys).
export const passkeysSupported = () =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential
