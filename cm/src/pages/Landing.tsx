// Page d'accueil publique de cm.chapote.fr (v4), vue sans être connecté. Une seule action principale
// (créer un compte), une preuve à côté (captures réelles de l'app, données de démonstration), les
// objections dans la FAQ. Rien d'inventé : pas d'avis, pas de logo client, pas de chiffre.
// Pas de librairie d'animation ; seule la capture du haut est chargée tout de suite.
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../session'
import '../landing.css'
import imgPlanning from '../landing/planning.webp'
import imgPublication from '../landing/publication.webp'
import imgNouvelle from '../landing/nouvelle.webp'
import imgStats from '../landing/stats.webp'
import imgBibliotheque from '../landing/bibliotheque.webp'
import imgGroupes from '../landing/groupes.webp'

const CTA = 'Programmer mes vidéos gratuitement'
// Lien du Play Store : à renseigner quand l'app sera publique. Vide = badge masqué.
const PLAY_STORE_URL = ''

/** Logo Chapote CM : le chapeau posé sur un M, blanc sur bleu (même dessin que l'app mobile). */
function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5.4" fill="#0071e3" />
      <g transform="translate(12 8.6) scale(0.5) translate(-12 -11)" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" />
        <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" />
      </g>
      <path d="M6.5 19v-6.2l5.5 4.4 5.5-4.4V19" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function Check() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>
}

/** Capture d'écran de l'app dans un cadre de téléphone. */
function Phone({ src, alt, eager = false }: { src: string; alt: string; eager?: boolean }) {
  return (
    <div className="lp-phone">
      <img src={src} alt={alt} width={540} height={978} loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchpriority: 'high' } : {})} />
    </div>
  )
}

const FEATURES: { k: string; title: string; text: string; img: string; alt: string }[] = [
  { k: 'Publication multi-réseaux', title: 'Une vidéo, tous vos comptes.', img: imgNouvelle,
    text: 'Envoyez la vidéo une fois. Choisissez les comptes TikTok, YouTube et Instagram, une légende commune ou propre à chacun, et l’heure. Rien ne part avant.',
    alt: 'Écran Nouvelle publication : choix de la vidéo, titre, légende et comptes' },
  { k: 'Planning', title: 'Toute la semaine d’un coup d’œil.', img: imgPublication,
    text: 'Ce qui est programmé, ce qui est parti et ce qui a échoué, jour par jour. Chaque publication montre son statut sur chaque réseau.',
    alt: 'Fiche d’une publication : publiée sur YouTube et Instagram, à publier dans l’app sur TikTok' },
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

const FAQ: [string, string][] = [
  ['Mes comptes sont-ils en sécurité ?', 'Vous vous connectez par les pages officielles de TikTok, de Google (YouTube) et de Meta (Instagram). Chapote CM ne voit jamais vos mots de passe. Vous pouvez retirer l’accès à tout moment, depuis Chapote CM ou depuis le réseau.'],
  ['Où vont mes vidéos ?', 'Dans votre propre Google Drive, dans un dossier créé par Chapote CM. Chapote CM ne voit que les fichiers qu’il y range. Après publication, vous choisissez de les garder ou de les supprimer.'],
  ['Combien ça coûte ?', 'Chapote CM est gratuit. Aucune carte bancaire n’est demandée.'],
  ['Puis-je travailler en équipe ?', 'Oui. Partagez un groupe de comptes avec d’autres personnes. Chacun voit le planning et les statistiques de ce groupe, selon son rôle : administrateur, éditeur ou lecteur.'],
  ['Quels réseaux sont pris en charge ?', 'TikTok, YouTube Shorts et Instagram Reels (compte professionnel Créateur ou Entreprise). Plusieurs comptes par réseau.'],
  ['Faut-il un nouveau compte ?', 'Non si vous en avez déjà un : c’est le même compte Chapote que sur chapote.fr, par e-mail ou avec Google.'],
]

export default function Landing() {
  const { appUrl } = useSession()
  useEffect(() => { document.title = 'Chapote CM · Programmez vos vidéos sur TikTok, YouTube et Instagram' }, [])
  const chapote = appUrl.replace(/\/$/, '')

  return (
    <div className="lp">
      <a className="lp-skip" href="#contenu">Aller au contenu</a>
      <header className="lp-top">
        <div className="lp-wrap lp-top-row">
          <Link to="/" className="lp-brand" aria-label="Chapote CM, accueil"><Logo /><span>Chapote CM</span></Link>
          <nav className="lp-nav" aria-label="Sections">
            <a href="#produit">Fonctionnalités</a><a href="#etapes">Comment ça marche</a><a href="#faq">Questions</a>
          </nav>
          <Link to="/connexion" className="lp-login">Se connecter</Link>
        </div>
      </header>

      <main id="contenu">
        <section className="lp-hero" aria-labelledby="lp-titre">
          <div className="lp-wrap lp-hero-in">
            <div>
              <ul className="lp-plats" aria-label="Réseaux pris en charge">
                <li><i className="lp-dot tt" />TikTok</li><li><i className="lp-dot yt" />YouTube</li><li><i className="lp-dot ig" />Instagram</li>
              </ul>
              <h1 id="lp-titre">Programmez vos vidéos courtes <em>sur tous vos comptes, en une fois.</em></h1>
              <p className="lp-lead">Pour les créateurs, community managers et équipes. Choisissez la vidéo, les comptes et l’heure : Chapote CM publie à votre place et rassemble vos statistiques.</p>
              <div className="lp-act">
                <Link to="/inscription" className="lp-cta">{CTA}</Link>
                <ul className="lp-proof">
                  <li><Check />Gratuit, sans carte bancaire</li>
                  <li><Check />Connexion officielle TikTok, Google et Meta</li>
                  <li><Check />Vos vidéos restent dans votre Google Drive</li>
                </ul>
              </div>
            </div>
            <figure className="lp-shot">
              <Phone eager src={imgPlanning} alt="Le planning de Chapote CM : trois publications programmées à 18 h 30 sur TikTok, YouTube et Instagram" />
              <figcaption>Capture réelle de l’app (données de démonstration)</figcaption>
            </figure>
          </div>
        </section>

        <section id="produit" className="lp-sec lp-alt" aria-labelledby="lp-produit">
          <div className="lp-wrap">
            <h2 id="lp-produit">Ce que fait Chapote CM</h2>
            <p className="lp-sub">Tout ce qu’il faut pour publier régulièrement, sans jongler entre trois applications.</p>
            {FEATURES.map((f, i) => (
              <div key={f.k} className={`lp-feat${i % 2 ? ' rev' : ''}`}>
                <div className="lp-ft"><p className="lp-k">{f.k}</p><h3>{f.title}</h3><p>{f.text}</p></div>
                <div className="lp-shot"><Phone src={f.img} alt={f.alt} /></div>
              </div>
            ))}
          </div>
        </section>

        <section id="etapes" className="lp-sec" aria-labelledby="lp-etapes">
          <div className="lp-wrap">
            <h2 id="lp-etapes">Prêt en trois étapes</h2>
            <ol className="lp-steps">
              <li><b aria-hidden="true">1</b><h3>Connectez vos comptes</h3><p>Par les connexions officielles de TikTok, Google et Meta.</p></li>
              <li><b aria-hidden="true">2</b><h3>Programmez</h3><p>Une vidéo, les comptes ou un groupe, et l’heure.</p></li>
              <li><b aria-hidden="true">3</b><h3>Suivez les résultats</h3><p>Le statut de chaque publication, puis vos statistiques.</p></li>
            </ol>
          </div>
        </section>

        <section id="faq" className="lp-sec lp-alt" aria-labelledby="lp-faq">
          <div className="lp-wrap">
            <h2 id="lp-faq">Questions fréquentes</h2>
            <div className="lp-faq">
              {FAQ.map(([q, a], i) => <details key={q} open={i === 0}><summary>{q}</summary><p>{a}</p></details>)}
            </div>
          </div>
        </section>

        <section className="lp-sec" aria-labelledby="lp-fin">
          <div className="lp-wrap">
            <div className="lp-final">
              <h2 id="lp-fin">Votre prochaine vidéo part à l’heure, partout.</h2>
              <div className="lp-act center">
                <Link to="/inscription" className="lp-cta">{CTA}</Link>
                <Link to="/connexion" className="lp-link">J’ai déjà un compte</Link>
              </div>
              {PLAY_STORE_URL && <a className="lp-store" href={PLAY_STORE_URL} rel="noopener">Disponible sur Google Play</a>}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div><p className="lp-foot-brand"><Logo size={24} />Chapote CM</p><p>Programmation et statistiques pour TikTok, YouTube et Instagram.</p></div>
          <div><h2>Chapote</h2><ul><li><a href={chapote}>chapote.fr</a></li><li><Link to="/connexion">Se connecter</Link></li></ul></div>
          <div><h2>Légal</h2><ul><li><Link to="/privacy">Confidentialité</Link></li><li><Link to="/terms">Conditions d’utilisation</Link></li><li><a href={`${chapote}/legal/mentions-legales`}>Mentions légales</a></li></ul></div>
          <div><h2>Plateformes</h2><ul><li><a href={`${chapote}/legal/tiktok-confidentialite`}>TikTok</a></li><li><a href={`${chapote}/legal/youtube-confidentialite`}>YouTube</a></li><li><a href={`${chapote}/legal/instagram-confidentialite`}>Instagram</a></li></ul></div>
        </div>
      </footer>
    </div>
  )
}
