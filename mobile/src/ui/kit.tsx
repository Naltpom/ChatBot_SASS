// Composants communs de l'app (équivalents de cm/src/components/ui.tsx), clair et sombre.
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler'
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform as RNPlatform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View, type ScrollViewInstance, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PLATFORM_LABEL, type GroupColor, type Platform, type TargetStatus } from '../lib/api'
import { STATUS, signed } from '../lib/format'
import { Icon, type IconName } from './Icon'
import { PlatformLogo } from './PlatformLogo'
import { GROUP_HEX, radius, space, useTheme } from './theme'
import { HEADING, useHeadingFont } from './fonts'

export { Icon, PlatformLogo }
export type { IconName }

type TxtProps = { children?: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; faint?: boolean; small?: boolean; bold?: boolean
  size?: number; color?: string; numberOfLines?: number; center?: boolean; selectable?: boolean; accessibilityRole?: 'header' | 'text' | 'link'; onPress?: () => void }

export function Txt({ children, style, muted, faint, small, bold, size, color, numberOfLines, center, selectable, accessibilityRole, onPress }: TxtProps) {
  const { c } = useTheme()
  const fonts = useHeadingFont()
  const fs = size ?? (small ? 13 : 15)
  // Titres (en-têtes, ou gros texte en gras) : Bricolage Grotesque, interlettrage un peu serré sur les gros titres.
  const heading = fonts && bold && (accessibilityRole === 'header' ? fs >= 15 : fs >= 20)
  return (
    <Text numberOfLines={numberOfLines} selectable={selectable} accessibilityRole={accessibilityRole ?? (onPress ? 'link' : undefined)} onPress={onPress} maxFontSizeMultiplier={1.6}
      style={[{ color: color || (muted ? c.muted : faint ? c.faint : c.text), fontSize: fs, lineHeight: Math.round(fs * 1.38) },
        bold && !heading && { fontWeight: '600' },
        heading && { fontFamily: fs >= 24 ? HEADING.black : HEADING.bold, fontWeight: 'normal', letterSpacing: fs >= 22 ? -0.03 * fs : 0 },
        center && { textAlign: 'center' }, style]}>
      {children}
    </Text>
  )
}

export const H1 = ({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) =>
  <Txt size={26} bold accessibilityRole="header" style={style}>{children}</Txt>
export const H2 = ({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) =>
  <Txt size={18} bold accessibilityRole="header" style={style}>{children}</Txt>
export const Label = ({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) => {
  const { c } = useTheme()
  return <Txt size={12} bold color={c.muted} style={[{ textTransform: 'uppercase', letterSpacing: 0.5 }, style]}>{children}</Txt>
}

type BtnKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink' | 'destructive'
export function Button({ title, onPress, kind = 'secondary', icon, disabled, loading, small, style, accessibilityLabel, flex }:
  { title?: string; onPress?: () => void | Promise<unknown>; kind?: BtnKind; icon?: IconName; disabled?: boolean; loading?: boolean
    small?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; flex?: boolean }) {
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  const bg = { primary: c.primary, secondary: c.surface, ghost: 'transparent', danger: 'transparent', ink: c.ink, destructive: c.danger }[kind]
  const fg = { primary: c.onPrimary, secondary: c.text, ghost: c.primary, danger: c.danger, ink: c.onInk, destructive: c.bg }[kind]
  const off = disabled || loading || busy
  const press = async () => {
    if (off || !onPress) return
    Haptics.selectionAsync().catch(() => {})
    const r = onPress()
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      setBusy(true)
      try { await r } catch { /* l'écran affiche l'erreur */ } finally { setBusy(false) }
    }
  }
  return (
    <Pressable onPress={press} disabled={off} accessibilityRole="button" accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: !!off, busy: loading || busy }}
      style={({ pressed }) => [{
        minHeight: small ? 40 : 48, paddingHorizontal: title ? (small ? 12 : 16) : 0, minWidth: title ? undefined : (small ? 40 : 48),
        borderRadius: radius.md, backgroundColor: kind === 'primary' && pressed && !off ? c.primaryPressed : bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        borderWidth: kind === 'secondary' ? StyleSheet.hairlineWidth * 2 : 0, borderColor: c.borderStrong,
        opacity: off && !loading && !busy ? 0.45 : pressed && kind !== 'primary' ? 0.7 : 1,
      }, flex && { flex: 1 }, style]}>
      {loading || busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={small ? 18 : 20} color={fg} /> : null}
      {title ? <Txt bold color={fg} size={small ? 14 : 15} numberOfLines={1}>{title}</Txt> : null}
    </Pressable>
  )
}

export function IconButton({ icon, label, onPress, color, size = 44 }: { icon: IconName; label: string; onPress: () => void; color?: string; size?: number }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: size / 2, opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={22} color={color || c.text} />
    </Pressable>
  )
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const { c } = useTheme()
  const base: ViewStyle = { backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }
  if (!onPress) return <View style={[base, style]}>{children}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, { opacity: pressed ? 0.75 : 1 }, style]}>{children}</Pressable>
  )
}

export function Row({ children, style, gap = space.sm, wrap }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>
}

export function Divider() {
  const { c } = useTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
}

export function Chip({ label, selected, onPress, icon, color, left }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName; color?: string; left?: ReactNode }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => ({
        minHeight: 36, paddingHorizontal: 12, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: selected ? c.ink : c.surface, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: selected ? c.ink : c.borderStrong,
        opacity: pressed ? 0.7 : 1,
      })}>
      {left}
      {icon ? <Icon name={icon} size={16} color={selected ? c.onInk : color || c.text} /> : null}
      <Txt small bold={selected} color={selected ? c.onInk : color || c.text} numberOfLines={1}>{label}</Txt>
    </Pressable>
  )
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  const { c } = useTheme()
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label}
      style={{ flexDirection: 'row', backgroundColor: c.surface2, borderRadius: radius.md, padding: 3, gap: 3 }}>
      {options.map(([v, l]) => {
        const on = v === value
        return (
          <Pressable key={String(v)} onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(v) }} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
              backgroundColor: on ? c.surface : 'transparent', borderWidth: on ? StyleSheet.hairlineWidth : 0, borderColor: c.border }}>
            <Txt small bold={on} color={on ? c.text : c.muted} numberOfLines={1}>{l}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Field({ label, hint, error, style, multiline, ...props }: TextInputProps & { label?: string; hint?: string; error?: string | null; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Txt small bold>{label}</Txt> : null}
      <TextInput placeholderTextColor={c.faint} accessibilityLabel={label} multiline={multiline} maxFontSizeMultiplier={1.6}
        {...props}
        style={{ minHeight: multiline ? 110 : 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: error ? c.danger : c.borderStrong, backgroundColor: c.surface, color: c.text, fontSize: 16,
          paddingHorizontal: 12, paddingVertical: multiline ? 10 : 0, textAlignVertical: multiline ? 'top' : 'center' }} />
      {error ? <Txt small color={c.danger}>{error}</Txt> : hint ? <Txt small muted>{hint}</Txt> : null}
    </View>
  )
}

export function SearchField({ value, onChangeText, placeholder, autoFocus }: { value: string; onChangeText: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderRadius: radius.md, paddingHorizontal: 12,
      backgroundColor: c.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
      <Icon name="search" size={18} color={c.muted} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder || 'Rechercher'} placeholderTextColor={c.faint}
        autoFocus={autoFocus} returnKeyType="search" clearButtonMode="while-editing" autoCorrect={false} accessibilityLabel={placeholder || 'Rechercher'}
        style={{ flex: 1, color: c.text, fontSize: 16, paddingVertical: 8 }} />
      {value && RNPlatform.OS === 'android' ? <IconButton icon="close" label="Effacer" onPress={() => onChangeText('')} size={36} /> : null}
    </View>
  )
}

export function Msg({ kind = 'info', children }: { kind?: 'err' | 'info' | 'ok' | 'warn'; children: ReactNode }) {
  const { c } = useTheme()
  const bg = { err: c.dangerBg, info: c.infoBg, ok: c.okBg, warn: c.warnBg }[kind]
  const fg = { err: c.danger, info: c.text, ok: c.ok, warn: c.warn }[kind]
  return (
    <View accessibilityRole={kind === 'err' ? 'alert' : 'text'} style={{ backgroundColor: bg, borderRadius: radius.md, padding: space.md }}>
      {typeof children === 'string' ? <Txt small color={fg}>{children}</Txt> : children}
    </View>
  )
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  const { c } = useTheme()
  return <View style={{ padding: space.xl, alignItems: 'center', gap: 8 }} accessibilityLabel={label}><ActivityIndicator color={c.muted} /></View>
}

export function Skeleton({ h = 72, n = 1 }: { h?: number; n?: number }) {
  const { c } = useTheme()
  return <>{Array.from({ length: n }, (_, i) => <View key={i} style={{ height: h, borderRadius: radius.lg, backgroundColor: c.surface2 }} />)}</>
}

export function Empty({ title, icon = 'calendar', children, action, bare }: { title: string; icon?: IconName; children?: ReactNode; action?: ReactNode
  /** Sans carte : posé sur le fond (dans un cadre en pointillés, par exemple). */
  bare?: boolean }) {
  const { c } = useTheme()
  const Box = bare ? View : Card
  return (
    <Box style={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: bare ? space.lg : undefined, gap: bare ? space.md : undefined }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} color={c.muted} />
      </View>
      <Txt bold size={17} center>{title}</Txt>
      {typeof children === 'string' ? <Txt muted center small>{children}</Txt> : children}
      {action}
    </Box>
  )
}

export function PlatformTag({ platform, label }: { platform: Platform; label?: string | null }) {
  return <Row gap={6}><PlatformLogo platform={platform} size={16} /><Txt small numberOfLines={1}>{label ?? PLATFORM_LABEL[platform]}</Txt></Row>
}

export const groupHex = (color: GroupColor | string | null | undefined) => GROUP_HEX[color || 'slate'] || GROUP_HEX.slate

export function GroupDot({ color, size = 10 }: { color: GroupColor | null | undefined; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: groupHex(color) }} />
}

export function StatusText({ status }: { status: TargetStatus }) {
  const { c } = useTheme()
  const s = STATUS[status]
  const color = { ok: c.ok, warn: c.warn, danger: c.danger, muted: c.muted }[s.tone]
  return <Txt small bold color={color}>{s.label}</Txt>
}

export function Delta({ value, suffix = '' }: { value: number | null | undefined; suffix?: string }) {
  const { c } = useTheme()
  if (value == null) return null
  return <Txt small color={value > 0 ? c.ok : value < 0 ? c.danger : c.muted}>{signed(value)}{suffix}</Txt>
}

export function Avatar({ src, name, platform, size = 40 }: { src: string | null | undefined; name: string | null | undefined; platform?: Platform; size?: number }) {
  const { c } = useTheme()
  return (
    <View style={{ width: size, height: size }}>
      {src
        ? <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surface2 }} contentFit="cover" />
        : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Txt bold color={c.muted}>{(name || '?').replace('@', '').slice(0, 1).toUpperCase()}</Txt>
          </View>}
      {platform ? <View style={{ position: 'absolute', right: -3, bottom: -3, backgroundColor: c.surface, borderRadius: 8, padding: 1 }}>
        <PlatformLogo platform={platform} size={Math.max(12, size * 0.38)} /></View> : null}
    </View>
  )
}

/** Feuille qui monte du bas : glisser vers le bas (poignée, titre) ou toucher le fond pour fermer. */
export function Sheet({ visible, title, onClose, children, scroll = true, footer }:
  { visible: boolean; title: string; onClose: () => void; children: ReactNode; scroll?: boolean; footer?: ReactNode }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const drag = useRef(new Animated.Value(0)).current
  useEffect(() => { if (visible) drag.setValue(0) }, [visible, drag])
  const pan = usePanGesture({
    activeOffsetY: 8, failOffsetX: [-24, 24], runOnJS: true,
    onUpdate: e => { drag.setValue(Math.max(0, e.translationY)) },
    onDeactivate: e => {
      if (!e.canceled && (e.translationY > 110 || e.velocityY > 900)) {
        Animated.timing(drag, { toValue: 900, duration: 160, useNativeDriver: true }).start(() => onClose())
      } else {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start()
      }
    },
  })
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={RNPlatform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: c.overlay }} onPress={onClose} accessibilityLabel="Fermer" accessibilityRole="button" />
          <Animated.View accessibilityViewIsModal style={{ backgroundColor: c.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '92%',
            paddingBottom: footer ? 0 : insets.bottom + space.md, width: '100%', maxWidth: 720, alignSelf: 'center', transform: [{ translateY: drag }] }}>
            <GestureDetector gesture={pan}>
              <View>
                <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}><View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.borderStrong }} /></View>
                <Row style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, justifyContent: 'space-between' }}>
                  <H2 style={{ flex: 1 }}>{title}</H2>
                  <IconButton icon="close" label="Fermer" onPress={onClose} />
                </Row>
              </View>
            </GestureDetector>
            {scroll
              ? <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
              : <View style={{ paddingHorizontal: space.lg, gap: space.md, flexShrink: 1 }}>{children}</View>}
            {footer ? <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: c.surface }}>{footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  )
}

/** Écran défilant avec « tirer pour actualiser » et largeur limitée sur tablette. */
export function Screen({ children, onRefresh, refreshing = false, padded = true, footer, scrollRef }:
  { children: ReactNode; onRefresh?: () => void; refreshing?: boolean; padded?: boolean; footer?: ReactNode
    /** Pour faire défiler l'écran depuis la page (ex. vers une carte qui vient d'apparaître). */
    scrollRef?: Ref<ScrollViewInstance> }) {
  const { c } = useTheme()
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView ref={scrollRef} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.muted} /> : undefined}
        contentContainerStyle={{ padding: padded ? space.lg : 0, paddingBottom: 48, gap: space.md, width: '100%', maxWidth: 820, alignSelf: 'center' }}>
        {children}
      </ScrollView>
      {footer}
    </View>
  )
}

/** Valeur chiffrée avec libellé (tableau de bord, stats). */
export function Stat({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <View style={{ flex: 1, minWidth: 140, gap: 2 }}>
      <Txt small muted numberOfLines={1}>{label}</Txt>
      <Txt size={22} bold numberOfLines={1}>{value}</Txt>
      {sub}
    </View>
  )
}
