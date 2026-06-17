const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getToken(): string | null {
  return localStorage.getItem('cbsaas_token')
}

export function setToken(token: string | null) {
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

// Upload d'image -> renvoie l'URL publique. Délègue à postFile (même endpoint
// multipart, champ `file`).
export async function uploadImage(file: File): Promise<string> {
  const { url } = await postFile<{ url: string }>('/api/uploads', file)
  return url
}

export { API_URL }
