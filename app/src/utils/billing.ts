// Utilitaires de facturation côté front : miroir LISIBLE du catalogue figé
// (spec §2.2) + calcul de panier PUR. Le miroir sert deux choses :
//   1. fallback/typage local (labels, clés) avant que GET /api/billing/catalog ne
//      réponde ;
//   2. PARITÉ : les clés exposées ici sont alignées sur MODULE_KEYS (D4) et les
//      codes catalogue (mod_*) du backend — toute dérive est un bug (cf. F5).
//
// AUCUN prix n'est codé en dur dans la LOGIQUE : computeCart prend le `catalog`
// (source = backend) en argument et fait confiance au backend pour le montant
// final (Stripe). Les centimes du miroir ci-dessous ne servent qu'au fallback /
// affichage hors-ligne, jamais à valider un paiement.
//
// Catalogue figé 2026-06-20 (spec §2.2). Socle gratuit => base = 0. Pas de TVA
// (franchise en base, art. 293 B du CGI).
import type {
  AiTier,
  BillingCatalog,
  BotConfig,
  CatalogModule,
  CatalogPreset,
  ModuleKey,
} from '../types/billing'

// Ordre canonique des clés de module — DOIT correspondre à core/constants.MODULE_KEYS.
// (parité front/back vérifiée par le test de parité ; ne pas réordonner sans le backend.)
export const MODULE_KEYS: readonly ModuleKey[] = [
  'ai',
  'inbox',
  'rag',
  'actions',
  'ab',
  'white_label',
]

// Mapping clé d'entitlement -> code catalogue (billing_products.code) du backend.
// 'ai' a deux variantes côté catalogue (plan managé `ai_*` vs `mod_ai_byok`) ; le
// module facturé en add-on forfaitaire pour les autres clés porte le préfixe mod_.
export const MODULE_TO_CODE: Record<Exclude<ModuleKey, 'ai'>, string> = {
  inbox: 'mod_inbox',
  rag: 'mod_rag',
  actions: 'mod_actions',
  ab: 'mod_ab',
  white_label: 'mod_whitelabel',
}

// --- Miroir front du catalogue (fallback/affichage uniquement) -----------------

// Modules add-on (kind='module'). Le module 'ai' est exposé à part (paliers + BYOK).
const FALLBACK_MODULES: CatalogModule[] = [
  {
    key: 'ai',
    label: 'Intelligence artificielle',
    short: 'IA',
    desc: 'Réponses générées par IA (quota mensuel). BYOK = clé du client, illimité.',
    price_cents: 0, // le prix IA est porté par le palier (ai_tiers) ou la variante BYOK
    byok_price_cents: 2900,
  },
  {
    key: 'rag',
    label: 'Connaissances (RAG)',
    short: 'RAG',
    desc: 'Base de connaissances : ingestion de sources et recherche documentaire.',
    price_cents: 900,
  },
  {
    key: 'inbox',
    label: 'Live chat / Inbox',
    short: 'Inbox',
    desc: 'Transfert à un conseiller humain et boîte de réception des conversations.',
    price_cents: 1500,
  },
  {
    key: 'actions',
    label: 'Actions & MCP',
    short: 'Actions',
    desc: 'Webhooks, capture de leads, connecteurs MCP exécutés par le bot.',
    price_cents: 1900,
  },
  {
    key: 'ab',
    label: 'A/B testing',
    short: 'A/B',
    desc: "Deux variantes d'arbre servies selon un pourcentage de répartition.",
    price_cents: 700,
  },
  {
    key: 'white_label',
    label: 'White-label',
    short: 'White-label',
    desc: 'Retire la mention « Powered by » du widget.',
    price_cents: 900,
  },
]

// Paliers IA managés (kind='ai_tier'). Choisir >= starter active le module 'ai'.
const FALLBACK_AI_TIERS: AiTier[] = [
  { id: 'ai_free', included_replies: 50, price_cents: 0 },
  { id: 'ai_starter', included_replies: 1000, price_cents: 1900 },
  { id: 'ai_growth', included_replies: 3000, price_cents: 3900 },
  { id: 'ai_scale', included_replies: 10000, price_cents: 8900 },
]

// Présélections guidées (somme transparente des produits).
const FALLBACK_PRESETS: CatalogPreset[] = [
  {
    key: 'vitrine',
    label: 'Vitrine / FAQ',
    tagline: 'Un bot simple avec base de connaissances.',
    modules: ['rag'],
    ai_tier_id: 'ai_starter',
    est_price_cents: 2800, // 1900 + 900
  },
  {
    key: 'pro_ia_rag',
    label: 'Service client',
    tagline: 'IA, connaissances, conseiller humain et actions.',
    modules: ['rag', 'inbox', 'actions'],
    ai_tier_id: 'ai_growth',
    recommended: true,
    est_price_cents: 8200, // 3900 + 900 + 1500 + 1900
  },
  {
    key: 'service_client',
    label: 'Sur-mesure / Volume',
    tagline: 'Tous les modules, gros volume de réponses.',
    modules: ['rag', 'inbox', 'actions', 'ab', 'white_label'],
    ai_tier_id: 'ai_scale',
    est_price_cents: 14800, // 8900 + 900 + 1500 + 1900 + 700 + 900
  },
]

// Catalogue de secours, structurellement identique à GET /api/billing/catalog.
// À n'utiliser qu'à défaut de réponse backend (le backend reste la vérité prix).
export const FALLBACK_CATALOG: BillingCatalog = {
  currency: 'eur',
  base_price_cents: 0,
  modules: FALLBACK_MODULES,
  ai_tiers: FALLBACK_AI_TIERS,
  overage_cents_per_reply: 0, // v1 = blocage au quota (pas de dépassement facturé)
  tax_note: 'TVA non applicable, art. 293 B du CGI',
  presets: FALLBACK_PRESETS,
  version: 'fallback-2026-06-20',
}

// --- Calcul de panier (PUR) ----------------------------------------------------

// Une ligne de panier (façon facture). `cents` = prix unitaire mensuel.
export interface CartLine {
  key: string // module key | tier id | 'base'
  label: string
  cents: number
}

// Résultat du calcul : lignes détaillées + total, le tout en centimes.
export interface Cart {
  lines: CartLine[]
  total_cents: number
}

// computeCart : recompose le panier à partir du catalogue (source backend) et de
// la config choisie. FONCTION PURE — aucun effet de bord, déterministe, testable.
//
// Règles (spec §2.2) :
//  - le socle (base) est toujours présent, gratuit (0) ;
//  - le module 'ai' n'a JAMAIS de ligne propre : son prix vient du palier IA
//    (managé) OU de la variante BYOK (byok_price_cents). BYOK et palier managé
//    sont mutuellement exclusifs (BYOK l'emporte) ;
//  - les autres modules activés ajoutent leur price_cents ;
//  - on ne facture jamais une capacité gratuite (price_cents == 0 => ligne à 0).
export function computeCart(catalog: BillingCatalog, config: BotConfig): Cart {
  const lines: CartLine[] = []

  // Socle gratuit, toujours visible (transparence).
  lines.push({ key: 'base', label: 'Socle (arbre, apparence, triggers, analytics)', cents: catalog.base_price_cents })

  const aiModule = catalog.modules.find(m => m.key === 'ai')
  const wantsAi = config.modules.includes('ai')

  if (wantsAi) {
    if (config.ai_byok) {
      // Variante BYOK : forfait plateforme, bot non métré. Prix = byok_price_cents.
      const cents = aiModule?.byok_price_cents ?? 0
      lines.push({ key: 'ai_byok', label: 'IA — BYOK (clé du client, illimité)', cents })
    } else if (config.ai_tier_id) {
      // Plan IA managé : le palier porte le prix du moteur (quota inclus).
      const tier = catalog.ai_tiers.find(t => t.id === config.ai_tier_id)
      if (tier) {
        lines.push({
          key: tier.id,
          label: `IA — ${formatReplies(tier.included_replies)} réponses/mois`,
          cents: tier.price_cents,
        })
      }
    }
  }

  // Autres modules add-on (forfait on/off), dans l'ordre canonique du catalogue.
  for (const mod of catalog.modules) {
    if (mod.key === 'ai') continue // déjà traité via palier/BYOK
    if (!config.modules.includes(mod.key)) continue
    lines.push({ key: mod.key, label: mod.label, cents: mod.price_cents })
  }

  const total_cents = lines.reduce((sum, l) => sum + l.cents, 0)
  return { lines, total_cents }
}

// Format lisible d'un nombre de réponses (ex. 1000 -> « 1 000 », 10000 -> « 10 000 »).
function formatReplies(n: number): string {
  return n.toLocaleString('fr-FR')
}
