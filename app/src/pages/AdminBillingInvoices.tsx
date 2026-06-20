// Sous-page ADMIN FACTURATION — FACTURES GLOBALES (/admin/billing/invoices).
// SUPERADMIN UNIQUEMENT (route protégée front + serveur). Extraite de la console
// monolithique : affiche toutes les factures du compte Stripe, en remontant au
// payeur via l'overview (customer cus_... -> email).
//
// INVARIANT billing-OFF : les routes admin renvoient { billing: 'disabled' } quand
// billing_enabled()==False. On détecte la sentinelle et on n'affiche qu'une InfoBox
// « facturation désactivée » — aucun appel inutile, aucune table vide mensongère.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, InfoBox, SectionTitle } from '../ui'
import { errMsg } from '../utils/errors'
import type { AdminBillingOverview, AdminPayer, Invoice } from '../types/billing'

const INVOICE_STATUS_LABELS: Record<Invoice['status'], string> = {
  paid: 'Payée', open: 'En attente', void: 'Annulée',
  uncollectible: 'Impayée', draft: 'Brouillon',
}

function fmtEur(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}
function fmtDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// Sentinelle billing-OFF : les routes admin renvoient { billing: 'disabled' }.
function isDisabled(x: unknown): boolean {
  return !!x && typeof x === 'object' && (x as { billing?: string }).billing === 'disabled'
}

export default function AdminBillingInvoices() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [overview, setOverview] = useState<AdminBillingOverview | null>(null)
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [billingOff, setBillingOff] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    // Overview d'abord (pour la sentinelle + l'index customer->payeur), puis
    // factures si le billing est actif.
    api<AdminBillingOverview | { billing: 'disabled' }>('/api/admin/billing/overview')
      .then(async d => {
        if (!alive) return
        if (isDisabled(d)) { setBillingOff(true); setOverview(null); setInvoices(null); return }
        setBillingOff(false)
        setOverview(d as AdminBillingOverview)
        const inv = await api<Invoice[] | { billing: 'disabled' }>('/api/admin/billing/invoices')
        if (!alive) return
        setInvoices(isDisabled(inv) ? [] : (inv as Invoice[]))
      })
      .catch((err: unknown) => { if (alive) setError(errMsg(err, 'Chargement impossible.')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [tick])

  // Index customer id (cus_...) -> payeur, pour étiqueter les factures (Stripe ne
  // renvoie qu'un customer id ; on retombe dessus si on ne retrouve pas le payeur).
  const customerToPayer = useMemo(() => {
    const m = new Map<string, AdminPayer>()
    for (const p of overview?.payers ?? []) {
      if (p.stripe_customer_id) m.set(p.stripe_customer_id, p)
    }
    return m
  }, [overview])

  // --- Garde superadmin (défense en profondeur ; la route est déjà protégée) ---
  if (!user?.is_superadmin) {
    return (
      <div className="col g18">
        <SectionTitle>Factures</SectionTitle>
        <InfoBox tone="danger" title="Accès refusé">
          Cette console est réservée au staff Chapote.
        </InfoBox>
      </div>
    )
  }

  if (loading) return <div className="center-page">Chargement…</div>

  if (error) {
    return (
      <div className="col g18">
        <Header navigate={navigate} />
        <InfoBox tone="danger" title="Impossible de charger les factures">
          {error}
          <div style={{ marginTop: 12 }}>
            <Btn kind="ghost" small onClick={reload}>Réessayer</Btn>
          </div>
        </InfoBox>
      </div>
    )
  }

  if (billingOff) {
    return (
      <div className="col g18">
        <Header navigate={navigate} />
        <InfoBox tone="info" title="Facturation désactivée">
          La facturation est désactivée sur cette instance (aucune clé Stripe configurée).
          Aucune facture n'est émise tant que le billing n'est pas activé côté serveur.
        </InfoBox>
      </div>
    )
  }

  return (
    <div className="col g18">
      <Header navigate={navigate} />

      <div>
        <div className="card-title" style={{ marginBottom: 11 }}>Factures (compte Stripe)</div>
        {invoices == null ? (
          <Card style={{ color: 'var(--faint)' }}>Chargement…</Card>
        ) : invoices.length === 0 ? (
          <Card style={{ color: 'var(--faint)' }}>Aucune facture émise.</Card>
        ) : (
          <Card nopad>
            <table className="kc">
              <thead>
                <tr>
                  <th>Date</th><th>N°</th><th>Client</th>
                  <th>Montant</th><th>Statut</th><th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const payer = customerToPayer.get(inv.customer || '')
                  return (
                    <tr key={inv.id}>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--mut)' }}>{fmtDate(inv.created)}</td>
                      <td style={{ fontWeight: 600 }}>{inv.number || '—'}</td>
                      <td>
                        {payer
                          ? <span style={{ fontSize: 12.5 }}>{payer.email}</span>
                          : <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'monospace' }}>
                              {inv.customer || '—'}
                            </span>}
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>{fmtEur(inv.amount_paid_cents)}</td>
                      <td>
                        <Chip tone={inv.status === 'paid' ? 'go' : inv.status === 'open' ? 'warn' : 'mut'}>
                          {INVOICE_STATUS_LABELS[inv.status]}
                        </Chip>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div className="row g8">
                          {inv.hosted_invoice_url && (
                            <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer"
                               className="btn btn-ghost small" style={{ textDecoration: 'none' }}>Voir</a>
                          )}
                          {inv.invoice_pdf && (
                            <a href={inv.invoice_pdf} target="_blank" rel="noreferrer"
                               className="btn btn-ghost small" style={{ textDecoration: 'none' }}>PDF</a>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  )
}

function Header({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <SectionTitle sub="Toutes les factures émises sur le compte Stripe — staff uniquement."
                  right={<Btn kind="ghost" small onClick={() => navigate('/admin/billing')}>← Vue d'ensemble</Btn>}>
      Factures
    </SectionTitle>
  )
}
