// Briques de l'écran Comptes (comme cm/src/pages/Accounts.tsx) : éditeur de groupe, transfert d'un compte,
// transferts reçus / envoyés, ligne d'un compte.
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  acceptTransfer, cancelTransfer, createGroup, declineTransfer, transferAccount, updateGroup,
  GROUP_COLORS, PLATFORM_LABEL, type Account, type Group, type GroupColor, type Transfer,
} from '../../lib/api'
import { fmtDateTime, short } from '../../lib/format'
import { useSession } from '../../lib/session'
import { Avatar, Button, Card, Field, GroupDot, Icon, Label, Msg, Row, SearchField, Sheet, Txt, groupHex } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'
import { Choice, Select } from '../library/ui'
import {
  COLOR_LABEL, accountState, adminSpaceChoices, akey, filterAccounts, groupBody, isEmail, orgFromKey, toggleIn, transferBody,
  transferChoices, transferDoneText,
} from './logic'

export function GroupEditor({ group, accounts, onClose, onSaved }: { group: Group | null; accounts: Account[]; onClose: () => void; onSaved: (g: Group) => void }) {
  const { org } = useSession()
  const { c } = useTheme()
  const [name, setName] = useState(group?.name || '')
  const [color, setColor] = useState<GroupColor>(group?.color || GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)])
  const [picked, setPicked] = useState<string[]>(group ? group.accounts.map(a => akey(a.platform, a.id)) : [])
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setErr(''); setBusy(true)
    const body = groupBody(name, color, picked)
    try { onSaved(group ? await updateGroup(org, group.id, body) : await createGroup(org, body)) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const shown = filterAccounts(accounts, q)
  return (
    <Sheet visible title={group ? 'Modifier le groupe' : 'Nouveau groupe'} onClose={onClose}
      footer={<Row gap={space.sm}>
        <Button title="Annuler" onPress={onClose} flex />
        <Button kind="primary" title={group ? 'Enregistrer' : 'Créer le groupe'} loading={busy} disabled={!name.trim()} onPress={save} flex />
      </Row>}>
      <Field label="Nom" value={name} onChangeText={setName} maxLength={60} placeholder="Ex. Ghost Hands, Clients, Piano FR" autoFocus={!group} />
      <View style={{ gap: space.sm }}>
        <Txt small bold>Couleur · {COLOR_LABEL[color]}</Txt>
        <View accessibilityRole="radiogroup" accessibilityLabel="Couleur" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {GROUP_COLORS.map(k => (
            <Pressable key={k} onPress={() => setColor(k)} accessibilityRole="radio" accessibilityLabel={COLOR_LABEL[k]} accessibilityState={{ checked: k === color }}
              style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                borderWidth: 2, borderColor: k === color ? c.text : 'transparent' }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: groupHex(k), alignItems: 'center', justifyContent: 'center' }}>
                {k === color ? <Icon name="check" size={16} color="#fff" strokeWidth={3} /> : null}
              </View>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ gap: space.sm }}>
        <Txt small bold>Comptes du groupe · {picked.length} choisi{picked.length > 1 ? 's' : ''}</Txt>
        {accounts.length === 0 ? <Txt small muted>Connectez d’abord des comptes.</Txt> : (
          <>
            {accounts.length > 6 ? <SearchField value={q} onChangeText={setQ} placeholder="Rechercher un compte" /> : null}
            {shown.map(a => {
              const k = akey(a.platform, a.id)
              return <Choice key={k} label={a.name || a.username || PLATFORM_LABEL[a.platform]} checked={picked.includes(k)}
                onPress={() => setPicked(p => toggleIn(p, k))} left={<Avatar src={a.avatar_url} name={a.name} platform={a.platform} size={32} />} />
            })}
            {q && !shown.length ? <Txt small muted>Aucun compte ne correspond à « {q} ».</Txt> : null}
          </>
        )}
        <Txt small muted>Un compte peut appartenir à plusieurs groupes.</Txt>
      </View>
      {err ? <Msg kind="err">{err}</Msg> : null}
    </Sheet>
  )
}

/** Transférer un compte : vers un autre de mes espaces (immédiat) ou une autre personne (à accepter). */
export function TransferSheet({ a, onClose, onDone }: { a: Account; onClose: () => void; onDone: (text: string) => void }) {
  const { org, spaces } = useSession()
  const choices = transferChoices(spaces, org)
  const [to, setTo] = useState<string>(choices[0][0])
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setErr('')
    if (to === 'email' && !isEmail(email)) { setErr('Adresse e-mail invalide.'); return }
    setBusy(true)
    try {
      const r = await transferAccount(org, a, transferBody(to, email))
      onDone(transferDoneText(r, a.name, spaces.find(s => String(s.org_id ?? 'perso') === to)?.name))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Sheet visible title={`Transférer ${a.name || PLATFORM_LABEL[a.platform]}`} onClose={onClose}
      footer={<Row gap={space.sm}>
        <Button title="Annuler" onPress={onClose} flex />
        <Button kind="primary" title={to === 'email' ? 'Proposer' : 'Transférer'} loading={busy} disabled={to === 'email' && !email.trim()} onPress={submit} flex />
      </Row>}>
      <Txt small muted>Le compte part avec son planning à venir, ses chiffres et ses vidéos. Les publications déjà parties restent dans l’historique de cet espace.</Txt>
      <View accessibilityRole="radiogroup" accessibilityLabel="Vers">
        <Label>Vers</Label>
        {choices.map(([v, l]) => <Choice key={v} radio label={l} checked={to === v} onPress={() => setTo(v)} />)}
      </View>
      {to === 'email' ? (
        <Field label="Son adresse e-mail Chapote" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
          autoFocus hint="Elle devra accepter le transfert dans cm (14 jours). Rien ne change d’ici là." />
      ) : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
    </Sheet>
  )
}

/** Transferts reçus (à accepter dans un de mes espaces) et envoyés (en attente). */
export function Transfers({ data, onChanged }: { data: { incoming: Transfer[]; outgoing: Transfer[] } | null; onChanged: (text: string | null, err?: string) => void }) {
  const { spaces } = useSession()
  const choices = adminSpaceChoices(spaces)
  const [dest, setDest] = useState<Record<number, string>>({})
  if (!data || (!data.incoming.length && !data.outgoing.length)) return null
  const act = async (fn: () => Promise<unknown>, text: string) => {
    try { await fn(); onChanged(text) } catch (e) { onChanged(null, (e as Error).message) }
  }
  return (
    <Card accessibilityLabel="Transferts de comptes">
      <Label>Transferts</Label>
      {data.incoming.map(t => (
        <View key={t.id} style={{ gap: space.sm }}>
          <Txt small><Txt small bold>{t.from || 'Quelqu’un'}</Txt> vous transfère <Txt small bold>{t.account_name}</Txt> ({PLATFORM_LABEL[t.platform]}).</Txt>
          {choices.length > 1 ? (
            <Select label="Espace d’arrivée" value={dest[t.id] ?? 'perso'} options={choices} onChange={v => setDest(x => ({ ...x, [t.id]: v }))} />
          ) : null}
          <Row gap={space.sm}>
            <Button small kind="primary" title="Accepter" flex onPress={() => act(() => acceptTransfer(t.id, orgFromKey(dest[t.id])), `${t.account_name} a rejoint votre espace.`)} />
            <Button small title="Refuser" flex onPress={() => act(() => declineTransfer(t.id), 'Transfert refusé.')} />
          </Row>
        </View>
      ))}
      {data.outgoing.map(t => (
        <Row key={t.id} gap={space.sm}>
          <Txt small muted style={{ flex: 1 }}>En attente : <Txt small bold>{t.account_name}</Txt> proposé à {t.to_email}.</Txt>
          <Button small title="Annuler" onPress={() => act(() => cancelTransfer(t.id), 'Transfert annulé.')} accessibilityLabel={`Annuler le transfert de ${t.account_name}`} />
        </Row>
      ))}
    </Card>
  )
}

export function AccountRow({ a, groups, canAdmin, busy, onSync, onRemove, onReconnect, onTransfer, onShare }:
  { a: Account; groups: Group[]; canAdmin: boolean; busy: string | null; onSync: () => void; onRemove: () => void; onReconnect: () => void; onTransfer: () => void; onShare: () => void }) {
  const { c } = useTheme()
  const st = accountState(a)
  const tone = { ok: c.ok, warn: c.warn, danger: c.danger, muted: c.muted }[st.tone]
  const name = a.name || a.username || PLATFORM_LABEL[a.platform]
  return (
    <View style={{ gap: space.sm, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
      <Row gap={space.md}>
        <Avatar src={a.avatar_url} name={name} platform={a.platform} />
        <View style={{ flex: 1 }}>
          <Txt bold numberOfLines={1}>{name}</Txt>
          <Txt small muted>
            <Txt small color={tone}>{st.label}</Txt>
            {a.stats?.updated_at ? ` · chiffres du ${fmtDateTime(a.stats.updated_at)}` : ''}
          </Txt>
          {a.stats?.error ? <Txt small color={c.warn}>{a.stats.error}</Txt> : null}
        </View>
        {a.stats_available && a.stats ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Txt small><Txt small bold>{short(a.stats.followers)}</Txt> abonnés</Txt>
            <Txt small muted><Txt small bold>{short(a.stats.views)}</Txt> vues</Txt>
          </View>
        ) : null}
      </Row>
      {groups.length ? (
        <Row gap={6} wrap>
          {groups.map(g => (
            <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 28, borderRadius: 999, backgroundColor: c.surface2 }}>
              <GroupDot color={g.color} size={8} /><Txt small>{g.name}</Txt>
            </View>
          ))}
        </Row>
      ) : null}
      <Row gap={6} wrap>
        {a.needs_reconnect && canAdmin ? <Button small kind="primary" title="Reconnecter" onPress={onReconnect} /> : null}
        {a.stats_available && a.mode !== 'routine' && !a.needs_reconnect
          ? <Button small icon="refresh" title="Actualiser" loading={busy === `s${a.platform}${a.id}`} onPress={onSync} accessibilityLabel={`Actualiser les chiffres de ${name}`} /> : null}
        {canAdmin ? <Button small icon="users" title="Partager" onPress={onShare} accessibilityLabel={`Partager ${name}`} /> : null}
        {canAdmin ? <Button small title="Transférer" onPress={onTransfer} accessibilityLabel={`Transférer ${name}`} /> : null}
        {canAdmin ? <Button small kind="danger" title={a.mode === 'routine' ? 'Retirer' : 'Déconnecter'} loading={busy === `d${a.platform}${a.id}`} onPress={onRemove}
          accessibilityLabel={`${a.mode === 'routine' ? 'Retirer' : 'Déconnecter'} ${name}`} /> : null}
      </Row>
    </View>
  )
}
