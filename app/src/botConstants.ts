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
