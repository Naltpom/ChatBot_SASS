// Section tarifs : modèle MODULAIRE à la carte, présenté comme une carte de
// restaurant (libellé, pointillés, prix). Les prix et les remises d'intro
// sont chargés DEPUIS LA BASE via GET /api/billing/pricing (public, sans auth) —
// changer un prix ou retirer une remise côté admin se reflète ICI. Le miroir
// FALLBACK ci-dessous ne sert qu'au pré-rendu SSG / au repli hors-ligne.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { CLASH, MONO, Kicker, btnPrimary, sectionH2, lead } from './data'
import { revealDelay } from './assets'

// Contrat de GET /api/billing/pricing (routers/public.py).
interface PublicPricing {
  currency: string
  base_price_cents: number
  byok_price_cents: number | null
  ai_tiers: { id: string; label: string; included_replies: number; price_cents: number }[]
  modules: { key: string; label: string; price_cents: number; description: string }[]
  intro_discounts: Record<string, number>   // { default, ai_starter, ai_growth, ai_scale }
  tax_note: string
}

// Repli (pré-rendu / API indisponible) — aligné sur le seed. JAMAIS la vérité prix.
const FALLBACK: PublicPricing = {
  currency: 'eur',
  base_price_cents: 900,
  byok_price_cents: 2900,
  ai_tiers: [
    { id: 'ai_starter', label: 'IA Starter', included_replies: 1000, price_cents: 1900 },
    { id: 'ai_growth', label: 'IA Growth', included_replies: 3000, price_cents: 3900 },
    { id: 'ai_scale', label: 'IA Scale', included_replies: 10000, price_cents: 8900 },
  ],
  modules: [
    { key: 'rag', label: 'Connaissances (RAG)', price_cents: 900, description: 'Indexez pages, PDF et FAQ ; l’IA répond depuis vos contenus.' },
    { key: 'inbox', label: 'Live chat / Inbox', price_cents: 1500, description: 'Vos conseillers reprennent la main, avec boîte de réception.' },
    { key: 'actions', label: 'Actions', price_cents: 1200, description: 'Webhooks, capture de leads, tickets, créneaux — sans IA.' },
    { key: 'mcp', label: 'MCP (outils IA)', price_cents: 900, description: 'Branchez l’IA sur vos serveurs/outils MCP, appelés en conversation.' },
    { key: 'ab', label: 'A/B testing', price_cents: 700, description: 'Comparez deux versions d’arbre et mesurez la meilleure.' },
    { key: 'white_label', label: 'White-label', price_cents: 900, description: 'Retire la mention « Propulsé par Chapote » du widget.' },
  ],
  intro_discounts: { default: 45, ai_starter: 50, ai_growth: 65, ai_scale: 80 },
  tax_note: 'TVA non applicable, art. 293 B du CGI',
}

const fmtEur = (cents: number): string => {
  const v = cents / 100
  return Number.isInteger(v) ? `${v} €` : `${v.toFixed(2).replace('.', ',')} €`
}
// Prix du 1er mois après remise « offre de bienvenue ».
const welcomePrice = (cents: number, off: number) => fmtEur(Math.round(cents * (1 - off / 100)))

// Une ligne de la carte : paliers IA (depuis le catalogue) puis BYOK.
type Tier = { id: string; name: string; detail: string; priceCents: number; welcomeOff: number }
function buildTiers(p: PublicPricing): Tier[] {
  const tiers: Tier[] = p.ai_tiers.map(t => ({
    id: t.id,
    name: t.label.replace(/^IA\s+/i, ''),
    detail: `${t.included_replies.toLocaleString('fr-FR')} réponses / mois`,
    priceCents: t.price_cents,
    welcomeOff: p.intro_discounts[t.id] ?? 0,
  }))
  if (p.byok_price_cents != null) {
    tiers.push({ id: 'byok', name: 'BYOK', detail: 'votre clé, illimité', priceCents: p.byok_price_cents, welcomeOff: p.intro_discounts.default ?? 0 })
  }
  return tiers
}

const menuLabel: React.CSSProperties = { fontFamily: MONO, fontSize: 12, letterSpacing: '.08em', color: '#6B7B8D' }
// Pointillés entre le libellé et le prix.
const Dots = ({ y = -5 }: { y?: number }) => <span aria-hidden="true" style={{ flex: 1, minWidth: 16, borderBottom: '2px dotted #C5CED8', transform: `translateY(${y}px)` }} />

export function Pricing({ ctaTo }: { ctaTo: string }) {
  // Prix LIVE depuis la base (public). Initialisé au FALLBACK -> le pré-rendu SSG
  // et le 1er rendu client affichent des prix cohérents, remplacés après fetch.
  const [pricing, setPricing] = useState<PublicPricing>(FALLBACK)
  useEffect(() => {
    let alive = true
    api<PublicPricing>('/api/billing/pricing')
      .then(d => { if (alive && d && Array.isArray(d.ai_tiers) && d.ai_tiers.length > 0) setPricing(d) })
      .catch(() => { /* repli silencieux sur FALLBACK */ })
    return () => { alive = false }
  }, [])

  const tiers = buildTiers(pricing)
  const maxOff = Math.max(0, ...Object.values(pricing.intro_discounts || {}))
  const hasOffer = maxOff > 0

  return (
    <section id="tarifs" className="ch-pad" style={{ background: '#F0F2F5', padding: '130px 32px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: '24px 72px', alignItems: 'end' }}>
          <div>
            <div className="ch-reveal"><Kicker color="#2F9E79">TARIFS</Kicker></div>
            <h2 className="ch-reveal" style={{ ...sectionH2, ...revealDelay(80) }}>À la carte.<br />Sans engagement.</h2>
          </div>
          <p className="ch-reveal" style={{ ...lead, ...revealDelay(160), margin: 0, maxWidth: 480 }}>
            Un socle, un palier IA si vous en voulez, des modules si besoin. Prix nets, par bot et par mois.
            {hasOffer && <> <span style={{ color: '#C24E44', fontWeight: 600 }}>1er mois jusqu’à −{maxOff} % sur votre palier IA.</span></>}
          </p>
        </div>

        <div className="ch-reveal" style={{ ...revealDelay(120), marginTop: 56, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 24, padding: 'clamp(24px,4vw,52px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,400px),1fr))', gap: '48px 64px' }}>
          <div>
            <div style={menuLabel}>LE SOCLE</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 16 }}>
              <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 24 }}>Bot en arbre</span>
              <Dots />
              <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 24, color: '#1C3F5C' }}>{fmtEur(pricing.base_price_cents)}</span>
            </div>
            <p style={{ fontSize: 14.5, lineHeight: 1.55, color: '#4A5A68', margin: '8px 0 0' }}>Menus à clics illimités, apparence, déclencheurs proactifs, analytics. Inclus gratuitement dès qu’un palier IA est pris.</p>

            <div style={{ ...menuLabel, marginTop: 40 }}>AJOUTEZ L’IA</div>
            {tiers.map(t => (
              <div key={t.id} style={{ padding: '16px 0', borderBottom: '1px solid #EEF1F4' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 21 }}>{t.name}</span>
                  <span style={{ fontSize: 13.5, color: '#6B7B8D' }}>{t.detail}</span>
                  <Dots />
                  <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 21, color: '#1C3F5C' }}>{fmtEur(t.priceCents)}</span>
                </div>
                {t.welcomeOff > 0 && <div style={{ fontSize: 13, color: '#C24E44', fontWeight: 600, marginTop: 4 }}>1er mois {welcomePrice(t.priceCents, t.welcomeOff)} (−{t.welcomeOff} %)</div>}
              </div>
            ))}
          </div>
          <div>
            <div style={menuLabel}>LES MODULES</div>
            {pricing.modules.map(m => (
              <div key={m.key} style={{ padding: '16px 0', borderBottom: '1px solid #EEF1F4' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{m.label}</span>
                  <Dots y={-4} />
                  <span style={{ fontWeight: 700, fontSize: 16, color: '#1C3F5C' }}>{fmtEur(m.price_cents)}</span>
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, color: '#6B7B8D', marginTop: 4 }}>{m.description}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 32px', marginTop: 36 }}>
          <Link to={ctaTo} className="ch-cta-flat" style={{ ...btnPrimary, transition: 'background .2s' }}>Composer mon abonnement →</Link>
          <span style={{ fontSize: 13, color: '#6B7B8D', maxWidth: 560, lineHeight: 1.5 }}>
            {hasOffer && '1er mois remisé selon le palier, puis plein tarif. '}Annulable à tout moment. {pricing.tax_note}.
          </span>
        </div>
      </div>
    </section>
  )
}
