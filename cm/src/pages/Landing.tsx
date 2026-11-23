// Page d'accueil publique de cm.chapote.fr (v3). Ce qu'elle annonce est ce que l'app fait
// aujourd'hui : publication programmée multi-comptes, calendrier passé + futur, statistiques
// unifiées, groupes de comptes. Mobile d'abord.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../components/ui'
import { useSession } from '../session'
import '../landing.css'

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) { setInView(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect() } }, { rootMargin: '0px 0px -8% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} className={`lp-reveal${inView ? ' in' : ''} ${className}`} style={{ transitionDelay: `${delay}s` }}>{children}</div>
}

const FAQ: [string, string][] = [
  ['Quelles plateformes sont prises en charge ?', 'TikTok (publication directe ou brouillon dans l’app), YouTube Shorts et Instagram Reels (comptes professionnels Créateur ou Entreprise). Plusieurs comptes par plateforme.'],
  ['Faut-il créer un nouveau compte ?', 'Non : c’est le même compte Chapote que sur chapote.fr et music.chapote.fr, par e-mail ou avec Google.'],
  ['Qu’est-ce qu’un groupe de comptes ?', 'Un regroupement libre, toutes plateformes confondues : un artiste, un client, une langue… Un compte peut être dans plusieurs groupes. Accueil, planning et statistiques se filtrent par groupe, et la publication sélectionne un groupe en un geste.'],
  ['D’où viennent les statistiques ?', 'Des API officielles de chaque plateforme, relevées plusieurs fois par jour. Chaque plateforme ne donne pas les mêmes chiffres : Chapote affiche ce qui existe vraiment (YouTube ne fournit pas les partages, TikTok pas les enregistrements). Les chiffres TikTok s’affichent une fois l’accès validé par TikTok.'],
  ['Le calendrier montre-t-il ce que j’ai publié ailleurs ?', 'Oui : les vidéos relevées sur vos comptes apparaissent à leur date, avec vues, j’aime et commentaires, même publiées hors de Chapote. Le futur montre ce qui est programmé.'],
  ['Que deviennent mes vidéos ?', 'Gardées le temps de les publier sur les comptes choisis, puis supprimées de nos serveurs. Rien ne part avant l’heure choisie.'],
  ['Puis-je travailler en équipe ?', 'Oui : les équipes de chapote.fr ont leur propre espace, avec leurs comptes, leur planning et leurs groupes.'],
]

export default function Landing() {
  const { appUrl } = useSession()
  const [on, setOn] = useState(false)
  useEffect(() => {
    document.title = 'Chapote CM · Publiez sur TikTok, YouTube et Instagram'
    const t = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(t)
  }, [])
  const chapote = appUrl.replace(/\/$/, '')

  return (
    <div className={`lp${on ? ' on' : ''}`}>
      <header className="lp-top">
        <div className="lp-wrap lp-top-row">
          <Brand to="/" />
          <nav className="lp-nav" aria-label="Sections">
            <a href="#fonctions">Fonctionnalités</a><a href="#stats">Statistiques</a><a href="#groupes">Groupes</a><a href="#faq">Questions</a>
          </nav>
          <span style={{ flex: 1 }} />
          <Link to="/connexion" className="btn btn-ghost btn-sm">Connexion</Link>
          <Link to="/inscription" className="lp-btn">Essayer</Link>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-wrap">
            <p className="lp-kicker">TikTok · YouTube Shorts · Instagram Reels</p>
            <h1 className="lp-title"><span>Publiez partout.</span><span className="blue">Voyez tout.</span></h1>
            <p className="lp-lead">Une vidéo, tous vos comptes, à l’heure choisie. Puis toutes vos statistiques dans un seul calendrier.</p>
            <div className="lp-ctas">
              <Link to="/inscription" className="lp-btn">Créer mon compte</Link>
              <a href="#fonctions" className="lp-more">Voir comment ça marche ›</a>
            </div>
            <div className="lp-reel" aria-hidden="true">
              <div className="lp-clip"><small>Instagram · hier</small><b>Coulisses du studio</b><em>12,9 k vues</em></div>
              <div className="lp-clip mid">
                <span className="lp-badge">Programmée · demain 18:30</span>
                <div><b style={{ fontSize: 'clamp(14px, 4vw, 18px)', display: 'block' }}>Nocturne op. 9 — partie 2</b>
                  <div className="lp-pills"><span>TikTok</span><span>YouTube</span><span>Instagram</span></div></div>
              </div>
              <div className="lp-clip"><small>TikTok · lundi</small><b>Clair de lune — main gauche</b><em>48,2 k vues</em></div>
            </div>
          </div>
        </section>

        <section id="fonctions" className="lp-sec lp-gray">
          <div className="lp-wrap">
            <Reveal><h2 className="lp-h2" style={{ maxWidth: 780 }}>Tout ce qu’il faut pour publier. Rien qui encombre.</h2></Reveal>
            <div className="lp-plats">
              <span><span className="dot dot-tiktok" />TikTok</span><span><span className="dot dot-youtube" />YouTube Shorts</span><span><span className="dot dot-instagram" />Instagram Reels</span>
            </div>
            <div className="lp-bento">
              <Reveal className="wide"><article className="lp-card" style={{ height: '100%' }}>
                <span className="k">Publier</span>
                <h3>Une vidéo. Douze comptes. Une seule fois.</h3>
                <p>Heure commune ou propre à chaque compte, légende commune ou par plateforme, réglages de chaque plateforme respectés. Rien ne part avant l’heure.</p>
                <div className="row" style={{ gap: 8 }}><span className="lp-tag">18:30 · TikTok</span><span className="lp-tag">18:30 · YouTube</span><span className="lp-tag">19:00 · Instagram</span></div>
              </article></Reveal>
              <Reveal delay={0.06}><article className="lp-card dark" style={{ height: '100%' }}>
                <span className="k">Calendrier</span>
                <h3>Le passé avec ses chiffres. Le futur programmé.</h3>
                <p>Vos vidéos publiées, même ailleurs, s’affichent à leur date avec vues, j’aime et abonnés gagnés.</p>
              </article></Reveal>
              <Reveal><article className="lp-card" style={{ height: '100%' }}>
                <span className="k">Statistiques</span>
                <h3>Une seule langue pour trois plateformes.</h3>
                <p>Abonnés, vues, j’aime, commentaires, partages, enregistrements, engagement.</p>
              </article></Reveal>
              <Reveal delay={0.06}><article className="lp-card" style={{ height: '100%' }}>
                <span className="k">Groupes</span>
                <h3>Par artiste, client ou langue.</h3>
                <p>Un compte peut être dans plusieurs groupes. Tout se filtre en un geste.</p>
              </article></Reveal>
              <Reveal delay={0.12}><article className="lp-card" style={{ height: '100%' }}>
                <span className="k">Moments</span>
                <h3>Publiez quand on vous regarde.</h3>
                <p>Jour × heure × vues moyennes : le bon créneau saute aux yeux.</p>
              </article></Reveal>
            </div>
          </div>
        </section>

        <section className="lp-sec">
          <div className="lp-wrap">
            <Reveal><h2 className="lp-h2">Trois étapes. Puis plus rien à faire.</h2></Reveal>
            <div className="lp-steps">
              {[['1', 'Connectez vos comptes', 'TikTok, YouTube et Instagram par leurs connexions officielles, plusieurs comptes si besoin.'],
                ['2', 'Envoyez et programmez', 'La vidéo, les comptes (ou un groupe), l’heure et les réglages de chaque plateforme.'],
                ['3', 'Suivez les résultats', 'Statut de chaque publication, puis vues, abonnés et interactions.']].map(([n, t, d], i) => (
                <Reveal key={n} delay={i * 0.08}><div className="lp-step"><span className="n">{n}</span><h3>{t}</h3><p>{d}</p></div></Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="stats" className="lp-sec" style={{ paddingTop: 0 }}>
          <div className="lp-wrap lp-stats">
            <Reveal>
              <h2 className="lp-h2">Ce qui marche. Sans tableur.</h2>
              <p className="lp-lead">Par plateforme, par compte, par groupe. Si une plateforme ne fournit pas un chiffre, c’est écrit.</p>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="lp-kpis" aria-label="Exemple de tableau de bord">
                <div className="lp-kpi"><small>Vues · 30 j</small><b>1,28 M</b><em>+18 %</em></div>
                <div className="lp-kpi"><small>Abonnés</small><b>84 312</b><em>+2 418</em></div>
                <div className="lp-kpi"><small>Engagement</small><b>7,4 %</b><em className="m">j’aime, commentaires, partages</em></div>
                <div className="lp-kpi"><small>Publications</small><b>46</b><em className="m">sur 9 comptes</em></div>
              </div>
              <p className="tiny muted" style={{ marginTop: 8 }}>Exemple illustratif.</p>
            </Reveal>
          </div>
        </section>

        <section id="groupes" className="lp-sec" style={{ paddingTop: 0 }}>
          <div className="lp-wrap">
            <Reveal>
              <div className="lp-groups">
                <div>
                  <h2>Plusieurs comptes par groupe. Plusieurs groupes par compte.</h2>
                  <p className="lp-lead" style={{ fontSize: 17 }}>Choisissez un groupe en haut de l’écran : accueil, planning et statistiques ne montrent plus que lui.</p>
                </div>
                <div>
                  <div className="lp-chips"><span className="on">Tous les comptes</span><span><span className="gdot g-purple" />Ghost Hands</span><span><span className="gdot g-teal" />Piano FR</span></div>
                  <div className="lp-acc">
                    <div><span className="dot dot-tiktok" />@ghosthands<small>Ghost Hands · Piano FR</small></div>
                    <div><span className="dot dot-youtube" />Ghost Hands<small>Ghost Hands</small></div>
                    <div><span className="dot dot-instagram" />@piano.fr<small>Piano FR</small></div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="faq" className="lp-sec" style={{ paddingTop: 0 }}>
          <div className="lp-wrap" style={{ maxWidth: 880 }}>
            <h2 className="lp-h2">Questions fréquentes</h2>
            <div className="lp-faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
          </div>
        </section>

        <section className="lp-wrap" style={{ paddingBottom: 72 }}>
          <Reveal>
            <div className="lp-final">
              <h2>Votre prochaine vidéo part à l’heure.</h2>
              <div className="lp-ctas"><Link to="/inscription" className="lp-btn">Créer mon compte</Link><Link to="/connexion" className="lp-more">J’ai déjà un compte ›</Link></div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div className="col" style={{ gap: 10 }}><Brand to="/" /><p>Publication programmée et statistiques pour TikTok, YouTube et Instagram.</p></div>
          <div><h2 className="lp-fh">Chapote</h2><ul><li><a href={chapote}>chapote.fr</a></li><li><a href="https://music.chapote.fr">music.chapote.fr</a></li><li><Link to="/connexion">Connexion</Link></li></ul></div>
          <div><h2 className="lp-fh">Légal</h2><ul><li><Link to="/privacy">Confidentialité</Link></li><li><Link to="/terms">Conditions d’utilisation</Link></li><li><a href={`${chapote}/legal/mentions-legales`}>Mentions légales</a></li></ul></div>
          <div><h2 className="lp-fh">Plateformes</h2><ul><li><a href={`${chapote}/legal/tiktok-confidentialite`}>TikTok</a></li><li><a href={`${chapote}/legal/youtube-confidentialite`}>YouTube</a></li><li><a href={`${chapote}/legal/instagram-confidentialite`}>Instagram</a></li></ul></div>
        </div>
      </footer>
    </div>
  )
}
