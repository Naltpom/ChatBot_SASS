// Petits composants du planning et de la nouvelle publication (ligne, pastille, cases, date et heure).
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import * as Haptics from 'expo-haptics'
import type { ReactNode } from 'react'
import { Platform as RNPlatform, Pressable, StyleSheet, View } from 'react-native'
import { PLATFORM_LABEL, type CalendarItem, type Group } from '../../lib/api'
import { fmtTime, short } from '../../lib/format'
import { Card, Icon, PlatformLogo, Row, Txt, groupHex } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { pillOf, rowLabel, rowNote, rowSide, shortTitle, type Pill, type PlanGroup } from './calendar'

const label = (p: CalendarItem['platform']) => PLATFORM_LABEL[p]

/** Pastille d'une plateforme : plein = publiée, pointillé = programmée, rouge = échec, orange pointillé = brouillon TikTok. */
export function PlatformPill({ item, pill, withLabel = true }: { item: CalendarItem; pill?: Pill; withLabel?: boolean }) {
  const { c } = useTheme()
  const p = pill || pillOf(item)
  const color = p === 'failed' ? c.danger : p === 'draft' ? c.warn : p === 'planned' ? c.muted : c.text
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: withLabel ? 8 : 4, height: 26, borderRadius: 999,
      borderWidth: 1.5, borderStyle: p === 'planned' || p === 'draft' ? 'dashed' : 'solid', borderColor: color, backgroundColor: c.surface }}>
      <PlatformLogo platform={item.platform} size={14} />
      {withLabel ? <Txt size={12} bold color={color} numberOfLines={1}>{label(item.platform)}</Txt> : null}
    </View>
  )
}

/** Œuvre protégée ou droits inconnus sur une des publications de la ligne. */
const risky = (g: PlanGroup) => g.items.some(i => i.kind === 'target' && (i.rights === 'protected' || i.rights === 'unknown'))

/** Une ligne du planning : heure, titre, pastilles, bordure gauche à la couleur du groupe. */
export function PlanRow({ g, group, onPress }: { g: PlanGroup; group: Group | null; onPress: () => void }) {
  const { c } = useTheme()
  const title = shortTitle(g.title) || 'Sans titre'
  const side = rowSide(g, short)
  const note = rowNote(g, label)
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress() }} accessibilityRole="button"
      accessibilityLabel={rowLabel(g, fmtTime(g.at), label, group?.name)} accessibilityHint="Ouvre le détail"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: space.md,
        paddingLeft: space.md, paddingRight: space.md, backgroundColor: pressed ? c.surface2 : c.surface, borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.border, borderLeftWidth: 5, borderLeftColor: group ? groupHex(group.color) : c.borderStrong })}>
      <Txt bold size={14} style={{ width: 46, fontVariant: ['tabular-nums'] }}>{fmtTime(g.at)}</Txt>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Txt bold numberOfLines={1}>{risky(g) ? '⚠️ ' : ''}{title}</Txt>
        <Row gap={5} wrap>{g.items.map(i => <PlatformPill key={`${i.kind}-${i.id}`} item={i} />)}</Row>
        {note ? <Txt size={12} color={note.tone === 'danger' ? c.danger : c.warn} numberOfLines={2}>{note.text}</Txt> : null}
      </View>
      {side.text ? <Txt size={12} bold={side.err} color={side.err ? c.danger : c.muted} style={{ maxWidth: 84, textAlign: 'right' }}>{side.text}</Txt> : null}
      <Icon name="right" size={16} color={c.faint} />
    </Pressable>
  )
}

/** Carte avec un titre (sections de la nouvelle publication). */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt bold size={17} accessibilityRole="header">{title}</Txt>
        {typeof aside === 'string' ? <Txt small muted numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>{aside}</Txt> : aside}
      </Row>
      {children}
    </Card>
  )
}

/** Case à cocher (ou bouton radio) tactile, 44 px au moins. */
export function Check({ label: text, checked, onChange, disabled, hint, radio }:
  { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string; radio?: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={() => { if (disabled) return; Haptics.selectionAsync().catch(() => {}); onChange(radio ? true : !checked) }} disabled={disabled}
      accessibilityRole={radio ? 'radio' : 'checkbox'} accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={typeof text === 'string' ? text : undefined} accessibilityHint={hint}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: 44, paddingVertical: 10, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}>
      <View style={{ width: 22, height: 22, borderRadius: radio ? 11 : 6, marginTop: 1, borderWidth: 2, borderColor: checked ? c.primary : c.borderStrong,
        backgroundColor: checked && !radio ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked ? (radio ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary }} />
          : <Icon name="check" size={14} color={c.onPrimary} strokeWidth={3} />) : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {typeof text === 'string' ? <Txt>{text}</Txt> : text}
        {hint ? <Txt small muted>{hint}</Txt> : null}
      </View>
    </Pressable>
  )
}

/** Choix parmi quelques valeurs, en pastilles (remplace un <select>). */
export function Choice<T extends string>({ label: text, value, options, onChange, disabled, isDisabled }:
  { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean; isDisabled?: (v: T) => boolean }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={text}>
      <Txt small bold>{text}</Txt>
      <Row gap={8} wrap>
        {options.map(([v, l]) => {
          const on = v === value, off = disabled || !!isDisabled?.(v)
          return (
            <Pressable key={v} onPress={() => { if (off) return; Haptics.selectionAsync().catch(() => {}); onChange(v) }} disabled={off}
              accessibilityRole="radio" accessibilityState={{ checked: on, disabled: off }} accessibilityLabel={l}
              style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: radius.md, justifyContent: 'center',
                backgroundColor: on ? c.ink : c.surface, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: on ? c.ink : c.borderStrong,
                opacity: off ? 0.4 : pressed ? 0.7 : 1 })}>
              <Txt small bold={on} color={on ? c.onInk : c.text}>{l}</Txt>
            </Pressable>
          )
        })}
      </Row>
    </View>
  )
}

const fmtDay = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtHour = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Jour et heure : sélecteurs compacts sur iOS, boîtes de dialogue sur Android. */
export function DateTimeField({ label: text, value, onChange, disabled, minimumDate }:
  { label?: string; value: Date; onChange: (d: Date) => void; disabled?: boolean; minimumDate?: Date }) {
  const { c, dark } = useTheme()
  if (RNPlatform.OS === 'ios') {
    return (
      <View style={{ gap: 6 }}>
        {text ? <Txt small bold>{text}</Txt> : null}
        <Row gap={8} style={{ opacity: disabled ? 0.45 : 1 }} >
          <DateTimePicker value={value} mode="date" display="compact" locale="fr-FR" minimumDate={minimumDate} disabled={disabled}
            themeVariant={dark ? 'dark' : 'light'} accentColor={c.primary} accessibilityLabel={`${text || 'Date'} : jour`}
            onValueChange={(_, d) => onChange(merge(value, d, 'date'))} />
          <DateTimePicker value={value} mode="time" display="compact" locale="fr-FR" minuteInterval={5} disabled={disabled}
            themeVariant={dark ? 'dark' : 'light'} accentColor={c.primary} accessibilityLabel={`${text || 'Date'} : heure`}
            onValueChange={(_, d) => onChange(merge(value, d, 'time'))} />
        </Row>
      </View>
    )
  }
  const open = (mode: 'date' | 'time') => {
    if (disabled) return
    DateTimePickerAndroid.open({ value, mode, is24Hour: true, minimumDate: mode === 'date' ? minimumDate : undefined,
      onValueChange: (_, d) => onChange(merge(value, d, mode)) })
  }
  const btn = (mode: 'date' | 'time', txt: string, icon: 'calendar' | 'clock') => (
    <Pressable onPress={() => open(mode)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${mode === 'date' ? 'Jour' : 'Heure'} : ${txt}`}
      style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.borderStrong,
        backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}>
      <Icon name={icon} size={18} color={c.muted} /><Txt>{txt}</Txt>
    </Pressable>
  )
  return (
    <View style={{ gap: 6 }}>
      {text ? <Txt small bold>{text}</Txt> : null}
      <Row gap={8}>{btn('date', fmtDay(value), 'calendar')}{btn('time', fmtHour(value), 'clock')}</Row>
    </View>
  )
}

function merge(base: Date, picked: Date | undefined, part: 'date' | 'time'): Date {
  if (!picked) return base
  const d = new Date(base)
  if (part === 'date') d.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate())
  else d.setHours(picked.getHours(), picked.getMinutes(), 0, 0)
  return d
}
