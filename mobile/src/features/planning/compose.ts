// Nouvelle publication : logique pure (mêmes règles que cm/src/pages/Composer.tsx).
// Options par plateforme, problèmes bloquants, corps de POST /api/cm/posts.
import type { Account, Config, CreatorInfo, Group } from '../../lib/api'

export interface TikTokOpts { mode: 'direct' | 'draft'; privacy: string; comment: boolean; duet: boolean; stitch: boolean
  commercial: boolean; yourBrand: boolean; branded: boolean; text: string }
export interface YouTubeOpts { title: string; description: string; privacy: string; kids: '' | 'yes' | 'no'; synthetic: boolean
  category: string; notify: boolean; tags: string }
export interface InstaOpts { text: string; feed: boolean; collaborators: string }
export type Opts = TikTokOpts | YouTubeOpts | InstaOpts
export type CreatorState = CreatorInfo | 'loading' | { error: string }

export const accKey = (a: { platform: string; id: number }) => `${a.platform}:${a.id}`
export const YT_CATEGORIES: [string, string][] = [['10', 'Musique'], ['22', 'Personnes et blogs'], ['24', 'Divertissement'], ['27', 'Éducation'], ['26', 'Vie pratique et style']]
export const YT_PRIVACY: [string, string][] = [['public', 'Publique'], ['unlisted', 'Non répertoriée'], ['private', 'Privée']]
export const CAPTION_MAX = 2200

export function defaults(a: Pick<Account, 'platform' | 'can_direct'>): Opts {
  if (a.platform === 'tiktok') return { mode: a.can_direct === false ? 'draft' : 'direct', privacy: '', comment: false, duet: false, stitch: false, commercial: false, yourBrand: false, branded: false, text: '' }
  if (a.platform === 'youtube') return { title: '', description: '', privacy: 'public', kids: '', synthetic: false, category: '10', notify: true, tags: '' }
  return { text: '', feed: true, collaborators: '' }
}

/** Heure proposée : l'heure pile suivante. */
export function nextHour(now = new Date()): Date {
  const d = new Date(now.getTime() + 3600e3)
  d.setMinutes(0, 0, 0)
  return d
}

/** Compteurs de la légende. */
export const captionCount = (s: string) => ({ chars: s.length, tags: (s.match(/#/g) || []).length })

/** Pseudos des collaborateurs Instagram (séparés par virgules ou espaces, sans @). */
export const parseCollaborators = (s: string) => [...new Set(s.split(/[\s,;]+/).map(x => x.trim().replace(/^@/, '')).filter(Boolean))]

/** Comptes d'un groupe parmi ceux qu'on connaît. */
export function groupAccounts(g: Group, all: Account[]): Account[] {
  return all.filter(a => g.accounts.some(x => x.platform === a.platform && x.id === a.id))
}

/** Raison pour laquelle un compte ne peut pas être choisi (ou null). */
export const unavailable = (a: Pick<Account, 'can_publish' | 'needs_reconnect'>) =>
  (!a.can_publish ? `Indisponible${a.needs_reconnect ? ' : à reconnecter' : ''}` : null)

export interface ComposeState {
  hasVideo: boolean
  /** Taille du fichier envoyé depuis le téléphone (null : vidéo de la bibliothèque). */
  size: number | null
  /** Durée en secondes (null : inconnue). */
  duration: number | null
  title: string
  chosen: Account[]
  opts: Record<string, Opts>
  creators: Record<string, CreatorState | undefined>
  when: 'now' | 'at'
  at: Date
  sameTime: boolean
  times: Record<string, Date | undefined>
}

/** Problèmes bloquants, en général puis par compte. */
export function problems(s: ComposeState, config: Config | null, now = Date.now(), fmtSize: (b: number) => string = b => `${b} o`,
  fmtDuration: (sec: number) => string = sec => `${sec} s`): string[] {
  const out: string[] = []
  if (!s.hasVideo) out.push('Choisissez une vidéo.')
  if (!s.title.trim()) out.push('Donnez un titre à la publication.')
  if (!s.chosen.length) out.push('Choisissez au moins un compte.')
  if (s.size != null && config && s.size > config.max_upload_bytes) out.push(`Vidéo trop volumineuse (${fmtSize(config.max_upload_bytes)} au plus).`)
  if (s.when === 'at' && s.sameTime && s.at.getTime() < now - 60000) out.push("L'heure choisie est déjà passée.")
  for (const a of s.chosen) {
    const k = accKey(a), o = s.opts[k], n = a.name || a.platform
    if (!o) continue
    if (a.platform === 'tiktok') {
      const t = o as TikTokOpts, ci = s.creators[k]
      if (ci === 'loading') out.push(`${n} : options du compte en cours de lecture…`)
      else if (!ci || 'error' in ci) out.push(`${n} : options du compte TikTok illisibles.`)
      else if (!ci.can_post) out.push(`${n} : ${ci.message || 'publication impossible sur ce compte.'}`)
      else {
        const max = Math.min(ci.creator?.max_video_post_duration_sec || 600, 600)
        if (s.duration != null && s.duration > max) out.push(`${n} : vidéo trop longue (${fmtDuration(max)} au plus sur ce compte).`)
        if (t.mode === 'direct' && !t.privacy) out.push(`${n} : choisissez qui peut voir la vidéo.`)
        if (t.mode === 'direct' && t.commercial && !t.yourBrand && !t.branded) out.push(`${n} : indiquez si le contenu fait votre promotion, celle d'un tiers, ou les deux.`)
      }
    } else if (a.platform === 'youtube') {
      const y = o as YouTubeOpts
      if (!y.kids) out.push(`${n} : indiquez si la vidéo est conçue pour les enfants.`)
      if (s.duration != null && s.duration > (config?.youtube_max_duration_sec || 180)) out.push(`${n} : vidéo trop longue pour un Short (3 min au plus).`)
    } else {
      if (s.duration != null && (s.duration < 3 || s.duration > (config?.instagram_max_duration_sec || 900))) out.push(`${n} : un Reel dure de 3 s à 15 min.`)
      if (parseCollaborators((o as InstaOpts).collaborators).length > 3) out.push(`${n} : 3 collaborateurs au plus.`)
    }
    const own = s.times[k]
    if (s.when === 'at' && !s.sameTime && own && own.getTime() < now - 60000) out.push(`${n} : l'heure choisie est déjà passée.`)
  }
  return out
}

/** Une cible de POST /posts. */
export function buildTarget(a: Account, o: Opts, s: Pick<ComposeState, 'when' | 'at' | 'sameTime' | 'times'>) {
  const k = accKey(a)
  const scheduled_at = s.when === 'now' ? null : (s.sameTime ? s.at : (s.times[k] || s.at)).toISOString()
  if (a.platform === 'tiktok') {
    const t = o as TikTokOpts
    return { platform: a.platform, account_id: a.id, scheduled_at, options: {
      mode: t.mode, privacy_level: t.mode === 'direct' ? t.privacy : null, allow_comment: t.comment, allow_duet: t.duet,
      allow_stitch: t.stitch, brand_organic: t.commercial && t.yourBrand, brand_content: t.commercial && t.branded,
      ...(t.text.trim() ? { title: t.text } : {}) } }
  }
  if (a.platform === 'youtube') {
    const y = o as YouTubeOpts
    return { platform: a.platform, account_id: a.id, scheduled_at, options: {
      ...(y.title.trim() ? { title: y.title.trim() } : {}), ...(y.description.trim() ? { description: y.description } : {}),
      tags: y.tags.split(',').map(x => x.trim()).filter(Boolean), privacy_status: y.privacy, made_for_kids: y.kids === 'yes',
      synthetic_media: y.synthetic, category_id: y.category, notify_subscribers: y.notify } }
  }
  const i = o as InstaOpts
  const collaborators = parseCollaborators(i.collaborators)
  return { platform: a.platform, account_id: a.id, scheduled_at, options: {
    share_to_feed: i.feed, ...(i.text.trim() ? { caption: i.text } : {}), ...(collaborators.length ? { collaborators } : {}) } }
}

/** Corps de POST /api/cm/posts : vidéo du téléphone (file_name + video_size) ou de la bibliothèque (asset_id). */
export function buildBody(org: number | null, s: ComposeState & { caption: string; rights?: string; rightsNote?: string },
  video: { kind: 'file'; name: string; size: number } | { kind: 'asset'; id: number }) {
  const targets = s.chosen.map(a => buildTarget(a, s.opts[accKey(a)] || defaults(a), s))
  const rights = s.rights ? { rights: s.rights, ...(s.rightsNote?.trim() ? { rights_note: s.rightsNote.trim() } : {}) } : {}
  const base = { org_id: org, title: s.title.trim(), caption: s.caption, ...rights, targets }
  return video.kind === 'asset' ? { ...base, asset_id: video.id } : { ...base, file_name: video.name, video_size: video.size }
}

/** Jour (AAAA-MM-JJ) à montrer dans le planning après l'envoi. */
export function landingDay(s: Pick<ComposeState, 'when' | 'at' | 'sameTime' | 'times' | 'chosen'>, now = new Date()): string {
  let d = now
  if (s.when === 'at') {
    const all = s.sameTime ? [s.at] : s.chosen.map(a => s.times[accKey(a)] || s.at)
    d = all.reduce((m, x) => (x < m ? x : m), all[0] || s.at)
  }
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Nom de fichier : celui de la galerie, sinon tiré de l'adresse (avec une extension vidéo). */
export function fileNameOf(uri: string, fileName?: string | null, mime?: string | null): string {
  const raw = fileName || decodeURIComponent(uri.split('/').pop() || '') || 'video'
  if (/\.(mp4|mov|webm|m4v)$/i.test(raw)) return raw
  return `${raw.replace(/\.[^.]+$/, '')}.${mime === 'video/quicktime' ? 'mov' : mime === 'video/webm' ? 'webm' : 'mp4'}`
}

/** Titre proposé à partir du nom de fichier. */
export const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, '').slice(0, 100)
