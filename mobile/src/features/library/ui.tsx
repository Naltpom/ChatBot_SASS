// Petites briques tactiles des écrans Bibliothèque, Brouillons, Comptes et Personnes :
// liste de choix dépliable (à la place des <select> du site), cases, interrupteurs, tri, miniature protégée.
import { Image } from 'expo-image'
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Switch, View } from 'react-native'
import type { Order } from '../../lib/api'
import { API_URL } from '../../lib/http'
import { Icon, Row, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { mediaUrl } from './logic'

/** Choix dans une liste : une ligne qui se déplie (pas de fenêtre par-dessus une feuille). */
export function Select<T extends string | number>({ label, value, options, onChange, disabled, placeholder }:
  { label: string; value: T | null; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean; placeholder?: string }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const current = options.find(o => o[0] === value)?.[1] ?? placeholder ?? 'Choisir'
  return (
    <View style={{ gap: 6 }}>
      {label ? <Txt small bold>{label}</Txt> : null}
      <Pressable onPress={() => setOpen(o => !o)} disabled={disabled} accessibilityRole="button"
        accessibilityLabel={`${label} : ${current}`} accessibilityState={{ expanded: open, disabled: !!disabled }}
        style={({ pressed }) => ({ minHeight: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.borderStrong,
          backgroundColor: c.surface, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}>
        <Txt style={{ flex: 1 }} numberOfLines={1}>{current}</Txt>
        <Icon name="down" size={18} color={c.muted} />
      </Pressable>
      {open ? (
        <View style={{ borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: c.surface, overflow: 'hidden' }}>
          {options.map(([v, l], i) => (
            <Pressable key={String(v)} onPress={() => { setOpen(false); if (v !== value) onChange(v) }} accessibilityRole="radio"
              accessibilityState={{ checked: v === value }}
              style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8,
                borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: c.border, backgroundColor: pressed ? c.surface2 : 'transparent' })}>
              <Txt style={{ flex: 1 }} bold={v === value}>{l}</Txt>
              {v === value ? <Icon name="check" size={18} color={c.primary} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

/** Case ronde (choix unique) ou carrée (plusieurs choix), avec une explication facultative. */
export function Choice({ label, hint, checked, onPress, radio, disabled, left }:
  { label: string; hint?: string; checked: boolean; onPress: () => void; radio?: boolean; disabled?: boolean; left?: ReactNode }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole={radio ? 'radio' : 'checkbox'} accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityState={{ checked, disabled: !!disabled }}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}>
      <View style={{ width: 22, height: 22, borderRadius: radio ? 11 : 6, borderWidth: 2, borderColor: checked ? c.primary : c.borderStrong,
        backgroundColor: checked && !radio ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked ? (radio ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary }} />
          : <Icon name="check" size={14} color={c.onPrimary} strokeWidth={3} />) : null}
      </View>
      {left}
      <View style={{ flex: 1 }}>
        <Txt bold={!!hint}>{label}</Txt>
        {hint ? <Txt small muted>{hint}</Txt> : null}
      </View>
    </Pressable>
  )
}

/** Interrupteur avec libellé (ex. « Ranger les vidéos publiées »). */
export function ToggleRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme()
  return (
    <Row style={{ minHeight: 44, alignItems: 'center', opacity: disabled ? 0.55 : 1 }} gap={space.md}>
      <View style={{ flex: 1 }}>
        <Txt>{label}</Txt>
        {hint ? <Txt small muted>{hint}</Txt> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label}
        trackColor={{ true: c.primary, false: c.borderStrong }} />
    </Row>
  )
}

/** Tri : critère (liste dépliable) et sens. */
export function SortBar<S extends string>({ sort, order, options, onSort, onOrder }:
  { sort: S; order: Order; options: [S, string][]; onSort: (s: S) => void; onOrder: (o: Order) => void }) {
  return (
    <Row gap={space.sm} style={{ alignItems: 'flex-end' }}>
      <View style={{ flex: 1 }}><Select label="" value={sort} options={options} onChange={onSort} /></View>
      <OrderButton order={order} onPress={() => onOrder(order === 'asc' ? 'desc' : 'asc')} />
    </Row>
  )
}

function OrderButton({ order, onPress }: { order: Order; onPress: () => void }) {
  const { c } = useTheme()
  const label = order === 'asc' ? 'Ordre croissant' : 'Ordre décroissant'
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}. Inverser`}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.borderStrong,
        backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
      <View style={{ transform: [{ rotate: order === 'asc' ? '180deg' : '0deg' }] }}><Icon name="down" size={20} /></View>
    </Pressable>
  )
}

/** Miniature servie par l'API (avec le cookie de session). */
export function AuthImage({ path, headers, style, accessibilityLabel }:
  { path: string | null | undefined; headers: Record<string, string> | null; style: object; accessibilityLabel?: string }) {
  const { c } = useTheme()
  const uri = mediaUrl(API_URL, path)
  if (!uri || !headers) return <View style={[{ backgroundColor: c.surface2 }, style]} />
  return <Image source={{ uri, headers }} style={[{ backgroundColor: c.surface2 }, style]} contentFit="cover" transition={150}
    accessibilityLabel={accessibilityLabel} accessible={!!accessibilityLabel} />
}

/** Pastille sur une miniature. */
export function Badge({ label, accent }: { label: string; accent?: boolean }) {
  const { c } = useTheme()
  return (
    <View style={{ position: 'absolute', left: 8, top: 8, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2,
      backgroundColor: accent ? c.accent : 'rgba(0,0,0,0.55)' }}>
      <Txt size={12} bold color="#fff">{label}</Txt>
    </View>
  )
}

/** Bloc repliable (équivalent de <details>). */
export function Fold({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <View style={{ gap: space.sm }}>
      <Pressable onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.7 : 1 })}>
        <View style={{ transform: [{ rotate: open ? '0deg' : '-90deg' }] }}><Icon name="down" size={18} color={c.accent} /></View>
        <Txt style={{ flex: 1 }} color={c.accent}>{title}</Txt>
      </Pressable>
      {open ? children : null}
    </View>
  )
}
