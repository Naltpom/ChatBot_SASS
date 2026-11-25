// Bibliothèque : les vidéos des dossiers Google Drive partagés avec le robot de Chapote
// (comme cm/src/pages/Library.tsx). En haut ce qui attend une action (à valider), puis les vidéos ; les dossiers sont repliés. Recherche, tri et filtre faits par l'API, pages au défilement.
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'
import { getAssetsPage, getProposalCount, getRobot, getSources, type Asset, type AssetState, type Order, type Source } from '../../lib/api'
import { useLoad, useRole, useSession } from '../../lib/session'
import { Button, Card, Empty, Icon, Msg, Row, SearchField, Seg, Skeleton, Txt } from '../../ui/kit'
import { Gauge, StorageBanner } from '../../features/storage'
import { space, useTheme } from '../../ui/theme'
import { AddFolderSheet, AssetCard, SourceCard } from '../../features/library/components'
import { useAuthHeaders, useDebounced, usePaged } from '../../features/library/hooks'
import { ASSET_SORTS, STATE_OPTIONS, addedFlash, assetNaturalOrder, emptyAssetsText, plural, type AssetSort } from '../../features/library/logic'
import { Select, SortBar } from '../../features/library/ui'

export default function Library() {
  const { c } = useTheme()
  const router = useRouter()
  const { org, spaces } = useSession()
  const current = spaces.find(x => x.org_id === org)
  const { canAdmin } = useRole()
  const robot = useLoad(() => getRobot(), [], 'library.robot')
  const sources = useLoad(() => getSources(org), [org], 'library.sources')
  const count = useLoad(s => getProposalCount(s), [], 'library.proposals')
  const [adding, setAdding] = useState(false)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [state, setState] = useState<AssetState>('new')
  const [input, setInput] = useState('')
  const q = useDebounced(input.trim(), 300)
  const [sort, setSort] = useState<AssetSort>('recent')
  const [order, setOrder] = useState<Order>('desc')
  const [source, setSource] = useState<number | ''>('')
  const [allFolders, setAllFolders] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const headers = useAuthHeaders()

  const list = sources.data || []
  const enabled = !!robot.data?.enabled && canAdmin
  const hasSources = list.length > 0
  const assets = usePaged<Asset>(cursor => getAssetsPage(org, {
    source_id: source === '' ? undefined : source, state, q: q || undefined, sort, order, limit: 40, cursor,
  }), [org, source, state, q, sort, order, refreshKey])

  const changed = (n: Source) => { sources.setData(list.map(x => (x.id === n.id ? { ...x, ...n } : x))); setRefreshKey(k => k + 1) }
  const removed = (s: Source) => { sources.setData(list.filter(x => x.id !== s.id)); setRefreshKey(k => k + 1); if (source === s.id) setSource('') }
  const refresh = () => { robot.reload(); sources.reload(); count.reload(); assets.refresh() }
  const drafts = count.data?.open || 0

  // Ordre de lecture : à valider (s'il y en a), puis les vidéos (filtre, recherche), et les dossiers Drive repliés.
  const [showFolders, setShowFolders] = useState(false)
  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <StorageBanner space={current} />
      <Txt muted>Les vidéos que vous (ou vos monteurs) déposez dans Google Drive arrivent ici. Touchez-en une pour la programmer.</Txt>
      {drafts > 0 ? (
        <Card onPress={() => router.push('/drafts')} accessibilityLabel={`${drafts} brouillons à valider. Ouvrir`} style={{ borderWidth: 1.5, borderColor: c.primary }}>
          <Row gap={space.md}>
            <View style={{ minWidth: 28, height: 24, borderRadius: 12, paddingHorizontal: 8, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Txt size={13} bold color={c.onPrimary}>{drafts > 99 ? '99+' : drafts}</Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt bold>À valider</Txt>
              <Txt small muted>Brouillon{drafts > 1 ? 's' : ''} préparé{drafts > 1 ? 's' : ''} depuis vos dossiers : vérifiez et programmez.</Txt>
            </View>
            <Icon name="right" size={18} color={c.muted} />
          </Row>
        </Card>
      ) : null}
      {flash ? <Msg kind={flash.kind}>{flash.text}</Msg> : null}
      {robot.data && !robot.data.enabled ? <Msg>La bibliothèque Google Drive n’est pas encore activée sur Chapote.</Msg> : null}
      {robot.data?.enabled && !canAdmin && sources.data && !hasSources
        ? <Msg>Aucun dossier Drive relié à cet espace pour l’instant : un administrateur de l’équipe peut en ajouter.</Msg> : null}
      {sources.error ? <Msg kind="err">{sources.error}</Msg> : null}
      {!sources.data && sources.loading ? <Skeleton h={90} n={2} /> : null}
      {sources.data && !hasSources && enabled ? (
        <Empty title="Reliez le dossier de vos monteurs" icon="folder"
          action={<Button kind="primary" icon="plus" title="Ajouter un dossier Drive" onPress={() => setAdding(true)} />}>
          Partagez un dossier Google Drive avec le robot de Chapote : chaque vidéo déposée apparaît ici, avec sa légende si un fichier .txt du même nom l’accompagne. Vous n’avez plus qu’à programmer.
        </Empty>
      ) : null}
      {hasSources ? (
        <>
          <Card onPress={() => setShowFolders(v => !v)}
            accessibilityLabel={`Dossiers Drive : ${list.length}. ${showFolders ? 'Replier' : 'Afficher'}`} style={{ paddingVertical: space.sm }}>
            <Row gap={space.md}>
              <Icon name="folder" size={20} color={c.muted} />
              <View style={{ flex: 1 }}>
                <Txt bold>{plural(list.length, 'dossier')} Drive</Txt>
                {current?.storage && current.storage.state !== 'missing' ? <Gauge s={current.storage} /> : <Txt small muted numberOfLines={1}>{list.map(x => x.name || 'Dossier Drive').join(', ')}</Txt>}
              </View>
              <View style={{ transform: [{ rotate: showFolders ? '180deg' : '0deg' }] }}><Icon name="down" size={18} color={c.muted} /></View>
            </Row>
          </Card>
          {showFolders ? (
            <View style={{ gap: space.sm }}>
              {(allFolders ? list : list.slice(0, 6)).map(s => <SourceCard key={s.id} s={s} onChanged={changed} onRemoved={() => removed(s)} />)}
              {list.length > 6 ? (
                <Button kind="ghost" small style={{ alignSelf: 'flex-start' }} onPress={() => setAllFolders(v => !v)}
                  title={allFolders ? 'Moins de dossiers' : `Voir les ${list.length} dossiers`} />
              ) : null}
              {enabled ? <Button icon="plus" title="Ajouter un dossier Drive" onPress={() => setAdding(true)} /> : null}
              <Button small kind="ghost" icon="folder" title="Stockage" onPress={() => router.push('/storage')} style={{ alignSelf: 'flex-start' }} />
            </View>
          ) : null}
          <Seg label="Afficher" value={state} onChange={setState} options={STATE_OPTIONS} />
          <SearchField value={input} onChangeText={setInput} placeholder="Rechercher (nom, légende, dossier)" />
          <Row gap={space.sm} wrap>
            {list.length > 1 ? (
              <View style={{ flexGrow: 1, minWidth: 160 }}>
                <Select label="" value={source} onChange={setSource}
                  options={[['', 'Tous les dossiers'], ...list.map(s => [s.id, s.name || 'Dossier Drive'] as [number, string])]} />
              </View>
            ) : null}
          </Row>
          <SortBar sort={sort} order={order} options={ASSET_SORTS}
            onSort={s => { setSort(s); setOrder(assetNaturalOrder(s)) }} onOrder={setOrder} />
          {assets.error ? <Msg kind="err">{assets.error}</Msg> : null}
          {assets.items?.length ? (
            <Txt small muted accessibilityRole="text">{plural(assets.items.length, 'vidéo')}{assets.next ? ' (et plus)' : ''}</Txt>
          ) : null}
        </>
      ) : null}
    </View>
  )

  const footer = (
    <View style={{ gap: space.md, paddingTop: space.md }}>
      {assets.loadingMore ? <Skeleton h={60} /> : null}
      <Txt small faint>
        Les vidéos restent dans votre Drive. Chapote les télécharge seulement à l’heure de la publication, puis efface sa copie.
      </Txt>
      <Pressable onPress={() => router.navigate('/')} accessibilityRole="link" style={{ minHeight: 44, justifyContent: 'center' }}>
        <Txt small color={c.accent}>Voir le planning</Txt>
      </Pressable>
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={hasSources ? assets.items || [] : []}
        keyExtractor={a => String(a.id)}
        numColumns={2}
        columnWrapperStyle={{ gap: 10 }}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: 10, width: '100%', maxWidth: 820, alignSelf: 'center' }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={hasSources
          ? (assets.items
            ? (q ? <Empty title="Aucun résultat" icon="search" action={<Button title="Effacer la recherche" onPress={() => setInput('')} />}>{emptyAssetsText(q, state)}</Empty>
              : state === 'new' ? <Empty title="Tout est programmé" icon="check" action={<Button title="Voir toutes les vidéos" onPress={() => setState('all')} />}>Aucune vidéo en attente : déposez-en de nouvelles dans vos dossiers Drive, elles apparaîtront ici.</Empty>
              : <Empty title="Aucune vidéo ici" icon="video">{emptyAssetsText(q, state)}</Empty>)
            : <View style={{ gap: 10 }}><Skeleton h={240} n={2} /></View>)
          : undefined}
        renderItem={({ item, index }) => (
          <>
            <AssetCard a={item} headers={headers} onPress={() => router.push({ pathname: '/asset/[id]', params: { id: String(item.id) } })} />
            {/* Dernière rangée impaire : une case vide garde la largeur des cartes. */}
            {index === (assets.items?.length || 0) - 1 && index % 2 === 0 ? <View style={{ flex: 1 }} /> : null}
          </>
        )}
        onEndReached={() => assets.more()}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={assets.refreshing} onRefresh={refresh} tintColor={c.muted} />}
      />
      {robot.data?.email ? (
        <AddFolderSheet visible={adding} robot={robot.data.email} known={list.map(x => x.id)} onClose={() => setAdding(false)} onAdded={s => {
          setAdding(false)
          sources.setData([...list.filter(x => x.id !== s.id), s])
          setRefreshKey(k => k + 1)
          setFlash(addedFlash(s))
        }} />
      ) : null}
    </View>
  )
}
