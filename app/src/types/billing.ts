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
  // Description commerciale RÉELLE du palier (seed backend). Affichée sous le
  // quota au lieu de répéter le nombre de réponses. Optionnelle (fallback hors-ligne).
  desc?: string
}

// Catalogue complet renvoyé par GET /api/billing/catalog. Le front recompose le
// panier localement (computeCart) mais fait confiance au backend pour le montant final.
export interface BillingCatalog {
  currency: 'eur'
  base_price_cents: number
  // Description commerciale RÉELLE du socle (seed backend, peut être null tant
  // que non posée). Le front l'affiche au lieu de répéter le titre « Socle ».
  base_description?: string | null
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

// Statut d'abonnement effectif d'un bot tel que renvoyé par l'API (entitlement /
// summary). 'trialing' = essai avec carte ; 'inactive' = paiement requis (Checkout
// abandonné) ou abonnement annulé (cf. RÈGLES PRODUIT §3/§4) ; 'none' = pas
// d'abonnement (socle gratuit). null jamais ici (billing-OFF est traité côté front).
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'inactive'
  | 'canceled'
  | 'none'

// NB : le statut de BADGE par bot exposé sur GET /api/bots (liste) vit dans
// types/bot.ts (`BotBillingStatus` = 'trialing'|'active'|'past_due'|'inactive',
// null = billing OFF), consommé par le helper partagé ui.tsx::billingChip. On ne
// le redéfinit pas ici pour éviter toute divergence.

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
  subscription_status: SubscriptionStatus
}

// ----------------------------------------------------------------------------
// Réponses des routes de GESTION DE PLAN (spec produit §1/§2). Toutes peuvent
// renvoyer la sentinelle billing-OFF { billing:'disabled' } (BillingDisabled).
// ----------------------------------------------------------------------------

// POST /api/billing/subscription/update {bot_id, config} — changement INSTANTANÉ
// au PRORATA (update_subscription_items, PAS de portail). En l'absence d'abonnement
// actif sur le bot, l'API bascule sur un Checkout (relance) -> { status:'needs_checkout' }.
export type SubscriptionUpdateResponse =
  | { status: 'updated' }
  | { status: 'needs_checkout'; checkout_url: string }
  | BillingDisabled

// POST /api/billing/subscription/cancel {bot_id} — pose cancel_at_period_end=true
// (fin de période, AUCUN remboursement) -> { status:'cancel_scheduled', current_period_end }.
// `current_period_end` = epoch secondes (date de coupure effective) ou null (MOCK).
export type SubscriptionCancelResponse =
  | { status: 'cancel_scheduled'; current_period_end: number | null }
  | BillingDisabled

// POST /api/billing/checkout — sert AUSSI à relancer le paiement d'un bot 'inactive'.
// `checkout_url` = URL Stripe hébergée (redirection) ; null/free = projection immédiate
// (MOCK / catalogue gratuit). `billing:'disabled'` si billing OFF.
export interface CheckoutResponse {
  checkout_url?: string | null
  free?: boolean
  billing?: string
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
  // customer (cus_...) : présent sur la vue staff agrégée (toutes les factures du
  // compte) pour remonter au payeur ; absent/neutre sur la vue payeur filtrée.
  customer?: string | null
}

// ============================================================================
// CONSOLE ADMIN FACTURATION (superadmin only) — formes des réponses des routes
// /api/admin/billing/* et /api/admin/bots/{id}/entitlement. Source de vérité :
//   - api/src/routers/admin.py (overview / invoices / entitlement, dépendance superadmin)
// INVARIANT billing-OFF : les routes renvoient { billing: 'disabled' } — d'où
// le type `| { billing: 'disabled' }` sur les payloads concernés.
// ============================================================================

// Sentinelle renvoyée par toute route admin billing quand billing_enabled()==False.
export interface BillingDisabled {
  billing: 'disabled'
}

// Vue admin d'un bot d'un payeur (sous-objet de AdminPayer).
export interface AdminPayerBot {
  bot_id: number
  name: string
  scope: 'personal' | 'team'
  modules: string[]
  ai_monthly_quota: number | null
  status: string
  source: string
}

// Un payeur (client facturé) vu côté admin.
export interface AdminPayer {
  user_id: number
  email: string
  name: string
  stripe_customer_id: string | null
  status: 'active' | 'past_due' | 'none'
  monthly_cents: number
  subscription_count: number
  bots: AdminPayerBot[]
}

// GET /api/admin/billing/overview — agrégat des payeurs + MRR total.
export interface AdminBillingOverview {
  currency: 'eur'
  mrr_cents: number
  payers: AdminPayer[]
}

// GET /api/admin/bots/{bot_id}/entitlement — ligne bot_entitlements projetée.
// POST .../entitlement renvoie le même objet (état après upsert source='staff').
export interface AdminBotEntitlement {
  bot_id: number
  modules: string[]
  ai_monthly_quota: number | null
  overage_mode: string
  status: string
  source: string
}

// Une ligne du CATALOGUE (table billing_products) vue/éditée côté superadmin.
// GET /api/admin/billing/catalog renvoie un TABLEAU bare de ces objets — TOUJOURS
// les lignes locales, même billing OFF (pour visualiser/éditer le local). PATCH
// /catalog/{code} (label/is_active/included_replies) et POST /catalog/{code}/price
// (changement de prix : nouveau Price Stripe + désactivation de l'ancien) renvoient
// chacun le CatalogProduct mis à jour. Aligné strictement sur le schéma serveur (snake_case).
//   - `unit_amount`     : montant en CENTIMES (pas d'euros côté logique).
//   - `included_replies`: réponses IA incluses — pertinent pour kind='ai_tier' (sinon null).
//   - `stripe_*`        : null tant que le produit n'a pas été poussé à Stripe (billing OFF/jamais sync).
export interface CatalogProduct {
  code: string
  label: string
  kind: 'base' | 'ai_tier' | 'module' | 'metered'
  unit_amount: number
  currency: string
  interval: string
  included_replies: number | null
  is_active: boolean
  stripe_product_id: string | null
  stripe_price_id: string | null
}
