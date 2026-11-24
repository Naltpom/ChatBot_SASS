// En-tête des onglets : espace (perso / équipe), groupe ou compte affiché, accès aux comptes et réglages.
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { PLATFORM_LABEL } from '../lib/api'
import { useSession } from '../lib/session'
import { Avatar, Chip, GroupDot, Icon, IconButton, Label, Row, SearchField, Sheet, Txt } from './kit'
import { space, useTheme } from './theme'

export function ScopeTitle() {
  const { c } = useTheme()
  const { visibleSpaces, org, group, account, accounts } = useSession()
  const [open, setOpen] = useState(false)
  const space_ = visibleSpaces.find(s => s.org_id === org)
  const acc = account ? accounts.find(a => `${a.platform}:${a.id}` === account) : null
  const sub = acc ? (acc.name || acc.username || PLATFORM_LABEL[acc.platform]) : group ? group.name : 'Tous les comptes'
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`Espace ${space_?.name || 'perso'}, ${sub}. Changer`}
        style={{ minHeight: 44, justifyContent: 'center', maxWidth: 260 }}>
        <Row gap={4}>
          <Txt bold size={17} numberOfLines={1}>{space_?.name || 'Mon espace'}</Txt>
          <Icon name="down" size={16} color={c.muted} />
        </Row>
        <Row gap={6}>
          {group && !acc ? <GroupDot color={group.color} size={8} /> : null}
          <Txt small muted numberOfLines={1}>{sub}</Txt>
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
      <IconButton icon="users" label="Comptes connectés" onPress={() => router.push('/accounts')} />
      <IconButton icon="settings" label="Réglages" onPress={() => router.push('/settings')} />
    </Row>
  )
}

export function ScopeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme()
  const { visibleSpaces, org, setOrg, groups, group, setGroup, account, setAccount, accounts } = useSession()
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = accounts.filter(a => !needle || `${a.name || ''} ${a.username || ''} ${a.handle || ''} ${a.platform}`.toLowerCase().includes(needle))
  const pick = (fn: () => void) => { fn(); onClose() }
  return (
    <Sheet visible={visible} title="Afficher" onClose={onClose}>
      {visibleSpaces.length > 1 ? (
        <View style={{ gap: space.sm }}>
          <Label>Espace</Label>
          <Row wrap>
            {visibleSpaces.map(s => (
              <Chip key={String(s.org_id)} label={s.name} selected={s.org_id === org} onPress={() => setOrg(s.org_id)} />
            ))}
          </Row>
        </View>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Label>Groupe</Label>
        <Row wrap>
          <Chip label="Tous les comptes" selected={!group && !account} onPress={() => pick(() => { setGroup(null); setAccount(null) })} />
          {groups.map(g => (
            <Chip key={g.id} label={g.name} selected={group?.id === g.id && !account} left={<GroupDot color={g.color} />}
              onPress={() => pick(() => setGroup(g.id))} />
          ))}
        </Row>
      </View>
      <View style={{ gap: space.sm }}>
        <Label>Un seul compte</Label>
        {accounts.length > 6 ? <SearchField value={q} onChangeText={setQ} placeholder="Chercher un compte" /> : null}
        {shown.map(a => {
          const key = `${a.platform}:${a.id}`
          const on = account === key
          return (
            <Pressable key={key} onPress={() => pick(() => setAccount(on ? null : key))} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
              <Avatar src={a.avatar_url} name={a.name} platform={a.platform} size={36} />
              <View style={{ flex: 1 }}>
                <Txt numberOfLines={1} bold={on}>{a.name || a.username || PLATFORM_LABEL[a.platform]}</Txt>
                <Txt small muted>{PLATFORM_LABEL[a.platform]}</Txt>
              </View>
              {on ? <Icon name="check" color={c.primary} /> : null}
            </Pressable>
          )
        })}
      </View>
    </Sheet>
  )
}
