// Pages du tableau de bord /promo (superadmin) : tableau de bord, calendrier 3 mois, publications, fiche d'une publication,
// labo (pilotes), blog (guide et recherches), règles et sources, bilan, écrans.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { COMPTES, REGLES, SEMAINES, type Plateforme } from './plan'
import { BILAN, NOTES } from './bilan'
import { COMPARAISON } from './pilotes'
import { BarresEmpilees, BarresGroupees } from './charts'
import { ACTIONS, ANTI_SLOP, DIFFUSIONS, ENTREES, LABO, PREVISIONNEL, STATUTS, dateDu, fmt, noteActuelle, noteV1, parId, scoreSlop, versionActuelle, type Entree, type Statut, type Version } from './suivi'
import { Badge, Contenu, DOCS, GRILLES, Ligne, NOMS, ORDRE, Pastille, couleur } from './ui'

const Markdown = lazy(() => import('react-markdown'))
const ARTICLES = import.meta.glob('./articles/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const slug = (k: string) => k.replace('./articles/', '').replace('.md', '')
const TITRES: Record<string, string> = {
  '00-guide': 'Le guide : ce qui marche (synthèse des 10 recherches)', '01-hooks': 'Hooks : arrêter le pouce en 3 secondes', '02-motion-design': 'Motion design : une caméra qui voyage',
  '03-viraux-startups': 'Vidéos virales de startups', '04-voix-scripts': 'Voix et scripts', '05-sous-titres': 'Sous-titres', '06-son-musique': 'Son et musique',
  '07-algorithmes': 'Les algorithmes en 2025-2026', '08-youtube-long': 'YouTube horizontal', '09-outils-ia-video': 'Outils : Remotion, HyperFrames, IA',
  '10-fondateur-linkedin-x-fr': 'Fondateur, LinkedIn, X et marché français', '11-pilotes-v2': 'Carnet : comment on a fait les pilotes v2', '12-retours-utilisateurs': 'Conception : des retours utilisateurs aux PR (bugs et idées)',
  '20-benchmark-tableau-de-bord': 'Benchmark : 14 outils de calendrier éditorial', '21-anti-slop': 'Anti-slop : les marqueurs à éviter et la checklist', '22-concurrents': 'Veille concurrentielle : 11 outils, 5 angles libres', '23-references-ton': 'Références de ton : fondateurs français et bêtas',
}
const ECRANS_APP = ['planning', 'n2', 'n3', 'n4', 'stats', 'library', 'post-1', 'post-3', 'accounts', 'settings', 'videos', 'drafts', 'storage', 'welcome']
const NOMS_APP: Record<string, string> = { planning: 'Planning', n2: 'Nouvelle publication : bibliothèque', n3: 'Nouvelle publication : titre et légende', n4: 'Comptes et date',
  stats: 'Statistiques', library: 'Bibliothèque (Drive)', 'post-1': 'Publication : un échec à rattraper', 'post-3': 'Publication programmée', accounts: 'Comptes et groupes',
  settings: 'Réglages', videos: 'Vidéos publiées', drafts: 'Brouillons à valider', storage: 'Stockage Google Drive', welcome: 'Bienvenue : connecter ses comptes' }

function Titre({ t, sous }: { t: string; sous?: string }) {
  useEffect(() => { document.title = `${t} · Promo Chapote CM` }, [t])
  return <div className="pr-hero"><h1>{t}</h1>{sous && <p>{sous}</p>}</div>
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
                    <span>{e.heure}</span> {e.titre}<em>{e.plateformes.map(p => NOMS[p][0]).join(' ')}<b className={`pr-cal-badge ${noteActuelle(e) !== undefined ? couleur(noteActuelle(e)!) : ''}`}>{versionActuelle(e).v}{noteActuelle(e) !== undefined ? ` · ${noteActuelle(e)}` : ''}</b></em></Link>)}
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

const GR6 = ['hook', 'dynamisme', 'voix_script', 'sous_titres', 'son', 'plateforme']
const NOM_PLAT: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X', story: 'Stories' }
const ORDRE_VOL = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'story'] as const
const moy = (xs: (number | undefined)[]) => { const v = xs.filter((x): x is number => x !== undefined); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : undefined }

function Kpi({ label, valeur, sous, ton }: { label: string; valeur: React.ReactNode; sous?: React.ReactNode; ton?: string }) {
  return <div className="pr-kpi"><span className="pr-kpi-l">{label}</span><b className={ton ? `pr-kpi-v ${ton}` : 'pr-kpi-v'}>{valeur}</b>{sous && <span className="pr-kpi-s">{sous}</span>}</div>
}

/** Tableau des publications : trié, une ligne = une publication, clic = sa fiche. */
function TablePubs({ es }: { es: Entree[] }) {
  type Cle = 'jour' | 'titre' | 'statut' | 'v1' | 'act' | 'delta'
  const [tri, setTri] = useState<{ k: Cle; inv: boolean }>({ k: 'jour', inv: false })
  const val = (e: Entree, k: Cle): number | string => k === 'jour' ? e.jour * 100 + parseInt(e.heure) : k === 'titre' ? e.titre : k === 'statut' ? Object.keys(STATUTS).indexOf(e.statut)
    : k === 'v1' ? noteV1(e) ?? -1 : k === 'act' ? noteActuelle(e) ?? -1 : (noteActuelle(e) ?? 0) - (noteV1(e) ?? 0)
  const rows = [...es].sort((a, b) => { const x = val(a, tri.k), y = val(b, tri.k); const r = x < y ? -1 : x > y ? 1 : 0; return tri.inv ? -r : r })
  const th = (k: Cle, t: string, cls = '') => <th className={cls}><button type="button" onClick={() => setTri(s => ({ k, inv: s.k === k ? !s.inv : false }))}>{t}{tri.k === k ? (tri.inv ? ' ↓' : ' ↑') : ''}</button></th>
  const nav = useNavigate()
  return (
    <div className="pr-table-wrap">
      <table className="pr-table">
        <thead><tr>{th('jour', 'Date')}{th('titre', 'Publication')}<th>Réseaux</th>{th('statut', 'Statut')}<th className="num">Versions</th>{th('v1', 'v1', 'num')}{th('act', 'Actuelle', 'num')}{th('delta', 'Écart', 'num')}</tr></thead>
        <tbody>{rows.map(e => {
          const a = noteV1(e), b = noteActuelle(e), d = a !== undefined && b !== undefined && b !== a ? Math.round((b - a) * 10) / 10 : undefined
          return <tr key={e.id} onClick={() => nav(`/promo/p/${e.id}`)}>
            <td className="pr-nowrap">{e.date}<small> {e.heure}</small></td>
            <td><Link to={`/promo/p/${e.id}`} onClick={ev => ev.stopPropagation()}>{e.titre}</Link><small className="pr-muted"> · {e.format}</small></td>
            <td className="pr-nowrap">{e.plateformes.map(p => <span key={p} className="pr-mini">{NOMS[p].slice(0, 2)}</span>)}</td>
            <td><Pastille s={e.statut} /></td>
            <td className="num">{e.versions.filter(v => !v.aFaire).map(v => v.v).join(' · ')}</td>
            <td className="num">{a ?? '—'}</td>
            <td className="num">{b !== undefined ? <span className={`pr-score ${couleur(b)}`}>{b}</span> : '—'}</td>
            <td className={`num ${d === undefined ? '' : d >= 0 ? 'pr-plus' : 'pr-moins'}`}>{d === undefined ? '' : `${d > 0 ? '+' : ''}${d}`}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
  )
}

export function Tableau() {
  const prevu = ENTREES.length + PREVISIONNEL.reduce((a, s) => a + Object.values(s.prevu).reduce((x, y) => x + (y || 0), 0), 0)
  const notes = ENTREES.map(noteActuelle)
  const pretes = ENTREES.filter(e => (noteActuelle(e) ?? 0) >= 7).length
  const aRefaire = ENTREES.filter(e => e.statut === 'a_produire' || e.statut === 'retours').length
  const moyV1 = moy(ENTREES.map(noteV1)), moyAct = moy(notes)
  const prochaine = ENTREES[0]
  const parStatut = (Object.keys(STATUTS) as Statut[]).map(s => ({ s, es: ENTREES.filter(e => e.statut === s) }))
  // Qualité par critère : moyenne v1 des vidéos qui ont un pilote, et moyenne des pilotes v2.0.
  const lignesQ = GR6.map(k => ({ nom: GRILLES[k] ?? k, valeurs: [(COMPARAISON.v1.grilles as Record<string, number>)[k], (COMPARAISON.v2.grilles as Record<string, number>)[k]] }))
  const semaines = [...SEMAINES.map((s, si) => {
    const es = ENTREES.filter(e => e.semaine === si)
    return { nom: `S${si + 1}`, sous: s.dates, valeurs: ORDRE_VOL.map(p => p === 'story' ? es.filter(e => /story/i.test(e.format)).length : es.filter(e => !/story/i.test(e.format) && e.plateformes.includes(p as Plateforme)).length) }
  }), ...PREVISIONNEL.map(s => ({ nom: `S${s.n}`, sous: `prévu · ${s.titre}`, valeurs: ORDRE_VOL.map(p => s.prevu[p] ?? 0) }))]
  return (
    <>
      <div className="pr-dash-h">
        <div><h1>Promo · vue d'ensemble</h1><p className="pr-muted">30 nov. 2026 → 21 févr. 2027 · 12 semaines · Instagram, TikTok, YouTube, LinkedIn, X</p></div>
        <Link to="/promo/publications" className="pr-btn">Toutes les publications</Link>
      </div>
      <section className="pr-kpis">
        <Kpi label="Prévues sur 3 mois" valeur={prevu} sous={`${ENTREES.length} écrites (mois 1)`} />
        <Kpi label="Prêtes à publier (≥ 7/10)" valeur={pretes} sous={`sur ${ENTREES.length}`} ton={pretes ? 'ok' : 'faible'} />
        <Kpi label="À refaire" valeur={aRefaire} sous="v1 sous le seuil" ton="faible" />
        <Kpi label="Note moyenne" valeur={<>{moyAct ?? '—'}<small>/10</small></>} sous={<>v1 : {moyV1}/10 · pilotes v2 : {COMPARAISON.v2.moyenne}/10</>} />
        <Kpi label="Anti-slop (pilotes v2.1)" valeur={<>{scoreSlop(LABO[0]?.versions.find(v => v.slop && v.v === 'v2.1')?.slop)?.ok ?? '—'}<small>/25</small></>} sous={<Link to="/promo/blog/21-anti-slop">voix de synthèse, personne absente : à trancher</Link>} ton="faible" />
        <Kpi label="Prochaine publication" valeur={<small>{prochaine.date} · {prochaine.heure}</small>} sous={<Link to={`/promo/p/${prochaine.id}`}>{prochaine.titre}</Link>} />
      </section>

      <section className="pr-panel">
        <div className="pr-panel-h"><h2>Pipeline</h2><span className="pr-muted">{ENTREES.length} publications du mois 1 par statut</span></div>
        <div className="pr-board">
          {parStatut.map(({ s, es }) => (
            <div key={s} className="pr-col">
              <div className="pr-col-h"><i style={{ background: STATUTS[s].couleur }} />{STATUTS[s].nom}<b>{es.length}</b></div>
              {es.slice(0, 5).map(e => <Link key={e.id} to={`/promo/p/${e.id}`} className="pr-tuile">
                <span>{e.titre}</span><small>{e.date} · {e.plateformes.map(p => NOMS[p].slice(0, 2)).join(' ')}{noteActuelle(e) !== undefined ? ` · ${noteActuelle(e)}/10` : ''}</small></Link>)}
              {es.length > 5 && <Link to={`/promo/publications?statut=${s}`} className="pr-col-plus">+ {es.length - 5} autres</Link>}
              {!es.length && <span className="pr-col-vide">—</span>}
            </div>
          ))}
        </div>
      </section>

      <div className="pr-2col">
        <section className="pr-panel">
          <div className="pr-panel-h"><h2>Qualité par critère</h2><Link to="/promo/labo" className="pr-muted">v1 → v2</Link></div>
          <BarresGroupees lignes={lignesQ} series={['v1 (32 vidéos)', 'v2.0 (3 pilotes)']} seuil={7} />
        </section>
        <section className="pr-panel">
          <div className="pr-panel-h"><h2>Volume par semaine</h2><Link to="/promo/calendrier" className="pr-muted">Calendrier</Link></div>
          <BarresEmpilees colonnes={semaines} series={ORDRE_VOL.map(p => NOM_PLAT[p])} />
        </section>
      </div>

      <section className="pr-panel">
        <div className="pr-panel-h"><h2>Les plus faibles</h2><span className="pr-muted">à refaire en priorité</span></div>
        <TablePubs es={[...ENTREES].filter(e => noteActuelle(e) !== undefined).sort((a, b) => (noteActuelle(a) ?? 0) - (noteActuelle(b) ?? 0)).slice(0, 6)} />
      </section>

      <div className="pr-2col">
        <section className="pr-panel">
          <div className="pr-panel-h"><h2>Prochaines actions</h2><span className="pr-muted">{ACTIONS.filter(a => a.fait).length}/{ACTIONS.length} faites</span></div>
          <ul className="pr-actions">{ACTIONS.map(a => <li key={a.texte} className={a.fait ? 'fait' : ''}><span aria-hidden>{a.fait ? '✓' : '○'}</span>{a.texte}</li>)}</ul>
        </section>
        <section className="pr-panel">
          <div className="pr-panel-h"><h2>Comptes</h2></div>
          <ul className="pr-comptes">{ORDRE.map(p => <li key={p}><Badge p={p} /><a href={COMPTES[p].url} target="_blank" rel="noreferrer">{COMPTES[p].nom}</a></li>)}</ul>
        </section>
      </div>
    </>
  )
}

export function Publications() {
  const [q] = useSearchParams()
  const [sem, setSem] = useState<number | null>(null)
  const [plat, setPlat] = useState<Plateforme | null>(null)
  const [st, setSt] = useState<Statut | null>((q.get('statut') as Statut) || null)
  const es = ENTREES.filter(e => (sem === null || e.semaine === sem) && (!plat || e.plateformes.includes(plat)) && (!st || e.statut === st))
  return (
    <>
      <Titre t="Publications" sous={`${es.length} sur ${ENTREES.length} · cliquez une ligne pour sa fiche (versions, notes, retours, textes).`} />
      <div className="pr-filtres">
        <select value={sem ?? ''} onChange={e => setSem(e.target.value === '' ? null : +e.target.value)} aria-label="Semaine"><option value="">Toutes les semaines</option>{SEMAINES.map((w, i) => <option key={i} value={i}>{w.titre} · {w.dates}</option>)}</select>
        <select value={plat ?? ''} onChange={e => setPlat((e.target.value || null) as Plateforme | null)} aria-label="Réseau"><option value="">Tous les réseaux</option>{ORDRE.map(p => <option key={p} value={p}>{NOMS[p]}</option>)}</select>
        <select value={st ?? ''} onChange={e => setSt((e.target.value || null) as Statut | null)} aria-label="Statut"><option value="">Tous les statuts</option>{(Object.keys(STATUTS) as Statut[]).map(s => <option key={s} value={s}>{STATUTS[s].nom}</option>)}</select>
      </div>
      <section className="pr-panel"><TablePubs es={es} /></section>
    </>
  )
}

function Cercle({ n }: { n?: number }) {
  return <span className={`pr-cercle ${n === undefined ? 'vide' : couleur(n)}`}>{n ?? '—'}</span>
}

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
  if (!e) return <><Titre t="Publication introuvable" /><Link to="/promo/publications">← Publications</Link></>
  const vs = e.versions
  const faites = vs.filter(v => !v.aFaire)
  const iG = ga ?? 0, iD = dr ?? Math.max(0, vs.length - 1)
  const gauche = vs[iG], droite = vs[iD]
  const grilles = [...new Set(vs.flatMap(v => Object.keys(v.detail ?? {})))]
  const act = versionActuelle(e)
  const avecSlop = vs.filter(v => v.slop)
  return (
    <>
      <p><Link to="/promo/publications" className="pr-lien">← Publications</Link></p>
      <div className="pr-dash-h">
        <div><h1>{e.titre}</h1>
          <div className="pr-faits">
            <span><small>Date prévue</small>{e.date} · {e.heure}</span><span><small>Format</small>{e.format}</span>
            <span><small>Réseaux</small><span className="pr-badges">{e.plateformes.map(x => <Badge key={x} p={x} />)}</span></span>
            <span><small>Validation</small><Pastille s={e.statut} /></span>
            <span><small>Publication</small>{DIFFUSIONS[e.diffusion]}</span>
            <span><small>Version actuelle</small>{act.v}</span>
            <span><small>Note</small><Cercle n={noteActuelle(e)} /></span>
          </div></div>
      </div>

      <div className="pr-fiche2">
        <section className="pr-panel">
          <div className="pr-panel-h"><h2>Historique des versions</h2><span className="pr-muted">{faites.length} produite{faites.length > 1 ? 's' : ''}</span></div>
          <ol className="pr-histo">
            {[...vs].map((v, i) => ({ v, i })).reverse().map(({ v, i }) => (
              <li key={v.v} className={v.aFaire ? 'afaire' : ''}>
                <Cercle n={v.note} />
                <div><b>{v.v}</b>{v === act && <span className="pr-actuelle">actuelle</span>}<small className="pr-muted"> {v.date}</small><p>{v.resume}</p>
                  <div className="pr-histo-b"><button type="button" onClick={() => setGa(i)} className={iG === i ? 'on' : ''}>Comparer à gauche</button><button type="button" onClick={() => setDr(i)} className={iD === i ? 'on' : ''}>à droite</button></div></div>
              </li>
            ))}
          </ol>
        </section>
        <section className="pr-panel">
          <div className="pr-panel-h"><h2>Retours d'expérience</h2><span className="pr-muted">{e.retours.length}</span></div>
          {e.retours.length ? <ol className="pr-retours">{e.retours.map((r, i) => <li key={i}><div><b>{r.auteur}</b><span className="pr-muted">{r.date}</span></div><p>{r.texte}</p></li>)}</ol>
            : <p className="pr-muted">Aucun retour. Après publication : vues, rétention, commentaires et ce qu'on en retient.</p>}
        </section>
      </div>

      <section className="pr-panel">
        <div className="pr-panel-h"><h2>Comparaison</h2><span className="pr-muted">{gauche.v} ↔ {droite.v}</span></div>
        <div className="pr-cote">
          <CarteVersion v={gauche} />
          <div className="pr-cote-milieu">
            <table className="pr-table pr-versions">
              <thead><tr><th>Critère</th><th className="num">{gauche.v}</th><th className="num">{droite.v}</th><th className="num">Écart</th></tr></thead>
              <tbody>
                {grilles.map(g => { const x = gauche.detail?.[g], y = droite.detail?.[g]; const d = x !== undefined && y !== undefined ? Math.round((y - x) * 10) / 10 : undefined
                  return <tr key={g}><td>{GRILLES[g] ?? g}</td><td className="num">{x ?? '—'}</td><td className="num">{y ?? (droite.aFaire ? 'cible 7' : '—')}</td><td className={`num ${d === undefined ? '' : d >= 0 ? 'pr-plus' : 'pr-moins'}`}>{d === undefined ? '' : `${d > 0 ? '+' : ''}${d}`}</td></tr> })}
                <tr className="pr-total"><td>Note globale</td><td className="num"><Cercle n={gauche.note} /></td><td className="num"><Cercle n={droite.note} /></td><td className="num">{gauche.note !== undefined && droite.note !== undefined ? `${droite.note - gauche.note > 0 ? '+' : ''}${Math.round((droite.note - gauche.note) * 10) / 10}` : ''}</td></tr>
              </tbody>
            </table>
          </div>
          <CarteVersion v={droite} />
        </div>
      </section>

      {avecSlop.length > 0 && (
        <section className="pr-panel">
          <div className="pr-panel-h"><h2>Grille anti-slop</h2><Link to="/promo/blog/21-anti-slop" className="pr-muted">25 points sourcés</Link></div>
          <p className="pr-muted">Évaluation par Claude, à confirmer. ✓ respecté · ✗ non · ? non vérifié.</p>
          <div className="pr-table-wrap">
            <table className="pr-table pr-versions pr-slop">
              <thead><tr><th>Point</th>{avecSlop.map(v => <th key={v.v} className="num">{v.v}<small className="pr-muted"> {scoreSlop(v.slop)!.ok}/{ANTI_SLOP.length}</small></th>)}</tr></thead>
              <tbody>{ANTI_SLOP.map((it, i) => <tr key={it.id}>{(i === 0 || ANTI_SLOP[i - 1].groupe !== it.groupe) ? null : null}
                <td><small className="pr-muted">{it.groupe} · </small>{it.texte}</td>
                {avecSlop.map(v => { const x = v.slop![it.id]; return <td key={v.v} className={`num ${x === true ? 'pr-plus' : x === false ? 'pr-moins' : 'pr-muted'}`}>{x === true ? '✓' : x === false ? '✗' : '?'}</td> })}</tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      <section className="pr-panel">
        <div className="pr-panel-h"><h2>Contenu</h2></div>
        {e.piece && <Contenu p={e.piece} />}
      </section>
    </>
  )
}

export function Labo() {
  return (
    <>
      <Titre t="Labo · v1 → v2" sous="Chaque pilote v2 est la nouvelle version d'une publication du plan. Notes données par un évaluateur indépendant, mêmes grilles." />
      <div className="pr-2col">
        <section className="pr-panel">
          <div className="pr-panel-h"><h2>Qualité par critère</h2></div>
          <BarresGroupees lignes={GR6.map(k => ({ nom: GRILLES[k] ?? k, valeurs: [(COMPARAISON.v1.grilles as Record<string, number>)[k], (COMPARAISON.v2.grilles as Record<string, number>)[k]] }))} series={['v1 (32 vidéos)', 'v2.0 (3 pilotes)']} seuil={7} />
        </section>
        <section className="pr-panel">
          <div className="pr-panel-h"><h2>Les 3 publications en test</h2></div>
          <TablePubs es={LABO} />
          <p className="pr-muted">v2.0 notée ; v2.1 (rythme ralenti) pas encore notée. Prochaine version : voix refaite sur le PC, écrans de l'app Android, grille anti-slop.</p>
        </section>
      </div>
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
