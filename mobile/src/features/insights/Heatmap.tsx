// Meilleurs moments pour publier : vues moyennes par jour × tranche de 3 h (heure du téléphone).
import { useMemo } from 'react'
import { View } from 'react-native'
import type { DetailedStats } from '../../lib/api'
import { short } from '../../lib/format'
import { Txt } from '../../ui/kit'
import { useTheme } from '../../ui/theme'
import { DOW, DOW_LONG, heatmap, SLOTS } from './logic'

export function Heatmap({ posts }: { posts: DetailedStats['posts'] }) {
  const { c } = useTheme()
  const h = useMemo(() => heatmap(posts), [posts])
  if (h.empty) return <Txt small muted>La carte se remplit dès que des vidéos avec des vues sont relevées sur la période.</Txt>
  const b = h.best
  const bestText = b ? `${DOW_LONG[b.d]} entre ${b.s * 3} h et ${b.s * 3 + 3} h` : ''
  return (
    <View style={{ gap: 10 }}>
      {b ? <Txt small>Meilleur créneau : <Txt small bold>{bestText}</Txt> · {short(Math.round(b.avg))} vues en moyenne.</Txt> : null}
      <View accessible accessibilityRole="image"
        accessibilityLabel={`Vues moyennes par jour et par tranche de 3 heures.${b ? ` Meilleur créneau : ${bestText}, ${short(Math.round(b.avg))} vues en moyenne.` : ''}`}
        style={{ gap: 3 }}>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          <View style={{ width: 30 }} />
          {SLOTS.map(s => <Txt key={s} size={10} muted center style={{ flex: 1 }}>{s}</Txt>)}
        </View>
        {h.grid.map((row, d) => (
          <View key={d} style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
            <Txt size={11} muted style={{ width: 30 }}>{DOW[d]}</Txt>
            {row.map((cell, s) => (
              <View key={s} style={{ flex: 1, aspectRatio: 1.3, borderRadius: 5, backgroundColor: c.surface2, overflow: 'hidden' }}>
                {cell.n ? <View style={{ flex: 1, backgroundColor: c.primary, opacity: cell.level }} /> : null}
              </View>
            ))}
          </View>
        ))}
      </View>
      <Txt small muted>Heure de publication dans votre fuseau. Plus la case est foncée, plus les vidéos publiées à ce moment ont été vues.</Txt>
    </View>
  )
}
