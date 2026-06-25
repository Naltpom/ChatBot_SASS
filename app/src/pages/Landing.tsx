// Landing publique « Chapote » — composition des sections (refacto R4).
// Le contenu présentationnel est éclaté dans app/src/components/landing/* :
// header sticky, hero + widget animé, 4 piliers, comparatif, installation,
// logos, tarifs (modulaires, essai 7 j carte requise), témoignages, CTA final,
// footer. Les données statiques + tokens vivent dans landing/data, les assets
// (polices/keyframes/reveal) dans landing/assets. Rétro-compat DOM/visuelle
// préservée (landing.spec + responsive.spec).
import { useAuth } from '../AuthContext'
import { useChapoteAssets, useReveal } from '../components/landing/assets'
import { Header } from '../components/landing/Header'
import { Hero } from '../components/landing/Hero'
import { Piliers } from '../components/landing/Piliers'
import { Comparatif } from '../components/landing/Comparatif'
import { Install } from '../components/landing/Install'
import { Logos } from '../components/landing/Logos'
import { Pricing } from '../components/landing/Pricing'
import { Temoignages } from '../components/landing/Temoignages'
import { CtaFinal } from '../components/landing/CtaFinal'
import { Footer } from '../components/landing/Footer'

export default function Landing() {
  const { user } = useAuth()
  useChapoteAssets()
  useReveal()
  const ctaTo = user ? '/app' : '/register'

  return (
    <div className="chapote" style={{ fontFamily: "'Inter',system-ui,sans-serif", background: '#F9F9FB', color: '#1E2A32', WebkitFontSmoothing: 'antialiased' }}>
      <Header user={user} ctaTo={ctaTo} />
      {/* Repère principal (a11y : « main landmark ») englobant le contenu. */}
      <main>
        <Hero ctaTo={ctaTo} />
        <Piliers />
        <Comparatif />
        <Install />
        <Logos />
        <Pricing ctaTo={ctaTo} />
        <Temoignages />
        <CtaFinal ctaTo={ctaTo} />
      </main>
      <Footer />
    </div>
  )
}
