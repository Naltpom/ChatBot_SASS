// Briques d'interface des écrans Commentaires, Stats, Vidéos et Fiche vidéo.
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import type { Platform, Video } from '../../lib/api'
import { fmtDate, short } from '../../lib/format'
import { Chip, Icon, PlatformLogo, Row, Sheet, Txt, type IconName } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import type { ListState } from './hooks'
import { sortLabel } from './logic'

/** Rangée de puces qui défile à l'horizontale (filtres, tris). */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={label}
      contentContainerStyle={{ gap: space.sm, paddingVertical: 2 }} style={{ flexGrow: 0 }}>
      {children}
    </ScrollView>
  )
}

/** Tri : une puce par critère ; toucher le critère choisi inverse le sens. */
export function SortChips<S extends string>({ list, options }: { list: ListState<S>; options: [S, string][] }) {
  return (
    <ChipRow label="Trier par">
      {options.map(([s, l]) => (
        <Chip key={s} label={sortLabel(l, list.sort === s, list.order)} selected={list.sort === s} onPress={() => list.pick(s)} />
      ))}
    </ChipRow>
  )
}

/** Puces Toutes / TikTok / YouTube / Instagram. */
export function PlatformChips({ value, onChange, platforms }: { value: '' | Platform; onChange: (p: '' | Platform) => void; platforms: Platform[] }) {
  const LABEL: Record<Platform, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' }
  return (
    <ChipRow label="Plateforme">
      <Chip label="Toutes" selected={value === ''} onPress={() => onChange('')} />
      {platforms.map(p => <Chip key={p} label={LABEL[p]} selected={value === p} onPress={() => onChange(p)} left={<PlatformLogo platform={p} size={14} />} />)}
    </ChipRow>
  )
}

export interface MenuItem { label: string; onPress: () => void; danger?: boolean; icon?: IconName }

/** Menu « … » : une feuille avec une ligne par action. */
export function ActionMenu({ visible, title, items, onClose }: { visible: boolean; title: string; items: MenuItem[]; onClose: () => void }) {
  const { c } = useTheme()
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' }}>
        {items.map((it, i) => (
          <Pressable key={it.label} accessibilityRole="button" accessibilityLabel={it.label}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onClose(); setTimeout(it.onPress, 250) }}
            style={({ pressed }) => ({ minHeight: 52, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md,
              borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: c.border, opacity: pressed ? 0.6 : 1 })}>
            {it.icon ? <Icon name={it.icon} size={20} color={it.danger ? c.danger : c.text} /> : null}
            <Txt color={it.danger ? c.danger : c.text}>{it.label}</Txt>
          </Pressable>
        ))}
      </View>
    </Sheet>
  )
}

/** Vignette d'une vidéo (ou un fond neutre). */
export function Thumb({ uri, w, h }: { uri: string | null | undefined; w: number; h: number }) {
  const { c } = useTheme()
  return uri
    ? <Image source={{ uri }} style={{ width: w, height: h, borderRadius: 10, backgroundColor: c.surface2 }} contentFit="cover" accessibilityIgnoresInvertColors />
    : <View style={{ width: w, height: h, borderRadius: 10, backgroundColor: c.surface2 }} />
}

/** Chiffres d'une vidéo en ligne : vues, j'aime, commentaires, partages, enregistrements. */
export function Metrics({ v }: { v: Pick<Video, 'views' | 'likes' | 'comments' | 'shares' | 'saves'> }) {
  const { c } = useTheme()
  const parts: [IconName, number | null, string][] = [['eye', v.views, 'vues'], ['heart', v.likes, 'j’aime']]
  if (v.comments != null) parts.push(['comment', v.comments, 'commentaires'])
  if (v.shares != null) parts.push(['share', v.shares, 'partages'])
  if (v.saves != null) parts.push(['bookmark', v.saves, 'enregistrements'])
  return (
    <Row gap={10} wrap>
      {parts.map(([icon, n, what]) => (
        <View key={icon} accessible accessibilityLabel={`${short(n)} ${what}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Icon name={icon} size={13} color={c.muted} /><Txt small bold>{short(n)}</Txt>
        </View>
      ))}
    </Row>
  )
}

/** Point de couleur de la plateforme. */
export function PlatformDot({ platform }: { platform: Platform }) {
  const { c } = useTheme()
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c[platform] }} />
}

/** Une vidéo en liste (Vidéos, Stats). */
export function VideoRow({ v, onPress, rank }: { v: Video; onPress?: () => void; rank?: number }) {
  const { c } = useTheme()
  const body = (
    <>
      <Thumb uri={v.thumbnail_url} w={56} h={76} />
      <View style={{ flex: 1, gap: 4 }}>
        <Txt bold numberOfLines={2}>{rank ? `#${rank} ` : ''}{v.title || 'Sans titre'}</Txt>
        <Row gap={6}>
          <PlatformDot platform={v.platform} />
          <Txt small muted numberOfLines={1} style={{ flexShrink: 1 }}>{v.account_name}</Txt>
          <Txt small muted>· {v.published_at ? fmtDate(v.published_at) : '—'}</Txt>
        </Row>
        <Metrics v={v} />
      </View>
      {onPress ? <Icon name="right" size={18} color={c.faint} /> : null}
    </>
  )
  const style = { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: space.md, paddingVertical: space.md }
  if (!onPress) return <View style={style}>{body}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${v.title || 'Sans titre'}, ${v.account_name || ''}, ${short(v.views)} vues`}
      style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}>
      {body}
    </Pressable>
  )
}

/** Ligne d'en-tête de section : titre et lien à droite. */
export function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { c } = useTheme()
  return (
    <Row style={{ justifyContent: 'space-between', minHeight: 44 }}>
      <Txt size={18} bold accessibilityRole="header" style={{ flex: 1 }}>{title}</Txt>
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="link" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
          <Txt bold color={c.accent}>{action}</Txt>
        </Pressable>
      ) : null}
    </Row>
  )
}
