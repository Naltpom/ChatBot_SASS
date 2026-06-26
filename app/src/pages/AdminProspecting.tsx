// Vue ADMIN — Prospection commerciale : recherche d'entreprises (API publique
// SIRENE), import en base, puis suivi des prospects (enrichissement + email IA).
import { useEffect, useState } from 'react'
import { Building2, ChevronDown, ChevronRight, Globe, Save, Search, Send, Sparkles, Target, ThumbsDown, ThumbsUp, UserPlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Btn, Card, Chip, Field, InfoBox, SectionTitle, Seg, Stat } from '../ui'
import { errMsg } from '../utils/errors'

// Profil cible persistant (1 ligne par superadmin) — sert à préremplir la
// découverte et à injecter les notes de l'opérateur dans le scoring IA. Tous
// les champs sont optionnels côté API (ProfileOut).
interface ProspectingProfile {
  web_query: string | null
  sector: string | null
  departement: string | null
  code_postal: string | null
  notes: string | null
}

export interface ProspectCandidate {
  siren: string | null
  siret: string | null
  company_name: string
  naf_code: string | null
  sector_label: string | null
  city: string | null
  postal_code: string | null
  contact_name: string | null
}

export interface SireneInfo {
  forme_juridique?: string | null
  date_creation?: string | null
  tranche_effectif?: string | null
  etat_administratif?: string | null
  naf_libelle?: string | null
  adresse?: string | null
  dirigeants?: { nom: string; qualite?: string | null }[]
  finances?: Record<string, { ca?: number; resultat_net?: number }>
  complements?: Record<string, boolean | null>
}
export interface WebInfo {
  emails?: { value: string; page: string }[]
  phones?: string[]
  socials?: Record<string, string>
  description?: string | null
  logo?: string | null
  cms?: string | null
  tech?: string[]
  opening_hours?: unknown
  pages_crawled?: string[]
  note?: string
}
// Détail de scoring IA (vit dans enrichment.scoring côté API). Proba de besoin +
// formule/modules conseillés — alimente le bloc « Analyse IA » du détail prospect.
export interface ProspectScoring {
  reason: string
  recommended_plan: string | null
  recommended_byok: boolean
  recommended_modules: string[]
  suggested_integrations: string[]
}
export interface Enrichment { sirene?: SireneInfo; web?: WebInfo; scoring?: ProspectScoring }

export interface Prospect extends ProspectCandidate {
  id: number
  website: string | null
  contact_email: string | null
  site_summary: string | null
  has_existing_chatbot: boolean | null
  enrichment: Enrichment | null
  email_subject: string | null
  email_body: string | null
  status: string
  created_at: string
  updated_at: string
  sent_at: string | null
  fit_score?: number | null
  decision?: 'accepted' | 'rejected' | null
  decision_reason?: string | null
  decision_at?: string | null
}

const STATUS_LABEL: Record<string, string> = {
  found: 'Trouvé', enriched: 'Analysé', drafted: 'Brouillon', sent: 'Envoyé', rejected: 'Écarté',
}
const STATUS_TONE: Record<string, 'mut' | 'acc' | 'go' | 'danger'> = {
  found: 'mut', enriched: 'acc', drafted: 'acc', sent: 'go', rejected: 'danger',
}

export function prospectStatusChip(status: string) {
  return <Chip tone={STATUS_TONE[status] || 'mut'}>{STATUS_LABEL[status] || status}</Chip>
}

// Chip de score IA (probabilité de besoin, 0..100) : vert ≥70, accent ≥40, sinon
// neutre. Tiret discret tant que le prospect n'a pas été scoré (fit_score null).
export function scoreChip(fit: number | null | undefined) {
  if (fit == null) return <span style={{ color: 'var(--faint)' }}>—</span>
  return <Chip tone={fit >= 70 ? 'go' : fit >= 40 ? 'acc' : 'mut'}>{fit}</Chip>
}

export default function AdminProspecting() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [naf, setNaf] = useState('')
  const [departement, setDepartement] = useState('')
  const [codePostal, setCodePostal] = useState('')

  const [results, setResults] = useState<ProspectCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // Découverte automatique (SIRENE + web + scoring IA) — déclenchée à la demande.
  // Mode 'web' (défaut) = recherche en langage naturel (Brave) ; 'sirene' = annuaire.
  const [discoverMode, setDiscoverMode] = useState<'web' | 'sirene'>('web')
  const [dQuery, setDQuery] = useState('')
  const [dSector, setDSector] = useState('')
  const [dDept, setDDept] = useState('')
  const [dCp, setDCp] = useState('')
  const [dCount, setDCount] = useState(5)
  const [discovering, setDiscovering] = useState(false)
  const [discoveringWeb, setDiscoveringWeb] = useState(false)
  const [discoveringAuto, setDiscoveringAuto] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [deciding, setDeciding] = useState<number | null>(null)

  // Profil cible persistant (carte repliable) : critères + notes pour l'IA.
  const [profileOpen, setProfileOpen] = useState(false)
  const [pWebQuery, setPWebQuery] = useState('')
  const [pSector, setPSector] = useState('')
  const [pDept, setPDept] = useState('')
  const [pCp, setPCp] = useState('')
  const [pNotes, setPNotes] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  function loadProspects() {
    api<Prospect[]>('/api/admin/prospecting/prospects').then(setProspects)
      .catch((err: unknown) => setError(`Chargement des prospects impossible : ${errMsg(err)}`))
  }
  useEffect(() => { loadProspects() }, [])

  // Au montage : charge le profil cible et préremplit les champs de découverte
  // (init uniquement — pas d'écrasement d'une saisie en cours). Profil absent =
  // repli silencieux (le GET renvoie des champs null, jamais 404).
  useEffect(() => {
    api<ProspectingProfile>('/api/admin/prospecting/profile').then(pr => {
      setPWebQuery(pr.web_query || '')
      setPSector(pr.sector || '')
      setPDept(pr.departement || '')
      setPCp(pr.code_postal || '')
      setPNotes(pr.notes || '')
      if (pr.web_query) setDQuery(pr.web_query)
      if (pr.sector) setDSector(pr.sector)
      if (pr.departement) setDDept(pr.departement)
      if (pr.code_postal) setDCp(pr.code_postal)
    }).catch(() => { /* profil non critique : repli silencieux */ })
  }, [])

  async function runSearch() {
    setError(''); setInfo(''); setSearching(true); setResults([])
    try {
      const found = await api<ProspectCandidate[]>('/api/admin/prospecting/search', {
        method: 'POST',
        body: { q: q || null, naf: naf || null, departement: departement || null, code_postal: codePostal || null },
      })
      setResults(found)
      if (found.length === 0) setInfo('Aucune entreprise trouvée pour ces critères.')
    } catch (err: unknown) {
      setError(`Recherche impossible : ${errMsg(err)}`)
    } finally {
      setSearching(false)
    }
  }

  async function importOne(c: ProspectCandidate) {
    setError(''); setImporting(c.siren || c.company_name)
    try {
      const created = await api<Prospect[]>('/api/admin/prospecting/prospects', {
        method: 'POST', body: { candidates: [c] },
      })
      if (created.length === 0) setInfo(`« ${c.company_name} » est déjà dans vos prospects.`)
      else setInfo(`« ${c.company_name} » ajouté à vos prospects.`)
      loadProspects()
    } catch (err: unknown) {
      setError(`Import impossible : ${errMsg(err)}`)
    } finally {
      setImporting(null)
    }
  }

  // Découverte autonome : l'IA déniche des entreprises, trouve leur site et les
  // score. L'opération est longue (~30 s) ; on recharge la liste une fois finie.
  async function runDiscover() {
    setError(''); setInfo(''); setDiscovering(true)
    try {
      const created = await api<Prospect[]>('/api/admin/prospecting/discover', {
        method: 'POST',
        body: { sector: dSector || null, departement: dDept || null, code_postal: dCp || null, count: dCount },
      })
      if (created.length === 0) setInfo('Aucune nouvelle entreprise trouvée pour ces critères.')
      else setInfo(`${created.length} entreprise(s) trouvée(s) et analysée(s) par l'IA.`)
      loadProspects()
    } catch (err: unknown) {
      setError(`Découverte impossible : ${errMsg(err)}`)
    } finally {
      setDiscovering(false)
    }
  }

  // Découverte web (mode intuitif) : une description libre → Brave → scrape →
  // scoring IA côté serveur. Même temporalité (~30 s) que la découverte SIRENE.
  async function runDiscoverWeb() {
    setError(''); setInfo(''); setDiscoveringWeb(true)
    try {
      const created = await api<Prospect[]>('/api/admin/prospecting/discover-web', {
        method: 'POST',
        body: { query: dQuery, count: dCount },
      })
      if (created.length === 0) setInfo('Aucune nouvelle entreprise trouvée pour cette recherche.')
      else setInfo(`${created.length} entreprise(s) trouvée(s) et analysée(s) par l'IA.`)
      loadProspects()
    } catch (err: unknown) {
      setError(`Recherche impossible : ${errMsg(err)}`)
    } finally {
      setDiscoveringWeb(false)
    }
  }

  // Prospection 100% AUTOMATIQUE : aucune saisie. L'IA choisit elle-même les
  // cibles (client idéal Chapote + profil + décisions passées), cherche, scrape
  // et score. L'opérateur ne fait que valider 👍/👎 ensuite.
  async function runAuto() {
    setError(''); setInfo(''); setDiscoveringAuto(true)
    try {
      const created = await api<Prospect[]>('/api/admin/prospecting/auto', {
        method: 'POST', body: { count: dCount },
      })
      if (created.length === 0) setInfo('Aucun nouveau prospect cette fois — relancez ou précisez votre profil cible.')
      else setInfo(`${created.length} prospect(s) trouvé(s) et analysé(s) par l'IA. Validez ceux qui vous intéressent 👍/👎.`)
      loadProspects()
    } catch (err: unknown) {
      setError(`Prospection automatique impossible : ${errMsg(err)}`)
    } finally {
      setDiscoveringAuto(false)
    }
  }

  // Enregistre le profil cible (upsert côté API). On envoie tous les champs
  // (vide → null) pour que la sauvegarde reflète exactement le formulaire.
  async function saveProfile() {
    setError(''); setInfo(''); setSavingProfile(true)
    try {
      await api<ProspectingProfile>('/api/admin/prospecting/profile', {
        method: 'PUT',
        body: {
          web_query: pWebQuery || null, sector: pSector || null,
          departement: pDept || null, code_postal: pCp || null, notes: pNotes || null,
        },
      })
      setInfo('Profil cible enregistré.')
    } catch (err: unknown) {
      setError(`Enregistrement impossible : ${errMsg(err)}`)
    } finally {
      setSavingProfile(false)
    }
  }

  // Pouce-haut / pouce-bas depuis la liste. stopPropagation : ne pas naviguer
  // vers le détail quand on clique le bouton de décision dans une ligne cliquable.
  async function decide(e: React.MouseEvent, prospectId: number, decision: 'accepted' | 'rejected') {
    e.stopPropagation()
    setError(''); setInfo(''); setDeciding(prospectId)
    try {
      await api(`/api/admin/prospecting/prospects/${prospectId}/decision`, { method: 'POST', body: { decision } })
      loadProspects()
    } catch (err: unknown) {
      setError(`Décision impossible : ${errMsg(err)}`)
    } finally {
      setDeciding(null)
    }
  }

  const sent = prospects.filter(p => p.status === 'sent').length
  const importedSirens = new Set(prospects.map(p => p.siren).filter(Boolean))
  // Tri par score décroissant (non scorés en dernier), puis plus récents d'abord.
  const sortedProspects = [...prospects].sort((a, b) => {
    const fa = a.fit_score ?? -1, fb = b.fit_score ?? -1
    if (fa !== fb) return fb - fa
    return b.created_at.localeCompare(a.created_at)
  })

  return (
    <div className="col g18">
      <SectionTitle sub="Trouvez des entreprises candidates et préparez un email de prospection.">
        Prospection
      </SectionTitle>

      <InfoBox tone="info" title="Comment ça marche">
        La recherche s'appuie sur l'annuaire public des entreprises (base SIRENE). Importez les
        entreprises pertinentes, lancez l'analyse de leur site, puis laissez l'IA rédiger un email
        que vous relisez et envoyez vous-même. Ciblez uniquement des contacts professionnels (RGPD).
      </InfoBox>

      {error && <div className="error">{error}</div>}
      {info && <div className="muted" style={{ fontSize: 13 }}>{info}</div>}

      <div className="stat-row">
        <Stat label="Prospects" value={prospects.length} icon={<Building2 size={15} />} sub="en base" />
        <Stat label="Brouillons" value={prospects.filter(p => p.status === 'drafted').length} sub="prêts à relire" />
        <Stat label="Envoyés" value={sent} icon={<Send size={15} />} sub="emails partis" />
      </div>

      {/* Profil cible persistant (repliable) — préremplit la découverte et
          alimente le scoring IA via les notes de l'opérateur. */}
      <Card>
        <button type="button" className="row g8" onClick={() => setProfileOpen(o => !o)}
          style={{ background: 'none', border: 'none', padding: 0, width: '100%', cursor: 'pointer', justifyContent: 'space-between', textAlign: 'left' }}>
          <span className="card-title" style={{ marginBottom: 0 }}>
            <span className="row g6"><Target size={15} />Profil cible</span>
          </span>
          <ChevronDown size={16} style={{ color: 'var(--faint)', flexShrink: 0, transition: 'transform .15s', transform: profileOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
        {profileOpen && (
          <div className="col g10" style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Décrivez votre cible idéale : ces critères préremplissent la recherche et vos notes
              affinent le scoring de l'IA (en plus des décisions passées).
            </div>
            <div className="row g10" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 2, minWidth: 200 }}>
                <Field label="Recherche web"><input type="text" value={pWebQuery} placeholder="ex. restaurants à Versailles"
                  onChange={e => setPWebQuery(e.target.value)} style={{ width: '100%' }} /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Field label="Secteur / activité"><input type="text" value={pSector} placeholder="ex. restaurant"
                  onChange={e => setPSector(e.target.value)} style={{ width: '100%' }} /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <Field label="Département"><input type="text" value={pDept} placeholder="78"
                  onChange={e => setPDept(e.target.value)} style={{ width: '100%' }} /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <Field label="Code postal"><input type="text" value={pCp} placeholder="78000"
                  onChange={e => setPCp(e.target.value)} style={{ width: '100%' }} /></Field>
              </div>
            </div>
            <Field label="Notes pour l'IA" hint="Ce que vous recherchez (taille, signaux, exclusions…) — injecté dans le scoring.">
              <textarea value={pNotes} rows={4} placeholder="ex. PME locales sans chatbot, plutôt restauration et commerces de proximité…"
                onChange={e => setPNotes(e.target.value)} style={{ width: '100%' }} />
            </Field>
            <div className="row">
              <Btn onClick={saveProfile} disabled={savingProfile}>
                <span className="row g6"><Save size={15} />{savingProfile ? 'Enregistrement…' : 'Enregistrer'}</span>
              </Btn>
            </div>
          </div>
        )}
      </Card>

      {/* Découverte automatique (web Brave OU annuaire SIRENE + scoring IA) */}
      <Card>
        <div className="card-title"><span className="row g6"><Sparkles size={15} />Trouver des prospects</span></div>
        {/* PRINCIPAL : prospection 100% automatique — l'IA choisit les cibles, zéro saisie. */}
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Laissez l'IA trouver pour vous des entreprises susceptibles d'avoir besoin de Chapote : elle
          choisit les cibles (profil client idéal + votre profil cible + vos décisions passées), retrouve
          leur site et estime leur besoin. Vous n'avez plus qu'à valider 👍/👎 — vos choix affinent les
          recherches suivantes. Comptez ~30 s.
        </div>
        <div className="row g10" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <div style={{ width: 90 }}>
            <Field label="Nombre"><input type="number" min={1} max={10} value={dCount}
              onChange={e => setDCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ width: '100%' }} /></Field>
          </div>
          <Btn kind="primary" onClick={runAuto} disabled={discoveringAuto}>
            <span className="row g6"><Sparkles size={15} />{discoveringAuto ? 'Recherche en cours… (~30 s)' : 'Trouve-moi des prospects'}</span>
          </Btn>
        </div>

        {/* AVANCÉ : recherche ciblée manuelle (description libre ou annuaire SIRENE). */}
        <button onClick={() => setAdvancedOpen(o => !o)} className="row g6"
          style={{ background: 'none', border: 'none', color: 'var(--mut)', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>
          {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Recherche ciblée (avancée)
        </button>
        {advancedOpen && (<div style={{ marginTop: 12 }}>
        <div style={{ marginBottom: 12 }}>
          <Seg small value={discoverMode} onChange={v => setDiscoverMode(v as 'web' | 'sirene')}
            options={[
              { value: 'web', label: <span className="row g6"><Globe size={13} />Recherche web</span> },
              { value: 'sirene', label: <span className="row g6"><Building2 size={13} />Annuaire SIRENE</span> },
            ]} />
        </div>
        {discoverMode === 'web' ? (
          <>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
              Décrivez qui vous cherchez en langage naturel. L'IA cherche sur le web, identifie les
              entreprises, retrouve leur site et estime leur besoin. Comptez ~30 s : les prospects sont
              créés, analysés et triés par score.
            </div>
            <div className="row g10" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 3, minWidth: 240 }}>
                <Field label="Décrivez qui vous cherchez"><input type="text" value={dQuery} placeholder="ex. restaurants à Versailles"
                  onChange={e => setDQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && !discoveringWeb && runDiscoverWeb()} style={{ width: '100%' }} /></Field>
              </div>
              <div style={{ width: 90 }}>
                <Field label="Nombre"><input type="number" min={1} max={10} value={dCount}
                  onChange={e => setDCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ width: '100%' }} /></Field>
              </div>
              <Btn onClick={runDiscoverWeb} disabled={discoveringWeb}>
                <span className="row g6"><Sparkles size={15} />{discoveringWeb ? 'Recherche IA…' : 'Trouver'}</span>
              </Btn>
            </div>
          </>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
              L'IA déniche des entreprises (base SIRENE), retrouve leur site et estime leur besoin de
              chatbot. Comptez ~30 s : les prospects sont créés, analysés et triés par score.
            </div>
            <div className="row g10" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 2, minWidth: 180 }}>
                <Field label="Secteur / activité"><input type="text" value={dSector} placeholder="ex. restaurant, garage auto"
                  onChange={e => setDSector(e.target.value)} onKeyDown={e => e.key === 'Enter' && !discovering && runDiscover()} style={{ width: '100%' }} /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <Field label="Département"><input type="text" value={dDept} placeholder="69"
                  onChange={e => setDDept(e.target.value)} onKeyDown={e => e.key === 'Enter' && !discovering && runDiscover()} style={{ width: '100%' }} /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <Field label="Code postal"><input type="text" value={dCp} placeholder="69001"
                  onChange={e => setDCp(e.target.value)} onKeyDown={e => e.key === 'Enter' && !discovering && runDiscover()} style={{ width: '100%' }} /></Field>
              </div>
              <div style={{ width: 90 }}>
                <Field label="Nombre"><input type="number" min={1} max={10} value={dCount}
                  onChange={e => setDCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ width: '100%' }} /></Field>
              </div>
              <Btn onClick={runDiscover} disabled={discovering}>
                <span className="row g6"><Sparkles size={15} />{discovering ? 'Recherche IA…' : 'Trouver'}</span>
              </Btn>
            </div>
          </>
        )}
        </div>)}
      </Card>

      {/* Formulaire de recherche */}
      <Card>
        <div className="card-title">Rechercher des entreprises</div>
        <div className="row g10" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Mots-clés / nom"><input type="text" value={q} placeholder="ex. plombier, agence immobilière"
              onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()} style={{ width: '100%' }} /></Field>
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <Field label="Code NAF" hint="ex. 5610A"><input type="text" value={naf} placeholder="56.10A"
              onChange={e => setNaf(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()} style={{ width: '100%' }} /></Field>
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <Field label="Département"><input type="text" value={departement} placeholder="69"
              onChange={e => setDepartement(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()} style={{ width: '100%' }} /></Field>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <Field label="Code postal"><input type="text" value={codePostal} placeholder="69001"
              onChange={e => setCodePostal(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()} style={{ width: '100%' }} /></Field>
          </div>
          <Btn onClick={runSearch} disabled={searching}>
            <span className="row g6"><Search size={15} />{searching ? 'Recherche…' : 'Rechercher'}</span>
          </Btn>
        </div>
      </Card>

      {/* Résultats de recherche */}
      {results.length > 0 && (
        <Card nopad>
          <table className="kc">
            <thead><tr><th>Entreprise</th><th>Secteur</th><th>Ville</th><th></th></tr></thead>
            <tbody>
              {results.map((c, i) => {
                const already = !!(c.siren && importedSirens.has(c.siren))
                return (
                  <tr key={c.siren || i}>
                    <td>
                      <span style={{ display: 'block', fontWeight: 700 }}>{c.company_name}</span>
                      {c.contact_name && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--faint)' }}>{c.contact_name}</span>}
                    </td>
                    <td style={{ color: 'var(--mut)', fontSize: 12.5 }}>{c.sector_label || c.naf_code || '—'}</td>
                    <td style={{ color: 'var(--mut)' }}>{c.postal_code} {c.city}</td>
                    <td style={{ textAlign: 'right' }}>
                      {already
                        ? <Chip tone="go">Importé</Chip>
                        : <Btn kind="soft" small onClick={() => importOne(c)} disabled={importing === (c.siren || c.company_name)}>
                            <span className="row g6"><UserPlus size={13} />Importer</span>
                          </Btn>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Prospects en base */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, margin: '4px 0 11px' }}>Mes prospects</div>
        {prospects.length === 0
          ? <Card style={{ color: 'var(--faint)' }}>Aucun prospect importé pour l'instant.</Card>
          : (
            <Card nopad>
              <table className="kc">
                <thead><tr><th>Entreprise</th><th>Ville</th><th>Email</th><th>Score</th><th>Statut</th><th>Décision</th><th></th></tr></thead>
                <tbody>
                  {sortedProspects.map(p => (
                    <tr key={p.id} className="click" tabIndex={0}
                        onClick={() => navigate(`/admin/prospecting/${p.id}`)}
                        onKeyDown={e => {
                          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault(); navigate(`/admin/prospecting/${p.id}`)
                          }
                        }}>
                      <td style={{ fontWeight: 700 }}>{p.company_name}</td>
                      <td style={{ color: 'var(--mut)' }}>{p.city || '—'}</td>
                      <td style={{ color: 'var(--mut)', fontSize: 12.5 }}>{p.contact_email || '—'}</td>
                      <td>{scoreChip(p.fit_score)}</td>
                      <td>{prospectStatusChip(p.status)}</td>
                      <td>
                        {p.decision === 'accepted'
                          ? <Chip tone="go">Validé</Chip>
                          : p.decision === 'rejected'
                            ? <Chip tone="danger">Écarté</Chip>
                            : (
                              // stopPropagation sur les boutons uniquement : un chip
                              // statique (déjà décidé) laisse le clic ouvrir le détail.
                              <div className="row g6" onClick={e => e.stopPropagation()}>
                                <Btn kind="soft" small onClick={e => decide(e, p.id, 'accepted')} disabled={deciding === p.id}>
                                  <ThumbsUp size={13} />
                                </Btn>
                                <Btn kind="ghost" small onClick={e => decide(e, p.id, 'rejected')} disabled={deciding === p.id}>
                                  <ThumbsDown size={13} />
                                </Btn>
                              </div>
                            )}
                      </td>
                      <td style={{ color: 'var(--faint)', textAlign: 'right' }}><ChevronRight size={14} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
      </div>
    </div>
  )
}
