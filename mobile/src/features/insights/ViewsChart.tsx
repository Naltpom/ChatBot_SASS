// Vues cumulées (ou abonnés) par jour, empilées par plateforme (couleurs des plateformes).
// Toucher la courbe : repère vertical et chiffres du jour sous la courbe. Vue « Tableau » à côté.
import { useMemo, useState } from 'react'
import { View, type GestureResponderEvent } from 'react-native'
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg'
import { PLATFORM_LABEL, type SeriesPoint } from '../../lib/api'
import { num, short } from '../../lib/format'
import { Button, Divider, Row, Txt } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'
import { chartModel, nearestIndex, type ChartModel } from './logic'
import { PlatformDot } from './parts'
import { t, locale } from '../../lib/i18n'

const fmtDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short' })

/** Résumé lu par le lecteur d'écran (comme chartSummary de logic.ts, dans la langue choisie). */
function summaryText(m: Pick<ChartModel, 'series' | 'totals'>, label: string): string {
  const n = m.series.length
  if (!n) return t('{label} : pas encore de relevé.', { label })
  const a = m.totals[0], b = m.totals[n - 1]
  if (n === 1) return t('{label} le {day} : {value}.', { label, day: fmtDay(m.series[0].day), value: short(b) })
  const diff = b - a
  return t('{label} du {from} au {to} : de {a} à {b}, soit {diff}.', {
    label, from: fmtDay(m.series[0].day), to: fmtDay(m.series[n - 1].day), a: short(a), b: short(b), diff: `${diff >= 0 ? '+' : ''}${short(diff)}`,
  })
}

export function ViewsChart({ series: all, metric = 'views' }: { series: SeriesPoint[]; metric?: 'views' | 'followers' }) {
  const { c } = useTheme()
  const [w, setW] = useState(0)
  const [pick, setPick] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const H = w < 520 ? 200 : 260
  const m = useMemo(() => chartModel(all, metric, Math.max(w, 1), H), [all, metric, w, H])
  const label = metric === 'views' ? t('Vues cumulées') : t('Abonnés')

  if (!m.platforms.length) {
    return <Txt small muted center style={{ paddingVertical: 48 }}>{t('La courbe apparaîtra après le premier relevé des chiffres de vos comptes.')}</Txt>
  }
  const n = m.series.length
  const sel = pick != null && pick < n ? pick : null
  const touch = (e: GestureResponderEvent) => setPick(nearestIndex(e.nativeEvent.locationX, n, w, m.pad))
  const val = (i: number, p: keyof SeriesPoint['by_platform']) => m.series[i].by_platform[p]?.[metric]
  const summary = summaryText(m, label)
  // Période choisie plus longue que les relevés : on le dit (la courbe commence au 1er relevé).
  const firstIdx = all.findIndex(pt => Object.values(pt.by_platform).some(v => v?.[metric] != null))
  const since = firstIdx > 0 ? new Date(all[firstIdx].day + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'long' }) : null

  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={12} wrap style={{ flex: 1 }}>
          {m.platforms.map(p => <Row key={p} gap={6}><PlatformDot platform={p} /><Txt small>{PLATFORM_LABEL[p]}</Txt></Row>)}
        </Row>
        <Button small kind="ghost" title={asTable ? t('Courbe') : t('Tableau')} onPress={() => setAsTable(x => !x)}
          accessibilityLabel={asTable ? t('Voir la courbe') : t('Voir en tableau')} />
      </Row>
      {asTable ? (
        <View accessibilityLabel={t('{label}, tableau par jour', { label })}>
          {m.series.slice().reverse().slice(0, 60).map((pt, k) => (
            <View key={pt.day}>
              {k ? <Divider /> : null}
              <Row style={{ minHeight: 40, justifyContent: 'space-between' }}>
                <Txt small muted style={{ width: 64 }}>{fmtDay(pt.day)}</Txt>
                <Row gap={10} style={{ flex: 1, justifyContent: 'flex-end' }}>
                  {m.platforms.map(p => <Txt key={p} small color={c.muted}>{short(pt.by_platform[p]?.[metric])}</Txt>)}
                  <Txt small bold style={{ minWidth: 64, textAlign: 'right' }}>{num(m.totals[n - 1 - k])}</Txt>
                </Row>
              </Row>
            </View>
          ))}
        </View>
      ) : (
        <View onLayout={e => setW(Math.round(e.nativeEvent.layout.width))} style={{ height: H }}
          accessible accessibilityRole="image" accessibilityLabel={summary}
          onStartShouldSetResponder={() => true} onResponderGrant={touch} onResponderMove={touch}
          onResponderTerminationRequest={() => true}>
          {w > 0 ? (
            <Svg width={w} height={H}>
              {m.ticks.map(v => (
                <Line key={`g${v}`} x1={m.pad.l} x2={w - m.pad.r} y1={m.y(v)} y2={m.y(v)} stroke={c.border} strokeWidth={1} />
              ))}
              {m.ticks.map(v => (
                <SvgText key={`t${v}`} x={m.pad.l - 8} y={m.y(v) + 4} textAnchor="end" fontSize={11} fill={c.muted}>{short(v)}</SvgText>
              ))}
              {m.areas.map(a => <Path key={a.platform} d={a.area} fill={c[a.platform]} fillOpacity={0.18} />)}
              {m.areas.map(a => <Path key={a.platform + 'l'} d={a.line} fill="none" stroke={c[a.platform]} strokeWidth={2} strokeLinejoin="round" />)}
              <SvgText x={m.pad.l} y={H - 6} fontSize={11} fill={c.muted}>{fmtDay(m.series[0].day)}</SvgText>
              <SvgText x={w - m.pad.r} y={H - 6} fontSize={11} fill={c.muted} textAnchor="end">{fmtDay(m.series[n - 1].day)}</SvgText>
              {sel != null ? <Line x1={m.x(sel)} x2={m.x(sel)} y1={m.pad.t} y2={H - m.pad.b} stroke={c.borderStrong} strokeWidth={1} /> : null}
              {sel != null ? (() => {
                let acc = 0
                return m.platforms.map(p => {
                  acc += val(sel, p) ?? 0
                  return <Circle key={p} cx={m.x(sel)} cy={m.y(acc)} r={4} fill={c[p]} stroke={c.surface} strokeWidth={2} />
                })
              })() : null}
            </Svg>
          ) : null}
        </View>
      )}
      {!asTable ? (
        sel != null ? (
          <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
            <Txt small bold>{fmtDay(m.series[sel].day)} · {t('total {n}', { n: num(m.totals[sel]) })}</Txt>
            <Row gap={12} wrap>
              {m.platforms.map(p => <Row key={p} gap={6}><PlatformDot platform={p} /><Txt small muted>{PLATFORM_LABEL[p]} {num(val(sel, p))}</Txt></Row>)}
            </Row>
          </View>
        ) : <Txt small faint>{t('Touchez la courbe pour voir les chiffres d’un jour.')}</Txt>

      ) : null}
      {since ? <Txt size={12} muted>{t('Chiffres relevés par Chapote depuis le {day} : rien avant cette date.', { day: since })}</Txt> : null}
    </View>
  )
}
