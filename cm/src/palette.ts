// Apparence de l'app, commune au site et à l'app mobile : couleur (orange par défaut, bleu océan, vert forêt)
// et clair / sombre (comme l'appareil par défaut). Enregistrée sur le compte (GET / PATCH /api/cm/profile) ;
// une copie locale l'applique avant le premier affichage. `rev` = numéro de l'apparence sur le compte :
// au chargement, si le compte a un autre numéro, on reprend ses valeurs ; sinon rien ne change.
// Appliquée sur <html data-palette data-theme> ; l'icône d'onglet suit la couleur.
export type Palette = 'warm' | 'ocean' | 'forest'
export type ThemePref = 'system' | 'light' | 'dark'
export interface Appearance { palette: Palette; theme: ThemePref; rev: number }

export const PALETTES: { id: Palette; label: string; color: string }[] = [
  { id: 'warm', label: 'Orange', color: '#F05A28' },
  { id: 'ocean', label: 'Bleu océan', color: '#0071e3' },
  { id: 'forest', label: 'Vert forêt', color: '#1f6b4a' },
]
export const THEMES: { id: ThemePref; label: string }[] = [
  { id: 'system', label: 'Comme l’appareil' }, { id: 'light', label: 'Clair' }, { id: 'dark', label: 'Sombre' },
]
const KEY = 'cm.appearance'
const OLD_KEY = 'cm.palette'          // ancien choix, gardé dans le navigateur seulement
const isPalette = (v: unknown): v is Palette => v === 'warm' || v === 'ocean' || v === 'forest'
const isTheme = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark'

/** Copie locale (ou valeurs par défaut ; rev -1 = jamais synchronisée). */
export function getAppearance(): Appearance {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (v && isPalette(v.palette) && isTheme(v.theme) && typeof v.rev === 'number') return v
    const old = localStorage.getItem(OLD_KEY)
    return { palette: isPalette(old) ? old : 'warm', theme: 'system', rev: -1 }
  } catch { return { palette: 'warm', theme: 'system', rev: -1 } }
}
export const getPalette = (): Palette => getAppearance().palette

function save(a: Appearance) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); localStorage.setItem(OLD_KEY, a.palette) } catch { /* stockage indisponible */ }
}

function favicon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6.2" fill="${color}"/><rect x="5" y="6.2" width="7.4" height="12.2" rx="1.8" fill="#fff" opacity=".45"/><rect x="8.3" y="5.4" width="7.4" height="12.2" rx="1.8" fill="#fff" opacity=".7"/><rect x="11.6" y="4.6" width="7.4" height="12.8" rx="1.8" fill="#fff"/><path d="M14.3 8.8v4.6l3.6-2.3z" fill="${color}"/></svg>`
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (link) link.href = 'data:image/svg+xml,' + encodeURIComponent(svg)
}

export function applyAppearance(a: Pick<Appearance, 'palette' | 'theme'>) {
  const root = document.documentElement
  if (a.palette === 'warm') delete root.dataset.palette; else root.dataset.palette = a.palette
  if (a.theme === 'system') delete root.dataset.theme; else root.dataset.theme = a.theme
  if (a.palette !== 'warm') favicon(PALETTES.find(x => x.id === a.palette)!.color)
  else { const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]'); if (link) link.href = '/favicon.svg' }
  window.dispatchEvent(new CustomEvent('cm-appearance'))
}
/** Compatibilité : ancien appel au démarrage. */
export const applyPalette = (p: Palette) => applyAppearance({ palette: p, theme: getAppearance().theme })

interface ServerProfile { palette: Palette; theme: ThemePref; prefs_rev: number }
const call = async (init?: RequestInit): Promise<ServerProfile> => {
  const r = await fetch('/api/cm/profile', { credentials: 'same-origin', ...init,
    headers: { 'Content-Type': 'application/json', 'X-Chapote-App': 'cm' } })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

/** Après la connexion : reprend l'apparence du compte si son numéro a changé. Un choix fait sur ce
 *  navigateur avant la synchronisation (rev -1) est envoyé au compte s'il n'y en a pas encore (rev 0). */
export async function syncAppearance(): Promise<void> {
  const local = getAppearance()
  let srv: ServerProfile
  try { srv = await call() } catch { return }
  if (srv.prefs_rev === local.rev) return
  if (local.rev === -1 && srv.prefs_rev === 0 && (local.palette !== 'warm' || local.theme !== 'system')) {
    try { srv = await call({ method: 'PATCH', body: JSON.stringify({ palette: local.palette, theme: local.theme }) }) } catch { return }
  }
  const next = { palette: srv.palette, theme: srv.theme, rev: srv.prefs_rev }
  save(next)
  applyAppearance(next)
}

/** Choix fait ici : appliqué tout de suite, puis enregistré sur le compte (le site et l'app le reprennent). */
export async function setAppearance(change: Partial<Pick<Appearance, 'palette' | 'theme'>>): Promise<void> {
  const cur = getAppearance()
  const next = { ...cur, ...change }
  save(next)
  applyAppearance(next)
  try {
    const srv = await call({ method: 'PATCH', body: JSON.stringify(change) })
    save({ palette: srv.palette, theme: srv.theme, rev: srv.prefs_rev })
  } catch { /* hors ligne : gardé ici, renvoyé au prochain choix */ }
}
export const setPalette = (p: Palette) => setAppearance({ palette: p })
