// Helpers facturation Stripe partagés entre AdminInvoices (back-office) et
// Billing (espace client). Montants Stripe TOUJOURS en centimes, dates en
// epoch SECONDES.
import { Chip } from './ui'

export interface Invoice {
  id: string
  number: string | null
  status: string
  total: number                 // centimes
  amount_paid: number           // centimes
  currency: string
  created: number | string | null  // epoch secondes (Stripe peut omettre la date)
  hosted_invoice_url: string | null
  invoice_pdf: string | null
  customer: string | null
  // Enrichissement admin uniquement
  org_id?: number | null
  org_name?: string | null
}

export function invoiceStatusChip(status: string) {
  switch (status) {
    case 'paid': return <Chip tone="go">Payée</Chip>
    case 'open': return <Chip tone="warn">En attente</Chip>
    case 'draft': return <Chip tone="mut">Brouillon</Chip>
    case 'void': return <Chip tone="mut">Annulée</Chip>
    case 'uncollectible': return <Chip tone="danger">Impayée</Chip>
    default: return <Chip tone="mut">{status}</Chip>
  }
}

export function formatCents(cents: number) {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })
}

// Défensif : epoch secondes (forme canonique), ISO string tolérée, null → tiret.
export function invoiceDate(created: number | string | null) {
  if (created == null) return '—'
  const d = typeof created === 'number' ? new Date(created * 1000) : new Date(created)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR')
}
