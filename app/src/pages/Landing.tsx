// Landing publique « Chapote » — composition des sections.
// Le contenu présentationnel est éclaté dans app/src/components/landing/* :
// header sticky, hero « Aiguillage » (question qui passe arbre → IA → humain),
// ce qu'est Chapote, pourquoi (moins cher / plus malin / plus rapide), bandeau
// défilant, « comment ça répond » (storytelling scrollé), coûts (courbe),
// installation (balise tapée au scroll), comparatif, tarifs (carte), CTA final,
// footer. Les données statiques + tokens vivent dans landing/data, les assets
// (polices/keyframes/reveal/progression de scroll) dans landing/assets.
import { useAuth } from '../AuthContext'
import { useChapoteAssets, useReveal } from '../components/landing/assets'
import { Header } from '../components/landing/Header'
import { Hero } from '../components/landing/Hero'
import { Chapote } from '../components/landing/Chapote'
import { Pourquoi } from '../components/landing/Pourquoi'
import { Marquee } from '../components/landing/Marquee'
import { Story } from '../components/landing/Story'
import { Couts } from '../components/landing/Couts'
import { Install } from '../components/landing/Install'
import { Comparatif } from '../components/landing/Comparatif'
import { Pricing } from '../components/landing/Pricing'
import { CtaFinal } from '../components/landing/CtaFinal'
import { Footer } from '../components/landing/Footer'

export default function Landing() {
  const { user } = useAuth()
  useChapoteAssets()
  useReveal()
  const ctaTo = user ? '/app' : '/register'

  return (
    <div className="chapote" style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif", background: '#F9F9FB', color: '#1E2A32', WebkitFontSmoothing: 'antialiased' }}>
      <Header user={user} ctaTo={ctaTo} />
      <main>
        <Hero ctaTo={ctaTo} />
        <Chapote />
        <Pourquoi />
        <Marquee />
        <Story />
        <Couts />
        <Install />
        <Comparatif />
        <Pricing ctaTo={ctaTo} />
        <CtaFinal ctaTo={ctaTo} />
      </main>
      <Footer />
    </div>
  )
}
