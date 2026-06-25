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

// Statut d'une ligne dans le diff d'évolution du plan : inchangée, ajoutée (vert
// gras, « + »), ou retirée (rouge barré, « fin de période »).
type LineStatus = 'same' | 'added' | 'removed'
// Vert « ajout » : var --ok si le thème la définit un jour, sinon vert lisible.
const ADDED_COLOR = 'var(--ok, #16a34a)'

function CartRow({ line, currency, status = 'same' }: {
  line: CartLine; currency: string; status?: LineStatus
}) {
  const free = line.cents === 0
  const added = status === 'added'
  const removed = status === 'removed'
  const color = removed ? 'var(--danger)' : added ? ADDED_COLOR : free ? 'var(--mut)' : 'var(--ink)'
  return (
    <div className="cart-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', padding: '5px 0' }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ color, fontSize: 13, fontWeight: added ? 700 : 400,
                       textDecoration: removed ? 'line-through' : undefined }}>
          {added ? '+ ' : ''}{line.label}
        </span>
        {removed && <span style={{ fontSize: 10.5, color: 'var(--danger)', whiteSpace: 'nowrap', fontWeight: 600 }}>fin de période</span>}
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                     fontWeight: added ? 700 : free ? 400 : 600, color,
                     textDecoration: removed ? 'line-through' : undefined }}>
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
  baseline = null,
}: {
  catalog: BillingCatalog
  config: BotConfig
  variant?: 'sticky' | 'drawer' | 'inline'
  // Titre du panier (ex. « Récapitulatif » côté wizard).
  title?: string
  // CTA/contenu additionnel sous le total (ex. bouton « Continuer »).
  footer?: React.ReactNode
  // Plan ACTUEL (abonnement en cours) : si fourni, le panier devient un DIFF —
  // ajouts en vert/gras, retraits barrés en rouge (« fin de période »), delta vs
  // le total actuel. null = pas de diff (souscription initiale).
  baseline?: BotConfig | null
}) {
  const cart = computeCart(catalog, config)
  const baseCart = baseline ? computeCart(catalog, baseline) : null
  const taxNote = catalog.tax_note || 'TVA non applicable, art. 293 B du CGI'

  // Diff ligne à ligne (par clé) : lignes cibles d'abord (ajout/inchangé), puis
  // les lignes retirées (présentes dans le plan actuel, absentes de la cible).
  const newKeys = new Set(cart.lines.map(l => l.key))
  const baseKeys = new Set(baseCart?.lines.map(l => l.key) ?? [])
  const displayRows: { line: CartLine; status: LineStatus }[] = [
    ...cart.lines.map(l => ({ line: l, status: (baseCart && !baseKeys.has(l.key) ? 'added' : 'same') as LineStatus })),
    ...(baseCart ? baseCart.lines.filter(l => !newKeys.has(l.key)).map(l => ({ line: l, status: 'removed' as LineStatus })) : []),
  ]
  const delta = baseCart ? cart.total_cents - baseCart.total_cents : 0

  // Intro 1er mois remisé : visible UNIQUEMENT pour une souscription initiale
  // (pas de baseline = pas une modif de plan en cours). % selon le palier IA, ou
  // 'default' (IA off/BYOK). Source = catalog.intro_discounts (parité backend).
  const introKey = config.ai_byok || !config.ai_tier_id ? 'default' : config.ai_tier_id
  const introPct = baseCart == null ? (catalog.intro_discounts?.[introKey] ?? catalog.intro_discounts?.default ?? 0) : 0
  const introFirstMonth = Math.round(cart.total_cents * (100 - introPct) / 100)
  const showIntro = introPct > 0 && cart.total_cents > 0

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
        {displayRows.map(({ line, status }) => (
          <CartRow key={`${status}-${line.key}`} line={line} currency={catalog.currency} status={status} />
        ))}
      </div>
      <Divider />
      <div className="cart-total" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0 2px' }}>
        <span style={{ fontWeight: 700 }}>Total / mois</span>
        <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {formatCents(cart.total_cents, catalog.currency)}
        </span>
      </div>
      {/* Évolution vs le plan actuel : total d'avant + delta (seulement si ça change). */}
      {baseCart && delta !== 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 3 }}>
          Plan actuel : {formatCents(baseCart.total_cents, catalog.currency)} /mois{' · '}
          <span style={{ color: delta > 0 ? ADDED_COLOR : 'var(--danger)', fontWeight: 700 }}>
            {delta > 0 ? '+' : '−'}{formatCents(Math.abs(delta), catalog.currency)} /mois
          </span>
        </div>
      )}
      {/* Remise intro 1er mois (souscription initiale) : appliquée par Stripe au
          paiement (coupon duration:once) — on l'affiche ici pour la transparence. */}
      {showIntro && (
        <div style={{ marginTop: 8, padding: '9px 11px', borderRadius: 9,
                      background: 'var(--acc-soft)', border: '1px solid var(--bd)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontWeight: 700, color: 'var(--acc)' }}>1er mois</span>
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ textDecoration: 'line-through', color: 'var(--mut)', fontSize: 12 }}>
                {formatCents(cart.total_cents, catalog.currency)}
              </span>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--acc)', fontVariantNumeric: 'tabular-nums' }}>
                {formatCents(introFirstMonth, catalog.currency)}
              </span>
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 2 }}>
            Remise de bienvenue −{introPct}% le 1er mois, puis {formatCents(cart.total_cents, catalog.currency)}/mois.
          </div>
        </div>
      )}
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
