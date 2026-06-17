const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Garde SSR : pendant le prérendu Node (vite build --ssg), `localStorage`
// n'existe pas. Tous ces accès sont normalement appelés depuis des effets /
// handlers (jamais au rendu), mais on les rend défensifs pour que l'entrée
// serveur ne puisse pas crasher quoi qu'il arrive.
export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('cbsaas_token')
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return
  if (token) localStorage.setItem('cbsaas_token', token)
  else localStorage.removeItem('cbsaas_token')
}

// En-tête d'authentification commun (Bearer). Vide si pas de token : on laisse
// le serveur répondre 401 plutôt que d'envoyer un header malformé.
function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function api<T = any>(path: string, options: { method?: string; body?: any } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders() }

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  // 401 hors /api/auth = token invalide/expiré → purge + login. Les 401 des
  // routes /api/auth sont des erreurs de credentials (login, register…) : on ne
  // touche pas au token d'une session par ailleurs valide.
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    setToken(null)
    window.location.href = '/login'
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, data.detail || `Erreur ${res.status}`)
  }
  return res.json()
}

// Upload multipart générique (PDF de la base de connaissances, image…) — pas de
// Content-Type manuel (le navigateur pose le boundary), juste le Bearer.
export async function postFile<T = any>(path: string, file: File, field = 'file'): Promise<T> {
  const form = new FormData()
  form.append(field, file)
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, data.detail || `Envoi échoué (${res.status})`)
  }
  return res.json()
}

// Upload multipart générique avec FormData PRÉ-CONSTRUITE (plusieurs champs/
// fichiers, ex. génération d'arbre depuis sources). Comme postFile : pas de
// Content-Type manuel (boundary auto), juste le Bearer, et MÊME gestion 401/
// ApiError que api(). À utiliser quand le caller assemble lui-même le FormData.
export async function postForm<T = any>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  // 401 hors /api/auth = token invalide/expiré → purge + login (idem api()).
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    setToken(null)
    window.location.href = '/login'
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, data.detail || `Erreur ${res.status}`)
  }
  return res.json()
}

// Consomme un flux SSE (text/event-stream) via fetch — et NON EventSource, qui
// ne sait pas envoyer l'en-tête Authorization. Appelle `onEvent` pour chaque
// trame `data: <json>`. Résout quand le serveur ferme le flux ; `signal`
// permet d'annuler (timeout / démontage du composant).
export async function streamSSE(
  path: string,
  onEvent: (ev: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders(), signal })
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    setToken(null)
    window.location.href = '/login'
  }
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `Flux indisponible (${res.status})`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Trames SSE séparées par une ligne vide ; on ne lit que les lignes `data:`.
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const dataLine = frame.split('\n').find(l => l.startsWith('data:'))
      if (!dataLine) continue
      try { onEvent(JSON.parse(dataLine.slice(5).trim())) } catch { /* trame partielle/commentaire : ignorée */ }
    }
  }
}

// Upload d'image -> renvoie l'URL publique. Délègue à postFile (même endpoint
// multipart, champ `file`).
export async function uploadImage(file: File): Promise<string> {
  const { url } = await postFile<{ url: string }>('/api/uploads', file)
  return url
}

export { API_URL }
