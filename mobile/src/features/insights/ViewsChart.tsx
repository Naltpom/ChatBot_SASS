// Vues cumulées (ou abonnés) par jour, empilées par plateforme (couleurs des plateformes).
// Toucher la courbe : repère vertical et chiffres du jour sous la courbe. Vue « Tableau » à côté.
import { useMemo, useState } from 'react'
import { View, type GestureResponderEvent } from 'react-native'
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg'
import { PLATFORM_LABEL, type SeriesPoint } from '../../lib/api'
import { num, short } from '../../lib/format'
import { Button, Divider, Row, Txt } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'
import { chartModel, chartSummary, nearestIndex } from './logic'
import { PlatformDot } from './parts'

const fmtDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

export function ViewsChart({ series: all, metric = 'views' }: { series: SeriesPoint[]; metric?: 'views' | 'followers' }) {
  const { c } = useTheme()
  const [w, setW] = useState(0)
  const [pick, setPick] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const H = w < 520 ? 200 : 260
  const m = useMemo(() => chartModel(all, metric, Math.max(w, 1), H), [all, metric, w, H])
  const label = metric === 'views' ? 'Vues cumulées' : 'Abonnés'

  if (!m.platforms.length) {
    return <Txt small muted center style={{ paddingVertical: 48 }}>La courbe apparaîtra après le premier relevé des chiffres de vos comptes.</Txt>
  }
  const n = m.series.length
  const sel = pick != null && pick < n ? pick : null
  const touch = (e: GestureResponderEvent) => setPick(nearestIndex(e.nativeEvent.locationX, n, w, m.pad))
  const val = (i: number, p: keyof SeriesPoint['by_platform']) => m.series[i].by_platform[p]?.[metric]
  const summary = chartSummary(m, label, v => short(v), fmtDay)

  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={12} wrap style={{ flex: 1 }}>
          {m.platforms.map(p => <Row key={p} gap={6}><PlatformDot platform={p} /><Txt small>{PLATFORM_LABEL[p]}</Txt></Row>)}
        </Row>
        <Button small kind="ghost" title={asTable ? 'Courbe' : 'Tableau'} onPress={() => setAsTable(t => !t)}
          accessibilityLabel={asTable ? 'Voir la courbe' : 'Voir en tableau'} />
      </Row>
      {asTable ? (
        <View accessibilityLabel={`${label}, tableau par jour`}>
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
              {m.ticks.map(t => (
                <Line key={`g${t}`} x1={m.pad.l} x2={w - m.pad.r} y1={m.y(t)} y2={m.y(t)} stroke={c.border} strokeWidth={1} />
              ))}
              {m.ticks.map(t => (
                <SvgText key={`t${t}`} x={m.pad.l - 8} y={m.y(t) + 4} textAnchor="end" fontSize={11} fill={c.muted}>{short(t)}</SvgText>
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
            <Txt small bold>{fmtDay(m.series[sel].day)} · total {num(m.totals[sel])}</Txt>
            <Row gap={12} wrap>
              {m.platforms.map(p => <Row key={p} gap={6}><PlatformDot platform={p} /><Txt small muted>{PLATFORM_LABEL[p]} {num(val(sel, p))}</Txt></Row>)}
            </Row>
          </View>
        ) : <Txt small faint>Touchez la courbe pour voir les chiffres d’un jour.</Txt>
      ) : null}
    </View>
  )
}
