// Appels à l'API, sur la même origine : /api/music/... (boutique) et /api/auth/... (compte
// partagé avec chapote.fr). Le cookie de session est posé par l'API (httpOnly).

export interface SheetInfo {
  id: number
  instrument: string
  instrument_label: string
  pages: number
  price_cents: number
  title: string
  reel_url: string | null
  released_at: string | null
  preview: string
  pages_preview: string[]
  cover: string | null
  likes: number | null
  downloads: number
  rating: number | null
  reviews: number
  has_notes: boolean
  published?: boolean
  owned?: boolean
  pages_full?: string[]
  pdf?: string
}

export interface Piece {
  slug: string
  title: string
  composer: string | null
  public_domain: boolean
  sheets: SheetInfo[]
  from_cents: number
  is_new: boolean
  latest: string | null
  cover: string | null
  likes: number | null
  downloads: number
  rating: number | null
  reviews: number
  pricing?: Pricing
  private?: boolean
  admin?: boolean
  subscribed?: boolean
  trial_left?: number
}

export interface Pricing { unit_cents: number; bundle_cents: number | null; currency: string }

export interface Catalog {
  pieces: Piece[]
  total: number
  next_offset: number | null
  instruments: { key: string; label: string }[]
  pricing: Pricing
}

export interface Quote {
  lines: { sheet_id: number; list_cents: number; price_cents: number }[]
  list_total_cents: number
  subtotal_cents: number
  bundle_savings_cents: number
  discount_cents: number
  total_cents: number
  currency: string
  bundles: string[]
  promo_code: string | null
  promo_codes?: string[]
  promos?: { code: string; kind: 'percent' | 'amount'; value: number; cents: number }[]
  promo_error: string | null
}

export interface OrderView {
  order: string
  status: 'pending' | 'paid' | 'expired' | 'failed' | 'refunded'
  key: string | null
  email: string | null
  amount_cents: number
  currency: string
  links_valid: boolean
  items: { id: number; sheet_id: number; has_notes: boolean; instrument: string; piece_title: string; piece_slug: string
           instrument_label: string; pages: number; price_cents: number; download: string | null }[]
}

export interface Me { id: number; email: string; name: string; avatar_url?: string | null; twofa_required?: boolean }

export interface AccountView {
  user: { name: string; email: string; signup_app: string | null; email_verified?: boolean; nickname?: string | null
          avatar?: string | null; password_login?: boolean; twofa_enabled?: boolean; security_url?: string }
  subscription?: Subscription | null
  sheets: { sheet_id: number; piece_slug: string; piece_title: string; instrument_label: string; pages: number
            has_notes: boolean; bought_at: string | null; download: string | null; my_rating: number | null }[]
}

export interface ReviewItem { id: number; rating: number; comment: string | null; author: string; instrument_label: string; date: string }
export interface ReviewsPage { total: number; next_offset: number | null; reviews: ReviewItem[] }

/** Notes du lecteur : [t, d, p, v, main (0 gauche / 1 droite), rôle (1 mélodie / 0 accompagnement), élément?] */
export type NoteRow = [number, number, number, number, number, number, string?]
export interface NotesData {
  instrument: string
  duration: number
  bpm: number | null
  notes: NoteRow[]
  full: boolean
  full_duration?: number
  preview_seconds?: number
  cursor?: CursorEvent[]
  audio?: string | null   // son exact du Reel (MP3) : joué à la place de la synthèse
}

/** [temps (s), page (0…), x, haut, bas du système] — fractions de la page A4 */
export type CursorEvent = [number, number, number, number, number]

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Chapote-App': 'music', ...(init?.headers || {}) },
    })
  } catch {
    throw new ApiError(0, 'network', 'network')
  }
  if (!res.ok) {
    let code = `http_${res.status}`, message = ''
    try {
      const body = await res.json()
      const d = body?.detail
      if (d && typeof d === 'object' && !Array.isArray(d)) { code = d.code || code; message = d.message || '' }
      else if (typeof d === 'string') message = d
    } catch { /* corps non JSON */ }
    throw new ApiError(res.status, code, message)
  }
  return res.json() as Promise<T>
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const getConfig = () => call<{ google_client_id: string | null }>('/api/music/config')
export const getCatalog = (opts: { q?: string; instrument?: string; offset?: number; limit?: number; sort?: string }) => {
  const p = new URLSearchParams()
  if (opts.q) p.set('q', opts.q)
  if (opts.instrument) p.set('instrument', opts.instrument)
  p.set('offset', String(opts.offset || 0))
  p.set('limit', String(opts.limit || 24))
  if (opts.sort) p.set('sort', opts.sort)
  return call<Catalog>(`/api/music/catalog?${p}`)
}
export const getPiece = (slug: string) => call<Piece>(`/api/music/pieces/${encodeURIComponent(slug)}`)
export const getReviews = (slug: string, offset = 0) =>
  call<ReviewsPage>(`/api/music/pieces/${encodeURIComponent(slug)}/reviews?offset=${offset}&limit=10`)
export const postReview = (sheetId: number, rating: number, comment: string) =>
  post<{ id: number }>(`/api/music/sheets/${sheetId}/review`, { rating, comment: comment || null })
export const getNotes = (sheetId: number, auth?: { order?: string; k?: string }) => {
  const p = new URLSearchParams()
  if (auth?.order) p.set('order', auth.order)
  if (auth?.k) p.set('k', auth.k)
  return call<NotesData>(`/api/music/sheets/${sheetId}/notes?${p}`)
}
export const postQuote = (sheet_ids: number[], promo_codes: string[] = []) =>
  post<Quote>('/api/music/quote', { sheet_ids, promo_codes })
export const postCheckout = (body: { sheet_ids: number[]; promo_codes?: string[]; email?: string; consent: boolean; lang: string; track?: string }) =>
  post<{ order: string; redirect: string }>('/api/music/checkout', {
    ...body, promo_codes: body.promo_codes || [], email: body.email || null,
  })
export const getOrder = (order: string, auth: { k?: string; session_id?: string }) => {
  const p = new URLSearchParams()
  if (auth.k) p.set('k', auth.k)
  if (auth.session_id) p.set('session_id', auth.session_id)
  return call<OrderView>(`/api/music/orders/${encodeURIComponent(order)}?${p}`)
}

// --- compte (partagé avec chapote.fr) ---
export const getMe = () => call<Me>('/api/auth/me')
export const getAccount = () => call<AccountView>('/api/music/account')
export interface Subscription { status: string; plan?: 'week' | 'month' | 'year'; price_cents?: number; weekly_cents: number; trial_end: string | null; current_period_end: string | null
  cancel_at_period_end: boolean; trial_downloads_left: number | null; retention_applied?: boolean }
export type Plan = 'week' | 'month' | 'year'
export interface Offer { variant: 'sheet' | 'sub'; plans: { plan: Plan; cents: number }[]; sub_weekly_cents: number; currency: string
  trial_days: number; first_discount_pct?: number; trial_downloads: number }
export const getOffer = (b: string | null, code?: string) => {
  const p = new URLSearchParams()
  if (b) p.set('b', b)
  if (code) p.set('code', code)
  return call<Offer>(`/api/music/offer?${p}`)
}
export const subscribe = (body: { plan: Plan; promo_code?: string; consent: boolean; lang: string; track?: string }) =>
  post<{ redirect: string }>('/api/music/subscribe', { ...body, promo_code: body.promo_code || null, track: body.track || null })
export const cancelSubscription = () => post<{ subscription: Subscription }>('/api/music/subscription/cancel', {})
export const getRetention = () => post<{ eligible: boolean; percent: number | null; next_cents: number | null }>('/api/music/subscription/retention', {})
export const retainSubscription = () => post<{ subscription: Subscription }>('/api/music/subscription/retain', {})
export const patchProfile = (body: { name?: string; nickname?: string }) =>
  call<{ name: string; nickname: string | null }>('/api/music/account/profile', { method: 'PATCH', body: JSON.stringify(body) })
export const changePassword = (current_password: string, new_password: string) => post<{ changed: boolean }>('/api/auth/password', { current_password, new_password })
export async function uploadAvatar(file: File): Promise<void> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch('/api/music/account/avatar', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Chapote-App': 'music' } })
  if (!r.ok) {
    const j = await r.json().catch(() => null)
    throw new ApiError(r.status, j?.detail?.code || `http_${r.status}`, j?.detail?.message || '')
  }
}
export const login = (email: string, password: string) => post<Me>('/api/auth/login', { email, password })
export const register = (name: string, email: string, password: string) =>
  post<Me>('/api/auth/register', { name, email, password, account_type: 'perso', invites: [] })
export const googleLogin = (credential: string) => post<Me>('/api/auth/google', { credential })
export const logout = () => post<{ ok: boolean }>('/api/auth/logout', {})
export const requestVerifyEmail = () => post<{ sent: boolean }>('/api/auth/verify-email/request', {})
