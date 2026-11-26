// Toutes les vidéos relevées sur les comptes du périmètre, avec leurs chiffres (cm/src/pages/Videos.tsx).
// Recherche et tri (dans les deux sens) faits par l'API, pages au défilement.
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, RefreshControl, View } from 'react-native'
import { getVideosPage, PLATFORMS, type Platform } from '../lib/api'
import { Divider, Empty, Msg, SearchField, Skeleton, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'
import { useListState, usePages } from '../features/insights/hooks'
import { PlatformChips, SortChips, VideoRow } from '../features/insights/parts'
import { t } from '../lib/i18n'

type Sort = 'recent' | 'views' | 'likes' | 'comments' | 'shares' | 'engagement' | 'title'
const SORTS: [Sort, string][] = [['recent', 'Date'], ['views', 'Vues'], ['engagement', 'Interactions'],
  ['likes', 'J’aime'], ['comments', 'Commentaires'], ['shares', 'Partages'], ['title', 'Titre']]

export default function Videos() {
  const { c } = useTheme()
  const router = useRouter()
  const [platform, setPlatform] = useState<'' | Platform>('')
  const list = useListState<Sort>('recent', s => (s === 'title' ? 'asc' : 'desc'))
  const pages = usePages((s, cursor) => getVideosPage(s, { platform, sort: list.sort, order: list.order, q: list.q || undefined, limit: 30, cursor }),
    [platform, list.sort, list.order, list.q], 'videos-list')
  const items = pages.items
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      data={items || []}
      keyExtractor={v => String(v.id)}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={{ padding: space.lg, paddingBottom: 48, width: '100%', maxWidth: 820, alignSelf: 'center' }}
      onEndReached={pages.more} onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={pages.refreshing} onRefresh={pages.reload} tintColor={c.muted} />}
      ItemSeparatorComponent={Divider}
      renderItem={({ item }) => <VideoRow v={item} onPress={item.id ? () => router.push(`/video/${item.id}`) : undefined} />}
      ListHeaderComponent={
        <View style={{ gap: space.md, paddingBottom: space.sm }}>
          <Txt small muted>{t('Relevées chez les plateformes, publiées ou non depuis Chapote.')}</Txt>
          <SearchField value={list.input} onChangeText={list.setInput} placeholder={t('Rechercher une vidéo (titre)')} />
          <PlatformChips value={platform} onChange={setPlatform} platforms={PLATFORMS} />
          <SortChips list={list} options={SORTS} />
          {items ? <Txt small muted>{items.length > 1 ? t('{n} vidéos', { n: items.length }) : t('{n} vidéo', { n: items.length })}{pages.next ? ` ${t('et plus')}` : ''}</Txt> : null}
          {pages.error ? <Msg kind="err">{pages.error}</Msg> : null}
        </View>
      }
      ListEmptyComponent={
        !items ? <View style={{ gap: space.md }}><Skeleton h={86} n={5} /></View>
          : list.q ? <Empty title={t('Aucune vidéo trouvée')} icon="search">{t('Aucun titre ne contient « {q} ».', { q: list.q })}</Empty>
          : <Empty title={t('Aucune vidéo pour l’instant')} icon="video">{t('Les vidéos de vos comptes apparaissent ici après le premier relevé des chiffres.')}</Empty>
      }
      ListFooterComponent={
        pages.busy ? <View style={{ paddingTop: space.md }}><Skeleton h={72} n={1} /></View>
          : items && !pages.next && items.length > 30 ? <Txt small muted center style={{ paddingTop: space.md }}>{t('{n} vidéos · fin de la liste', { n: items.length })}</Txt>

          : undefined
      }
    />
  )
}
