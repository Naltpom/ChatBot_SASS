// Données fictives pour les captures de cm.chapote.fr (aucune vraie personne, marque ni adresse).
// Le « maintenant » des captures est fixé (voir NOW) : vendredi 27 novembre 2026, 10 h 30, Europe/Paris.
const NOW = new Date('2026-11-27T10:30:00+01:00')
const at = (day, hm) => new Date(`2026-11-${String(day).padStart(2, '0')}T${hm}:00+01:00`).toISOString()
const thumb = n => `/media/thumb${n}.jpg`

const ACC = [
  { platform: 'tiktok', id: 1, name: 'Atelier Lumen', handle: 'atelier.lumen', groups: [1], f: 48200, df: 1240, v: 1620000 },
  { platform: 'youtube', id: 2, name: 'Atelier Lumen', handle: '@atelierlumen', groups: [1], f: 12400, df: 310, v: 486000 },
  { platform: 'instagram', id: 3, name: 'atelier.lumen', handle: 'atelier.lumen', groups: [1], f: 23900, df: 680, v: 742000 },
  { platform: 'tiktok', id: 4, name: 'Café des Arts', handle: 'cafe.desarts', groups: [2], f: 31500, df: 920, v: 1130000 },
  { platform: 'instagram', id: 5, name: 'cafe.desarts', handle: 'cafe.desarts', groups: [2], f: 18700, df: 410, v: 512000 },
  { platform: 'youtube', id: 6, name: 'Studio Nova', handle: '@studionova', groups: [3], f: 8600, df: 190, v: 274000 },
]
const accounts = ACC.map((a, i) => ({
  platform: a.platform, id: a.id, name: a.name, avatar_url: null, needs_reconnect: false, can_publish: true,
  stats_available: true, connected_at: `2026-0${3 + i}-1${i}T10:00:00Z`, mode: 'api', can_direct: true, can_draft: true,
  handle: a.handle, username: a.handle, public_domain_only: false,
  stats: { followers: a.f, views: a.v, likes: Math.round(a.v * 0.071), videos: 40 + i * 7, updated_at: at(27, '09:45'), error: null, delta_followers: a.df, delta_views: Math.round(a.v * 0.12) },
  org_id: null, owner: 'Camille', mine: true, groups: a.groups, role: 'admin',
}))
const accName = (p, id) => accounts.find(a => a.platform === p && a.id === id).name

const groups = [
  { id: 1, org_id: null, name: 'Atelier Lumen', color: 'orange', accounts: [{ platform: 'tiktok', id: 1 }, { platform: 'youtube', id: 2 }, { platform: 'instagram', id: 3 }] },
  { id: 2, org_id: null, name: 'Café des Arts', color: 'teal', accounts: [{ platform: 'tiktok', id: 4 }, { platform: 'instagram', id: 5 }] },
  { id: 3, org_id: null, name: 'Studio Nova', color: 'purple', accounts: [{ platform: 'youtube', id: 6 }] },
]

const GB = 1024 ** 3
const storage = { connected: true, email: 'camille@example.com', folder_url: 'https://drive.google.com/', quota_gb: 50, used_bytes: Math.round(12.4 * GB),
  drive_free_bytes: Math.round(84 * GB), retention: 'delete_after_days', delete_after_days: 30, state: 'ok', max_quota_gb: 200 }
const spaces = [{ org_id: null, name: 'Espace perso', role: null, cm_role: 'admin', group_ids: null, owner: true, owner_name: 'Camille', accounts: 6, storage }]

// Publications de la semaine (lundi 23 → dimanche 29 novembre).
// v : vidéo publiée relevée (vues) ; s : statut de cible (SCHEDULED, FAILED, INBOX).
const POSTS = [
  { id: 1, day: 23, hm: '12:30', title: 'Coulisses de l’atelier : le polissage', th: 1, group: 1,
    caption: 'Trois heures de polissage pour une seule pièce ✨ On vous montre tout, du brut au brillant.\n#atelier #faitmain #coulisses',
    items: [['tiktok', 1, 'v', 18200], ['instagram', 3, 'v', 6400], ['youtube', 2, 'v', 2100]] },
  { id: 2, day: 23, hm: '18:00', title: 'Recette du jour : tarte aux pommes', th: 3, group: 2,
    caption: 'La tarte aux pommes de la maison, servie tiède 🍎\n#recette #patisserie #cafe',
    items: [['tiktok', 4, 'v', 9800], ['instagram', 5, 'v', 4100]] },
  { id: 3, day: 24, hm: '11:00', title: 'Studio Nova : making-of du clip', th: 8, group: 3,
    caption: 'Une journée de tournage en 60 secondes 🎬\n#studio #musique #makingof',
    items: [['youtube', 6, 'v', 3200]] },
  { id: 12, day: 24, hm: '19:00', title: 'Nouveauté de la semaine : la lampe Aube', th: 2, group: 1,
    caption: 'Voici Aube, notre nouvelle lampe en laiton brossé. Une lumière douce pour les soirées d’hiver 💡\nDisponible dès vendredi à l’atelier.\n#nouveaute #design #luminaire #faitmain',
    items: [['instagram', 3, 'v', 5300], ['youtube', 2, 'v', 1900], ['tiktok', 1, 'v', 2400]] },
  { id: 5, day: 25, hm: '08:30', title: 'Recette du jour : cappuccino maison', th: 9, group: 2,
    caption: 'Le secret d’une mousse de lait bien serrée ☕\n#cafe #barista #recette',
    items: [['tiktok', 4, 'v', 12700], ['instagram', 5, 'v', 7900]] },
  { id: 6, day: 25, hm: '17:00', title: 'Coulisses de l’atelier : la teinture', th: 4, group: 1,
    caption: 'Bain de teinture pour les abat-jour 🎨\n#atelier #coulisses',
    items: [['tiktok', 1, 'v', 22000], ['instagram', 3, 'v', 4900], ['youtube', 2, 'v', 1800]] },
  { id: 7, day: 26, hm: '12:00', title: 'Studio Nova : session acoustique', th: 5, group: 3,
    caption: 'Version acoustique, une prise, pas de retouche 🎸\n#live #acoustique',
    items: [['youtube', 6, 'v', 4400]] },
  { id: 8, day: 26, hm: '18:30', title: 'Recette du jour : brioche tressée', th: 6, group: 2,
    caption: 'Brioche tressée, pétrie à la main 🥐\n#boulangerie #recette',
    items: [['instagram', 5, 'v', 3200], ['tiktok', 4, 'INBOX']] },
  { id: 9, day: 27, hm: '09:00', title: 'Nouveauté de la semaine : le vase Lune', th: 7, group: 1,
    caption: 'Le vase Lune, tourné et émaillé à l’atelier 🌙\n#ceramique #nouveaute',
    items: [['tiktok', 1, 'v', 3100], ['instagram', 3, 'v', 1200]] },
  { id: 20, day: 27, hm: '18:00', title: 'Coulisses de l’atelier : emballage des commandes', th: 10, group: 1,
    caption: 'Chaque commande part emballée à la main, avec un petit mot 📦\n#atelier #coulisses #faitmain',
    items: [['tiktok', 1, 'SCHEDULED'], ['youtube', 2, 'SCHEDULED'], ['instagram', 3, 'SCHEDULED']] },
  { id: 21, day: 28, hm: '10:00', title: 'Recette du jour : chocolat chaud', th: 3, group: 2,
    caption: 'Le chocolat chaud épais de l’hiver 🍫\n#recette #cafe #hiver',
    items: [['tiktok', 4, 'SCHEDULED'], ['instagram', 5, 'SCHEDULED']] },
  { id: 22, day: 28, hm: '17:30', title: 'Studio Nova : teaser du nouveau single', th: 8, group: 3,
    caption: 'Le nouveau single arrive bientôt 🎧\n#teaser #musique',
    items: [['youtube', 6, 'SCHEDULED']] },
  { id: 23, day: 29, hm: '11:00', title: 'Nouveauté de la semaine : la suspension Écume', th: 2, group: 1,
    caption: 'Écume, une suspension en verre soufflé 🫧\n#nouveaute #design',
    items: [['tiktok', 1, 'SCHEDULED'], ['instagram', 3, 'SCHEDULED'], ['youtube', 2, 'SCHEDULED']] },
  { id: 24, day: 29, hm: '16:00', title: 'Recette du jour : crêpes', th: 9, group: 2,
    caption: 'Les crêpes du dimanche, recette en 4 ingrédients 🥞\n#recette #crepes',
    items: [['tiktok', 4, 'SCHEDULED'], ['instagram', 5, 'SCHEDULED']] },
]

let vid = 500, tid = 900
const targetsOf = {}
const calendarItems = []
const videos = []
for (const p of POSTS) {
  const when = at(p.day, p.hm)
  targetsOf[p.id] = []
  for (const [platform, account_id, kind, views] of p.items) {
    if (kind === 'v') {
      const v = {
        id: ++vid, platform, account_id, account_name: accName(platform, account_id), external_id: `ext${vid}`, title: p.title,
        url: 'https://example.com/', thumbnail_url: thumb(p.th), published_at: when, duration_sec: 34 + (vid % 20),
        views, likes: Math.round(views * 0.08), comments: Math.round(views * 0.006), shares: platform === 'youtube' ? null : Math.round(views * 0.01),
        saves: platform === 'youtube' ? null : Math.round(views * 0.007), via_chapote: true,
      }
      videos.push(v)
      calendarItems.push({ ...v, kind: 'video', at: when, group: `post:${p.id}` })
    } else {
      const status = kind
      const opts = platform === 'tiktok' ? { mode: status === 'INBOX' ? 'draft' : 'direct', privacy_level: 'PUBLIC_TO_EVERYONE', title: p.caption }
        : platform === 'youtube' ? { title: p.title, description: p.caption, privacy_status: 'public', made_for_kids: false, tags: ['atelier', 'faitmain'] }
        : { caption: p.caption, share_to_feed: true }
      const tg = {
        id: ++tid, post_id: p.id, platform, account_id, account_name: accName(platform, account_id), scheduled_at: when, options: opts, status,
        external_id: null, url: null, fail_reason: status === 'FAILED' ? 'processing_failed' : null,
        error_message: status === 'FAILED' ? 'TikTok n’a pas pu traiter la vidéo. Réessayez : elle repartira telle quelle.' : null,
        notice: status === 'INBOX' ? 'Brouillon arrivé dans la boîte de réception TikTok : ouvrez l’app pour le publier.' : null,
        published_at: null, can_edit: status === 'SCHEDULED', can_retry: status === 'FAILED', can_cancel: status !== 'PUBLISHED', is_draft: status === 'INBOX',
      }
      targetsOf[p.id].push(tg)
      calendarItems.push({ ...tg, kind: 'target', at: when, title: p.title, group: `post:${p.id}`, rights: 'public_domain' })
    }
  }
}

const postById = id => {
  const p = POSTS.find(x => x.id === id) || POSTS.find(x => x.id === 12)
  return {
    id: p.id, org_id: null, title: p.title, caption: p.caption, file_name: 'video.mp4', video_size: 48 * 1024 * 1024, duration_sec: 42,
    status: 'READY', has_media: true, created_at: at(p.day - 1, '15:00'), targets: targetsOf[p.id] || [], rights: 'public_domain', rights_note: null, rights_warning: null,
  }
}

const days = Array.from({ length: 7 }, (_, i) => {
  const d = 23 + i
  const past = d <= 27
  return { day: `2026-11-${d}`, followers: past ? 140000 + i * 600 : null, views: past ? 4200000 + i * 60000 : null,
    followers_delta: past ? [420, 610, 380, 720, 260][i] : null, views_delta: past ? [38000, 52000, 41000, 66000, 9000][i] : null }
})

// Bibliothèque
const sources = [
  { id: 1, provider: 'gdrive', folder_id: 'f1', name: 'Atelier Lumen — vidéos', url: 'https://drive.google.com/', role: 'writer', can_organize: true, can_upload: true,
    shared_by: null, verified: true, group_id: 1, move_published: true, last_scan_at: at(27, '10:10'), last_error: null, videos: 14, new: 4, created_at: '2026-09-02T10:00:00Z', auto_drafts: true, recipe: null },
  { id: 2, provider: 'gdrive', folder_id: 'f2', name: 'Café des Arts — recettes', url: 'https://drive.google.com/', role: 'writer', can_organize: true, can_upload: true,
    shared_by: null, verified: true, group_id: 2, move_published: false, last_scan_at: at(27, '10:05'), last_error: null, videos: 9, new: 3, created_at: '2026-10-11T10:00:00Z', auto_drafts: false, recipe: null },
  { id: 3, provider: 'gdrive', folder_id: 'f3', name: 'Studio Nova — clips', url: 'https://drive.google.com/', role: 'reader', can_organize: false, can_upload: null,
    shared_by: null, verified: true, group_id: 3, move_published: false, last_scan_at: at(27, '09:50'), last_error: null, videos: 5, new: 1, created_at: '2026-10-30T10:00:00Z', auto_drafts: false, recipe: null },
]
const ASSETS = [
  [101, 1, 'Coulisses de l’atelier : le vernissage', 'Coulisses/Décembre', 38, 10, 0, 0, 'Une couche, puis une autre : le vernissage des pieds de lampe 🪵\n#atelier #coulisses #faitmain'],
  [102, 2, 'Recette du jour : vin chaud sans alcool', 'Recettes/Hiver', 47, 3, 0, 0, 'Notre version sans alcool, épicée à la cannelle 🍊\n#recette #hiver'],
  [103, 1, 'Nouveauté de la semaine : la lampe Brume', 'Nouveautés', 29, 2, 0, 0, 'Brume, lampe à poser en verre dépoli.\n#nouveaute #design'],
  [104, 2, 'Recette du jour : cookies noisette', 'Recettes/Hiver', 52, 6, 0, 0, 'Croustillants dehors, fondants dedans 🍪\n#recette #patisserie'],
  [105, 3, 'Studio Nova : répétition du jeudi', 'Clips', 61, 8, 0, 0, 'Les coulisses de la répétition 🎤\n#studio #musique'],
  [106, 1, 'Coulisses de l’atelier : emballage des commandes', 'Coulisses/Novembre', 44, 10, 1, 0, 'Chaque commande part emballée à la main 📦\n#atelier'],
  [107, 2, 'Recette du jour : chocolat chaud', 'Recettes/Hiver', 36, 3, 1, 0, 'Le chocolat chaud épais de l’hiver 🍫\n#recette'],
  [108, 1, 'Coulisses de l’atelier : la teinture', 'Coulisses/Novembre', 41, 4, 0, 3, 'Bain de teinture pour les abat-jour 🎨\n#atelier'],
  [109, 1, 'Nouveauté de la semaine : le vase Lune', 'Nouveautés', 33, 7, 0, 2, 'Le vase Lune 🌙\n#ceramique'],
]
const srcName = id => sources.find(s => s.id === id).name
const assets = ASSETS.map(([id, source_id, title, folder, dur, th, scheduled, published, caption]) => ({
  id, source_id, source_name: srcName(source_id), group_id: source_id, name: `${title.split(' : ')[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.mp4`, title,
  caption, caption_from: 'txt', folder, mime_type: 'video/mp4', size: Math.round((30 + dur) * 1024 * 1024), duration_sec: dur, width: 1080, height: 1920,
  drive_created_at: at(20 + (id % 7), '14:00'), thumbnail: thumb(th), drive_url: 'https://drive.google.com/', removed: false, has_cover: false,
  kind: published ? 'published' : scheduled ? 'routine' : null, ref: null, links: {}, folder_url: 'https://drive.google.com/', stream: `/media/stream/${id}.mp4`,
  moved_published: false, scheduled, published, last_published_at: published ? at(25, '17:00') : null,
}))

const proposals = [
  { id: 31, org_id: null, status: 'open', title: 'Coulisses de l’atelier : le vernissage', caption: assets[0].caption, scheduled_at: at(30, '12:30'), when_from: 'path',
    accounts: [{ key: 'tiktok:1', name: 'Atelier Lumen', platform: 'tiktok' }, { key: 'instagram:3', name: 'atelier.lumen', platform: 'instagram' }, { key: 'youtube:2', name: 'Atelier Lumen', platform: 'youtube' }],
    asset: assets[0], created_at: at(27, '10:10'), origin: 'auto' },
  { id: 32, org_id: null, status: 'open', title: 'Recette du jour : vin chaud sans alcool', caption: assets[1].caption, scheduled_at: '2026-12-01T17:00:00.000Z', when_from: 'date',
    accounts: [{ key: 'tiktok:4', name: 'Café des Arts', platform: 'tiktok' }, { key: 'instagram:5', name: 'cafe.desarts', platform: 'instagram' }],
    asset: assets[1], created_at: at(27, '10:05'), origin: 'auto' },
]

const statRow = (k) => ({ posts: Math.round(38 * k), views: Math.round(412300 * k), likes: Math.round(31800 * k), comments: Math.round(2140 * k), shares: Math.round(3900 * k),
  saves: Math.round(2650 * k), interactions: Math.round(40490 * k), engagement_rate: 0.098, avg_views: Math.round(10850), followers: Math.round(143300 * k), followers_delta: Math.round(3750 * k) })
const detailedStats = {
  days: 30,
  totals: { ...statRow(1), accounts: 6 },
  platforms: [
    { ...statRow(0.52), platform: 'tiktok', accounts: 2, engagement_rate: 0.112, metrics: ['followers', 'views', 'likes', 'comments', 'shares'] },
    { ...statRow(0.31), platform: 'instagram', accounts: 2, engagement_rate: 0.094, metrics: ['followers', 'views', 'likes', 'comments', 'shares', 'saves'] },
    { ...statRow(0.17), platform: 'youtube', accounts: 2, engagement_rate: 0.061, shares: null, saves: null, metrics: ['followers', 'views', 'likes', 'comments'] },
  ],
  accounts: ACC.map((a, i) => ({ posts: [12, 6, 9, 10, 7, 4][i], views: [124000, 31000, 78000, 96000, 52000, 31300][i], likes: null, comments: null, shares: null, saves: null,
    interactions: null, engagement_rate: [0.118, 0.058, 0.092, 0.106, 0.097, 0.064][i], avg_views: null, followers: a.f, followers_delta: a.df,
    platform: a.platform, id: a.id, name: a.name, avatar_url: null, stats_available: true })),
  posts: [],
  metrics: { tiktok: ['followers', 'views', 'likes', 'comments', 'shares'], youtube: ['followers', 'views', 'likes', 'comments'], instagram: ['followers', 'views', 'likes', 'comments', 'shares', 'saves'] },
}
// Publications des 30 derniers jours pour la carte des meilleurs moments (déterministe).
for (let i = 0; i < 90; i++) {
  const d = new Date(NOW.getTime() - (i % 30) * 86400e3)
  const hour = [8, 12, 12, 18, 18, 18, 19, 21, 10, 15][i % 10]
  d.setHours(hour, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7
  const base = 3000 + ((i * 7919) % 9000) + (hour >= 18 ? 6000 : 0) + (dow >= 4 ? 3000 : 0)
  detailedStats.posts.push({ platform: ['tiktok', 'instagram', 'youtube'][i % 3], published_at: d.toISOString(), views: base, interactions: Math.round(base * 0.1) })
}
const series = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(NOW.getTime() - (29 - i) * 86400e3)
  const views = 3600000 + i * 14000 + Math.round(Math.sin(i / 3) * 8000)
  const followers = 139500 + i * 128
  return { day: d.toISOString().slice(0, 10), views, followers,
    by_platform: { tiktok: { views: Math.round(views * 0.55), followers: Math.round(followers * 0.55) }, instagram: { views: Math.round(views * 0.3), followers: Math.round(followers * 0.3) }, youtube: { views: Math.round(views * 0.15), followers: Math.round(followers * 0.15) } } }
})
const overview = {
  days: 30, totals: { views: 4294000, followers: 143300, likes: 31800, views_gained: 412300, accounts: 6, upcoming: 9, published: 38, failed_recent: 1 },
  series, accounts, top_videos: videos.slice(0, 6),
}

const groupShares = {
  1: [
    { id: 1, email: 'lea.martin@example.com', name: 'Léa Martin', role: 'admin', role_label: 'Admin', status: 'accepted' },
    { id: 2, email: 'hugo.bernard@example.com', name: 'Hugo Bernard', role: 'editor', role_label: 'Peut publier', status: 'accepted' },
    { id: 3, email: 'ines.petit@example.com', name: 'Inès Petit', role: 'viewer', role_label: 'Lecture seule', status: 'pending' },
  ],
  2: [{ id: 4, email: 'sami.roux@example.com', name: 'Sami Roux', role: 'editor', role_label: 'Peut publier', status: 'accepted' }],
  3: [],
}
const invitations = [
  { id: 7, group_id: 9, group_name: 'Librairie du Port', group_color: 'blue', role: 'editor', role_label: 'Peut publier', owner: 'Julie Garnier', invited_by: 'Julie Garnier', accounts: 2, created_at: at(26, '16:00') },
]

const aiStatus = {
  provider: 'Anthropic', policy_version: '2026-10', active: true, needs_review: false, old_enough: true, platforms: ['tiktok', 'youtube', 'instagram'],
  consent: { enabled: true, stats: true, planning: true, captions: false, excluded_accounts: ['youtube:6'], policy_version: '2026-10', provider: 'Anthropic' },
  accounts: [
    { key: 'tiktok:1', platform: 'tiktok', alias: 'Compte TikTok 1', name: 'Atelier Lumen', owner: true, role: 'admin', groups: ['Atelier Lumen'], permissions: { stats: true, planning: true, captions: false }, excluded: false },
    { key: 'instagram:3', platform: 'instagram', alias: 'Compte Instagram 1', name: 'atelier.lumen', owner: true, role: 'admin', groups: ['Atelier Lumen'], permissions: { stats: true, planning: true, captions: true }, excluded: false },
    { key: 'tiktok:4', platform: 'tiktok', alias: 'Compte TikTok 2', name: 'Café des Arts', owner: true, role: 'admin', groups: ['Café des Arts'], permissions: { stats: true, planning: false, captions: false }, excluded: false },
    { key: 'youtube:6', platform: 'youtube', alias: 'Compte YouTube 2', name: 'Studio Nova', owner: true, role: 'admin', groups: ['Studio Nova'], permissions: { stats: true, planning: true, captions: false }, excluded: true },
  ],
}

const me = { id: 42, email: 'camille@example.com', name: 'Camille', avatar_url: null, auth_source: 'local', is_superadmin: false }

module.exports = { NOW, me, accounts, groups, spaces, storage, calendarItems, days, videos, postById, sources, assets, proposals, detailedStats, overview,
  groupShares, invitations, aiStatus, thumb }
