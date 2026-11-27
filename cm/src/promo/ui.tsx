// Briques communes de l'espace /promo (superadmin) : badges, pastilles de statut, aperçus, contenu d'une publication.
import { useState } from 'react'
import { VUES, type Piece, type Plateforme, type Visuel } from './plan'
import { VIDEOS } from './videos'
import { STATUTS, type Statut } from './suivi'

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
