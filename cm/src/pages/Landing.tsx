// Page d'accueil publique de cm.chapote.fr (v4), vue sans être connecté. Une seule action principale
// (créer un compte), une preuve à côté (captures réelles de l'app, données de démonstration), les
// objections dans la FAQ. Rien d'inventé : pas d'avis, pas de logo client, pas de chiffre.
// Pas de librairie d'animation ; seule la capture du haut est chargée tout de suite.
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '../components/ui'
import { useSession } from '../session'
import '../landing.css'
import imgPlanning from '../landing/planning.webp'
import imgNouvelle from '../landing/nouvelle.webp'
import imgStats from '../landing/stats.webp'
import imgBibliotheque from '../landing/bibliotheque.webp'
import imgGroupes from '../landing/groupes.webp'
import Demo from '../landing/Demo'
import { t } from '../i18n'

const CTA = 'Planifier mes vidéos gratuitement'
// « Donner mon avis » : le formulaire de l'app (connexion ou inscription d'abord) : on sait qui écrit.
const FEEDBACK = '/avis'
// Lien du Play Store : à renseigner quand l'app sera publique. Vide = badge masqué.
const PLAY_STORE_URL = ''

function Check() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>
}

/** Capture d'écran de l'app dans un cadre de téléphone. */
function Phone({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="lp-phone">
      <img src={src} alt={alt} width={540} height={978} loading="lazy" decoding="async" />
    </div>
  )
}

const FEATURES: { k: string; title: string; text: string; img: string; alt: string }[] = [
  { k: 'Publication multi-réseaux', title: 'Une vidéo, tous vos comptes.', img: imgNouvelle,
    text: 'Envoyez la vidéo une fois. Choisissez les comptes TikTok, YouTube et Instagram, une légende commune ou propre à chacun, et l’heure. Rien ne part avant.',
    alt: 'Écran Nouvelle publication : choix de la vidéo, titre, légende et comptes' },
  { k: 'Planning', title: 'Toute la semaine d’un coup d’œil.', img: imgPlanning,
    text: 'Ce qui est programmé, ce qui est parti et ce qui a échoué, jour par jour. Chaque publication montre son statut sur chaque réseau.',
    alt: 'Le planning : la semaine, et les publications du jour programmées sur TikTok, YouTube et Instagram' },
  { k: 'Statistiques', title: 'Vos chiffres réunis, sans tableur.', img: imgStats,
    text: 'Vues, abonnés, j’aime, partages et engagement sur 7 jours, 30 jours, 90 jours ou un an. Par compte ou par groupe.',
    alt: 'Écran Statistiques : vues, abonnés, engagement et vidéos publiées sur 30 jours' },
  { k: 'Bibliothèque Google Drive', title: 'Vos dossiers Drive, prêts à programmer.', img: imgBibliotheque,
    text: 'Ajoutez un dossier de votre Google Drive : ses vidéos apparaissent dans Chapote CM. Les fichiers restent chez vous.',
    alt: 'Écran Bibliothèque : stockage Google Drive, dossiers et vidéos à publier' },
  { k: 'Groupes et partage', title: 'Par client, artiste ou chaîne. Et en équipe.', img: imgGroupes,
    text: 'Rangez vos comptes en groupes : planning et statistiques se filtrent d’un geste. Partagez un groupe avec d’autres personnes, comme administrateur, éditeur ou lecteur.',
    alt: 'Écran Groupes : création d’un groupe et choix de ses comptes' },
]

// Aussi publiée en données structurées FAQPage sur l'accueil (scripts/prerender.mjs) : texte affiché = texte déclaré.
export const FAQ: [string, string][] = [
  ['Chapote CM, c’est quoi ?', 'Un planificateur de réseaux sociaux gratuit, pensé pour les community managers, content managers, créateurs et agences : vous programmez vos vidéos courtes sur TikTok, YouTube Shorts et Instagram Reels, sur tous vos comptes en une fois, puis vous suivez vos statistiques au même endroit.'],
  ['Mes comptes sont-ils en sécurité ?', 'Vous vous connectez par les pages officielles de TikTok, de Google (YouTube) et de Meta (Instagram). Chapote CM ne voit jamais vos mots de passe. Vous pouvez retirer l’accès à tout moment, depuis Chapote CM ou depuis le réseau.'],
  ['Où vont mes vidéos ?', 'Dans votre propre Google Drive, dans un dossier créé par Chapote CM. Chapote CM ne voit que les fichiers qu’il y range. Après publication, vous choisissez de les garder ou de les supprimer.'],
  ['Combien ça coûte ?', 'Chapote CM est gratuit pendant la bêta. Si un abonnement arrive un jour, les bêta-testeurs garderont une certaine liberté.'],
  ['Puis-je travailler en équipe ?', 'Oui. Partagez un groupe de comptes avec d’autres personnes. Chacun voit le planning et les statistiques de ce groupe, selon son rôle : administrateur, éditeur ou lecteur.'],
  ['Quels réseaux sont pris en charge ?', 'TikTok, YouTube Shorts et Instagram Reels (compte professionnel Créateur ou Entreprise). Plusieurs comptes par réseau.'],
  ['Faut-il un nouveau compte ?', 'Non si vous en avez déjà un : c’est le même compte Chapote que sur chapote.fr, par e-mail ou avec Google.'],
]

export default function Landing() {
  const { appUrl } = useSession()
  useEffect(() => { document.title = t('Chapote CM · Planifier ses vidéos TikTok, YouTube Shorts et Instagram Reels (gratuit)') }, [])
  // Apparition au défilement : un seul observateur pour toute la page. Sans lui, tout reste visible.
  const page = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = page.current
    if (!el || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    el.classList.add('lp-js')
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }),
      { rootMargin: '0px 0px -10% 0px' })
    el.querySelectorAll('.lp-rv').forEach(x => io.observe(x))
    return () => io.disconnect()
  }, [])
  const chapote = appUrl.replace(/\/$/, '')

  return (
    <div className="lp" ref={page}>
      <a className="lp-skip" href="#contenu">{t('Aller au contenu')}</a>
      <header className="lp-top">
        <div className="lp-wrap lp-top-row">
          <Link to="/" className="lp-brand" aria-label={t('Chapote CM, accueil')}><BrandMark size={32} /><span>Chapote CM</span></Link>
          <nav className="lp-nav" aria-label={t('Sections')}>
            <a href="#produit">{t('Fonctionnalités')}</a><a href="#etapes">{t('Comment ça marche')}</a><a href="#faq">{t('Questions')}</a>
          </nav>
          <Link to="/connexion" className="lp-login">{t('Se connecter')}</Link>
        </div>
      </header>

      <main id="contenu">
        <section className="lp-hero" aria-labelledby="lp-titre">
          <div className="lp-wrap lp-hero-in">
            <div>
              <ul className="lp-plats" aria-label={t('Réseaux pris en charge')}>
                <li><i className="lp-dot tt" />TikTok</li><li><i className="lp-dot yt" />YouTube</li><li><i className="lp-dot ig" />Instagram</li>
              </ul>
              <h1 id="lp-titre">{t('Planifiez une fois.')} <em>{t('Publiez partout.')}</em></h1>
              <p className="lp-lead">{t('Vos vidéos courtes sur TikTok, YouTube et Instagram, à l’heure choisie, sur tous vos comptes. Et toutes vos statistiques au même endroit.')}</p>
              <div className="lp-act">
                <Link to="/inscription" className="lp-cta">{t(CTA)}<span aria-hidden="true" className="lp-arrow">→</span></Link>
                <ul className="lp-proof">
                  <li><Check />{t('Gratuit pendant la bêta')}</li>
                  <li><Check />{t('Connexion officielle TikTok, Google et Meta')}</li>
                  <li><Check />{t('Vos vidéos restent dans votre Google Drive')}</li>
                </ul>
              </div>
            </div>
            <figure className="lp-shot lp-hero-shot">
              <div className="lp-phone"><Demo /></div>
              <figcaption>{t('Essayez : c’est l’écran de l’app, avec une vidéo de démonstration. Rien n’est publié.')}</figcaption>
            </figure>
          </div>
        </section>

        <section id="produit" className="lp-sec lp-alt" aria-labelledby="lp-produit">
          <div className="lp-wrap">
            <h2 id="lp-produit">{t('Ce que fait Chapote CM')}</h2>
            <p className="lp-sub">{t('Tout ce qu’il faut pour publier régulièrement, sans jongler entre trois applications.')}</p>
            {FEATURES.map((f, i) => (
              <div key={f.k} className={`lp-feat lp-rv${i % 2 ? ' rev' : ''}`}>
                <div className="lp-ft"><p className="lp-k">{t(f.k)}</p><h3>{t(f.title)}</h3><p>{t(f.text)}</p></div>
                <div className="lp-shot"><Phone src={f.img} alt={t(f.alt)} /></div>
              </div>
            ))}
          </div>
        </section>

        <section id="etapes" className="lp-sec" aria-labelledby="lp-etapes">
          <div className="lp-wrap">
            <h2 id="lp-etapes">{t('Prêt en trois étapes')}</h2>
            <ol className="lp-steps lp-rv">
              <li><b aria-hidden="true">1</b><h3>{t('Connectez vos comptes')}</h3><p>{t('Par les connexions officielles de TikTok, Google et Meta.')}</p></li>
              <li><b aria-hidden="true">2</b><h3>{t('Planifiez')}</h3><p>{t('Une vidéo, les comptes ou un groupe, et l’heure.')}</p></li>
              <li><b aria-hidden="true">3</b><h3>{t('Suivez les résultats')}</h3><p>{t('Le statut de chaque publication, puis vos statistiques.')}</p></li>
            </ol>
          </div>
        </section>

        <section className="lp-sec lp-why" aria-labelledby="lp-pourquoi">
          <div className="lp-wrap">
            <figure className="lp-founder lp-rv">
              <h2 id="lp-pourquoi">{t('Pourquoi Chapote CM')}</h2>
              <blockquote>
                <p>{t('Au départ, j’avais un compte Instagram, puis un deuxième. Publier régulièrement demandait de planifier, et l’app ne le permettait pas. Ensuite, pour plus de visibilité, TikTok et YouTube… Je me suis retrouvé avec 6 comptes, un planning pour chacun et les mêmes vidéos partout : une vraie galère. En automatisant, je perdais le visuel, la cohérence et le suivi des stats.')}</p>
                <p>{t('Alors j’ai fait l’app, pour moi. Elle est maintenant ouverte à tous, en version 1 : publier des vidéos courtes verticales sur TikTok, Instagram et YouTube, le plus simplement possible. Elle est gratuite pour l’instant : vos retours et votre façon de faire comptent plus que tout pour la suite. Et si un abonnement arrive un jour, les bêta-testeurs garderont une certaine liberté.')}</p>
              </blockquote>
              <figcaption><BrandMark size={36} /><span><b>Nathan</b><small>{t('Créateur de Chapote')}</small></span></figcaption>
              <Link className="lp-link lp-fb" to={FEEDBACK}>{t('Donner mon avis à Nathan')}</Link>
            </figure>
          </div>
        </section>

        <section id="faq" className="lp-sec lp-alt" aria-labelledby="lp-faq">
          <div className="lp-wrap">
            <h2 id="lp-faq">{t('Questions fréquentes')}</h2>
            <div className="lp-faq">
              {FAQ.map(([q, a], i) => <details key={q} open={i === 0}><summary>{t(q)}</summary><p>{t(a)}</p></details>)}
            </div>
          </div>
        </section>

        <section className="lp-sec" aria-labelledby="lp-fin">
          <div className="lp-wrap">
            <div className="lp-final lp-rv">
              <h2 id="lp-fin">{t('Votre prochaine vidéo part à l’heure, partout.')}</h2>
              <div className="lp-act center">
                <Link to="/inscription" className="lp-cta">{t(CTA)}<span aria-hidden="true" className="lp-arrow">→</span></Link>
                <Link to="/connexion" className="lp-link">{t('J’ai déjà un compte')}</Link>
              </div>
              {PLAY_STORE_URL && <a className="lp-store" href={PLAY_STORE_URL} rel="noopener">{t('Disponible sur Google Play')}</a>}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div><p className="lp-foot-brand"><BrandMark size={24} />Chapote CM</p><p>{t('Planification et statistiques pour TikTok, YouTube et Instagram.')}</p></div>
          <div><h2>Chapote</h2><ul><li><a href={chapote}>chapote.fr</a></li><li><Link to="/connexion">{t('Se connecter')}</Link></li><li><Link to={FEEDBACK}>{t('Donner mon avis')}</Link></li></ul></div>
          <div><h2>{t('Légal')}</h2><ul><li><Link to="/privacy">{t('Confidentialité')}</Link></li><li><Link to="/terms">{t('Conditions d’utilisation')}</Link></li><li><a href={`${chapote}/legal/mentions-legales`}>{t('Mentions légales')}</a></li></ul></div>
          <div><h2>{t('Plateformes')}</h2><ul><li><a href={`${chapote}/legal/tiktok-confidentialite`}>TikTok</a></li><li><a href={`${chapote}/legal/youtube-confidentialite`}>YouTube</a></li><li><a href={`${chapote}/legal/instagram-confidentialite`}>Instagram</a></li></ul></div>
        </div>
      </footer>
    </div>
  )
}
