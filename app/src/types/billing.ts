// Contrat de types partagé pour la facturation modulaire — fidèle aux clés JSON
// réelles renvoyées par l'API (schémas Pydantic en snake_case). Ces types
// décrivent la FORME exacte des objets échangés avec le backend billing ; ils ne
// codent AUCUN prix en dur côté logique (le front consomme GET /api/billing/catalog).
// Source de vérité :
//   - api/src/routers/billing.py        (catalog / summary / checkout / invoices)
//   - api/src/models/billing.py         (BillingProduct, BotEntitlement, ...)
//   - api/src/core/constants.py         (MODULE_KEYS — clés d'entitlement)
//   - docs/BILLING_IMPLEMENTATION_SPEC.md §2.2 (catalogue figé) / §5.1 (ces contrats)
//
// IMPORTANT : `ModuleKey` est aligné sur le backend (MODULE_KEYS, D4). Ce sont des
// clés d'ENTITLEMENT (modules débloqués), PAS des permissions (BOT_PERMS).

// Clés de module débloquables — strictement alignées sur core/constants.MODULE_KEYS.
export type ModuleKey = 'ai' | 'inbox' | 'rag' | 'actions' | 'ab' | 'white_label'

// Format de facture choisi par le User (User.billing_grouping). Défaut = 'total'.
export type BillingGrouping = 'per_bot' | 'total' | 'per_org'

// Un module du catalogue (add-on forfaitaire ou capacité IA exposée comme module).
// `byok_price_cents` n'est renseigné que pour le module 'ai' (variante BYOK forfait).
// `requires` = modules auto-activés par dépendance (jamais facturés s'ils sont gratuits).
export interface CatalogModule {
  key: ModuleKey
  label: string
  short: string
  desc: string
  price_cents: number
  byok_price_cents?: number
  requires?: ModuleKey[]
}

// Un palier (plan) IA managé : porte le quota de réponses incluses et son prix.
export interface AiTier {
  id: string
  included_replies: number
  price_cents: number
}

// Catalogue complet renvoyé par GET /api/billing/catalog. Le front recompose le
// panier localement (computeCart) mais fait confiance au backend pour le montant final.
export interface BillingCatalog {
  currency: 'eur'
  base_price_cents: number
  modules: CatalogModule[]
  ai_tiers: AiTier[]
  overage_cents_per_reply: number
  tax_note: string
  presets: CatalogPreset[]
  version: string
}

// Présélection guidée (configurateur). `est_price_cents` = somme transparente des
// produits composant le preset (pas de prix caché).
export interface CatalogPreset {
  key: 'vitrine' | 'pro_ia_rag' | 'service_client'
  label: string
  tagline: string
  modules: ModuleKey[]
  ai_tier_id: string | null
  recommended?: boolean
  est_price_cents: number
}

// État de facturation effectif d'un bot (conso vs quota, statut d'abonnement).
export interface BotBilling {
  bot_id: number
  active_modules: ModuleKey[]
  ai_tier_id: string | null
  ai_byok: boolean
  usage_ai_replies: number
  quota_ai_replies: number | null
  period_start: string
  period_end: string
  subscription_status: 'active' | 'past_due' | 'canceled' | 'none'
}

// Composition choisie par l'utilisateur dans le configurateur (entrée de computeCart).
export interface BotConfig {
  modules: ModuleKey[]
  ai_tier_id: string | null
  ai_byok: boolean
}

// Facture Stripe normalisée (GET /api/billing/invoices). `created` = epoch secondes.
export interface Invoice {
  id: string
  created: number
  amount_paid_cents: number
  currency: string
  status: 'paid' | 'open' | 'void' | 'uncollectible' | 'draft'
  hosted_invoice_url: string | null
  invoice_pdf: string | null
  number: string | null
  period_label?: string
}
