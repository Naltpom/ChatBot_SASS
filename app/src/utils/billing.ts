// Utilitaires de facturation côté front : SEULES les CLÉS de module (alignées
// sur le backend) + le calcul de panier PUR vivent ici. AUCUN prix, % de remise
// ni plafond n'est codé en dur : la SOURCE UNIQUE du catalogue (prix, paliers IA,
// remises intro, plafonds, libellés) est GET /api/billing/catalog (cf. backend
// _catalog_payload). Les pages chargent ce catalogue et affichent un état de
// chargement/erreur tant qu'il n'est pas là — pas de copie de prix locale.
//
// Ce qui RESTE ici :
//   - MODULE_KEYS / MODULE_TO_CODE : les CLÉS d'entitlement (D4), alignées sur
//     core/constants.MODULE_KEYS et couvertes par le test de parité
//     (e2e/tests/billing-catalog-parity.spec.ts) — toute dérive casse le test ;
//   - computeCart / deriveConfigFromChat : logique PURE qui prend le `catalog`
//     (source = backend) en argument et fait confiance au backend pour le montant.
import type { BillingCatalog, BotConfig, ModuleKey } from '../types/billing'

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
