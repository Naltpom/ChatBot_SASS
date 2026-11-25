import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Comment, SeriesPoint } from '../../lib/api'
import { periodSentence,
  absoluteUrl, accountState, applyChanges, byVideo, chartModel, chartSummary, commentActions, engagement, heatmap,
  isOwnUrl, nearestIndex, niceStep, personalize, share, sortLabel, sumField,
} from './logic.ts'

const cm = (o: Partial<Comment>): Comment => ({
  id: 1, platform: 'instagram', account_id: 1, account_name: 'a', media_id: 'm1', video_title: 'V1', video_url: null,
  external_id: 'x', parent_id: null, author: 'bob', text: 'hi', like_count: 0, published_at: null, status: 'new',
  reply_text: null, replied_at: null, private_replied_at: null, pending: null, error: null, profile_url: null, dm_url: null, ...o,
})

test('byVideo groupe par vidéo en gardant l’ordre', () => {
  const g = byVideo([cm({ id: 1 }), cm({ id: 2, media_id: 'm2', video_title: 'V2', platform: 'youtube' }), cm({ id: 3, status: 'replied' })])
  assert.equal(g.length, 2)
  assert.deepEqual(g[0].items.map(c => c.id), [1, 3])
  assert.equal(g[0].fresh, 1)
  assert.equal(g[1].title, 'V2')
  assert.deepEqual(g[1].platforms, ['youtube'])
})

test('applyChanges remplace, retire et filtre « À traiter »', () => {
  const items = [cm({ id: 1 }), cm({ id: 2 }), cm({ id: 3 })]
  const out = applyChanges(items, { 1: null, 2: cm({ id: 2, status: 'replied' }) }, 'todo')
  assert.deepEqual(out.map(c => c.id), [3])
  assert.equal(applyChanges(items, { 2: cm({ id: 2, status: 'replied' }) }, 'all').length, 3)
})

test('commentActions : une action principale, le reste dans le menu', () => {
  const ig = commentActions(cm({}), false)
  assert.equal(ig.main?.id, 'reply')
  assert.ok(ig.more.some(a => a.id === 'private'))
  assert.ok(ig.more.some(a => a.id === 'hide'))
  const tt = commentActions(cm({ platform: 'tiktok', video_url: 'https://t' }), false)
  assert.equal(tt.main?.id, 'tiktok')
  assert.ok(!tt.more.some(a => a.id === 'hide'))
  const kw = commentActions(cm({ dm_url: 'https://ig.me/m/bob' }), true)
  assert.equal(kw.main?.id, 'private')
  assert.ok(kw.more.some(a => a.id === 'dm'))
  assert.equal(kw.more.find(a => a.id === 'done')?.label, 'Marquer comme contacté')
  const done = commentActions(cm({ status: 'replied', platform: 'youtube' }), false)
  assert.equal(done.main, null)
  assert.ok(done.more.some(a => a.id === 'reopen'))
})

test('personalize remplace {pseudo}', () => {
  assert.equal(personalize('Hello {pseudo}!', 'bob'), 'Hello @bob!')
  assert.equal(personalize('Hello {pseudo}!', null), 'Hello !')
})

test('niceStep', () => {
  assert.equal(niceStep(0.3), 1)
  assert.equal(niceStep(130), 200)
  assert.equal(niceStep(3400), 5000)
  assert.equal(niceStep(7000), 10000)
})

const pt = (day: string, tt: number | null, yt: number | null): SeriesPoint =>
  ({ day, views: null, followers: null, by_platform: { tiktok: { views: tt, followers: null }, youtube: { views: yt, followers: null } } })

test('chartModel : départ au premier relevé, empilement, échelle', () => {
  const m = chartModel([pt('2026-01-01', null, null), pt('2026-01-02', 100, 50), pt('2026-01-03', 200, 100)], 'views', 352, 226)
  assert.equal(m.series.length, 2)
  assert.deepEqual(m.platforms, ['tiktok', 'youtube'])
  assert.deepEqual(m.totals, [150, 300])
  assert.equal(m.top, 300)
  assert.deepEqual(m.ticks, [0, 100, 200, 300])
  assert.equal(m.x(0), 44)
  assert.equal(m.x(1), 344)
  assert.equal(m.y(0), 200)
  assert.equal(m.y(300), 12)
  assert.match(m.areas[1].area, /^M.*Z$/)
  assert.equal(chartModel([], 'views', 300, 200).platforms.length, 0)
  assert.equal(chartModel([pt('2026-01-01', null, null)], 'views', 300, 200).series.length, 0)
})

test('nearestIndex', () => {
  const pad = { l: 44, r: 8 }
  assert.equal(nearestIndex(0, 10, 352, pad), 0)
  assert.equal(nearestIndex(400, 10, 352, pad), 9)
  assert.equal(nearestIndex(194, 3, 352, pad), 1)
  assert.equal(nearestIndex(100, 1, 352, pad), 0)
})

test('chartSummary', () => {
  const m = chartModel([pt('2026-01-02', 100, 50), pt('2026-01-03', 200, 100)], 'views', 300, 200)
  assert.equal(chartSummary(m, 'Vues', String, d => d), 'Vues du 2026-01-02 au 2026-01-03 : de 150 à 300, soit +150.')
  assert.equal(chartSummary({ series: [], totals: [] }, 'Vues', String, d => d), 'Vues : pas encore de relevé.')
})

test('heatmap : moyenne par créneau et meilleur créneau', () => {
  const mon9 = new Date(2026, 0, 5, 9, 30).toISOString()   // lundi 9 h 30 (heure locale)
  const sun22 = new Date(2026, 0, 11, 22, 0).toISOString() // dimanche 22 h
  const h = heatmap([
    { platform: 'tiktok', published_at: mon9, views: 100, interactions: 0 },
    { platform: 'tiktok', published_at: mon9, views: 300, interactions: 0 },
    { platform: 'tiktok', published_at: sun22, views: 50, interactions: 0 },
    { platform: 'tiktok', published_at: sun22, views: null, interactions: 0 },
  ])
  assert.equal(h.grid[0][3].n, 2)
  assert.equal(h.grid[0][3].avg, 200)
  assert.equal(h.grid[6][7].n, 1)
  assert.deepEqual(h.best, { d: 0, s: 3, avg: 200 })
  assert.equal(h.grid[0][3].level, 1)
  assert.equal(heatmap([]).empty, true)
})

test('accountState', () => {
  assert.equal(accountState({ needs_reconnect: true, mode: 'api', stats: null }).label, 'À reconnecter')
  assert.equal(accountState({ needs_reconnect: false, mode: 'routine', stats: null }).tone, 'muted')
  assert.equal(accountState({ needs_reconnect: false, mode: 'api', stats: null }).tone, 'ok')
})

test('totaux et parts', () => {
  assert.equal(sumField([{ v: 1 }, { v: null }, { v: 3 }], r => r.v), 4)
  assert.equal(sumField([{ v: null }], r => r.v), null)
  assert.equal(engagement({ views: 100, likes: 5, comments: 3, shares: null, saves: 2 }), 0.1)
  assert.equal(engagement({ views: 0, likes: 5, comments: 3, shares: null, saves: 2 }), null)
  assert.equal(share(25, 200), 13)
  assert.equal(share(25, 0), 0)
})

test('URL de l’API', () => {
  assert.equal(absoluteUrl('https://cm.chapote.fr', '/api/cm/assets/3/stream'), 'https://cm.chapote.fr/api/cm/assets/3/stream')
  assert.equal(absoluteUrl('https://cm.chapote.fr/', 'https://x.y/z'), 'https://x.y/z')
  assert.equal(isOwnUrl('https://cm.chapote.fr', 'https://cm.chapote.fr/api/x'), true)
  assert.equal(isOwnUrl('https://cm.chapote.fr', 'https://cm.chapote.fr.evil/api'), false)
  assert.equal(sortLabel('Vues', true, 'desc'), 'Vues ↓')
  assert.equal(sortLabel('Vues', false, 'desc'), 'Vues')
})

test('periodSentence : résumé lisible de la période', () => {
  const f = (n: number | null) => String(n)
  assert.equal(periodSentence(30, { posts: 0, views: null, followers_delta: null }, 0, f), 'Ces 30 derniers jours : aucune vidéo publiée pour l’instant.')
  assert.equal(periodSentence(7, { posts: 3, views: 1200, followers_delta: -4 }, 2, f), 'Ces 7 derniers jours : 3 vidéos publiées sur 2 réseaux, 1200 vues, −4 abonnés.')
  assert.equal(periodSentence(365, { posts: 1, views: null, followers_delta: 5 }, 1, f), 'Cette année : 1 vidéo publiée, +5 abonnés.')
})
