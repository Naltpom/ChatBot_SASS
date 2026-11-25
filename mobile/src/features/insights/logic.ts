// Calculs sans interface des écrans Commentaires, Stats, Vidéos et Fiche vidéo (testés avec Node) :
// regroupement des commentaires par vidéo, échelle et tracés de la courbe, carte des créneaux,
// état d'un compte, totaux. Jamais d'import de react-native ici.
import type { Account, Comment, CommentStatus, DetailedStats, Platform, SeriesPoint } from '../../lib/api'

// ——— Commentaires ———

export interface CommentGroup {
  key: string; title: string | null; thumb: string | null; videoId: number | null; url: string | null
  items: Comment[]; fresh: number; platforms: Platform[]
}

/** Regroupe une liste de commentaires par vidéo, en gardant l'ordre d'arrivée. */
export function byVideo(items: Comment[]): CommentGroup[] {
  const groups: CommentGroup[] = []
  const at = new Map<string, number>()
  for (const c of items) {
    const key = `${c.platform}:${c.account_id}:${c.media_id || '?'}`
    let i = at.get(key)
    if (i === undefined) {
      i = groups.length
      at.set(key, i)
      groups.push({ key, title: c.video_title, thumb: c.video_thumb || null, videoId: c.video_id ?? null, url: c.video_url,
        items: [], fresh: 0, platforms: [] })
    }
    const g = groups[i]
    g.items.push(c)
    if (c.status === 'new') g.fresh++
    if (!g.platforms.includes(c.platform)) g.platforms.push(c.platform)
  }
  return groups
}

/** Applique les commentaires modifiés (null = retiré) puis le filtre « À traiter ». */
export function applyChanges(items: Comment[], changed: Record<number, Comment | null>, status: string): Comment[] {
  const out = items.map(c => (c.id in changed ? changed[c.id] : c)).filter((c): c is Comment => !!c)
  return status === 'todo' ? out.filter(c => c.status === 'new' || !!c.pending) : out
}

export const STATUS_DONE: Partial<Record<CommentStatus, string>> = { replied: 'Répondu', contacted: 'Contacté', hidden: 'Masqué', ignored: 'Traité' }

/** Message du mode mot-clé, avec {pseudo} remplacé par @auteur. */
export const personalize = (template: string, author: string | null) => template.replace(/\{pseudo\}/g, author ? `@${author}` : '')

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`

export type CommentActionId = 'reply' | 'private' | 'tiktok' | 'copy' | 'dm' | 'hide' | 'done' | 'reopen' | 'profile'
export interface CommentAction { id: CommentActionId; label: string; danger?: boolean }

/** Action principale (un seul bouton visible) et actions du menu « … » d'un commentaire. */
export function commentActions(c: Comment, keyword: boolean): { main: CommentAction | null; more: CommentAction[] } {
  const canPrivate = (c.can_private_reply ?? (c.platform === 'instagram' && !c.private_replied_at)) && c.status !== 'contacted'
  const all: CommentAction[] = []
  if (c.platform !== 'tiktok' && c.status !== 'replied' && !keyword) all.push({ id: 'reply', label: 'Répondre' })
  if (canPrivate) all.push({ id: 'private', label: 'Réponse privée' })
  if (c.platform === 'tiktok' && c.video_url) all.push({ id: 'tiktok', label: 'Répondre dans TikTok' })
  if (keyword) all.push({ id: 'copy', label: 'Copier le message' })
  if (keyword && c.dm_url) all.push({ id: 'dm', label: 'Écrire sur Instagram' })
  if (c.status === 'new' && c.platform !== 'tiktok') all.push({ id: 'hide', label: 'Masquer le commentaire', danger: true })
  if (c.status === 'new') all.push({ id: 'done', label: keyword ? 'Marquer comme contacté' : 'Marquer comme traité' })
  if (c.status !== 'new') all.push({ id: 'reopen', label: 'Remettre à traiter' })
  if (c.profile_url) all.push({ id: 'profile', label: 'Ouvrir le profil' })
  const mainIds: CommentActionId[] = keyword ? ['private', 'copy'] : ['reply', 'tiktok', 'private']
  const main = all.find(a => mainIds.includes(a.id)) || null
  return { main, more: all.filter(a => a !== main) }
}

// ——— Courbe (vues / abonnés empilés par plateforme) ———

export const CHART_PLATFORMS: Platform[] = ['tiktok', 'youtube', 'instagram']

/** Pas « rond » (1, 2, 5 × 10ⁿ) pour les graduations. */
export function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
  const n = raw / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

export interface ChartModel {
  series: SeriesPoint[]; platforms: Platform[]; totals: number[]; top: number; step: number; ticks: number[]
  areas: { platform: Platform; area: string; line: string }[]
  x: (i: number) => number; y: (v: number) => number
  pad: { l: number; r: number; t: number; b: number }
}

/** Prépare la courbe : départ au premier jour relevé, aires empilées, graduations. */
export function chartModel(all: SeriesPoint[], metric: 'views' | 'followers', w: number, h: number,
  pad = { l: 44, r: 8, t: 12, b: 26 }): ChartModel {
  const first = all.findIndex(pt => Object.values(pt.by_platform).some(v => v?.[metric] != null))
  const series = first > 0 ? all.slice(first) : first < 0 ? [] : all
  const platforms = CHART_PLATFORMS.filter(p => series.some(pt => pt.by_platform[p]?.[metric] != null))
  const val = (pt: SeriesPoint, p: Platform) => pt.by_platform[p]?.[metric] ?? 0
  const totals = series.map(pt => platforms.reduce((s, p) => s + val(pt, p), 0))
  const max = Math.max(1, ...totals)
  const step = niceStep(max / 4)
  const top = Math.ceil(max / step) * step
  const iw = Math.max(1, w - pad.l - pad.r), ih = Math.max(1, h - pad.t - pad.b)
  const x = (i: number) => pad.l + (series.length <= 1 ? iw / 2 : (i / (series.length - 1)) * iw)
  const y = (v: number) => pad.t + ih - (v / top) * ih
  const r = (n: number) => Math.round(n * 10) / 10
  let base = series.map(() => 0)
  const areas = platforms.map(p => {
    const lo = base, hi = series.map((pt, i) => lo[i] + val(pt, p))
    base = hi
    const upper = hi.map((v, i) => `${r(x(i))},${r(y(v))}`)
    const lower = lo.map((v, i) => `${r(x(i))},${r(y(v))}`).reverse()
    return { platform: p, area: upper.length ? `M${upper.join('L')}L${lower.join('L')}Z` : '', line: upper.length ? `M${upper.join('L')}` : '' }
  })
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  return { series, platforms, totals, top, step, ticks, areas, x, y, pad }
}

/** Index du point le plus proche d'une abscisse (toucher la courbe). */
export function nearestIndex(px: number, n: number, w: number, pad: { l: number; r: number }): number {
  if (n <= 1) return 0
  const iw = Math.max(1, w - pad.l - pad.r)
  return Math.min(n - 1, Math.max(0, Math.round(((px - pad.l) / iw) * (n - 1))))
}

/** Résumé lu par le lecteur d'écran : premier et dernier jour, total, écart. */
export function chartSummary(m: Pick<ChartModel, 'series' | 'totals'>, label: string, fmt: (n: number) => string, fmtDay: (d: string) => string): string {
  const n = m.series.length
  if (!n) return `${label} : pas encore de relevé.`
  const a = m.totals[0], b = m.totals[n - 1]
  if (n === 1) return `${label} le ${fmtDay(m.series[0].day)} : ${fmt(b)}.`
  const diff = b - a
  return `${label} du ${fmtDay(m.series[0].day)} au ${fmtDay(m.series[n - 1].day)} : de ${fmt(a)} à ${fmt(b)}, ${diff >= 0 ? 'soit +' : 'soit '}${fmt(diff)}.`
}

// ——— Meilleurs moments (jour × tranche de 3 h, heure locale) ———

export const DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']
export const DOW_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
export const SLOTS = ['0h', '3h', '6h', '9h', '12h', '15h', '18h', '21h']

export interface HeatCell { n: number; views: number; avg: number; level: number }
export function heatmap(posts: DetailedStats['posts']) {
  const grid: HeatCell[][] = Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => ({ n: 0, views: 0, avg: 0, level: 0 })))
  for (const p of posts) {
    if (p.views == null) continue
    const d = new Date(p.published_at)
    const c = grid[(d.getDay() + 6) % 7][Math.floor(d.getHours() / 3)]
    c.n++
    c.views += p.views
  }
  let best: { d: number; s: number; avg: number } | null = null
  let max = 1
  grid.forEach(row => row.forEach(c => { if (c.n) { c.avg = c.views / c.n; max = Math.max(max, c.avg) } }))
  grid.forEach((row, d) => row.forEach((c, s) => {
    if (c.n) {
      c.level = 0.18 + 0.82 * (c.avg / max)
      if (!best || c.avg > best.avg) best = { d, s, avg: c.avg }
    }
  }))
  return { grid, best: best as { d: number; s: number; avg: number } | null, empty: !grid.some(r => r.some(c => c.n)) }
}

// ——— Comptes, vidéos ———

export function accountState(a: Pick<Account, 'needs_reconnect' | 'mode' | 'stats'>): { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  if (a.needs_reconnect) return { label: 'À reconnecter', tone: 'danger' }
  if (a.mode === 'routine') return { label: 'Routine', tone: 'muted' }
  if (a.stats?.error) return { label: 'Relevé en échec', tone: 'warn' }
  return { label: 'Connecté', tone: 'ok' }
}

type Nums = { views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null }
export const interactions = (v: Nums) => (v.likes || 0) + (v.comments || 0) + (v.shares || 0) + (v.saves || 0)
export const engagement = (v: Nums) => (v.views ? interactions(v) / v.views : null)

/** Somme d'un champ sur plusieurs vidéos (null si aucune valeur connue). */
export function sumField<T>(rows: T[], get: (r: T) => number | null | undefined): number | null {
  const vals = rows.map(get).filter((x): x is number => x != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null
}

/** Part (0-100) d'une valeur dans un total, arrondie. */
export const share = (v: number | null | undefined, total: number | null | undefined) =>
  total ? Math.round((100 * (v || 0)) / total) : 0

/** URL absolue d'une ressource de l'API (ex. « /api/cm/assets/3/stream »). */
export const absoluteUrl = (base: string, path: string) => (/^https?:\/\//.test(path) ? path : base.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`))
/** La source est-elle servie par notre API (il faut alors la session) ? */
export const isOwnUrl = (base: string, url: string) => url.startsWith(base.replace(/\/$/, '') + '/')

/** Tri : libellé avec flèche du sens. */
export const sortLabel = (label: string, active: boolean, order: 'asc' | 'desc') => (active ? `${label} ${order === 'asc' ? '↑' : '↓'}` : label)

/** Phrase de résumé de la période (ce que l'app a apporté, en clair) : « 30 derniers jours : 12 vidéos sur 3 réseaux, 45 k vues, +230 abonnés. » */
export function periodSentence(days: number, t: { posts: number; views: number | null; followers_delta: number | null }, networks: number,
  fmt: (n: number | null) => string): string {
  const head = days === 365 ? 'Cette année' : `Ces ${days} derniers jours`
  if (!t.posts) return `${head} : aucune vidéo publiée pour l’instant.`
  const parts = [`${plural(t.posts, 'vidéo')} publiée${t.posts > 1 ? 's' : ''}${networks > 1 ? ` sur ${networks} réseaux` : ''}`]
  if (t.views != null) parts.push(`${fmt(t.views)} vues`)
  if (t.followers_delta) parts.push(`${t.followers_delta > 0 ? '+' : '−'}${fmt(Math.abs(t.followers_delta))} abonnés`)
  return `${head} : ${parts.join(', ')}.`
}
