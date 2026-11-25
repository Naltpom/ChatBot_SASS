// Centre d'activité (la cloche) : ce qui s'est passé sur vos publications, même si une notification a été
// manquée ou coupée. Vidéos publiées, échecs, brouillons TikTok à valider, 14 derniers jours.
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'
import { getPosts, PLATFORM_LABEL, type Post, type Target } from '../lib/api'
import { useSession } from '../lib/session'
import { Empty, Icon, Msg, PlatformLogo, Skeleton, Txt } from '../ui/kit'
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
  const { scope } = useSession()
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

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 48, width: '100%', maxWidth: 820, alignSelf: 'center' }}
      data={items || []}
      keyExtractor={i => i.key}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={c.muted} />}
      ListHeaderComponent={
        <View style={{ gap: space.sm, paddingBottom: space.sm }}>
          {err ? <Msg kind="err">{err}</Msg> : null}
          {items ? <Txt small muted>{todo ? `${todo} à regarder · ` : ''}14 derniers jours</Txt> : null}
        </View>
      }
      ListEmptyComponent={!items ? <View style={{ gap: space.sm }}><Skeleton h={64} n={5} /></View>
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
