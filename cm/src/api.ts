// Appels à l'API, sur la même origine (cm.chapote.fr) : /api/cm/... (planning, chiffres,
// Instagram), /api/tiktok/... et /api/youtube/... (comptes, options du créateur), /api/auth/...
// (compte partagé avec chapote.fr). Le cookie de session est posé par l'API (httpOnly).

export type Platform = 'tiktok' | 'youtube' | 'instagram'
export const PLATFORMS: Platform[] = ['tiktok', 'youtube', 'instagram']
export const PLATFORM_LABEL: Record<Platform, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' }

export interface Me { id: number; email: string; name: string; avatar_url?: string | null }
export interface TwoFAChallenge { twofa_required: true; challenge: string; methods: { totp: boolean; passkey: boolean; recovery: boolean } }

export interface Stats {
  followers: number | null; views: number | null; likes: number | null; videos: number | null
  updated_at: string | null; error: string | null; delta_followers?: number | null; delta_views?: number | null
}
export interface Account {
  platform: Platform; id: number; name: string | null; avatar_url: string | null
  needs_reconnect: boolean; can_publish: boolean; stats_available: boolean; connected_at: string | null
  mode: 'api' | 'routine'; can_direct?: boolean; can_draft?: boolean; handle?: string | null; username?: string
  stats: Stats | null
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
  published_at: string | null; can_edit: boolean; can_retry: boolean
}
export interface Post {
  id: number; title: string; caption: string | null; file_name: string | null; video_size: number
  duration_sec: number | null; status: string; has_media: boolean; created_at: string; targets: Target[]
}
export interface Space { org_id: number | null; name: string; role: string | null }
export type GroupColor = 'blue' | 'orange' | 'green' | 'purple' | 'pink' | 'teal' | 'amber' | 'slate'
export const GROUP_COLORS: GroupColor[] = ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'amber', 'slate']
export interface Group { id: number; name: string; color: GroupColor | null; accounts: { platform: Platform; id: number }[] }
/** Périmètre affiché : un espace (perso ou équipe) et, éventuellement, un groupe de comptes. */
export interface Scope { org: number | null; group: number | null }

export type CalendarItem =
  | (Video & { kind: 'video'; at: string })
  | (Target & { kind: 'target'; at: string; title: string })
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
  constructor(public status: number, message: string) { super(message) }
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
      headers: { 'Content-Type': 'application/json', 'X-Chapote-App': 'cm', ...(init?.headers || {}) },
    })
  } catch {
    throw new ApiError(0, 'Connexion impossible : vérifiez votre réseau.')
  }
  if (!res.ok) {
    let message = `Erreur ${res.status}`
    try {
      const body = await res.json()
      const d = body?.detail
      if (typeof d === 'string') message = d
      else if (d && typeof d === 'object' && d.message) message = d.message
      else if (Array.isArray(d) && d[0]?.msg) message = 'Champ invalide : ' + d[0].msg
      else if (body?.message) message = body.message
    } catch { /* corps non JSON */ }
    throw new ApiError(res.status, message)
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
  if (org != null) p.set('org_id', String(org))
  if (group != null) p.set('group_id', String(group))
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}
const send = <T>(method: string, path: string, body?: unknown) =>
  call<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

// Compte
export const getMe = () => call<Me>('/api/auth/me')
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
export const getAccounts = (s: ScopeArg) => call<Account[]>(`/api/cm/accounts${q(s)}`)
export const syncAccount = (org: number | null, a: Account) => send<Account>('POST', `/api/cm/accounts/${a.platform}/${a.id}/sync${q(org)}`)
export const getOverview = (s: ScopeArg, days: number) => call<Overview>(`/api/cm/overview${q(s, { days })}`)
export const getVideos = (s: ScopeArg, opts: { platform?: string; sort?: string; limit?: number; days?: number }) =>
  call<Video[]>(`/api/cm/videos${q(s, opts)}`)
export const getPosts = (s: ScopeArg, start: Date, end: Date) =>
  call<Post[]>(`/api/cm/posts${q(s, { start: start.toISOString(), end: end.toISOString() })}`)
export const getVideosPage = (s: ScopeArg, opts: { platform?: string; sort?: string; limit?: number; cursor?: string | null }) =>
  callPage<Video>(`/api/cm/videos${q(s, { ...opts, cursor: opts.cursor || undefined })}`)
export const getCalendar = (s: ScopeArg, start: Date, end: Date) =>
  call<Calendar>(`/api/cm/calendar${q(s, { start: start.toISOString(), end: end.toISOString() })}`)
export const getStats = (s: ScopeArg, days: number) => call<DetailedStats>(`/api/cm/stats${q(s, { days })}`)

// Groupes de comptes
type GroupBody = { name?: string; color?: GroupColor; accounts?: { platform: Platform; account_id: number }[] }
export const getGroups = (org: number | null) => call<Group[]>(`/api/cm/groups${q(org)}`)
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
export const retryTarget = (id: number) => send<Target>('POST', `/api/cm/targets/${id}/retry`, {})

export async function putPart(postId: number, index: number, bytes: Blob): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(`/api/cm/posts/${postId}/parts/${index}`, {
        method: 'PUT', body: bytes, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Chapote-App': 'cm' },
      })
    } catch {
      if (attempt < 3) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue }
      throw new ApiError(0, 'Envoi interrompu : vérifiez votre connexion et relancez.')
    }
    if (res.ok) return
    if (res.status >= 500 && attempt < 3) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue }
    let message = `Envoi refusé (${res.status})`
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
  role: 'reader' | 'writer' | null; can_organize: boolean; shared_by: string | null; verified: boolean
  group_id: number | null; move_published: boolean; last_scan_at: string | null; last_error: string | null
  videos: number; new: number; created_at: string; scan?: { ok: boolean; videos?: number; added?: number; error?: string }
}
export interface Asset {
  id: number; source_id: number; source_name: string | null; group_id: number | null; name: string; title: string
  caption: string | null; caption_from: 'txt' | 'user' | null; folder: string | null; mime_type: string | null
  size: number | null; duration_sec: number | null; width: number | null; height: number | null
  drive_created_at: string | null; thumbnail: string | null; drive_url: string; removed: boolean
  moved_published: boolean; scheduled: number; published: number; last_published_at: string | null
}
export type AssetState = 'all' | 'new' | 'used'
export const getRobot = () => call<{ enabled: boolean; email: string | null }>('/api/cm/library/robot')
export const getSources = (org: number | null) => call<Source[]>(`/api/cm/sources${q(org)}`)
export const addSource = (org: number | null, url: string, group_id: number | null) =>
  send<Source>('POST', '/api/cm/sources', { org_id: org, url, group_id })
export const patchSource = (org: number | null, id: number, body: { group_id?: number; clear_group?: boolean; move_published?: boolean }) =>
  send<Source>('PATCH', `/api/cm/sources/${id}${q(org)}`, body)
export const scanSource = (org: number | null, id: number) => send<Source>('POST', `/api/cm/sources/${id}/scan${q(org)}`)
export const removeSource = (org: number | null, id: number) => send<{ ok: boolean; hint: string }>('DELETE', `/api/cm/sources/${id}${q(org)}`)
export const getAssetsPage = (org: number | null, opts: { source_id?: number; state?: AssetState; q?: string; limit?: number; cursor?: string | null }) =>
  callPage<Asset>(`/api/cm/assets${q(org, { ...opts, cursor: opts.cursor || undefined })}`)
export const getAsset = (org: number | null, id: number) => call<Asset>(`/api/cm/assets/${id}${q(org)}`)
export const patchAsset = (org: number | null, id: number, body: { title?: string; caption?: string }) =>
  send<Asset>('PATCH', `/api/cm/assets/${id}${q(org)}`, body)
export interface Identities { account_email: string; identities: { id: number; email: string; org_id: number | null; created_at: string }[] }
export const getIdentities = () => call<Identities>('/api/cm/google-identities')
export const addIdentity = (credential: string, org_id: number | null) => send<Identities>('POST', '/api/cm/google-identities', { credential, org_id })
export const patchIdentity = (id: number, org_id: number | null) => send<Identities>('PATCH', `/api/cm/google-identities/${id}`, { org_id })
export const removeIdentity = (id: number) => send<Identities>('DELETE', `/api/cm/google-identities/${id}`)
