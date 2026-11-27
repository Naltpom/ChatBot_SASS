// Espace de pilotage de la promo de Chapote CM (cm.chapote.fr/promo) : app shell (barre latérale + barre du haut, pleine largeur).
// Pilotage : vue d'ensemble, calendrier 3 mois, publications et leur fiche, labo, bilan. Ressources : recherches, règles et sources, écrans.
// Réservé au superadmin (Me.is_superadmin) ; noindex. Rien n'est publié d'ici. Données : src/promo/ (plan, suivi, bilan, pilotes).
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { BrandMark } from '../components/ui'
import { useSession } from '../session'
import { Article, Bilan, Blog, Calendrier, Ecrans, Fiche, Labo, Publications, Regles, TITRES, Tableau } from '../promo/pages'
import { Icone } from '../promo/icones'
import { COMPTES } from '../promo/plan'
import { ACTIONS, ENTREES, parId } from '../promo/suivi'
import { NOMS, ORDRE } from '../promo/ui'
import '../promo/promo.css'

const PILOTAGE: [string, string, string][] = [['', "Vue d'ensemble", 'vue'], ['calendrier', 'Calendrier', 'calendrier'], ['publications', 'Publications', 'publications'],
  ['labo', 'Labo', 'labo'], ['bilan', 'Bilan', 'bilan']]
const RESSOURCES: [string, string, string][] = [['blog', 'Recherches', 'blog'], ['regles', 'Règles et sources', 'regles'], ['ecrans', 'Écrans', 'ecrans']]
const SECTIONS: Record<string, string> = Object.fromEntries([...PILOTAGE, ...RESSOURCES].map(([k, n]) => [k, n]))

/** Fil d'Ariane de la barre du haut, déduit de l'URL. */
function useFil(): { parent?: [string, string]; titre: string } {
  const seg = useLocation().pathname.replace(/^\/promo\/?/, '').split('/')
  if (seg[0] === 'p') return { parent: ['publications', 'Publications'], titre: parId(seg[1] ?? '')?.titre ?? 'Publication' }
  if (seg[0] === 'blog' && seg[1]) return { parent: ['blog', 'Recherches'], titre: TITRES[seg[1]] ?? seg[1] }
  return { titre: SECTIONS[seg[0] ?? ''] ?? 'Promo' }
}

/** Où en est la campagne (12 semaines à partir du lundi 30 novembre 2026). */
function etatCampagne() {
  const debut = new Date(2026, 10, 30).getTime(), j = Math.floor((Date.now() - debut) / 86400000)
  if (j < 0) return `Lancement dans ${-j} j`
  if (j >= 84) return 'Campagne terminée'
  return `Semaine ${Math.floor(j / 7) + 1} / 12`
}

function Actions() {
  const [ouvert, setOuvert] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const restantes = ACTIONS.filter(a => !a.fait)
  useEffect(() => {
    if (!ouvert) return
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOuvert(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false) }
    document.addEventListener('mousedown', f); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k) }
  }, [ouvert])
  return (
    <div className="pr-pop" ref={ref}>
      <button type="button" className="pr-tb-btn" aria-expanded={ouvert} onClick={() => setOuvert(o => !o)}>
        <Icone n="actions" /><span className="pr-tb-l">Actions</span><b className="pr-compteur">{restantes.length}</b>
      </button>
      {ouvert && (
        <div className="pr-pop-panel" role="dialog" aria-label="Prochaines actions">
          <div className="pr-panel-h"><h2>Prochaines actions</h2><span className="pr-muted">{ACTIONS.length - restantes.length}/{ACTIONS.length} faites</span></div>
          <ul className="pr-actions">{restantes.map(a => <li key={a.texte}><span aria-hidden>○</span>{a.texte}</li>)}</ul>
          <details><summary className="pr-muted">Faites ({ACTIONS.length - restantes.length})</summary>
            <ul className="pr-actions">{ACTIONS.filter(a => a.fait).map(a => <li key={a.texte} className="fait"><span aria-hidden>✓</span>{a.texte}</li>)}</ul></details>
        </div>
      )}
    </div>
  )
}

export default function Promo() {
  const { me } = useSession()
  const { pathname } = useLocation()
  const [menu, setMenu] = useState(false)
  const fil = useFil()
  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex,nofollow'
    document.head.appendChild(m)
    return () => { m.remove() }
  }, [])
  useEffect(() => { setMenu(false); document.querySelector('.pr-main')?.scrollTo(0, 0); window.scrollTo(0, 0) }, [pathname])
  if (!me?.is_superadmin) {
    return <div className="col" style={{ padding: 24 }}><h1>Page introuvable</h1><Link to="/">Retour à l'accueil</Link></div>
  }
  const lien = ([k, nom, ic]: [string, string, string]) => (
    <NavLink key={k} to={`/promo${k ? '/' + k : ''}`} end={!k} className={({ isActive }) => isActive || (k === 'publications' && pathname.startsWith('/promo/p/')) ? 'on' : ''}>
      <Icone n={ic} /><span>{nom}</span>{k === 'publications' && <small>{ENTREES.length}</small>}
    </NavLink>
  )
  return (
    <div className={`pr ${menu ? 'pr-menu-ouvert' : ''}`}>
      <aside className="pr-side" aria-label="Navigation de la promo">
        <div className="pr-side-h">
          <Link to="/promo" className="pr-brand"><BrandMark size={26} /><span>Promo<small>Chapote CM</small></span></Link>
          <button type="button" className="pr-icone-btn pr-seul-mobile" onClick={() => setMenu(false)} aria-label="Fermer le menu"><Icone n="fermer" /></button>
        </div>
        <nav className="pr-nav">
          <p className="pr-nav-t">Pilotage</p>{PILOTAGE.map(lien)}
          <p className="pr-nav-t">Ressources</p>{RESSOURCES.map(lien)}
        </nav>
        <div className="pr-side-b">
          <p className="pr-nav-t">Comptes</p>
          <ul className="pr-comptes">{ORDRE.map(p => <li key={p}><i className={`pr-point pr-${p}`} /><a href={COMPTES[p].url} target="_blank" rel="noreferrer" title={COMPTES[p].nom}>{NOMS[p]}</a><small>{COMPTES[p].nom.replace(/^\S+ /, '')}</small></li>)}</ul>
          <Link to="/" className="pr-side-retour"><Icone n="sortie" taille={16} />Retour à l'app</Link>
        </div>
      </aside>
      <div className="pr-voile" onClick={() => setMenu(false)} aria-hidden />

      <div className="pr-main">
        <header className="pr-tb">
          <button type="button" className="pr-icone-btn pr-seul-mobile" onClick={() => setMenu(true)} aria-label="Ouvrir le menu"><Icone n="menu" /></button>
          <div className="pr-fil">
            {fil.parent && <><Link to={`/promo/${fil.parent[0]}`}>{fil.parent[1]}</Link><span aria-hidden>/</span></>}
            <b>{fil.titre}</b>
          </div>
          <div className="pr-tb-d">
            <span className="pr-chip-etat"><i />{etatCampagne()}</span>
            <span className="pr-draft pr-tb-l">Interne · rien n'est publié d'ici</span>
            <Actions />
          </div>
        </header>
        <main className="pr-contenu">
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
            <Route path="*" element={<p>Section introuvable. <Link to="/promo">Vue d'ensemble</Link></p>} />
          </Routes>
          <footer className="pr-foot">Données : <code>cm/src/promo/</code> (plan, suivi, bilan, pilotes) · recherches : <code>docs/promo-video/</code> · mises à jour par Claude à la demande.</footer>
        </main>
      </div>
    </div>
  )
}
