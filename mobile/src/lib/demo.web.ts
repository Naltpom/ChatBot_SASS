// Version web de démonstration, pour les captures d'écran : l'API est simulée avec de fausses données.
// État choisi par l'adresse : ?demo=out | new | young | welcome | drive | groups | popup | full (défaut).
type S = 'out' | 'new' | 'young' | 'welcome' | 'drive' | 'groups' | 'popup' | 'full' | 'empty'
const qs = new URLSearchParams(globalThis.location?.search || '')
let state = (qs.get('demo') || globalThis.sessionStorage?.getItem('cm.demo') || 'full') as S
try { if (qs.get('demo')) { sessionStorage.setItem('cm.demo', state); localStorage.clear() } } catch { /* */ }
if (state !== 'popup') try { for (const k of ['push', 'lock', '2fa']) localStorage.setItem(`cm.ask.1.${k}`, 'no') } catch { /* */ }
;(globalThis as any).__CM_DEMO__ = { signedIn: state !== 'out' }

const now = Date.now()
const H = 3600_000, D = 24 * H
const iso = (t: number) => new Date(t).toISOString()
const day = (t: number) => iso(t).slice(0, 10)
const at = (d: number, h: number, m = 0) => { const x = new Date(now + d * D); x.setHours(h, m, 0, 0); return x.toISOString() }
const stats = (f: number, v: number) => ({ followers: f, views: v, likes: Math.round(v / 12), videos: 48, updated_at: iso(now - H), error: null, delta_followers: Math.round(f / 90), delta_views: Math.round(v / 20) })
const own = ['new', 'young', 'welcome'].includes(state) ? [] : [
  { platform: 'tiktok', id: 1, name: 'Contes du soir', handle: 'contesdusoir', stats: stats(18400, 912000) },
  { platform: 'youtube', id: 2, name: 'Contes du soir', handle: '@contesdusoir', stats: stats(6300, 254000) },
  { platform: 'instagram', id: 3, name: 'contes.du.soir', handle: 'contes.du.soir', stats: stats(9100, 388000) },
].map(a => ({ avatar_url: null, needs_reconnect: false, can_publish: true, stats_available: true, connected_at: iso(now - 40 * D),
  mode: 'api', can_direct: true, can_draft: true, org_id: null, owner: 'Nathan', mine: true, groups: state === 'full' || state === 'popup' ? [1] : [], role: 'admin', ...a }))
const storage = state === 'drive' ? null : { connected: true, email: 'nathan@gmail.com', quota_gb: null, used_bytes: 3.2e9, drive_free_bytes: 11.8e9, retention: 'delete_after_publish', delete_after_days: null, state: 'ok', count: 1, folder_url: 'https://drive.google.com' }
const groups = state === 'full' || state === 'popup' ? [{ id: 1, name: 'Contes', color: 'purple', org_id: null, accounts: own.map(a => ({ platform: a.platform, id: a.id })) }] : []
const tgt = (id: number, post: number, acc: any, when: string, status: string, extra: any = {}) => ({
  id, post_id: post, platform: acc.platform, account_id: acc.id, account_name: acc.name, scheduled_at: when, options: {}, status,
  external_id: null, url: status === 'PUBLISHED' ? 'https://example.com' : null, fail_reason: null, error_message: null, notice: null,
  published_at: status === 'PUBLISHED' ? when : null, can_edit: status === 'SCHEDULED', can_retry: status === 'FAILED', ...extra })
const titles = ['Le Petit Chaperon rouge — partie 1', 'Hansel et Gretel', 'Le Joueur de flûte de Hamelin', 'Blanche-Neige — partie 2', 'Les Musiciens de Brême', 'Le Roi Grenouille']
const posts = own.length && state !== 'empty' ? titles.map((title, i) => {
  const d = i - 2, when = at(d, 18, 30)
  const status = d < 0 ? 'PUBLISHED' : d === 0 && i === 2 ? 'SCHEDULED' : 'SCHEDULED'
  const targets = own.map((a, j) => tgt(i * 10 + j, i + 1, a, when, i === 1 && a.platform === 'tiktok' ? 'INBOX' : i === 0 && a.platform === 'instagram' ? 'FAILED' : status,
    i === 0 && a.platform === 'instagram' ? { error_message: 'Vidéo trop longue pour un Reel (plus de 90 s).' } : {}))
  return { id: i + 1, title, caption: `${title} 🌙 Un conte des frères Grimm, raconté pour s'endormir. #conte #grimm`, file_name: 'conte.mp4',
    video_size: 48e6, duration_sec: 74, status: 'active', has_media: true, created_at: iso(now - 5 * D), targets, rights: 'public_domain' }
}) : []
const cal = { start: iso(now - 7 * D), end: iso(now + 7 * D), days: [], items: posts.flatMap(p => p.targets.map(t => ({ ...t, kind: 'target', at: t.scheduled_at, title: p.title, rights: 'public_domain' }))) }
const comment = (id: number, acc: any, author: string, text: string, vt: string) => ({ id, platform: acc.platform, account_id: acc.id, account_name: acc.name,
  media_id: 'm', video_title: vt, video_url: 'https://example.com', external_id: String(id), parent_id: null, author, text, like_count: 3,
  published_at: iso(now - id * H), status: 'new', reply_text: null, replied_at: null, private_replied_at: null, pending: null, error: null,
  profile_url: null, dm_url: null, can_private_reply: acc.platform === 'instagram', video_id: 1, video_thumb: null })
const comments = own.length && state !== 'empty' ? [
  comment(1, own[0], 'lea.r', 'Ma fille ne s’endort plus sans vos histoires 😍', titles[3]),
  comment(2, own[2], 'marc_dupuis', 'Vous pourriez faire La Belle au bois dormant ?', titles[3]),
  comment(3, own[1], 'Sophie M.', 'Superbe voix, merci pour ce moment', titles[4]),
  comment(4, own[0], 'tom.b', 'La partie 2 arrive quand ?', titles[0]),
] : []
const video = (i: number, a: any) => ({ id: i, platform: a.platform, account_id: a.id, account_name: a.name, external_id: String(i), title: titles[i % 6],
  url: 'https://example.com', thumbnail_url: null, published_at: iso(now - (i + 1) * D), duration_sec: 74, views: 52000 - i * 6100, likes: 4100 - i * 300,
  comments: 120 - i * 9, shares: 80, saves: 210, via_chapote: true })
const videos = own.length ? [0, 1, 2, 3, 4].map(i => video(i, own[i % own.length])) : []
const row = (v: number) => ({ posts: 12, views: v, likes: Math.round(v / 12), comments: Math.round(v / 400), shares: Math.round(v / 600), saves: Math.round(v / 300), interactions: Math.round(v / 9), engagement_rate: 0.061, avg_views: Math.round(v / 12), followers: 33800, followers_delta: 1240 })
const series = Array.from({ length: 28 }, (_, i) => ({ day: day(now - (27 - i) * D), views: 30000 + Math.round(Math.sin(i / 3) * 9000) + i * 900, followers: 32000 + i * 60, by_platform: {} }))
const asset = (i: number) => ({ id: i, source_id: 1, source_name: 'Contes', group_id: 1, name: `conte-${i}.mp4`, title: titles[i % 6], caption: null, caption_from: null,
  folder: 'contes/KHM-0' + (20 + i), mime_type: 'video/mp4', size: 4.1e7, duration_sec: 74, width: 1080, height: 1920, drive_created_at: iso(now - i * D),
  thumbnail: null, drive_url: 'https://drive.google.com', removed: false, kind: i < 2 ? 'published' : i < 4 ? 'reserve' : null, moved_published: false, scheduled: 0, published: i < 2 ? 3 : 0, last_published_at: null })
const me = { id: 1, email: 'nathan@exemple.fr', name: 'Nathan Provost', avatar_url: null, auth_source: 'local', twofa_enabled: false }
const identity = { done: state !== 'new', first_name: state === 'new' ? null : 'Nathan', last_name: state === 'new' ? null : 'Provost',
  birth_date: state === 'new' ? null : state === 'young' ? day(now - 13 * 365 * D) : '1995-04-12', terms_version: '2026-11', terms_current: '2026-11',
  terms_ok: state !== 'new', min_age: 15, blocked_until: state === 'young' ? day(now + 2 * 365 * D) : null,
  legal: { cgu: 'https://chapote.fr/legal/cgu', cgv: 'https://chapote.fr/legal/cgv', privacy: 'https://chapote.fr/legal/confidentialite' } }

const routes: [RegExp, (m: RegExpMatchArray, method: string) => any][] = [
  [/\/api\/cm\/mobile\/refresh$/, () => ({ session: 'demo', expires_in: 3600, user: me })],
  [/\/api\/cm\/mobile\/identity$/, () => identity],
  [/\/api\/cm\/mobile\/devices$/, () => [{ id: 1, name: 'Pixel 8', platform: 'android', created_at: iso(now - 9 * D), last_used_at: iso(now), current: true }]],
  [/\/api\/cm\/mobile\/web-link$/, () => ({ path: '/', expires_in: 120 })],
  [/\/api\/auth\/me$/, () => me],
  [/\/api\/auth\/2fa\/status$/, () => ({ totp_enabled: false, passkeys: [], recovery_left: 0 })],
  [/\/api\/auth\/2fa\/totp\/setup$/, () => ({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/Chapote:nathan@exemple.fr?secret=JBSWY3DPEHPK3PXP&issuer=Chapote' })],
  [/\/api\/cm\/public-config$/, () => ({ google_client_id: null, app_url: 'https://cm.chapote.fr' })],
  [/\/api\/cm\/config$/, () => ({ tiktok: true, youtube: true, instagram_api: true, max_upload_bytes: 4e9, part_size: 8e6, tiktok_title_max: 2200, youtube_title_max: 100, youtube_max_duration_sec: 180, youtube_daily_posts: 50, instagram_caption_max: 2200, instagram_max_duration_sec: 90, tiktok_stats: true })],
  [/\/api\/cm\/spaces$/, () => [{ org_id: null, name: 'Espace perso', role: 'owner', cm_role: 'admin', owner: true, accounts: own.length, storage: storage ? { ...storage } : { connected: false, state: 'missing', email: null, quota_gb: null, used_bytes: null, drive_free_bytes: null, retention: 'keep', delete_after_days: null } }]],
  [/\/api\/cm\/accounts/, () => own],
  [/\/api\/cm\/groups\/\d+\/shares/, () => []],
  [/\/api\/cm\/groups/, (_m, method) => method === 'POST' ? { id: 2, name: 'Nouveau groupe', color: 'blue', accounts: [] } : groups],
  [/\/api\/cm\/me\/capabilities$/, () => ({ can_publish_any: own.length > 0, accounts: own.map(a => ({ key: `${a.platform}:${a.id}`, platform: a.platform, id: a.id, org_id: null, role: 'admin', owner: 'Nathan', mine: true })) })],
  [/\/api\/cm\/invitations$/, () => state === 'welcome' ? [{ id: 7, group_id: 9, group_name: 'Agence Lumen', group_color: 'blue', role: 'editor', role_label: 'Peut publier', owner: 'Camille Martin', invited_by: 'Camille Martin', accounts: 4, created_at: iso(now - H) }] : []],
  [/\/api\/cm\/profile$/, () => ({ perso_name: null })],
  [/\/api\/cm\/calendar/, () => cal],
  [/\/api\/cm\/posts\/(\d+)$/, m => posts[Number(m[1]) - 1] || posts[0]],
  [/\/api\/cm\/posts/, () => posts],
  [/\/api\/cm\/overview/, () => ({ days: 28, totals: { views: 1554000, followers: 33800, likes: 129000, views_gained: 212000, accounts: own.length, upcoming: 9, published: 21, failed_recent: 1 }, series, accounts: own, top_videos: videos })],
  [/\/api\/cm\/stats/, () => ({ days: 28, totals: { ...row(1554000), accounts: own.length }, platforms: own.map(a => ({ ...row(a.stats.views), platform: a.platform, accounts: 1, metrics: ['followers', 'views', 'likes', 'comments'] })), accounts: own.map(a => ({ ...row(a.stats.views), platform: a.platform, id: a.id, name: a.name, avatar_url: null, stats_available: true })), posts: [], metrics: { tiktok: ['followers', 'views', 'likes'], youtube: ['followers', 'views', 'likes'], instagram: ['followers', 'views', 'likes'] } })],
  [/\/api\/cm\/videos\/(\d+)\/sheet/, () => ({ id: 1, title: titles[3], caption: posts[3]?.caption, post_id: 4, videos: videos.slice(0, 3).map(v => ({ ...v, embed: null, comments_stored: 12 })), totals: { views: 141000, likes: 11800, comments: 330, shares: 240, saves: 630 }, asset: null })],
  [/\/api\/cm\/videos/, () => videos],
  [/\/api\/cm\/inbox\/accounts/, () => own.map(a => ({ platform: a.platform, id: a.id, name: a.name, new: a.platform === 'tiktok' ? 2 : 1, read: true, reply: true, hide: a.platform !== 'tiktok', private_reply: a.platform === 'instagram', messages: false, source: 'api', notice: null }))],
  [/\/api\/cm\/inbox\/comments/, () => comments],
  [/\/api\/cm\/inbox\/conversations/, () => []],
  [/\/api\/cm\/drive\/storages$/, () => ({ ...(storage || { connected: false, state: 'missing' }), storages: storage ? [{ id: 1, name: 'cm.chapote.fr', position: 0, email: storage.email, folder_url: storage.folder_url, assign: null, state: 'ok' }] : [] })],
  [/\/api\/cm\/drive\/storage/, () => storage ? { ...storage, max_quota_gb: 14 } : { connected: false, state: 'missing' }],
  [/\/api\/cm\/drive\/archive/, () => ({ oauth_enabled: true, connected: !!storage, email: storage?.email || null, error: null, folder_url: storage?.folder_url || null, folder_name: 'cm.chapote.fr' })],
  [/\/api\/cm\/library\/robot$/, () => ({ enabled: true, email: 'robot@chapote-cm.iam.gserviceaccount.com' })],
  [/\/api\/cm\/sources/, () => own.length ? [{ id: 1, provider: 'gdrive', folder_id: 'f', name: 'Contes', url: 'https://drive.google.com', role: 'writer', can_organize: true, shared_by: 'nathan@gmail.com', verified: true, group_id: 1, move_published: true, last_scan_at: iso(now - H), last_error: null, videos: 64, new: 3, created_at: iso(now - 30 * D), auto_drafts: true, recipe: null }] : []],
  [/\/api\/cm\/assets\/(\d+)/, m => asset(Number(m[1]))],
  [/\/api\/cm\/assets/, () => own.length ? [1, 2, 3, 4, 5, 6].map(asset) : []],
  [/\/api\/cm\/proposals\/count/, () => ({ open: own.length ? 3 : 0, by_group: { 1: 3 } })],
  [/\/api\/cm\/proposals/, () => []],
  [/\/api\/cm\/google-identities/, () => ({ account_email: me.email, identities: [] })],
  [/\/api\/cm\/people/, () => ({ org_id: null, my_role: 'admin', can_manage: true, people: [
    { user_id: 1, name: 'Nathan Provost', email: me.email, role: 'admin', owner: true, you: true, pending: false, scope: { all: true, groups: [], accounts: [] } },
    { user_id: 2, name: 'Camille Martin', email: 'camille@exemple.fr', role: 'editor', owner: false, you: false, pending: false, scope: { all: false, groups: [1], accounts: [] } }] })],
  [/\/api\/cm\/transfers$/, () => ({ incoming: [], outgoing: [] })],
  [/\/api\/tiktok\/accounts\/\d+\/creator-info/, () => ({ can_post: true, creator: { nickname: 'Contes du soir', username: 'contesdusoir', avatar_url: null, privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: 600 } })],
]

const realFetch = globalThis.fetch?.bind(globalThis)
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const u = typeof input === 'string' ? input : input.url
  if (!/\/api\//.test(u)) return realFetch(input, init)
  const path = new URL(u, 'https://x').pathname
  const method = (init?.method || 'GET').toUpperCase()
  if (state === 'out' && !/public-config/.test(path)) return new Response(JSON.stringify({ detail: 'Connectez-vous.' }), { status: 401 })
  for (const [re, fn] of routes) {
    const m = path.match(re)
    if (m) return new Response(JSON.stringify(fn(m, method)), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify(method === 'GET' ? [] : { ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
export {}
