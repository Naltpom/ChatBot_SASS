// Tableau de bord de la promo de Chapote CM (cm.chapote.fr/promo) : suivi prévisionnel sur 3 mois, publications et leur fiche
// (versions, notes, retours d'expérience), laboratoire, blog (guide et recherches), règles et sources, bilan, écrans.
// Réservé au superadmin (Me.is_superadmin) ; noindex. Rien n'est publié d'ici. Données : src/promo/ (plan, suivi, bilan, pilotes).
import { useEffect } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { BrandMark } from '../components/ui'
import { useSession } from '../session'
import { Article, Bilan, Blog, Calendrier, Ecrans, Fiche, Labo, Publications, Regles, Tableau } from '../promo/pages'
import '../promo/promo.css'

const ONGLETS: [string, string][] = [['', 'Tableau de bord'], ['calendrier', 'Calendrier'], ['publications', 'Publications'], ['labo', 'Labo'],
  ['blog', 'Blog'], ['regles', 'Règles et sources'], ['bilan', 'Bilan'], ['ecrans', 'Écrans']]

export default function Promo() {
  const { me } = useSession()
  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex,nofollow'
    document.head.appendChild(m)
    return () => { m.remove() }
  }, [])
  if (!me?.is_superadmin) {
    return <div className="col" style={{ padding: 24 }}><h1>Page introuvable</h1><Link to="/">Retour à l'accueil</Link></div>
  }
  return (
    <div className="pr">
      <header className="pr-top">
        <Link to="/promo" className="pr-brand"><BrandMark size={28} />Promo</Link>
        <span className="pr-draft">Interne · rien n'est publié d'ici</span>
      </header>
      <nav className="pr-onglets" aria-label="Sections">
        {ONGLETS.map(([k, nom]) => <NavLink key={k} to={`/promo${k ? '/' + k : ''}`} end={!k} className={({ isActive }) => isActive ? 'on' : ''}>{nom}</NavLink>)}
      </nav>
      <Routes>
        <Route index element={<Tableau />} />
        <Route path="calendrier" element={<Calendrier />} />
        <Route path="publications" element={<Publications />} />
        <Route path="p/:id" element={<Fiche />} />
        <Route path="labo" element={<Labo />} />
        <Route path="blog" element={<Blog />} />
        <Route path="blog/:slug" element={<Article />} />
        <Route path="regles" element={<Regles />} />
        <Route path="bilan" element={<Bilan />} />
        <Route path="ecrans" element={<Ecrans />} />
        <Route path="*" element={<p>Section introuvable. <Link to="/promo">Tableau de bord</Link></p>} />
      </Routes>
      <footer className="pr-foot"><p>Données : <code>cm/src/promo/</code> (plan, suivi, bilan, pilotes) ; recherches : <code>docs/promo-video/</code>. Mises à jour par Claude à la demande.</p></footer>
    </div>
  )
}
