// Session d'édition EMBARQUÉE (pages/embed/*). Lit le fragment d'URL ouvert par
// le plugin WordPress, le NETTOIE de la barre d'adresse, et expose un client API
// dédié authentifié par jeton (Bearer), SANS toucher au cookie de session
// dashboard ni à AuthContext.
//
// Fragment attendu (jamais envoyé au serveur, donc support d'un jeton court) :
//   #t=<embed_token>&bot=<id>&o=<adminOrigin>&n=<nonce>&job=<jobId?>
//
// ⚠ AUTH : l'embed n'a PAS de cookie dashboard (chargé cross-origin dans l'admin
// WP). On authentifie uniquement par `Authorization: Bearer <t>` ; on n'envoie
// donc PAS credentials:'include' (le cookie ne doit pas partir). Ce hook ne doit
// JAMAIS importer useAuth (pas de dev-login localhost, pas de redirection /login).
// ⚠ quirk bun : ne pas se fier à import.meta.env.DEV (reste true sous bun).
import { useCallback, useEffect, useRef } from 'react'
import { API_URL, ApiError } from '../api'

interface EmbedParams {
  token: string
  botId: number
  parentOrigin: string
  nonce: string
  jobId: string | null
}

// Parse + valide le fragment. Renvoie null si un champ requis manque ou si
// l'origine parente n'est pas une origine http(s) valide.
function parseHash(hash: string): EmbedParams | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  const p = new URLSearchParams(raw)
  const token = p.get('t') || ''
  const bot = p.get('bot') || ''
  const o = p.get('o') || ''
  const n = p.get('n') || ''
  const job = p.get('job')
  const botId = Number(bot)
  if (!token || !bot || !Number.isFinite(botId) || botId <= 0 || !o || !n) return null
  let parentOrigin: string
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    parentOrigin = u.origin
  } catch {
    return null
  }
  return { token, botId, parentOrigin, nonce: n, jobId: job || null }
}

export interface EmbedApi {
  <T = unknown>(path: string, options?: { method?: string; body?: unknown }): Promise<T>
}

export interface EmbedSession {
  // true quand le fragment est valide : l'éditeur peut charger le bot.
  ready: boolean
  // Message FR si le lien est invalide/expiré (sinon null).
  error: string | null
  botId: number | null
  parentOrigin: string
  nonce: string
  jobId: string | null
  embApi: EmbedApi
}

export function useEmbedSession(): EmbedSession {
  // Parse UNE SEULE FOIS au 1er rendu (avant le nettoyage du fragment). Un ref
  // évite que le double-montage StrictMode (ou un re-rendu) ne re-parse un hash
  // déjà nettoyé. typeof window guard : l'embed n'est jamais prérendu, mais on
  // reste défensif.
  const paramsRef = useRef<EmbedParams | null | undefined>(undefined)
  if (paramsRef.current === undefined) {
    paramsRef.current = typeof window === 'undefined' ? null : parseHash(window.location.hash)
  }
  const params = paramsRef.current

  // Nettoie le fragment de la barre d'adresse (le jeton ne doit pas traîner dans
  // l'URL/historique). Idempotent -> sûr au double-montage StrictMode.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  // Client API embarqué : Bearer + JSON, PAS de cookie (credentials par défaut
  // 'same-origin' -> le cookie dashboard ne part pas cross-origin). Même contrat
  // d'erreur que api() (ApiError {status, message, code}). Stable (deps []) : le
  // jeton vit dans paramsRef, jamais re-créé.
  const embApi = useCallback<EmbedApi>(async <T = unknown>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> => {
    const p = paramsRef.current
    if (!p) throw new ApiError(0, "Session d'édition invalide.")
    const res = await fetch(`${API_URL}${path}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.token}` },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({} as Record<string, unknown>))
      throw new ApiError(
        res.status,
        (data.detail as string) || (data.message as string) || `Erreur ${res.status}`,
        data.code as string | undefined,
      )
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }, [])

  return {
    ready: !!params,
    error: params ? null : "Lien d'édition invalide ou expiré. Rouvrez l'éditeur depuis votre tableau de bord WordPress.",
    botId: params?.botId ?? null,
    parentOrigin: params?.parentOrigin ?? '',
    nonce: params?.nonce ?? '',
    jobId: params?.jobId ?? null,
    embApi,
  }
}
