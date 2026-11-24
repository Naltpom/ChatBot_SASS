// Logique pure (testée sans téléphone) : fraîcheur de la session, message d'erreur de l'API.

/** La session reste utilisable jusqu'à 60 s avant son expiration. */
export const sessionIsFresh = (until: number, now: number) => until - now > 60_000

export function errorMessage(status: number, body: unknown): { message: string; data?: Record<string, any> } {
  let message = `Erreur ${status}`
  let data: Record<string, any> | undefined
  const b = body as any
  const d = b?.detail
  if (typeof d === 'string') message = d
  else if (d && typeof d === 'object' && !Array.isArray(d) && d.message) { message = d.message; data = d }
  else if (Array.isArray(d) && d[0]?.msg) message = 'Champ invalide : ' + d[0].msg
  else if (typeof b?.message === 'string') message = b.message
  else if (status === 0) message = 'Connexion impossible : vérifiez votre réseau.'
  else if (status === 429) message = 'Trop de tentatives : réessayez dans un moment.'
  else if (status >= 500) message = 'Le serveur ne répond pas : réessayez dans un moment.'
  return { message, data }
}

/** base64url sans « = » (PKCE). */
export function base64url(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63]
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63]
  }
  return out
}

/** Lit `code` et `state` d'un lien de retour (chapotecm://auth?code=…&state=…). */
export function parseReturn(url: string): { code: string | null; state: string | null } {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : ''
  const params: Record<string, string> = {}
  for (const part of q.split('&')) {
    if (!part) continue
    const [k, v = ''] = part.split('=')
    try { params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')) } catch { /* lien abîmé */ }
  }
  return { code: params.code ?? null, state: params.state ?? null }
}
