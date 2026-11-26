// Briques de l'écran Comptes (comme cm/src/pages/Accounts.tsx) : éditeur de groupe, transfert d'un compte,
// transferts reçus / envoyés, ligne d'un compte.
import { useState } from 'react'
import { Pressable, StyleSheet, View, Switch } from 'react-native'
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
import { t } from '../../lib/i18n'

export function GroupEditor({ group, accounts, onClose, onSaved, org }: { group: Group | null; accounts: Account[]; onClose: () => void; onSaved: (g: Group) => void; org: number | null }) {
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
    <Sheet visible title={group ? t('Modifier le groupe') : t('Nouveau groupe')} onClose={onClose}
      footer={<Row gap={space.sm}>
        <Button title={t('Annuler')} onPress={onClose} flex />
        <Button kind="primary" title={group ? t('Enregistrer') : t('Créer le groupe')} loading={busy} disabled={!name.trim()} onPress={save} flex />
      </Row>}>
      <Field label={t('Nom')} value={name} onChangeText={setName} maxLength={60} placeholder={t('Ex. Ghost Hands, Clients, Piano FR')} autoFocus={!group} />
      <View style={{ gap: space.sm }}>
        <Txt small bold>{t('Couleur · {couleur}', { couleur: t(COLOR_LABEL[color]) })}</Txt>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('Couleur')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {GROUP_COLORS.map(k => (
            <Pressable key={k} onPress={() => setColor(k)} accessibilityRole="radio" accessibilityLabel={t(COLOR_LABEL[k])} accessibilityState={{ checked: k === color }}
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
        <Txt small bold>{picked.length > 1 ? t('Comptes du groupe · {n} choisis', { n: picked.length }) : t('Comptes du groupe · {n} choisi', { n: picked.length })}</Txt>
        {accounts.length === 0 ? <Txt small muted>{t('Connectez d’abord des comptes.')}</Txt> : (
          <>
            {accounts.length > 6 ? <SearchField value={q} onChangeText={setQ} placeholder={t('Rechercher un compte')} /> : null}
            {shown.map(a => {
              const k = akey(a.platform, a.id)
              return <Choice key={k} label={a.name || a.username || PLATFORM_LABEL[a.platform]} checked={picked.includes(k)}
                onPress={() => setPicked(p => toggleIn(p, k))} left={<Avatar src={a.avatar_url} name={a.name} platform={a.platform} size={32} />} />
            })}
            {q && !shown.length ? <Txt small muted>{t('Aucun compte ne correspond à « {q} ».', { q })}</Txt> : null}
          </>
        )}
        <Txt small muted>{t('Un compte peut appartenir à plusieurs groupes.')}</Txt>
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
    if (to === 'email' && !isEmail(email)) { setErr(t('Adresse e-mail invalide.')); return }
    setBusy(true)
    try {
      const r = await transferAccount(org, a, transferBody(to, email))
      onDone(t(transferDoneText(r, a.name, spaces.find(s => String(s.org_id ?? 'perso') === to)?.name)))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Sheet visible title={t('Transférer {nom}', { nom: a.name || PLATFORM_LABEL[a.platform] })} onClose={onClose}
      footer={<Row gap={space.sm}>
        <Button title={t('Annuler')} onPress={onClose} flex />
        <Button kind="primary" title={to === 'email' ? t('Proposer') : t('Transférer')} loading={busy} disabled={to === 'email' && !email.trim()} onPress={submit} flex />
      </Row>}>
      <Txt small muted>{t('Le compte part avec son planning à venir, ses chiffres et ses vidéos. Les publications déjà parties restent dans l’historique de cet espace.')}</Txt>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('Vers')}>
        <Label>{t('Vers')}</Label>
        {choices.map(([v, l]) => <Choice key={v} radio label={v === 'email' ? t(l) : l} checked={to === v} onPress={() => setTo(v)} />)}
      </View>
      {to === 'email' ? (
        <Field label={t('Son adresse e-mail Chapote')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
          autoFocus hint={t('Elle devra accepter le transfert dans cm (14 jours). Rien ne change d’ici là.')} />
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
    <Card accessibilityLabel={t('Transferts de comptes')}>
      <Label>{t('Transferts')}</Label>
      {data.incoming.map(tr => (
        <View key={tr.id} style={{ gap: space.sm }}>
          <Txt small><Txt small bold>{tr.from || t('Quelqu’un')}</Txt>{t(' vous transfère ')}<Txt small bold>{tr.account_name}</Txt> ({PLATFORM_LABEL[tr.platform]}).</Txt>
          {choices.length > 1 ? (
            <Select label={t('Espace d’arrivée')} value={dest[tr.id] ?? 'perso'} options={choices} onChange={v => setDest(x => ({ ...x, [tr.id]: v }))} />
          ) : null}
          <Row gap={space.sm}>
            <Button small kind="primary" title={t('Accepter')} flex onPress={() => act(() => acceptTransfer(tr.id, orgFromKey(dest[tr.id])), t('{nom} a rejoint votre espace.', { nom: tr.account_name }))} />
            <Button small title={t('Refuser')} flex onPress={() => act(() => declineTransfer(tr.id), t('Transfert refusé.'))} />
          </Row>
        </View>
      ))}
      {data.outgoing.map(tr => (
        <Row key={tr.id} gap={space.sm}>
          <Txt small muted style={{ flex: 1 }}>{t('En attente : ')}<Txt small bold>{tr.account_name}</Txt>{t(' proposé à {email}.', { email: tr.to_email })}</Txt>
          <Button small title={t('Annuler')} onPress={() => act(() => cancelTransfer(tr.id), t('Transfert annulé.'))} accessibilityLabel={t('Annuler le transfert de {nom}', { nom: tr.account_name })} />
        </Row>
      ))}
    </Card>
  )
}

export function AccountRow({ a, groups, canAdmin, busy, onSync, onRemove, onReconnect, onTransfer, onShare, onPublicDomain }:
  { a: Account; groups: Group[]; canAdmin: boolean; busy: string | null; onSync: () => void; onRemove: () => void; onReconnect: () => void; onTransfer: () => void; onShare: () => void
    onPublicDomain?: (v: boolean) => void }) {
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
            <Txt small color={tone}>{t(st.label)}</Txt>
            {a.stats?.updated_at ? t(' · chiffres du {date}', { date: fmtDateTime(a.stats.updated_at) }) : ''}
          </Txt>
          {a.stats?.error ? <Txt small color={c.warn}>{a.stats.error}</Txt> : null}
        </View>
        {a.stats_available && a.stats ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Txt small><Txt small bold>{short(a.stats.followers)}</Txt>{t(' abonnés')}</Txt>
            <Txt small muted><Txt small bold>{short(a.stats.views)}</Txt>{t(' vues')}</Txt>
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
      {a.platform === 'youtube' && onPublicDomain ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Txt small bold>{t('Domaine public seulement')}</Txt>
            <Txt small muted>{t('Refuse les œuvres protégées ou aux droits inconnus.')}</Txt>
          </View>
          <Switch value={!!a.public_domain_only} disabled={!canAdmin || busy === `p${a.platform}${a.id}`} onValueChange={onPublicDomain}
            accessibilityLabel={t('Domaine public seulement pour {nom}', { nom: name })} trackColor={{ true: c.primary }} />
        </Row>
      ) : null}
      <Row gap={6} wrap>
        {a.needs_reconnect && canAdmin ? <Button small kind="primary" title={t('Reconnecter')} onPress={onReconnect} /> : null}
        {a.stats_available && a.mode !== 'routine' && !a.needs_reconnect
          ? <Button small icon="refresh" title={t('Actualiser')} loading={busy === `s${a.platform}${a.id}`} onPress={onSync} accessibilityLabel={t('Actualiser les chiffres de {nom}', { nom: name })} /> : null}
        {canAdmin ? <Button small icon="users" title={t('Partager')} onPress={onShare} accessibilityLabel={t('Partager {nom}', { nom: name })} /> : null}
        {canAdmin ? <Button small title={t('Transférer')} onPress={onTransfer} accessibilityLabel={t('Transférer {nom}', { nom: name })} /> : null}
        {canAdmin ? <Button small kind="danger" title={a.mode === 'routine' ? t('Retirer') : t('Déconnecter')} loading={busy === `d${a.platform}${a.id}`} onPress={onRemove}
          accessibilityLabel={a.mode === 'routine' ? t('Retirer {nom}', { nom: name }) : t('Déconnecter {nom}', { nom: name })} /> : null}
      </Row>
    </View>
  )
}
