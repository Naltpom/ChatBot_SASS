// Factures Stripe (back-office) — GET /api/admin/invoices : toutes les
// factures du compte Stripe, enrichies du client (org_id/org_name).
// Montants en CENTIMES, dates en epoch SECONDES.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Card, InfoBox, SectionTitle } from '../ui'
import { Invoice, formatCents, invoiceDate, invoiceStatusChip } from '../billingUtils'

interface InvoicesOut {
  billing_enabled: boolean
  invoices: Invoice[]
}

export default function AdminInvoices() {
  const [data, setData] = useState<InvoicesOut | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<InvoicesOut>('/api/admin/invoices?limit=50').then(setData).catch((err: any) => setError(err.message))
  }, [])

  if (error) return (
    <div className="col g18">
      <SectionTitle>Factures</SectionTitle>
      <div className="error">{error}</div>
    </div>
  )
  if (!data) return <div className="center-page">Chargement…</div>

  if (!data.billing_enabled) {
    return (
      <div className="col g18">
        <SectionTitle sub="Toutes les factures Stripe de la plateforme.">Factures</SectionTitle>
        <InfoBox tone="warn" title="Facturation en ligne non configurée">
          Les variables STRIPE_* ne sont pas renseignées — aucune facture à afficher.
        </InfoBox>
      </div>
    )
  }

  return (
    <div className="col g18">
      <SectionTitle sub={`${data.invoices.length} facture${data.invoices.length > 1 ? 's' : ''} — données Stripe en direct.`}>
        Factures
      </SectionTitle>

      {data.invoices.length === 0 ? (
        <Card style={{ textAlign: 'center', color: 'var(--faint)', padding: 28 }}>
          Aucune facture émise pour l'instant.
        </Card>
      ) : (
        <Card nopad>
          <table className="kc">
            <thead>
              <tr>
                <th>Numéro</th><th>Client</th><th>Statut</th><th>Montant</th><th>Date</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map(inv => (
                <tr key={inv.id}>
                  <td className="mono" style={{ fontSize: 11.5 }}>{inv.number || inv.id}</td>
                  <td>
                    {inv.org_id != null ? (
                      <Link to={`/admin/clients/${inv.org_id}`} style={{ fontWeight: 700 }}>{inv.org_name}</Link>
                    ) : (
                      <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{inv.customer || '—'}</span>
                    )}
                  </td>
                  <td>{invoiceStatusChip(inv.status)}</td>
                  <td className="num" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {formatCents(inv.total)} {(inv.currency || 'eur').toUpperCase()}
                    {inv.amount_paid !== inv.total && (
                      <span style={{ display: 'block', fontSize: 10.5, fontWeight: 400, color: 'var(--faint)' }}>
                        payé : {formatCents(inv.amount_paid)}
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--mut)', whiteSpace: 'nowrap' }}>{invoiceDate(inv.created)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className="row g10" style={{ justifyContent: 'flex-end' }}>
                      {inv.hosted_invoice_url && (
                        <a href={inv.hosted_invoice_url} target="_blank" rel="noopener" style={{ fontSize: 12, fontWeight: 700 }}>Voir</a>
                      )}
                      {inv.invoice_pdf && (
                        <a href={inv.invoice_pdf} target="_blank" rel="noopener" style={{ fontSize: 12, fontWeight: 700 }}>PDF</a>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
