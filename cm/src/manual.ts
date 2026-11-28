// Publier soi-même : lien attendu par réseau et textes à copier (même logique que l'app mobile).
import type { Target } from './api'

const LINK: Record<string, RegExp> = {
  tiktok: /^https:\/\/(www\.|vm\.|vt\.|m\.)?tiktok\.com\//i,
  instagram: /^https:\/\/(www\.)?instagram\.com\/([\w.]+\/)?(reels?|p|tv)\/[\w-]+/i,
  youtube: /^https:\/\/((www\.|m\.)?youtube\.com\/(shorts\/|watch\?v=|live\/)|youtu\.be\/)[\w-]{6,}/i,
}
export const LINK_EXAMPLE: Record<string, string> = {
  tiktok: 'https://www.tiktok.com/@compte/video/…', instagram: 'https://www.instagram.com/reel/…', youtube: 'https://youtube.com/shorts/…',
}
/** Le lien collé est-il plausible pour ce réseau ? (vide = accepté : facultatif) */
export const linkOk = (platform: string, s: string) => !s.trim() || (LINK[platform] ?? /^https:\/\//i).test(s.trim())

/** Textes à copier : légende (ou titre + description pour YouTube). */
export function manualTexts(t: Pick<Target, 'platform' | 'options'>, common: string): [string, string][] {
  const o = (t.options || {}) as Record<string, any>
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
