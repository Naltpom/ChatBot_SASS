// Prix : toujours fixés en euros par le back. À côté, un équivalent indicatif « ≈ » dans la
// devise du visiteur (pays déduit des langues du navigateur, taux BCE du jour via /api/music/rates).
// Le montant exact dans sa devise est affiché et garanti par Stripe au paiement (Adaptive Pricing).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useI18n } from './i18n'

const REGION_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', LI: 'CHF', JP: 'JPY', CN: 'CNY',
  HK: 'HKD', SG: 'SGD', IN: 'INR', BR: 'BRL', MX: 'MXN', ZA: 'ZAR', KR: 'KRW', SE: 'SEK', NO: 'NOK',
  DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', TR: 'TRY', IL: 'ILS', IS: 'ISK', ID: 'IDR',
  MY: 'MYR', PH: 'PHP', TH: 'THB', RU: 'RUB',
}

export function visitorCurrency(): string | null {
  if (typeof navigator === 'undefined') return null
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const l of langs) {
    const region = l?.split('-')[1]?.toUpperCase()
    if (region && region.length === 2) return REGION_CURRENCY[region] ?? null
  }
  return null
}

const RatesCtx = createContext<Record<string, number>>({})

export function RatesProvider({ children }: { children: ReactNode }) {
  const [rates, setRates] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!visitorCurrency()) return
    fetch('/api/music/rates').then(r => r.ok ? r.json() : null)
      .then(d => d?.rates && setRates(d.rates)).catch(() => { /* pas d'équivalent */ })
  }, [])
  return <RatesCtx.Provider value={rates}>{children}</RatesCtx.Provider>
}

export function useMoney() {
  const { lang } = useI18n()
  const rates = useContext(RatesCtx)
  const cur = visitorCurrency()
  const rate = cur ? rates[cur] : undefined
  const eur = (cents: number) =>
    new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' }).format(cents / 100)
  const approx = (cents: number): string | null => {
    if (!cur || !rate || cents <= 0) return null
    const v = (cents / 100) * rate
    const nf = new Intl.NumberFormat(lang, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: v >= 100 ? 0 : 2 })
    return `≈ ${nf.format(v)}`
  }
  return { eur, approx, currency: cur && rate ? cur : null }
}

/** Prix en euros suivi de l'équivalent indicatif (petit, grisé). */
export function Price({ cents, prefix }: { cents: number; prefix?: string }) {
  const { eur, approx } = useMoney()
  const a = approx(cents)
  return (
    <span className="price-wrap">
      <span className="price-eur">{prefix ? `${prefix} ` : ''}{eur(cents)}</span>
      {a && <span className="price-fx">{a}</span>}
    </span>
  )
}
