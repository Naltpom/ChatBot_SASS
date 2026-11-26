// Planning : logique pure (testée avec node --test), même règles que cm/src/pages/Planning.tsx et PlanningParts.tsx.
// Aucun import à l'exécution (seulement des types) : le fichier se lit tel quel par Node.
import type { CalendarItem, Group, Platform } from '../../lib/api'

export type State = 'done' | 'planned' | 'failed'
/** Style de la pastille d'une plateforme : plein, pointillé, rouge, ou orange pointillé (brouillon TikTok). */
export type Pill = State | 'draft'
export type Kind = 'all' | 'done' | 'planned'
export type TargetItem = Extract<CalendarItem, { kind: 'target' }>
export type VideoItem = Extract<CalendarItem, { kind: 'video' }>

/** Une vidéo au même moment sur plusieurs plateformes = un seul groupe (une ligne). */
export interface PlanGroup { key: string; items: CalendarItem[]; at: string; title: string | null }

// --- dates (heure locale) ---
const p2 = (n: number) => String(n).padStart(2, '0')
export const dayKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
export const fromKey = (k: string) => new Date(`${k}T12:00:00`)
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const shiftKey = (k: string, n: number) => dayKey(addDays(fromKey(k), n))
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
/** Les 7 jours (lundi → dimanche) de la semaine du jour `k`. */
export const weekKeys = (k: string) => { const s = startOfWeek(fromKey(k)); return Array.from({ length: 7 }, (_, i) => dayKey(addDays(s, i))) }
/** Période chargée pour le jour `k` : sa semaine entière (la bande des 7 jours a ses points). */
export function weekRange(k: string): [Date, Date] {
  const s = startOfWeek(fromKey(k))
  return [s, addDays(s, 7)]
}
/** Recherche : environ un an en arrière et six mois devant (comme le site). */
export function searchRange(now = new Date()): [Date, Date] {
  return [addDays(now, -365), addDays(now, 180)]
}

// --- états ---
export const isPlanned = (i: CalendarItem) => i.kind === 'target' && i.status !== 'PUBLISHED'   // brouillon TikTok : encore à publier
export const stateOf = (i: CalendarItem): State => (i.kind === 'video' ? 'done' : i.status === 'FAILED' ? 'failed' : isPlanned(i) ? 'planned' : 'done')
export const pillOf = (i: CalendarItem): Pill => (i.kind === 'target' && i.status === 'INBOX' ? 'draft' : stateOf(i))
export const STATE_LABEL: Record<State, string> = { done: 'Publiée', planned: 'Programmée', failed: 'Échec' }
export const PILL_LABEL: Record<Pill, string> = { done: 'publiée', planned: 'programmée', failed: 'échec', draft: 'brouillon TikTok' }
export const itemKey = (i: CalendarItem) => `${i.kind}-${i.id}`

/** Titre lisible : 1re ligne, sans les hashtags de fin, 80 caractères au plus. */
export function shortTitle(t: string | null | undefined): string {
  const first = (t || '').split('\n').map(x => x.trim()).find(Boolean) || ''
  const clean = first.replace(/(\s#[^\s#]+)+\s*$/, '').trim() || first
  return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean
}

/** Filtres du planning : annulées masquées, plateformes, publié / programmé. */
export function filterItems(list: CalendarItem[], platforms: Platform[] = [], kind: Kind = 'all'): CalendarItem[] {
  return list
    .filter(i => !(i.kind === 'target' && i.status === 'CANCELLED'))
    .filter(i => !platforms.length || platforms.includes(i.platform))
    .filter(i => kind === 'all' || (kind === 'planned' ? isPlanned(i) : !isPlanned(i)))
}

/** Filtre d'état du planning (liste déroulante). Les trois choix ne se recouvrent pas pour une même plateforme :
 *  action = échec ou brouillon TikTok à publier dans l'app (ce qui attend l'utilisateur) ;
 *  done = publiée (vidéo relevée ou cible PUBLISHED) ; planned = programmée ou en cours d'envoi (rien à faire). */
export type StatusFilter = 'all' | 'action' | 'done' | 'planned'
export const needsAction = (i: CalendarItem) => i.kind === 'target' && (i.status === 'FAILED' || i.status === 'INBOX')
export function matchesStatus(i: CalendarItem, f: StatusFilter): boolean {
  if (f === 'all') return true
  if (f === 'action') return needsAction(i)
  if (f === 'done') return !isPlanned(i)
  return isPlanned(i) && !needsAction(i) && !(i.kind === 'target' && i.status === 'CANCELLED')
}
/** Garde les publications dont au moins une plateforme correspond au filtre (toutes ses plateformes restent affichées). */
export function filterByStatus(list: CalendarItem[], f: StatusFilter): CalendarItem[] {
  if (f === 'all') return list
  const keyOf = (i: CalendarItem) => i.group || itemKey(i)
  const hit = new Set(list.filter(i => matchesStatus(i, f)).map(keyOf))
  return list.filter(i => hit.has(keyOf(i)))
}

/** Éléments rangés par jour local (AAAA-MM-JJ). */
export function byDay(list: CalendarItem[]): Map<string, CalendarItem[]> {
  const m = new Map<string, CalendarItem[]>()
  for (const i of list) { const k = dayKey(new Date(i.at)); const l = m.get(k); if (l) l.push(i); else m.set(k, [i]) }
  return m
}

/** Regroupe : même publication (ou même titre le même jour, 6 h d'écart au plus), jamais deux fois le même compte. */
export function groupItems(list: CalendarItem[]): PlanGroup[] {
  const out: PlanGroup[] = []
  const at = new Map<string, number>()
  for (const i of [...list].sort((a, b) => a.at.localeCompare(b.at))) {
    const base = i.group || itemKey(i)
    let k = base, n = at.get(k), round = 0
    while (n !== undefined && (out[n].items.some(x => x.platform === i.platform && x.account_id === i.account_id)
           || (base.startsWith('t') && Math.abs(new Date(i.at).getTime() - new Date(out[n].at).getTime()) > 6 * 3600e3))) {
      k = `${base}#${++round}`; n = at.get(k)
    }
    if (n === undefined) { at.set(k, out.length); out.push({ key: k, items: [i], at: i.at, title: i.title || null }) }
    else { const g = out[n]; g.items.push(i); if (!g.title && i.title) g.title = i.title }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

/** Numéro de la publication Chapote d'un groupe (clé « p123 » ou cible), sinon null (vidéo publiée ailleurs). */
export function postIdOf(g: PlanGroup): number | null {
  const m = /^p(\d+)/.exec(g.key)
  if (m) return Number(m[1])
  const t = g.items.find(i => i.kind === 'target') as TargetItem | undefined
  return t ? t.post_id : null
}
/** Où ouvre une ligne : la fiche de publication, sinon la fiche vidéo. */
export function openTarget(g: PlanGroup): { pathname: '/post/[id]' | '/video/[id]'; id: string } | null {
  const post = postIdOf(g)
  if (post) return { pathname: '/post/[id]', id: String(post) }
  const v = g.items.find(i => i.kind === 'video')
  return v ? { pathname: '/video/[id]', id: String(v.id) } : null
}

/** Groupe de comptes de la publication (le premier trouvé). */
export function groupOf(items: CalendarItem[], groups: Group[]): Group | null {
  return groups.find(g => items.some(i => g.accounts.some(a => a.platform === i.platform && a.id === i.account_id))) || null
}

/** Résumé d'une ligne (à droite) : échecs, programmée, ou vues. */
export function rowSide(g: PlanGroup, fmt: (n: number) => string = String): { text: string; err: boolean } {
  const states = g.items.map(stateOf)
  const failed = states.filter(s => s === 'failed').length
  if (failed) return { text: `${failed} échec${failed > 1 ? 's' : ''}`, err: true }
  if (states.every(s => s === 'planned')) return { text: g.items.some(i => pillOf(i) === 'draft') ? 'à publier' : 'programmée', err: false }
  const views = g.items.reduce((s, i) => s + (i.kind === 'video' ? i.views || 0 : 0), 0)
  return { text: views ? `${fmt(views)} vues` : '', err: false }
}

/** Petite note sous la ligne : raison de l'échec, ou brouillon TikTok à publier. */
export function rowNote(g: PlanGroup, label: (p: Platform) => string): { text: string; tone: 'danger' | 'warn' } | null {
  const failed = g.items.find(i => i.kind === 'target' && i.status === 'FAILED') as TargetItem | undefined
  if (failed) return { text: `${label(failed.platform)} : ${failed.error_message || 'échec de la publication'}`, tone: 'danger' }
  if (g.items.some(i => i.kind === 'target' && i.status === 'INBOX')) return { text: 'Brouillon dans l’app TikTok : à publier', tone: 'warn' }
  return null
}

/** Libellé accessible d'une ligne. */
export function rowLabel(g: PlanGroup, time: string, label: (p: Platform) => string, groupName?: string | null): string {
  const title = shortTitle(g.title) || 'Sans titre'
  return `${time}, ${title}${groupName ? `, groupe ${groupName}` : ''} : ${g.items.map(i => `${label(i.platform)} ${PILL_LABEL[pillOf(i)]}`).join(', ')}`
}

/** Résumé de la période : publiées, vues, programmées. */
export function periodSummary(items: CalendarItem[]) {
  const done = items.filter(i => !isPlanned(i))
  return {
    done: done.length,
    planned: items.length - done.length,
    views: done.reduce((s, i) => s + (i.kind === 'video' ? i.views || 0 : 0), 0),
  }
}

/** Résultats de recherche par jour, le plus récent d'abord. */
export function searchSections(list: CalendarItem[]): { day: string; groups: PlanGroup[] }[] {
  return [...byDay(list).entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, l]) => ({ day, groups: groupItems(l) }))
}
