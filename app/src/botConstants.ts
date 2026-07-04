// Constantes partagées.
import type { DesignJson } from './types/bot'

// Modèles proposés en radio-cards.
export interface ModelOption {
  provider: string
  model: string
  name: string
  desc: string
  recommended?: boolean
}

export const MODEL_OPTIONS: ModelOption[] = [
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', name: 'Claude Haiku', desc: 'Rapide et économique — FAQ simples' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', name: 'Claude Sonnet', desc: 'Meilleur équilibre qualité/rapidité', recommended: true },
  { provider: 'openai', model: 'gpt-4o-mini', name: 'GPT-4o mini', desc: 'Alternative OpenAI' },
  { provider: 'gemini', model: 'gemini-2.5-flash', name: 'Gemini Flash', desc: 'Alternative Google' },
]

export function findModelOption(provider: string, model: string) {
  return MODEL_OPTIONS.find(m => m.provider === provider && m.model === model)
}

// Captcha — encarts RGPD : chaque option documente son flux de données.
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
    desc: 'Pour les réseaux internes et environnements fermés.',
    rgpd: 'Le widget public est plus exposé aux bots — gardez une protection anti-abus active.',
    rgpdTone: 'danger' as const,
  },
]

// Couleurs proposées au CLIENT FINAL pour personnaliser SON widget (theme.js)
export const WIDGET_BRAND_COLORS = ['#0d9488', '#4f46e5', '#ea580c', '#0f172a', '#be185d', '#0e7490']
export const GRADIENT_SECOND_COLORS = ['#7c2d92', '#4f46e5', '#0d9488', '#0f172a', '#e11d48', '#f59e0b']

// Presets de thèmes du widget (AppearanceForm) : un clic = merge PARTIEL de
// `values` dans design_json — les clés non listées (taille, offsets, textes…)
// sont conservées. Sélection affichée si toutes les clés de `values` matchent.
export interface AppearancePreset {
  id: string
  name: string
  values: Record<string, any>
}

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  { id: 'menthe', name: 'Menthe', values: { primaryColor: '#0d9488', secondaryColor: null, headerStyle: 'solid', darkMode: false, bubbleStyle: 'rounded', font: 'system', bordered: false, loadingAnimation: 'dots' } },
  { id: 'crepuscule', name: 'Crépuscule', values: { primaryColor: '#4f46e5', secondaryColor: '#be185d', headerStyle: 'solid', darkMode: false, bubbleStyle: 'rounded', font: 'system', bordered: false, loadingAnimation: 'wave' } },
  { id: 'nuit', name: 'Nuit', values: { primaryColor: '#0d9488', secondaryColor: null, headerStyle: 'solid', darkMode: true, bubbleStyle: 'rounded', font: 'system', bordered: false, loadingAnimation: 'pulse' } },
  { id: 'corail', name: 'Corail', values: { primaryColor: '#ea580c', secondaryColor: '#f59e0b', headerStyle: 'solid', darkMode: false, bubbleStyle: 'rounded', font: 'system', bordered: true, loadingAnimation: 'dots' } },
  { id: 'encre', name: 'Encre', values: { primaryColor: '#0f172a', secondaryColor: null, headerStyle: 'soft', darkMode: false, bubbleStyle: 'square', font: 'serif', bordered: false, loadingAnimation: 'dots' } },
  { id: 'amethyste', name: 'Améthyste', values: { primaryColor: '#7c2d92', secondaryColor: '#4f46e5', headerStyle: 'soft', darkMode: true, bubbleStyle: 'rounded', font: 'system', bordered: false, loadingAnimation: 'wave' } },
]

// « Surprends-moi » (AppearanceForm, section Thème) : randomise UNIQUEMENT des
// clés déjà sûres/bornées côté serveur, pour ne jamais produire un design
// invalide. Renvoie un patch partiel mergé tel quel dans design_json.
export function surpriseDesign(): Partial<DesignJson> {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]
  const withGradient = Math.random() < 0.5
  return {
    primaryColor: pick(WIDGET_BRAND_COLORS),
    secondaryColor: withGradient ? pick(GRADIENT_SECOND_COLORS) : null,
    borderRadius: 4 + Math.floor(Math.random() * 21), // [4,24]
    font: pick(['system', 'serif', 'mono'] as const),
    headerStyle: pick(['solid', 'soft', 'gradient'] as const),
    darkMode: Math.random() < 0.5,
    bubbleStyle: pick(['rounded', 'square'] as const),
    icon: pick(['chat', 'spark', 'help', 'bot', 'message', 'headset', 'smile', 'zap'] as const),
    loadingAnimation: pick(['dots', 'wave', 'pulse', 'bars', 'ring', 'typing'] as const),
    launcherShape: pick(['round', 'pill', 'square'] as const),
    chatBg: pick(['plain', 'soft', 'pattern'] as const),
  }
}

// Galerie de modèles d'actions IA (onglet Actions de BotPage) — données
// FRONTEND uniquement (décision actée, rien côté backend) : « Utiliser » copie
// `action` telle quelle dans l'éditeur, le client ajuste l'URL ou l'email avant
// d'enregistrer. Les urls https://votre-site.com/... et les blurbs sont
// volontairement DISTINCTS des placeholders/hints assertés par actions.spec.
export interface ActionTemplate {
  id: string
  label: string
  blurb: string
  action: Record<string, any>
}

export const ACTION_TEMPLATES: ActionTemplate[] = [
  {
    id: "suivi_commande", label: "Suivi de commande",
    blurb: "L'IA interroge votre API via un webhook signé pour donner le statut d'une commande.",
    action: {
      name: "suivi_commande", type: "webhook",
      description: "Récupère le statut d'une commande à partir de son numéro. À utiliser quand le visiteur demande où en est sa commande ou sa livraison.",
      url: "https://votre-site.com/api/chatbot/commande",
      fields: [
        { name: "numero_commande", type: "string", description: "Numéro de commande communiqué par le visiteur", required: true },
        { name: "email", type: "string", description: "Email associé à la commande (vérification)", required: false },
      ],
    },
  },
  {
    id: "magasin_proche", label: "Magasin le plus proche",
    blurb: "L'IA trouve le point de vente le plus proche via votre API.",
    action: {
      name: "magasin_proche", type: "webhook",
      description: "Trouve le magasin ou point de vente le plus proche d'une ville ou d'un code postal donné par le visiteur.",
      url: "https://votre-site.com/api/chatbot/magasins",
      fields: [
        { name: "ville", type: "string", description: "Ville indiquée par le visiteur", required: false },
        { name: "code_postal", type: "string", description: "Code postal indiqué par le visiteur", required: false },
      ],
    },
  },
  {
    id: "demande_devis", label: "Demande de devis",
    blurb: "L'IA qualifie le besoin et ouvre un ticket envoyé par email à votre équipe.",
    action: {
      name: "demande_devis", type: "create_ticket",
      description: "Ouvre une demande de devis quand le visiteur souhaite un chiffrage : recueille le besoin, le budget éventuel et ses coordonnées avant d'appeler cette action.",
      // to_email volontairement ABSENT : clé absente = ticket envoyé aux admins
      // de l'organisation (le serveur rejette la chaîne vide en 422)
    },
  },
  {
    id: "statut_incident", label: "Statut d'incident",
    blurb: "L'IA vérifie l'état de vos services ou d'un ticket d'incident via webhook.",
    action: {
      name: "statut_incident", type: "webhook",
      description: "Donne le statut courant d'un incident ou d'une panne signalée. À utiliser quand le visiteur demande si un problème est connu ou résolu.",
      url: "https://votre-site.com/api/chatbot/incidents",
      fields: [
        { name: "reference_incident", type: "string", description: "Référence de l'incident si le visiteur en a une", required: false },
      ],
    },
  },
]

