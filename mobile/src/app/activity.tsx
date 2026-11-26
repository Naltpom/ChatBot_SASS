// Centre d'activité (la cloche) : ce qui s'est passé sur vos publications, même si une notification a été
// manquée ou coupée. Vidéos publiées, échecs, brouillons TikTok à valider, 14 derniers jours.
// Filtre par type (retenu sur l'appareil) : fait par le serveur (`status=`), pour ne pas chercher un brouillon
// oublié au milieu de centaines de vidéos publiées.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'
import { getPosts, PLATFORM_LABEL, type Post, type Target } from '../lib/api'
import { Select } from '../features/library/ui'
import { useSession } from '../lib/session'
import { Button, Empty, Icon, Msg, PlatformLogo, Seg, Skeleton, Txt } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'
import { t, locale } from '../lib/i18n'

type Kind = 'published' | 'failed' | 'draft'
type Ev = { key: string; post: Post; t: Target; at: string; kind: Kind }
/** Filtre : tout, à regarder (échecs + brouillons), ou un seul type. Valeur `status` de GET /posts. */
type Filter = 'all' | 'todo' | Kind
const FILTERS: Filter[] = ['all', 'todo', 'failed', 'draft', 'published']
const SERVER: Record<Filter, 'action' | 'failed' | 'inbox' | 'published' | undefined> = { all: undefined, todo: 'action', failed: 'failed', draft: 'inbox', published: 'published' }
const KEEP: Record<Filter, Kind[]> = { all: ['published', 'failed', 'draft'], todo: ['failed', 'draft'], failed: ['failed'], draft: ['draft'], published: ['published'] }
const FILTER_KEY = 'activity-filter'
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return t('il y a {n} min', { n: Math.max(m, 1) })
  const h = Math.round(m / 60)
  if (h < 24) return t('il y a {n} h', { n: h })
  return new Date(iso).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function Activity() {
  const router = useRouter()
  const { c } = useTheme()
  const { scope, spaces, accounts, invitations } = useSession()
  const [tab, setTab] = useState<'posts' | 'system'>('posts')
  // Système : ce qui ne vient pas d'une publication (Drive, comptes à reconnecter, invitations).
  const system: { key: string; icon: 'folder' | 'refresh' | 'users'; tone: string; title: string; text: string; cta: string; go: () => void }[] = []
  const [items, setItems] = useState<Ev[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilterState] = useState<Filter>('all')
  useEffect(() => {
    AsyncStorage.getItem(FILTER_KEY).then(v => { if (v && (FILTERS as string[]).includes(v)) setFilterState(v as Filter) }).catch(() => {})
  }, [])
  const setFilter = (v: Filter) => { setFilterState(v); setItems(null); AsyncStorage.setItem(FILTER_KEY, v).catch(() => {}) }
  // Nombre « à regarder » : gardé du dernier chargement qui le connaît (Tout / À regarder).
  const [todoCount, setTodoCount] = useState<number | null>(null)
  const load = useCallback(() => {
    setErr(null)
    let stale = false
    getPosts(scope, new Date(Date.now() - 14 * 864e5), new Date(Date.now() + 864e5), { limit: 200, status: SERVER[filter] }).then(posts => {
      if (stale) return
      const keep = KEEP[filter]
      const ev: Ev[] = []
      for (const post of posts) for (const t of post.targets) {
        if (t.status === 'PUBLISHED') ev.push({ key: `p${t.id}`, post, t, at: t.published_at || t.scheduled_at, kind: 'published' })
        else if (t.status === 'FAILED') ev.push({ key: `f${t.id}`, post, t, at: t.scheduled_at, kind: 'failed' })
        else if (t.status === 'INBOX') ev.push({ key: `d${t.id}`, post, t, at: t.scheduled_at, kind: 'draft' })
      }
      const shown = ev.filter(e => keep.includes(e.kind))
      shown.sort((a, b) => b.at.localeCompare(a.at))
      if (filter === 'all' || filter === 'todo') setTodoCount(ev.filter(e => e.kind !== 'published').length)
      setItems(shown)
    }).catch(e => { if (!stale) setErr(e?.message || t('Chargement impossible')) })
    return () => { stale = true }
  }, [scope, filter])
  useFocusEffect(load)

  const look = {
    published: { icon: 'check', color: c.ok, title: t('Vidéo publiée') },
    failed: { icon: 'close', color: c.danger, title: t('Échec de publication') },
    draft: { icon: 'clock', color: c.warn, title: t('Brouillon TikTok à publier') },
  } as const
  const todo = todoCount ?? 0
  const filterLabel: Record<Filter, string> = { all: t('Tout'), todo: t('À regarder'), failed: t('Échecs'), draft: t('Brouillons TikTok à publier'), published: t('Vidéos publiées') }
  for (const sp of spaces) {
    const st = sp.storage?.state
    if (st === 'full' || st === 'almost_full' || (st === 'missing' && sp.accounts)) system.push({ key: `s${sp.org_id}`, icon: 'folder', tone: st === 'almost_full' ? c.warn : c.danger,
      title: st === 'missing' ? t('Google Drive à relier') : st === 'full' ? t('Stockage Drive plein') : t('Stockage Drive presque plein'),
      text: `${sp.name} · ${st === 'missing' ? t('obligatoire pour publier') : t('les nouvelles vidéos risquent d’être refusées')}`, cta: st === 'missing' ? t('Relier') : t('Voir'), go: () => router.push('/storage') })
  }
  for (const a of accounts.filter(x => x.needs_reconnect)) system.push({ key: `a${a.platform}${a.id}`, icon: 'refresh', tone: c.danger,
    title: t('{platform} à reconnecter', { platform: PLATFORM_LABEL[a.platform] }), text: `${a.name || a.handle || ''} · ${t('les publications sur ce compte sont en pause')}`, cta: t('Reconnecter'), go: () => router.push('/accounts') })
  for (const i of invitations) system.push({ key: `i${i.id}`, icon: 'users', tone: c.primary,
    title: t('Invitation : {group}', { group: i.group_name }), text: `${t('{who} vous invite', { who: i.invited_by || i.owner || t('Une équipe') })} · ${t(i.role_label)}`, cta: t('Voir'), go: () => router.push('/accounts') })

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 48, width: '100%', maxWidth: 820, alignSelf: 'center' }}
      data={tab === 'posts' ? items || [] : []}
      keyExtractor={i => i.key}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => { load() }} tintColor={c.muted} />}
      ListHeaderComponent={
        <View style={{ gap: space.sm, paddingBottom: space.sm }}>
          <Seg label={t('Type d’activité')} value={tab} onChange={setTab} options={[['posts', `${t('Publications')}${todo ? ` (${todo})` : ''}`], ['system', `${t('Système')}${system.length ? ` (${system.length})` : ''}`]]} />
          {err ? <Msg kind="err">{err}</Msg> : null}
          {tab === 'posts' ? <Select label="" value={filter} onChange={setFilter} options={FILTERS.map(f => [f, filterLabel[f]] as [Filter, string])} /> : null}
          {tab === 'posts' && items ? <Txt small muted>{todo ? `${t('{n} à regarder', { n: todo })} · ` : ''}{t('14 derniers jours')}</Txt> : null}
          {tab === 'system' ? (system.length ? system.map(x => (
            <View key={x.key} style={{ flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: 'center' }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={x.icon} size={18} color={x.tone} />
              </View>
              <View style={{ flex: 1, gap: 2 }}><Txt bold>{x.title}</Txt><Txt small muted numberOfLines={2}>{x.text}</Txt></View>
              <Button small title={x.cta} onPress={x.go} />
            </View>
          )) : <Empty title={t('Tout va bien')} icon="check">{t('Drive, comptes et invitations : rien à faire pour l’instant.')}</Empty>) : null}
        </View>
      }
      ListEmptyComponent={tab === 'system' ? undefined : !items ? <View style={{ gap: space.sm }}><Skeleton h={64} n={5} /></View>
        : filter !== 'all' ? <Empty title={t('Rien de ce type')} icon="bell" action={<Button small title={t('Tout afficher')} onPress={() => setFilter('all')} />}>{t('Rien sur les 14 derniers jours pour « {filter} ».', { filter: filterLabel[filter] })}</Empty>
        : <Empty title={t('Rien de neuf')} icon="bell">{t('Les vidéos publiées, les échecs et les brouillons TikTok à valider apparaîtront ici.')}</Empty>}

      renderItem={({ item: i }) => {
        const l = look[i.kind]
        return (
          <Pressable onPress={() => router.push({ pathname: '/post/[id]', params: { id: String(i.post.id) } })} accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surface,
              borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.7 : 1 })}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={l.icon} size={18} color={l.color} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt bold>{l.title}</Txt>
              <Txt small numberOfLines={1}>{i.post.title}</Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <PlatformLogo platform={i.t.platform} size={14} />
                <Txt small muted numberOfLines={1} style={{ flex: 1 }}>
                  {i.t.account_name || PLATFORM_LABEL[i.t.platform]} · {ago(i.at)}{i.kind === 'failed' && i.t.error_message ? ` · ${i.t.error_message}` : ''}
                </Txt>
              </View>
            </View>
            <Icon name="right" size={16} color={c.muted} />
          </Pressable>
        )
      }}
    />
  )
}
