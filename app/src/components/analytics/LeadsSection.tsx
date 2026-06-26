// Section « Leads » de la page Analytics — pur présentationnel, extrait
// d'Analytics.tsx (refacto R14, 3 responsabilités → Stats / Insights / Leads).
// Affiche le tableau des contacts capturés (date/email/nom/tel/message/source),
// le bouton « Actualiser » et l'export CSV anti-injection (downloadCsv).
import { Inbox, RefreshCw } from 'lucide-react'
import { Btn, Card, Chip, InfoBox, SectionTitle } from '../../ui'
import { downloadCsv } from '../../utils/csv'
import { formatFr } from '../../utils/time'

// Forme d'un lead renvoyée par GET /api/bots/{id}/leads.
export interface LeadRow {
  id: number
  email: string
  phone: string | null
  name: string | null
  message: string | null
  source: 'tree' | 'ai'
  conversation_id: string | null
  created_at: string
}

export interface LeadsData { total: number; leads: LeadRow[] }

// Colonnes exportées (clés de LeadRow) → en-têtes CSV. Typer via keyof LeadRow
// supprime le `as any` de l'indexation (export anti-injection conservé).
const CSV_COLUMNS: (keyof LeadRow)[] = ['created_at', 'email', 'name', 'phone', 'message', 'source']

export default function LeadsSection({ botName, leads, leadsBusy, leadsError, onReload, onOpenTree }: {
  botName: string
  leads: LeadsData | null
  leadsBusy: boolean
  leadsError: string
  onReload: () => void
  onOpenTree: () => void
}) {
  function exportLeadsCsv() {
    const rows = leads?.leads || []
    const filename = `leads-${botName.toLowerCase().replace(/\s+/g, '-')}.csv`
    downloadCsv(filename, CSV_COLUMNS, rows.map(l => CSV_COLUMNS.map(c => l[c])))
  }

  return (
    <>
      <SectionTitle sub={`${leads?.total ?? 0} contact(s) capturé(s) par « ${botName} ».`}
        right={
          <div className="row g8">
            <Btn kind="ghost" small disabled={leadsBusy} onClick={onReload}>
              <RefreshCw size={13} /> Actualiser
            </Btn>
            <Btn kind="ghost" small onClick={exportLeadsCsv} disabled={!leads?.leads?.length}>
              Exporter CSV
            </Btn>
          </div>
        }>
        Leads
      </SectionTitle>

      {leadsError ? (
        <InfoBox tone="danger" title="Impossible de charger les leads">{leadsError}</InfoBox>
      ) : leadsBusy && !leads ? (
        <Card style={{ textAlign: 'center', color: 'var(--mut)' }}>Chargement…</Card>
      ) : !leads || leads.leads.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div className="col" style={{ alignItems: 'center', gap: 9 }}>
            <Inbox size={24} style={{ color: 'var(--faint)' }} />
            <div style={{ fontSize: 14, fontWeight: 800 }}>Aucun lead pour l'instant</div>
            <div style={{ fontSize: 12, color: 'var(--mut)', maxWidth: 400, lineHeight: 1.55 }}>
              Ajoutez un nœud « Contact » dans l'arbre, ou une action « Capture de lead », pour
              collecter des demandes.
            </div>
            <Btn kind="soft" small onClick={onOpenTree}>
              Ouvrir l'arbre
            </Btn>
          </div>
        </Card>
      ) : (
        <Card nopad>
          <div className="table-scroll">
<table className="kc">
            <thead>
              <tr><th>Date</th><th>Email</th><th>Nom</th><th>Téléphone</th><th>Message</th><th>Source</th></tr>
            </thead>
            <tbody>
              {leads.leads.map(l => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatFr(l.created_at)}</td>
                  <td className="mono">{l.email}</td>
                  <td>{l.name || '—'}</td>
                  <td className="mono">{l.phone || '—'}</td>
                  <td title={l.message || ''}>
                    {l.message ? (l.message.length > 60 ? `${l.message.slice(0, 60)}…` : l.message) : '—'}
                  </td>
                  <td>{l.source === 'ai' ? <Chip tone="acc">IA</Chip> : <Chip tone="mut">Arbre</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
        </Card>
      )}
    </>
  )
}
