// Comptes connectés (TikTok, YouTube, Instagram) et groupes de comptes de l'espace courant
// (comme cm/src/pages/Accounts.tsx). La connexion d'un compte passe par la page web de cm.chapote.fr,
// ouverte dans le navigateur : la liste est relue au retour dans l'app.
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
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
import { showDialog } from '../ui/dialog'
import { t } from '../lib/i18n'

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
  const spaceName = spaces.find(s => s.org_id === org)?.name || t('Espace perso')
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
    if (await run('routine', () => addRoutineAccount(org, routineName.trim()), t('Compte ajouté : la routine publiera les Reels programmés et enverra les chiffres.'))) setRoutineName('')
  }
  const removeGroup = (g: Group) => showDialog(t('Supprimer le groupe « {nom} » ?', { nom: g.name }), t('Les comptes restent connectés.'), [
    { text: t('Annuler'), style: 'cancel' },
    { text: t('Supprimer'), style: 'destructive', onPress: () => run(`g${g.id}`, async () => { await deleteGroup((g as Group & { org_id?: number | null }).org_id ?? null, g.id); if (current?.id === g.id) setGroup(null) }, t('Groupe supprimé.')) },
  ])
  const removeAccount = (a: Account) => showDialog(a.mode === 'routine' ? t('Retirer {nom} ?', { nom: a.name || PLATFORM_LABEL[a.platform] }) : t('Déconnecter {nom} ?', { nom: a.name || PLATFORM_LABEL[a.platform] }),
    t('Les publications à venir sur ce compte ne partiront plus.'), [
      { text: t('Annuler'), style: 'cancel' },
      { text: a.mode === 'routine' ? t('Retirer') : t('Déconnecter'), style: 'destructive', onPress: () => run(`d${a.platform}${a.id}`, () => disconnect(org, a)) },
    ])

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); reloadAll(); setTimeout(() => setRefreshing(false), 600) }}>
      <Txt muted>{t('Les comptes et les groupes de cet espace ne sont visibles que dans cet espace.')}</Txt>
      <Row gap={space.sm}>
        <Button small icon="users" title={t('Personnes')} flex onPress={() => router.push('/people')} />
        <Button small icon="folder" title={t('Bibliothèque')} flex onPress={() => router.navigate('/library')} />
      </Row>
      {msg ? <Msg kind={msg.kind}>{msg.text}</Msg> : null}
      {claim ? (
        <Card>
          <H2>{t('Ce compte est déjà relié à l’espace de quelqu’un d’autre')}</H2>
          <Txt small muted>{t('Vous venez de vous y connecter : nous pouvons demander à cet espace de vous le céder. Le compte arrivera dans « {espace} » avec ses publications à venir, seulement s’il accepte. En cas de refus ou sans réponse, vous pourrez faire une réclamation au support de Chapote.', { espace: spaceName })}</Txt>
          <Field label={t('Un mot pour la personne (facultatif)')} value={claimNote} onChangeText={setClaimNote} maxLength={500} placeholder={t('Ex. : je gère ce compte pour la marque depuis janvier')} />
          <Button kind="primary" title={t('Envoyer la demande')} onPress={askOwner} />
          <Button kind="ghost" title={t('Laisser tomber')} onPress={() => { setClaim(null); setClaimNote('') }} />
          <Txt small faint>{t('Valable 15 minutes. Votre nom et votre e-mail seront montrés aux administrateurs de l’autre espace.')}</Txt>
        </Card>
      ) : null}
      <AccountRequests data={requests.data} onChanged={(text, err) => {
        setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: text || '' })
        reloadAll()
      }} />
      {!canAdmin ? <Msg>{role === 'viewer' ? t('Votre rôle dans cette équipe (lecteur) ne permet pas de connecter, retirer ou transférer des comptes.') : t('Votre rôle dans cette équipe (éditeur) ne permet pas de connecter, retirer ou transférer des comptes.')}</Msg> : null}
      <Transfers data={transfers.data} onChanged={(text, err) => {
        setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: text || '' })
        if (!err) reloadAll()
      }} />
      {accounts.error ? <Msg kind="err">{accounts.error}</Msg> : null}

      <Row style={{ justifyContent: 'space-between', marginTop: space.sm }}>
        <H2>{t('Groupes')}</H2>
        {canAdmin ? <Button small icon="plus" title={t('Nouveau groupe')} onPress={() => setEditing('new')} /> : null}
      </Row>
      <Txt small muted>{t('Par artiste, client, langue… Filtrez l’accueil, le planning et les stats, et publiez sur un groupe en un geste.')}</Txt>
      {groups.length === 0 ? (
        <Empty title={t('Créer un premier groupe')} icon="layers" action={canAdmin ? <Button small icon="plus" title={t('Nouveau groupe')} onPress={() => setEditing('new')} /> : undefined}>
          {t('Ex. « Ghost Hands » = TikTok + YouTube + Instagram de l’artiste.')}
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
              {manages(g) ? <IconButton icon="users" label={t('Partager {nom}', { nom: g.name })} onPress={() => setSharing({ what: { group_id: g.id }, label: t('le groupe « {nom} »', { nom: g.name }), org: g.org_id ?? null })} /> : null}
              {manages(g) ? <IconButton icon="edit" label={t('Modifier {nom}', { nom: g.name })} onPress={() => setEditing(g)} /> : null}
              {manages(g) ? <IconButton icon="trash" color={c.danger} label={t('Supprimer {nom}', { nom: g.name })} onPress={() => removeGroup(g)} /> : null}
            </Row>
            {!manages(g) ? <Txt small muted>{members[0]?.owner ? t('Partagé avec vous par {nom}', { nom: members[0].owner }) : t('Partagé avec vous')}{members[0]?.role ? ` · ${members[0].role === 'admin' ? t('Admin') : members[0].role === 'editor' ? t('Peut publier') : t('Lecture seule')}` : ''}</Txt> : null}
            <Row gap={6} wrap>
              {members.length === 0 ? <Txt small muted>{t('Aucun compte')}</Txt>
                : members.map(a => <Avatar key={akey(a.platform, a.id)} src={a.avatar_url} name={a.name} platform={a.platform} size={32} />)}
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt small muted>{members.length > 1 ? t('{n} comptes', { n: members.length }) : t('{n} compte', { n: members.length })}{followers ? t(' · {n} abonnés', { n: short(followers) }) : ''}</Txt>
              <Button small kind="ghost" icon={on ? 'check' : undefined} title={on ? t('Affiché') : t('Afficher')} onPress={() => setGroup(on ? null : g.id)}
                accessibilityLabel={on ? t('{nom} affiché. Tout afficher', { nom: g.name }) : t('Afficher seulement {nom}', { nom: g.name })} />
            </Row>
          </Card>
        )
      })}

      {all.length > 4 ? (
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <SearchField value={input} onChangeText={setInput} placeholder={t('Rechercher un compte')} />
          <SortBar sort={sort} order={order} options={ACCOUNT_SORTS.map(([v, l]) => [v, t(l)] as [AccountSort, string])} onSort={s => { setSort(s); setOrder(accountNaturalOrder(s)) }} onOrder={setOrder} />
        </View>
      ) : null}
      {!accounts.data && accounts.loading ? <Skeleton h={120} n={3} /> : null}
      {browserHint ? <Msg>{t(BROWSER_HINT)}</Msg> : null}
      {accounts.data ? PLATFORMS.map(p => {
        const list = ((filtered && shown.data) || all).filter(a => a.platform === p)
        if (filtered && q && !list.length) return null
        const enabled = connectEnabled(config, p)
        return (
          <Card key={p}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={space.sm}><PlatformLogo platform={p} size={22} /><H2>{PLATFORM_LABEL[p]}</H2></Row>
              {!canAdmin ? null : enabled
                ? <Button small icon="plus" title={list.length ? t('Autre compte') : t('Connecter')} loading={busy === p} onPress={() => connect(p)}
                    accessibilityLabel={t('Connecter un compte {plateforme}', { plateforme: PLATFORM_LABEL[p] })} />
                : null}
            </Row>
            {canAdmin && !enabled ? <Txt small muted>{p === 'instagram' ? t('Connexion officielle bientôt (validation Meta)') : t('Module indisponible')}</Txt> : null}
            {list.length === 0 ? <Txt small muted>{t('Aucun compte.')} {enabled ? t(CONNECT_HINT[p]) : ''}</Txt> : null}
            {list.map(a => (
              <AccountRow key={`${a.platform}${a.id}`} a={a} groups={groupsOf(groups, a)} busy={busy} canAdmin={a.role ? a.role === 'admin' : canAdmin}
                onTransfer={() => setTransferring(a)}
                onShare={() => setSharing({ what: { platform: a.platform, account_id: a.id }, label: a.name || PLATFORM_LABEL[a.platform] })}
                onSync={() => run(`s${p}${a.id}`, () => syncAccount(a.org_id ?? org, a), t('Chiffres actualisés.'))}
                onRemove={() => removeAccount(a)}
                onReconnect={() => connect(p)}
                onPublicDomain={v => run(`p${p}${a.id}`, () => setYoutubeAccount(org, a.id, { public_domain_only: v }),
                  v ? t('Cette chaîne n’accepte plus que des œuvres du domaine public.') : t('Réglage « domaine public seulement » retiré.'))} />
            ))}
            {p === 'instagram' && canAdmin ? (
              <View style={{ gap: space.sm, borderTopWidth: 1, borderColor: c.border, paddingTop: space.md }}>
                <Field label={t('Compte géré par la routine Claude')} value={routineName} onChangeText={setRoutineName} placeholder={t('@nom.du.compte')}
                  autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={addRoutine}
                  hint={t('Sans connexion officielle : la routine publie les Reels programmés et envoie les chiffres.')} />
                <Button title={t('Ajouter')} loading={busy === 'routine'} disabled={!routineName.trim()} onPress={addRoutine} style={{ alignSelf: 'flex-start' }} />
              </View>
            ) : null}
          </Card>
        )
      }) : null}
      {config && !config.tiktok_stats
        ? <Txt small muted>{t('Statistiques TikTok : elles s’afficheront après la validation de l’accès aux chiffres par TikTok, puis une reconnexion des comptes.')}</Txt> : null}

      {transferring ? (
        <TransferSheet a={transferring} onClose={() => setTransferring(null)}
          onDone={txt => { setTransferring(null); setMsg({ kind: 'ok', text: txt }); reloadAll() }} />
      ) : null}
      {sharing ? <ShareSheet what={sharing.what} label={sharing.label} org={sharing.org} onClose={() => setSharing(null)} /> : null}
      {editing ? (
        <GroupEditor group={editing === 'new' ? null : editing} org={editing === 'new' ? null : (editing as Group & { org_id?: number | null }).org_id ?? null}
          accounts={all.filter(a => (a.org_id ?? null) === (editing === 'new' ? null : (editing as Group & { org_id?: number | null }).org_id ?? null) && a.role !== 'viewer')}
          onClose={() => setEditing(null)}
          onSaved={g => { setEditing(null); reloadGroups(); setMsg({ kind: 'ok', text: t('Groupe « {nom} » enregistré.', { nom: g.name }) }) }} />
      ) : null}
    </Screen>
  )
}
