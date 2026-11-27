// Plan de lancement de Chapote CM (cm.chapote.fr/promo) : une semaine de contenu pour toutes les plateformes, à relire.
// Réservé au superadmin (Me.is_superadmin) ; noindex. Rien n'est publié d'ici : brouillon de travail.
// Contenu : src/promo/plan.ts. Visuels : public/promo/ (captures de démo de l'app, fonds générés avec Gemini, titres posés ici).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '../components/ui'
import { useSession } from '../session'
import { COMPTES, REGLES, SEMAINES, VUES, type Piece, type Plateforme, type Visuel } from '../promo/plan'
import { VIDEOS } from '../promo/videos'
import { BILAN, NOTES } from '../promo/bilan'
import { COMPARAISON, PILOTES, type Pilote } from '../promo/pilotes'
import '../promo/promo.css'

const NOMS: Record<Plateforme, string> = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X' }
const ORDRE: Plateforme[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x']
const GRILLES: Record<string, string> = { hook: 'Hook (0-3 s)', dynamisme: 'Dynamisme / motion', voix_script: 'Voix et script', sous_titres: 'Sous-titres',
  son: 'Son et musique', plateforme: 'Adapté à la plateforme', youtube_long: 'Format YouTube long', interaction: 'Interaction', ecran_reel: 'Écran réel',
  mouvement: 'Mouvement', accroche: 'Accroche', fait: 'Fait vérifiable', utile: 'Utile pour un CM', format: 'Format', authenticite: 'Voix du fondateur', produit: 'Produit à sa place' }
const DOCS = 'https://github.com/Naltpom/ChatBot_SASS/tree/master/docs/promo-video'
const couleur = (n: number) => n >= 7 ? 'ok' : n >= 5 ? 'moyen' : 'faible'

function NoteBloc({ id }: { id: string }) {
  const n = NOTES[id]
  if (!n) return null
  return (
    <details className="pr-note">
      <summary><span className={`pr-score ${couleur(n.note)}`}>{n.note}/10</span> Bilan avant refonte</summary>
      <ul className="pr-sousnotes">{Object.entries(n.detail).map(([k, v]) => <li key={k}><span>{GRILLES[k] ?? k}</span><b>{v}</b></li>)}</ul>
      <ul className="pr-pb">{n.problemes.map(x => <li key={x}>{x}</li>)}</ul>
    </details>
  )
}

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
        <span className="pr-format">{p.format}{VIDEOS[p.id] ? ` · ${Math.round(VIDEOS[p.id].duree)} s` : p.duree ? ` · ${p.duree}` : ''}</span>
        <span className="pr-badges">{p.plateformes.map(x => <Badge key={x} p={x} />)}</span>
      </header>
      <h3>{p.titre}</h3>
      <NoteBloc id={p.id} />
      {p.accroche && <p className="pr-hook">« {p.accroche} »</p>}
      {VIDEOS[p.id] ? (
        <div className="pr-visuels">
          <video className={`pr-video pr-${p.video === 'horizontale' ? 'paysage' : 'portrait'}`} src={VIDEOS[p.id].src} poster={VIDEOS[p.id].poster}
            controls playsInline preload="none" />
          {p.visuels?.filter(v => v.format === 'paysage').map((v, i) => <Apercu key={i} v={v} />)}
        </div>
      ) : p.visuels && <div className="pr-visuels">{p.visuels.map((v, i) => <Apercu key={i} v={v} />)}</div>}

      {p.script && (
        <details className="pr-sec">
          <summary>Script et plans ({p.script.length})</summary>
          <ol className="pr-script">
            {p.script.map((s, i) => (
              <li key={i}><span className="pr-t">{s.t}</span>
                <div>{s.voix && <p className="pr-voix">🎙 {s.voix}</p>}<p className="pr-ecran">🎬 {s.vue ? `Écran réel : ${VUES[s.vue] ?? s.vue}` : s.ecran}{s.texte ? ` · texte « ${s.texte} »` : ''}</p></div>
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


function CartePilote({ p }: { p: Pilote }) {
  const c = p.controles
  return (
    <article className="pr-card">
      <div className="pr-card-h"><span className="pr-format">{p.format} · {p.duree} s</span>
        <span className="pr-badges">{(['instagram', 'tiktok', 'youtube'] as Plateforme[]).map(x => <Badge key={x} p={x} />)}</span></div>
      <h3>{p.titre}</h3>
      <p className="pr-hook">Accroche : « {p.accroche} »</p>
      <video className="pr-video pr-portrait" src={p.src} poster={p.poster} controls playsInline preload="none" />
      <details className="pr-note" open>
        <summary><span className={`pr-score ${couleur(p.note)}`}>v2 {p.note}/10</span> v1 : {p.avant}/10 en moyenne</summary>
        <ul className="pr-sousnotes">{Object.entries(p.detail).map(([k, v]) => <li key={k}><span>{GRILLES[k] ?? k}</span><b>{v}</b></li>)}</ul>
        <ul className="pr-pb">{p.remarques.map(x => <li key={x}>{x}</li>)}</ul>
      </details>
      <details className="pr-sec">
        <summary>Contrôles automatiques</summary>
        <ul className="pr-pb">
          <li>Premier mot à {c.premier_mot_s} s · {c.mots_par_s} mots/s · accroche de {c.accroche_mots} mots</li>
          <li>Son {c.lufs} LUFS, crête {c.true_peak} dBTP (cible -14 / -1)</li>
          <li>Images figées plus de 1,5 s : {c.images_figees_1_5s.length ? c.images_figees_1_5s.join(', ') + ' s' : 'aucune'} · plus long sans événement : {c.plus_long_sans_evenement_s} s</li>
          <li>{c.plans} plans, {c.taps} taps simulés</li>
        </ul>
      </details>
      <div className="pr-textes">
        <pre className="pr-text">{p.legende}</pre>
        <Copier texte={p.legende} />
      </div>
    </article>
  )
}

export default function Promo() {
  const { me } = useSession()
  const [sem, setSem] = useState(0)
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
    SEMAINES.forEach(w => w.jours.forEach(d => d.pieces.forEach(p => p.plateformes.forEach(x => { n[x]++ }))))
    return n
  }, [])

  if (!me?.is_superadmin) {
    return <div className="col" style={{ padding: 24 }}><h1>Page introuvable</h1><Link to="/">Retour à l'accueil</Link></div>
  }

  const SEMAINE = SEMAINES[sem].jours
  const jours = SEMAINE.map((d, i) => ({ d, i })).filter(({ i }) => jour === null || i === jour)
  const nVideos = Object.keys(VIDEOS).length
  return (
    <div className="pr">
      <header className="pr-top">
        <Link to="/" className="pr-brand"><BrandMark size={28} />Chapote CM</Link>
        <span className="pr-draft">Brouillon · rien n'est publié</span>
      </header>

      <section className="pr-hero">
        <h1>Plan de lancement · 1 mois</h1>
        <p>Quatre semaines de contenu pour faire connaître Chapote CM : une vidéo verticale par jour (Reels, Shorts, TikTok),
          une vidéo YouTube longue par semaine, des stories, LinkedIn et X. Faits et écrans vérifiés dans le code de l'app.
          {nVideos > 0 && ` ${nVideos} vidéos produites, à regarder ici (rien n'est programmé).`}</p>
        <ul className="pr-counts">
          {ORDRE.map(p => <li key={p}><a href={COMPTES[p].url} target="_blank" rel="noreferrer"><Badge p={p} /></a><b>{compte[p]}</b></li>)}
        </ul>
        {PILOTES.length > 0 && (
          <section className="pr-bilan">
            <h2>Pilotes v2 · nouvelle méthode</h2>
            <p>{PILOTES.length} vidéos refaites selon le guide : caméra qui voyage dans les vrais écrans, taps simulés, téléphone en 3D,
              accroche dès l'image 0, voix plus vive, sous-titres de 2-3 mots dans la zone visible, musique libre et bruitages mixés à -14 LUFS.
              À valider avant de refaire les 32 autres. Rien n'est programmé.</p>
            <div className="pr-moy">
              <div><b className={`pr-score ${couleur(COMPARAISON.v1.moyenne)}`}>{COMPARAISON.v1.moyenne}/10</b><span>v1 · 32 vidéos</span></div>
              <div><b className={`pr-score ${couleur(COMPARAISON.v2.moyenne)}`}>{COMPARAISON.v2.moyenne}/10</b><span>v2 · 3 pilotes</span></div>
            </div>
            <table className="pr-comp">
              <thead><tr><th>Grille</th><th>v1</th><th>v2</th><th></th></tr></thead>
              <tbody>{Object.entries(COMPARAISON.v2.grilles).map(([k, v]) => {
                const a = (COMPARAISON.v1.grilles as Record<string, number>)[k]
                const d = Math.round((v - a) * 10) / 10
                return <tr key={k}><td>{GRILLES[k] ?? k}</td><td><span className={`pr-score ${couleur(a)}`}>{a}</span></td><td><span className={`pr-score ${couleur(v)}`}>{v}</span></td>
                  <td className={d >= 0 ? 'pr-plus' : 'pr-moins'}>{d >= 0 ? '+' : ''}{d}</td></tr>
              })}</tbody>
            </table>
            <p className="pr-goal">Notes v2 données par un évaluateur indépendant (agent séparé, mêmes grilles, vidéos regardées et mesurées) sur la première version des pilotes ;
              plusieurs défauts relevés sont déjà corrigés (détail sur chaque fiche). Rythme ralenti après écoute : 19-24 s au lieu de 13-14 s (la note v2 porte sur la version rapide).</p>
            <div className="pr-grid">{PILOTES.map(p => <CartePilote key={p.id} p={p} />)}</div>
          </section>
        )}
        <section className="pr-bilan">
          <h2>Bilan avant refonte</h2>
          <p>Chaque élément noté sur 10 avec les grilles de 10 recherches (hooks, motion design, viraux, voix, sous-titres, son,
            algorithmes, YouTube, outils, fondateur/LinkedIn/X) et des mesures sur les fichiers. Seuil de publication : 7/10.</p>
          <div className="pr-moy">
            <div><b className={`pr-score ${couleur(BILAN.moyenneVideos)}`}>{BILAN.moyenneVideos}/10</b><span>vidéos (32)</span></div>
            <div><b className={`pr-score ${couleur(BILAN.moyenneAutres)}`}>{BILAN.moyenneAutres}/10</b><span>stories et posts</span></div>
          </div>
          <ul className="pr-barres">
            {Object.entries(BILAN.grilles).map(([k, v]) => (
              <li key={k}><span>{GRILLES[k] ?? k}</span><i><em className={couleur(v)} style={{ width: `${v * 10}%` }} /></i><b>{v}</b></li>
            ))}
          </ul>
          <p className="pr-goal">À corriger d'abord : images figées (38 % du temps), son trop bas (-23 LUFS au lieu de -14) et sans musique,
            voix sans énergie, sous-titres sous la zone visible des applis. <a href={DOCS} target="_blank" rel="noreferrer">Guide et 10 recherches</a>.</p>
        </section>
        <details className="pr-rules">
          <summary>Règles de la semaine</summary>
          <ul>{REGLES.map(r => <li key={r}>{r}</li>)}</ul>
        </details>
      </section>

      <nav className="pr-filters" aria-label="Filtres">
        <div className="pr-chips">
          {SEMAINES.map((w, i) => <button key={w.titre} type="button" className={sem === i ? 'on' : ''} onClick={() => { setSem(i); setJour(null) }}>S{i + 1}</button>)}
          <span className="pr-sem">{SEMAINES[sem].titre} · {SEMAINES[sem].dates}</span>
        </div>
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

      <details className="pr-rules pr-ecrans">
        <summary>Les écrans réels montrés dans les vidéos ({Object.keys(VUES).length})</summary>
        <p className="pr-goal">Captures du code actuel de l'app (site et app Android), avec des comptes fictifs et des données de démonstration.</p>
        <div className="pr-galerie">
          {Object.entries(VUES).map(([k, nom]) => (
            <figure key={k}><img src={`/promo/ecrans/mobile/${k}.webp`} alt={nom} loading="lazy" /><figcaption>{nom}</figcaption></figure>
          ))}
        </div>
      </details>

      <footer className="pr-foot">
        <p>Visuels : captures de l'app (données de démonstration) et fonds générés avec Gemini, titres posés par la page.
          Vidéos à produire avec la chaîne claude-cloud (voix Qwen3, mots horodatés, montage Remotion), puis à programmer dans Chapote CM.</p>
      </footer>
    </div>
  )
}
