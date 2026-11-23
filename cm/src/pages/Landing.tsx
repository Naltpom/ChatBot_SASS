// Page d'accueil publique de cm.chapote.fr. Ce qu'elle annonce est ce que l'app fait aujourd'hui :
// publication programmée multi-comptes (TikTok, YouTube Shorts, Instagram Reels), calendrier qui
// mêle l'historique relevé chez les plateformes et le planning, statistiques unifiées, groupes.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Brand, Icon } from '../components/ui'
import { useSession } from '../session'
import '../landing.css'

const EVENTS = [
  { day: 'Hier', delta: '+148 abonnés', items: [
    { p: 'tiktok', c: '#c7d9f2', t: 'Clair de lune — main gauche', s: '48,2 k vues', plan: false },
    { p: 'instagram', c: '#c8eadb', t: 'Coulisses du studio', s: '12,9 k vues', plan: false },
  ] },
  { day: "Aujourd'hui", delta: '+36 abonnés', items: [
    { p: 'youtube', c: '#f6d3c3', t: 'Gymnopédie n°1 en 60 s', s: 'Publiée', plan: false },
  ] },
  { day: 'Demain', delta: '', items: [
    { p: 'tiktok', c: '#c7d9f2', t: 'Nocturne op. 9 — partie 2', s: '18:30', plan: true },
    { p: 'youtube', c: '#f6d3c3', t: 'Nocturne op. 9 — partie 2', s: '18:30', plan: true },
    { p: 'instagram', c: '#c8eadb', t: 'Nocturne op. 9 — partie 2', s: '19:00', plan: true },
  ] },
] as const

function useInView<T extends Element>() {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window)) { setInView(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect() } }, { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, inView] as const
}

function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return <div ref={ref} className={`lp-reveal${inView ? ' in' : ''} ${className}`} style={{ transitionDelay: `${delay}s` }}>{children}</div>
}

function Phone() {
  const [shown, setShown] = useState(0)
  const total = EVENTS.reduce((n, d) => n + d.items.length, 0)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setShown(total); return }
    let i = 0
    const start = setTimeout(function tick() {
      i = i >= total + 4 ? 0 : i + 1          // boucle : se remplit puis repart
      setShown(Math.min(i, total))
      timer = setTimeout(tick, i === 0 ? 500 : i > total ? 900 : 650)
    }, 1100)
    let timer: ReturnType<typeof setTimeout> = start
    return () => clearTimeout(timer)
  }, [total])
  let k = 0
  return (
    <div className="lp-phone" aria-hidden="true">
      <div className="lp-screen">
        <div className="lp-notch" />
        <div className="lp-sbar" />
        <div className="lp-s-head"><b>Planning</b><span style={{ color: '#5b6672', fontWeight: 600 }}>Tous les comptes ▾</span></div>
        <div className="lp-s-strip">
          {['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d, i) => (
            <div key={d} className={i === 3 ? 'on' : ''}>{d}<b>{23 + i}</b></div>
          ))}
        </div>
        <div className="lp-s-list">
          {EVENTS.map(d => (
            <div key={d.day} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="lp-s-day">{d.day}{d.delta && <span>{d.delta}</span>}</div>
              {d.items.map(x => {
                const idx = k++
                return (
                  <div key={idx} className={`lp-ev${idx < shown ? ' in' : ''}${x.plan ? ' plan' : ''}`}>
                    <span className="th" style={{ background: x.c }} />
                    <div className="tx"><div>{x.t}</div><small><span className={`dot dot-${x.p}`} />{x.p === 'tiktok' ? 'TikTok' : x.p === 'youtube' ? 'YouTube' : 'Instagram'}</small></div>
                    <span className="st" style={{ color: x.plan ? '#5b6672' : '#17784f' }}>{x.s}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="lp-s-tab"><i /><i /><span className="fab">+</span><i /><i /></div>
      </div>
    </div>
  )
}

const FAQ: [string, string][] = [
  ['Quelles plateformes sont prises en charge ?', 'TikTok (publication directe ou brouillon envoyé dans l’app), YouTube (Shorts) et Instagram (Reels, comptes professionnels Créateur ou Entreprise). Vous pouvez connecter plusieurs comptes par plateforme.'],
  ['Faut-il créer un nouveau compte ?', 'Non. C’est le même compte Chapote que sur chapote.fr et music.chapote.fr : connectez-vous avec votre e-mail ou avec Google.'],
  ['Qu’est-ce qu’un groupe de comptes ?', 'Un regroupement libre de comptes, toutes plateformes confondues : un artiste, un client, une langue… Un compte peut appartenir à plusieurs groupes. Le tableau de bord, le planning et les statistiques se filtrent par groupe, et la nouvelle publication sélectionne un groupe en un geste.'],
  ['D’où viennent les statistiques ?', 'Des API officielles de chaque plateforme, relevées automatiquement plusieurs fois par jour. Chaque plateforme ne donne pas les mêmes chiffres : Chapote affiche ce qui est réellement disponible (par exemple, YouTube ne fournit pas les partages, TikTok ne fournit pas les enregistrements). Les chiffres TikTok s’affichent une fois l’accès validé par TikTok.'],
  ['Le calendrier montre-t-il aussi ce que j’ai publié ailleurs ?', 'Oui. Les vidéos relevées sur vos comptes apparaissent dans le calendrier à leur date de publication, avec leurs vues, j’aime et commentaires, même si elles n’ont pas été publiées depuis Chapote. Le futur montre ce qui est programmé.'],
  ['Que deviennent mes vidéos ?', 'Une vidéo envoyée est gardée seulement le temps de la publier sur les comptes choisis, puis elle est supprimée de nos serveurs. Rien ne part avant l’heure que vous avez choisie.'],
  ['Puis-je travailler en équipe ?', 'Oui : les équipes de chapote.fr ont leur propre espace, avec leurs comptes, leur planning et leurs groupes, partagés entre les membres.'],
]

export default function Landing() {
  const { appUrl } = useSession()
  const [on, setOn] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    document.title = 'Chapote CM · Programmez TikTok, YouTube Shorts et Instagram Reels'
    const t = requestAnimationFrame(() => setOn(true))
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { cancelAnimationFrame(t); window.removeEventListener('scroll', onScroll) }
  }, [])
  const chapote = appUrl.replace(/\/$/, '')

  return (
    <div className={`lp${on ? ' on' : ''}`}>
      <header className={`lp-top${scrolled ? ' scrolled' : ''}`}>
        <div className="lp-wrap lp-top-row">
          <Brand to="/" />
          <nav className="lp-nav" aria-label="Sections">
            <a href="#fonctionnalites">Fonctionnalités</a>
            <a href="#groupes">Groupes</a>
            <a href="#chiffres">Statistiques</a>
            <a href="#faq">Questions</a>
          </nav>
          <span style={{ flex: 1 }} />
          <Link to="/connexion" className="btn btn-ghost">Connexion</Link>
          <Link to="/inscription" className="btn btn-primary only-desktop">Créer un compte</Link>
        </div>
      </header>

      <main>
        <section className="lp-wrap lp-hero">
          <div>
            <div className="lp-eyebrow">TikTok · YouTube Shorts · Instagram Reels</div>
            <h1 className="lp-title">
              <span className="ln"><span>Une vidéo.</span></span>
              <span className="ln"><span>Tous vos comptes.</span></span>
              <span className="ln"><span>Au bon moment.</span></span>
            </h1>
            <p className="lp-lead">Envoyez votre vidéo une fois, choisissez les comptes et l’heure : Chapote publie partout et rassemble vos chiffres dans un seul calendrier.</p>
            <div className="lp-hero-ctas">
              <Link to="/inscription" className="lp-cta">Commencer maintenant <Icon name="right" /></Link>
              <a href="#comment" className="lp-link">Voir comment ça marche</a>
            </div>
            <div className="lp-proof">
              <span><Icon name="check" size={16} />Même compte que chapote.fr</span>
              <span><Icon name="shield" size={16} />API officielles des plateformes</span>
              <span><Icon name="check" size={16} />Pensé pour le téléphone</span>
            </div>
          </div>
          <div className="lp-stage">
            <div className="lp-float lp-float-a" aria-hidden="true">
              <div className="tiny muted">Abonnés · 30 jours</div>
              <div className="big">+2 418</div>
              <svg width="132" height="30" viewBox="0 0 132 30" style={{ display: 'block', marginTop: 4 }}>
                <path d="M2 26 L20 22 L38 24 L56 16 L74 18 L92 10 L110 12 L130 3" fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <Phone />
            <div className="lp-float lp-float-b" aria-hidden="true">
              <div className="tiny muted" style={{ marginBottom: 8 }}>Une publication, 3 comptes</div>
              {(['tiktok', 'youtube', 'instagram'] as const).map(p => (
                <div key={p} className="row-nw" style={{ gap: 8, padding: '3px 0' }}>
                  <span className={`dot dot-${p}`} />
                  <span className="grow small">{p === 'tiktok' ? 'TikTok' : p === 'youtube' ? 'YouTube' : 'Instagram'}</span>
                  <span className="tiny status-ok">✓</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-wrap" aria-label="Plateformes">
          <div className="lp-plats">
            {([
              ['tiktok', 'T', 'TikTok', 'Publication directe ou brouillon dans l’app, options du créateur relues à chaque fois.'],
              ['youtube', 'Y', 'YouTube Shorts', 'Titre, description, visibilité, catégorie : tout se règle par chaîne.'],
              ['instagram', 'I', 'Instagram Reels', 'Comptes professionnels, légende propre, Reel affiché ou non dans le fil.'],
            ] as const).map(([p, l, n, d], i) => (
              <Reveal key={p} delay={i * 0.08}>
                <div className="lp-plat">
                  <span className="pm" style={{ background: `var(--${p})` }}>{l}</span>
                  <div><h3>{n}</h3><p>{d}</p></div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="fonctionnalites" className="lp-section">
          <div className="lp-wrap">
            <Reveal>
              <div className="lp-eyebrow">Fonctionnalités</div>
              <h2 className="lp-h2">Tout ce qu’il faut,<br />rien qui encombre.</h2>
            </Reveal>
            <div className="lp-bento">
              <Reveal className="wide"><article className="lp-card dark" style={{ height: '100%' }}>
                <span className="k">01 · PUBLIER</span>
                <h3>Programmez une fois, publiez partout.</h3>
                <p>Une vidéo, jusqu’à 12 comptes. Une heure commune ou une heure par compte, une légende commune ou propre à chaque plateforme. Rien n’est envoyé avant l’heure choisie.</p>
                <div className="viz" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['18:30 · TikTok', '18:30 · YouTube', '19:00 · Instagram', '19:00 · TikTok (2)'].map(x => (
                    <span key={x} style={{ background: '#0c1d2b', border: '1px solid rgba(255,255,255,.08)', borderRadius: 999, padding: '6px 12px', fontSize: 13 }}>{x}</span>
                  ))}
                </div>
              </article></Reveal>
              <Reveal delay={0.08}><article className="lp-card" style={{ height: '100%' }}>
                <span className="k">02 · CALENDRIER</span>
                <h3>Le calendrier qui se souvient.</h3>
                <p>Le passé montre vos vidéos réellement publiées, relevées chez les plateformes, avec leurs chiffres. Le futur montre le planning.</p>
              </article></Reveal>
              <Reveal><article className="lp-card" style={{ height: '100%' }}>
                <span className="k">03 · CHIFFRES</span>
                <h3>Toutes les stats, une seule langue.</h3>
                <p>Abonnés, vues, j’aime, commentaires, partages, enregistrements et taux d’engagement : par plateforme, par compte ou au total.</p>
              </article></Reveal>
              <Reveal delay={0.08}><article className="lp-card" style={{ height: '100%' }}>
                <span className="k">04 · GROUPES</span>
                <h3>Rangez vos comptes comme vous pensez.</h3>
                <p>Un groupe par artiste, par client, par langue. Un compte peut être dans plusieurs groupes. Tout se filtre en un geste.</p>
              </article></Reveal>
              <Reveal delay={0.16}><article className="lp-card" style={{ height: '100%' }}>
                <span className="k">05 · MOMENTS</span>
                <h3>Publiez quand on vous regarde.</h3>
                <p>La carte des meilleurs moments croise jour, heure et vues moyennes de vos vidéos pour vous aider à choisir l’heure.</p>
              </article></Reveal>
            </div>
          </div>
        </section>

        <section id="comment" className="lp-section" style={{ paddingTop: 0 }}>
          <div className="lp-wrap">
            <Reveal>
              <div className="lp-eyebrow">Comment ça marche</div>
              <h2 className="lp-h2">Trois étapes,<br />puis plus rien à faire.</h2>
            </Reveal>
            <div className="lp-steps">
              {[
                ['01', 'Connectez vos comptes', 'TikTok, YouTube et Instagram, par leurs connexions officielles. Plusieurs comptes par plateforme si besoin.'],
                ['02', 'Envoyez et programmez', 'Choisissez la vidéo, les comptes (ou un groupe), l’heure et les réglages de chaque plateforme.'],
                ['03', 'Suivez les résultats', 'Statut de chaque publication, puis vues, abonnés et interactions dans le calendrier et les stats.'],
              ].map(([n, t, d], i) => (
                <Reveal key={n} delay={i * 0.1}><div className="lp-step"><span className="n">{n}</span><h3>{t}</h3><p>{d}</p></div></Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="groupes" className="lp-section" style={{ paddingTop: 0 }}>
          <div className="lp-wrap lp-groups">
            <Reveal>
              <div className="lp-eyebrow">Groupes de comptes</div>
              <h2 className="lp-h2">Plusieurs comptes par groupe.<br />Plusieurs groupes par compte.</h2>
              <p className="lp-lead">Votre compte TikTok principal peut être à la fois dans « Ghost Hands » et dans « Piano FR ». Choisissez un groupe en haut de l’écran : accueil, planning et statistiques ne montrent plus que lui.</p>
            </Reveal>
            <Reveal delay={0.1}>
              <div className="lp-gdiag" aria-label="Exemple : cinq comptes répartis dans deux groupes, un compte TikTok dans les deux">
                <svg className="lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {[[14, 22], [30, 22], [30, 58], [46, 22], [62, 58], [78, 58]].map(([y1, y2], i) => (
                    <path key={i} d={`M 47 ${y1} C 52 ${y1}, 50 ${y2}, 55 ${y2}`} fill="none" stroke="var(--border-strong)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
                  ))}
                </svg>
                <div className="col" style={{ gap: 10 }}>
                  {([['tiktok', '@ghosthands'], ['tiktok', '@ghosthands.piano'], ['youtube', 'Ghost Hands'], ['instagram', '@piano.fr'], ['youtube', 'Piano FR']] as const).map(([p, n], i) => (
                    <div key={i} className="lp-acc"><span className={`dot dot-${p}`} /><span>{n}</span></div>
                  ))}
                </div>
                <div className="col" style={{ gap: 10, justifyContent: 'space-around' }}>
                  <div className="lp-grp" style={{ color: 'var(--g-purple)' }}><span className="gdot g-purple" /><span style={{ color: 'var(--text)' }}>Ghost Hands</span></div>
                  <div className="lp-grp" style={{ color: 'var(--g-teal)' }}><span className="gdot g-teal" /><span style={{ color: 'var(--text)' }}>Piano FR</span></div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="chiffres" className="lp-wrap" style={{ paddingBottom: 72 }}>
          <Reveal>
            <div className="lp-stats">
              <div>
                <div className="lp-eyebrow">Statistiques</div>
                <h2 className="lp-h2" style={{ color: '#fff' }}>Ce qui marche,<br />sans tableur.</h2>
                <p className="lp-lead">Par plateforme, par compte, par groupe. Chapote n’invente rien : quand une plateforme ne fournit pas un chiffre, c’est écrit.</p>
              </div>
              <div className="col" style={{ gap: 12 }}>
                <div className="lp-kpis">
                  <div className="lp-kpi"><small>Vues · 30 j</small><b>1,28 M</b><em>+18 %</em></div>
                  <div className="lp-kpi"><small>Abonnés</small><b>84 312</b><em>+2 418</em></div>
                  <div className="lp-kpi"><small>Engagement</small><b>7,4 %</b><em>j’aime, commentaires, partages</em></div>
                  <div className="lp-kpi"><small>Publications</small><b>46</b><em>sur 9 comptes</em></div>
                </div>
                <div className="lp-kpi">
                  <small>Meilleurs moments</small>
                  <div className="lp-heat" aria-hidden="true">
                    {[.15, .2, .35, .5, .3, .7, 1, .55, .1, .25, .3, .45, .4, .8, .9, .5, .1, .15, .25, .35, .3, .6, .75, .4].map((o, i) => <i key={i} style={{ opacity: o }} />)}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        <section id="faq" className="lp-section" style={{ paddingTop: 24 }}>
          <div className="lp-wrap" style={{ maxWidth: 980 }}>
            <Reveal>
              <div className="lp-eyebrow">Questions</div>
              <h2 className="lp-h2">Questions fréquentes</h2>
            </Reveal>
            <div className="lp-faq">
              {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
            </div>
          </div>
        </section>

        <section className="lp-wrap">
          <Reveal>
            <div className="lp-final">
              <h2>Votre prochaine vidéo<br />part à l’heure.</h2>
              <p>Créez votre compte, connectez vos réseaux et programmez votre première publication en quelques minutes.</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <Link to="/inscription" className="lp-cta light">Créer mon compte <Icon name="right" /></Link>
                <Link to="/connexion" className="lp-link" style={{ color: '#fff' }}>J’ai déjà un compte</Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="lp-wrap lp-foot">
        <div className="col" style={{ gap: 12 }}>
          <Brand to="/" />
          <p style={{ maxWidth: 340 }}>La gestion de réseaux sociaux de Chapote : publication programmée et statistiques pour TikTok, YouTube et Instagram.</p>
        </div>
        <div><h4>Chapote</h4><ul>
          <li><a href={chapote}>chapote.fr</a></li>
          <li><a href="https://music.chapote.fr">music.chapote.fr</a></li>
          <li><Link to="/connexion">Connexion</Link></li>
        </ul></div>
        <div><h4>Légal</h4><ul>
          <li><a href={`${chapote}/legal/mentions-legales`}>Mentions légales</a></li>
          <li><a href={`${chapote}/legal/cgu`}>Conditions d’utilisation</a></li>
          <li><a href={`${chapote}/legal/confidentialite`}>Confidentialité</a></li>
        </ul></div>
        <div><h4>Plateformes</h4><ul>
          <li><a href={`${chapote}/legal/tiktok-confidentialite`}>TikTok · confidentialité</a></li>
          <li><a href={`${chapote}/legal/youtube-confidentialite`}>YouTube · confidentialité</a></li>
          <li><a href={`${chapote}/legal/instagram-confidentialite`}>Instagram · confidentialité</a></li>
        </ul></div>
      </footer>
    </div>
  )
}
