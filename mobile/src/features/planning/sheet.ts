// Fiche de publication : logique pure (comme PublicationSheet / PlatformCard du site).
import type { CalendarItem, Post, Target } from '../../lib/api'
import type { TargetItem } from './calendar'

const HASHTAG = /#[^\s#.,;!?]+/g

/** Légende commune : texte sans hashtags, et hashtags à part (sans doublon). */
export function splitCommon(common: string): { body: string; tags: string[] } {
  const tags = [...new Set(common.match(HASHTAG) || [])]
  const body = common.replace(HASHTAG, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { body, tags }
}

const PRIVACY: Record<string, string> = { public: 'Publique', unlisted: 'Non répertoriée', private: 'Privée' }

/** Seulement ce qui diffère du texte commun, pour une plateforme. */
export function diffsOf(item: CalendarItem, common: string): [string, string][] {
  const out: [string, string][] = []
  if (item.kind !== 'target') return out
  const o = item.options || {}
  const own = item.platform === 'instagram' ? o.caption : item.platform === 'tiktok' ? o.title : o.description
  if (own && item.status !== 'INBOX' && String(own).trim() !== common.trim()) out.push([item.platform === 'youtube' ? 'Description' : 'Légende', String(own)])
  if (item.platform === 'youtube' && o.title) out.push(['Titre YouTube', String(o.title)])
  if (item.platform === 'youtube' && Array.isArray(o.tags) && o.tags.length) out.push(['Mots-clés', o.tags.join(', ')])
  if (item.platform === 'youtube' && o.privacy_status) out.push(['Visibilité', `${PRIVACY[o.privacy_status] || 'Privée'}${o.made_for_kids ? ' · pour enfants' : ''}`])
  if (item.platform === 'tiktok' && o.mode === 'draft' && item.status !== 'INBOX') out.push(['Envoi', 'Brouillon dans l’app TikTok'])
  if (item.platform === 'instagram' && Array.isArray(o.collaborators) && o.collaborators.length) out.push(['Collaborateurs', o.collaborators.map((c: string) => `@${c}`).join(', ')])
  if (item.platform === 'instagram' && o.share_to_feed === false) out.push(['Fil', 'Reel seulement (pas dans le fil)'])
  return out
}

/** Une cible du post vue comme un élément du calendrier. */
export const targetItem = (t: Target, title: string): TargetItem => ({ ...t, kind: 'target', at: t.published_at || t.scheduled_at, title })

/** Période à lire dans le calendrier pour retrouver les vidéos publiées d'un post (chiffres, fiche vidéo). */
export function postWindow(post: Post): [Date, Date] | null {
  const times = post.targets.map(t => new Date(t.published_at || t.scheduled_at).getTime()).filter(n => !Number.isNaN(n))
  if (!times.length) return null
  const day = 86400e3
  const start = Math.min(...times) - day
  const end = Math.min(Math.max(...times) + day, start + 119 * day)
  return [new Date(start), new Date(end)]
}

/** Éléments d'une publication : ceux du calendrier (avec les vidéos relevées) puis les cibles manquantes du post. */
export function postItems(post: Post, calendar: CalendarItem[]): CalendarItem[] {
  const own = calendar.filter(i => i.group === `p${post.id}`)
  const out: CalendarItem[] = [...own]
  for (const t of post.targets) {
    if (t.status === 'CANCELLED') continue
    if (own.some(i => (i.kind === 'target' && i.id === t.id) || (i.kind === 'video' && i.platform === t.platform && i.account_id === t.account_id))) continue
    out.push(targetItem(t, post.title))
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

/** Carte ouverte au départ : l'échec s'il y en a un, sinon la seule carte. */
export function initialOpen(items: CalendarItem[]): string | null {
  const f = items.find(i => i.kind === 'target' && i.status === 'FAILED') || (items.length === 1 ? items[0] : null)
  return f ? `${f.kind}-${f.id}` : null
}

/** Le texte modifiable d'une cible (légende ; titre pour YouTube), ou null s'il ne se modifie pas (brouillon TikTok). */
export function editableText(t: Pick<Target, 'platform' | 'options'>): { key: 'caption' | 'title'; label: string; max: number } | null {
  if (t.platform === 'tiktok' && t.options?.mode === 'draft') return null
  if (t.platform === 'instagram') return { key: 'caption', label: 'Légende', max: 2200 }
  if (t.platform === 'youtube') return { key: 'title', label: 'Titre YouTube', max: 100 }
  return { key: 'title', label: 'Légende', max: 2200 }
}

/** Le lien TikTok saisi à la main est-il plausible ? (vide = accepté : facultatif) */
export const tiktokLinkOk = (s: string) => !s.trim() || /^https:\/\/(www\.|vm\.|m\.)?tiktok\.com\//i.test(s.trim())

const LINK: Record<string, RegExp> = {
  tiktok: /^https:\/\/(www\.|vm\.|vt\.|m\.)?tiktok\.com\//i,
  instagram: /^https:\/\/(www\.)?instagram\.com\/([\w.]+\/)?(reels?|p|tv)\/[\w-]+/i,
  youtube: /^https:\/\/((www\.|m\.)?youtube\.com\/(shorts\/|watch\?v=|live\/)|youtu\.be\/)[\w-]{6,}/i,
}
export const LINK_EXAMPLE: Record<string, string> = {
  tiktok: 'https://www.tiktok.com/@compte/video/…', instagram: 'https://www.instagram.com/reel/…', youtube: 'https://youtube.com/shorts/…',
}
/** Le lien collé à la main est-il plausible pour ce réseau ? (vide = accepté : facultatif) */
export const linkOk = (platform: string, s: string) => !s.trim() || (LINK[platform] ?? /^https:\/\//i).test(s.trim())

/** Textes à copier pour publier soi-même : légende (ou titre + description pour YouTube). */
export function manualTexts(t: Pick<Target, 'platform' | 'options'>, common: string): [string, string][] {
  const o = t.options || {}
  const tags = Array.isArray(o.hashtags) && o.hashtags.length ? o.hashtags.map((h: string) => `#${String(h).replace(/^#/, '')}`).join(' ') : ''
  const withTags = (s: string) => (tags && !s.includes(tags) ? `${s}\n\n${tags}` : s).trim()
  if (t.platform === 'youtube') {
    const out: [string, string][] = []
    if (o.title) out.push(['Titre YouTube', String(o.title)])
    const d = String(o.description || common || '').trim()
    if (d) out.push(['Description', d])
    return out
  }
  const own = String((t.platform === 'instagram' ? o.caption : o.title || o.caption) || common || '').trim()
  return own ? [['Légende', withTags(own)]] : []
}
