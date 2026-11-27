// Briques communes des pages /promo (superadmin) : badges, cartes de publication, notes, versions, retours.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { VUES, type Piece, type Plateforme, type Visuel } from './plan'
import { VIDEOS } from './videos'
import { NOTES } from './bilan'
import { STATUTS, type Entree, type Statut, type Version } from './suivi'

export const NOMS: Record<Plateforme, string> = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X' }
export const ORDRE: Plateforme[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x']
export const GRILLES: Record<string, string> = { hook: 'Hook (0-3 s)', dynamisme: 'Dynamisme / motion', voix_script: 'Voix et script', sous_titres: 'Sous-titres',
  son: 'Son et musique', plateforme: 'Adapté à la plateforme', youtube_long: 'Format YouTube long', interaction: 'Interaction', ecran_reel: 'Écran réel',
  mouvement: 'Mouvement', accroche: 'Accroche', fait: 'Fait vérifiable', utile: 'Utile pour un CM', format: 'Format', authenticite: 'Voix du fondateur', produit: 'Produit à sa place' }
export const DOCS = 'https://github.com/Naltpom/ChatBot_SASS/tree/master/docs/promo-video'
export const couleur = (n: number) => n >= 7 ? 'ok' : n >= 5 ? 'moyen' : 'faible'

export function Badge({ p }: { p: Plateforme }) {
  return <span className={`pr-badge pr-${p}`}>{NOMS[p]}</span>
}

export function Pastille({ s }: { s: Statut }) {
  return <span className="pr-statut" style={{ background: STATUTS[s].couleur }}>{STATUTS[s].nom}</span>
}

export function Apercu({ v }: { v: Visuel }) {
  return (
    <figure className={`pr-vis pr-${v.format} ${v.type === 'capture' ? 'pr-cap' : ''}`}>
      <img src={v.src} alt="" loading="lazy" decoding="async" />
      {(v.titre || v.sous) && <figcaption>{v.titre && <b>{v.titre}</b>}{v.sous && <span>{v.sous}</span>}</figcaption>}
    </figure>
  )
}

export function Copier({ texte }: { texte: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button type="button" className="pr-copy" onClick={() => {
      navigator.clipboard?.writeText(texte).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) }).catch(() => {})
    }}>{ok ? 'Copié ✓' : 'Copier'}</button>
  )
}

export function NoteBloc({ id }: { id: string }) {
  const n = NOTES[id]
  if (!n) return null
  return (
    <details className="pr-note">
      <summary><span className={`pr-score ${couleur(n.note)}`}>{n.note}/10</span> Note v1</summary>
      <ul className="pr-sousnotes">{Object.entries(n.detail).map(([k, v]) => <li key={k}><span>{GRILLES[k] ?? k}</span><b>{v}</b></li>)}</ul>
      <ul className="pr-pb">{n.problemes.map(x => <li key={x}>{x}</li>)}</ul>
    </details>
  )
}

/** Une version d'une publication : vidéo, note, problèmes relevés. */
export function VersionBloc({ v, ouverte }: { v: Version; ouverte?: boolean }) {
  return (
    <details className="pr-version" open={ouverte}>
      <summary><b>{v.v}</b> <span className="pr-muted">{v.date}</span>
        {v.note !== undefined && <span className={`pr-score ${couleur(v.note)}`}>{v.note}/10</span>}</summary>
      <p className="pr-muted">{v.resume}</p>
      {v.video && <video className={`pr-video pr-${v.video.format === 'horizontale' ? 'paysage' : 'portrait'}`} src={v.video.src} poster={v.video.poster} controls playsInline preload="none" />}
      {v.detail && <ul className="pr-sousnotes">{Object.entries(v.detail).map(([k, x]) => <li key={k}><span>{GRILLES[k] ?? k}</span><b>{x}</b></li>)}</ul>}
      {v.problemes && v.problemes.length > 0 && <ul className="pr-pb">{v.problemes.map(x => <li key={x}>{x}</li>)}</ul>}
    </details>
  )
}

/** Ligne compacte d'une publication (listes, tableau de bord). */
export function Ligne({ e }: { e: Entree }) {
  const der = e.versions[e.versions.length - 1]
  const note = [...e.versions].reverse().find(v => v.note !== undefined)?.note
  return (
    <Link to={`/promo/p/${e.id}`} className="pr-ligne">
      {der.video ? <img src={der.video.poster} alt="" loading="lazy" /> : <span className="pr-ligne-vide">{e.format.slice(0, 1)}</span>}
      <span className="pr-ligne-t"><b>{e.titre}</b><small>{e.date}{e.heure ? ` · ${e.heure}` : ''} · {e.format} · {e.versions.length} version{e.versions.length > 1 ? 's' : ''}</small></span>
      <span className="pr-ligne-d">{note !== undefined && <span className={`pr-score ${couleur(note)}`}>{note}</span>}<Pastille s={e.statut} /></span>
    </Link>
  )
}

/** Contenu d'une publication : script, textes par plateforme, production. */
export function Contenu({ p }: { p: Piece }) {
  const cles = (Object.keys(p.textes) as (Plateforme | 'commun')[])
  const [onglet, setOnglet] = useState(cles[0])
  const texte = p.textes[onglet] ?? ''
  return (
    <>
      {p.accroche && <p className="pr-hook">Accroche : « {p.accroche} »</p>}
      {!VIDEOS[p.id] && p.visuels && <div className="pr-visuels">{p.visuels.map((v, i) => <Apercu key={i} v={v} />)}</div>}
      {p.script && (
        <details className="pr-sec" open>
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
          {cles.map(c => <button key={c} type="button" role="tab" aria-selected={c === onglet} className={c === onglet ? 'on' : ''} onClick={() => setOnglet(c)}>{c === 'commun' ? 'Texte' : NOMS[c]}</button>)}
        </div>}
        {onglet === 'youtube' && p.titreYoutube && <p className="pr-yt-title"><b>Titre :</b> {p.titreYoutube} <Copier texte={p.titreYoutube} /></p>}
        <pre className="pr-text">{texte}{p.hashtags ? `\n\n${p.hashtags.join(' ')}` : ''}</pre>
        <Copier texte={texte + (p.hashtags ? `\n\n${p.hashtags.join(' ')}` : '')} />
      </div>
      {p.prod && <p className="pr-prod">🛠 {p.prod}</p>}
    </>
  )
}

/** Carte d'une publication dans la liste par jour. */
export function Carte({ e }: { e: Entree }) {
  const p = e.piece!
  const der = e.versions[e.versions.length - 1]
  return (
    <article className="pr-card">
      <header className="pr-card-h">
        <span className="pr-time">{p.heure}</span>
        <span className="pr-format">{p.format}{der.video ? ` · ${Math.round(der.video.duree)} s` : p.duree ? ` · ${p.duree}` : ''}</span>
        <span className="pr-badges">{p.plateformes.map(x => <Badge key={x} p={x} />)}</span>
      </header>
      <h3><Link to={`/promo/p/${e.id}`}>{p.titre}</Link></h3>
      <div className="pr-card-st"><Pastille s={e.statut} /><NoteBloc id={p.id} /></div>
      {der.video && <video className={`pr-video pr-${der.video.format === 'horizontale' ? 'paysage' : 'portrait'}`} src={der.video.src} poster={der.video.poster} controls playsInline preload="none" />}
      <Link className="pr-lien" to={`/promo/p/${e.id}`}>Fiche complète : versions, retours, textes →</Link>
    </article>
  )
}
