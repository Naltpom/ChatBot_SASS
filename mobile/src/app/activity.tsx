// Centre d'activité (la cloche) : ce qui s'est passé sur vos publications, même si une notification a été
// manquée ou coupée. Vidéos publiées, échecs, brouillons TikTok à valider, 14 derniers jours.
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'
import { getPosts, PLATFORM_LABEL, type Post, type Target } from '../lib/api'
import { useSession } from '../lib/session'
import { Button, Empty, Icon, Msg, PlatformLogo, Seg, Skeleton, Txt } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'

type Ev = { key: string; post: Post; t: Target; at: string; kind: 'published' | 'failed' | 'draft' }
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `il y a ${Math.max(m, 1)} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
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
  const load = useCallback(() => {
    setErr(null)
    getPosts(scope, new Date(Date.now() - 14 * 864e5), new Date(Date.now() + 864e5), { limit: 200 }).then(posts => {
      const ev: Ev[] = []
      for (const post of posts) for (const t of post.targets) {
        if (t.status === 'PUBLISHED') ev.push({ key: `p${t.id}`, post, t, at: t.published_at || t.scheduled_at, kind: 'published' })
        else if (t.status === 'FAILED') ev.push({ key: `f${t.id}`, post, t, at: t.scheduled_at, kind: 'failed' })
        else if (t.status === 'INBOX') ev.push({ key: `d${t.id}`, post, t, at: t.scheduled_at, kind: 'draft' })
      }
      ev.sort((a, b) => b.at.localeCompare(a.at))
      setItems(ev)
    }).catch(e => setErr(e?.message || 'Chargement impossible'))
  }, [scope])
  useFocusEffect(load)

  const look = {
    published: { icon: 'check', color: c.ok, title: 'Vidéo publiée' },
    failed: { icon: 'close', color: c.danger, title: 'Échec de publication' },
    draft: { icon: 'clock', color: c.warn, title: 'Brouillon TikTok à publier' },
  } as const
  const todo = (items || []).filter(i => i.kind !== 'published').length
  for (const sp of spaces) {
    const st = sp.storage?.state
    if (st === 'full' || st === 'almost_full' || (st === 'missing' && sp.accounts)) system.push({ key: `s${sp.org_id}`, icon: 'folder', tone: st === 'almost_full' ? c.warn : c.danger,
      title: st === 'missing' ? 'Google Drive à relier' : st === 'full' ? 'Stockage Drive plein' : 'Stockage Drive presque plein',
      text: `${sp.name} · ${st === 'missing' ? 'obligatoire pour publier' : 'les nouvelles vidéos risquent d’être refusées'}`, cta: st === 'missing' ? 'Relier' : 'Voir', go: () => router.push('/storage') })
  }
  for (const a of accounts.filter(x => x.needs_reconnect)) system.push({ key: `a${a.platform}${a.id}`, icon: 'refresh', tone: c.danger,
    title: `${PLATFORM_LABEL[a.platform]} à reconnecter`, text: `${a.name || a.handle || ''} · les publications sur ce compte sont en pause`, cta: 'Reconnecter', go: () => router.push('/accounts') })
  for (const i of invitations) system.push({ key: `i${i.id}`, icon: 'users', tone: c.primary,
    title: `Invitation : ${i.group_name}`, text: `${i.invited_by || i.owner || 'Une équipe'} vous invite · ${i.role_label}`, cta: 'Voir', go: () => router.push('/accounts') })

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 48, width: '100%', maxWidth: 820, alignSelf: 'center' }}
      data={tab === 'posts' ? items || [] : []}
      keyExtractor={i => i.key}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={c.muted} />}
      ListHeaderComponent={
        <View style={{ gap: space.sm, paddingBottom: space.sm }}>
          <Seg label="Type d’activité" value={tab} onChange={setTab} options={[['posts', `Publications${todo ? ` (${todo})` : ''}`], ['system', `Système${system.length ? ` (${system.length})` : ''}`]]} />
          {err ? <Msg kind="err">{err}</Msg> : null}
          {tab === 'posts' && items ? <Txt small muted>{todo ? `${todo} à regarder · ` : ''}14 derniers jours</Txt> : null}
          {tab === 'system' ? (system.length ? system.map(x => (
            <View key={x.key} style={{ flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: 'center' }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={x.icon} size={18} color={x.tone} />
              </View>
              <View style={{ flex: 1, gap: 2 }}><Txt bold>{x.title}</Txt><Txt small muted numberOfLines={2}>{x.text}</Txt></View>
              <Button small title={x.cta} onPress={x.go} />
            </View>
          )) : <Empty title="Tout va bien" icon="check">Drive, comptes et invitations : rien à faire pour l’instant.</Empty>) : null}
        </View>
      }
      ListEmptyComponent={tab === 'system' ? undefined : !items ? <View style={{ gap: space.sm }}><Skeleton h={64} n={5} /></View>
        : <Empty title="Rien de neuf" icon="bell">Les vidéos publiées, les échecs et les brouillons TikTok à valider apparaîtront ici.</Empty>}
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
