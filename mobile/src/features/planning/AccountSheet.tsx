// Choisir les comptes d'une publication, dans une feuille : recherche faite par le serveur,
// filtre par plateforme, comptes rangés par groupe (« Tout le groupe »), comptes indisponibles grisés.
import * as Haptics from 'expo-haptics'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { getAccounts, PLATFORM_LABEL, PLATFORMS, type Account, type Group, type Platform } from '../../lib/api'
import { useLoad, useSession } from '../../lib/session'
import { Avatar, Button, Chip, GroupDot, Icon, Msg, PlatformLogo, SearchField, Sheet, Skeleton, Txt } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'
import { accKey, groupAccounts, unavailable } from './compose'

type Row = { type: 'group'; g: Group; members: Account[] } | { type: 'other' } | { type: 'acc'; a: Account; in: string }

export function AccountSheet({ visible, onClose, picked, onChange, detail }: {
  visible: boolean; onClose: () => void; picked: string[]
  /** Nouvelle liste de clés, et les comptes (objets) ajoutés. */
  onChange: (keys: string[], added: Account[]) => void
  detail: (a: Account) => string
}) {
  const { c } = useTheme()
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [platform, setPlatform] = useState<'' | Platform>('')
  useEffect(() => { const t = setTimeout(() => setQ(input.trim()), 300); return () => clearTimeout(t) }, [input])
  // Tous les comptes de l'espace (pas seulement le groupe affiché), filtrés par le serveur.
  const list = useLoad(s => getAccounts({ org: s.org, group: null }, q ? { q } : {}), [q], 'compose-accounts')
  const { groups } = useSession()
  const accounts = useMemo(() => (list.data || []).filter(a => !platform || a.platform === platform), [list.data, platform])

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    const seen = new Set<string>()
    for (const g of groups) {
      const members = groupAccounts(g, accounts)
      if (!members.length) continue
      out.push({ type: 'group', g, members })
      for (const a of members) { out.push({ type: 'acc', a, in: `g${g.id}` }); seen.add(accKey(a)) }
    }
    const rest = accounts.filter(a => !seen.has(accKey(a)))
    if (rest.length) {
      if (out.length) out.push({ type: 'other' })
      for (const a of rest) out.push({ type: 'acc', a, in: 'x' })
    }
    return out
  }, [groups, accounts])

  const toggle = (a: Account) => {
    if (unavailable(a)) return
    Haptics.selectionAsync().catch(() => {})
    const k = accKey(a)
    if (picked.includes(k)) onChange(picked.filter(x => x !== k), [])
    else onChange([...picked, k], [a])
  }
  const toggleGroup = (members: Account[]) => {
    Haptics.selectionAsync().catch(() => {})
    const ok = members.filter(a => !unavailable(a))
    const full = ok.length > 0 && ok.every(a => picked.includes(accKey(a)))
    if (full) onChange(picked.filter(k => !ok.some(a => accKey(a) === k)), [])
    else { const add = ok.filter(a => !picked.includes(accKey(a))); onChange([...picked, ...add.map(accKey)], add) }
  }

  const n = picked.length
  return (
    <Sheet visible={visible} onClose={onClose} title={`Comptes · ${n} choisi${n > 1 ? 's' : ''}`} scroll={false}
      footer={<Button kind="primary" title={n ? `Valider (${n})` : 'Choisir au moins un compte'} onPress={onClose} />}>
      <SearchField value={input} onChangeText={setInput} placeholder="Rechercher un compte" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
        <Chip label="Tous" selected={!platform} onPress={() => setPlatform('')} />
        {PLATFORMS.map(p => (
          <Chip key={p} label={PLATFORM_LABEL[p]} selected={platform === p} onPress={() => setPlatform(platform === p ? '' : p)}
            left={<PlatformLogo platform={p} size={14} />} />
        ))}
      </ScrollView>
      {list.error ? <Msg kind="err">{list.error}</Msg> : null}
      {!list.data && list.loading ? <View style={{ gap: space.sm }}><Skeleton h={52} n={4} /></View> : (
        <FlatList
          data={rows}
          style={{ flexShrink: 1, minHeight: 200 }}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(r, i) => (r.type === 'group' ? `g${r.g.id}` : r.type === 'other' ? 'other' : `${r.in}-${accKey(r.a)}-${i}`)}
          ListEmptyComponent={<Txt muted small center style={{ padding: space.lg }}>{q ? `Rien ne correspond à « ${q} ».` : 'Aucun compte connecté.'}</Txt>}
          renderItem={({ item: r }) => {
            if (r.type === 'other') return <Txt small bold muted style={{ paddingTop: space.md, paddingBottom: 4 }}>Autres comptes</Txt>
            if (r.type === 'group') {
              const ok = r.members.filter(a => !unavailable(a))
              const full = ok.length > 0 && ok.every(a => picked.includes(accKey(a)))
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: space.md, paddingBottom: 4 }}>
                  <GroupDot color={r.g.color} />
                  <Txt bold style={{ flex: 1 }} numberOfLines={1}>{r.g.name}</Txt>
                  <Button small kind="ghost" title={full ? 'Retirer le groupe' : 'Tout le groupe'} disabled={!ok.length} onPress={() => toggleGroup(r.members)} />
                </View>
              )
            }
            const a = r.a, why = unavailable(a), on = picked.includes(accKey(a))
            return (
              <Pressable onPress={() => toggle(a)} disabled={!!why} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !!why }}
                accessibilityLabel={`${a.name || PLATFORM_LABEL[a.platform]}, ${why || detail(a)}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: 6,
                  borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, opacity: why ? 0.5 : pressed ? 0.7 : 1 })}>
                <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: on ? c.primary : c.borderStrong,
                  backgroundColor: on ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <Icon name="check" size={15} color={c.onPrimary} strokeWidth={3} /> : null}
                </View>
                <Avatar src={a.avatar_url} name={a.name} platform={a.platform} size={36} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt bold numberOfLines={1}>{a.name || PLATFORM_LABEL[a.platform]}</Txt>
                  <Txt small color={why ? c.danger : c.muted} numberOfLines={1}>{why || detail(a)}</Txt>
                </View>
              </Pressable>
            )
          }}
        />
      )}
    </Sheet>
  )
}

