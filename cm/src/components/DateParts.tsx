// Jour et heure en 5 cases sur une ligne, dans l'ordre de la langue, avec la date en toutes lettres au-dessus
// (même composant que l'app : mobile/src/features/planning/DateParts.tsx).
import { useEffect, useState } from 'react'
import { dateOrder, fromParts, LOCALE, longDate } from '../compose'
import { t } from '../i18n'

type Part = 'day' | 'month' | 'year' | 'hour' | 'minute'
const LABEL: Record<Part, string> = { day: 'Jour', month: 'Mois', year: 'Année', hour: 'Heure', minute: 'Min' }
const pad = (n: number) => String(n).padStart(2, '0')
const partsOf = (d: Date): Record<Part, string> => ({
  day: pad(d.getDate()), month: pad(d.getMonth() + 1), year: String(d.getFullYear()), hour: pad(d.getHours()), minute: pad(d.getMinutes()),
})

export function DateParts({ value, onChange, disabled, label, locale = LOCALE }: {
  value: Date; onChange: (d: Date) => void; disabled?: boolean; label?: string; locale?: string
}) {
  const [txt, setTxt] = useState(() => partsOf(value))
  const [bad, setBad] = useState(false)
  useEffect(() => { setTxt(partsOf(value)); setBad(false) }, [value.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const order: Part[] = [...dateOrder(locale), 'hour', 'minute']
  const edit = (p: Part, v: string) => {
    const next = { ...txt, [p]: v.replace(/\D/g, '').slice(0, p === 'year' ? 4 : 2) }
    setTxt(next)
    const d = fromParts({ day: +next.day, month: +next.month, year: +next.year, hour: +next.hour, minute: +next.minute })
    setBad(!d)
    if (d && d.getTime() !== value.getTime()) onChange(d)
  }
  return (
    <div className="col" style={{ gap: 8 }}>
      {label && <span className="small strong">{label}</span>}
      <span className="strong" style={{ color: bad ? 'var(--danger)' : undefined }} aria-live="polite">{bad ? t('Date ou heure invalide') : longDate(value, locale)}</span>
      <div className="dparts">
        {order.map(p => (
          <label key={p} className={`dpart dpart-${p}`}>
            <input className="input" inputMode="numeric" value={txt[p]} maxLength={p === 'year' ? 4 : 2} disabled={disabled}
                   aria-invalid={bad} aria-label={label ? t('{label} : {part}', { label, part: t(LABEL[p]) }) : t(LABEL[p])}
                   onFocus={e => e.currentTarget.select()} onChange={e => edit(p, e.target.value)}
                   onBlur={() => { if (!bad) setTxt(partsOf(value)) }} />
            <span className="tiny muted">{t(LABEL[p])}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
