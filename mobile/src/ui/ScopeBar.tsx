// En-tête des onglets : ce qui est affiché (Tous, un ou plusieurs groupes, un seul compte), invitations reçues,
// accès aux comptes et réglages. Plus d'« espaces » (docs/CM_ROUTINES.md §10).
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { acceptInvitation, declineInvitation, PLATFORM_LABEL, type Invitation } from '../lib/api'
import { groupToken, useSession } from '../lib/session'
import { Avatar, Button, Card, Chip, GroupDot, Icon, IconButton, Label, Row, SearchField, Sheet, Txt } from './kit'
import { space, useTheme } from './theme'

/** Texte de la sélection : « Tous », nom du groupe, « 3 groupes », nom du compte. */
function useSelLabel(): string {
  const { sel, groups, accounts } = useSession()
  if (!sel.length || sel[0] === 'all') return 'Tous'
  if (sel.length === 1 && sel[0].startsWith('acc:')) {
    const a = accounts.find(x => `acc:${x.platform}:${x.id}` === sel[0])
    return a ? a.name || a.username || PLATFORM_LABEL[a.platform] : 'Un compte'
  }
  const gs = groups.filter(g => sel.includes(groupToken(g)))
  if (gs.length === 1) return gs[0].name
  if (sel[0] === 'perso') return 'Mes comptes'
  return `${sel.length} groupes`
}

export function ScopeTitle() {
  const { c } = useTheme()
  const { invitations, sel, groups } = useSession()
  const [open, setOpen] = useState(false)
  const label = useSelLabel()
  const one = sel.length === 1 ? groups.find(g => groupToken(g) === sel[0]) : null
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`Affiché : ${label}. Changer`}
        style={{ minHeight: 44, justifyContent: 'center', maxWidth: 260 }}>
        <Row gap={6}>
          {one ? <GroupDot color={one.color} /> : null}
          <Txt bold size={17} numberOfLines={1}>{label}</Txt>
          <Icon name="down" size={16} color={c.muted} />
          {invitations.length ? <View style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
            <Txt size={11} bold color="#fff">{invitations.length}</Txt></View> : null}
        </Row>
      </Pressable>
      <ScopeSheet visible={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function HeaderActions() {
  const router = useRouter()
  return (
    <Row gap={0} style={{ marginRight: 4 }}>
      <IconButton icon="bell" label="Activité" onPress={() => router.push('/activity')} />
      <IconButton icon="users" label="Comptes connectés" onPress={() => router.push('/accounts')} />
      <IconButton icon="settings" label="Réglages" onPress={() => router.push('/settings')} />
    </Row>
  )
}

export function InvitationCard({ inv }: { inv: Invitation }) {
  const { refresh, reloadGroups } = useSession()
  const n = Array.isArray(inv.accounts) ? inv.accounts.length : inv.accounts
  const done = async () => { await refresh(); await reloadGroups() }
  return (
    <Card>
      <Row gap={8}><GroupDot color={inv.group_color} /><Txt bold style={{ flex: 1 }}>{inv.group_name}</Txt></Row>
      <Txt small muted>{inv.invited_by || inv.owner || 'Quelqu’un'} vous invite : {inv.role_label}{n ? ` · ${n} compte${n > 1 ? 's' : ''}` : ''}{inv.owner ? ` · chez ${inv.owner}` : ''}</Txt>
      <Row>
        <Button flex small kind="primary" title="Accepter" onPress={async () => { try { await acceptInvitation(inv.id); await done() } catch (e: any) { Alert.alert('Erreur', e?.message || '') } }} />
        <Button flex small kind="danger" title="Refuser" onPress={async () => { try { await declineInvitation(inv.id); await done() } catch (e: any) { Alert.alert('Erreur', e?.message || '') } }} />
      </Row>
    </Card>
  )
}

export function ScopeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme()
  const { sel, setSel, groups, accounts, invitations } = useSession()
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = accounts.filter(a => !needle || `${a.name || ''} ${a.username || ''} ${a.handle || ''} ${a.owner || ''} ${a.platform}`.toLowerCase().includes(needle))
  const isAll = !sel.length || sel[0] === 'all'
  const groupSel = sel.filter(t => t.includes('group:'))
  const toggleGroup = (t: string) => {
    const next = groupSel.includes(t) ? groupSel.filter(x => x !== t) : [...groupSel, t]
    setSel(next.length ? next : ['all'])
  }
  return (
    <Sheet visible={visible} title="Afficher" onClose={onClose}>
      {invitations.length ? (
        <View style={{ gap: space.sm }}>
          <Label>Invitations</Label>
          {invitations.map(inv => <InvitationCard key={inv.id} inv={inv} />)}
        </View>
      ) : null}
      <Chip label="Tous mes comptes et groupes" selected={isAll} onPress={() => { setSel(['all']); onClose() }} />
      {groups.length ? (
        <View style={{ gap: space.sm }}>
          <Label>Groupes (plusieurs possibles)</Label>
          <Row wrap>
            {groups.map(g => {
              const t = groupToken(g)
              return <Chip key={t} label={g.name} selected={groupSel.includes(t)} left={<GroupDot color={g.color} />} onPress={() => toggleGroup(t)} />
            })}
          </Row>
        </View>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Label>Un seul compte</Label>
        {accounts.length > 6 ? <SearchField value={q} onChangeText={setQ} placeholder="Chercher un compte" /> : null}
        {shown.map(a => {
          const key = `acc:${a.platform}:${a.id}`
          const on = sel.length === 1 && sel[0] === key
          return (
            <Pressable key={key} onPress={() => { setSel(on ? ['all'] : [key]); onClose() }} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
              <Avatar src={a.avatar_url} name={a.name} platform={a.platform} size={36} />
              <View style={{ flex: 1 }}>
                <Txt numberOfLines={1} bold={on}>{a.name || a.username || PLATFORM_LABEL[a.platform]}</Txt>
                <Txt small muted numberOfLines={1}>{PLATFORM_LABEL[a.platform]}{a.mine === false && a.owner ? ` · chez ${a.owner}` : ''}{a.role === 'viewer' ? ' · lecture seule' : ''}</Txt>
              </View>
              {on ? <Icon name="check" color={c.primary} /> : null}
            </Pressable>
          )
        })}
      </View>
      {!isAll && groupSel.length ? <Button kind="primary" title="Valider" onPress={onClose} /> : null}
    </Sheet>
  )
}
