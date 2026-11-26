import { getLang, t } from './i18n'
// Appels à l'API, sur la même origine (cm.chapote.fr) : /api/cm/... (planning, chiffres,
// Instagram), /api/tiktok/... et /api/youtube/... (comptes, options du créateur), /api/auth/...
// (compte partagé avec chapote.fr). Le cookie de session est posé par l'API (httpOnly).

export type Platform = 'tiktok' | 'youtube' | 'instagram'
export const PLATFORMS: Platform[] = ['tiktok', 'youtube', 'instagram']
export const PLATFORM_LABEL: Record<Platform, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' }

export interface Me { id: number; email: string; name: string; avatar_url?: string | null; auth_source?: 'local' | 'google' }
export interface TwoFAChallenge { twofa_required: true; challenge: string; methods: { totp: boolean; passkey: boolean; recovery: boolean } }

export interface Stats {
  followers: number | null; views: number | null; likes: number | null; videos: number | null
  updated_at: string | null; error: string | null; delta_followers?: number | null; delta_views?: number | null
}
export interface Account {
  platform: Platform; id: number; name: string | null; avatar_url: string | null
  needs_reconnect: boolean; can_publish: boolean; stats_available: boolean; connected_at: string | null
  mode: 'api' | 'routine'; can_direct?: boolean; can_draft?: boolean; handle?: string | null; username?: string; public_domain_only?: boolean
  stats: Stats | null
  /** Vue « Tous » (?scope=) : espace du compte, son propriétaire, mes droits dessus. */
  org_id?: number | null; owner?: string | null; mine?: boolean; groups?: number[]; role?: CmRole
}
export interface Video {
  id: number; platform: Platform; account_id: number; account_name: string | null; external_id: string
  title: string | null; url: string | null; thumbnail_url: string | null; published_at: string | null
  duration_sec: number | null; views: number | null; likes: number | null; comments: number | null
  shares: number | null; saves: number | null; via_chapote: boolean
}
export interface SeriesPoint { day: string; views: number | null; followers: number | null; by_platform: Partial<Record<Platform, { views: number | null; followers: number | null }>> }
export interface Overview {
  days: number
  totals: { views: number | null; followers: number | null; likes: number | null; views_gained: number | null
    accounts: number; upcoming: number; published: number; failed_recent: number }
  series: SeriesPoint[]; accounts: Account[]; top_videos: Video[]
}
export type TargetStatus = 'DRAFT' | 'SCHEDULED' | 'DISPATCHING' | 'PUBLISHING' | 'AWAITING_ROUTINE' | 'ROUTINE_CLAIMED'
  | 'PUBLISHED' | 'INBOX' | 'FAILED' | 'CANCELLED'
export interface Target {
  id: number; post_id: number; platform: Platform; account_id: number; account_name: string | null
  scheduled_at: string; options: Record<string, any>; status: TargetStatus; external_id: string | null
  url: string | null; fail_reason: string | null; error_message: string | null; notice: string | null
  published_at: string | null; can_edit: boolean; can_retry: boolean; can_cancel?: boolean; is_draft?: boolean
}
export interface Post {
  id: number; org_id?: number | null; title: string; caption: string | null; file_name: string | null; video_size: number
  duration_sec: number | null; status: string; has_media: boolean; created_at: string; targets: Target[]
  rights?: Rights | null; rights_note?: string | null; rights_warning?: string | null
}
export type Rights = 'public_domain' | 'protected' | 'unknown'
export const RIGHTS_LABEL: Record<Rights, string> = { public_domain: 'Domaine public', protected: 'Œuvre protégée', unknown: 'Droits inconnus' }
export const RIGHTS_WARNING = '⚠️ Œuvre protégée : risque de réclamation de droits d’auteur (Content ID, son coupé, vidéo bloquée).'
export const patchPost = (id: number, body: { rights?: Rights; rights_note?: string }) => send<Post>('PATCH', `/api/cm/posts/${id}`, body)
export const setYoutubeAccount = (org: number | null, id: number, body: { public_domain_only: boolean }) =>
  send<Account>('PATCH', `/api/cm/accounts/youtube/${id}${q(org)}`, body)
export type CmRole = 'admin' | 'editor' | 'viewer'
export type Retention = 'keep' | 'delete_after_publish' | 'delete_after_days'
export type StorageState = 'ok' | 'almost_full' | 'full' | 'missing'
export interface Storage {
  connected: boolean; email: string | null; folder_url?: string | null; quota_gb: number | null; used_bytes: number; drive_free_bytes: number | null
  retention: Retention | null; delete_after_days: number | null; state: StorageState; max_quota_gb?: number | null
}
export interface Space { org_id: number | null; name: string; role: string | null; cm_role?: CmRole; group_ids?: number[] | null; owner?: boolean; owner_name?: string | null; accounts?: number; storage?: Storage }
export type GroupColor = 'blue' | 'orange' | 'green' | 'purple' | 'pink' | 'teal' | 'amber' | 'slate'
  | 'red' | 'indigo' | 'cyan' | 'lime' | 'rose' | 'sky' | 'emerald' | 'brown'
export const GROUP_COLORS: GroupColor[] = ['blue', 'sky', 'cyan', 'teal', 'emerald', 'green', 'lime', 'amber', 'orange', 'brown', 'red', 'rose', 'pink', 'purple', 'indigo', 'slate']
export interface Group { id: number; org_id?: number | null; name: string; color: GroupColor | null; accounts: { platform: Platform; id: number }[] }
/** Périmètre affiché : un espace et, éventuellement, un groupe de comptes OU un seul compte ("tiktok:12").
 *  `scope` (« all », « group:3,group:5 »…) : vue combinée de plusieurs espaces, en lecture seule ; prime sur le reste. */
export interface Scope { org: number | null; group: number | null; account?: string | null; scope?: string | null }
export const ALL: Scope = { org: null, group: null, scope: 'all' }

export type CalendarItem =
  | (Video & { kind: 'video'; at: string; group?: string })
  | (Target & { kind: 'target'; at: string; title: string; group?: string; rights?: Rights | null })
export interface CalendarDay { day: string; followers: number | null; views: number | null; followers_delta: number | null; views_delta: number | null }
export interface Calendar { start: string; end: string; items: CalendarItem[]; days: CalendarDay[] }

export type Metric = 'followers' | 'views' | 'likes' | 'comments' | 'shares' | 'saves'
export interface StatRow {
  posts: number; views: number | null; likes: number | null; comments: number | null; shares: number | null
  saves: number | null; interactions: number | null; engagement_rate: number | null; avg_views: number | null
  followers: number | null; followers_delta: number | null
}
export interface PlatformStats extends StatRow { platform: Platform; accounts: number; metrics: Metric[] }
export interface AccountStats extends StatRow { platform: Platform; id: number; name: string | null; avatar_url: string | null; stats_available: boolean }
export interface DetailedStats {
  days: number; totals: StatRow & { accounts: number }; platforms: PlatformStats[]; accounts: AccountStats[]
  posts: { platform: Platform; published_at: string; views: number | null; interactions: number }[]
  metrics: Record<Platform, Metric[]>
}
export interface Config {
  tiktok: boolean; youtube: boolean; instagram_api: boolean; max_upload_bytes: number; part_size: number
  tiktok_title_max: number; youtube_title_max: number; youtube_max_duration_sec: number; youtube_daily_posts: number
  instagram_caption_max: number; instagram_max_duration_sec: number; tiktok_stats: boolean
}
export interface Creator {
  nickname: string | null; username: string | null; avatar_url: string | null; privacy_level_options: string[]
  comment_disabled: boolean; duet_disabled: boolean; stitch_disabled: boolean; max_video_post_duration_sec: number | null
}
export interface CreatorInfo { can_post: boolean; reason_code?: string; message?: string; creator: Creator | null }

export class ApiError extends Error {
  /** `data` : détail structuré renvoyé par l'API (ex. { code: 'account_taken', claim_token }). */
  constructor(public status: number, message: string, public data?: Record<string, any>) { super(message) }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  return (await callRaw<T>(path, init)).body
}

async function callRaw<T>(path: string, init?: RequestInit): Promise<{ body: T; res: Response }> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Chapote-App': 'cm', 'X-Chapote-Lang': getLang(), ...(init?.headers || {}) },
    })
  } catch {
    throw new ApiError(0, t('Connexion impossible : vérifiez votre réseau.'))
  }
  if (!res.ok) {
    let message = t('Erreur {status}', { status: res.status })
    let data: Record<string, any> | undefined
    try {
      const body = await res.json()
      const d = body?.detail
      if (typeof d === 'string') message = d
      else if (d && typeof d === 'object' && !Array.isArray(d) && d.message) { message = d.message; data = d }
      else if (Array.isArray(d) && d[0]?.msg) message = t('Champ invalide : {detail}', { detail: d[0].msg })
      else if (body?.message) message = body.message
    } catch { /* corps non JSON */ }
    throw new ApiError(res.status, message, data)
  }
  return { body: await res.json() as T, res }
}

/** Une page de résultats et le curseur de la suivante (en-tête X-Next-Cursor). */
export interface Page<T> { items: T[]; next: string | null }
async function callPage<T>(path: string): Promise<Page<T>> {
  const { body, res } = await callRaw<T[]>(path)
  return { items: body, next: res.headers.get('X-Next-Cursor') }
}

type ScopeArg = Scope | number | null
const q = (scope: ScopeArg, extra: Record<string, string | number | undefined> = {}) => {
  const p = new URLSearchParams()
  const org = typeof scope === 'object' && scope !== null ? scope.org : scope
  const group = typeof scope === 'object' && scope !== null ? scope.group : null
  const account = typeof scope === 'object' && scope !== null ? scope.account : null
  const multi = typeof scope === 'object' && scope !== null ? scope.scope : null
  if (multi) p.set('scope', multi)
  else if (org != null) p.set('org_id', String(org))
  if (multi) { /* périmètre combiné : rien d'autre */ }
  else if (account) p.set('account', account)
  else if (group != null) p.set('group_id', String(group))
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}
const send = <T>(method: string, path: string, body?: unknown) =>
  call<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

// Compte
export const getMe = () => call<Me>('/api/auth/me')
/** « Donner mon avis » : texte libre, lu par l'administration. */
export const sendFeedback = (text: string) => send<{ ok: boolean }>('POST', '/api/cm/mobile/feedback', { context: 'general', text })

/** « Donner mon avis » sans compte : formulaire public (anti-robot Turnstile). */
export const getContactConfig = () => send<{ enabled: boolean; turnstile_site_key: string | null }>('GET', '/api/cm/mobile/contact-config')
export const sendContact = (body: { name: string; email: string; message: string; website: string; elapsed_ms: number; turnstile_token: string | null }) =>
  send<{ ok: boolean }>('POST', '/api/cm/mobile/contact', body)

export const login = (email: string, password: string) => send<Me | TwoFAChallenge>('POST', '/api/auth/login', { email, password })
export const register = (name: string, email: string, password: string) =>
  send<Me>('POST', '/api/auth/register', { name, email, password, account_type: 'perso', invites: [] })
export const googleLogin = (credential: string) => send<Me | TwoFAChallenge>('POST', '/api/auth/google', { credential })
export const totpLogin = (challenge: string, code: string, recovery = false) =>
  send<Me>('POST', recovery ? '/api/auth/2fa/login/recovery' : '/api/auth/2fa/login/totp', { challenge, code })
export const forgotPassword = (email: string) => send<unknown>('POST', '/api/auth/password/forgot', { email })
export const logout = () => send<{ ok: boolean }>('POST', '/api/auth/logout', {})
export const publicConfig = () => call<{ google_client_id: string | null; app_url: string }>('/api/cm/public-config')

// cm
export const getConfig = () => call<Config>('/api/cm/config')
export const getSpaces = () => call<Space[]>('/api/cm/spaces')
export type Order = 'asc' | 'desc'
/** Recherche et tri faits par l'API (jamais en mémoire côté navigateur). */
export interface ListOpts { q?: string; sort?: string; order?: Order }
export const getAccounts = (s: ScopeArg, opts: ListOpts = {}) => call<Account[]>(`/api/cm/accounts${q(s, { ...opts })}`)
export const syncAccount = (org: number | null, a: Account) => send<Account>('POST', `/api/cm/accounts/${a.platform}/${a.id}/sync${q(org)}`)
export const getOverview = (s: ScopeArg, days: number) => call<Overview>(`/api/cm/overview${q(s, { days })}`)
export const getVideos = (s: ScopeArg, opts: { platform?: string; sort?: string; order?: Order; limit?: number; days?: number }) =>
  call<Video[]>(`/api/cm/videos${q(s, opts)}`)
export const getPosts = (s: ScopeArg, start: Date, end: Date, opts: { q?: string; status?: 'upcoming' | 'published' | 'failed'; order?: Order; limit?: number } = {}) =>
  call<Post[]>(`/api/cm/posts${q(s, { start: start.toISOString(), end: end.toISOString(), ...opts })}`)
export const getVideosPage = (s: ScopeArg, opts: { platform?: string; sort?: string; order?: Order; q?: string; limit?: number; cursor?: string | null }) =>
  callPage<Video>(`/api/cm/videos${q(s, { ...opts, cursor: opts.cursor || undefined })}`)
export const getCalendar = (s: ScopeArg, start: Date, end: Date, search?: string) =>
  call<Calendar>(`/api/cm/calendar${q(s, { start: start.toISOString(), end: end.toISOString(), ...(search ? { q: search } : {}) })}`)
export const getStats = (s: ScopeArg, days: number, opts: ListOpts = {}) => call<DetailedStats>(`/api/cm/stats${q(s, { days, ...opts })}`)

// Groupes de comptes
type GroupBody = { name?: string; color?: GroupColor; accounts?: { platform: Platform; account_id: number }[] }
export const getGroups = (s: ScopeArg) => call<Group[]>(`/api/cm/groups${q(s)}`)
export const createGroup = (org: number | null, body: GroupBody) => send<Group>('POST', '/api/cm/groups', { org_id: org, ...body })
export const updateGroup = (org: number | null, id: number, body: GroupBody) => send<Group>('PATCH', `/api/cm/groups/${id}${q(org)}`, body)
export const deleteGroup = (org: number | null, id: number) => send<{ ok: boolean }>('DELETE', `/api/cm/groups/${id}${q(org)}`)
export const createPost = (body: unknown) => send<{ post_id: number; part_size?: number; part_count?: number; ready?: boolean }>('POST', '/api/cm/posts', body)
export const submitPost = (id: number) => send<Post>('POST', `/api/cm/posts/${id}/submit`)
export const deletePost = (id: number) => send<{ ok: boolean }>('DELETE', `/api/cm/posts/${id}`)
export const patchTarget = (id: number, body: { scheduled_at?: string; options?: Record<string, unknown> }) =>
  send<Target>('PATCH', `/api/cm/targets/${id}`, body)
export const publishNow = (id: number) => send<Target>('POST', `/api/cm/targets/${id}/publish-now`)
export const cancelTarget = (id: number) => send<Target>('POST', `/api/cm/targets/${id}/cancel`)
export const getPost = (id: number) => call<Post>(`/api/cm/posts/${id}`)
export const retryTarget = (id: number) => send<Target>('POST', `/api/cm/targets/${id}/retry`, {})
/** Brouillon TikTok publié à la main dans l'app (lien facultatif). */
export const markPublished = (id: number, url?: string) => send<Target>('POST', `/api/cm/targets/${id}/published`, url ? { url } : {})
/** Brouillon TikTok supprimé dans l'app : renvoyé (même vidéo, même légende). */
export const resendDraft = (id: number) => send<Target>('POST', `/api/cm/targets/${id}/resend-draft`)

/** Couverture personnalisée (JPEG ou PNG, 8 Mo max), utilisée pour Instagram. */
export async function putCover(postId: number, image: File): Promise<void> {
  const res = await fetch(`/api/cm/posts/${postId}/cover`, {
    method: 'PUT', body: image, credentials: 'same-origin',
    headers: { 'Content-Type': image.type || 'application/octet-stream', 'X-Chapote-App': 'cm', 'X-Chapote-Lang': getLang() },
  })
  if (!res.ok) {
    let msg = t('Couverture refusée ({status})', { status: res.status })
    try { const b = await res.json(); if (typeof b?.detail === 'string') msg = b.detail } catch { /* corps non JSON */ }
    throw new ApiError(res.status, msg)
  }
}

export async function putPart(postId: number, index: number, bytes: Blob): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(`/api/cm/posts/${postId}/parts/${index}`, {
        method: 'PUT', body: bytes, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Chapote-App': 'cm', 'X-Chapote-Lang': getLang() },
      })
    } catch {
      if (attempt < 3) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue }
      throw new ApiError(0, t('Envoi interrompu : vérifiez votre connexion et relancez.'))
    }
    if (res.ok) return
    if (res.status >= 500 && attempt < 3) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue }
    let message = t('Envoi refusé ({status})', { status: res.status })
    try { const b = await res.json(); if (typeof b?.detail === 'string') message = b.detail } catch { /* */ }
    throw new ApiError(res.status, message)
  }
}

// Connexion des comptes
export const startOAuth = (platform: Platform, org: number | null) => {
  if (platform === 'instagram') return send<{ authorize_url: string }>('POST', '/api/cm/instagram/oauth/start', { org_id: org })
  return send<{ authorize_url: string }>('POST', `/api/${platform}/oauth/start`, { org_id: org, app: 'cm' })
}
export const exchangeOAuth = (platform: Platform, code: string, state: string) =>
  send<{ account: unknown; org_id: number | null }>('POST',
    platform === 'instagram' ? '/api/cm/instagram/oauth/exchange' : `/api/${platform}/oauth/exchange`, { code, state })
export const addRoutineAccount = (org: number | null, username: string) =>
  send<Account>('POST', '/api/cm/instagram/routine-accounts', { org_id: org, username })
export const disconnect = (org: number | null, a: Account) => {
  if (a.platform === 'instagram') return send<{ ok: boolean; warning: string | null }>('DELETE', `/api/cm/instagram/accounts/${a.id}${q(org)}`)
  return send<{ ok: boolean; warning: string | null }>('DELETE', `/api/${a.platform}/accounts/${a.id}`)
}
export const creatorInfo = (accountId: number) => call<CreatorInfo>(`/api/tiktok/accounts/${accountId}/creator-info`)

// Bibliothèque : dossiers Google Drive partagés avec le robot de Chapote
export interface Source {
  id: number; provider: 'gdrive'; folder_id: string; name: string | null; url: string
  role: 'reader' | 'writer' | null; can_organize: boolean; can_upload?: boolean | null; shared_by: string | null; verified: boolean
  group_id: number | null; move_published: boolean; last_scan_at: string | null; last_error: string | null
  videos: number; new: number; created_at: string; scan?: { ok: boolean; videos?: number; added?: number; error?: string }
  auto_drafts?: boolean; recipe?: Recipe | null
}

// Brouillons automatiques (recette par dossier)
export type DatePattern = 'ymd_hm' | 'ymd' | 'dmy_hm' | 'dmy' | 'compact' | 'none'
export interface Recipe {
  version: 1
  account: { from: 'source' | 'folder'; level: number; map: Record<string, string[]> }
  when: { pattern: DatePattern; default_time: string; timezone: string }
  title: { from: 'folder' | 'file' | 'txt_first_line' }
  caption: { from: 'txt' | 'none' }
  cover: { from: 'image' | 'none' }
}
export interface RecipeExample {
  asset_id: number; path: string; accounts: string[]; folder: string | null; scheduled_at: string | null
  when_from: 'path' | 'date' | null; title: string; caption: string | null; cover: boolean
}
export interface Analysis {
  engine: 'gemini' | 'regles'; recipe: Recipe; explanation: string | null; examples: RecipeExample[]; folders: Record<'1' | '2' | '3', string[]>
  accounts: { key: string; name: string }[]; groups: { key: string; name: string }[]; patterns: Record<DatePattern, string>; videos: number
}
export interface Proposal {
  id: number; org_id?: number | null; status: 'open' | 'used' | 'dismissed'; title: string | null; caption: string | null
  scheduled_at: string | null; when_from: 'path' | 'date' | null
  accounts: { key: string; name: string | null; platform: Platform }[]; asset: Asset | null; created_at: string
}
export const analyzeSource = (org: number | null, id: number) => send<Analysis>('POST', `/api/cm/sources/${id}/analyze${q(org)}`)
export const previewRecipe = (org: number | null, id: number, recipe: Recipe) =>
  send<{ recipe: Recipe; examples: RecipeExample[] }>('POST', `/api/cm/sources/${id}/recipe/preview${q(org)}`, { recipe })
export const saveRecipe = (org: number | null, id: number, recipe: Recipe, auto_drafts: boolean, backlog: boolean) =>
  send<{ source: Source; proposed: number }>('PUT', `/api/cm/sources/${id}/recipe${q(org)}`, { recipe, auto_drafts, backlog })
export const getProposalsPage = (s: ScopeArg, cursor?: string | null) =>
  callPage<Proposal>(`/api/cm/proposals${q(s, { limit: 30, cursor: cursor || undefined })}`)
export const getProposalCount = (s: ScopeArg) => call<{ open: number; by_group?: Record<string, number> }>(`/api/cm/proposals/count${q(s)}`)
export const getProposal = (org: number | null, id: number) => call<Proposal>(`/api/cm/proposals/${id}${q(org)}`)
export const archiveProposals = (s: ScopeArg, sourceId?: number) =>
  send<{ archived: number }>('POST', `/api/cm/proposals/archive${q(s)}`, { source_id: sourceId ?? null })
export const dismissProposal = (org: number | null, id: number) => send<{ ok: boolean }>('POST', `/api/cm/proposals/${id}/dismiss${q(org)}`)
export interface Asset {
  id: number; source_id: number; source_name: string | null; group_id: number | null; name: string; title: string
  caption: string | null; caption_from: 'txt' | 'user' | null; folder: string | null; mime_type: string | null
  size: number | null; duration_sec: number | null; width: number | null; height: number | null
  drive_created_at: string | null; thumbnail: string | null; drive_url: string; removed: boolean; has_cover?: boolean; kind?: 'published' | 'routine' | 'reserve' | 'waiting' | null; ref?: string | null; links?: Partial<Record<Platform, string>>; folder_url?: string | null; stream?: string
  moved_published: boolean; scheduled: number; published: number; last_published_at: string | null
}
export type AssetState = 'all' | 'new' | 'used'
// Drive d'archivage des publications de l'outil (connexion Google « drive.file »)
export type DriveArchive = { oauth_enabled: boolean; connected: boolean; email: string | null; error: string | null; folder_url: string | null; folder_name: string }
export const getDriveArchive = (org: number | null) => call<DriveArchive>(`/api/cm/drive/archive${q(org)}`)
export const startDriveOAuth = (org: number | null, name?: string) =>
  send<{ authorize_url: string }>('POST', '/api/cm/drive/oauth/start', { org_id: org, ...(name ? { name } : {}) })
export interface StorageItem extends Storage {
  id: number; name: string; position: number; room_bytes: number | null; error: string | null
  assign: { accounts?: [Platform, number][]; groups?: number[] } | null
}
export type Storages = Storage & { storages: StorageItem[] }
export const getStorages = (org: number | null) => call<Storages>(`/api/cm/drive/storages${q(org)}`)
export const addStorage = (org: number | null, from_id: number, name: string) => send<Storages>('POST', `/api/cm/drive/storages${q(org)}`, { from_id, name })
export const patchStorage = (org: number | null, id: number, body: Record<string, unknown>) => send<Storages>('PATCH', `/api/cm/drive/storages/${id}${q(org)}`, body)
export const removeStorage = (org: number | null, id: number) => send<Storages>('DELETE', `/api/cm/drive/storages/${id}${q(org)}`)
export const exchangeDriveOAuth = (code: string, state: string) =>
  send<DriveArchive & { org_id: number | null }>('POST', '/api/cm/drive/oauth/exchange', { code, state })
export const disconnectDriveArchive = (org: number | null) => send<DriveArchive>('DELETE', `/api/cm/drive/archive${q(org)}`)
export const getStorage = (org: number | null) => call<Storage>(`/api/cm/drive/storage${q(org)}`)
export const putStorage = (org: number | null, body: { quota_gb: number | null; retention: Retention; delete_after_days?: number | null }) =>
  send<Storage>('PUT', `/api/cm/drive/storage${q(org)}`, body)
export const getRobot = () => call<{ enabled: boolean; email: string | null }>('/api/cm/library/robot')
export const getSources = (org: number | null) => call<Source[]>(`/api/cm/sources${q(org)}`)
export const addSource = (org: number | null, url: string, group_id: number | null) =>
  send<Source>('POST', '/api/cm/sources', { org_id: org, url, group_id })
export const patchSource = (org: number | null, id: number, body: { group_id?: number; clear_group?: boolean; move_published?: boolean }) =>
  send<Source>('PATCH', `/api/cm/sources/${id}${q(org)}`, body)
export const scanSource = (org: number | null, id: number) => send<Source>('POST', `/api/cm/sources/${id}/scan${q(org)}`)
export const removeSource = (org: number | null, id: number) => send<{ ok: boolean; hint: string }>('DELETE', `/api/cm/sources/${id}${q(org)}`)
export const getAssetsPage = (org: number | null, opts: { source_id?: number; state?: AssetState; q?: string; sort?: string; order?: Order; limit?: number; cursor?: string | null }) =>
  callPage<Asset>(`/api/cm/assets${q(org, { ...opts, cursor: opts.cursor || undefined })}`)
export const getAsset = (org: number | null, id: number) => call<Asset>(`/api/cm/assets/${id}${q(org)}`)
export const patchAsset = (org: number | null, id: number, body: { title?: string; caption?: string }) =>
  send<Asset>('PATCH', `/api/cm/assets/${id}${q(org)}`, body)
export interface Identities { account_email: string; identities: { id: number; email: string; org_id: number | null; created_at: string }[] }
export const getIdentities = () => call<Identities>('/api/cm/google-identities')
export const addIdentity = (credential: string, org_id: number | null) => send<Identities>('POST', '/api/cm/google-identities', { credential, org_id })
export const patchIdentity = (id: number, org_id: number | null) => send<Identities>('PATCH', `/api/cm/google-identities/${id}`, { org_id })
export const removeIdentity = (id: number) => send<Identities>('DELETE', `/api/cm/google-identities/${id}`)

// Équipe et transferts
export interface TeamMember { user_id: number; name: string; email: string; org_role: string; cm_role: CmRole; group_ids: number[] | null; is_owner: boolean; you: boolean }
export interface TeamInvite { id: number; email: string; org_role: string; cm_role: CmRole; group_ids: number[] | null }
export interface Team { org_id: number; name: string; my_role: CmRole; my_group_ids: number[] | null; can_manage_members: boolean; can_manage_roles: boolean; members: TeamMember[]; invitations: TeamInvite[] }
export interface Transfer { id: number; platform: Platform; account_id: number; account_name: string | null; to_email: string; from: string | null; status: string; expires_at: string; created_at: string }
export const getTeam = (org: number) => call<Team>(`/api/cm/team?org_id=${org}`)
export const createTeam = (name: string) => send<{ org_id: number; name: string }>('POST', '/api/cm/team', { name })
export const inviteMember = (org: number, email: string, role: CmRole, group_ids: number[] | null) =>
  send<{ joined: boolean }>('POST', `/api/cm/team/${org}/members`, { email, role, group_ids })
export const setMemberRole = (org: number, email: string, role: CmRole, group_ids: number[] | null) =>
  send<{ ok: boolean }>('PATCH', `/api/cm/team/${org}/members/${encodeURIComponent(email)}`, { role, group_ids })
export const removeMember = (org: number, userId: number) => send<{ ok: boolean }>('DELETE', `/api/cm/team/${org}/members/${userId}`)
export const cancelInvite = (org: number, id: number) => send<{ ok: boolean }>('DELETE', `/api/cm/team/${org}/invitations/${id}`)
export const transferAccount = (org: number | null, a: Account, body: { to_org_id?: number; to_perso?: boolean; to_email?: string }) =>
  send<{ moved?: boolean; pending?: boolean; message?: string; moved_targets?: number }>('POST', `/api/cm/accounts/${a.platform}/${a.id}/transfer`, { org_id: org, ...body })
export const getTransfers = () => call<{ incoming: Transfer[]; outgoing: Transfer[] }>('/api/cm/transfers')
export const acceptTransfer = (id: number, org_id: number | null) => send<{ moved: boolean; moved_targets: number }>('POST', `/api/cm/transfers/${id}/accept`, { org_id })
export const declineTransfer = (id: number) => send<{ ok: boolean }>('POST', `/api/cm/transfers/${id}/decline`)
export const cancelTransfer = (id: number) => send<{ ok: boolean }>('DELETE', `/api/cm/transfers/${id}`)
export const claimAccount = (claim_token: string, org_id: number | null) => send<{ moved: boolean; moved_targets: number }>('POST', '/api/cm/accounts/claim', { claim_token, org_id })

// Personnes et partage (par compte, par groupe ou tout l'espace)
export interface PersonScope { all: boolean; groups: number[]; accounts: string[] }
export interface Person {
  user_id: number | null; invitation_id?: number; name: string | null; email: string; role: CmRole
  owner: boolean; you: boolean; pending: boolean; scope: PersonScope
}
export interface People { org_id: number | null; name?: string; my_role: CmRole; can_manage: boolean; people: Person[] }
export type ShareWhat = { platform: Platform; account_id: number } | { group_id: number } | { all: true }
export const getPeople = (org: number | null, opts: ListOpts = {}) => call<People>(`/api/cm/people${q(org, { ...opts })}`)
export const share = (org: number | null, email: string, role: CmRole, what: ShareWhat) =>
  send<{ org_id: number; ok: boolean; invited?: boolean; message?: string }>('POST', '/api/cm/shares', { org_id: org, email, role, ...what })
export const updatePerson = (org: number, email: string, role: CmRole, scope: PersonScope) =>
  send<{ ok: boolean }>('PATCH', '/api/cm/people', { org_id: org, email, role, all: scope.all, groups: scope.groups, accounts: scope.accounts })
export const removePerson = (org: number, email: string) => send<{ ok: boolean }>('POST', '/api/cm/people/remove', { org_id: org, email })
export const accountAccess = (org: number | null, platform: Platform, id: number) =>
  call<Person[]>(`/api/cm/shares/${platform}/${id}${org != null ? `?org_id=${org}` : ''}`)

// Boîte de réception (commentaires, mot-clé, messages Instagram)
export interface InboxAccount {
  platform: Platform; id: number; name: string | null; new: number; read: boolean; reply: boolean; hide: boolean
  private_reply: boolean; messages: boolean; source: 'api' | 'routine' | null; notice: string | null
}
export type CommentStatus = 'new' | 'replied' | 'hidden' | 'ignored' | 'contacted'
export interface Comment {
  id: number; platform: Platform; account_id: number; account_name: string | null; media_id: string | null
  video_title: string | null; video_url: string | null; external_id: string; parent_id: string | null
  author: string | null; text: string | null; like_count: number | null; published_at: string | null
  status: CommentStatus; reply_text: string | null; replied_at: string | null; private_replied_at: string | null
  pending: 'reply' | 'hide' | 'private_reply' | null; error: string | null; profile_url: string | null; dm_url: string | null
  count?: number; can_private_reply?: boolean; video_id?: number | null; video_thumb?: string | null
}
export interface Conversation { id: string; with: string | null; with_id: string | null; updated_at: string | null; last: string | null; last_from_me: boolean }
export interface DmMessage { id: string; text: string | null; at: string | null; from_me: boolean; from: string | null }
export const getInboxAccounts = (s: ScopeArg) => call<InboxAccount[]>(`/api/cm/inbox/accounts${q(s)}`)
export const getCommentsPage = (s: ScopeArg, opts: { status?: string; q?: string; sort?: string; order?: Order; cursor?: string | null; videos?: string }) =>
  callPage<Comment>(`/api/cm/inbox/comments${q(s, { ...opts, limit: 30, cursor: opts.cursor || undefined })}`)
export const syncInbox = (org: number | null) => send<{ comments: number; notices: string[] }>('POST', `/api/cm/inbox/sync${q(org)}`)
export const commentAction = (org: number | null, id: number, action: 'reply' | 'hide' | 'private-reply' | 'ignore' | 'contacted' | 'reopen', text?: string) =>
  send<Comment>('POST', `/api/cm/comments/${id}/${action}${q(org)}`, text ? { text } : undefined)
export const getKeyword = (s: ScopeArg, word: string) => call<Comment[]>(`/api/cm/inbox/keyword${q(s, { word })}`)
export const getConversations = (org: number | null, accountId: number) => call<Conversation[]>(`/api/cm/inbox/conversations${q(org, { account_id: accountId })}`)
export const getConversation = (org: number | null, accountId: number, id: string) =>
  call<{ messages: DmMessage[]; can_write: boolean }>(`/api/cm/inbox/conversations/${encodeURIComponent(id)}${q(org, { account_id: accountId })}`)
export const sendDm = (org: number | null, accountId: number, id: string, recipient_id: string, text: string) =>
  send<{ ok: boolean }>('POST', `/api/cm/inbox/conversations/${encodeURIComponent(id)}/send${q(org, { account_id: accountId })}`, { recipient_id, text })

// Fiche vidéo (la même vidéo sur chaque plateforme)
export interface SheetVideo extends Video { embed: string | null; comments_stored: number }
export interface VideoSheet {
  id: number; title: string | null; caption: string | null; post_id: number | null; videos: SheetVideo[]
  totals: { views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null }
  asset: Asset | null
}
export const getVideoSheet = (org: ScopeArg, id: number) => call<VideoSheet>(`/api/cm/videos/${id}/sheet${q(org)}`)

// Partage par groupe, invitations reçues, capacités, nom de l'espace perso (docs/CM_ROUTINES.md §10)
export interface GroupShare { id: number; email: string; name?: string | null; role: CmRole; role_label?: string; status: 'pending' | 'accepted' | 'declined'; created_at?: string }
export const getGroupShares = (id: number) => call<GroupShare[]>(`/api/cm/groups/${id}/shares`)
export const addGroupShare = (id: number, email: string, role: CmRole) => send<GroupShare>('POST', `/api/cm/groups/${id}/shares`, { email, role })
export const removeGroupShare = (id: number, shareId: number) => send<{ ok: boolean }>('DELETE', `/api/cm/groups/${id}/shares/${shareId}`)
export interface Invitation {
  id: number; group_id: number; group_name: string; group_color: GroupColor | null; role: CmRole; role_label: string
  owner: string | null; invited_by: string | null; accounts: number; created_at: string
}
export const getInvitations = () => call<Invitation[]>('/api/cm/invitations')
export const acceptInvitation = (id: number) => send<{ org_id: number }>('POST', `/api/cm/invitations/${id}/accept`)
export const declineInvitation = (id: number) => send<{ status: string }>('POST', `/api/cm/invitations/${id}/decline`)
export interface Capabilities { can_publish_any: boolean; accounts: { key: string; platform: Platform; id: number; org_id: number | null; role: CmRole; owner: string | null; mine: boolean }[] }
export const getCapabilities = () => call<Capabilities>('/api/cm/me/capabilities')
export interface Profile { perso_name: string; palette: 'warm' | 'ocean' | 'forest'; theme: 'system' | 'light' | 'dark'; prefs_rev: number }
export const getProfile = () => call<Profile>('/api/cm/profile')
export const saveProfile = (perso_name: string) => send<Profile>('PATCH', '/api/cm/profile', { perso_name })

// Mon compte (même compte que chapote.fr) : nom, mot de passe, double authentification, appareils de l'app.
export interface TwoFAStatus { totp_enabled: boolean; passkeys: { id: number; name: string | null }[]; recovery_remaining: number; required: boolean; enabled: boolean }
export interface Passkey { id: number; name: string | null; created_at: string | null; last_used_at: string | null }
export const saveName = (name: string) => send<Me>('PATCH', '/api/auth/me', { name })
export const changePassword = (current_password: string, new_password: string) => send<unknown>('POST', '/api/auth/password', { current_password, new_password })
export const forgotPasswordFor = (email: string) => send<unknown>('POST', '/api/auth/password/forgot', { email })
export const get2fa = () => call<TwoFAStatus>('/api/auth/2fa/status')
export const totpSetup = () => send<{ secret: string; otpauth_uri: string }>('POST', '/api/auth/2fa/totp/setup')
export const totpEnable = (code: string) => send<{ recovery_codes: string[] }>('POST', '/api/auth/2fa/totp/enable', { code })
export const totpDisable = (code: string) => send<unknown>('POST', '/api/auth/2fa/totp/disable', { code })
export const regenerateCodes = (code: string) => send<{ recovery_codes: string[] }>('POST', '/api/auth/2fa/recovery/regenerate', { code })
export const getPasskeys = () => call<Passkey[]>('/api/auth/2fa/webauthn/credentials')
export const removePasskey = (id: number) => send<unknown>('DELETE', `/api/auth/2fa/webauthn/credentials/${id}`)
export interface Device { id: number; name: string | null; platform: string | null; push: boolean; created_at: string | null; last_used_at: string | null }
export const getDevices = () => call<Device[]>('/api/cm/mobile/devices')
export const removeDevice = (id: number) => send<unknown>('DELETE', `/api/cm/mobile/devices/${id}`)

// Assistant Chapote CM, mode « mes données » (docs/CM_MCP.md). 404 / enabled:false = fonction éteinte.
export type AiKind = 'stats' | 'planning' | 'captions'
export interface AiPublic { enabled: boolean; provider?: string | null; policy_version?: string; retention_days?: number; min_age?: number }
export interface AiConsent { enabled: boolean; stats: boolean; planning: boolean; captions: boolean; excluded_accounts: string[]; policy_version: string | null; provider: string | null }
export interface AiAccount {
  key: string; platform: Platform; alias: string; name: string | null; owner: boolean; role: CmRole; groups: string[]
  permissions: Record<AiKind, boolean> | null; excluded: boolean
}
export interface AiStatus {
  provider: string | null; policy_version: string; consent: AiConsent; active: boolean; needs_review: boolean
  old_enough: boolean; platforms: Platform[]; accounts: AiAccount[]
}
export type AiSource = 'inscription' | 'profil' | 'chat' | 'mobile'
export const getAiPublic = () => call<AiPublic>('/api/cm/assistant/public')
export const getAiStatus = () => call<AiStatus>('/api/cm/assistant/status')
export const putAiConsent = (change: Partial<Pick<AiConsent, 'enabled' | AiKind | 'excluded_accounts'>> & { source?: AiSource }) =>
  send<AiStatus>('PUT', '/api/cm/assistant/consent', change)
export const putAiPermissions = (platform: Platform, id: number, perms: Record<AiKind, boolean>) =>
  send<AiStatus>('PUT', `/api/cm/assistant/accounts/${platform}/${id}/permissions`, perms)
export const eraseAiConversations = () => send<{ deleted: number }>('POST', '/api/cm/assistant/conversations/erase')
