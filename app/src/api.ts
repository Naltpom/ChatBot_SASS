const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'

export class ApiError extends Error {
  status: number
  // `code` machine du contrat d'erreur unifié backend ({detail, code, message}).
  // Consommé par le mapper de localisation (utils/errors.ts → errMsg).
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Parsing 401 FACTORISÉ (était dupliqué sur api/postForm/streamSSE) : un 401 hors
// /api/auth = session expirée/absente → redirection login. Les 401 des routes
// /api/auth sont des erreurs de credentials (login, register…) : l'écran de login
// gère lui-même, on ne redirige pas. Retourne true si une redirection a été lancée.
function redirectIfSessionExpired(status: number, path: string): boolean {
  if (status === 401 && !path.startsWith('/api/auth')) {
    window.location.href = '/login'
    return true
  }
  return false
}

// Construit une ApiError à partir d'une réponse non-OK, en lisant le contrat
// d'erreur unifié ({detail, code, message}). `detail` reste la source du message
// (rétrocompat) ; `code` alimente le mapper de localisation.
async function toApiError(res: Response, fallback: string): Promise<ApiError> {
  const data = await res.json().catch(() => ({} as any))
  return new ApiError(res.status, data.detail || data.message || fallback, data.code)
}

// Le JWT dashboard vit désormais dans un cookie httpOnly `chapote_session`
// (audit §3.5) : inaccessible au JS, donc plus de localStorage ni d'en-tête
// Authorization ici. `credentials: 'include'` fait porter ce cookie sur chaque
// requête (l'API renvoie Access-Control-Allow-Credentials + origine explicite).
export async function api<T = any>(path: string, options: { method?: string; body?: any } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  redirectIfSessionExpired(res.status, path)
  if (!res.ok) {
    throw await toApiError(res, `Erreur ${res.status}`)
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
    credentials: 'include',
    body: form,
  })
  if (!res.ok) {
    throw await toApiError(res, `Envoi échoué (${res.status})`)
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
    credentials: 'include',
    body: form,
  })
  redirectIfSessionExpired(res.status, path)
  if (!res.ok) {
    throw await toApiError(res, `Erreur ${res.status}`)
  }
  return res.json()
}

// Consomme un flux SSE (text/event-stream) via fetch (credentials: 'include' —
// porte le cookie de session) plutôt qu'EventSource, qui ne gère pas finement
// les requêtes cross-origin avec credentials. Appelle `onEvent` pour chaque
// trame `data: <json>`. Résout quand le serveur ferme le flux ; `signal`
// permet d'annuler (timeout / démontage du composant).
export async function streamSSE(
  path: string,
  onEvent: (ev: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include', signal })
  redirectIfSessionExpired(res.status, path)
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
