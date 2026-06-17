// Page publique « /showcase » — « Ils utilisent Chapote ».
// PRÉRENDUE (SSG) pour le SEO : même charte que la Landing (Header/CtaFinal/
// Footer réutilisés, tokens CLASH/JAKARTA). Contenu véridique et générique (pas
// de faux clients) ; l'annuaire dynamique opt-in viendra d'un endpoint public.
// SSR-safe : useChapoteAssets/useReveal n'agissent qu'en effets (jamais au rendu).
import { useAuth } from '../AuthContext'
import { useChapoteAssets, useReveal } from '../components/landing/assets'
import { Header } from '../components/landing/Header'
import { CtaFinal } from '../components/landing/CtaFinal'
import { Footer } from '../components/landing/Footer'
import { CLASH, JAKARTA } from '../components/landing/data'

const NAVY = '#1C3F5C'
const MINT = '#2F9E79'

// Secteurs où Chapote est pertinent (générique, véridique — pas de marques).
const SECTORS: { icon: string; title: string; desc: string; tint: string }[] = [
  { icon: '🛍️', title: 'E-commerce', desc: 'Suivi de commande, FAQ livraison/retours et capture de leads — l’arbre absorbe le volume, l’IA gère le reste.', tint: 'rgba(47,158,121,.1)' },
  { icon: '🤝', title: 'Services & conseil', desc: 'Qualification des demandes, prise de rendez-vous et relais vers un conseiller au bon moment.', tint: 'rgba(140,109,255,.1)' },
  { icon: '🏬', title: 'Commerce local', desc: 'Horaires, adresse, disponibilités : des réponses instantanées 24/7, sans budget IA qui s’envole.', tint: 'rgba(232,168,46,.14)' },
  { icon: '💻', title: 'SaaS & logiciel', desc: 'Support de premier niveau guidé, déflexion des tickets et escalade humaine pour les cas complexes.', tint: 'rgba(37,99,235,.1)' },
]

const STATS: { value: string; label: string }[] = [
  { value: '1 balise', label: 'à coller, une minute d’installation' },
  { value: 'Illimité', label: 'd’arbre guidé, gratuitement' },
  { value: '🇫🇷', label: 'hébergement français, RGPD par défaut' },
]

export default function Showcase() {
  const { user } = useAuth()
  useChapoteAssets()
  useReveal()
  const ctaTo = user ? '/app' : '/register'

  return (
    <div className="chapote" style={{ fontFamily: "'Inter',system-ui,sans-serif", background: '#F9F9FB', color: '#1E2A32', WebkitFontSmoothing: 'antialiased' }}>
      <Header user={user} ctaTo={ctaTo} />

      {/* Repère principal (a11y : « main landmark ») englobant le contenu. */}
      <main>
      {/* ===== Hero (visible sans JS : pas de ch-reveal) ===== */}
      <section style={{ maxWidth: 880, margin: '0 auto', padding: '72px 32px 36px', textAlign: 'center' }}>
        <span style={{ display: 'inline-block', background: 'rgba(47,158,121,.12)', color: '#1C7A5C', fontWeight: 600, fontSize: 13, padding: '6px 13px', borderRadius: 999 }}>
          Ils nous font confiance
        </span>
        <h1 style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 46, lineHeight: 1.1, letterSpacing: '-.02em', margin: '20px 0 0' }}>
          Ils utilisent Chapote
        </h1>
        <p style={{ fontFamily: JAKARTA, fontWeight: 500, fontSize: 18, lineHeight: 1.55, color: '#5B6B7A', margin: '18px auto 0', maxWidth: 620 }}>
          Le chatbot hybride français — arbre guidé illimité, IA plafonnée et relais humain — s’installe en une seule balise
          sur des sites e-commerce, de services, de commerces locaux et de logiciels. Voici comment il s’adapte à chaque métier.
        </p>
      </section>

      {/* ===== Bandeau de chiffres ===== */}
      <section style={{ maxWidth: 1000, margin: '0 auto', padding: '8px 32px 8px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14 }}>
          {STATS.map(s => (
            <div key={s.label} style={{ flex: '1 1 220px', maxWidth: 300, background: '#fff', border: '1px solid #E8ECF0', borderRadius: 16, padding: '20px 22px', textAlign: 'center', boxShadow: '0 10px 30px -22px rgba(28,63,92,.4)' }}>
              <div style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 26, color: NAVY }}>{s.value}</div>
              <div style={{ fontSize: 13.5, color: '#6B7B8D', marginTop: 6, lineHeight: 1.45 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Grille secteurs ===== */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '46px 32px 20px' }}>
        <h2 style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 30, letterSpacing: '-.02em', textAlign: 'center', margin: '0 0 8px' }}>
          Un assistant pour chaque type de site
        </h2>
        <p style={{ fontFamily: JAKARTA, fontWeight: 500, fontSize: 16, color: '#5B6B7A', textAlign: 'center', margin: '0 auto 34px', maxWidth: 560 }}>
          Quatre usages, une même promesse : répondre vite, garder l’humain là où il compte, sans coûts qui dérapent.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 18 }}>
          {SECTORS.map(s => (
            <div key={s.title} style={{ background: '#fff', border: '1px solid #E8ECF0', borderRadius: 18, padding: '24px 22px', boxShadow: '0 16px 40px -28px rgba(28,63,92,.35)' }}>
              <span style={{ width: 48, height: 48, borderRadius: 13, background: s.tint, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{s.icon}</span>
              <h3 style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 19, margin: '16px 0 0' }}>{s.title}</h3>
              <p style={{ fontSize: 14.5, lineHeight: 1.55, color: '#5B6B7A', margin: '9px 0 0' }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Encart « votre marque ici » (l'annuaire opt-in viendra ensuite) ===== */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '30px 32px 8px' }}>
        <div style={{ background: 'linear-gradient(135deg,rgba(47,158,121,.1),rgba(28,63,92,.06))', border: '1px dashed rgba(47,158,121,.45)', borderRadius: 18, padding: '26px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 26 }}>✨</div>
          <h3 style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 21, margin: '8px 0 0' }}>Votre marque ici</h3>
          <p style={{ fontFamily: JAKARTA, fontWeight: 500, fontSize: 15.5, color: '#5B6B7A', margin: '8px auto 0', maxWidth: 520, lineHeight: 1.5 }}>
            Installez Chapote gratuitement et rejoignez les sites qui répondent à leurs visiteurs en une minute.
          </p>
          <a href={ctaTo} style={{ display: 'inline-block', marginTop: 18, background: MINT, color: '#fff', borderRadius: 13, padding: '13px 22px', fontWeight: 600, fontSize: 15, textDecoration: 'none', boxShadow: '0 12px 26px -12px rgba(47,158,121,.7)' }}>
            Ajouter gratuitement la balise →
          </a>
        </div>
      </section>

      <div style={{ height: 40 }} />
      <CtaFinal ctaTo={ctaTo} />
      </main>
      <Footer />
    </div>
  )
}
