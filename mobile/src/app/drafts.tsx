// Brouillons à valider (comme cm/src/pages/Drafts.tsx) : publications préparées depuis les dossiers Drive.
// « Vérifier et programmer » ouvre le composeur pré-rempli ; « Écarter » : la vidéo ne sera plus proposée.
// En bas : la préparation automatique de chaque dossier (cm/src/components/RecipeSheet.tsx).
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, FlatList, RefreshControl, View } from 'react-native'
import { archiveProposals, dismissProposal, getProposalCount, getProposalsPage, getSources, type Proposal, type Source } from '../lib/api'
import { fmtDateTime, fmtDuration } from '../lib/format'
import { useLoad, useRole, useSession } from '../lib/session'
import { Button, Card, Empty, Icon, Label, Msg, PlatformTag, Row, Skeleton, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'
import { useAuthHeaders, usePaged } from '../features/library/hooks'
import { archivedNote, plural, proposalWhen, recipeSavedNote } from '../features/library/logic'
import { RecipeSheet } from '../features/library/RecipeSheet'
import { AuthImage } from '../features/library/ui'

function ProposalCard({ p, canEdit, headers, onDismiss }: { p: Proposal; canEdit: boolean; headers: Record<string, string> | null; onDismiss: () => void }) {
  const { c } = useTheme()
  const router = useRouter()
  const a = p.asset
  const when = proposalWhen(p, fmtDateTime)
  const title = p.title || a?.title || 'Sans titre'
  return (
    <Card>
      <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
        <AuthImage path={a?.thumbnail} headers={headers} style={{ width: 72, height: 128, borderRadius: 12 }} />
        <View style={{ flex: 1, gap: 6 }}>
          <Txt bold size={16} numberOfLines={2} accessibilityRole="header">{title}</Txt>
          <Row gap={4} wrap>
            <Icon name="clock" size={14} color={when.warn ? c.warn : c.muted} />
            <Txt small color={when.warn ? c.warn : c.muted}>{when.text}{a?.duration_sec ? ` · ${fmtDuration(a.duration_sec)}` : ''}</Txt>
          </Row>
          <View style={{ gap: 4 }}>
            {p.accounts.slice(0, 4).map(x => <PlatformTag key={x.key} platform={x.platform} label={x.name} />)}
            {p.accounts.length > 4 ? <Txt small muted>+{p.accounts.length - 4}</Txt> : null}
            {!p.accounts.length ? <Txt small color={c.warn}>Aucun compte : à choisir</Txt> : null}
          </View>
          {p.caption ? <Txt small muted numberOfLines={2}>{p.caption}</Txt> : null}
          {a?.folder ? <Txt small faint numberOfLines={1}>{a.source_name} / {a.folder}</Txt> : null}
        </View>
      </Row>
      {canEdit ? (
        <Row gap={space.sm}>
          <Button kind="primary" small icon="check" title="Vérifier et planifier" flex
            onPress={() => router.push({ pathname: '/new', params: { proposal: String(p.id), ...((p as { org_id?: number | null }).org_id != null ? { org: String((p as { org_id?: number | null }).org_id) } : {}) } })} />
          <Button kind="ghost" small title="Écarter" onPress={onDismiss} accessibilityLabel={`Écarter ${title}`} />
        </Row>
      ) : null}
    </Card>
  )
}

/** Dossiers et leur préparation automatique (recette : analyse, exemples, enregistrement). */
function AutoDrafts({ sources, onChanged }: { sources: Source[]; onChanged: (s: Source, note: string) => void }) {
  const { c } = useTheme()
  const [editing, setEditing] = useState<Source | null>(null)
  if (!sources.length) return null
  return (
    <View style={{ gap: space.sm, marginTop: space.lg }}>
      <Label>Préparation automatique</Label>
      <Card style={{ gap: 0, paddingVertical: space.sm }}>
        {sources.map((s, i) => (
          <Row key={s.id} gap={space.md} style={{ minHeight: 56, borderTopWidth: i ? 1 : 0, borderColor: c.border, paddingVertical: space.sm }}>
            <View style={{ flex: 1 }}>
              <Txt bold numberOfLines={1}>{s.name || 'Dossier Drive'}</Txt>
              <Row gap={6}>
                {s.auto_drafts ? <Icon name="bolt" size={14} color={c.primary} /> : null}
                <Txt small color={s.auto_drafts ? c.primary : c.muted}>{s.auto_drafts ? 'Activée' : 'Désactivée'} · {plural(s.videos, 'vidéo')}</Txt>
              </Row>
            </View>
            <Button small title={s.auto_drafts ? 'Réglages' : 'Activer…'} onPress={() => setEditing(s)}
              accessibilityLabel={`${s.auto_drafts ? 'Réglages' : 'Activer'} : préparation automatique de ${s.name || 'ce dossier'}`} />
          </Row>
        ))}
      </Card>
      {editing ? (
        <RecipeSheet s={editing} visible onClose={() => setEditing(null)}
          onSaved={(n, proposed) => { const s = { ...editing, ...n }; setEditing(null); onChanged(s, recipeSavedNote(!!n.auto_drafts, proposed)) }} />
      ) : null}
    </View>
  )
}

export default function Drafts() {
  const { c } = useTheme()
  const router = useRouter()
  const { org, scope } = useSession()
  const { canEdit, canAdmin } = useRole()
  const headers = useAuthHeaders()
  const pages = usePaged<Proposal>(cursor => getProposalsPage(scope, cursor), [JSON.stringify(scope)])
  const count = useLoad(s => getProposalCount(s), [], 'drafts.count')
  const sources = useLoad(() => (canAdmin ? getSources(org) : Promise.resolve([] as Source[])), [org, canAdmin], 'drafts.sources')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const items = pages.items || []
  const open = count.data?.open ?? 0

  const refresh = () => { pages.refresh(); count.reload(); sources.reload() }
  const archiveAll = () => {
    const n = open || items.length
    Alert.alert(`Ranger les ${n} brouillons en archive ?`, 'Rien n’est publié ; les vidéos restent dans la bibliothèque et ne seront plus proposées.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Ranger', style: 'destructive', onPress: async () => {
        setErr('')
        try { const r = await archiveProposals(scope); setNote(archivedNote(r.archived)); pages.reload(); count.reload() }
        catch (e) { setErr((e as Error).message) }
      } },
    ])
  }
  const dismiss = async (p: Proposal) => {
    setErr('')
    try {
      await dismissProposal((p as { org_id?: number | null }).org_id ?? org, p.id)
      pages.setItems(cur => (cur || []).filter(x => x.id !== p.id))
      count.setData(d => (d ? { open: Math.max(0, d.open - 1) } : d))
    } catch (e) { setErr((e as Error).message) }
  }

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <Txt muted>Brouillons préparés depuis vos dossiers Drive. Rien ne part sans vous.</Txt>
      {canEdit && open > 0 ? <Button small title={`Tout ranger en archive (${open})`} style={{ alignSelf: 'flex-start' }} onPress={archiveAll} /> : null}
      {note ? <Msg kind="ok">{note}</Msg> : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
      {pages.error ? <Msg kind="err">{pages.error}</Msg> : null}
      {items.length ? <Txt small muted>{plural(items.length, 'brouillon')}{pages.next ? ' (et plus)' : ''}</Txt> : null}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={items}
        keyExtractor={p => String(p.id)}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.md, width: '100%', maxWidth: 820, alignSelf: 'center' }}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={header}
        ListEmptyComponent={pages.items ? (
          <Empty title="Rien à valider" icon="check"
            action={canAdmin ? undefined : <Button small title="Ouvrir la bibliothèque" onPress={() => router.navigate('/library')} />}>
            Activez la préparation automatique sur un dossier de la Bibliothèque : chaque nouvelle vidéo y arrivera prête à vérifier.
          </Empty>
        ) : <View style={{ gap: space.md }}><Skeleton h={150} n={3} /></View>}
        renderItem={({ item }) => <ProposalCard p={item} canEdit={canEdit} headers={headers} onDismiss={() => dismiss(item)} />}
        ListFooterComponent={(
          <View style={{ gap: space.md }}>
            {pages.loadingMore ? <Skeleton h={80} /> : null}
            {canAdmin && sources.data ? (
              <AutoDrafts sources={sources.data} onChanged={(s, t) => {
                sources.setData((sources.data || []).map(x => (x.id === s.id ? s : x))); setNote(t); pages.reload(); count.reload()
              }} />
            ) : null}
          </View>
        )}
        onEndReached={() => pages.more()}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={pages.refreshing} onRefresh={refresh} tintColor={c.muted} />}
      />
    </View>
  )
}
