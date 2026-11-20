// Appels à l'API de la boutique, sur la même origine (/api/music/...).

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
  pricing?: Pricing
}

export interface Pricing { unit_cents: number; bundle_cents: number | null; currency: string }

export interface Catalog {
  pieces: Piece[]
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
  items: { id: number; piece_title: string; piece_slug: string; instrument_label: string; pages: number; price_cents: number; download: string | null }[]
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  } catch {
    throw new ApiError(0, 'network', 'network')
  }
  if (!res.ok) {
    let code = `http_${res.status}`, message = ''
    try {
      const body = await res.json()
      const d = body?.detail
      if (d && typeof d === 'object') { code = d.code || code; message = d.message || '' }
      else if (typeof d === 'string') message = d
    } catch { /* corps non JSON */ }
    throw new ApiError(res.status, code, message)
  }
  return res.json() as Promise<T>
}

export const getCatalog = (q = '', instrument = '') => {
  const p = new URLSearchParams()
  if (q) p.set('q', q)
  if (instrument) p.set('instrument', instrument)
  return call<Catalog>(`/api/music/catalog?${p}`)
}
export const getPiece = (slug: string) => call<Piece>(`/api/music/pieces/${encodeURIComponent(slug)}`)
export const postQuote = (sheet_ids: number[], promo_code?: string) =>
  call<Quote>('/api/music/quote', { method: 'POST', body: JSON.stringify({ sheet_ids, promo_code: promo_code || null }) })
export const postCheckout = (body: { sheet_ids: number[]; promo_code?: string; email?: string; consent: boolean; lang: string }) =>
  call<{ order: string; redirect: string }>('/api/music/checkout', {
    method: 'POST', body: JSON.stringify({ ...body, promo_code: body.promo_code || null, email: body.email || null }),
  })
export const getOrder = (order: string, auth: { k?: string; session_id?: string }) => {
  const p = new URLSearchParams()
  if (auth.k) p.set('k', auth.k)
  if (auth.session_id) p.set('session_id', auth.session_id)
  return call<OrderView>(`/api/music/orders/${encodeURIComponent(order)}?${p}`)
}
