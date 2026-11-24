// Appels à l'API, sur la même origine (emails.chapote.fr) : /api/emails/... (administration),
// /api/auth/... (compte partagé avec chapote.fr). Le cookie de session est posé par l'API (httpOnly).
// L'en-tête X-Chapote-App: emails identifie le service et sert de défense CSRF au consentement OAuth.

export interface Me { id: number; email: string; name: string; avatar_url?: string | null; is_superadmin?: boolean }
export interface TwoFAChallenge { twofa_required: true; challenge: string; methods: { totp: boolean; passkey: boolean; recovery: boolean } }
export type AccessReason = 'superadmin_required' | 'twofa_setup_required' | 'twofa_session_required' | 'auth_required'
export interface Access { allowed: boolean; reason: AccessReason | null; message: string | null; twofa_enabled: boolean; mcp_url: string }
export interface PublicConfig { google_client_id: string | null; app_url: string; mcp_url: string }

export type Tls = 'ssl' | 'starttls' | 'none'
export interface Mailbox {
  id: number; slug: string; address: string; label: string | null; preset: string | null
  imap_host: string; imap_port: number; imap_tls: Tls; smtp_host: string; smtp_port: number; smtp_tls: Tls
  username: string; has_password: boolean; allow_send: boolean; allow_delete: boolean; save_sent: boolean; is_active: boolean
  last_check_at: string | null; last_check_ok: boolean | null; last_check_error: string | null
}
export type MailboxInput = Partial<Omit<Mailbox, 'id' | 'has_password' | 'last_check_at' | 'last_check_ok' | 'last_check_error'>> & { password?: string }
export interface Preset { id: string; label: string; imap_host: string; imap_port: number; imap_tls: Tls; smtp_host: string; smtp_port: number; smtp_tls: Tls; save_sent: boolean; help: string }
export interface CheckResult { ok: boolean; error?: string; code?: string; folders?: number; gmail?: boolean; special?: Record<string, string | null> }
export interface OAuthClient { id: number; client_id: string; client_name: string | null; redirect_hosts: string[]; created_at: string | null; last_used_at: string | null; revoked_at: string | null; active_tokens: number }
export interface ActiveToken { id: number; family_id: string; client_name: string | null; client_id: string; user_email: string; connected_at: string | null; last_used_at: string | null; access_expires_at: string | null; refresh_expires_at: string | null }
export interface AuditItem { id: number; at: string | null; client: string | null; tool: string; mailbox: string | null; status: 'ok' | 'error' | 'denied'; error_code: string | null; duration_ms: number | null; items: number | null }
export interface ConsentInfo { client_name: string; client_id: string; redirect_host: string; scope: string; user_email: string; mailboxes: { slug: string; address: string; allow_send: boolean; allow_delete: boolean }[] }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const REASONS: Record<string, string> = {
  superadmin_required: 'Réservé au superadmin.',
  twofa_setup_required: 'Activez la double authentification sur chapote.fr.',
  twofa_session_required: 'Reconnectez-vous en validant la double authentification.',
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Chapote-App': 'emails', ...(init?.headers || {}) },
    })
  } catch {
    throw new ApiError(0, 'Connexion impossible : vérifiez votre réseau.')
  }
  if (!res.ok) {
    let message = `Erreur ${res.status}`
    try {
      const body = await res.json()
      const d = body?.detail
      if (typeof d === 'string') message = REASONS[d] || d
      else if (Array.isArray(d) && d[0]?.msg) message = 'Champ invalide : ' + d[0].msg
      else if (body?.message) message = body.message
    } catch { /* corps non JSON */ }
    throw new ApiError(res.status, message)
  }
  return await res.json() as T
}

const send = <T>(method: string, path: string, body?: unknown) =>
  call<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

// --- Compte ---
export const getMe = () => call<Me>('/api/auth/me')
export const login = (email: string, password: string) => send<Me | TwoFAChallenge>('POST', '/api/auth/login', { email, password })
export const googleLogin = (credential: string) => send<Me | TwoFAChallenge>('POST', '/api/auth/google', { credential })
export const totpLogin = (challenge: string, code: string, recovery: boolean) =>
  send<Me>('POST', recovery ? '/api/auth/2fa/login/recovery' : '/api/auth/2fa/login/totp', { challenge, code })
export const passkeyBegin = (challenge: string) => send<{ options: string }>('POST', '/api/auth/2fa/login/webauthn/begin', { challenge })
export const passkeyComplete = (challenge: string, credential: unknown) =>
  send<Me>('POST', '/api/auth/2fa/login/webauthn/complete', { challenge, credential })
export const logout = () => send<{ ok: boolean }>('POST', '/api/auth/logout', {})
export const publicConfig = () => call<PublicConfig>('/api/emails/public-config')
export const getAccess = () => call<Access>('/api/emails/access')

// --- Boîtes ---
export const getPresets = () => call<Preset[]>('/api/emails/presets')
export const getMailboxes = () => call<Mailbox[]>('/api/emails/mailboxes')
export const createMailbox = (body: MailboxInput) => send<Mailbox>('POST', '/api/emails/mailboxes', body)
export const updateMailbox = (id: number, body: MailboxInput) => send<Mailbox>('PATCH', `/api/emails/mailboxes/${id}`, body)
export const deleteMailbox = (id: number) => send<{ ok: boolean }>('DELETE', `/api/emails/mailboxes/${id}`)
export const testMailbox = (id: number) => send<CheckResult>('POST', `/api/emails/mailboxes/${id}/test`)
export const testUnsaved = (body: MailboxInput) => send<CheckResult>('POST', '/api/emails/mailboxes/test', body)

// --- Accès Claude ---
export const getClients = () => call<OAuthClient[]>('/api/emails/clients')
export const getTokens = () => call<ActiveToken[]>('/api/emails/tokens')
export const revokeToken = (id: number) => send<{ ok: boolean }>('POST', `/api/emails/tokens/${id}/revoke`)
export const revokeClient = (id: number) => send<{ ok: boolean }>('POST', `/api/emails/clients/${id}/revoke`)
export const revokeAll = () => send<{ ok: boolean; revoked: number }>('POST', '/api/emails/tokens/revoke-all')

// --- Journal ---
export function getAudit(f: { cursor?: number | null; tool?: string; mailbox?: string; status?: string }) {
  const p = new URLSearchParams({ limit: '50' })
  if (f.cursor) p.set('cursor', String(f.cursor))
  if (f.tool) p.set('tool', f.tool)
  if (f.mailbox) p.set('mailbox', f.mailbox)
  if (f.status) p.set('status', f.status)
  return call<{ items: AuditItem[]; next_cursor: number | null }>(`/api/emails/audit?${p}`)
}

// --- Consentement OAuth ---
export const getConsent = (req: string) => call<ConsentInfo>(`/api/emails/oauth/request?req=${encodeURIComponent(req)}`)
export const postConsent = (req: string, approve: boolean) => send<{ redirect: string }>('POST', '/api/emails/oauth/consent', { req, approve })
