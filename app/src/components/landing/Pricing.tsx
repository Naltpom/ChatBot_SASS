// Section tarifs : modèle MODULAIRE à la carte. Les prix et les remises d'intro
// sont chargés DEPUIS LA BASE via GET /api/billing/pricing (public, sans auth) —
// changer un prix ou retirer une remise côté admin se reflète ICI. Le miroir
// FALLBACK ci-dessous ne sert qu'au pré-rendu SSG / au repli hors-ligne.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { CLASH, JAKARTA, btnPrimary, eyebrow, sectionH2, Check } from './data'

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

type Plan = {
  id: string
  name: string
  priceCents: number
  tagline: string
  features: string[]
  welcomeOff: number   // % remise 1er mois (0 = pas d'offre)
  featured?: boolean
  badge?: string
}

const fmtEur = (cents: number): string => {
  const v = cents / 100
  return Number.isInteger(v) ? `${v} €` : `${v.toFixed(2).replace('.', ',')} €`
}
// Prix du 1er mois après remise « offre de bienvenue ».
const welcomePrice = (cents: number, off: number) => fmtEur(Math.round(cents * (1 - off / 100)))

// Construit les cartes de plan depuis les données catalogue (paliers IA + BYOK).
function buildPlans(p: PublicPricing): Plan[] {
  const short = (label: string) => label.replace(/^IA\s+/i, '')
  const plans: Plan[] = p.ai_tiers.map(t => ({
    id: t.id,
    name: short(t.label),
    priceCents: t.price_cents,
    tagline: `${t.included_replies.toLocaleString('fr-FR')} réponses IA incluses par mois.`,
    features: ['Socle inclus', `${t.included_replies.toLocaleString('fr-FR')} réponses IA / mois`],
    welcomeOff: p.intro_discounts[t.id] ?? 0,
    featured: t.id === 'ai_growth',
    badge: t.id === 'ai_growth' ? 'Populaire' : undefined,
  }))
  if (p.byok_price_cents != null) {
    plans.push({
      id: 'byok',
      name: 'BYOK',
      priceCents: p.byok_price_cents,
      tagline: 'Votre propre clé IA : réponses illimitées.',
      features: ['Socle inclus', 'Votre clé Anthropic / OpenAI / Gemini', 'Réponses illimitées, non métrées'],
      welcomeOff: p.intro_discounts.default ?? 0,
    })
  }
  return plans
}

const cardBase: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E2E8F0',
  borderRadius: 24,
  padding: '26px 24px',
  boxShadow: '0 6px 20px -12px rgba(28,63,92,.18)',
  textAlign: 'left',
  display: 'flex',
  flexDirection: 'column',
}

// Visuel (icône + teinte) par module — purement décoratif. Les modules eux-mêmes
// (clés, labels, prix) restent issus du fetch /api/billing/pricing. Repli neutre
// pour toute clé inconnue ajoutée côté admin.
type ModuleVisual = { bg: string; co: string; icon: React.ReactNode }
const MODULE_VISUALS: Record<string, ModuleVisual> = {
  rag: { bg: 'rgba(47,158,121,.12)', co: '#2F9E79', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 5.5C5 4.7 5.7 4 6.5 4H18a1 1 0 011 1v13.5a1 1 0 01-1 1H6.5A1.5 1.5 0 015 18z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M5 16.5A1.5 1.5 0 016.5 15H19" stroke="currentColor" strokeWidth="1.7" /><path d="M9 8.5h6M9 11h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg> },
  inbox: { bg: 'rgba(140,109,255,.12)', co: '#8C6DFF', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6h16v10H9l-4 3.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M8.5 10.5h7M8.5 13h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg> },
  actions: { bg: 'rgba(232,106,95,.12)', co: '#E86A5F', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M13 3L5 13h6l-1 8 8-10h-6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg> },
  ab: { bg: 'rgba(47,158,121,.12)', co: '#2F9E79', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M9 4H5v16h4M15 4h4v16h-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 7v10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeDasharray="2 2.5" /></svg> },
  white_label: { bg: 'rgba(140,109,255,.12)', co: '#8C6DFF', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 8.5l7.2-4.2a1.6 1.6 0 011.6 0L20 8.5v7l-7.2 4.2a1.6 1.6 0 01-1.6 0L4 15.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.7" /></svg> },
  mcp: { bg: 'rgba(232,106,95,.12)', co: '#E86A5F', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="9" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M9 9V6a3 3 0 016 0v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="12" cy="14.5" r="1.4" fill="currentColor" /></svg> },
}
const FALLBACK_VISUAL: ModuleVisual = { bg: 'rgba(28,63,92,.1)', co: '#1C3F5C', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.7" /><path d="M9 12h6M12 9v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg> }

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className="ch-reveal" style={{
      ...cardBase,
      border: plan.featured ? '2px solid #2F9E79' : cardBase.border,
      boxShadow: plan.featured ? '0 18px 44px -22px rgba(47,158,121,.5)' : cardBase.boxShadow,
      position: 'relative',
    }}>
      {plan.badge && (
        <span style={{
          position: 'absolute', top: -12, right: 20, background: '#2F9E79', color: '#fff',
          fontSize: 11, fontWeight: 700, letterSpacing: '.04em', padding: '4px 11px', borderRadius: 999,
        }}>{plan.badge}</span>
      )}
      <div style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 18, color: '#1E2A32' }}>{plan.name}</div>
      <div style={{ margin: '10px 0 2px', display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 36, color: '#1C3F5C', letterSpacing: '-.02em' }}>{fmtEur(plan.priceCents)}</span>
        <span style={{ fontSize: 13, color: '#6B7B8D' }}>/mois</span>
      </div>
      {/* Offre de bienvenue : affichée UNIQUEMENT si une remise existe pour ce plan. */}
      {plan.welcomeOff > 0 && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '2px 0 0', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#E86A5F' }}>1er mois {welcomePrice(plan.priceCents, plan.welcomeOff)}</span>
          <span style={{ fontSize: 11.5, color: '#8A98A6', textDecoration: 'line-through' }}>{fmtEur(plan.priceCents)}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#E86A5F' }}>−{plan.welcomeOff}%</span>
        </div>
      )}
      <p style={{ fontSize: 13.5, lineHeight: 1.5, color: '#6B7B8D', margin: '8px 0 16px' }}>{plan.tagline}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 9 }}>
        {plan.features.map(f => (
          <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: '#1E2A32' }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}><Check stroke="#2F9E79" size={16} /></span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Pricing({ ctaTo }: { ctaTo: string }) {
  // Prix LIVE depuis la base (public). Initialisé au FALLBACK -> le pré-rendu SSG
  // et le 1er rendu client affichent des prix cohérents, remplacés après fetch.
  const [pricing, setPricing] = useState<PublicPricing>(FALLBACK)
  useEffect(() => {
    let alive = true
    api<PublicPricing>('/api/billing/pricing')
      .then(d => { if (alive && d && Array.isArray(d.ai_tiers)) setPricing(d) })
      .catch(() => { /* repli silencieux sur FALLBACK */ })
    return () => { alive = false }
  }, [])

  const plans = buildPlans(pricing)
  const maxOff = Math.max(0, ...Object.values(pricing.intro_discounts || {}))
  const hasOffer = maxOff > 0

  return (
    <section id="pricing" style={{ background: '#F0F2F5', padding: '88px 0' }}>
      <div className="ch-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '0 32px' }}>
        <div className="ch-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 32px' }}>
          <span style={eyebrow('#2F9E79')}>TARIFS</span>
          <h2 className="ch-section-h2" style={sectionH2}>À la carte, sans engagement.</h2>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: '#6B7B8D', margin: '14px auto 0', maxWidth: 580 }}>
            Un socle clair, des modules à la carte. Sans engagement, annulable à tout moment.
          </p>
        </div>

        {/* Bandeau « offre de bienvenue » : masqué si aucune remise d'intro active. */}
        {hasOffer && (
          <div className="ch-reveal" style={{
            maxWidth: 720, margin: '0 auto 46px', borderRadius: 18,
            background: 'linear-gradient(100deg, rgba(232,106,95,.12), rgba(140,109,255,.12))',
            border: '1px solid rgba(232,106,95,.28)', padding: '16px 22px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', textAlign: 'center',
          }}>
            <span style={{
              background: '#E86A5F', color: '#fff', fontSize: 11.5, fontWeight: 700,
              letterSpacing: '.04em', padding: '5px 12px', borderRadius: 999, whiteSpace: 'nowrap',
            }}>OFFRE DE BIENVENUE</span>
            <span style={{ fontFamily: JAKARTA, fontSize: 14.5, lineHeight: 1.5, color: '#1E2A32', fontWeight: 500 }}>
              <strong style={{ fontWeight: 700 }}>1er mois jusqu’à −{maxOff} %</strong> sur votre palier IA, puis plein tarif. Sans engagement, annulable à tout moment.
            </span>
          </div>
        )}

        {/* Socle. */}
        <div className="ch-reveal" style={{ ...cardBase, maxWidth: 720, margin: '0 auto 28px', textAlign: 'center', alignItems: 'center' }}>
          <div style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 18, color: '#1E2A32' }}>Socle — Bot en arbre</div>
          <div style={{ margin: '8px 0 2px', display: 'flex', alignItems: 'baseline', gap: 4, justifyContent: 'center' }}>
            <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 38, color: '#1C3F5C', letterSpacing: '-.02em' }}>{fmtEur(pricing.base_price_cents)}</span>
            <span style={{ fontSize: 13, color: '#6B7B8D' }}>/mois</span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: '#6B7B8D', margin: '6px 0 0', maxWidth: 520 }}>
            Menus à clics illimités, personnalisation de l’apparence, déclencheurs proactifs et analytics.
            Fonctionne sans IA. <strong style={{ color: '#1E2A32' }}>Inclus gratuitement dès qu’un plan IA est pris.</strong>
          </p>
        </div>

        {/* Plans IA. */}
        <div className="ch-reveal" style={{ textAlign: 'center', margin: '0 0 18px' }}>
          <span style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 15, color: '#1E2A32' }}>Ajoutez l’IA</span>
        </div>
        <div className="ch-pricing-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 22, alignItems: 'stretch' }}>
          {plans.map(p => <PlanCard key={p.id} plan={p} />)}
        </div>

        {/* Modules à la carte. */}
        <div className="ch-reveal" style={{ textAlign: 'center', margin: '46px 0 18px' }}>
          <span style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 15, color: '#1E2A32' }}>Modules à la carte</span>
          <p style={{ fontSize: 13.5, color: '#6B7B8D', margin: '6px auto 0', maxWidth: 520 }}>
            Activez-les sur n’importe quel bot, à tout moment. Facturés au prorata.
          </p>
        </div>
        <div className="ch-modules-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {pricing.modules.map(m => {
            const v = MODULE_VISUALS[m.key] ?? FALLBACK_VISUAL
            return (
              <div key={m.key} className="ch-reveal" style={{ ...cardBase, padding: '22px 20px' }}>
                <span style={{ width: 42, height: 42, borderRadius: 12, background: v.bg, color: v.co, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{v.icon}</span>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, margin: '14px 0 0' }}>
                  <span style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 15, color: '#1E2A32' }}>{m.label}</span>
                  <span style={{ fontWeight: 700, fontSize: 15, color: '#1C3F5C', whiteSpace: 'nowrap' }}>{fmtEur(m.price_cents)}<span style={{ fontSize: 11.5, fontWeight: 400, color: '#6B7B8D' }}> /mois</span></span>
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.5, color: '#6B7B8D', margin: '7px 0 0' }}>{m.description}</p>
              </div>
            )
          })}
        </div>

        {/* CTA + mentions (la ligne « remise » n'apparaît que si une offre est active). */}
        <div className="ch-reveal" style={{ textAlign: 'center', marginTop: 40 }}>
          <Link to={ctaTo} className="ch-cta-primary" style={btnPrimary}>
            {hasOffer ? 'Profiter de l’offre de bienvenue →' : 'Composer mon abonnement →'}
          </Link>
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: '#8A98A6', margin: '16px auto 0', maxWidth: 560 }}>
            {hasOffer && `1er mois remisé selon le palier IA (jusqu’à −${maxOff} %), puis plein tarif. `}
            Sans engagement, annulable à tout moment. Prix nets par bot et par mois. {pricing.tax_note}.
          </p>
        </div>
      </div>
    </section>
  )
}
