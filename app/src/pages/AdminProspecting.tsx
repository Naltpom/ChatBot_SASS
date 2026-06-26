// Vue ADMIN — Prospection commerciale : recherche d'entreprises (API publique
// SIRENE), import en base, puis suivi des prospects (enrichissement + email IA).
import { useEffect, useState } from 'react'
import { Building2, ChevronRight, Search, Send, UserPlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Btn, Card, Chip, Field, InfoBox, SectionTitle, Stat } from '../ui'
import { errMsg } from '../utils/errors'

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

export interface Prospect extends ProspectCandidate {
  id: number
  website: string | null
  contact_email: string | null
  site_summary: string | null
  has_existing_chatbot: boolean | null
  email_subject: string | null
  email_body: string | null
  status: string
  created_at: string
  updated_at: string
  sent_at: string | null
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

  function loadProspects() {
    api<Prospect[]>('/api/admin/prospecting/prospects').then(setProspects)
      .catch((err: unknown) => setError(`Chargement des prospects impossible : ${errMsg(err)}`))
  }
  useEffect(() => { loadProspects() }, [])

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

  const sent = prospects.filter(p => p.status === 'sent').length
  const importedSirens = new Set(prospects.map(p => p.siren).filter(Boolean))

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
                <thead><tr><th>Entreprise</th><th>Ville</th><th>Email</th><th>Statut</th><th></th></tr></thead>
                <tbody>
                  {prospects.map(p => (
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
                      <td>{prospectStatusChip(p.status)}</td>
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
