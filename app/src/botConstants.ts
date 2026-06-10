// Constantes partagées — wording porté du prototype Kertios Chat.

// Modèles proposés en radio-cards (design pages-bot.jsx), avec le multiplicateur
// de coût en crédits affiché en chip.
export interface ModelOption {
  provider: string
  model: string
  name: string
  desc: string
  price: string
  recommended?: boolean
}

export const MODEL_OPTIONS: ModelOption[] = [
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', name: 'Claude Haiku', desc: 'Rapide et économique — FAQ simples', price: '×0,5' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', name: 'Claude Sonnet', desc: 'Recommandé — meilleur équilibre qualité/coût', price: '×1', recommended: true },
  { provider: 'openai', model: 'gpt-4o-mini', name: 'GPT-4o mini', desc: 'Alternative OpenAI', price: '×0,6' },
  { provider: 'gemini', model: 'gemini-2.0-flash', name: 'Gemini Flash', desc: 'Alternative Google', price: '×0,5' },
]

export function findModelOption(provider: string, model: string) {
  return MODEL_OPTIONS.find(m => m.provider === provider && m.model === model)
}

// Captcha — wording + encarts RGPD du design (pages-security.jsx) :
// l'angle "compliance-ready", chaque option documente son flux de données.
export const CAPTCHA_OPTIONS = [
  {
    value: 'turnstile',
    name: 'Cloudflare Turnstile',
    tag: 'Défaut · recommandé',
    tagTone: 'go' as const,
    desc: 'Invisible, sans friction. Nos clés, zéro configuration.',
    rgpd: "L'adresse IP et des signaux navigateur sont transmis à Cloudflare Inc. pour vérification. Pas de cookie publicitaire. Sous-traitant : Cloudflare.",
    rgpdTone: 'go' as const,
  },
  {
    value: 'recaptcha_v3',
    name: 'reCAPTCHA v3',
    tag: 'Vos clés',
    tagTone: 'mut' as const,
    desc: 'Pour les sites déjà sous reCAPTCHA — dashboard unifié.',
    rgpd: 'Données transmises à Google LLC (IP, cookies, comportement). Nécessite une mention dans votre politique de confidentialité et potentiellement un consentement.',
    rgpdTone: 'warn' as const,
  },
  {
    value: 'disabled',
    name: 'Désactivé',
    tag: 'Environnements fermés',
    tagTone: 'mut' as const,
    desc: 'Pour les intranets et environnements fermés.',
    rgpd: 'Vos quotas vous protègent toujours, mais le widget est plus exposé aux bots.',
    rgpdTone: 'danger' as const,
  },
]

// Couleurs proposées au CLIENT FINAL pour personnaliser SON widget (theme.js)
export const WIDGET_BRAND_COLORS = ['#0d9488', '#4f46e5', '#ea580c', '#0f172a', '#be185d', '#0e7490']
export const GRADIENT_SECOND_COLORS = ['#7c2d92', '#4f46e5', '#0d9488', '#0f172a', '#e11d48', '#f59e0b']

export const PLAN_LABELS: Record<string, string> = { free: 'Free', starter: 'Starter', pro: 'Pro', agence: 'Agence' }

// Miroir frontend de PLANS (api/src/models/user.py) — à garder synchronisé.
// Wording aligné sur la landing (pages/Landing.tsx) : Starter 19 / Pro 39 / Agence 119.
export interface PlanInfo {
  key: string
  label: string
  price: number              // €/mois
  aiMessages: number         // quota mensuel de réponses IA
  maxBots: number
  treeOnly: boolean
  maxTreeNodes: number | null
  desc: string
  features: string[]
  popular?: boolean
}

export const PLANS_INFO: PlanInfo[] = [
  {
    key: 'free', label: 'Free', price: 0, aiMessages: 0, maxBots: 1, treeOnly: true, maxTreeNodes: 10,
    desc: 'Découverte — arbre de décision seul, sans IA.',
    features: ['1 chatbot', 'Mode arbre uniquement', '10 bulles max dans l\'arbre', 'Réponses arbre illimitées'],
  },
  {
    key: 'starter', label: 'Starter', price: 19, aiMessages: 500, maxBots: 1, treeOnly: false, maxTreeNodes: null,
    desc: 'L\'IA sur votre site, pour démarrer.',
    features: ['1 chatbot', '500 réponses IA / mois', 'Réponses arbre illimitées', 'Stats essentielles'],
  },
  {
    key: 'pro', label: 'Pro', price: 39, aiMessages: 2000, maxBots: 3, treeOnly: false, maxTreeNodes: null,
    desc: 'Plusieurs bots, équipe et permissions.', popular: true,
    features: ['3 chatbots', '2 000 réponses IA / mois', 'Équipe & permissions', 'Cap budget configurable'],
  },
  {
    key: 'agence', label: 'Agence', price: 119, aiMessages: 10000, maxBots: 10, treeOnly: false, maxTreeNodes: null,
    desc: 'Pour gérer les bots de plusieurs clients.',
    features: ['10 chatbots', '10 000 réponses IA / mois', 'BYOK (vos clés API)', 'Support prioritaire'],
  },
]
