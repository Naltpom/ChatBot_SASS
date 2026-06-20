// PriceCart — panier de facturation LIVE (façon facture) consommé par le
// configurateur. Recalcule localement via computeCart (utils/billing, fonction
// PURE) à partir du catalogue (source backend) et de la config courante. Le front
// ne valide JAMAIS de montant : il affiche, le backend (Stripe) reste la vérité.
//
// Affichage :
//   - une ligne par produit (socle gratuit toujours visible, transparence) ;
//   - total mensuel ;
//   - mention légale obligatoire « TVA non applicable, art. 293 B du CGI »
//     (franchise en base — aucune TVA collectée, spec §2.2 / §5.3).
//
// Variantes (`variant`) :
//   - 'sticky'  : carte sticky desktop (colonne de droite du configurateur) ;
//   - 'drawer'  : barre fixe basse (mobile), récapitulatif compact + total ;
//   - 'inline'  : rendu simple sans positionnement (réutilisable ailleurs).
import { Card, Divider } from '../../ui'
import { computeCart, type CartLine } from '../../utils/billing'
import type { BillingCatalog, BotConfig } from '../../types/billing'

// Centimes -> « 19 € » / « 0 € » (entiers) ou « 1,50 € » si fraction (jamais ici
// en v1 : tous les montants catalogue sont des euros entiers, mais on reste juste).
export function formatCents(cents: number, currency = 'eur'): string {
  const symbol = currency === 'eur' ? '€' : currency.toUpperCase()
  const euros = cents / 100
  const isInt = Number.isInteger(euros)
  const body = euros.toLocaleString('fr-FR', {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${body} ${symbol}`
}

function CartRow({ line, currency }: { line: CartLine; currency: string }) {
  const free = line.cents === 0
  return (
    <div className="cart-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', padding: '5px 0' }}>
      <span style={{ color: free ? 'var(--mut)' : 'var(--ink)', fontSize: 13 }}>{line.label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: free ? 400 : 600, color: free ? 'var(--mut)' : 'var(--ink)' }}>
        {free ? 'gratuit' : formatCents(line.cents, currency)}
      </span>
    </div>
  )
}

export default function PriceCart({
  catalog,
  config,
  variant = 'sticky',
  title = 'Votre configuration',
  footer,
}: {
  catalog: BillingCatalog
  config: BotConfig
  variant?: 'sticky' | 'drawer' | 'inline'
  // Titre du panier (ex. « Récapitulatif » côté wizard).
  title?: string
  // CTA/contenu additionnel sous le total (ex. bouton « Continuer »).
  footer?: React.ReactNode
}) {
  const cart = computeCart(catalog, config)
  const taxNote = catalog.tax_note || 'TVA non applicable, art. 293 B du CGI'

  // Drawer mobile : version compacte (total + détail repliable visuellement léger).
  if (variant === 'drawer') {
    return (
      <div className="price-cart drawer" role="region" aria-label="Récapitulatif de facturation"
           style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 80,
                    background: 'var(--card, #fff)', borderTop: '1px solid var(--bd)',
                    boxShadow: '0 -6px 24px rgba(0,0,0,.08)', padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: 'var(--mut)' }}>{taxNote}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {formatCents(cart.total_cents, catalog.currency)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--mut)' }}>/ mois</span>
            </div>
          </div>
          {footer && <div style={{ flex: '0 0 auto' }}>{footer}</div>}
        </div>
      </div>
    )
  }

  const body = (
    <>
      <div className="section-title" style={{ marginBottom: 4 }}>{title}</div>
      <div className="cart-lines" style={{ margin: '8px 0' }}>
        {cart.lines.map(line => (
          <CartRow key={line.key} line={line} currency={catalog.currency} />
        ))}
      </div>
      <Divider />
      <div className="cart-total" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0 2px' }}>
        <span style={{ fontWeight: 700 }}>Total / mois</span>
        <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {formatCents(cart.total_cents, catalog.currency)}
        </span>
      </div>
      <div className="cart-tax-note" style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 2 }}>
        {taxNote}
      </div>
      {footer && <div style={{ marginTop: 12 }}>{footer}</div>}
    </>
  )

  if (variant === 'inline') {
    return <div className="price-cart inline" role="region" aria-label="Récapitulatif de facturation">{body}</div>
  }

  // sticky desktop
  return (
    <div className="price-cart sticky" role="region" aria-label="Récapitulatif de facturation"
         style={{ position: 'sticky', top: 16 }}>
      <Card>{body}</Card>
    </div>
  )
}
