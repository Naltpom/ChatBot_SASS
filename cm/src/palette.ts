// Couleur de l'app au choix : orange (défaut), bleu océan, vert forêt. Mémorisée dans le navigateur
// (même clé « cm.palette » que l'app mobile, qui garde son propre choix sur le téléphone).
// Appliquée sur <html data-palette>, avant le premier affichage ; l'icône d'onglet suit la couleur.
export type Palette = 'warm' | 'ocean' | 'forest'
export const PALETTES: { id: Palette; label: string; color: string }[] = [
  { id: 'warm', label: 'Orange', color: '#F05A28' },
  { id: 'ocean', label: 'Bleu océan', color: '#0071e3' },
  { id: 'forest', label: 'Vert forêt', color: '#1f6b4a' },
]
const KEY = 'cm.palette'

export function getPalette(): Palette {
  try { const v = localStorage.getItem(KEY); if (v === 'ocean' || v === 'forest' || v === 'warm') return v } catch { /* stockage indisponible */ }
  return 'warm'
}

function favicon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6.2" fill="${color}"/><rect x="5" y="6.2" width="7.4" height="12.2" rx="1.8" fill="#fff" opacity=".45"/><rect x="8.3" y="5.4" width="7.4" height="12.2" rx="1.8" fill="#fff" opacity=".7"/><rect x="11.6" y="4.6" width="7.4" height="12.8" rx="1.8" fill="#fff"/><path d="M14.3 8.8v4.6l3.6-2.3z" fill="${color}"/></svg>`
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (link) link.href = 'data:image/svg+xml,' + encodeURIComponent(svg)
}

export function applyPalette(p: Palette) {
  const root = document.documentElement
  if (p === 'warm') delete root.dataset.palette; else root.dataset.palette = p
  if (p !== 'warm') favicon(PALETTES.find(x => x.id === p)!.color)
  else { const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]'); if (link) link.href = '/favicon.svg' }
}

export function setPalette(p: Palette) {
  try { localStorage.setItem(KEY, p) } catch { /* stockage indisponible : choix pour cette visite seulement */ }
  applyPalette(p)
}
