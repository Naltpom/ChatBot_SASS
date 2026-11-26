import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  byDay, dayKey, filterItems, groupItems, groupOf, openTarget, periodSummary, pillOf, postIdOf, rowNote, rowSide,
  searchSections, shiftKey, shortTitle, startOfWeek, stateOf, weekKeys, weekRange,
} from './calendar.ts'
import { diffsOf, editableText, initialOpen, postItems, postWindow, splitCommon, tiktokLinkOk } from './sheet.ts'
import {
  buildBody, buildTarget, postOrg, earliestSlot, daySlots, toSlot, stepProblems, needsOptions, nearbyPosts, tooClose, unavailable, captionCount, defaults, fileNameOf, landingDay, nextHour, parseCollaborators, problems,
  type ComposeState, type TikTokOpts, type YouTubeOpts,
} from './compose.ts'

const target = (o: Record<string, any> = {}): any => ({
  kind: 'target', id: 1, post_id: 10, platform: 'tiktok', account_id: 1, account_name: 'a', scheduled_at: '2026-11-24T18:00:00Z',
  at: '2026-11-24T18:00:00Z', options: {}, status: 'SCHEDULED', external_id: null, url: null, fail_reason: null, error_message: null,
  notice: null, published_at: null, can_edit: true, can_retry: false, title: 'Titre', group: 'p10', ...o,
})
const video = (o: Record<string, any> = {}): any => ({
  kind: 'video', id: 5, platform: 'youtube', account_id: 2, account_name: 'b', external_id: 'x', title: 'Vidéo', url: null,
  thumbnail_url: null, published_at: '2026-11-20T10:00:00Z', at: '2026-11-20T10:00:00Z', duration_sec: 30, views: 1200,
  likes: 3, comments: 1, shares: null, saves: null, via_chapote: false, group: 'tvidéo|2026-11-20', ...o,
})

test('semaine, jours et clés', () => {
  assert.equal(dayKey(startOfWeek(new Date(2026, 10, 26))), '2026-11-23')         // jeudi → lundi
  assert.deepEqual(weekKeys('2026-11-29'), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'])
  assert.equal(shiftKey('2026-11-30', 1), '2026-12-01')
  assert.equal(shiftKey('2026-03-01', -1), '2026-02-28')
  const [s, e] = weekRange('2026-11-25')
  assert.equal(dayKey(s), '2026-11-23'); assert.equal(dayKey(e), '2026-11-30')
})

test('états et pastilles', () => {
  assert.equal(stateOf(video()), 'done')
  assert.equal(stateOf(target()), 'planned')
  assert.equal(stateOf(target({ status: 'FAILED' })), 'failed')
  assert.equal(stateOf(target({ status: 'PUBLISHED' })), 'done')
  assert.equal(pillOf(target({ status: 'INBOX' })), 'draft')
  assert.equal(stateOf(target({ status: 'INBOX' })), 'planned')
})

test('titre court', () => {
  assert.equal(shortTitle('Clair de lune #piano #debussy\nsuite'), 'Clair de lune')
  assert.equal(shortTitle('\n  #seul'), '#seul')
  assert.equal(shortTitle('x'.repeat(100)).length, 80)
})

test('filtres, jours et groupes', () => {
  const list = [target(), target({ id: 2, platform: 'instagram', account_id: 3 }), target({ id: 3, status: 'CANCELLED' }), video()]
  assert.equal(filterItems(list).length, 3)
  assert.equal(filterItems(list, ['youtube']).length, 1)
  assert.equal(filterItems(list, [], 'planned').length, 2)
  assert.equal(filterItems(list, [], 'done').length, 1)
  const days = byDay(filterItems(list))
  assert.equal(days.get(dayKey(new Date('2026-11-24T18:00:00Z')))?.length, 2)
  const groups = groupItems(filterItems(list))
  assert.equal(groups.length, 2)
  assert.equal(groups[1].items.length, 2)
  // Jamais deux fois le même compte dans un groupe.
  assert.equal(groupItems([target(), target({ id: 9 })]).length, 2)
  // Même titre, plus de 6 h d'écart : deux lignes.
  assert.equal(groupItems([video(), video({ id: 6, platform: 'tiktok', at: '2026-11-20T20:00:00Z' })]).length, 2)
  assert.equal(groupItems([video(), video({ id: 6, platform: 'tiktok', at: '2026-11-20T12:00:00Z' })]).length, 1)
})

test('ouverture d’une ligne', () => {
  const [g] = groupItems([target()])
  assert.equal(postIdOf(g), 10)
  assert.deepEqual(openTarget(g), { pathname: '/post/[id]', id: '10' })
  const [v] = groupItems([video()])
  assert.equal(postIdOf(v), null)
  assert.deepEqual(openTarget(v), { pathname: '/video/[id]', id: '5' })
  const [pv] = groupItems([video({ group: 'p42' })])
  assert.deepEqual(openTarget(pv), { pathname: '/post/[id]', id: '42' })
})

test('résumés, notes et groupe', () => {
  const label = (p: string) => p.toUpperCase()
  const [failed] = groupItems([target({ status: 'FAILED', error_message: 'Jeton expiré' })])
  assert.deepEqual(rowSide(failed), { text: '1 échec', err: true })
  assert.deepEqual(rowNote(failed, label as any), { text: 'TIKTOK : Jeton expiré', tone: 'danger' })
  const [draft] = groupItems([target({ status: 'INBOX' })])
  assert.equal(rowNote(draft, label as any)?.tone, 'warn')
  assert.equal(rowSide(draft).text, 'à publier')
  const [v] = groupItems([video()])
  assert.equal(rowSide(v, n => `${n}`).text, '1200 vues')
  assert.deepEqual(periodSummary([video(), target()]), { done: 1, planned: 1, views: 1200 })
  const groups: any[] = [{ id: 1, name: 'A', color: 'blue', accounts: [{ platform: 'youtube', id: 2 }] }]
  assert.equal(groupOf([video()], groups)?.name, 'A')
  assert.equal(groupOf([target()], groups), null)
  const s = searchSections([video(), target()])
  assert.equal(s[0].day > s[1].day, true)
})

test('fiche : légende commune et différences', () => {
  assert.deepEqual(splitCommon('Bonjour #a #b #a'), { body: 'Bonjour', tags: ['#a', '#b'] })
  const yt = target({ platform: 'youtube', options: { title: 'T', tags: ['x', 'y'], privacy_status: 'unlisted', made_for_kids: true, description: 'commun' } })
  assert.deepEqual(diffsOf(yt, 'commun'), [['Titre YouTube', 'T'], ['Mots-clés', 'x, y'], ['Visibilité', 'Non répertoriée · pour enfants']])
  assert.deepEqual(diffsOf(target({ options: { title: 'autre', mode: 'draft' } }), 'commun'), [['Légende', 'autre'], ['Envoi', 'Brouillon dans l’app TikTok']])
  assert.deepEqual(diffsOf(target({ status: 'INBOX', options: { title: 'autre', mode: 'draft' } }), 'commun'), [])
  assert.deepEqual(diffsOf(video(), 'x'), [])
  assert.equal(editableText({ platform: 'tiktok', options: { mode: 'draft' } }), null)
  assert.equal(editableText({ platform: 'youtube', options: {} })?.key, 'title')
  assert.equal(editableText({ platform: 'instagram', options: {} })?.key, 'caption')
  assert.equal(tiktokLinkOk(''), true)
  assert.equal(tiktokLinkOk('https://vm.tiktok.com/abc'), true)
  assert.equal(tiktokLinkOk('https://example.com'), false)
})

test('fiche : éléments du post', () => {
  const post: any = { id: 10, title: 'Titre', targets: [
    { ...target(), kind: undefined, at: undefined },
    { ...target({ id: 2, platform: 'youtube', account_id: 2, status: 'PUBLISHED', published_at: '2026-11-24T18:01:00Z' }) },
    { ...target({ id: 3, platform: 'instagram', account_id: 4, status: 'CANCELLED' }) },
  ] }
  const cal = [target(), video({ group: 'p10', account_id: 2, at: '2026-11-24T18:02:00Z' }), target({ id: 77, group: 'p11' })]
  const items = postItems(post, cal)
  assert.deepEqual(items.map(i => `${i.kind}-${i.id}`), ['target-1', 'video-5'])
  const w = postWindow(post)!
  assert.ok(w[0] < new Date('2026-11-24T18:00:00Z') && w[1] > new Date('2026-11-24T18:01:00Z'))
  assert.equal(initialOpen([target({ status: 'FAILED', id: 4 }), video()]), 'target-4')
  assert.equal(initialOpen([video()]), 'video-5')
  assert.equal(initialOpen([video(), target()]), null)
})

const acc = (o: Record<string, any>): any => ({ platform: 'tiktok', id: 1, name: 'tt', can_publish: true, needs_reconnect: false, mode: 'api', ...o })
const config: any = { max_upload_bytes: 1000, youtube_max_duration_sec: 180, instagram_max_duration_sec: 900 }
const state = (o: Partial<ComposeState> = {}): ComposeState => ({
  hasVideo: true, size: 100, duration: 30, title: 'T', chosen: [], opts: {}, creators: {}, when: 'at',
  at: new Date('2026-12-01T10:00:00Z'), sameTime: true, times: {}, ...o,
})
const now = new Date('2026-11-24T10:00:00Z').getTime()

test('nouvelle publication : problèmes', () => {
  assert.deepEqual(problems(state({ hasVideo: false, title: ' ' }), config, now),
    ['Choisissez une vidéo.', 'Donnez un titre à la publication.', 'Choisissez au moins un compte.'])
  const tt = acc({}), yt = acc({ platform: 'youtube', id: 2, name: 'yt' }), ig = acc({ platform: 'instagram', id: 3, name: 'ig' })
  const ci: any = { can_post: true, creator: { max_video_post_duration_sec: 20, privacy_level_options: [] } }
  const p = problems(state({ size: 5000, chosen: [tt, yt, ig], opts: { 'tiktok:1': defaults(tt), 'youtube:2': defaults(yt), 'instagram:3': { ...defaults(ig), collaborators: 'a b c d' } as any },
    creators: { 'tiktok:1': ci }, duration: 200 }), config, now)
  assert.ok(p.includes('Vidéo trop volumineuse (1000 o au plus).'))
  assert.ok(p.includes('tt : vidéo trop longue (20 s au plus sur ce compte).'))
  assert.ok(p.includes('tt : choisissez qui peut voir la vidéo.'))
  assert.ok(p.includes('yt : indiquez si la vidéo est conçue pour les enfants.'))
  assert.ok(p.includes('yt : vidéo trop longue pour un Short (3 min au plus).'))
  assert.ok(p.includes('ig : 3 collaborateurs au plus.'))
  assert.deepEqual(problems(state({ at: new Date(now - 3600e3) }), config, now).includes("L'heure choisie est déjà passée."), true)
  assert.deepEqual(problems(state({ chosen: [tt], opts: { 'tiktok:1': defaults(tt) }, creators: { 'tiktok:1': 'loading' } }), config, now),
    ['tt : options du compte en cours de lecture…'])
  const brand = { ...(defaults(tt) as TikTokOpts), privacy: 'PUBLIC_TO_EVERYONE', commercial: true }
  assert.deepEqual(problems(state({ chosen: [tt], opts: { 'tiktok:1': brand }, creators: { 'tiktok:1': ci }, duration: 10 }), config, now),
    ["tt : indiquez si le contenu fait votre promotion, celle d'un tiers, ou les deux."])
})

test('nouvelle publication : corps envoyé', () => {
  const tt = acc({}), yt = acc({ platform: 'youtube', id: 2 }), ig = acc({ platform: 'instagram', id: 3 })
  const t: TikTokOpts = { ...(defaults(tt) as TikTokOpts), privacy: 'SELF_ONLY', commercial: true, yourBrand: true, text: 'à moi' }
  assert.deepEqual(buildTarget(tt, t, state()).options, { mode: 'direct', privacy_level: 'SELF_ONLY', allow_comment: false, allow_duet: false,
    allow_stitch: false, brand_organic: true, brand_content: false, title: 'à moi' })
  assert.equal(buildTarget(tt, { ...t, mode: 'draft' }, state()).options.privacy_level, null)
  const y: YouTubeOpts = { ...(defaults(yt) as YouTubeOpts), kids: 'no', tags: 'a, b,,c ' }
  assert.deepEqual(buildTarget(yt, y, state()).options, { tags: ['a', 'b', 'c'], privacy_status: 'public', made_for_kids: false,
    synthetic_media: false, category_id: '10', notify_subscribers: true })
  assert.deepEqual(buildTarget(ig, { text: '', feed: false, collaborators: '@x, y' }, state()).options, { share_to_feed: false, collaborators: ['x', 'y'] })
  // Miniature : instant de la vidéo choisi par compte (TikTok direct, Instagram sauf image envoyée à part).
  assert.equal(buildTarget(tt, { ...t, coverMs: 41500.4 }, state()).options.cover_timestamp_ms, 41500)
  assert.equal('cover_timestamp_ms' in buildTarget(tt, { ...t, mode: 'draft', coverMs: 1000 }, state()).options, false)
  assert.equal(buildTarget(ig, { text: '', feed: true, collaborators: '', coverMs: 2000 }, state()).options.thumb_offset_ms, 2000)
  assert.equal('thumb_offset_ms' in buildTarget(ig, { text: '', feed: true, collaborators: '', coverMs: 2000 }, { ...state(), coverImage: true }).options, false)
  assert.equal(buildTarget(ig, defaults(ig), state({ when: 'now' })).scheduled_at, null)
  const own = new Date('2026-12-02T08:00:00Z')
  assert.equal(buildTarget(ig, defaults(ig), state({ sameTime: false, times: { 'instagram:3': own } })).scheduled_at, own.toISOString())
  const body = buildBody(7, { ...state({ chosen: [ig] }), caption: 'c', title: ' T ' }, { kind: 'file', name: 'v.mp4', size: 99 })
  assert.deepEqual({ ...body, targets: undefined }, { org_id: 7, title: 'T', caption: 'c', targets: undefined, file_name: 'v.mp4', video_size: 99 })
  const fromAsset = buildBody(null, { ...state({ chosen: [ig] }), caption: '' }, { kind: 'asset', id: 4 }) as Record<string, unknown>
  assert.equal(fromAsset.asset_id, 4); assert.equal(fromAsset.file_name, undefined)
  const withRights = buildBody(null, { ...state({ chosen: [ig] }), caption: '', rights: 'protected', rightsNote: '  reprise  ' }, { kind: 'asset', id: 4 }) as Record<string, unknown>
  assert.equal(withRights.rights, 'protected'); assert.equal(withRights.rights_note, 'reprise')
  assert.equal('rights' in fromAsset, false)
})

test('nouvelle publication : utilitaires', () => {
  assert.deepEqual(captionCount('a #b #c'), { chars: 7, tags: 2 })
  assert.deepEqual(parseCollaborators('@a, b  a;c'), ['a', 'b', 'c'])
  assert.equal(nextHour(new Date(2026, 0, 1, 9, 20)).getHours(), 10)
  assert.equal(nextHour(new Date(2026, 0, 1, 9, 20)).getMinutes(), 0)
  assert.equal(fileNameOf('file:///x/IMG_1.MOV'), 'IMG_1.MOV')
  assert.equal(fileNameOf('file:///x/abc', null, 'video/quicktime'), 'abc.mov')
  assert.equal(fileNameOf('content://x/123', 'clip.mp4'), 'clip.mp4')
  assert.equal(landingDay({ when: 'now', at: new Date(), sameTime: true, times: {}, chosen: [] }, new Date(2026, 4, 3, 12)), '2026-05-03')
  assert.equal(landingDay({ when: 'at', at: new Date(2026, 4, 9, 12), sameTime: true, times: {}, chosen: [] }), '2026-05-09')
})

test('publication : espace des comptes choisis, comptes en lecture seule', () => {
  assert.deepEqual(postOrg([{ org_id: 12 }, { org_id: 12 }], null), { org: 12, mixed: false })
  assert.deepEqual(postOrg([{ org_id: null }], 5), { org: null, mixed: false })
  assert.equal(postOrg([{ org_id: 12 }, { org_id: null }], null).mixed, true)
  assert.deepEqual(postOrg([], 7), { org: 7, mixed: false })
  assert.equal(unavailable({ can_publish: true, needs_reconnect: false, role: 'viewer' }), 'Lecture seule')
  assert.equal(unavailable({ can_publish: true, needs_reconnect: false, role: 'editor' }), null)
})

test('compose : problèmes par étape, réglages obligatoires, publications proches', () => {
  const now = Date.parse('2026-05-01T10:00:00Z')
  const yt = { platform: 'youtube', id: 2, name: 'YT', can_publish: true } as any
  const base = { hasVideo: false, size: null, duration: null, title: '', chosen: [yt], opts: { 'youtube:2': defaults(yt) }, creators: {},
    when: 'at' as const, at: new Date(now - 3600e3), sameTime: true, times: {} }
  const p = stepProblems(base, null, now)
  assert.deepEqual(p.content, ['Choisissez une vidéo.', 'Donnez un titre à la publication.'])
  assert.deepEqual(p.targets, ["L'heure choisie est déjà passée."])
  assert.equal(p.options.length, 1)
  assert.equal(needsOptions([yt], { 'youtube:2': defaults(yt) }), true)
  assert.equal(needsOptions([yt], { 'youtube:2': { ...defaults(yt), kids: 'no' } as any }), false)
  const at = new Date('2026-05-01T18:00:00')
  const items = [
    { kind: 'target', platform: 'youtube', account_id: 2, at: new Date('2026-05-01T18:40:00').toISOString(), title: 'A', status: 'scheduled' },
    { kind: 'target', platform: 'youtube', account_id: 2, at: new Date('2026-05-01T09:00:00').toISOString(), title: 'B', status: 'scheduled' },
    { kind: 'target', platform: 'youtube', account_id: 2, at: new Date('2026-05-02T18:10:00').toISOString(), title: 'C', status: 'scheduled' },
    { kind: 'target', platform: 'youtube', account_id: 3, at: new Date('2026-05-01T18:10:00').toISOString(), title: 'D', status: 'scheduled' },
  ]
  const near = nearbyPosts(items, [yt], () => at)
  assert.deepEqual(near['youtube:2'].map(x => [x.title, x.minutes]), [['B', 540], ['A', 40]])
  assert.deepEqual(tooClose(near), ['youtube:2'])
})

test('créneaux de 15 minutes, au moins 15 minutes après maintenant', () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 10, 25, h, m, s)
  const hm = (d: Date) => `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  assert.equal(hm(earliestSlot(at(18, 7))), '25 18:30')
  assert.equal(hm(earliestSlot(at(18, 15))), '25 18:30')
  assert.equal(hm(earliestSlot(at(18, 15, 20))), '25 18:45')
  assert.equal(hm(earliestSlot(at(18, 0))), '25 18:15')
  assert.equal(hm(earliestSlot(at(23, 50))), '26 0:15')
  const today = daySlots(at(0, 0), at(22, 10))
  assert.deepEqual(today.map(hm), ['25 22:30', '25 22:45', '25 23:00', '25 23:15', '25 23:30', '25 23:45'])
  assert.equal(daySlots(new Date(2026, 10, 26), at(22, 10)).length, 96)
  assert.equal(hm(toSlot(at(9, 0), at(18, 7))), '25 18:30')
  assert.equal(hm(toSlot(new Date(2026, 10, 26, 9, 5), at(18, 7))), '26 9:15')
})
