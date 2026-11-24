// Stats : l'accueil du site (chiffres clés, courbe, comptes) et la page Statistiques (totaux, détail
// par plateforme, meilleurs moments, par compte, vidéos qui marchent), sur une période au choix.
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
import { accountState, plural, share } from '../../features/insights/logic'
import { ChipRow, Metrics, SectionHead, SortChips, Thumb } from '../../features/insights/parts'
import { ViewsChart } from '../../features/insights/ViewsChart'

const ALL: Metric[] = ['followers', 'views', 'likes', 'comments', 'shares', 'saves']
type AccSort = 'views' | 'posts' | 'engagement_rate' | 'followers' | 'followers_delta' | 'likes' | 'name'
const ACC_SORTS: [AccSort, string][] = [['views', 'Vues'], ['followers', 'Abonnés'], ['followers_delta', 'Abonnés gagnés'],
  ['engagement_rate', 'Engagement'], ['posts', 'Vidéos'], ['likes', 'J’aime'], ['name', 'Nom']]
type TopSort = 'views' | 'engagement' | 'likes' | 'comments' | 'shares'
const TOP_SORTS: [TopSort, string][] = [['views', 'Les plus vues'], ['engagement', 'Plus d’interactions'], ['likes', 'Plus de j’aime'],
  ['comments', 'Plus commentées'], ['shares', 'Plus partagées']]

function Kpi({ label, value, sub, onPress }: { label: string; value: string; sub?: ReactNode; onPress?: () => void }) {
  return (
    <Card onPress={onPress} accessibilityLabel={onPress ? `${label} : ${value}` : undefined} style={{ flexBasis: '47%', flexGrow: 1, padding: space.md, gap: 2 }}>
      <Txt small muted numberOfLines={1}>{label}</Txt>
      <Txt size={22} bold numberOfLines={1}>{value}</Txt>
      {typeof sub === 'string' ? <Txt small muted numberOfLines={1}>{sub}</Txt> : sub}
    </Card>
  )
}

function PlatformCard({ p, totalViews }: { p: PlatformStats; totalViews: number | null }) {
  const { c } = useTheme()
  const part = share(p.views, totalViews)
  return (
    <Card>
      <Row gap={space.md}>
        <PlatformLogo platform={p.platform} size={32} />
        <View style={{ flex: 1 }}>
          <Txt size={17} bold accessibilityRole="header">{PLATFORM_LABEL[p.platform]}</Txt>
          <Txt small muted>{plural(p.accounts, 'compte')} · {plural(p.posts, 'vidéo')}</Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}><Txt bold>{pct(p.engagement_rate)}</Txt><Txt small muted>engagement</Txt></View>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm }}>
        {ALL.map(m => {
          const available = p.metrics.includes(m)
          const v = p[m as keyof PlatformStats] as number | null
          return (
            <View key={m} style={{ width: '33.33%', paddingRight: 4 }} accessible
              accessibilityLabel={`${METRIC_LABEL[m]} : ${available ? short(v) : 'non fourni'}`}>
              <Txt small muted numberOfLines={1}>{METRIC_LABEL[m]}</Txt>
              {available ? (
                <Row gap={4}><Txt bold>{short(v)}</Txt>{m === 'followers' && p.followers_delta != null ? <Delta value={p.followers_delta} /> : null}</Row>
              ) : <Txt small faint>non fourni</Txt>}
            </View>
          )
        })}
      </View>
      {totalViews ? (
        <View style={{ gap: 4 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface2, overflow: 'hidden' }}>
            <View style={{ width: `${part}%`, height: 6, backgroundColor: c[p.platform] }} />
          </View>
          <Txt small muted>{part} % des vues de la période</Txt>
        </View>
      ) : null}
    </Card>
  )
}

function AccountRow({ a, state }: { a: AccountStats; state?: Account }) {
  const { c } = useTheme()
  const st = state ? accountState(state) : null
  const tone = st ? { ok: c.ok, warn: c.warn, danger: c.danger, muted: c.muted }[st.tone] : c.muted
  return (
    <View accessible accessibilityLabel={`${a.name || PLATFORM_LABEL[a.platform]}${st ? `, ${st.label}` : ''}. ${short(a.views)} vues, ${plural(a.posts, 'vidéo')}, engagement ${pct(a.engagement_rate)}. ${a.stats_available ? `${short(a.followers)} abonnés` : 'abonnés non fournis'}${a.followers_delta != null ? `, ${signed(a.followers_delta)}` : ''}.`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md }}>
      <Avatar src={a.avatar_url} name={a.name} platform={a.platform} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt bold numberOfLines={1}>{a.name || PLATFORM_LABEL[a.platform]}</Txt>
        {st && st.tone !== 'ok' ? <Txt small color={tone}>{st.label}</Txt> : null}
        <Txt small muted numberOfLines={1}>{short(a.views)} vues · {plural(a.posts, 'vidéo')} · {pct(a.engagement_rate)}</Txt>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt bold>{a.stats_available ? short(a.followers) : '—'}</Txt>
        {a.followers_delta != null ? <Delta value={a.followers_delta} /> : <Txt small muted>abonnés</Txt>}
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
      setSyncMsg(`${ok} compte${ok > 1 ? 's' : ''} actualisé${ok > 1 ? 's' : ''}${later ? ` · ${later} déjà actualisé${later > 1 ? 's' : ''} il y a peu` : ''}.`)
    } catch (e) { setSyncMsg((e as Error)?.message || 'Erreur') }
    setSyncing(null)
    ov.reload(); st.reload(); top.reload()
  }
  const reloadAll = () => { ov.reload(); st.reload(); top.reload() }
  const states = new Map((o?.accounts || []).map(a => [`${a.platform}:${a.id}`, a]))
  const reconnect = (o?.accounts || []).filter(a => a.needs_reconnect).length
  const noAccount = (o && o.totals.accounts === 0) || (d && d.totals.accounts === 0 && !acc.q)

  return (
    <Screen onRefresh={reloadAll} refreshing={(ov.loading && !!o) || (st.loading && !!d)}>
      <View style={{ gap: space.sm }}>
        <Txt size={26} bold accessibilityRole="header">Statistiques</Txt>
        <Txt small muted>Chiffres relevés plusieurs fois par jour.</Txt>
      </View>
      <Seg label="Période" value={days} onChange={setDays} options={[[7, '7 j'], [30, '30 j'], [90, '90 j'], [365, '1 an']]} />
      <Button small icon="refresh" disabled={syncing !== null}
        title={syncing ? `Actualisation… ${syncing}` : 'Actualiser les chiffres'} onPress={syncAll} style={{ alignSelf: 'flex-start' }} />
      {syncMsg ? <Msg>{syncMsg}</Msg> : null}
      {ov.error ? <Msg kind="err">{ov.error}</Msg> : null}
      {st.error ? <Msg kind="err">{st.error}</Msg> : null}
      {!o && !d && (ov.loading || st.loading) ? <View style={{ gap: space.md }}><Skeleton h={90} n={4} /></View> : null}

      {noAccount ? (
        <Empty title={group ? 'Aucun compte dans ce groupe' : 'Connectez votre premier compte'} icon="users"
          action={<Button kind="primary" title={group ? 'Gérer les comptes' : 'Connecter un compte'} onPress={() => router.push('/accounts')} />}>
          {group ? 'Ajoutez des comptes à ce groupe depuis Comptes.' : 'TikTok, YouTube ou Instagram : vos chiffres apparaîtront ici.'}
        </Empty>
      ) : (
        <>
          {o || d ? (
            <View accessibilityLabel="Chiffres clés" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Kpi label="Vues" value={short(d?.totals.views ?? o?.totals.views)}
                sub={o?.totals.views_gained != null ? <Row gap={4}><Delta value={o.totals.views_gained} /><Txt small muted>en {days} j</Txt></Row>
                  : d?.totals.avg_views != null ? `${short(d.totals.avg_views)} par vidéo` : 'cumul des comptes'} />
              <Kpi label="Abonnés" value={short(d?.totals.followers ?? o?.totals.followers)}
                sub={d?.totals.followers_delta != null ? <Row gap={4}><Delta value={d.totals.followers_delta} /><Txt small muted>en {days} j</Txt></Row>
                  : plural(o?.totals.accounts ?? d?.totals.accounts ?? 0, 'compte')} />
              {d ? <Kpi label="Engagement" value={pct(d.totals.engagement_rate)} sub={`${short(d.totals.interactions)} interactions`} /> : null}
              {d ? <Kpi label="Vidéos" value={num(d.totals.posts)} sub={`publiées en ${days} j`} /> : null}
              {d ? <Kpi label="J’aime" value={short(d.totals.likes)} sub={`${short(d.totals.comments)} commentaires`} /> : null}
              {d ? <Kpi label="Partages" value={short(d.totals.shares)} sub={d.totals.saves != null ? `${short(d.totals.saves)} enregistrements` : 'TikTok et Instagram'} /> : null}
              {o ? <Kpi label="Publiées" value={num(o.totals.published)} sub={`depuis Chapote, ${days} j`} onPress={() => router.push('/')} /> : null}
              {o ? <Kpi label="Programmées" value={num(o.totals.upcoming)} sub={<Txt small color={c.accent}>Voir le planning</Txt>} onPress={() => router.push('/')} /> : null}
            </View>
          ) : null}
          {o && o.totals.failed_recent > 0 ? (
            <Pressable onPress={() => router.push('/')} accessibilityRole="link">
              <Msg kind="err">{`${plural(o.totals.failed_recent, 'publication')} en échec ces 7 derniers jours. Voir le planning.`}</Msg>
            </Pressable>
          ) : null}
          {reconnect ? (
            <Pressable onPress={() => router.push('/accounts')} accessibilityRole="link">
              <Msg kind="warn">{`${plural(reconnect, 'compte')} à reconnecter. Ouvrir Comptes.`}</Msg>
            </Pressable>
          ) : null}

          {o ? (
            <Card>
              <Row style={{ justifyContent: 'space-between' }} wrap>
                <Txt size={18} bold accessibilityRole="header">{metric === 'views' ? 'Vues cumulées' : 'Abonnés'}</Txt>
                <View style={{ width: 180 }}>
                  <Seg label="Mesure" value={metric} onChange={setMetric} options={[['views', 'Vues'], ['followers', 'Abonnés']]} />
                </View>
              </Row>
              <ViewsChart series={o.series} metric={metric} />
            </Card>
          ) : null}

          <View style={{ gap: space.sm }}>
            <SectionHead title="Vidéos qui marchent" action="Toutes" onAction={() => router.push('/videos')} />
            <ChipRow label="Classer par">
              {TOP_SORTS.map(([s, l]) => <Chip key={s} label={l} selected={topSort === s} onPress={() => setTopSort(s)} />)}
            </ChipRow>
            {top.error ? <Msg kind="err">{top.error}</Msg> : null}
            {!top.data && top.loading ? <Skeleton h={190} /> : null}
            {top.data && top.data.length === 0 ? <Txt small muted>Aucune vidéo relevée sur la période.</Txt> : null}
            {top.data && top.data.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingVertical: 2 }}>
                {top.data.map((v, i) => (
                  <Pressable key={v.id} onPress={() => router.push(`/video/${v.id}`)} accessibilityRole="button"
                    accessibilityLabel={`Numéro ${i + 1} : ${v.title || 'Sans titre'}, ${v.account_name || ''}, ${short(v.views)} vues`}
                    style={({ pressed }) => ({ width: 150, gap: 6, opacity: pressed ? 0.6 : 1 })}>
                    <View>
                      <Thumb uri={v.thumbnail_url} w={150} h={200} />
                      <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: c.ink, borderRadius: radius.sm, paddingHorizontal: 6 }}>
                        <Txt small bold color={c.onInk}>#{i + 1}</Txt>
                      </View>
                    </View>
                    <Txt small bold numberOfLines={1}>{v.title || 'Sans titre'}</Txt>
                    <Row gap={6}><PlatformLogo platform={v.platform} size={12} /><Txt small muted numberOfLines={1} style={{ flex: 1 }}>{v.account_name}</Txt></Row>
                    <Metrics v={v} />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>

          {d && d.platforms.length ? (
            <View style={{ gap: space.sm }}>
              <SectionHead title="Par plateforme" />
              {d.platforms.map(p => <PlatformCard key={p.platform} p={p} totalViews={d.totals.views} />)}
            </View>
          ) : null}

          {d ? (
            <Card>
              <Txt size={18} bold accessibilityRole="header">Meilleurs moments pour publier</Txt>
              <Heatmap posts={d.posts} />
            </Card>
          ) : null}

          {d ? (
            <Card style={{ gap: space.md }}>
              <SectionHead title="Par compte" action="Gérer" onAction={() => router.push('/accounts')} />
              <SearchField value={acc.input} onChangeText={acc.setInput} placeholder="Rechercher un compte" />
              <SortChips list={acc} options={ACC_SORTS} />
              <Txt small muted>{plural(d.accounts.length, 'compte')}</Txt>
              {d.accounts.length === 0 ? <Txt small muted>Aucun compte ne correspond à « {acc.q} ».</Txt> : null}
              <View>
                {d.accounts.map((a, i) => (
                  <View key={`${a.platform}-${a.id}`}>
                    {i ? <Divider /> : null}
                    <AccountRow a={a} state={states.get(`${a.platform}:${a.id}`)} />
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {d ? (
            <Row gap={6} style={{ alignItems: 'flex-start' }}>
              <Icon name="chart" size={14} color={c.faint} />
              <Txt small faint style={{ flex: 1 }}>
                Chiffres des API officielles : {(Object.entries(d.metrics) as [Platform, Metric[]][]).map(([p, ms]) => `${PLATFORM_LABEL[p]} (${ms.map(m => METRIC_LABEL[m].toLowerCase()).join(', ')})`).join(' · ')}.
                Les duos et collages ne sont pas fournis par l’API TikTok, ni les partages par l’API YouTube.
              </Txt>
            </Row>
          ) : null}
        </>
      )}
    </Screen>
  )
}
