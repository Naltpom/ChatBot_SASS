// Section tarifs : modèle MODULAIRE à la carte (essai 7 j avec carte, sans
// engagement). Page MARKETING statique — les prix sont en dur ICI (assumé, non
// connecté au catalogue /api/billing/catalog) mais ALIGNÉS sur le catalogue seed
// (api/scripts/seed_billing_catalog.py, figé 2026-06-20). Aucune promesse
// « gratuit à vie / sans carte » : essai 7 jours avec carte, annulable.
import { Link } from 'react-router-dom'
import { CLASH, JAKARTA, btnPrimary, eyebrow, sectionH2, Check } from './data'

// Prix NETS en euros/mois (TVA non applicable, art. 293 B du CGI). Alignés sur le
// catalogue seed : base 9, ai_starter 19 (1000), ai_growth 39 (3000),
// ai_scale 89 (10000), mod_ai_byok 29, mod_rag 9, mod_inbox 15, mod_actions 12,
// mod_mcp 9, mod_ab 7, mod_whitelabel 9.
type Plan = {
  name: string
  price: number
  unit: string
  tagline: string
  features: string[]
  featured?: boolean
  badge?: string
}

const AI_PLANS: Plan[] = [
  {
    name: 'Starter',
    price: 19,
    unit: '/mois',
    tagline: '1 000 réponses IA incluses par mois.',
    features: ['Socle inclus', 'Claude Haiku / GPT-4o-mini', '1 000 réponses IA / mois'],
  },
  {
    name: 'Growth',
    price: 39,
    unit: '/mois',
    tagline: '3 000 réponses IA — pour un support actif.',
    features: ['Socle inclus', 'Claude Sonnet en plus', '3 000 réponses IA / mois'],
    featured: true,
    badge: 'Populaire',
  },
  {
    name: 'Scale',
    price: 89,
    unit: '/mois',
    tagline: '10 000 réponses IA pour les sites à fort trafic.',
    features: ['Socle inclus', 'Haut volume', '10 000 réponses IA / mois'],
  },
  {
    name: 'BYOK',
    price: 29,
    unit: '/mois',
    tagline: 'Votre propre clé IA : réponses illimitées.',
    features: ['Socle inclus', 'Votre clé Anthropic / OpenAI / Gemini', 'Réponses illimitées, non métrées'],
  },
]

// Modules forfaitaires à la carte (kind=module), ajoutables à n'importe quel plan.
const MODULES: { name: string; price: number; desc: string }[] = [
  { name: 'Connaissances (RAG)', price: 9, desc: 'Indexez pages, PDF et FAQ ; l’IA répond depuis vos contenus.' },
  { name: 'Live chat / Inbox', price: 15, desc: 'Vos conseillers reprennent la main, avec boîte de réception.' },
  { name: 'Actions', price: 12, desc: 'Webhooks, capture de leads, tickets, créneaux — exécutables dans un arbre, sans IA.' },
  { name: 'MCP (outils IA)', price: 9, desc: 'Branchez l’IA sur vos serveurs/outils MCP, appelés pendant la conversation.' },
  { name: 'A/B testing', price: 7, desc: 'Comparez deux versions d’arbre et mesurez la meilleure.' },
  { name: 'White-label', price: 9, desc: 'Retire la mention « Propulsé par Chapote » du widget.' },
]

const euro = (n: number) => `${n} €`

// Carte de base (charte landing : fond blanc, bord clair, radius 24).
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
        <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 36, color: '#1C3F5C', letterSpacing: '-.02em' }}>{euro(plan.price)}</span>
        <span style={{ fontSize: 13, color: '#6B7B8D' }}>{plan.unit}</span>
      </div>
      <p style={{ fontSize: 13.5, lineHeight: 1.5, color: '#6B7B8D', margin: '4px 0 16px' }}>{plan.tagline}</p>
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
  return (
    <section id="pricing" style={{ background: '#F0F2F5', padding: '88px 0' }}>
      <div className="ch-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '0 32px' }}>
        {/* En-tête : essai 7 jours avec carte, sans engagement. */}
        <div className="ch-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 46px' }}>
          <span style={eyebrow('#2F9E79')}>TARIFS</span>
          <h2 className="ch-section-h2" style={sectionH2}>À la carte, sans engagement.</h2>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: '#6B7B8D', margin: '14px auto 0', maxWidth: 580 }}>
            Essai 7 jours (carte requise, 0 € prélevé pendant l’essai), puis un socle clair
            et des modules à la carte. Annulable à tout moment.
          </p>
        </div>

        {/* Socle : bot en arbre, facturé seul, inclus dès qu'un plan IA est pris. */}
        <div className="ch-reveal" style={{ ...cardBase, maxWidth: 720, margin: '0 auto 28px', textAlign: 'center', alignItems: 'center' }}>
          <div style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 18, color: '#1E2A32' }}>Socle — Bot en arbre</div>
          <div style={{ margin: '8px 0 2px', display: 'flex', alignItems: 'baseline', gap: 4, justifyContent: 'center' }}>
            <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 38, color: '#1C3F5C', letterSpacing: '-.02em' }}>{euro(9)}</span>
            <span style={{ fontSize: 13, color: '#6B7B8D' }}>/mois</span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: '#6B7B8D', margin: '6px 0 0', maxWidth: 520 }}>
            Menus à clics illimités, personnalisation de l’apparence, déclencheurs proactifs et analytics.
            Fonctionne sans IA. <strong style={{ color: '#1E2A32' }}>Inclus gratuitement dès qu’un plan IA est pris.</strong>
          </p>
        </div>

        {/* Plans IA (managés + BYOK). */}
        <div className="ch-reveal" style={{ textAlign: 'center', margin: '0 0 18px' }}>
          <span style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 15, color: '#1E2A32' }}>Ajoutez l’IA</span>
        </div>
        <div className="ch-pricing-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 22, alignItems: 'stretch' }}>
          {AI_PLANS.map(p => <PlanCard key={p.name} plan={p} />)}
        </div>

        {/* Modules à la carte. */}
        <div className="ch-reveal" style={{ textAlign: 'center', margin: '46px 0 18px' }}>
          <span style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 15, color: '#1E2A32' }}>Modules à la carte</span>
          <p style={{ fontSize: 13.5, color: '#6B7B8D', margin: '6px auto 0', maxWidth: 520 }}>
            Activez-les sur n’importe quel bot, à tout moment. Facturés au prorata.
          </p>
        </div>
        <div className="ch-modules-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {MODULES.map(m => (
            <div key={m.name} className="ch-reveal" style={{ ...cardBase, padding: '20px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 15, color: '#1E2A32' }}>{m.name}</span>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#1C3F5C', whiteSpace: 'nowrap' }}>{euro(m.price)}<span style={{ fontSize: 11.5, fontWeight: 400, color: '#6B7B8D' }}> /mois</span></span>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.5, color: '#6B7B8D', margin: '8px 0 0' }}>{m.desc}</p>
            </div>
          ))}
        </div>

        {/* CTA + mentions. */}
        <div className="ch-reveal" style={{ textAlign: 'center', marginTop: 40 }}>
          <Link to={ctaTo} className="ch-cta-primary" style={btnPrimary}>Démarrer l’essai 7 jours →</Link>
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: '#8A98A6', margin: '16px auto 0', maxWidth: 560 }}>
            Sans engagement, annulable à tout moment — l’essai s’arrête sans prélèvement.
            Prix nets par bot et par mois. TVA non applicable, art. 293 B du CGI.
          </p>
        </div>
      </div>
    </section>
  )
}
