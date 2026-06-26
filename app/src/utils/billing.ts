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
  'mcp',
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
  mcp: 'mod_mcp',
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
    requires: ['ai'], // RAG est piloté par l'IA (recherche documentaire dans la réponse).
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
    label: 'Actions',
    short: 'Actions',
    desc: 'Webhooks, capture de leads, tickets, créneaux — exécutables dans un arbre, sans IA.',
    price_cents: 1200,
    // PAS de requires : les actions tournent aussi dans un arbre pur (sans IA).
  },
  {
    key: 'mcp',
    label: 'MCP (outils IA)',
    short: 'MCP',
    desc: "Serveurs/outils MCP appelés par l'IA pendant la conversation.",
    price_cents: 900,
    requires: ['ai'], // MCP n'a de sens qu'avec l'IA (c'est elle qui appelle les outils).
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

// Paliers IA managés (kind='ai_tier'). Choisir un palier active le module 'ai'.
// Plus de palier 'ai_free' : l'IA gratuite à vie est supprimée (point 7).
const FALLBACK_AI_TIERS: AiTier[] = [
  { id: 'ai_starter', included_replies: 1000, price_cents: 1900, desc: 'Pour démarrer : volume confortable pour un petit site.' },
  { id: 'ai_growth', included_replies: 3000, price_cents: 3900, desc: 'Trafic régulier : marge pour un site actif.' },
  { id: 'ai_scale', included_replies: 10000, price_cents: 8900, desc: 'Gros volume : forte audience et pics de demandes.' },
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
    est_price_cents: 7500, // 3900 + 900 (rag) + 1500 (inbox) + 1200 (actions)
  },
  {
    key: 'service_client',
    label: 'Sur-mesure / Volume',
    tagline: 'Tous les modules, gros volume de réponses.',
    modules: ['rag', 'inbox', 'actions', 'ab', 'white_label'],
    ai_tier_id: 'ai_scale',
    est_price_cents: 14100, // 8900 + 900 (rag) + 1500 (inbox) + 1200 (actions) + 700 (ab) + 900 (wl)
  },
]

// Catalogue de secours, structurellement identique à GET /api/billing/catalog.
// À n'utiliser qu'à défaut de réponse backend (le backend reste la vérité prix).
export const FALLBACK_CATALOG: BillingCatalog = {
  currency: 'eur',
  base_price_cents: 0,
  base_description: 'Arbre de conversation, apparence, déclencheurs et analytics — inclus.',
  modules: FALLBACK_MODULES,
  ai_tiers: FALLBACK_AI_TIERS,
  // Prix unitaire du dépassement IA métré (mtr_ai) : 1,5 centime = 0,015 € par
  // réponse au-delà du quota. Le dépassement existe désormais EN OPTION (toggle
  // owner par bot, défaut 'block') — il n'est jamais facturé sans activation
  // explicite et n'est pas une ligne d'abonnement fixe (hors computeCart).
  overage_cents_per_reply: 1.5,
  tax_note: 'TVA non applicable, art. 293 B du CGI',
  presets: FALLBACK_PRESETS,
  // Miroir des % d'intro (parité backend INTRO_PERCENT_*). 'default' = IA off/BYOK.
  intro_discounts: { default: 45, ai_starter: 50, ai_growth: 65, ai_scale: 80 },
  // Plafond de dépassement IA par défaut (réponses/mois) — parité OVERAGE_CAP_DEFAULT.
  overage_cap_default: 1000,
  version: 'fallback-2026-06-20',
}

// --- Dérivation config recommandée depuis le chat (PUR) ------------------------
//
// Le premier chat (« l'assistant de vos rêves ») PRÉ-CONFIGURE l'abonnement :
// l'étape 'plan' arrive PRÉ-REMPLIE (preset + modules cochés), ajustable. Fin de
// la double saisie (chat puis from-scratch).
//
// RÈGLE de dérivation (simple et robuste), évaluée sur les réponses du chat
// (objectifs cochés + repli) :
//   - support / conseiller (repli 'human' ou 'both')           -> module 'inbox'
//   - FAQ / documents / connaissances (objectif 'faq')         -> module 'rag'
//   - rendez-vous / commande / devis / leads
//     (objectifs 'rdv' | 'orders' | 'leads')                   -> module 'actions'
//   - IA voulue (repli 'ia' ou 'both')                         -> module 'ai' + palier managé
//   - sinon : arbre seul (aucun module payant, pas de plan IA).
//
// Le palier IA managé choisi suit le VOLUME implicite : on prend le palier du
// preset le plus proche s'il est connu, sinon le 1er palier payant du catalogue.
// La config dérivée passe par withRequires côté configurateur (dépendances).
export interface WizardSignals {
  goals: string[]                 // objectifs cochés ('faq' | 'orders' | 'leads' | 'rdv' | 'horaires')
  wantsAi: boolean                // repli 'ia' ou 'both'
  wantsHuman: boolean             // repli 'human' ou 'both'
}

// Palier IA managé recommandé : 1er palier > 0 €, sinon 1er disponible (jamais
// 'ai_free' — supprimé). null si le catalogue n'expose aucun palier.
function recommendedManagedTier(catalog: BillingCatalog): string | null {
  return catalog.ai_tiers.find(t => t.price_cents > 0)?.id ?? catalog.ai_tiers[0]?.id ?? null
}

// deriveConfigFromChat : traduit les signaux du chat en BotConfig recommandé.
// FONCTION PURE. Ne coche que des modules présents dans le catalogue (robustesse).
export function deriveConfigFromChat(catalog: BillingCatalog, sig: WizardSignals): BotConfig {
  const present = new Set(catalog.modules.map(m => m.key))
  const modules: ModuleKey[] = []
  const add = (k: ModuleKey) => { if (present.has(k) && !modules.includes(k)) modules.push(k) }

  // Conseiller humain -> Inbox / live chat.
  if (sig.wantsHuman) add('inbox')
  // FAQ / connaissances -> RAG.
  if (sig.goals.includes('faq')) add('rag')
  // Rendez-vous, suivi de commande, devis, capture de contacts -> Actions.
  if (sig.goals.includes('rdv') || sig.goals.includes('orders') || sig.goals.includes('leads')) add('actions')

  let ai_tier_id: string | null = null
  if (sig.wantsAi) {
    add('ai')
    ai_tier_id = recommendedManagedTier(catalog)
  }

  return { modules, ai_tier_id, ai_byok: false }
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
