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

export async function api<T = any>(path: string, options: { method?: string; body?: any } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

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

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_URL}/api/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, data.detail || `Upload échoué (${res.status})`)
  }
  return (await res.json()).url
}

export { API_URL }
