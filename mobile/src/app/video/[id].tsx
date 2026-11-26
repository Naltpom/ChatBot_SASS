import { FEATURES } from '../../lib/features'
// Fiche d'une vidéo : la même vidéo sur chaque plateforme (cm/src/pages/VideoSheet.tsx).
// Filtre Toutes / plateforme : lecteur, chiffres et commentaires suivent le filtre.
// Lecteur : la vidéo d'origine lue depuis le Drive (par notre API, avec la session) ; à défaut,
// la vignette ouvre la vidéo chez la plateforme dans le navigateur.
import { useEvent } from 'expo'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEffect, useState } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'
import { getCommentsPage, getVideoSheet, PLATFORM_LABEL, type Comment, type Platform, type SheetVideo } from '../../lib/api'
import { fmtDate, num } from '../../lib/format'
import { API_URL, authHeaders } from '../../lib/http'
import { useLoad, useRole, useSession } from '../../lib/session'
import { Button, Card, Chip, Divider, Empty, Icon, Msg, PlatformLogo, Row, Skeleton, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { CommentCard } from '../../features/insights/CommentCard'
import { openWeb, usePages } from '../../features/insights/hooks'
import { absoluteUrl, applyChanges, isOwnUrl, sumField } from '../../features/insights/logic'
import { ChipRow, SectionHead, Thumb } from '../../features/insights/parts'
import { t } from '../../lib/i18n'

const FIELDS: ['views' | 'likes' | 'comments' | 'shares', string][] = [['views', 'Vues'], ['likes', 'J’aime'], ['comments', 'Commentaires'], ['shares', 'Partages']]

/** Vidéo d'origine (Drive) lue par l'API : la session part dans les en-têtes de la requête. */
function StreamPlayer({ url, ratio }: { url: string; ratio: number }) {
  const { c } = useTheme()
  const player = useVideoPlayer(null)
  const { status } = useEvent(player, 'statusChange', { status: player.status })
  const [err, setErr] = useState(false)
  useEffect(() => {
    let alive = true
    setErr(false)
    ;(async () => {
      const headers = isOwnUrl(API_URL, url) ? await authHeaders() : undefined
      if (alive) await player.replaceAsync({ uri: url, headers })
    })().catch(() => { if (alive) setErr(true) })
    return () => { alive = false }
  }, [url, player])
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ width: '100%', aspectRatio: ratio, maxHeight: 560, alignSelf: 'center', borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.surface2 }}>
        <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }}
          accessibilityLabel={t('Lecteur vidéo')} />
      </View>
      {err || status === 'error' ? <Msg kind="err">{t('Lecture impossible pour l’instant. Réessayez plus tard.')}</Msg> : null}
    </View>
  )
}

/** Sans vidéo d'origine : la vignette ouvre la plateforme (YouTube, TikTok, Instagram) dans le navigateur. */
function OpenOnPlatform({ v }: { v: SheetVideo }) {
  const { c } = useTheme()
  const url = v.url || v.embed
  if (!url) return <Txt small muted center style={{ paddingVertical: space.xl }}>{t('Lecteur indisponible pour cette plateforme')}</Txt>
  return (
    <Pressable onPress={() => openWeb(url)} accessibilityRole="button" accessibilityLabel={t('Lire sur {platform}', { platform: PLATFORM_LABEL[v.platform] })}
      style={({ pressed }) => ({ alignSelf: 'center', opacity: pressed ? 0.7 : 1 })}>
      <Thumb uri={v.thumbnail_url} w={v.platform === 'youtube' && (v.duration_sec || 0) > 180 ? 320 : 220} h={v.platform === 'youtube' && (v.duration_sec || 0) > 180 ? 180 : 390} />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ backgroundColor: c.ink, borderRadius: 999, paddingHorizontal: 16, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PlatformLogo platform={v.platform} size={18} />
          <Txt bold color={c.onInk}>{t('Lire sur {platform}', { platform: PLATFORM_LABEL[v.platform] })}</Txt>
        </View>
      </View>
    </Pressable>
  )
}

export default function VideoSheetScreen() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { org, spaces } = useSession()
  const { canEdit } = useRole()
  // Vidéo d'un groupe partagé : son espace n'est pas forcément l'espace courant ; on essaie les autres.
  const sheet = useLoad(async () => {
    const tries = [org, ...spaces.map(s => s.org_id).filter(o => o !== org)]
    let last: unknown = null
    for (const o of tries) {
      try { return await getVideoSheet(o, Number(id)) } catch (e: any) { last = e; if (e?.status !== 404 && e?.status !== 403) throw e }
    }
    throw last
  }, [id, org], 'video-sheet')
  const [p, setP] = useState<'all' | Platform>('all')
  const d = sheet.data
  const shown = d ? d.videos.filter(v => p === 'all' || v.platform === p) : []
  const ids = shown.map(v => v.id).join(',')
  const pages = usePages((s, cursor) => (ids && FEATURES.comments ? getCommentsPage(org, { status: 'all', videos: ids, cursor }) : Promise.resolve({ items: [] as Comment[], next: null })),
    [ids, org], 'video-sheet-comments')
  const [changed, setChanged] = useState<Record<number, Comment | null>>({})
  const comments = applyChanges(pages.items || [], changed, 'all')
  const scopeLabel = p === 'all' ? t('toutes plateformes') : PLATFORM_LABEL[p]
  const stream = d?.asset?.stream ? absoluteUrl(API_URL, d.asset.stream) : null
  const ratio = d?.asset?.width && d.asset.height ? d.asset.width / d.asset.height : 9 / 16

  const header = (
    <View style={{ gap: space.lg, paddingBottom: space.sm }}>
      <Txt size={22} bold accessibilityRole="header" numberOfLines={3}>{d?.title || (sheet.loading ? '…' : t('Vidéo'))}</Txt>
      {sheet.error ? <Msg kind="err">{sheet.error}</Msg> : null}
      {!d && sheet.loading ? <Skeleton h={300} /> : null}
      {d ? (
        <>
          {d.videos.length > 1 ? (
            <ChipRow label={t('Plateforme')}>
              <Chip label={t('Toutes')} selected={p === 'all'} onPress={() => setP('all')} />
              {d.videos.map(v => (
                <Chip key={v.id} label={PLATFORM_LABEL[v.platform]} selected={p === v.platform} onPress={() => setP(v.platform)}
                  left={<PlatformLogo platform={v.platform} size={14} />} />
              ))}
            </ChipRow>
          ) : null}
          {stream ? <StreamPlayer url={stream} ratio={ratio} /> : shown[0] ? <OpenOnPlatform v={shown.find(v => v.url) || shown[0]} /> : null}
          <Row wrap style={{ justifyContent: 'center' }}>
            {shown.filter(v => v.url).map(v => (
              <Button key={v.id} small title={t('Voir sur {platform}', { platform: PLATFORM_LABEL[v.platform] })} icon="external" onPress={() => openWeb(v.url!)} />
            ))}
            {d.asset?.folder_url ? <Button small title={t('Dossier Drive')} icon="layers" onPress={() => openWeb(d.asset!.folder_url!)} /> : null}
            {d.asset ? <Button small title={t('Bibliothèque')} icon="folder" onPress={() => router.push(`/asset/${d.asset!.id}`)} /> : null}
          </Row>

          <View style={{ gap: space.sm }}>
            <Txt size={18} bold accessibilityRole="header">{t('Chiffres')} <Txt small muted>· {scopeLabel}</Txt></Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {FIELDS.map(([f, l]) => (
                <Card key={f} style={{ flexBasis: '47%', flexGrow: 1, padding: space.md, gap: 2 }}>
                  <Txt small muted>{t(l)}</Txt>
                  <Txt size={22} bold>{num(sumField(shown, v => v[f]))}</Txt>
                </Card>
              ))}
            </View>
            {d.videos.length > 1 && p === 'all' ? (
              <Card style={{ paddingVertical: space.sm, gap: 0 }}>
                {d.videos.map((v, i) => (
                  <View key={v.id}>
                    {i ? <Divider /> : null}
                    <View accessible accessibilityLabel={`${PLATFORM_LABEL[v.platform]}, ${v.account_name || ''} : ${FIELDS.map(([f, l]) => `${t(l)} ${num(v[f])}`).join(', ')}`}
                      style={{ paddingVertical: space.sm, gap: 4 }}>
                      <Row gap={6}><PlatformLogo platform={v.platform} size={14} /><Txt small bold numberOfLines={1} style={{ flex: 1 }}>{v.account_name}</Txt></Row>
                      <Row gap={12} wrap>
                        {FIELDS.map(([f, l]) => <Txt key={f} small muted>{t(l)} <Txt small bold>{num(v[f])}</Txt></Txt>)}
                      </Row>
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}
          </View>

          {d.caption || shown[0]?.published_at ? (
            <View style={{ gap: 6 }}>
              <Txt size={18} bold accessibilityRole="header">{t('Légende')}</Txt>
              {d.caption ? <Txt selectable>{d.caption}</Txt> : null}
              <Txt small muted>{shown[0]?.published_at ? t('Publiée le {date}', { date: fmtDate(shown[0].published_at) }) : ''}{d.post_id ? ` · ${t('depuis Chapote')}` : ''}</Txt>
            </View>
          ) : null}

          {FEATURES.comments ? <SectionHead title={t('Commentaires · {scope}', { scope: scopeLabel })} action={t('Tous')} onAction={() => router.push('/comments')} /> : null}
        </>
      ) : null}
    </View>
  )

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      data={d && FEATURES.comments ? comments : []}
      keyExtractor={x => String(x.id)}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ padding: space.lg, paddingBottom: 48, width: '100%', maxWidth: 820, alignSelf: 'center' }}
      onEndReached={pages.more} onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={sheet.loading && !!d} onRefresh={() => { sheet.reload(); setChanged({}); pages.reload() }} tintColor={c.muted} />}
      ItemSeparatorComponent={Divider}
      renderItem={({ item }) => <CommentCard c={item} canEdit={canEdit} onChanged={n => setChanged(m => ({ ...m, [item.id]: n }))} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        !d ? undefined
          : !pages.items ? <View style={{ gap: space.md }}><Skeleton h={70} n={2} /></View>
          : <Empty title={t('Pas de commentaire relevé')} icon="comment">
              {shown.some(v => v.comments) ? t('Les commentaires de cette vidéo apparaîtront ici dès que la plateforme permet à Chapote de les lire.') : t('Aucun commentaire pour l’instant.')}

            </Empty>
      }
      ListFooterComponent={pages.busy ? <View style={{ paddingTop: space.md }}><Skeleton h={70} /></View>
        : pages.error ? <Msg kind="err">{pages.error}</Msg> : undefined}
    />
  )
}
