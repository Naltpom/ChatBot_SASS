// Planning : un jour à la fois (glisser à gauche / à droite pour changer de jour), bande des semaines qui glisse,
// recherche faite par le serveur, tirer pour actualiser. Passé : vidéos publiées (avec chiffres) ;
// futur : publications programmées. Comme cm/src/pages/Planning.tsx (vue Agenda).
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import { getCalendar, PLATFORM_LABEL, PLATFORMS, type Platform } from '../../lib/api'
import { short } from '../../lib/format'
import { useLoad, useRole, useSession } from '../../lib/session'
import { StartChecklist } from '../../features/StartChecklist'
import { AttentionBar } from '../../features/Attention'
import { ExampleWeek } from '../../features/ExampleWeek'
import { Button, Chip, Delta, Empty, Msg, PlatformLogo, Row, SearchField, Skeleton, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import {
  byDay, dayKey, filterItems, fromKey, groupItems, groupOf, openTarget, periodSummary, searchRange, searchSections,
  shiftKey, weekKeys, weekRange, type PlanGroup,
} from '../../features/planning/calendar'
import { PlanRow } from '../../features/planning/ui'

type ListRow = { type: 'head'; day: string } | { type: 'row'; g: PlanGroup }

const longDay = (k: string) => fromKey(k).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

export default function Planning() {
  const { c } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ day?: string; flash?: string; t?: string }>()
  const { groups, accounts } = useSession()
  const { canEdit } = useRole()
  const today = dayKey(new Date())
  const [selected, setSelected] = useState(today)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [flash, setFlash] = useState<string | null>(null)
  // Retour de « Nouvelle publication » : le jour programmé et un message.
  useEffect(() => {
    if (params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day)) setSelected(params.day)
    if (params.flash) setFlash(params.flash)
  }, [params.day, params.flash, params.t])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 6000); return () => clearTimeout(t) }, [flash])

  // Semaine du jour choisi (la bande des 7 jours a ses points).
  const week = useMemo(() => weekKeys(selected), [selected])
  const weekStart = week[0]
  const cal = useLoad(s => { const [a, b] = weekRange(weekStart); return getCalendar(s, a, b) }, [weekStart], 'planning-week')

  // Recherche (titre, légende) faite par le serveur, sur environ un an en arrière et six mois devant.
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => { const t = setTimeout(() => setSearch(input.trim()), 300); return () => clearTimeout(t) }, [input])
  const found = useLoad(s => { if (!search) return Promise.resolve(null); const [a, b] = searchRange(); return getCalendar(s, a, b, search) }, [search], 'planning-search')

  // Retour sur l'onglet (fiche modifiée, publication programmée) : relu sans bloquer l'affichage.
  const first = useRef(true)
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return }
    cal.reload()
  }, [])) // eslint-disable-line react-hooks/exhaustive-deps

  const [pulling, setPulling] = useState(false)
  useEffect(() => { if (!cal.loading && !found.loading) setPulling(false) }, [cal.loading, found.loading])
  const refresh = () => { setPulling(true); cal.reload(); if (search) found.reload() }

  const items = useMemo(() => filterItems(cal.data?.items || [], platforms, 'all'), [cal.data, platforms])
  const days = useMemo(() => byDay(items), [items])
  const stats = useMemo(() => new Map((cal.data?.days || []).map(d => [d.day, d])), [cal.data])
  const dayGroups = useMemo(() => groupItems(days.get(selected) || []), [days, selected])
  const results = useMemo(() => (search && found.data ? searchSections(filterItems(found.data.items, platforms, 'all')) : []), [search, found.data, platforms])
  const summary = useMemo(() => periodSummary(items), [items])
  const weekFollowers = (cal.data?.days || []).reduce((s, d) => s + (d.followers_delta || 0), 0)

  // Un glissé commencé sur la bande des semaines fait défiler les semaines, pas les jours.
  const onStrip = useRef(false)
  const goDay = (n: number) => { Haptics.selectionAsync().catch(() => {}); setSelected(k => shiftKey(k, n)) }
  const pan = usePanGesture({
    activeOffsetX: [-24, 24], failOffsetY: [-14, 14], runOnJS: true,
    onDeactivate: e => { if (!e.canceled && !onStrip.current && Math.abs(e.translationX) > 60) goDay(e.translationX < 0 ? 1 : -1) },
    onFinalize: () => { onStrip.current = false },
  })
  const open = (g: PlanGroup) => {
    const t = openTarget(g)
    if (t) router.push({ pathname: t.pathname, params: { id: t.id } })
  }
  // Filtre par réseau : seulement si au moins 2 types de réseaux sont connectés.
  const connected = useMemo(() => PLATFORMS.filter(p => accounts.some(a => a.platform === p)), [accounts])
  useEffect(() => { setPlatforms(ps => ps.filter(p => connected.includes(p))) }, [connected])
  const togglePlatform = (p: Platform) => setPlatforms(ps => (ps.includes(p) ? ps.filter(x => x !== p) : [...ps, p]))

  const rows: ListRow[] = search
    ? results.flatMap(s => [{ type: 'head' as const, day: s.day }, ...s.groups.map(g => ({ type: 'row' as const, g }))])
    : dayGroups.map(g => ({ type: 'row' as const, g }))
  const isPast = selected < today
  const dayStats = stats.get(selected)
  const title = selected === today ? `Aujourd’hui ${fromKey(selected).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
    : fromKey(selected).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }).replace(/^./, x => x.toUpperCase())

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      {flash ? (
        <Msg kind="ok">{flash}{canEdit ? <Txt bold color={c.primary} onPress={() => router.push('/new')}>{'  '}Planifier la suivante →</Txt> : null}</Msg>
      ) : null}
      {!search ? <AttentionBar /> : null}
      {!search ? <StartChecklist /> : null}
      <SearchField value={input} onChangeText={setInput} placeholder="Rechercher (titre, légende)" />
      {connected.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel="Réseaux">
          {connected.map(p => (
            <Chip key={p} label={PLATFORM_LABEL[p]} selected={platforms.includes(p)} onPress={() => togglePlatform(p)}
              left={<PlatformLogo platform={p} size={14} />} />
          ))}
        </ScrollView>
      ) : null}
      {!search ? (
        <>
          <WeekStrip touchRef={onStrip} selected={selected} today={today} counts={k => groupItems(days.get(k) || []).length}
            onSelect={k => { Haptics.selectionAsync().catch(() => {}); setSelected(k) }} />
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt bold size={18} accessibilityRole="header">{title}</Txt>
              <Row gap={10} wrap>
                <Txt small muted>{dayGroups.length ? `${dayGroups.length} vidéo${dayGroups.length > 1 ? 's' : ''}` : isPast ? 'Aucune publication' : 'Rien de prévu'}</Txt>
                {dayStats?.followers_delta ? <Row gap={4}><Delta value={dayStats.followers_delta} /><Txt small muted>abonnés</Txt></Row> : null}
              </Row>
            </View>
            {selected !== today ? <Button small kind="ghost" icon="calendar" title="Aujourd’hui" onPress={() => setSelected(today)} /> : null}
          </Row>
          {cal.data ? (
            <Txt small muted>
              Semaine : {summary.done} publiée{summary.done > 1 ? 's' : ''}{summary.views ? ` · ${short(summary.views)} vues` : ''}
              {weekFollowers ? ` · ${weekFollowers > 0 ? '+' : ''}${short(weekFollowers)} abonnés` : ''} · {summary.planned} programmée{summary.planned > 1 ? 's' : ''}
            </Txt>
          ) : null}
        </>
      ) : (
        <Txt small muted accessibilityRole="text">
          {found.data ? (results.length ? `${results.reduce((n, s) => n + s.groups.length, 0)} vidéo(s) pour « ${search} »` : `Aucune vidéo pour « ${search} »`) : 'Recherche…'}
        </Txt>
      )}
      {cal.error && !search ? <Msg kind="err">{cal.error}</Msg> : null}
      {found.error && search ? <Msg kind="err">{found.error}</Msg> : null}
    </View>
  )

  const empty = search
    ? (found.loading && !found.data ? <View style={{ gap: space.sm }}><Skeleton h={72} n={3} /></View> : undefined)
    : !cal.data && cal.loading ? <View style={{ gap: space.sm }}><Skeleton h={72} n={3} /></View>
    : !isPast && canEdit && summary.planned + summary.done === 0 ? <ExampleWeek canEdit={canEdit} /> : (
      <View style={{ flex: 1, minHeight: 260, justifyContent: 'center', borderRadius: radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: c.border }}>
      <Empty title={isPast ? 'Aucune publication ce jour-là' : 'Rien de prévu ce jour-là'} icon="calendar"
        action={!isPast && canEdit ? <Button kind="primary" icon="plus" title="Planifier une vidéo" onPress={() => router.push('/new')} /> : undefined}>
        {isPast ? 'Les vidéos publiées sur vos comptes apparaissent ici après le relevé des chiffres.' : 'Planifiez une vidéo : elle partira toute seule à l’heure choisie, sur chaque compte.'}
      </Empty>
      </View>
    )

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <FlatList
          data={rows}
          keyExtractor={r => (r.type === 'head' ? `h-${r.day}` : r.g.key)}
          renderItem={({ item: r }) => r.type === 'head'
            ? <Txt bold size={15} style={{ marginTop: space.sm }} accessibilityRole="header">
                {fromKey(r.day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
              </Txt>
            : <PlanRow g={r.g} group={groupOf(r.g.items, groups)} onPress={() => open(r.g)} />}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
          contentContainerStyle={{ flexGrow: 1, padding: space.lg, paddingBottom: 48, width: '100%', maxWidth: 820, alignSelf: 'center' }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={c.muted} />}
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews
          style={StyleSheet.absoluteFill}
        />
      </View>
    </GestureDetector>
  )
}


/** Bande des jours : une page par semaine, qui glisse et se cale (comme un carrousel de photos). */
function WeekStrip({ touchRef, selected, today, counts, onSelect }: {
  touchRef: { current: boolean }; selected: string; today: string; counts: (k: string) => number; onSelect: (k: string) => void
}) {
  const { c } = useTheme()
  const { width: win } = useWindowDimensions()
  const [w, setW] = useState(Math.min(win, 820) - space.lg * 2)
  const ref = useRef<ScrollViewInstance>(null)
  const start = weekKeys(selected)[0]
  // Trois pages : semaine d'avant, semaine choisie, semaine d'après. On revient au centre après chaque glissé.
  const pages = [shiftKey(start, -7), start, shiftKey(start, 7)]
  useEffect(() => { ref.current?.scrollTo({ x: w, animated: false }) }, [start, w])
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / w)
    if (i === 1) return
    const day = (new Date(fromKey(selected)).getDay() + 6) % 7
    onSelect(shiftKey(pages[i], day))
  }
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} accessibilityLabel="Jours de la semaine"
      onTouchStart={() => { touchRef.current = true }}>
      <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} decelerationRate="fast"
        contentOffset={{ x: w, y: 0 }} onMomentumScrollEnd={onEnd}>
        {pages.map(p => (
          <View key={p} style={{ width: w, flexDirection: 'row', gap: 4 }}>
            {weekKeys(p).map(k => {
              const d = fromKey(k), on = k === selected, n = counts(k)
              return (
                <Pressable key={k} onPress={() => onSelect(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${longDay(k)}, ${n ? `${n} vidéo${n > 1 ? 's' : ''}` : 'rien'}${k === today ? ', aujourd’hui' : ''}`}
                  style={{ flex: 1, minHeight: 58, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', gap: 1,
                    backgroundColor: on ? c.ink : 'transparent', borderWidth: k === today && !on ? 1.5 : 0, borderColor: c.primary }}>
                  <Txt size={12} color={on ? c.onInk : c.muted}>{d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}</Txt>
                  <Txt bold size={17} color={on ? c.onInk : c.text}>{d.getDate()}</Txt>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: n ? (on ? c.onInk : c.primary) : 'transparent' }} />
                </Pressable>
              )
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
