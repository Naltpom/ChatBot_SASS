// Pages du tableau de bord /promo (superadmin) : tableau de bord, calendrier 3 mois, publications, fiche d'une publication,
// labo (pilotes), blog (guide et recherches), règles et sources, bilan, écrans.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { COMPTES, REGLES, SEMAINES, type Plateforme } from './plan'
import { BILAN, NOTES } from './bilan'
import { COMPARAISON, PILOTES } from './pilotes'
import { ACTIONS, ENTREES, LABO, PREVISIONNEL, STATUTS, dateDu, fmt, parId, toutes, type Statut } from './suivi'
import { Badge, Carte, Contenu, Copier, DOCS, GRILLES, Ligne, NOMS, ORDRE, Pastille, VersionBloc, couleur } from './ui'

const Markdown = lazy(() => import('react-markdown'))
const ARTICLES = import.meta.glob('./articles/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const slug = (k: string) => k.replace('./articles/', '').replace('.md', '')
const TITRES: Record<string, string> = {
  '00-guide': 'Le guide : ce qui marche (synthèse des 10 recherches)', '01-hooks': 'Hooks : arrêter le pouce en 3 secondes', '02-motion-design': 'Motion design : une caméra qui voyage',
  '03-viraux-startups': 'Vidéos virales de startups', '04-voix-scripts': 'Voix et scripts', '05-sous-titres': 'Sous-titres', '06-son-musique': 'Son et musique',
  '07-algorithmes': 'Les algorithmes en 2025-2026', '08-youtube-long': 'YouTube horizontal', '09-outils-ia-video': 'Outils : Remotion, HyperFrames, IA',
  '10-fondateur-linkedin-x-fr': 'Fondateur, LinkedIn, X et marché français', '11-pilotes-v2': 'Carnet : comment on a fait les pilotes v2', '12-retours-utilisateurs': 'Conception : des retours utilisateurs aux PR (bugs et idées)',
}
const ECRANS_APP = ['planning', 'n2', 'n3', 'n4', 'stats', 'library', 'post-1', 'post-3', 'accounts', 'settings', 'videos', 'drafts', 'storage', 'welcome']
const NOMS_APP: Record<string, string> = { planning: 'Planning', n2: 'Nouvelle publication : bibliothèque', n3: 'Nouvelle publication : titre et légende', n4: 'Comptes et date',
  stats: 'Statistiques', library: 'Bibliothèque (Drive)', 'post-1': 'Publication : un échec à rattraper', 'post-3': 'Publication programmée', accounts: 'Comptes et groupes',
  settings: 'Réglages', videos: 'Vidéos publiées', drafts: 'Brouillons à valider', storage: 'Stockage Google Drive', welcome: 'Bienvenue : connecter ses comptes' }

function Titre({ t, sous }: { t: string; sous?: string }) {
  useEffect(() => { document.title = `${t} · Promo Chapote CM` }, [t])
  return <div className="pr-hero"><h1>{t}</h1>{sous && <p>{sous}</p>}</div>
}

export function Tableau() {
  const tout = toutes()
  const parStatut = useMemo(() => {
    const n = {} as Record<Statut, number>; (Object.keys(STATUTS) as Statut[]).forEach(s => { n[s] = 0 })
    tout.forEach(e => { n[e.statut]++ }); PREVISIONNEL.forEach(s => { n.idee += Object.values(s.prevu).reduce((a, b) => a + (b || 0), 0) })
    return n
  }, [tout])
  const prochaines = ENTREES.slice(0, 8)
  const fait = ACTIONS.filter(a => a.fait).length
  return (
    <>
      <Titre t="Promo · tableau de bord" sous="Suivi prévisionnel de la promo de Chapote CM sur 3 mois : ce qui est prêt, à refaire, à valider, et ce qu'on en a appris. Rien n'est programmé ni publié d'ici." />
      <section className="pr-kpis">
        <div><b>{ENTREES.length}</b><span>publications écrites (mois 1)</span></div>
        <div><b>{PREVISIONNEL.reduce((a, s) => a + Object.values(s.prevu).reduce((x, y) => x + (y || 0), 0), 0)}</b><span>prévues (mois 2-3)</span></div>
        <div><b className={`pr-score ${couleur(COMPARAISON.v1.moyenne)}`}>{COMPARAISON.v1.moyenne}</b><span>note v1 (32 vidéos)</span></div>
        <div><b className={`pr-score ${couleur(COMPARAISON.v2.moyenne)}`}>{COMPARAISON.v2.moyenne}</b><span>note v2 (3 pilotes)</span></div>
      </section>
      <section className="pr-bilan">
        <h2>Où en est-on</h2>
        <ul className="pr-barres">
          {(Object.keys(STATUTS) as Statut[]).map(s => (
            <li key={s}><span>{STATUTS[s].nom}</span><i><em style={{ width: `${Math.min(100, parStatut[s] / Math.max(1, ...Object.values(parStatut)) * 100)}%`, background: STATUTS[s].couleur }} /></i><b>{parStatut[s]}</b></li>
          ))}
        </ul>
      </section>
      <div className="pr-2col">
        <section className="pr-bilan">
          <h2>Prochaines actions <small className="pr-muted">{fait}/{ACTIONS.length}</small></h2>
          <ul className="pr-actions">{ACTIONS.map(a => <li key={a.texte} className={a.fait ? 'fait' : ''}>{a.fait ? '✓' : '○'} {a.texte}</li>)}</ul>
        </section>
        <section className="pr-bilan">
          <h2>Laboratoire : pilotes v2</h2>
          <div className="pr-liste">{LABO.map(e => <Ligne key={e.id} e={e} />)}</div>
          <Link className="pr-lien" to="/promo/labo">Comparer v1 et v2 →</Link>
        </section>
      </div>
      <section className="pr-bilan">
        <h2>Semaine 1 · à partir du {fmt(dateDu(0))}</h2>
        <div className="pr-liste">{prochaines.map(e => <Ligne key={e.id} e={e} />)}</div>
        <Link className="pr-lien" to="/promo/calendrier">Tout le calendrier (3 mois) →</Link>
      </section>
      <section className="pr-bilan">
        <h2>Comptes de la promo</h2>
        <ul className="pr-counts">{ORDRE.map(p => <li key={p}><a href={COMPTES[p].url} target="_blank" rel="noreferrer"><Badge p={p} /></a><span>{COMPTES[p].nom}</span></li>)}</ul>
      </section>
    </>
  )
}

export function Calendrier() {
  const [plat, setPlat] = useState<Plateforme | null>(null)
  return (
    <>
      <Titre t="Calendrier · 3 mois" sous="Mois 1 : chaque publication est écrite (cliquez pour sa fiche). Mois 2 et 3 : prévisionnel par semaine (thème, but, volume prévu), à écrire." />
      <div className="pr-chips">
        <button type="button" className={plat === null ? 'on' : ''} onClick={() => setPlat(null)}>Tout</button>
        {ORDRE.map(p => <button key={p} type="button" className={plat === p ? 'on' : ''} onClick={() => setPlat(p)}>{NOMS[p]}</button>)}
      </div>
      {SEMAINES.map((s, si) => (
        <section key={s.titre} className="pr-semaine">
          <h2>{s.titre} <small className="pr-muted">{s.dates}</small></h2>
          <div className="pr-cal">
            {s.jours.map((j, ji) => {
              const es = ENTREES.filter(e => e.jour === si * 7 + ji && (!plat || e.plateformes.includes(plat))).sort((a, b) => a.heure.localeCompare(b.heure))
              return (
                <div key={j.date} className="pr-cal-j">
                  <b>{j.date}</b><small>{j.theme}</small>
                  {es.map(e => <Link key={e.id} to={`/promo/p/${e.id}`} className="pr-cal-e" style={{ borderLeftColor: STATUTS[e.statut].couleur }}>
                    <span>{e.heure}</span> {e.titre}<em>{e.plateformes.map(p => NOMS[p][0]).join(' ')}</em></Link>)}
                </div>
              )
            })}
          </div>
        </section>
      ))}
      <h2 className="pr-h2">Mois 2 et 3 · prévisionnel</h2>
      <div className="pr-grid">
        {PREVISIONNEL.map(s => (
          <article key={s.n} className="pr-card">
            <header className="pr-card-h"><span className="pr-time">S{s.n}</span><span className="pr-format">{fmt(dateDu((s.n - 1) * 7))} – {fmt(dateDu((s.n - 1) * 7 + 6))}</span><Pastille s="idee" /></header>
            <h3>{s.titre}</h3>
            <p className="pr-muted">{s.but}</p>
            <ul className="pr-counts">{Object.entries(s.prevu).map(([k, v]) => <li key={k}>{k === 'story' ? <span className="pr-badge pr-story-b">Story</span> : <Badge p={k as Plateforme} />}<b>{v}</b></li>)}</ul>
            <ul className="pr-pb">{s.idees.map(i => <li key={i}>{i}</li>)}</ul>
          </article>
        ))}
      </div>
    </>
  )
}

export function Publications() {
  const [sem, setSem] = useState(0)
  const [plat, setPlat] = useState<Plateforme | null>(null)
  const [st, setSt] = useState<Statut | null>(null)
  const es = ENTREES.filter(e => e.semaine === sem && (!plat || e.plateformes.includes(plat)) && (!st || e.statut === st))
  return (
    <>
      <Titre t="Publications · mois 1" sous="Chaque publication avec son statut, sa dernière version et sa note. La fiche complète garde les versions, les textes et les retours d'expérience." />
      <nav className="pr-filters" aria-label="Filtres">
        <div className="pr-chips">
          {SEMAINES.map((w, i) => <button key={w.titre} type="button" className={sem === i ? 'on' : ''} onClick={() => setSem(i)}>S{i + 1}</button>)}
          <span className="pr-sem">{SEMAINES[sem].titre} · {SEMAINES[sem].dates}</span>
        </div>
        <div className="pr-chips">
          <button type="button" className={plat === null ? 'on' : ''} onClick={() => setPlat(null)}>Tout</button>
          {ORDRE.map(p => <button key={p} type="button" className={plat === p ? 'on' : ''} onClick={() => setPlat(p)}>{NOMS[p]}</button>)}
        </div>
        <div className="pr-chips">
          <button type="button" className={st === null ? 'on' : ''} onClick={() => setSt(null)}>Tous statuts</button>
          {(Object.keys(STATUTS) as Statut[]).map(s => <button key={s} type="button" className={st === s ? 'on' : ''} onClick={() => setSt(s)}>{STATUTS[s].nom}</button>)}
        </div>
      </nav>
      {SEMAINES[sem].jours.map((j, ji) => {
        const d = es.filter(e => e.jour === sem * 7 + ji).sort((a, b) => a.heure.localeCompare(b.heure))
        if (!d.length) return null
        return <section key={j.date} className="pr-day"><h2><span>{j.date}</span> {j.theme}</h2><p className="pr-goal">{j.but}</p>
          <div className="pr-grid">{d.map(e => <Carte key={e.id} e={e} />)}</div></section>
      })}
    </>
  )
}

export function Fiche() {
  const { id = '' } = useParams()
  const e = parId(id)
  if (!e) return <><Titre t="Publication introuvable" /><Link to="/promo/publications">← Publications</Link></>
  const pilote = PILOTES.find(p => `pilote-${p.id}` === e.id)
  return (
    <>
      <p><Link to={e.semaine < 0 ? '/promo/labo' : '/promo/publications'} className="pr-lien">← {e.semaine < 0 ? 'Laboratoire' : 'Publications'}</Link></p>
      <div className="pr-hero">
        <h1>{e.titre}</h1>
        <p className="pr-card-h"><Pastille s={e.statut} /><span>{e.date}{e.heure ? ` · ${e.heure}` : ''}</span><span className="pr-format">{e.format}</span>
          <span className="pr-badges">{e.plateformes.map(x => <Badge key={x} p={x} />)}</span></p>
      </div>
      <div className="pr-fiche">
        <section className="pr-bilan">
          <h2>Versions ({e.versions.length})</h2>
          {[...e.versions].reverse().map((v, i) => <VersionBloc key={v.v} v={v} ouverte={i === 0} />)}
        </section>
        <section className="pr-bilan">
          <h2>Retours d'expérience ({e.retours.length})</h2>
          {e.retours.length ? <ol className="pr-retours">{e.retours.map((r, i) => <li key={i}><b>{r.auteur}</b> <span className="pr-muted">{r.date}</span><p>{r.texte}</p></li>)}</ol>
            : <p className="pr-muted">Aucun retour pour l'instant. Après publication : vues, rétention, commentaires et ce qu'on en retient.</p>}
          <p className="pr-muted">Pour ajouter un retour : le dire à Claude dans la session, il l'écrit dans <code>cm/src/promo/suivi.ts</code>.</p>
        </section>
      </div>
      <section className="pr-bilan">
        <h2>Contenu</h2>
        {e.piece ? <Contenu p={e.piece} /> : pilote && <>
          <p className="pr-hook">Accroche : « {pilote.accroche} »</p>
          <details className="pr-sec" open><summary>Contrôles automatiques (dernière version)</summary>
            <ul className="pr-pb">
              <li>{pilote.controles.mots_par_s} mots/s · accroche de {pilote.controles.accroche_mots} mots · premier mot à {pilote.controles.premier_mot_s} s</li>
              <li>Son {pilote.controles.lufs} LUFS, crête {pilote.controles.true_peak} dBTP</li>
              <li>Images figées : {pilote.controles.images_figees_1_5s.length ? pilote.controles.images_figees_1_5s.join(', ') : 'aucune'} · {pilote.controles.plans} plans · {pilote.controles.taps} taps</li>
            </ul></details>
          <div className="pr-textes"><pre className="pr-text">{pilote.legende}</pre><Copier texte={pilote.legende} /></div>
        </>}
      </section>
    </>
  )
}

export function Labo() {
  return (
    <>
      <Titre t="Laboratoire · pilotes v2" sous="Les essais de la nouvelle méthode, avant de refaire les 32 vidéos. Chaque pilote a sa fiche avec ses versions et les retours." />
      <section className="pr-bilan">
        <h2>v1 → v2 par grille</h2>
        <div className="pr-moy">
          <div><b className={`pr-score ${couleur(COMPARAISON.v1.moyenne)}`}>{COMPARAISON.v1.moyenne}/10</b><span>v1 · 32 vidéos</span></div>
          <div><b className={`pr-score ${couleur(COMPARAISON.v2.moyenne)}`}>{COMPARAISON.v2.moyenne}/10</b><span>v2.0 · 3 pilotes</span></div>
        </div>
        <table className="pr-comp">
          <thead><tr><th>Grille</th><th>v1</th><th>v2</th><th></th></tr></thead>
          <tbody>{Object.entries(COMPARAISON.v2.grilles).map(([k, v]) => {
            const a = (COMPARAISON.v1.grilles as Record<string, number>)[k], d = Math.round((v - a) * 10) / 10
            return <tr key={k}><td>{GRILLES[k] ?? k}</td><td><span className={`pr-score ${couleur(a)}`}>{a}</span></td><td><span className={`pr-score ${couleur(v)}`}>{v}</span></td><td className={d >= 0 ? 'pr-plus' : 'pr-moins'}>{d >= 0 ? '+' : ''}{d}</td></tr>
          })}</tbody>
        </table>
        <p className="pr-muted">Notes données par un évaluateur indépendant sur la v2.0 (rapide). Depuis : rythme ralenti (v2.1). À venir : voix refaites sur le PC et écrans de l'app Android.</p>
      </section>
      <div className="pr-liste">{LABO.map(e => <Ligne key={e.id} e={e} />)}</div>
    </>
  )
}

export function Blog() {
  return (
    <>
      <Titre t="Blog · ce qu'on a appris" sous="Le guide de synthèse, les 10 recherches (sources citées) et les carnets de production." />
      <div className="pr-liste">
        {Object.keys(ARTICLES).sort().map(k => <Link key={k} to={`/promo/blog/${slug(k)}`} className="pr-ligne"><span className="pr-ligne-vide">{slug(k).slice(0, 2)}</span>
          <span className="pr-ligne-t"><b>{TITRES[slug(k)] ?? slug(k)}</b><small>docs/promo-video</small></span></Link>)}
      </div>
    </>
  )
}

export function Article() {
  const { slug: s = '' } = useParams()
  const [md, setMd] = useState<string | null>(null)
  useEffect(() => { const f = ARTICLES[`./articles/${s}.md`]; if (f) f().then(setMd); else setMd('') }, [s])
  return (
    <>
      <p><Link to="/promo/blog" className="pr-lien">← Blog</Link></p>
      <article className="pr-article">
        {md === null ? <p className="pr-muted">Chargement…</p> : md === '' ? <p>Article introuvable.</p>
          : <Suspense fallback={<p className="pr-muted">Chargement…</p>}><Markdown components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{md}</Markdown></Suspense>}
      </article>
    </>
  )
}

export function Regles() {
  const [sources, setSources] = useState<{ titre: string; url: string; article: string }[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    Promise.all(Object.entries(ARTICLES).map(async ([k, f]) => ({ k: slug(k), md: await f() }))).then(all => {
      const vus = new Set<string>(); const out: { titre: string; url: string; article: string }[] = []
      all.forEach(({ k, md }) => {
        for (const ligne of md.split('\n')) {
          for (const m of ligne.matchAll(/https?:\/\/[^\s)>\]|`,;]+/g)) {
            const url = m[0].replace(/[.»]+$/, '')
            try { if (!new URL(url).hostname.includes('.')) continue } catch { continue }
            if (vus.has(url)) continue
            vus.add(url)
            const lien = ligne.match(/\[([^\]]{2,140})\]\(https?:/)
            const avant = ligne.slice(0, m.index).replace(/^[\s>*|-]*(\[S?\d+\])?\s*/, '').replace(/[\s:(—-]+$/, '').replace(/\*\*/g, '').trim()
            out.push({ titre: lien ? lien[1] : (avant.length > 3 ? avant.slice(0, 160) : url), url, article: k })
          }
        }
      })
      setSources(out)
    })
  }, [])
  const f = (sources ?? []).filter(s => !q || (s.titre + s.url).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <Titre t="Règles et sources" />
      <section className="pr-bilan">
        <h2>Règles de la promo</h2>
        <ul className="pr-pb">{REGLES.map(r => <li key={r}>{r}</li>)}</ul>
        <p className="pr-muted">Les 12 règles d'une vidéo verticale : <Link to="/promo/blog/00-guide">le guide</Link>.</p>
      </section>
      <section className="pr-bilan">
        <h2>Sources citées par les recherches {sources && <small className="pr-muted">({sources.length})</small>}</h2>
        <input className="pr-recherche" placeholder="Filtrer (TikTok, hook, LUFS…)" value={q} onChange={e => setQ(e.target.value)} />
        {sources === null ? <p className="pr-muted">Chargement…</p> : <ul className="pr-sources">{f.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.titre}</a>
          <small> · {new URL(s.url).hostname.replace('www.', '')} · <Link to={`/promo/blog/${s.article}`}>{s.article}</Link></small></li>)}</ul>}
      </section>
    </>
  )
}

export function Bilan() {
  const notes = Object.entries(NOTES).sort((a, b) => a[1].note - b[1].note)
  return (
    <>
      <Titre t="Bilan" sous="Chaque élément du mois 1 noté sur 10 avec les grilles des recherches et des mesures sur les fichiers. Seuil de publication : 7/10." />
      <section className="pr-bilan">
        <div className="pr-moy">
          <div><b className={`pr-score ${couleur(BILAN.moyenneVideos)}`}>{BILAN.moyenneVideos}/10</b><span>vidéos v1 (32)</span></div>
          <div><b className={`pr-score ${couleur(BILAN.moyenneAutres)}`}>{BILAN.moyenneAutres}/10</b><span>stories et posts</span></div>
          <div><b className={`pr-score ${couleur(COMPARAISON.v2.moyenne)}`}>{COMPARAISON.v2.moyenne}/10</b><span>pilotes v2</span></div>
        </div>
        <ul className="pr-barres">{Object.entries(BILAN.grilles).map(([k, v]) => <li key={k}><span>{GRILLES[k] ?? k}</span><i><em className={couleur(v)} style={{ width: `${v * 10}%` }} /></i><b>{v}</b></li>)}</ul>
        <p className="pr-muted"><a href={DOCS} target="_blank" rel="noreferrer">Recherches sur GitHub</a></p>
      </section>
      <section className="pr-bilan">
        <h2>Toutes les notes, de la plus basse à la plus haute</h2>
        <div className="pr-liste">{notes.map(([id]) => { const e = parId(id); return e ? <Ligne key={id} e={e} /> : null })}</div>
      </section>
    </>
  )
}

export function Ecrans() {
  return (
    <>
      <Titre t="Écrans réels" sous="Téléphone : l'app Android (c'est elle qui prime), version web de démonstration, profil fictif (Camille, @example.com). Ordinateur : cm.chapote.fr." />
      <h2 className="pr-h2">App Android</h2>
      <div className="pr-galerie">{ECRANS_APP.map(k => <figure key={k}><img src={`/promo/ecrans/app/${k}.webp`} alt={NOMS_APP[k]} loading="lazy" /><figcaption>{NOMS_APP[k]}</figcaption></figure>)}</div>
      <h2 className="pr-h2">Ordinateur (cm.chapote.fr)</h2>
      <p className="pr-muted">Captures des vidéos YouTube horizontales : voir les fiches des vidéos YouTube.</p>
      {LABO.length === 0 && <p>—</p>}
    </>
  )
}
