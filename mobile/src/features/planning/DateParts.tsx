// Jour et heure en 5 cases sur une ligne (jour, mois, année, heure, minutes), dans l'ordre de la langue
// (fr : 30 / 11 / 2026, en-US : 11 / 30 / 2026), et au-dessus la date en toutes lettres : « lundi 30 novembre 2026 à 19:10 ».
import { useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'
import { locale as appLocale } from '../../lib/locale'
import { Row, Txt } from '../../ui/kit'
import { radius, useTheme } from '../../ui/theme'
import { dateOrder, fromParts, longDate } from './compose'

type Part = 'day' | 'month' | 'year' | 'hour' | 'minute'
const LABEL: Record<Part, string> = { day: 'Jour', month: 'Mois', year: 'Année', hour: 'Heure', minute: 'Min' }
const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const partsOf = (d: Date): Record<Part, string> => ({
  day: pad(d.getDate()), month: pad(d.getMonth() + 1), year: String(d.getFullYear()), hour: pad(d.getHours()), minute: pad(d.getMinutes()),
})

export function DateParts({ value, onChange, disabled, label, locale = appLocale() }: {
  value: Date; onChange: (d: Date) => void; disabled?: boolean; label?: string; locale?: string
}) {
  const { c } = useTheme()
  const [txt, setTxt] = useState(() => partsOf(value))
  const [bad, setBad] = useState(false)
  // Valeur changée de l'extérieur (brouillon repris, autre compte) : les cases suivent.
  useEffect(() => { setTxt(partsOf(value)); setBad(false) }, [value.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const order: Part[] = [...dateOrder(locale), 'hour', 'minute']
  const edit = (p: Part, v: string) => {
    const next = { ...txt, [p]: v.replace(/\D/g, '').slice(0, p === 'year' ? 4 : 2) }
    setTxt(next)
    const d = fromParts({ day: +next.day, month: +next.month, year: +next.year, hour: +next.hour, minute: +next.minute })
    setBad(!d)
    if (d && d.getTime() !== value.getTime()) onChange(d)
  }
  const blur = () => { if (!bad) setTxt(partsOf(value)) }
  return (
    <View style={{ gap: 8, opacity: disabled ? 0.45 : 1 }}>
      {label ? <Txt small bold>{label}</Txt> : null}
      <Txt bold color={bad ? c.danger : c.text}>{bad ? 'Date ou heure invalide' : longDate(value, locale)}</Txt>
      <Row gap={6} style={{ alignItems: 'flex-start' }}>
        {order.map(p => (
          <View key={p} style={{ flex: p === 'year' ? 1.5 : 1, gap: 4, marginLeft: p === 'hour' ? 8 : 0 }}>
            <TextInput value={txt[p]} onChangeText={v => edit(p, v)} onBlur={blur} editable={!disabled}
              keyboardType="number-pad" maxLength={p === 'year' ? 4 : 2} selectTextOnFocus
              accessibilityLabel={`${label ? `${label} : ` : ''}${LABEL[p]}`}
              style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: bad ? c.danger : c.borderStrong,
                backgroundColor: c.surface, color: c.text, fontSize: 18, fontWeight: '600', textAlign: 'center', fontVariant: ['tabular-nums'] }} />
            <Txt size={11} muted center>{LABEL[p]}</Txt>
          </View>
        ))}
      </Row>
    </View>
  )
}
