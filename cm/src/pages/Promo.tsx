// Plan de lancement de Chapote CM (cm.chapote.fr/promo) : une semaine de contenu pour toutes les plateformes, à relire.
// Réservé au superadmin (Me.is_superadmin) ; noindex. Rien n'est publié d'ici : brouillon de travail.
// Contenu : src/promo/plan.ts. Visuels : public/promo/ (captures de démo de l'app, fonds générés avec Gemini, titres posés ici).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '../components/ui'
import { useSession } from '../session'
import { COMPTES, REGLES, SEMAINE, type Piece, type Plateforme, type Visuel } from '../promo/plan'
import '../promo/promo.css'

const NOMS: Record<Plateforme, string> = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X' }
const ORDRE: Plateforme[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x']

function Badge({ p }: { p: Plateforme }) {
  return <span className={`pr-badge pr-${p}`}>{NOMS[p]}</span>
}

function Apercu({ v }: { v: Visuel }) {
  return (
    <figure className={`pr-vis pr-${v.format} ${v.type === 'capture' ? 'pr-cap' : ''}`}>
      <img src={v.src} alt="" loading="lazy" decoding="async" />
      {(v.titre || v.sous) && (
        <figcaption>
          {v.titre && <b>{v.titre}</b>}
          {v.sous && <span>{v.sous}</span>}
        </figcaption>
      )}
    </figure>
  )
}

function Copier({ texte }: { texte: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button type="button" className="pr-copy" onClick={() => {
      navigator.clipboard?.writeText(texte).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) }).catch(() => {})
    }}>{ok ? 'Copié ✓' : 'Copier'}</button>
  )
}

function Carte({ p }: { p: Piece }) {
  const cles = (Object.keys(p.textes) as (Plateforme | 'commun')[])
  const [onglet, setOnglet] = useState(cles[0])
  const texte = p.textes[onglet] ?? ''
  return (
    <article className="pr-card">
      <header className="pr-card-h">
        <span className="pr-time">{p.heure}</span>
        <span className="pr-format">{p.format}{p.duree ? ` · ${p.duree}` : ''}</span>
        <span className="pr-badges">{p.plateformes.map(x => <Badge key={x} p={x} />)}</span>
      </header>
      <h3>{p.titre}</h3>
      {p.accroche && <p className="pr-hook">« {p.accroche} »</p>}
      {p.visuels && <div className="pr-visuels">{p.visuels.map((v, i) => <Apercu key={i} v={v} />)}</div>}

      {p.script && (
        <details className="pr-sec">
          <summary>Script et plans ({p.script.length})</summary>
          <ol className="pr-script">
            {p.script.map((s, i) => (
              <li key={i}><span className="pr-t">{s.t}</span>
                <div>{s.voix && <p className="pr-voix">🎙 {s.voix}</p>}<p className="pr-ecran">🎬 {s.ecran}</p></div>
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="pr-sec pr-textes">
        {cles.length > 1 && <div className="pr-tabs" role="tablist">
          {cles.map(c => (
            <button key={c} type="button" role="tab" aria-selected={c === onglet} className={c === onglet ? 'on' : ''}
              onClick={() => setOnglet(c)}>{c === 'commun' ? 'Texte' : NOMS[c]}</button>
          ))}
        </div>}
        {onglet === 'youtube' && p.titreYoutube && <p className="pr-yt-title"><b>Titre :</b> {p.titreYoutube} <Copier texte={p.titreYoutube} /></p>}
        <pre className="pr-text">{texte}{p.hashtags ? `\n\n${p.hashtags.join(' ')}` : ''}</pre>
        <Copier texte={texte + (p.hashtags ? `\n\n${p.hashtags.join(' ')}` : '')} />
      </div>

      {p.prod && <p className="pr-prod">🛠 {p.prod}</p>}
    </article>
  )
}

export default function Promo() {
  const { me } = useSession()
  const [jour, setJour] = useState<number | null>(null)
  const [plat, setPlat] = useState<Plateforme | null>(null)
  useEffect(() => {
    document.title = 'Plan de lancement · Chapote CM'
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex,nofollow'
    document.head.appendChild(m)
    return () => { m.remove() }
  }, [])

  const compte = useMemo(() => {
    const n: Record<Plateforme, number> = { youtube: 0, instagram: 0, tiktok: 0, linkedin: 0, x: 0 }
    SEMAINE.forEach(d => d.pieces.forEach(p => p.plateformes.forEach(x => { n[x]++ })))
    return n
  }, [])

  if (!me?.is_superadmin) {
    return <div className="col" style={{ padding: 24 }}><h1>Page introuvable</h1><Link to="/">Retour à l'accueil</Link></div>
  }

  const jours = SEMAINE.map((d, i) => ({ d, i })).filter(({ i }) => jour === null || i === jour)
  return (
    <div className="pr">
      <header className="pr-top">
        <Link to="/" className="pr-brand"><BrandMark size={28} />Chapote CM</Link>
        <span className="pr-draft">Brouillon · rien n'est publié</span>
      </header>

      <section className="pr-hero">
        <h1>Plan de lancement · semaine 1</h1>
        <p>Une semaine de contenu pour faire connaître Chapote CM : une vidéo verticale par jour (Reels, Shorts, TikTok),
          deux vidéos YouTube longues, des stories, LinkedIn et X. Tout vient du code et des textes officiels de l'app.</p>
        <ul className="pr-counts">
          {ORDRE.map(p => <li key={p}><a href={COMPTES[p].url} target="_blank" rel="noreferrer"><Badge p={p} /></a><b>{compte[p]}</b></li>)}
        </ul>
        <details className="pr-rules">
          <summary>Règles de la semaine</summary>
          <ul>{REGLES.map(r => <li key={r}>{r}</li>)}</ul>
        </details>
      </section>

      <nav className="pr-filters" aria-label="Filtres">
        <div className="pr-chips">
          <button type="button" className={jour === null ? 'on' : ''} onClick={() => setJour(null)}>Semaine</button>
          {SEMAINE.map((d, i) => <button key={d.nom} type="button" className={jour === i ? 'on' : ''} onClick={() => setJour(i)}>{d.nom.slice(0, 3)}</button>)}
        </div>
        <div className="pr-chips">
          <button type="button" className={plat === null ? 'on' : ''} onClick={() => setPlat(null)}>Tout</button>
          {ORDRE.map(p => <button key={p} type="button" className={plat === p ? 'on' : ''} onClick={() => setPlat(p)}>{NOMS[p]}</button>)}
        </div>
      </nav>

      {jours.map(({ d }) => {
        const pieces = d.pieces.filter(p => !plat || p.plateformes.includes(plat)).sort((a, b) => a.heure.localeCompare(b.heure))
        if (!pieces.length) return null
        return (
          <section key={d.nom} className="pr-day">
            <h2><span>{d.date}</span> {d.theme}</h2>
            <p className="pr-goal">{d.but}</p>
            <div className="pr-grid">{pieces.map(p => <Carte key={p.id} p={p} />)}</div>
          </section>
        )
      })}

      <footer className="pr-foot">
        <p>Visuels : captures de l'app (données de démonstration) et fonds générés avec Gemini, titres posés par la page.
          Vidéos à produire avec la chaîne claude-cloud (voix Qwen3, mots horodatés, montage Remotion), puis à programmer dans Chapote CM.</p>
      </footer>
    </div>
  )
}
