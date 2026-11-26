// Fiche d'une publication (comme la fenêtre « Publication » du planning web) : média 9:16, titre, date,
// fiche vidéo, légende commune repliable, une carte par plateforme avec son état et ses actions.
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { downloadLink, getAsset, getCalendar, getPost, type CalendarItem, type Post } from '../../lib/api'
import { fmtDateTime, fmtDuration } from '../../lib/format'
import { useLoad, useRole, useSession } from '../../lib/session'
import { Button, Chip, GroupDot, Icon, Loading, Msg, Row, Screen, Skeleton, Txt, groupHex } from '../../ui/kit'
import { showDialog } from '../../ui/dialog'
import { space, useTheme } from '../../ui/theme'
import { groupOf, shortTitle, type VideoItem } from '../../features/planning/calendar'
import { apiUrl, openLink, PostMedia } from '../../features/planning/media'
import { PlatformCard } from '../../features/planning/PlatformCard'
import { initialOpen, postItems, postWindow, splitCommon } from '../../features/planning/sheet'
import { RightsBox } from '../../features/planning/RightsBox'
import { t } from '../../lib/i18n'

export default function PublicationScreen() {
  const { c } = useTheme()
  const router = useRouter()
  const { id: raw } = useLocalSearchParams<{ id: string }>()
  const id = Number(raw)
  const { org, groups } = useSession()
  const { canEdit } = useRole()

  const post = useLoad(() => getPost(id), [id], 'post-sheet')
  const win = post.data ? postWindow(post.data) : null
  const winKey = win ? `${win[0].getTime()}-${win[1].getTime()}` : ''
  // Le calendrier donne les vidéos relevées (chiffres, fiche vidéo) de cette publication.
  const cal = useLoad(s => (win ? getCalendar({ org: (post.data as (Post & { org_id?: number | null }) | null)?.org_id ?? null, group: null }, win[0], win[1]) : Promise.resolve(null)), [id, winKey], 'post-sheet-cal')
  const assetId = (post.data as (Post & { asset_id?: number | null }) | null)?.asset_id ?? null
  const asset = useLoad(() => (assetId ? getAsset(org, assetId).catch(() => null) : Promise.resolve(null)), [assetId], 'post-sheet-asset')

  const items: CalendarItem[] = useMemo(() => (post.data ? postItems(post.data, cal.data?.items || []) : []), [post.data, cal.data])
  const [openKey, setOpenKey] = useState<string | null | undefined>(undefined)
  const shownKey = openKey === undefined ? initialOpen(items) : openKey
  const [more, setMore] = useState(false)
  const [pulling, setPulling] = useState(false)

  const reload = () => { post.reload(); cal.reload() }
  const refresh = () => { setPulling(true); reload(); setTimeout(() => setPulling(false), 800) }

  if (!Number.isFinite(id) || id <= 0) return <Screen><Msg kind="err">{t('Publication introuvable.')}</Msg></Screen>
  if (!post.data) {
    return (
      <Screen>
        {post.error ? <Msg kind="err">{post.error}</Msg> : <><Skeleton h={213} /><Skeleton h={64} n={2} /></>}
        {post.loading && !post.error ? <Loading /> : null}
      </Screen>
    )
  }

  const p = post.data
  const group = groupOf(items, groups)
  const video = items.find(i => i.kind === 'video') as VideoItem | undefined
  const common = p.caption || video?.title || ''
  const title = shortTitle(p.title) || t('Sans titre')
  const { body, tags } = splitCommon(common)
  const showBody = !!body && shortTitle(body) !== title
  const duration = p.duration_sec ?? asset.data?.duration_sec ?? video?.duration_sec ?? null
  const at = items[0]?.at || p.targets[0]?.scheduled_at || p.created_at
  const thumb = video?.thumbnail_url || (asset.data?.thumbnail ? apiUrl(asset.data.thumbnail, org) : null)
  // Téléchargement : lien signé ouvert dans le navigateur (qui enregistre le fichier) ; miniature choisie par la
  // plateforme (pas d'image chez Chapote) : celle de la plateforme.
  const download = async (kind: 'video' | 'thumbnail') => {
    try { await openLink((await downloadLink(p.id, kind)).url) } catch (e) {
      if (kind === 'thumbnail' && thumb && !thumb.startsWith(apiUrl('', null))) { openLink(thumb); return }
      showDialog(t('Téléchargement impossible'), (e as Error).message)
    }
  }
  const stream = asset.data?.stream ? apiUrl(asset.data.stream, org) : p.status === 'READY' ? apiUrl(`/api/cm/posts/${p.id}/video`, null) : null

  return (
    <Screen onRefresh={refresh} refreshing={pulling}>
      {group ? <View style={{ height: 5, borderRadius: 3, backgroundColor: groupHex(group.color) }} accessibilityElementsHidden /> : null}
      <Row gap={space.lg} style={{ alignItems: 'flex-start' }}>
        <PostMedia stream={stream} thumb={thumb} poster={apiUrl(`/api/cm/posts/${p.id}/thumbnail`, null)} externalUrl={video?.url} width={124} fullscreen />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          {group ? <Row gap={6}><GroupDot color={group.color} /><Txt small bold numberOfLines={1}>{group.name}</Txt></Row> : null}
          <Txt bold size={20} accessibilityRole="header" numberOfLines={4}>{title}</Txt>
          <Txt small muted>{fmtDateTime(at)}{duration ? ` · ${fmtDuration(duration)}` : ''}</Txt>
          {video ? (
            <Pressable onPress={() => router.push({ pathname: '/video/[id]', params: { id: String(video.id) } })} accessibilityRole="link"
              accessibilityLabel={t('Fiche vidéo : stats et commentaires')} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Txt small bold color={c.accent}>{t('Stats et commentaires')}</Txt><Icon name="right" size={16} color={c.accent} />
            </Pressable>
          ) : null}
          {asset.data?.folder_url ? (
            <Pressable onPress={() => openLink(asset.data!.folder_url!)} accessibilityRole="link" accessibilityLabel={t('Ouvrir le dossier Drive')}
              style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Txt small color={c.muted}>{t('Dossier Drive')}</Txt><Icon name="external" size={14} color={c.muted} />
            </Pressable>
          ) : null}
        </View>
      </Row>

      <Row gap={space.sm}>
        <Button small icon="download" title={t('Télécharger la vidéo')} disabled={p.status !== 'READY'} onPress={() => download('video')} style={{ flex: 1 }} />
        <Button small icon="download" title={t('Télécharger la miniature')} onPress={() => download('thumbnail')} style={{ flex: 1 }} />
      </Row>

      {post.data ? <RightsBox post={post.data} canEdit={canEdit} onSaved={p => post.setData(p)} /> : null}

      {showBody || tags.length ? (
        <View style={{ gap: 6 }}>
          <Txt small bold muted accessibilityRole="header">{t('Légende commune')}</Txt>
          {showBody ? <Txt small numberOfLines={more ? undefined : 3} selectable>{body}</Txt> : null}
          {body.length > 140 ? (
            <Pressable onPress={() => setMore(m => !m)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
              <Txt small bold color={c.accent}>{more ? t('Voir moins') : t('Voir plus')}</Txt>
            </Pressable>
          ) : null}
          {tags.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityLabel={t('Hashtags')}>
              {tags.map(tag => <Chip key={tag} label={tag} />)}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Txt small bold muted accessibilityRole="header">{t('Plateformes')}</Txt>
        {items.length === 0 ? <Txt small muted>{t('Aucune plateforme (publication annulée).')}</Txt> : null}
        {items.map(i => {
          const k = `${i.kind}-${i.id}`
          return <PlatformCard key={k} item={i} common={common} open={shownKey === k} canEdit={canEdit}
            onToggle={() => setOpenKey(shownKey === k ? null : k)} onChanged={reload} />
        })}
      </View>
      {post.error ? <Msg kind="err">{post.error}</Msg> : null}
      <Txt size={12} faint>{t('Plein : publiée · pointillé : programmée · orange : brouillon TikTok · rouge : échec. Une notification arrive quand une vidéo part ou échoue.')}</Txt>

    </Screen>
  )
}
