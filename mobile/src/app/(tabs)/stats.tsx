// Stats, dans l'ordre de lecture : un résumé en une phrase et 3 chiffres, l'audience (courbe), ce qui marche
// (vidéos, réseaux, meilleurs moments), la fiabilité des publications à part, puis le détail par compte.
// Comme cm/src/pages/Dashboard.tsx et cm/src/pages/Stats.tsx ; recherche et tri des comptes par l'API.
import { useRouter } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import {
  getAccounts, getOverview, getStats, getVideos, syncAccount, PLATFORM_LABEL,
  type Account, type AccountStats, type Metric, type Platform, type PlatformStats,
} from '../../lib/api'
import { METRIC_LABEL, num, pct, short, signed } from '../../lib/format'
import { useLoad, useSession } from '../../lib/session'
import {
  Avatar, Button, Card, Chip, Delta, Divider, Empty, Icon, Msg, PlatformLogo, Row, Screen, SearchField, Seg, Skeleton, Txt,
} from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { Heatmap } from '../../features/insights/Heatmap'
import { useListState } from '../../features/insights/hooks'
import { accountState, share } from '../../features/insights/logic'
import { ChipRow, Metrics, SectionHead, SortChips, Thumb } from '../../features/insights/parts'
import { ViewsChart } from '../../features/insights/ViewsChart'
import { t } from '../../lib/i18n'

const videosText = (n: number) => (n > 1 ? t('{n} vidéos', { n }) : t('{n} vidéo', { n }))

/** Phrase de résumé de la période (comme periodSentence de logic.ts, dans la langue choisie). */
function periodText(days: number, tot: { posts: number; views: number | null; followers_delta: number | null }, networks: number): string {
  const head = days === 365 ? t('Cette année') : t('Ces {n} derniers jours', { n: days })
  if (!tot.posts) return t('{head} : aucune vidéo publiée pour l’instant.', { head })
  const first = tot.posts > 1 ? t('{n} vidéos publiées', { n: tot.posts }) : t('{n} vidéo publiée', { n: tot.posts })
  const parts = [networks > 1 ? `${first} ${t('sur {n} réseaux', { n: networks })}` : first]
  if (tot.views != null) parts.push(t('{n} vues', { n: short(tot.views) }))
  if (tot.followers_delta) parts.push(t('{n} abonnés', { n: `${tot.followers_delta > 0 ? '+' : '−'}${short(Math.abs(tot.followers_delta))}` }))
  return t('{head} : {parts}.', { head, parts: parts.join(', ') })
}

type AccSort = 'views' | 'posts' | 'engagement_rate' | 'followers' | 'followers_delta' | 'likes' | 'name'
const ACC_SORTS: [AccSort, string][] = [['views', 'Vues'], ['followers', 'Abonnés'], ['followers_delta', 'Abonnés gagnés'],
  ['engagement_rate', 'Engagement'], ['posts', 'Vidéos'], ['likes', 'J’aime'], ['name', 'Nom']]
type TopSort = 'views' | 'engagement' | 'likes' | 'comments' | 'shares'
const TOP_SORTS: [TopSort, string][] = [['views', 'Les plus vues'], ['engagement', 'Plus d’interactions'], ['likes', 'Plus de j’aime'],
  ['comments', 'Plus commentées'], ['shares', 'Plus partagées']]

/** Un chiffre dans une rangée (pas de carte vide autour). */
function Figure({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }} accessible accessibilityLabel={t('{label} : {value}', { label, value })}>
      <Txt size={22} bold numberOfLines={1}>{value}</Txt>
      <Txt small muted numberOfLines={1}>{label}</Txt>
      {typeof sub === 'string' ? <Txt size={12} muted numberOfLines={1}>{sub}</Txt> : sub}
    </View>
  )
}

/** Une ligne par réseau : part des vues (barre), abonnés gagnés, engagement. */
function PlatformLine({ p, totalViews }: { p: PlatformStats; totalViews: number | null }) {
  const { c } = useTheme()
  const part = share(p.views, totalViews)
  return (
    <View style={{ gap: 6, paddingVertical: space.sm }} accessible
      accessibilityLabel={`${PLATFORM_LABEL[p.platform]} : ${t('{n} vues', { n: short(p.views) })}${totalViews ? `, ${t('{n} % du total', { n: part })}` : ''}, ${videosText(p.posts)}, ${t('engagement {rate}', { rate: pct(p.engagement_rate) })}`}>
      <Row gap={space.sm}>
        <PlatformLogo platform={p.platform} size={22} />
        <Txt bold style={{ flex: 1 }} numberOfLines={1}>{PLATFORM_LABEL[p.platform]}</Txt>
        <Txt bold>{short(p.views)}</Txt><Txt small muted>{t('vues')}</Txt>
      </Row>
      {totalViews ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface2, overflow: 'hidden' }}>
          <View style={{ width: `${part}%`, height: 6, backgroundColor: c[p.platform] }} />
        </View>
      ) : null}
      <Txt small muted numberOfLines={1}>
        {videosText(p.posts)} · {t('{rate} d’engagement', { rate: pct(p.engagement_rate) })}{p.followers_delta != null ? ` · ${t('{n} abonnés', { n: signed(p.followers_delta) })}` : ''}
      </Txt>
    </View>
  )
}

function AccountRow({ a, state }: { a: AccountStats; state?: Account }) {
  const { c } = useTheme()
  const st = state ? accountState(state) : null
  const tone = st ? { ok: c.ok, warn: c.warn, danger: c.danger, muted: c.muted }[st.tone] : c.muted
  return (
    <View accessible accessibilityLabel={`${a.name || PLATFORM_LABEL[a.platform]}${st ? `, ${t(st.label)}` : ''}. ${t('{n} vues', { n: short(a.views) })}, ${videosText(a.posts)}, ${t('engagement {rate}', { rate: pct(a.engagement_rate) })}. ${a.stats_available ? t('{n} abonnés', { n: short(a.followers) }) : t('abonnés non fournis')}${a.followers_delta != null ? `, ${signed(a.followers_delta)}` : ''}.`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md }}>
      <Avatar src={a.avatar_url} name={a.name} platform={a.platform} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt bold numberOfLines={1}>{a.name || PLATFORM_LABEL[a.platform]}</Txt>
        {st && st.tone !== 'ok' ? <Txt small color={tone}>{t(st.label)}</Txt> : null}
        <Txt small muted numberOfLines={1}>{t('{n} vues', { n: short(a.views) })} · {videosText(a.posts)} · {pct(a.engagement_rate)}</Txt>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt bold>{a.stats_available ? short(a.followers) : '—'}</Txt>
        {a.followers_delta != null ? <Delta value={a.followers_delta} /> : <Txt small muted>{t('abonnés')}</Txt>}
      </View>
    </View>
  )
}

export default function Stats() {
  const { c } = useTheme()
  const router = useRouter()
  const { scope, group } = useSession()
  const [days, setDays] = useState(30)
  const [metric, setMetric] = useState<'views' | 'followers'>('views')
  const [topSort, setTopSort] = useState<TopSort>('views')
  const acc = useListState<AccSort>('views', s => (s === 'name' ? 'asc' : 'desc'))
  const ov = useLoad(s => getOverview(s, days), [days], 'stats-overview')
  const st = useLoad(s => getStats(s, days, { q: acc.q || undefined, sort: acc.sort, order: acc.order }), [days, acc.q, acc.sort, acc.order], 'stats-detailed')
  const top = useLoad(s => getVideos(s, { sort: topSort, days, limit: 12 }), [topSort, days], 'stats-top')
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState('')
  const o = ov.data, d = st.data

  // Relit chaque compte affiché (Instagram : tous les Reels, une fois par heure et par compte).
  const syncAll = async () => {
    setSyncMsg('')
    try {
      const list = await getAccounts(scope)
      let ok = 0, later = 0
      for (let i = 0; i < list.length; i++) {
        setSyncing(`${i + 1}/${list.length}`)
        try { await syncAccount(list[i].org_id ?? scope.org, list[i]); ok++ } catch { later++ }
      }
      const head = ok > 1 ? t('{n} comptes actualisés', { n: ok }) : t('{n} compte actualisé', { n: ok })
      const rest = later ? ` · ${later > 1 ? t('{n} déjà actualisés il y a peu', { n: later }) : t('{n} déjà actualisé il y a peu', { n: later })}` : ''
      setSyncMsg(`${head}${rest}.`)
    } catch (e) { setSyncMsg((e as Error)?.message || t('Erreur')) }
    setSyncing(null)
    ov.reload(); st.reload(); top.reload()
  }
  const reloadAll = () => { ov.reload(); st.reload(); top.reload() }
  const states = new Map((o?.accounts || []).map(a => [`${a.platform}:${a.id}`, a]))
  const reconnect = (o?.accounts || []).filter(a => a.needs_reconnect).length
  const noAccount = (o && o.totals.accounts === 0) || (d && d.totals.accounts === 0 && !acc.q)

  const [allAccounts, setAllAccounts] = useState(false)
  const posted = d?.totals.posts ?? 0
  const sentence = d ? periodText(days, d.totals, d.platforms.filter(p => p.posts > 0).length) : null

  return (
    <Screen onRefresh={reloadAll} refreshing={(ov.loading && !!o) || (st.loading && !!d)}>
      <Txt size={26} bold accessibilityRole="header">{t('Statistiques')}</Txt>
      <Seg label={t('Période')} value={days} onChange={setDays} options={[[7, t('7 j')], [30, t('30 j')], [90, t('90 j')], [365, t('1 an')]]} />
      {ov.error ? <Msg kind="err">{ov.error}</Msg> : null}
      {st.error ? <Msg kind="err">{st.error}</Msg> : null}
      {!o && !d && (ov.loading || st.loading) ? <View style={{ gap: space.md }}><Skeleton h={120} /><Skeleton h={220} /><Skeleton h={160} /></View> : null}

      {noAccount ? (
        <Empty title={group ? t('Aucun compte dans ce groupe') : t('Connectez votre premier compte')} icon="users"
          action={<Button kind="primary" title={group ? t('Gérer les comptes') : t('Connecter un compte')} onPress={() => router.push('/accounts')} />}>
          {group ? t('Ajoutez des comptes à ce groupe depuis Comptes.') : t('TikTok, YouTube ou Instagram : vos chiffres apparaîtront ici.')}
        </Empty>
      ) : (
        <>
          {/* 1. Le résumé : une phrase et les trois chiffres qui comptent. */}
          {d ? (
            <Card style={{ gap: space.md }}>
              <Txt bold size={17} accessibilityRole="header">{sentence}</Txt>
              <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
                <Figure label={t('vues')} value={short(d.totals.views ?? o?.totals.views)}
                  sub={d.totals.avg_views != null && posted ? t('{n} par vidéo', { n: short(d.totals.avg_views) }) : undefined} />
                <Figure label={t('abonnés')} value={short(d.totals.followers ?? o?.totals.followers)}
                  sub={d.totals.followers_delta != null ? <Row gap={4}><Delta value={d.totals.followers_delta} /></Row> : undefined} />
                <Figure label={t('engagement')} value={pct(d.totals.engagement_rate)} />
              </Row>
            </Card>
          ) : null}
          {o && o.totals.failed_recent > 0 ? (
            <Pressable onPress={() => router.push('/')} accessibilityRole="link">
              <Msg kind="err">{o.totals.failed_recent > 1 ? t('{n} publications en échec ces 7 derniers jours. Voir le planning.', { n: o.totals.failed_recent }) : t('{n} publication en échec ces 7 derniers jours. Voir le planning.', { n: o.totals.failed_recent })}</Msg>
            </Pressable>
          ) : null}
          {reconnect ? (
            <Pressable onPress={() => router.push('/accounts')} accessibilityRole="link">
              <Msg kind="warn">{reconnect > 1 ? t('{n} comptes à reconnecter. Ouvrir Comptes.', { n: reconnect }) : t('{n} compte à reconnecter. Ouvrir Comptes.', { n: reconnect })}</Msg>
            </Pressable>
          ) : null}

          {d && !posted ? (
            <Empty title={t('Vos chiffres arrivent avec la première vidéo')} icon="chart"
              action={<Button kind="primary" icon="plus" title={t('Planifier une vidéo')} onPress={() => router.push('/new')} />}>
              {t('Ici : les vidéos qui marchent, la part de chaque réseau, les meilleurs moments pour publier. Les chiffres arrivent quelques heures après la publication.')}
            </Empty>
          ) : null}

          {/* 2. Audience : l'évolution. */}
          {o ? (
            <Card>
              <Row style={{ justifyContent: 'space-between' }} wrap>
                <Txt size={18} bold accessibilityRole="header">{t('Audience')}</Txt>
                <View style={{ width: 180 }}>
                  <Seg label={t('Mesure')} value={metric} onChange={setMetric} options={[['views', t('Vues')], ['followers', t('Abonnés')]]} />
                </View>
              </Row>
              <ViewsChart series={o.series} metric={metric} />
            </Card>
          ) : null}

          {/* 3. Ce qui marche. */}
          {posted ? (
            <View style={{ gap: space.sm }}>
              <SectionHead title={t('Vidéos qui marchent')} action={t('Toutes')} onAction={() => router.push('/videos')} />
              <ChipRow label={t('Classer par')}>
                {TOP_SORTS.map(([s, l]) => <Chip key={s} label={t(l)} selected={topSort === s} onPress={() => setTopSort(s)} />)}
              </ChipRow>
              {top.error ? <Msg kind="err">{top.error}</Msg> : null}
              {!top.data && top.loading ? <Skeleton h={190} /> : null}
              {top.data && top.data.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingVertical: 2 }}>
                  {top.data.map((v, i) => (
                    <Pressable key={v.id} onPress={() => router.push(`/video/${v.id}`)} accessibilityRole="button"
                      accessibilityLabel={`${t('Numéro {n}', { n: i + 1 })} : ${v.title || t('Sans titre')}, ${v.account_name || ''}, ${t('{n} vues', { n: short(v.views) })}`}
                      style={({ pressed }) => ({ width: 140, gap: 6, opacity: pressed ? 0.6 : 1 })}>
                      <View>
                        <Thumb uri={v.thumbnail_url} w={140} h={186} />
                        <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: c.ink, borderRadius: radius.sm, paddingHorizontal: 6 }}>
                          <Txt small bold color={c.onInk}>#{i + 1}</Txt>
                        </View>
                      </View>
                      <Txt small bold numberOfLines={1}>{v.title || t('Sans titre')}</Txt>
                      <Row gap={6}><PlatformLogo platform={v.platform} size={12} /><Txt small muted numberOfLines={1} style={{ flex: 1 }}>{v.account_name}</Txt></Row>
                      <Metrics v={v} />
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </View>
          ) : null}

          {d && d.platforms.length > 1 && posted ? (
            <Card style={{ gap: 0 }}>
              <Txt size={18} bold accessibilityRole="header">{t('Par réseau')}</Txt>
              {d.platforms.map((p, i) => <View key={p.platform}>{i ? <Divider /> : null}<PlatformLine p={p} totalViews={d.totals.views} /></View>)}
            </Card>
          ) : null}

          {d && posted ? (
            <Card>
              <Txt size={18} bold accessibilityRole="header">{t('Meilleurs moments pour publier')}</Txt>
              <Heatmap posts={d.posts} />
            </Card>
          ) : null}

          {/* 4. Publications : la fiabilité, à part de l'audience. */}
          {o ? (
            <Card style={{ gap: space.md }}>
              <Txt size={18} bold accessibilityRole="header">{t('Publications')}</Txt>
              <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
                <Figure label={t('publiées ({n} j)', { n: days })} value={num(o.totals.published)} />
                <Figure label={t('programmées')} value={num(o.totals.upcoming)} />
                <Figure label={t('en échec (7 j)')} value={num(o.totals.failed_recent)} />
              </Row>
              <Button small kind="ghost" icon="calendar" title={t('Voir le planning')} onPress={() => router.push('/')} style={{ alignSelf: 'flex-start' }} />
            </Card>
          ) : null}

          {/* 5. Le détail par compte : les 5 premiers, le reste sur demande. */}
          {d && d.accounts.length ? (
            <Card style={{ gap: space.sm }}>
              <SectionHead title={t('Par compte · {n}', { n: d.accounts.length })} action={t('Gérer')} onAction={() => router.push('/accounts')} />
              {allAccounts || d.accounts.length > 5 ? (
                <>
                  {allAccounts ? <SearchField value={acc.input} onChangeText={acc.setInput} placeholder={t('Rechercher un compte')} /> : null}
                  <SortChips list={acc} options={ACC_SORTS} />
                </>
              ) : null}
              <View>
                {(allAccounts ? d.accounts : d.accounts.slice(0, 5)).map((a, i) => (
                  <View key={`${a.platform}-${a.id}`}>
                    {i ? <Divider /> : null}
                    <AccountRow a={a} state={states.get(`${a.platform}:${a.id}`)} />
                  </View>
                ))}
              </View>
              {d.accounts.length > 5 && !allAccounts ? <Button small kind="ghost" title={t('Voir les {n} comptes', { n: d.accounts.length })} onPress={() => setAllAccounts(true)} /> : null}
            </Card>
          ) : d && acc.q ? <Txt small muted>{t('Aucun compte ne correspond à « {q} ».', { q: acc.q })}</Txt> : null}

          <View style={{ gap: space.sm }}>
            <Button small kind="ghost" icon="refresh" disabled={syncing !== null}
              title={syncing ? t('Actualisation… {progress}', { progress: syncing }) : t('Actualiser les chiffres maintenant')} onPress={syncAll} style={{ alignSelf: 'flex-start' }} />
            {syncMsg ? <Msg>{syncMsg}</Msg> : null}
            {d ? (
              <Row gap={6} style={{ alignItems: 'flex-start' }}>
                <Icon name="chart" size={14} color={c.faint} />
                <Txt small faint style={{ flex: 1 }}>
                  {t('Chiffres relevés plusieurs fois par jour, via les API officielles :')} {(Object.entries(d.metrics) as [Platform, Metric[]][]).map(([p, ms]) => `${PLATFORM_LABEL[p]} (${ms.map(m => t(METRIC_LABEL[m]).toLowerCase()).join(', ')})`).join(' · ')}.

                </Txt>
              </Row>
            ) : null}
          </View>
        </>
      )}
    </Screen>
  )
}
