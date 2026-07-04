// Page « À propos » (/a-propos) : page d'ENTITÉ optimisée SEO/GEO. Répond dès les
// premières phrases (pyramide inversée) « Qu'est-ce que Chapote ? » pour être
// facilement extraite par Google (rich results) et les moteurs génératifs
// (ChatGPT / Perplexity / Google AI Overviews). Contenu 100 % véridique.
// PRÉRENDUE (SSG) via prerenderRoutes.ts -> le HTML + le JSON-LD FAQPage sont
// présents sans exécuter de JS (crawlable + citable). SSR-safe : aucune API
// navigateur au rendu (mêmes primitives que la Landing prérendue).
import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { useChapoteAssets } from '../components/landing/assets'
import { Header } from '../components/landing/Header'
import { Footer } from '../components/landing/Footer'
import { CLASH, JAKARTA, btnPrimary, btnSecondary, Check } from '../components/landing/data'

const INK = '#1E2A32'
const MUT = '#6B7B8D'

// FAQ = SOURCE UNIQUE : rendue VISIBLEMENT (ci-dessous) ET sérialisée en JSON-LD
// FAQPage (Google exige que le contenu du FAQPage soit visible sur la page).
const FAQ: { q: string; a: string }[] = [
  {
    q: "Qu'est-ce que Chapote ?",
    a: "Chapote est un chatbot hybride français pour sites web : il combine un arbre de décision guidé illimité, une IA plafonnée (aux coûts maîtrisés) et un relais vers un conseiller humain. Il s'installe en une seule balise à copier-coller ou via le plugin WordPress « Chapote Bot Manager ».",
  },
  {
    q: "Qu'est-ce qu'un chatbot « hybride » ?",
    a: "Un chatbot hybride mélange trois modes de réponse : un arbre de décision à clics (rapide, sans IA), une IA plafonnée pour les questions ouvertes (coûts sous contrôle) et un relais humain quand un conseiller doit reprendre la conversation. On garde le meilleur de chaque approche.",
  },
  {
    q: "Comment installe-t-on Chapote sur un site ?",
    a: "On colle une seule balise fournie dans l'espace d'administration, ou on installe le plugin WordPress « Chapote Bot Manager ». Chapote fonctionne aussi sur Shopify, Webflow et tout site permettant d'ajouter une balise.",
  },
  {
    q: "Chapote est-il conforme au RGPD ?",
    a: "Oui. Chapote est hébergé en France et conçu « RGPD par défaut » : les données restent en Europe, sans configuration supplémentaire.",
  },
  {
    q: "Combien coûte Chapote ?",
    a: "La tarification est modulaire : un socle « bot en arbre » à partir de 9 €/mois, des paliers IA (de 19 à 89 €/mois selon le volume de réponses incluses) et des modules à la carte (connaissances/RAG, live chat, actions, MCP, A/B testing, white-label). Sans engagement, annulable à tout moment.",
  },
  {
    q: "Chapote fonctionne-t-il avec WordPress ?",
    a: "Oui, via le plugin officiel « Chapote Bot Manager » qui installe et pilote le chatbot directement depuis l'administration WordPress.",
  },
  {
    q: "Qui édite Chapote ?",
    a: "Chapote est un service SaaS français, édité et hébergé en France, accessible sur https://chapote.fr. Contact : contact@chapote.fr.",
  },
]

const faqLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
}

// Les 3 temps du modèle hybride (contenu véridique, aligné sur la Landing).
const PILIERS: { t: string; d: string }[] = [
  { t: '1 · Arbre guidé illimité', d: "Des menus à clics qui répondent instantanément aux questions fréquentes, sans IA et sans surcoût. La base gratuite de chaque conversation." },
  { t: '2 · IA plafonnée', d: "Pour les questions ouvertes, une IA prend le relais — avec un plafond de réponses pour garder des coûts prévisibles (pas de facture qui s'emballe)." },
  { t: '3 · Relais humain', d: "Quand un conseiller fait la différence, la conversation bascule vers un humain, en douceur, depuis la boîte de réception." },
]

function Section({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <section style={{ maxWidth: 820, margin: '0 auto', padding: '0 24px', ...style }}>{children}</section>
}

const h2: React.CSSProperties = { fontFamily: CLASH, fontWeight: 600, fontSize: 26, lineHeight: 1.2, letterSpacing: '-.01em', color: INK, margin: '0 0 14px' }

export default function APropos() {
  const { user } = useAuth()
  useChapoteAssets()
  const ctaTo = user ? '/app' : '/register'

  return (
    <div style={{ fontFamily: "'Inter',system-ui,sans-serif", background: '#F9F9FB', color: INK, WebkitFontSmoothing: 'antialiased' }}>
      {/* JSON-LD FAQPage : présent dès le HTML prérendu (extraction Google + LLM). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, '\\u003c') }} />
      <Header user={user} ctaTo={ctaTo} />
      <main>
        {/* Réponse directe (pyramide inversée) dès le H1 + chapô. */}
        <Section style={{ padding: '56px 24px 8px' }}>
          <h1 style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 40, lineHeight: 1.15, letterSpacing: '-.02em', color: INK, margin: 0 }}>
            À propos de Chapote
          </h1>
          <p style={{ fontSize: 19, lineHeight: 1.6, color: INK, margin: '18px 0 0' }}>
            <strong>Chapote est un chatbot hybride français.</strong> Il combine un arbre de décision guidé
            illimité, une IA plafonnée (aux coûts maîtrisés) et un relais vers un conseiller humain — installable
            en une seule balise à copier-coller ou via le plugin WordPress «&nbsp;Chapote Bot Manager&nbsp;».
            RGPD par défaut, hébergement français.
          </p>
        </Section>

        {/* En bref : faits stables, format liste (très cité par les IA). */}
        <Section style={{ padding: '32px 24px 0' }}>
          <h2 style={h2}>En bref</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {[
              'Chatbot hybride : arbre guidé illimité + IA plafonnée + relais humain.',
              'Installation en une seule balise à copier-coller, ou plugin WordPress « Chapote Bot Manager ».',
              'Hébergement français, RGPD par défaut, coûts maîtrisés.',
              'Tarification modulaire : socle dès 9 €/mois, sans engagement.',
              'Éditeur : Chapote — https://chapote.fr — contact@chapote.fr.',
            ].map((t) => (
              <li key={t} style={{ display: 'flex', gap: 10, fontSize: 15.5, lineHeight: 1.55, color: INK }}>
                <span style={{ flexShrink: 0, marginTop: 3 }}><Check size={16} /></span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Le modèle hybride, en trois temps. */}
        <Section style={{ padding: '36px 24px 0' }}>
          <h2 style={h2}>Le modèle hybride, en trois temps</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {PILIERS.map(({ t, d }) => (
              <div key={t} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '20px 20px' }}>
                <div style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 16, color: INK }}>{t}</div>
                <p style={{ fontSize: 14.5, lineHeight: 1.55, color: MUT, margin: '8px 0 0' }}>{d}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* FAQ visible (miroir exact du JSON-LD FAQPage ci-dessus). */}
        <Section style={{ padding: '42px 24px 0' }}>
          <h2 style={h2}>Questions fréquentes</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {FAQ.map(({ q, a }) => (
              <div key={q} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '18px 20px' }}>
                <h3 style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 16.5, color: INK, margin: 0 }}>{q}</h3>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: MUT, margin: '8px 0 0' }}>{a}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* CTA. */}
        <Section style={{ padding: '42px 24px 72px', textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to={ctaTo} style={btnPrimary}>Installer Chapote →</Link>
            <Link to="/demo" style={btnSecondary}>Essayer la démo</Link>
          </div>
        </Section>
      </main>
      <Footer />
    </div>
  )
}
