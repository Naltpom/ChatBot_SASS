// Comptes connectés (TikTok, YouTube, Instagram) et groupes de comptes de l'espace courant
// (comme cm/src/pages/Accounts.tsx). La connexion d'un compte passe par la page web de cm.chapote.fr,
// ouverte dans le navigateur : la liste est relue au retour dans l'app.
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, AppState, View } from 'react-native'
import { openAuthorize,
  addRoutineAccount, deleteGroup, getAccountRequests, requestAccount, disconnect, getAccounts, getTransfers, startOAuth, syncAccount,
  PLATFORM_LABEL, PLATFORMS, type Account, type Group, type Order, type Platform, type ShareWhat, setYoutubeAccount } from '../lib/api'
import { short } from '../lib/format'
import { useLoad, useRole, useSession } from '../lib/session'
import { Avatar, Button, Card, Empty, Field, GroupDot, H2, IconButton, Msg, PlatformLogo, Row, Screen, SearchField, Skeleton, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'
import { AccountRow, GroupEditor, TransferSheet, Transfers } from '../features/accounts/components'
import { ShareSheet } from '../features/accounts/ShareSheet'
import { AccountRequests } from '../features/accounts/Requests'
import {
  ACCOUNT_SORTS, BROWSER_HINT, CONNECT_HINT, accountNaturalOrder, akey, claimToken, connectEnabled, followersSum, groupMembers,
  groupsOf, type AccountSort,
} from '../features/accounts/logic'
import { useDebounced } from '../features/library/hooks'
import { SortBar } from '../features/library/ui'

type Flash = { kind: 'err' | 'ok' | 'info'; text: string } | null

export default function Accounts() {
  const { c } = useTheme()
  const router = useRouter()
  const { org, config, groups, reloadGroups, group: current, setGroup, spaces } = useSession()
  const { canAdmin, role } = useRole()
  const { spaces: allSpaces } = useSession()
  // Un groupe se gère dans son espace : le mien (perso), ou une équipe où je suis administrateur.
  const manages = (g: Group & { org_id?: number | null }) => (g.org_id ?? null) == null
    ? true : allSpaces.find(sp => sp.org_id === g.org_id)?.cm_role === 'admin'
  const accounts = useLoad(s => getAccounts(s), [], 'accounts.all')
  const transfers = useLoad(() => getTransfers(), [], 'accounts.transfers')
  const requests = useLoad(() => getAccountRequests().catch(() => null), [], 'accounts.requests')
  const [claimNote, setClaimNote] = useState('')
  const [input, setInput] = useState('')
  const q = useDebounced(input.trim(), 300)
  const [sort, setSort] = useState<AccountSort>('connected')
  const [order, setOrder] = useState<Order>('asc')
  const filtered = !!q || sort !== 'connected' || order !== 'asc'
  const shown = useLoad(s => (filtered ? getAccounts(s, { q: q || undefined, sort, order }) : Promise.resolve(null)), [q, sort, order, filtered], 'accounts.shown')
  const [msg, setMsg] = useState<Flash>(null)
  const [routineName, setRoutineName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [browserHint, setBrowserHint] = useState(false)
  const [claim, setClaim] = useState<string | null>(null)
  const [editing, setEditing] = useState<Group | 'new' | null>(null)
  const [transferring, setTransferring] = useState<Account | null>(null)
  const [sharing, setSharing] = useState<{ what: ShareWhat; label: string; org?: number | null } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const all = accounts.data || []
  const reloadAll = () => { accounts.reload(); shown.reload(); transfers.reload(); requests.reload(); reloadGroups() }
  // Retour dans l'app (après la connexion d'un compte dans le navigateur) : comptes et transferts relus.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') { accounts.reload(); shown.reload(); transfers.reload() } })
    return () => sub.remove()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async (p: Platform) => {
    setBusy(p); setMsg(null); setBrowserHint(true)
    try { await openAuthorize((await startOAuth(p, org)).authorize_url) }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) }
    finally { setBusy(null); reloadAll() }
  }
  const run = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id); setMsg(null)
    try {
      const r = await fn() as { warning?: string | null } | undefined
      setMsg(r && typeof r === 'object' && 'warning' in r && r.warning ? { kind: 'info', text: r.warning } : ok ? { kind: 'ok', text: ok } : null)
      reloadAll()
      return true
    } catch (e) {
      const token = claimToken(e)
      if (token) setClaim(token)
      setMsg({ kind: 'err', text: (e as Error).message })
      return false
    } finally { setBusy(null) }
  }
  const spaceName = spaces.find(s => s.org_id === org)?.name || 'Espace perso'
  // Compte relié à l'espace de quelqu'un d'autre : on lui DEMANDE (il accepte ou refuse) ; en cas de litige, le support tranche.
  const askOwner = async () => {
    if (!claim) return
    try {
      const r = await requestAccount(claim, org, claimNote.trim())
      setClaim(null); setClaimNote(''); setMsg({ kind: 'ok', text: r.message }); requests.reload()
    } catch (e) { setClaim(null); setMsg({ kind: 'err', text: (e as Error).message }) }
  }
  const addRoutine = async () => {
    if (!routineName.trim()) return
    if (await run('routine', () => addRoutineAccount(org, routineName.trim()), 'Compte ajouté : la routine publiera les Reels programmés et enverra les chiffres.')) setRoutineName('')
  }
  const removeGroup = (g: Group) => Alert.alert(`Supprimer le groupe « ${g.name} » ?`, 'Les comptes restent connectés.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Supprimer', style: 'destructive', onPress: () => run(`g${g.id}`, async () => { await deleteGroup((g as Group & { org_id?: number | null }).org_id ?? null, g.id); if (current?.id === g.id) setGroup(null) }, 'Groupe supprimé.') },
  ])
  const removeAccount = (a: Account) => Alert.alert(`${a.mode === 'routine' ? 'Retirer' : 'Déconnecter'} ${a.name || PLATFORM_LABEL[a.platform]} ?`,
    'Les publications à venir sur ce compte ne partiront plus.', [
      { text: 'Annuler', style: 'cancel' },
      { text: a.mode === 'routine' ? 'Retirer' : 'Déconnecter', style: 'destructive', onPress: () => run(`d${a.platform}${a.id}`, () => disconnect(org, a)) },
    ])

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); reloadAll(); setTimeout(() => setRefreshing(false), 600) }}>
      <Txt muted>Les comptes et les groupes de cet espace ne sont visibles que dans cet espace.</Txt>
      <Row gap={space.sm}>
        <Button small icon="users" title="Personnes" flex onPress={() => router.push('/people')} />
        <Button small icon="folder" title="Bibliothèque" flex onPress={() => router.navigate('/library')} />
      </Row>
      {msg ? <Msg kind={msg.kind}>{msg.text}</Msg> : null}
      {claim ? (
        <Card>
          <H2>Ce compte est déjà relié à l’espace de quelqu’un d’autre</H2>
          <Txt small muted>Vous venez de vous y connecter : nous pouvons demander à cet espace de vous le céder. Le compte arrivera dans « {spaceName} » avec ses publications à venir, seulement s’il accepte. En cas de refus ou sans réponse, vous pourrez faire une réclamation au support de Chapote.</Txt>
          <Field label="Un mot pour la personne (facultatif)" value={claimNote} onChangeText={setClaimNote} maxLength={500} placeholder="Ex. : je gère ce compte pour la marque depuis janvier" />
          <Button kind="primary" title="Envoyer la demande" onPress={askOwner} />
          <Button kind="ghost" title="Laisser tomber" onPress={() => { setClaim(null); setClaimNote('') }} />
          <Txt small faint>Valable 15 minutes. Votre nom et votre e-mail seront montrés aux administrateurs de l’autre espace.</Txt>
        </Card>
      ) : null}
      <AccountRequests data={requests.data} onChanged={(text, err) => {
        setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: text || '' })
        reloadAll()
      }} />
      {!canAdmin ? <Msg>{`Votre rôle dans cette équipe (${role === 'viewer' ? 'lecteur' : 'éditeur'}) ne permet pas de connecter, retirer ou transférer des comptes.`}</Msg> : null}
      <Transfers data={transfers.data} onChanged={(text, err) => {
        setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: text || '' })
        if (!err) reloadAll()
      }} />
      {accounts.error ? <Msg kind="err">{accounts.error}</Msg> : null}

      <Row style={{ justifyContent: 'space-between', marginTop: space.sm }}>
        <H2>Groupes</H2>
        {canAdmin ? <Button small icon="plus" title="Nouveau groupe" onPress={() => setEditing('new')} /> : null}
      </Row>
      <Txt small muted>Par artiste, client, langue… Filtrez l’accueil, le planning et les stats, et publiez sur un groupe en un geste.</Txt>
      {groups.length === 0 ? (
        <Empty title="Créer un premier groupe" icon="layers" action={canAdmin ? <Button small icon="plus" title="Nouveau groupe" onPress={() => setEditing('new')} /> : undefined}>
          Ex. « Ghost Hands » = TikTok + YouTube + Instagram de l’artiste.
        </Empty>
      ) : groups.map(g => {
        const members = groupMembers(g, all)
        const followers = followersSum(members)
        const on = current?.id === g.id
        return (
          <Card key={g.id}>
            <Row gap={space.sm}>
              <GroupDot color={g.color} size={12} />
              <Txt bold size={16} numberOfLines={1} style={{ flex: 1 }}>{g.name}</Txt>
              {manages(g) ? <IconButton icon="users" label={`Partager ${g.name}`} onPress={() => setSharing({ what: { group_id: g.id }, label: `le groupe « ${g.name} »`, org: g.org_id ?? null })} /> : null}
              {manages(g) ? <IconButton icon="edit" label={`Modifier ${g.name}`} onPress={() => setEditing(g)} /> : null}
              {manages(g) ? <IconButton icon="trash" color={c.danger} label={`Supprimer ${g.name}`} onPress={() => removeGroup(g)} /> : null}
            </Row>
            {!manages(g) ? <Txt small muted>Partagé avec vous{members[0]?.owner ? ` par ${members[0].owner}` : ''}{members[0]?.role ? ` · ${members[0].role === 'admin' ? 'Admin' : members[0].role === 'editor' ? 'Peut publier' : 'Lecture seule'}` : ''}</Txt> : null}
            <Row gap={6} wrap>
              {members.length === 0 ? <Txt small muted>Aucun compte</Txt>
                : members.map(a => <Avatar key={akey(a.platform, a.id)} src={a.avatar_url} name={a.name} platform={a.platform} size={32} />)}
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt small muted>{members.length} compte{members.length > 1 ? 's' : ''}{followers ? ` · ${short(followers)} abonnés` : ''}</Txt>
              <Button small kind="ghost" icon={on ? 'check' : undefined} title={on ? 'Affiché' : 'Afficher'} onPress={() => setGroup(on ? null : g.id)}
                accessibilityLabel={on ? `${g.name} affiché. Tout afficher` : `Afficher seulement ${g.name}`} />
            </Row>
          </Card>
        )
      })}

      {all.length > 4 ? (
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <SearchField value={input} onChangeText={setInput} placeholder="Rechercher un compte" />
          <SortBar sort={sort} order={order} options={ACCOUNT_SORTS} onSort={s => { setSort(s); setOrder(accountNaturalOrder(s)) }} onOrder={setOrder} />
        </View>
      ) : null}
      {!accounts.data && accounts.loading ? <Skeleton h={120} n={3} /> : null}
      {browserHint ? <Msg>{BROWSER_HINT}</Msg> : null}
      {accounts.data ? PLATFORMS.map(p => {
        const list = ((filtered && shown.data) || all).filter(a => a.platform === p)
        if (filtered && q && !list.length) return null
        const enabled = connectEnabled(config, p)
        return (
          <Card key={p}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={space.sm}><PlatformLogo platform={p} size={22} /><H2>{PLATFORM_LABEL[p]}</H2></Row>
              {!canAdmin ? null : enabled
                ? <Button small icon="plus" title={list.length ? 'Autre compte' : 'Connecter'} loading={busy === p} onPress={() => connect(p)}
                    accessibilityLabel={`Connecter un compte ${PLATFORM_LABEL[p]}`} />
                : null}
            </Row>
            {canAdmin && !enabled ? <Txt small muted>{p === 'instagram' ? 'Connexion officielle bientôt (validation Meta)' : 'Module indisponible'}</Txt> : null}
            {list.length === 0 ? <Txt small muted>Aucun compte. {enabled ? CONNECT_HINT[p] : ''}</Txt> : null}
            {list.map(a => (
              <AccountRow key={`${a.platform}${a.id}`} a={a} groups={groupsOf(groups, a)} busy={busy} canAdmin={a.role ? a.role === 'admin' : canAdmin}
                onTransfer={() => setTransferring(a)}
                onShare={() => setSharing({ what: { platform: a.platform, account_id: a.id }, label: a.name || PLATFORM_LABEL[a.platform] })}
                onSync={() => run(`s${p}${a.id}`, () => syncAccount(a.org_id ?? org, a), 'Chiffres actualisés.')}
                onRemove={() => removeAccount(a)}
                onReconnect={() => connect(p)}
                onPublicDomain={v => run(`p${p}${a.id}`, () => setYoutubeAccount(org, a.id, { public_domain_only: v }),
                  v ? 'Cette chaîne n’accepte plus que des œuvres du domaine public.' : 'Réglage « domaine public seulement » retiré.')} />
            ))}
            {p === 'instagram' && canAdmin ? (
              <View style={{ gap: space.sm, borderTopWidth: 1, borderColor: c.border, paddingTop: space.md }}>
                <Field label="Compte géré par la routine Claude" value={routineName} onChangeText={setRoutineName} placeholder="@nom.du.compte"
                  autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={addRoutine}
                  hint="Sans connexion officielle : la routine publie les Reels programmés et envoie les chiffres." />
                <Button title="Ajouter" loading={busy === 'routine'} disabled={!routineName.trim()} onPress={addRoutine} style={{ alignSelf: 'flex-start' }} />
              </View>
            ) : null}
          </Card>
        )
      }) : null}
      {config && !config.tiktok_stats
        ? <Txt small muted>Statistiques TikTok : elles s’afficheront après la validation de l’accès aux chiffres par TikTok, puis une reconnexion des comptes.</Txt> : null}

      {transferring ? (
        <TransferSheet a={transferring} onClose={() => setTransferring(null)}
          onDone={t => { setTransferring(null); setMsg({ kind: 'ok', text: t }); reloadAll() }} />
      ) : null}
      {sharing ? <ShareSheet what={sharing.what} label={sharing.label} org={sharing.org} onClose={() => setSharing(null)} /> : null}
      {editing ? (
        <GroupEditor group={editing === 'new' ? null : editing} org={editing === 'new' ? null : (editing as Group & { org_id?: number | null }).org_id ?? null}
          accounts={all.filter(a => (a.org_id ?? null) === (editing === 'new' ? null : (editing as Group & { org_id?: number | null }).org_id ?? null) && a.role !== 'viewer')}
          onClose={() => setEditing(null)}
          onSaved={g => { setEditing(null); reloadGroups(); setMsg({ kind: 'ok', text: `Groupe « ${g.name} » enregistré.` }) }} />
      ) : null}
    </Screen>
  )
}
