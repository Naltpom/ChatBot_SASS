// Personnes et partage (comme cm/src/pages/People.tsx) : qui a accès à cet espace, avec quel niveau
// (Admin, Peut publier, Lecture seule) et à quels comptes (tous, ou certains comptes / groupes).
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, RefreshControl, View } from 'react-native'
import { getPeople, removePerson, updatePerson, type CmRole, type Order, type Person, type PersonScope } from '../lib/api'
import { useLoad, useSession } from '../lib/session'
import { Avatar, Button, Card, Chip, Empty, GroupDot, Label, Msg, PlatformLogo, Row, SearchField, Sheet, Skeleton, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'
import { ShareSheet } from '../features/accounts/ShareSheet'
import { PEOPLE_SORTS, ROLE_CHOICES, ROLE_NAME, filterAccounts, personLine, scopeText, toggleIn, type PeopleSort } from '../features/accounts/logic'
import { useDebounced } from '../features/library/hooks'
import { Choice, SortBar } from '../features/library/ui'
import { showDialog } from '../ui/dialog'

function EditPerson({ p, org, onClose, onSaved }: { p: Person; org: number; onClose: () => void; onSaved: (t: string) => void }) {
  const { groups, accounts } = useSession()
  const [role, setRole] = useState<CmRole>(p.role)
  const [scope, setScope] = useState<PersonScope>(p.scope)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setErr(''); setBusy(true)
    try { await updatePerson(org, p.email, role, scope); onSaved('Accès mis à jour.') }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const remove = () => showDialog(`Retirer l’accès de ${p.email} ?`, 'Les comptes, le planning et la bibliothèque restent.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Retirer', style: 'destructive', onPress: async () => {
      setBusy(true)
      try { await removePerson(org, p.email); onSaved('Accès retiré.') } catch (e) { setErr((e as Error).message); setBusy(false) }
    } },
  ])
  const shownAccounts = filterAccounts(accounts, q)
  return (
    <Sheet visible title={p.name || p.email} onClose={onClose}
      footer={<Row gap={space.sm}>
        <Button kind="danger" title="Retirer" disabled={busy} onPress={remove} />
        <Button title="Annuler" onPress={onClose} flex />
        <Button kind="primary" title="Enregistrer" loading={busy} onPress={save} flex />
      </Row>}>
      {p.name ? <Txt small muted>{p.email}</Txt> : null}
      <View accessibilityRole="radiogroup" accessibilityLabel="Accès">
        <Label>Accès</Label>
        {ROLE_CHOICES.map(([v, l, d]) => <Choice key={v} radio label={l} hint={d} checked={role === v} onPress={() => setRole(v)} />)}
      </View>
      {role !== 'admin' ? (
        <View style={{ gap: space.sm }}>
          <Label>Comptes</Label>
          <Choice label="Tous les comptes de l’espace" checked={scope.all} onPress={() => setScope(s => ({ ...s, all: !s.all }))} />
          {!scope.all ? (
            <>
              {groups.length ? (
                <View accessibilityLabel="Groupes" style={{ gap: space.sm }}>
                  <Txt small bold>Groupes</Txt>
                  <Row gap={space.sm} wrap>
                    {groups.map(g => (
                      <Chip key={g.id} label={g.name} selected={scope.groups.includes(g.id)} left={<GroupDot color={g.color} />}
                        onPress={() => setScope(s => ({ ...s, all: false, groups: toggleIn(s.groups, g.id) }))} />
                    ))}
                  </Row>
                </View>
              ) : null}
              <Txt small bold>Comptes</Txt>
              {accounts.length > 8 ? <SearchField value={q} onChangeText={setQ} placeholder="Rechercher un compte" /> : null}
              <Row gap={space.sm} wrap>
                {shownAccounts.map(a => {
                  const k = `${a.platform}:${a.id}`
                  return <Chip key={k} label={a.name || a.username || k} selected={scope.accounts.includes(k)} left={<PlatformLogo platform={a.platform} size={14} />}
                    onPress={() => setScope(s => ({ ...s, all: false, accounts: toggleIn(s.accounts, k) }))} />
                })}
              </Row>
            </>
          ) : null}
        </View>
      ) : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
    </Sheet>
  )
}

export default function People() {
  const router = useRouter()
  const { c } = useTheme()
  const { org, groups, accounts, visibleSpaces } = useSession()
  const [input, setInput] = useState('')
  const q = useDebounced(input.trim(), 300)
  const [sort, setSort] = useState<PeopleSort>('added')
  const [order, setOrder] = useState<Order>('asc')
  const data = useLoad(() => getPeople(org, { q: q || undefined, sort, order }), [org, q, sort, order], 'people.list')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [sharing, setSharing] = useState(false)
  const [editing, setEditing] = useState<Person | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const d = data.data
  const groupName = (id: number) => groups.find(g => g.id === id)?.name
  const accountName = (k: string) => accounts.find(a => `${a.platform}:${a.id}` === k)?.name || undefined
  const space_ = visibleSpaces.find(s => s.org_id === org)
  const shared = !!d && (d.people.length > 1 || !!q)

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <Txt muted>{space_ && !space_.owner && space_.owner_name ? `Espace partagé par ${space_.owner_name}. ` : ''}On partage un groupe de comptes : Comptes → le groupe → Partager.</Txt>
      {d?.can_manage ? <Button kind="primary" icon="plus" title="Partager un groupe" onPress={() => router.push('/accounts')} /> : null}
      {msg ? <Msg kind={msg.kind}>{msg.text}</Msg> : null}
      {data.error ? <Msg kind="err">{data.error}</Msg> : null}
      {!d && data.loading ? <Skeleton h={64} n={3} /> : null}
      {d && !shared ? (
        <Empty title="Vous êtes seul·e ici" icon="users">
          Pour travailler avec un monteur ou un client : Comptes → créez un groupe → Partager. Vous choisissez : Admin, Peut publier ou Lecture seule.
        </Empty>
      ) : null}
      {shared ? (
        <>
          <SearchField value={input} onChangeText={setInput} placeholder="Rechercher une personne (nom, e-mail)" />
          <SortBar sort={sort} order={order} options={PEOPLE_SORTS} onSort={s => { setSort(s); setOrder('asc') }} onOrder={setOrder} />
        </>
      ) : null}
      {shared && d && d.people.length === 0 ? <Txt small muted>Personne ne correspond à « {q} ».</Txt> : null}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={shared && d ? d.people : []}
        keyExtractor={p => p.email}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.sm, width: '100%', maxWidth: 820, alignSelf: 'center' }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        renderItem={({ item: p }) => {
          const editable = !!d?.can_manage && !p.you && !p.owner && d.org_id != null
          const name = p.name || p.email
          return (
            <Card onPress={editable ? () => setEditing(p) : undefined} accessibilityLabel={editable ? `${name}, ${ROLE_NAME[p.role]}. Modifier` : undefined}>
              <Row gap={space.md}>
                <Avatar src={null} name={name} />
                <View style={{ flex: 1 }}>
                  <Txt bold numberOfLines={1}>{name}{p.you ? <Txt small muted> (vous)</Txt> : null}</Txt>
                  <Txt small muted numberOfLines={2}>{personLine(p, scopeText(p, groupName, accountName))}</Txt>
                </View>
                <View style={{ paddingHorizontal: 10, minHeight: 28, borderRadius: 999, backgroundColor: c.surface2, justifyContent: 'center' }}>
                  <Txt small>{ROLE_NAME[p.role]}</Txt>
                </View>
              </Row>
            </Card>
          )
        }}
        ListFooterComponent={(
          <Txt small faint style={{ marginTop: space.md }}>
            Un compte TikTok, YouTube ou Instagram n’est relié qu’à un seul espace Chapote : quand quelqu’un part, les comptes restent ici. Pour confier un compte à quelqu’un d’autre : Comptes → Transférer.
          </Txt>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={c.muted}
          onRefresh={() => { setRefreshing(true); data.reload(); setTimeout(() => setRefreshing(false), 600) }} />}
      />
      {sharing ? <ShareSheet what={{ all: true }} label="tout l’espace" onClose={() => setSharing(false)} onDone={() => data.reload()} /> : null}
      {editing && d?.org_id != null ? (
        <EditPerson p={editing} org={d.org_id} onClose={() => setEditing(null)}
          onSaved={t => { setEditing(null); setMsg({ kind: 'ok', text: t }); data.reload() }} />
      ) : null}
    </View>
  )
}
