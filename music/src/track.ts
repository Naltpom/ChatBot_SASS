// Suivi des liens envoyés (?b=<code>) : le code du lien suit le visiteur pendant son parcours (stockage local), et
// ses actions (pages, lecture, panier, paiement) sont envoyées à /api/music/track SEULEMENT s'il a accepté.
// Sans code de lien, rien n'est suivi. ?code=<promo> pré-remplit le code promo du panier.
const CODE_RE = /^[a-z0-9]{6,16}$/
const PROMO_RE = /^[A-Za-z0-9_-]{2,40}$/

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* rien */ } },
  del: (k: string) => { try { localStorage.removeItem(k) } catch { /* rien */ } },
}

/** À l'arrivée : lit ?b= et ?code=, les garde, et les retire de l'adresse (un lien partagé ne transmet pas le code). */
export function captureParams(): void {
  const url = new URL(window.location.href)
  const b = (url.searchParams.get('b') || '').toLowerCase()
  const code = url.searchParams.get('code') || ''
  let changed = false
  if (CODE_RE.test(b)) {
    if (store.get('gh-b') !== b) { store.set('gh-b', b); store.del('gh-landed') }
    url.searchParams.delete('b'); changed = true
  }
  if (PROMO_RE.test(code)) { store.set('gh-promo', code.toUpperCase()); url.searchParams.delete('code'); changed = true }
  if (changed) window.history.replaceState(window.history.state, '', url.pathname + (url.search || '') + url.hash)
}

export const trackCode = () => store.get('gh-b')
export const savedPromo = () => store.get('gh-promo') || ''
export const consentState = () => store.get('gh-track') as 'yes' | 'no' | null
export const trackingOn = () => !!trackCode() && consentState() === 'yes'

function visitId(): string {
  try {
    let v = sessionStorage.getItem('gh-visit')
    if (!v) { v = Math.random().toString(36).slice(2, 10).padEnd(8, '0'); sessionStorage.setItem('gh-visit', v) }
    return v
  } catch { return 'nostore0' }
}

type Ev = { kind: string; path?: string; data?: Record<string, unknown> }
let queue: Ev[] = []
let timer: number | undefined

function flush(beacon = false) {
  const code = trackCode()
  if (!queue.length || !code || consentState() !== 'yes') { queue = []; return }
  const body = JSON.stringify({ code, visit: visitId(), events: queue.splice(0, 40) })
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/music/track', new Blob([body], { type: 'application/json' }))
  } else {
    fetch('/api/music/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  }
  if (queue.length) flush(beacon)
}

/** Une action du visiteur (ignorée sans lien suivi ou sans accord). */
export function track(kind: string, data?: Record<string, unknown>): void {
  if (!trackingOn()) return
  queue.push({ kind, path: window.location.pathname, data })
  window.clearTimeout(timer)
  timer = window.setTimeout(() => flush(), 2500)
}

export function setConsent(yes: boolean): void {
  store.set('gh-track', yes ? 'yes' : 'no')
  if (yes) landing()
}

/** Arrivée par le lien : une fois par code, dès que le suivi est accepté. */
export function landing(): void {
  if (!trackingOn() || store.get('gh-landed') === trackCode()) return
  store.set('gh-landed', trackCode() || '')
  track('landing')
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true) })
}
