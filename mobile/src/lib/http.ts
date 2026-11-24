// Transport HTTP de l'app : URL de l'API, session mobile (cookie `chapote_session` d'une heure obtenu
// avec le jeton de l'appareil, voir api/src/routers/cm_mobile.py), nouvel essai après un 401,
// erreurs lisibles en français.
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { errorMessage, sessionIsFresh } from './session-logic'

export const API_URL: string = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl || 'https://cm.chapote.fr'
const DEVICE_KEY = 'cm.device'

export class ApiError extends Error {
  /** `data` : détail structuré renvoyé par l'API (ex. { code: 'account_taken', claim_token }). */
  constructor(public status: number, message: string, public data?: Record<string, any>) { super(message) }
}

let deviceToken: string | null = null
let session: { token: string; until: number } | null = null
let refreshing: Promise<string> | null = null
const signedOutListeners = new Set<() => void>()

export const onSignedOut = (fn: () => void) => { signedOutListeners.add(fn); return () => { signedOutListeners.delete(fn) } }

export async function loadDevice(): Promise<string | null> {
  deviceToken = await SecureStore.getItemAsync(DEVICE_KEY).catch(() => null)
  return deviceToken
}
export const currentDevice = () => deviceToken

export async function saveDevice(token: string, sessionToken?: string, expiresIn?: number) {
  deviceToken = token
  await SecureStore.setItemAsync(DEVICE_KEY, token)
  if (sessionToken && expiresIn) session = { token: sessionToken, until: Date.now() + expiresIn * 1000 }
}

export async function forgetDevice() {
  deviceToken = null
  session = null
  await SecureStore.deleteItemAsync(DEVICE_KEY).catch(() => {})
  signedOutListeners.forEach(fn => fn())
}

async function refresh(): Promise<string> {
  if (!deviceToken) throw new ApiError(401, 'Connectez-vous.')
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/cm/mobile/refresh`, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: deviceToken }),
    })
  } catch {
    throw new ApiError(0, 'Connexion impossible : vérifiez votre réseau.')
  }
  if (res.status === 401) { await forgetDevice(); throw new ApiError(401, 'Session terminée : reconnectez-vous.') }
  if (!res.ok) throw new ApiError(res.status, `Erreur ${res.status}`)
  const body = await res.json() as { session: string; expires_in: number }
  session = { token: body.session, until: Date.now() + body.expires_in * 1000 }
  return body.session
}

/** Cookie de session valide (renouvelé si besoin, une seule requête à la fois). */
export async function sessionCookie(force = false): Promise<string> {
  if (!force && session && sessionIsFresh(session.until, Date.now())) return session.token
  if (!refreshing) refreshing = refresh().finally(() => { refreshing = null })
  return refreshing
}

/** En-têtes d'une requête authentifiée (aussi pour les envois de fichiers et le lecteur vidéo). */
export async function authHeaders(force = false): Promise<Record<string, string>> {
  return { Cookie: `chapote_session=${await sessionCookie(force)}`, 'X-Chapote-App': 'cm-mobile' }
}

async function readError(res: Response): Promise<ApiError> {
  let body: unknown = null
  try { body = await res.json() } catch { /* corps non JSON */ }
  const { message, data } = errorMessage(res.status, body)
  return new ApiError(res.status, message, data)
}

export async function callRaw<T>(path: string, init?: RequestInit): Promise<{ body: T; res: Response }> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(API_URL + path, {
        ...init,
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders(attempt > 0)), ...((init?.headers as Record<string, string>) || {}) },
      })
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new ApiError(0, 'Connexion impossible : vérifiez votre réseau.')
    }
    if (res.status === 401 && attempt === 0 && deviceToken) continue
    if (!res.ok) throw await readError(res)
    return { body: await res.json() as T, res }
  }
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  return (await callRaw<T>(path, init)).body
}

/** Une page de résultats et le curseur de la suivante (en-tête X-Next-Cursor). */
export interface Page<T> { items: T[]; next: string | null }
export async function callPage<T>(path: string): Promise<Page<T>> {
  const { body, res } = await callRaw<T[]>(path)
  return { items: body, next: res.headers.get('X-Next-Cursor') }
}

/** Requête sans session (connexion). */
export async function callPublic<T>(path: string, body: unknown, include = false): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method: 'POST', credentials: include ? 'include' : 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Chapote-App': 'cm-mobile' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Connexion impossible : vérifiez votre réseau.')
  }
  if (!res.ok) throw await readError(res)
  return await res.json() as T
}
