// Pages de l'espace /promo (superadmin), rendues dans l'app shell de pages/Promo.tsx : vue d'ensemble, calendrier 3 mois,
// publications, fiche d'une publication, labo (pilotes), bilan ; ressources : recherches, règles et sources, écrans.
import { Children, isValidElement, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Options as MdOptions } from 'react-markdown'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { REGLES, SEMAINES, type Plateforme } from './plan'
import { BILAN, NOTES } from './bilan'
import { COMPARAISON } from './pilotes'
import { BarresEmpilees, BarresGroupees } from './charts'
import { ANTI_SLOP, DIFFUSIONS, ENTREES, LABO, PREVISIONNEL, STATUTS, dateDu, fmt, noteActuelle, noteV1, parId, scoreSlop, versionActuelle, type Entree, type Statut, type Version } from './suivi'
import { Badge, Contenu, DOCS, GRILLES, NOMS, ORDRE, Pastille, couleur } from './ui'
import { Icone } from './icones'

const Markdown = lazy(() => import('react-markdown'))
const gfm = () => import('remark-gfm').then(m => m.default)
const ARTICLES = import.meta.glob('./articles/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const slug = (k: string) => k.replace('./articles/', '').replace('.md', '')
export const TITRES: Record<string, string> = {
  '00-guide': 'Le guide : ce qui marche (synthèse des 10 recherches)', '01-hooks': 'Hooks : arrêter le pouce en 3 secondes', '02-motion-design': 'Motion design : une caméra qui voyage',
  '03-viraux-startups': 'Vidéos virales de startups', '04-voix-scripts': 'Voix et scripts', '05-sous-titres': 'Sous-titres', '06-son-musique': 'Son et musique',
  '07-algorithmes': 'Les algorithmes en 2025-2026', '08-youtube-long': 'YouTube horizontal', '09-outils-ia-video': 'Outils : Remotion, HyperFrames, IA',
  '10-fondateur-linkedin-x-fr': 'Fondateur, LinkedIn, X et marché français', '11-pilotes-v2': 'Carnet : comment on a fait les pilotes v2', '12-retours-utilisateurs': 'Conception : des retours utilisateurs aux PR (bugs et idées)',
  '20-benchmark-tableau-de-bord': 'Benchmark : 14 outils de calendrier éditorial', '21-anti-slop': 'Anti-slop : les marqueurs à éviter et la checklist', '22-concurrents': 'Veille concurrentielle : 11 outils, 5 angles libres', '23-references-ton': 'Références de ton : fondateurs français et bêtas',
}
const GROUPES_BLOG: [string, string, (n: number) => boolean][] = [['Synthèse', 'Le guide à lire en premier', n => n === 0], ['Recherches', '10 recherches, sources citées', n => n >= 1 && n <= 10],
  ['Carnets de production', 'Comment on a fait', n => n >= 11 && n <= 19], ['Benchmarks et veille', 'Recherches Chrome', n => n >= 20]]
const ECRANS_APP = ['planning', 'n2', 'n3', 'n4', 'stats', 'library', 'post-1', 'post-3', 'accounts', 'settings', 'videos', 'drafts', 'storage', 'welcome']
const NOMS_APP: Record<string, string> = { planning: 'Planning', n2: 'Nouvelle publication : bibliothèque', n3: 'Nouvelle publication : titre et légende', n4: 'Comptes et date',
  stats: 'Statistiques', library: 'Bibliothèque (Drive)', 'post-1': 'Publication : un échec à rattraper', 'post-3': 'Publication programmée', accounts: 'Comptes et groupes',
  settings: 'Réglages', videos: 'Vidéos publiées', drafts: 'Brouillons à valider', storage: 'Stockage Google Drive', welcome: 'Bienvenue : connecter ses comptes' }

const GR6 = ['hook', 'dynamisme', 'voix_script', 'sous_titres', 'son', 'plateforme']
const NOM_PLAT: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X', story: 'Stories' }
const ORDRE_VOL = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'story'] as const
const moy = (xs: (number | undefined)[]) => { const v = xs.filter((x): x is number => x !== undefined); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : undefined }
const arr = (x: number) => Math.round(x * 10) / 10
const signe = (d: number) => `${d > 0 ? '+' : ''}${arr(d)}`
/** Indice du jour de campagne aujourd'hui (0 = lundi 30 novembre 2026). */
const aujourdhui = () => Math.floor((Date.now() - dateDu(0).getTime()) / 86400000)
const lignesQualite = () => GR6.map(k => ({ nom: GRILLES[k] ?? k, valeurs: [(COMPARAISON.v1.grilles as Record<string, number>)[k], (COMPARAISON.v2.grilles as Record<string, number>)[k]] }))

/** En-tête de page compact (le fil d'Ariane est dans la barre du haut). */
function Titre({ t, sous, children, visible }: { t: string; sous?: ReactNode; children?: ReactNode; visible?: boolean }) {
  useEffect(() => { document.title = `${t} · Promo Chapote CM` }, [t])
  // Le nom de la section est déjà dans la barre du haut : le h1 n'est affiché que pour une fiche (sinon lu par les lecteurs d'écran seulement).
  return <div className={`pr-ph ${visible ? '' : 'pr-ph-discret'}`}><div><h1 className={visible ? '' : 'pr-sr'}>{t}</h1>{sous && <p>{sous}</p>}</div>{children && <div className="pr-ph-d">{children}</div>}</div>
}

function Panel({ titre, droite, children, className = '' }: { titre?: ReactNode; droite?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`pr-panel ${className}`}>{titre && <div className="pr-panel-h"><h2>{titre}</h2>{droite}</div>}{children}</section>
}

function Kpi({ label, valeur, sous, ton, barre, delta }: { label: string; valeur: ReactNode; sous?: ReactNode; ton?: string; barre?: number; delta?: number }) {
  return (
    <div className="pr-kpi">
      <span className="pr-kpi-l">{label}</span>
      <span className="pr-kpi-ligne"><b className={ton ? `pr-kpi-v ${ton}` : 'pr-kpi-v'}>{valeur}</b>
        {delta !== undefined && <span className={`pr-delta ${delta >= 0 ? 'plus' : 'moins'}`}>{delta >= 0 ? '▲' : '▼'} {signe(Math.abs(delta)).replace('+', '')}</span>}</span>
      {barre !== undefined && <span className="pr-jauge" aria-hidden><i style={{ width: `${Math.min(100, Math.max(0, barre * 100))}%` }} /></span>}
      {sous && <span className="pr-kpi-s">{sous}</span>}
    </div>
  )
}

function Cercle({ n, petit }: { n?: number; petit?: boolean }) {
  return <span className={`pr-cercle ${petit ? 'petit' : ''} ${n === undefined ? 'vide' : couleur(n)}`}>{n ?? '—'}</span>
}

function Reseaux({ ps }: { ps: Plateforme[] }) {
  return <span className="pr-nowrap">{ps.map(p => <span key={p} className={`pr-mini pr-mini-${p}`} title={NOMS[p]}>{NOMS[p].slice(0, 2)}</span>)}</span>
}

/** Liste compacte (widgets de la vue d'ensemble) : une ligne = une publication, clic = sa fiche. */
function ListeCompacte({ es, info }: { es: Entree[]; info: (e: Entree) => ReactNode }) {
  return (
    <ul className="pr-lc">
      {es.map(e => (
        <li key={e.id}><Link to={`/promo/p/${e.id}`}>
          <Cercle n={noteActuelle(e)} petit />
          <span className="pr-lc-t"><b>{e.titre}</b><small>{info(e)}</small></span>
          <Reseaux ps={e.plateformes} />
        </Link></li>
      ))}
    </ul>
  )
}

/** Tableau des publications : trié, une ligne = une publication, clic = sa fiche. */
function TablePubs({ es, tri: triInitial = 'jour', haute }: { es: Entree[]; tri?: 'jour' | 'act'; haute?: boolean }) {
  type Cle = 'jour' | 'titre' | 'statut' | 'v1' | 'act' | 'delta'
  const [tri, setTri] = useState<{ k: Cle; inv: boolean }>({ k: triInitial, inv: false })
  const val = (e: Entree, k: Cle): number | string => k === 'jour' ? e.jour * 100 + parseInt(e.heure) : k === 'titre' ? e.titre : k === 'statut' ? Object.keys(STATUTS).indexOf(e.statut)
    : k === 'v1' ? noteV1(e) ?? -1 : k === 'act' ? noteActuelle(e) ?? -1 : (noteActuelle(e) ?? 0) - (noteV1(e) ?? 0)
  const rows = [...es].sort((a, b) => { const x = val(a, tri.k), y = val(b, tri.k); const r = x < y ? -1 : x > y ? 1 : 0; return tri.inv ? -r : r })
  const th = (k: Cle, t: string, cls = '') => <th className={cls} aria-sort={tri.k === k ? (tri.inv ? 'descending' : 'ascending') : undefined}><button type="button" onClick={() => setTri(s => ({ k, inv: s.k === k ? !s.inv : false }))}>{t}{tri.k === k ? (tri.inv ? ' ↓' : ' ↑') : ''}</button></th>
  const nav = useNavigate()
  if (!rows.length) return <p className="pr-vide">Aucune publication ne correspond.</p>
  return (
    <div className={`pr-table-wrap ${haute ? 'pr-table-haute' : ''}`}>
      <table className="pr-table">
        <thead><tr>{th('jour', 'Date')}{th('titre', 'Publication')}<th>Réseaux</th>{th('statut', 'Statut')}<th className="num">Versions</th>{th('v1', 'v1', 'num')}{th('act', 'Actuelle', 'num')}{th('delta', 'Écart', 'num')}</tr></thead>
        <tbody>{rows.map(e => {
          const a = noteV1(e), b = noteActuelle(e), d = a !== undefined && b !== undefined && b !== a ? arr(b - a) : undefined
          return <tr key={e.id} onClick={() => nav(`/promo/p/${e.id}`)}>
            <td className="pr-nowrap">{e.date}<small className="pr-muted"> {e.heure}</small></td>
            <td className="pr-td-titre"><Link to={`/promo/p/${e.id}`} onClick={ev => ev.stopPropagation()}>{e.titre}</Link><small className="pr-muted">{e.format}</small></td>
            <td><Reseaux ps={e.plateformes} /></td>
            <td><Pastille s={e.statut} /></td>
            <td className="num pr-muted">{e.versions.filter(v => !v.aFaire).map(v => v.v).join(' · ')}</td>
            <td className="num">{a ?? '—'}</td>
            <td className="num">{b !== undefined ? <span className={`pr-score ${couleur(b)}`}>{b}</span> : '—'}</td>
            <td className={`num ${d === undefined ? '' : d >= 0 ? 'pr-plus' : 'pr-moins'}`}>{d === undefined ? '' : signe(d)}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
  )
}

/* ───────────── Vue d'ensemble ───────────── */

export function Tableau() {
  useEffect(() => { document.title = "Vue d'ensemble · Promo Chapote CM" }, [])
  const ecrites = ENTREES.length
  const prevu = ecrites + PREVISIONNEL.reduce((a, s) => a + Object.values(s.prevu).reduce((x, y) => x + (y || 0), 0), 0)
  const pretes = ENTREES.filter(e => (noteActuelle(e) ?? 0) >= 7).length
  const nb = (s: Statut) => ENTREES.filter(e => e.statut === s).length
  const moyV1 = moy(ENTREES.map(noteV1)), moyAct = moy(ENTREES.map(noteActuelle))
  const auj = aujourdhui()
  const avenir = [...ENTREES].filter(e => e.jour >= Math.max(0, auj)).sort((a, b) => a.jour - b.jour || a.heure.localeCompare(b.heure))
  const prochaine = avenir[0]
  const dans = prochaine ? prochaine.jour - auj : undefined
  const faibles = [...ENTREES].filter(e => noteActuelle(e) !== undefined && (noteActuelle(e) ?? 0) < 7)
    .sort((a, b) => (noteActuelle(a) ?? 0) - (noteActuelle(b) ?? 0) || a.jour - b.jour)
  const semaines = [...SEMAINES.map((s, si) => {
    const es = ENTREES.filter(e => e.semaine === si)
    return { nom: `S${si + 1}`, sous: s.dates, valeurs: ORDRE_VOL.map(p => p === 'story' ? es.filter(e => /story/i.test(e.format)).length : es.filter(e => !/story/i.test(e.format) && e.plateformes.includes(p as Plateforme)).length) }
  }), ...PREVISIONNEL.map(s => ({ nom: `S${s.n}`, sous: `prévu · ${s.titre}`, prevu: true, valeurs: ORDRE_VOL.map(p => s.prevu[p] ?? 0) }))]
  const statuts = (Object.keys(STATUTS) as Statut[]).map(s => ({ s, n: nb(s) }))
  return (
    <div className="pr-dash">
      <section className="pr-kpis" aria-label="Indicateurs">
        <Kpi label="Publications prévues" valeur={prevu} barre={ecrites / prevu} sous={`${ecrites} écrites · ${prevu - ecrites} à écrire`} />
        <Kpi label="Prêtes à publier" valeur={<>{pretes}<small>/{ecrites}</small></>} ton={pretes ? 'ok' : 'faible'} barre={pretes / ecrites} sous="note ≥ 7/10" />
        <Kpi label="À refaire" valeur={nb('a_produire') + nb('retours')} ton="faible" sous={`${nb('a_produire')} à produire · ${nb('retours')} en retours`} />
        <Kpi label="Note moyenne" valeur={<>{moyAct ?? '—'}<small>/10</small></>} delta={moyV1 !== undefined ? COMPARAISON.v2.moyenne - moyV1 : undefined} sous={<>v1 {moyV1} → pilotes v2 {COMPARAISON.v2.moyenne}</>} />
        <Kpi label="Prochaine publication" valeur={dans === undefined ? '—' : dans === 0 ? "Aujourd'hui" : `J-${dans}`}
          sous={prochaine && <Link to={`/promo/p/${prochaine.id}`}>{prochaine.date} · {prochaine.heure} · {prochaine.titre}</Link>} />
      </section>

      <div className="pr-dash-g">
        <Panel titre="Qualité par critère" droite={<Link to="/promo/labo" className="pr-panel-a">Labo →</Link>} className="pr-g-qualite">
          <BarresGroupees lignes={lignesQualite()} series={['v1 (32 vidéos)', 'v2.0 (3 pilotes)']} seuil={7} />
        </Panel>
        <Panel titre="Volume par semaine" droite={<Link to="/promo/calendrier" className="pr-panel-a">Calendrier →</Link>} className="pr-g-volume">
          <BarresEmpilees colonnes={semaines} series={ORDRE_VOL.map(p => NOM_PLAT[p])} />
        </Panel>

        <Panel titre="Pipeline" droite={<span className="pr-muted">{ecrites} publications · mois 1</span>} className="pr-g-pipeline">
          <div className="pr-pipe-barre" role="img" aria-label={statuts.map(x => `${STATUTS[x.s].nom} ${x.n}`).join(', ')}>
            {statuts.filter(x => x.n).map(x => <i key={x.s} style={{ flex: x.n, background: STATUTS[x.s].couleur }} title={`${STATUTS[x.s].nom} : ${x.n}`} />)}
          </div>
          <ul className="pr-pipe">
            {statuts.map(({ s, n }) => (
              <li key={s}><Link to={`/promo/publications?statut=${s}`}>
                <i style={{ background: STATUTS[s].couleur }} /><span>{STATUTS[s].nom}</span>
                <span className="pr-pipe-pc">{Math.round(n / ecrites * 100)} %</span><b>{n}</b>
              </Link></li>
            ))}
          </ul>
        </Panel>
        <Panel titre="À venir" droite={<Link to="/promo/calendrier" className="pr-panel-a">Tout voir →</Link>} className="pr-g-avenir">
          {avenir.length ? <ListeCompacte es={avenir.slice(0, 5)} info={e => <>{e.date} · {e.heure} · {STATUTS[e.statut].nom}</>} /> : <p className="pr-vide">Plus rien de prévu.</p>}
        </Panel>
        <Panel titre="À refaire en priorité" droite={<Link to="/promo/bilan" className="pr-panel-a">{faibles.length} sous 7/10 →</Link>} className="pr-g-faibles">
          <ListeCompacte es={faibles.slice(0, 5)} info={e => <>{e.format} · {e.date}</>} />
        </Panel>
      </div>
    </div>
  )
}

/* ───────────── Calendrier ───────────── */

export function Calendrier() {
  const total = SEMAINES.length + PREVISIONNEL.length
  const [sem, setSem] = useState(() => Math.min(total - 1, Math.max(0, Math.floor(aujourdhui() / 7))))
  const [plat, setPlat] = useState<Plateforme | null>(null)
  const volume = (i: number) => i < SEMAINES.length ? ENTREES.filter(e => e.semaine === i).length : Object.values(PREVISIONNEL[i - SEMAINES.length].prevu).reduce((a, b) => a + (b || 0), 0)
  const maxV = Math.max(...Array.from({ length: total }, (_, i) => volume(i)))
  const auj = aujourdhui()
  const ecrite = sem < SEMAINES.length
  const s = ecrite ? SEMAINES[sem] : undefined
  const p = ecrite ? undefined : PREVISIONNEL[sem - SEMAINES.length]
  return (
    <>
      <Titre t="Calendrier" sous="Semaines 1 à 4 écrites (cliquez une publication pour sa fiche) · semaines 5 à 12 en prévisionnel." />
      <div className="pr-toolbar">
        <div className="pr-seg" role="group" aria-label="Réseau">
          <button type="button" className={plat === null ? 'on' : ''} onClick={() => setPlat(null)}>Tous</button>
          {ORDRE.map(x => <button key={x} type="button" className={plat === x ? 'on' : ''} onClick={() => setPlat(x)}>{NOMS[x]}</button>)}
        </div>
        <div className="pr-legende-st">{(Object.keys(STATUTS) as Statut[]).map(k => <span key={k}><i style={{ background: STATUTS[k].couleur }} />{STATUTS[k].nom}</span>)}</div>
      </div>

      <div className="pr-semaines" role="tablist" aria-label="Semaines">
        {Array.from({ length: total }, (_, i) => (
          <button key={i} type="button" role="tab" aria-selected={sem === i} className={`${sem === i ? 'on' : ''} ${i >= SEMAINES.length ? 'prevu' : ''}`} onClick={() => setSem(i)}>
            <b>S{i + 1}</b><span className="pr-sem-barre"><i style={{ height: `${volume(i) / maxV * 100}%` }} /></span><small>{volume(i)}</small>
          </button>
        ))}
      </div>

      <Panel className="pr-cal-panel" titre={<>
        <button type="button" className="pr-icone-btn" disabled={sem === 0} onClick={() => setSem(sem - 1)} aria-label="Semaine précédente"><Icone n="gauche" /></button>
        <span>{s ? s.titre : `Semaine ${p!.n} · ${p!.titre}`}</span>
        <button type="button" className="pr-icone-btn" disabled={sem === total - 1} onClick={() => setSem(sem + 1)} aria-label="Semaine suivante"><Icone n="droite" /></button>
      </>} droite={<span className="pr-muted">{s ? s.dates : `${fmt(dateDu((p!.n - 1) * 7))} – ${fmt(dateDu((p!.n - 1) * 7 + 6))} · prévisionnel`}</span>}>
        {s ? (
          <div className="pr-cal">
            {s.jours.map((j, ji) => {
              const jour = sem * 7 + ji
              const es = ENTREES.filter(e => e.jour === jour && (!plat || e.plateformes.includes(plat))).sort((a, b) => a.heure.localeCompare(b.heure))
              return (
                <div key={j.date} className={`pr-cal-j ${jour === auj ? 'auj' : ''}`}>
                  <div className="pr-cal-jh"><b>{j.date}</b><small>{j.theme}</small></div>
                  {es.map(e => <Link key={e.id} to={`/promo/p/${e.id}`} className="pr-cal-e" style={{ borderLeftColor: STATUTS[e.statut].couleur }}>
                    <span className="pr-cal-h">{e.heure}<Reseaux ps={e.plateformes} /></span>
                    <span className="pr-cal-t">{e.titre}</span>
                    <em>{e.format}<b className={`pr-cal-badge ${noteActuelle(e) !== undefined ? couleur(noteActuelle(e)!) : ''}`}>{versionActuelle(e).v}{noteActuelle(e) !== undefined ? ` · ${noteActuelle(e)}` : ''}</b></em>
                  </Link>)}
                  {!es.length && <span className="pr-vide">—</span>}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="pr-prev">
            <div>
              <p className="pr-prev-but">{p!.but}</p>
              <h3>Idées de publications</h3>
              <ul className="pr-pb">{p!.idees.map(i => <li key={i}>{i}</li>)}</ul>
              <p className="pr-muted">À écrire : cette semaine n'a pas encore de publications détaillées.</p>
            </div>
            <div>
              <h3>Volume prévu</h3>
              <ul className="pr-pipe">{Object.entries(p!.prevu).map(([k, v]) => <li key={k}><span className="pr-pipe-li">
                <i className={k === 'story' ? 'pr-story-b' : `pr-${k}`} /><span>{NOM_PLAT[k]}</span><b>{v}</b></span></li>)}</ul>
            </div>
          </div>
        )}
      </Panel>
    </>
  )
}

/* ───────────── Publications ───────────── */

export function Publications() {
  const [q, setQ] = useSearchParams()
  const [sem, setSem] = useState<number | null>(null)
  const [plat, setPlat] = useState<Plateforme | null>(null)
  const [texte, setTexte] = useState('')
  const st = (q.get('statut') as Statut) || null
  const setSt = (v: Statut | null) => setQ(v ? { statut: v } : {}, { replace: true })
  const es = ENTREES.filter(e => (sem === null || e.semaine === sem) && (!plat || e.plateformes.includes(plat)) && (!st || e.statut === st)
    && (!texte || `${e.titre} ${e.format}`.toLowerCase().includes(texte.toLowerCase())))
  const filtre = sem !== null || plat || st || texte
  return (
    <>
      <Titre t="Publications" sous="Une ligne = une publication · cliquez pour sa fiche (versions, notes, retours, textes)." />
      <Panel>
        <div className="pr-toolbar pr-toolbar-in">
          <input className="pr-recherche" type="search" placeholder="Rechercher un titre, un format…" value={texte} onChange={e => setTexte(e.target.value)} aria-label="Rechercher" />
          <select value={sem ?? ''} onChange={e => setSem(e.target.value === '' ? null : +e.target.value)} aria-label="Semaine"><option value="">Toutes les semaines</option>{SEMAINES.map((w, i) => <option key={i} value={i}>S{i + 1} · {w.dates}</option>)}</select>
          <select value={plat ?? ''} onChange={e => setPlat((e.target.value || null) as Plateforme | null)} aria-label="Réseau"><option value="">Tous les réseaux</option>{ORDRE.map(p => <option key={p} value={p}>{NOMS[p]}</option>)}</select>
          <select value={st ?? ''} onChange={e => setSt((e.target.value || null) as Statut | null)} aria-label="Statut"><option value="">Tous les statuts</option>{(Object.keys(STATUTS) as Statut[]).map(s => <option key={s} value={s}>{STATUTS[s].nom}</option>)}</select>
          {filtre && <button type="button" className="pr-btn-txt" onClick={() => { setSem(null); setPlat(null); setSt(null); setTexte('') }}>Effacer</button>}
          <span className="pr-muted pr-toolbar-d">{es.length} sur {ENTREES.length}</span>
        </div>
        <TablePubs es={es} haute />
      </Panel>
    </>
  )
}

/* ───────────── Fiche ───────────── */

function CarteVersion({ v }: { v: Version }) {
  const sl = scoreSlop(v.slop)
  return (
    <article className={`pr-vcarte ${v.aFaire ? 'afaire' : ''}`}>
      <header><b>{v.v}</b><span className="pr-muted">{v.date}</span><Cercle n={v.note} />{sl && <span className="pr-muted">anti-slop {sl.ok}/{sl.total}</span>}</header>
      {v.video ? <video className={`pr-video pr-${v.video.format === 'horizontale' ? 'paysage' : 'portrait'}`} src={v.video.src} poster={v.video.poster} controls playsInline preload="none" />
        : <div className="pr-vide-video">{v.aFaire ? 'À produire' : 'Pas de vidéo pour cette version'}</div>}
      <p>{v.resume}</p>
      {v.problemes && v.problemes.length > 0 && <details><summary>Problèmes relevés ({v.problemes.length})</summary><ul className="pr-pb">{v.problemes.map(x => <li key={x}>{x}</li>)}</ul></details>}
    </article>
  )
}

export function Fiche() {
  const { id = '' } = useParams()
  const e = parId(id)
  const [ga, setGa] = useState<number | null>(null)
  const [dr, setDr] = useState<number | null>(null)
  useEffect(() => { setGa(null); setDr(null) }, [id])
  if (!e) return <><Titre visible t="Publication introuvable" /><Link to="/promo/publications" className="pr-lien">← Publications</Link></>
  const vs = e.versions
  const faites = vs.filter(v => !v.aFaire)
  const iG = ga ?? 0, iD = dr ?? Math.max(0, vs.length - 1)
  const gauche = vs[iG], droite = vs[iD]
  const grilles = [...new Set(vs.flatMap(v => Object.keys(v.detail ?? {})))]
  const act = versionActuelle(e)
  const avecSlop = vs.filter(v => v.slop)
  const i = ENTREES.indexOf(e), prec = ENTREES[i - 1], suiv = ENTREES[i + 1]
  return (
    <>
      <Titre visible t={e.titre} sous={<><Pastille s={e.statut} /> <span>{e.date} · {e.heure} · {e.format}</span></>}>
        {prec && <Link to={`/promo/p/${prec.id}`} className="pr-icone-btn" aria-label="Publication précédente" title={prec.titre}><Icone n="gauche" /></Link>}
        {suiv && <Link to={`/promo/p/${suiv.id}`} className="pr-icone-btn" aria-label="Publication suivante" title={suiv.titre}><Icone n="droite" /></Link>}
      </Titre>

      <div className="pr-fiche3">
        <div className="pr-fiche-main">
          <Panel titre="Comparaison des versions" droite={<span className="pr-muted">{gauche.v} ↔ {droite.v}</span>}>
            <div className="pr-cote">
              <CarteVersion v={gauche} />
              <div className="pr-cote-milieu">
                <table className="pr-table pr-versions">
                  <thead><tr><th>Critère</th><th className="num">{gauche.v}</th><th className="num">{droite.v}</th><th className="num">Écart</th></tr></thead>
                  <tbody>
                    {grilles.map(g => { const x = gauche.detail?.[g], y = droite.detail?.[g]; const d = x !== undefined && y !== undefined ? arr(y - x) : undefined
                      return <tr key={g}><td>{GRILLES[g] ?? g}</td><td className="num">{x ?? '—'}</td><td className="num">{y ?? (droite.aFaire ? 'cible 7' : '—')}</td><td className={`num ${d === undefined ? '' : d >= 0 ? 'pr-plus' : 'pr-moins'}`}>{d === undefined ? '' : signe(d)}</td></tr> })}
                    <tr className="pr-total"><td>Note globale</td><td className="num"><Cercle n={gauche.note} petit /></td><td className="num"><Cercle n={droite.note} petit /></td><td className="num">{gauche.note !== undefined && droite.note !== undefined ? signe(droite.note - gauche.note) : ''}</td></tr>
                  </tbody>
                </table>
              </div>
              <CarteVersion v={droite} />
            </div>
          </Panel>

          {avecSlop.length > 0 && (
            <Panel titre="Grille anti-slop" droite={<Link to="/promo/blog/21-anti-slop" className="pr-panel-a">25 points sourcés →</Link>}>
              <p className="pr-muted">Évaluation par Claude, à confirmer. ✓ respecté · ✗ non · ? non vérifié.</p>
              <div className="pr-table-wrap">
                <table className="pr-table pr-versions pr-slop">
                  <thead><tr><th>Point</th>{avecSlop.map(v => <th key={v.v} className="num">{v.v}<small className="pr-muted"> {scoreSlop(v.slop)!.ok}/{ANTI_SLOP.length}</small></th>)}</tr></thead>
                  <tbody>{ANTI_SLOP.map(it => <tr key={it.id}>
                    <td><small className="pr-muted">{it.groupe} · </small>{it.texte}</td>
                    {avecSlop.map(v => { const x = v.slop![it.id]; return <td key={v.v} className={`num ${x === true ? 'pr-plus' : x === false ? 'pr-moins' : 'pr-muted'}`}>{x === true ? '✓' : x === false ? '✗' : '?'}</td> })}</tr>)}</tbody>
                </table>
              </div>
            </Panel>
          )}

          {e.piece && <Panel titre="Contenu"><Contenu p={e.piece} /></Panel>}
        </div>

        <aside className="pr-fiche-side">
          <Panel titre="Détails">
            <dl className="pr-dl">
              <dt>Date prévue</dt><dd>{e.date} · {e.heure}</dd>
              <dt>Format</dt><dd>{e.format}</dd>
              <dt>Réseaux</dt><dd><span className="pr-badges">{e.plateformes.map(x => <Badge key={x} p={x} />)}</span></dd>
              <dt>Validation</dt><dd><Pastille s={e.statut} /></dd>
              <dt>Publication</dt><dd>{DIFFUSIONS[e.diffusion]}</dd>
              <dt>Version actuelle</dt><dd>{act.v}</dd>
              <dt>Note</dt><dd><Cercle n={noteActuelle(e)} petit /></dd>
            </dl>
          </Panel>
          <Panel titre="Historique" droite={<span className="pr-muted">{faites.length} produite{faites.length > 1 ? 's' : ''}</span>}>
            <ol className="pr-histo">
              {vs.map((v, k) => ({ v, k })).reverse().map(({ v, k }) => (
                <li key={v.v} className={v.aFaire ? 'afaire' : ''}>
                  <Cercle n={v.note} />
                  <div><b>{v.v}</b>{v === act && <span className="pr-actuelle">actuelle</span>}<small className="pr-muted"> {v.date}</small><p>{v.resume}</p>
                    <div className="pr-histo-b"><button type="button" onClick={() => setGa(k)} className={iG === k ? 'on' : ''}>À gauche</button><button type="button" onClick={() => setDr(k)} className={iD === k ? 'on' : ''}>À droite</button></div></div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel titre="Retours d'expérience" droite={<span className="pr-muted">{e.retours.length}</span>}>
            {e.retours.length ? <ol className="pr-retours">{e.retours.map((r, k) => <li key={k}><div><b>{r.auteur}</b><span className="pr-muted">{r.date}</span></div><p>{r.texte}</p></li>)}</ol>
              : <p className="pr-vide">Aucun retour. Après publication : vues, rétention, commentaires et ce qu'on en retient.</p>}
          </Panel>
        </aside>
      </div>
    </>
  )
}

/* ───────────── Labo ───────────── */

export function Labo() {
  const v21 = LABO[0]?.versions.find(v => v.slop && v.v === 'v2.1')
  const slop = scoreSlop(v21?.slop)
  return (
    <>
      <Titre t="Labo" sous="Chaque pilote v2 est la nouvelle version d'une publication du plan. Notes données par un évaluateur indépendant, mêmes grilles." />
      <section className="pr-kpis pr-kpis-4" aria-label="Indicateurs du labo">
        <Kpi label="Moyenne v1" valeur={<>{COMPARAISON.v1.moyenne}<small>/10</small></>} sous="32 vidéos du mois 1" ton={couleur(COMPARAISON.v1.moyenne) === 'ok' ? 'ok' : 'faible'} />
        <Kpi label="Moyenne pilotes v2.0" valeur={<>{COMPARAISON.v2.moyenne}<small>/10</small></>} delta={COMPARAISON.v2.moyenne - COMPARAISON.v1.moyenne} sous="3 pilotes notés" />
        <Kpi label="Pilotes au-dessus de 7" valeur={<>{LABO.filter(e => (noteActuelle(e) ?? 0) >= 7).length}<small>/{LABO.length}</small></>} sous="seuil de publication" />
        <Kpi label="Anti-slop (v2.1)" valeur={<>{slop?.ok ?? '—'}<small>/{ANTI_SLOP.length}</small></>} ton="faible" barre={slop ? slop.ok / ANTI_SLOP.length : 0}
          sous={<Link to="/promo/blog/21-anti-slop">voix de synthèse, personne absente : à trancher</Link>} />
      </section>
      <div className="pr-2col">
        <Panel titre="Qualité par critère" droite={<span className="pr-muted">v1 → v2.0</span>}>
          <BarresGroupees lignes={lignesQualite()} series={['v1 (32 vidéos)', 'v2.0 (3 pilotes)']} seuil={7} />
        </Panel>
        <Panel titre="Les 3 publications en test">
          <ListeCompacte es={LABO} info={e => { const a = noteV1(e), b = noteActuelle(e)
            return <>{e.versions.filter(v => !v.aFaire).map(v => v.v).join(' → ')} · v1 {a ?? '—'} → {b ?? '—'}{a !== undefined && b !== undefined && b !== a ? ` (${signe(b - a)})` : ''} · {STATUTS[e.statut].nom}</> }} />
          <p className="pr-muted pr-note-bas">v2.0 notée ; v2.1 (rythme ralenti) pas encore notée. Prochaine version : voix refaite sur le PC, écrans de l'app Android, grille anti-slop.</p>
        </Panel>
      </div>
    </>
  )
}

/* ───────────── Bilan ───────────── */

export function Bilan() {
  const notes = Object.keys(NOTES).map(id => parId(id)).filter((e): e is Entree => !!e)
  const sous7 = Object.values(NOTES).filter(n => n.note < 7).length
  return (
    <>
      <Titre t="Bilan" sous="Chaque élément du mois 1 noté sur 10 avec les grilles des recherches et des mesures sur les fichiers. Seuil de publication : 7/10." />
      <section className="pr-kpis pr-kpis-4" aria-label="Moyennes">
        <Kpi label="Vidéos v1" valeur={<>{BILAN.moyenneVideos}<small>/10</small></>} ton={couleur(BILAN.moyenneVideos) === 'ok' ? 'ok' : 'faible'} sous="32 vidéos" />
        <Kpi label="Stories et posts" valeur={<>{BILAN.moyenneAutres}<small>/10</small></>} ton={couleur(BILAN.moyenneAutres) === 'ok' ? 'ok' : 'faible'} />
        <Kpi label="Pilotes v2" valeur={<>{COMPARAISON.v2.moyenne}<small>/10</small></>} delta={COMPARAISON.v2.moyenne - BILAN.moyenneVideos} sous="par rapport aux vidéos v1" />
        <Kpi label="Sous le seuil" valeur={<>{sous7}<small>/{Object.keys(NOTES).length}</small></>} ton="faible" barre={sous7 / Object.keys(NOTES).length} sous="note < 7/10" />
      </section>
      <div className="pr-2col pr-2col-13">
        <Panel titre="Note moyenne par critère" droite={<a href={DOCS} target="_blank" rel="noreferrer" className="pr-panel-a">Recherches ↗</a>}>
          <ul className="pr-barres">{Object.entries(BILAN.grilles).map(([k, v]) => <li key={k}><span>{GRILLES[k] ?? k}</span><i><em className={couleur(v)} style={{ width: `${v * 10}%` }} /></i><b>{v}</b></li>)}</ul>
        </Panel>
        <Panel titre="Toutes les notes" droite={<span className="pr-muted">de la plus basse à la plus haute</span>}>
          <TablePubs es={notes} tri="act" haute />
        </Panel>
      </div>
    </>
  )
}

/* ───────────── Ressources ───────────── */

export function Blog() {
  const cles = Object.keys(ARTICLES).map(slug).sort()
  return (
    <>
      <Titre t="Recherches" sous="Le guide de synthèse, les 10 recherches (sources citées), les carnets de production et la veille." />
      <div className="pr-2col">
        {GROUPES_BLOG.map(([nom, sous, f]) => {
          const ks = cles.filter(k => f(parseInt(k)))
          return ks.length ? (
            <Panel key={nom} titre={nom} droite={<span className="pr-muted">{sous}</span>}>
              <ul className="pr-lc pr-lc-doc">{ks.map(k => <li key={k}><Link to={`/promo/blog/${k}`}><span className="pr-num">{k.slice(0, 2)}</span><span className="pr-lc-t"><b>{TITRES[k] ?? k}</b></span><Icone n="droite" taille={16} /></Link></li>)}</ul>
            </Panel>
          ) : null
        })}
      </div>
    </>
  )
}

const texteDe = (n: ReactNode): string => typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(texteDe).join('') : isValidElement(n) ? texteDe((n.props as { children?: ReactNode }).children) : ''
const ancre = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function Article() {
  const { slug: s = '' } = useParams()
  const [md, setMd] = useState<string | null>(null)
  const [plugins, setPlugins] = useState<MdOptions['remarkPlugins']>([])
  useEffect(() => { gfm().then(p => setPlugins([p])).catch(() => {}) }, [])
  useEffect(() => { setMd(null); const f = ARTICLES[`./articles/${s}.md`]; if (f) f().then(setMd); else setMd('') }, [s])
  useEffect(() => { document.title = `${TITRES[s] ?? s} · Promo Chapote CM` }, [s])
  const plan = useMemo(() => (md ?? '').split('\n').filter(l => /^## /.test(l)).map(l => l.replace(/^## /, '').replace(/[*`]/g, '').trim()), [md])
  const h2 = ({ children }: { children?: ReactNode }) => <h2 id={ancre(texteDe(Children.toArray(children)))}>{children}</h2>
  return (
    <div className="pr-lecture">
      <article className="pr-article">
        {md === null ? <p className="pr-muted">Chargement…</p> : md === '' ? <p>Article introuvable.</p>
          : <Suspense fallback={<p className="pr-muted">Chargement…</p>}><Markdown remarkPlugins={plugins} components={{ h2, a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{md}</Markdown></Suspense>}
      </article>
      {plan.length > 1 && (
        <nav className="pr-toc" aria-label="Sommaire">
          <p className="pr-nav-t">Sommaire</p>
          {plan.map(t => <a key={t} href={`#${ancre(t)}`} onClick={ev => { ev.preventDefault(); document.getElementById(ancre(t))?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{t}</a>)}
          <Link to="/promo/blog" className="pr-toc-retour">← Toutes les recherches</Link>
        </nav>
      )}
    </div>
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
      <Titre t="Règles et sources" sous="Les règles de la promo et toutes les sources citées par les recherches." />
      <div className="pr-2col pr-2col-12">
        <Panel titre="Règles de la promo" droite={<span className="pr-muted">{REGLES.length}</span>}>
          <ol className="pr-regles">{REGLES.map(r => <li key={r}>{r}</li>)}</ol>
          <p className="pr-muted pr-note-bas">Les 12 règles d'une vidéo verticale : <Link to="/promo/blog/00-guide">le guide</Link>.</p>
        </Panel>
        <Panel titre={<>Sources {sources && <small className="pr-muted">({f.length}{q ? ` sur ${sources.length}` : ''})</small>}</>}>
          <div className="pr-toolbar pr-toolbar-in">
            <input className="pr-recherche" type="search" placeholder="Filtrer (TikTok, hook, LUFS…)" value={q} onChange={e => setQ(e.target.value)} aria-label="Filtrer les sources" />
          </div>
          {sources === null ? <p className="pr-muted">Chargement…</p> : (
            <div className="pr-table-wrap pr-table-haute">
              <table className="pr-table pr-table-statique">
                <thead><tr><th>Source</th><th className="num">Article</th></tr></thead>
                <tbody>{f.map(s => <tr key={s.url}>
                  <td className="pr-td-titre"><a href={s.url} target="_blank" rel="noreferrer">{s.titre}</a><small className="pr-muted">{new URL(s.url).hostname.replace('www.', '')}</small></td>
                  <td className="num"><Link to={`/promo/blog/${s.article}`} className="pr-num" title={TITRES[s.article]}>{s.article.slice(0, 2)}</Link></td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}

export function Ecrans() {
  return (
    <>
      <Titre t="Écrans réels" sous="Téléphone : l'app Android (c'est elle qui prime), version web de démonstration, profil fictif (Camille, @example.com). Ordinateur : cm.chapote.fr." />
      <Panel titre="App Android" droite={<span className="pr-muted">{ECRANS_APP.length} écrans</span>}>
        <div className="pr-galerie">{ECRANS_APP.map(k => <figure key={k}><a href={`/promo/ecrans/app/${k}.webp`} target="_blank" rel="noreferrer"><img src={`/promo/ecrans/app/${k}.webp`} alt={NOMS_APP[k]} loading="lazy" /></a><figcaption>{NOMS_APP[k]}</figcaption></figure>)}</div>
      </Panel>
      <Panel titre="Ordinateur (cm.chapote.fr)">
        <p className="pr-muted">Captures des vidéos YouTube horizontales : voir les fiches des vidéos YouTube.</p>
      </Panel>
    </>
  )
}
