// Réglages compte par compte : les comptes en onglets en haut, et dessous une page par compte qu'on fait
// glisser à gauche / à droite comme un carrousel (l'onglet suit). Chaque page finit par « Retirer ce compte ».
import * as Haptics from 'expo-haptics'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native'
import { PLATFORM_LABEL, type Account } from '../../lib/api'
import { Avatar, Button, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { accKey } from './compose'

export function AccountPager({ accounts, render, problems, onRemove, disabled }: {
  accounts: Account[]
  render: (a: Account) => ReactNode
  /** Nombre de réglages à compléter sur ce compte (pastille rouge sur l'onglet). */
  problems: (a: Account) => number
  onRemove: (a: Account) => void
  disabled?: boolean
}) {
  const { c } = useTheme()
  const [width, setWidth] = useState(0)
  const [index, setIndex] = useState(0)
  const pager = useRef<ScrollViewInstance>(null)
  const tabs = useRef<ScrollViewInstance>(null)
  const tabX = useRef<Record<number, number>>({})
  const last = Math.max(accounts.length - 1, 0)
  // Compte retiré : on reste sur une page qui existe.
  useEffect(() => { if (index > last) go(last, false) }, [last]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { tabs.current?.scrollTo({ x: Math.max(0, (tabX.current[index] || 0) - 40), animated: true }) }, [index])
  const go = (i: number, animated = true) => {
    setIndex(i)
    if (width) pager.current?.scrollTo({ x: i * width, animated })
  }
  if (!accounts.length) return null
  return (
    <View style={{ gap: space.md }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView ref={tabs} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
        {accounts.map((a, i) => {
          const on = i === index, n = problems(a)
          return (
            <Pressable key={accKey(a)} onLayout={e => { tabX.current[i] = e.nativeEvent.layout.x }}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); go(i) }}
              accessibilityRole="tab" accessibilityState={{ selected: on }}
              accessibilityLabel={`${a.name || PLATFORM_LABEL[a.platform]}, ${PLATFORM_LABEL[a.platform]}${n ? `, ${n} réglage${n > 1 ? 's' : ''} à compléter` : ''}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 6, paddingRight: 12,
                borderRadius: 999, backgroundColor: on ? c.ink : c.surface, borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: on ? c.ink : c.borderStrong, opacity: pressed ? 0.75 : 1 })}>
              <Avatar src={a.avatar_url} name={a.name} platform={a.platform} size={30} />
              <Txt small bold color={on ? c.onInk : c.text} numberOfLines={1} style={{ maxWidth: 140 }}>{a.name || PLATFORM_LABEL[a.platform]}</Txt>
              {n ? <View style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <Txt size={11} bold color="#fff">{n}</Txt></View> : null}
            </Pressable>
          )
        })}
      </ScrollView>
      {width ? (
        <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={e => { const i = Math.round(e.nativeEvent.contentOffset.x / width); if (i !== index) { Haptics.selectionAsync().catch(() => {}); setIndex(i) } }}>
          {accounts.map(a => (
            <View key={accKey(a)} style={{ width, gap: space.md }}>
              <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md,
                borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
                <Txt bold>{PLATFORM_LABEL[a.platform]} · {a.name}</Txt>
                {render(a)}
              </View>
              <Button kind="danger" icon="close" title="Retirer ce compte de la programmation" disabled={disabled} onPress={() => onRemove(a)} />
            </View>
          ))}
        </ScrollView>
      ) : null}
      {accounts.length > 1 ? (
        <Txt size={12} muted center>{index + 1} / {accounts.length} · glissez pour passer d’un compte à l’autre</Txt>
      ) : null}
    </View>
  )
}
