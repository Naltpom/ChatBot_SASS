// Constantes partagées — wording porté du prototype Chapote.

// Modèles proposés en radio-cards (design pages-bot.jsx).
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
  { provider: 'gemini', model: 'gemini-2.0-flash', name: 'Gemini Flash', desc: 'Alternative Google' },
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

// Templates d'arbres sectoriels (wizard, étape Arbre) : FR, ≤10 bulles (plan
// free), sans __ai__, nœuds typés lead/appointment, boucles vers l'accueil.
export interface TreeTemplate { id: string; label: string; blurb: string; tree: Record<string, any> }
export const TREE_TEMPLATES: TreeTemplate[] = [
  {
    id: 'ecommerce', label: 'E-commerce',
    blurb: 'Suivi de commande, livraison et retours, alerte de stock, service client.',
    tree: {
      start: 'root',
      nodes: {
        root: {
          message: 'Bonjour et bienvenue ! Que pouvons-nous faire pour vous ?',
          options: [
            { label: 'Suivre ma commande', next: 'commande' },
            { label: 'Livraison & retours', next: 'livraison' },
            { label: 'Nos produits', next: 'produits' },
            { label: 'Parler au service client', next: 'contact' },
          ],
        },
        commande: {
          message: 'Indiquez-nous votre numéro de commande et votre email : nous revenons vers vous rapidement.',
          type: 'lead', fields: ['email', 'name', 'message'],
          options: [{ label: '↩ Retour au menu', next: 'root' }],
        },
        livraison: {
          message: 'Livraison en France métropolitaine sous 2 à 4 jours ouvrés (offerte dès 60 €). Retours gratuits sous 30 jours.',
          options: [
            { label: 'Comment faire un retour ?', next: 'retour' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        retour: {
          message: 'Depuis votre compte : Mes commandes > Demander un retour. Une étiquette prépayée vous est envoyée par email.',
          options: [
            { label: 'Contacter le service client', next: 'contact' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        produits: {
          message: 'Que cherchez-vous ?',
          options: [
            { label: 'Guide des tailles', next: 'tailles' },
            { label: "Disponibilité d'un article", next: 'dispo' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        tailles: {
          message: 'Nos vêtements taillent normalement. Le guide détaillé est sur chaque fiche produit, onglet « Tailles ».',
          options: [{ label: '↩ Retour au menu', next: 'root' }],
        },
        dispo: {
          message: "Indiquez l'article recherché et votre email : nous vous prévenons dès son retour en stock.",
          type: 'lead', fields: ['email', 'message'],
          options: [{ label: '↩ Retour au menu', next: 'root' }],
        },
        contact: {
          message: 'Notre équipe vous répond sous 24 h ouvrées. Laissez-nous vos coordonnées.',
          type: 'lead', fields: ['email', 'name', 'phone', 'message'],
          options: [{ label: '↩ Retour au menu', next: 'root' }],
        },
      },
    },
  },
  {
    id: 'cabinet', label: 'Cabinet & services',
    blurb: 'Prise de rendez-vous en ligne, prestations, honoraires, rappel téléphonique.',
    tree: {
      start: 'root',
      nodes: {
        root: {
          message: 'Bonjour, bienvenue au cabinet. Comment pouvons-nous vous aider ?',
          options: [
            { label: 'Prendre rendez-vous', next: 'rdv' },
            { label: 'Nos prestations', next: 'prestations' },
            { label: 'Honoraires', next: 'honoraires' },
            { label: 'Nous écrire', next: 'contact' },
          ],
        },
        rdv: {
          message: 'Choisissez directement un créneau dans notre agenda en ligne.',
          type: 'appointment', url: 'https://calendly.com/votre-cabinet/premier-rendez-vous',
          options: [{ label: '↩ Retour au menu', next: 'root' }],
        },
        prestations: {
          message: 'Quel domaine vous concerne ?',
          options: [
            { label: 'Particuliers', next: 'particuliers' },
            { label: 'Entreprises', next: 'entreprises' },
          ],
        },
        particuliers: {
          message: 'Nous accompagnons les particuliers : famille, immobilier, succession… Décrivez votre situation, nous vous rappelons.',
          options: [
            { label: 'Être rappelé(e)', next: 'contact' },
            { label: 'Prendre rendez-vous', next: 'rdv' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        entreprises: {
          message: 'Nous conseillons les entreprises : création, contrats, contentieux, social. Un premier échange permet de cadrer votre besoin.',
          options: [
            { label: 'Prendre rendez-vous', next: 'rdv' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        honoraires: {
          message: "Premier rendez-vous d'évaluation : 80 € TTC. Ensuite, devis au forfait ou au temps passé — toujours validé avant d'engager quoi que ce soit.",
          options: [
            { label: 'Prendre rendez-vous', next: 'rdv' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        contact: {
          message: 'Laissez-nous vos coordonnées et quelques mots sur votre besoin : nous vous recontactons sous 24 h.',
          type: 'lead', fields: ['email', 'name', 'phone', 'message'],
          options: [{ label: '↩ Retour au menu', next: 'root' }],
        },
      },
    },
  },
  {
    id: 'restaurant', label: 'Restaurant',
    blurb: 'Réservation de table, horaires, carte, allergies, privatisation.',
    tree: {
      start: 'root',
      nodes: {
        root: {
          message: 'Bienvenue ! Une envie, une question ?',
          options: [
            { label: 'Réserver une table', next: 'reserver' },
            { label: 'Horaires & adresse', next: 'infos' },
            { label: 'La carte', next: 'carte' },
            { label: 'Privatiser / groupes', next: 'groupes' },
          ],
        },
        reserver: {
          message: 'Réservez votre table en ligne en quelques clics.',
          type: 'appointment', url: 'https://calendly.com/votre-restaurant/reservation',
          options: [{ label: '↩ Retour au menu', next: 'root' }],
        },
        infos: {
          message: 'Ouvert du mardi au samedi, 12h-14h et 19h-22h30. 12 rue des Halles, 75001 Paris — métro Châtelet.',
          options: [
            { label: 'Réserver une table', next: 'reserver' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        carte: {
          message: 'Notre carte change avec les saisons : entrées 9-14 €, plats 19-28 €, menu déjeuner 24 €.',
          options: [
            { label: 'Allergies & régimes', next: 'allergies' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        allergies: {
          message: 'Signalez vos allergies à la réservation : la cuisine adapte la plupart des plats (options végétariennes et sans gluten chaque jour).',
          options: [
            { label: 'Réserver une table', next: 'reserver' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        groupes: {
          message: "Salle privatisable jusqu'à 30 personnes, menus groupes à partir de 35 €. Parlez-nous de votre événement.",
          type: 'lead', fields: ['email', 'name', 'phone', 'message'],
          options: [{ label: '↩ Retour au menu', next: 'root' }],
        },
      },
    },
  },
  {
    id: 'saas', label: 'SaaS & logiciel',
    blurb: 'Découverte produit, tarifs, support technique, prise de démo.',
    tree: {
      start: 'root',
      nodes: {
        root: {
          message: 'Bonjour ! Comment pouvons-nous vous aider ?',
          options: [
            { label: 'Découvrir le produit', next: 'produit' },
            { label: 'Tarifs', next: 'tarifs' },
            { label: 'Support technique', next: 'support' },
            { label: 'Demander une démo', next: 'demo' },
          ],
        },
        produit: {
          message: 'Notre plateforme automatise votre quotidien : mise en place en quelques minutes, essai sans carte bancaire.',
          options: [
            { label: 'Demander une démo', next: 'demo' },
            { label: 'Voir les tarifs', next: 'tarifs' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        tarifs: {
          message: 'Essai gratuit 14 jours, puis à partir de 29 €/mois. Tous les détails sont sur notre page Tarifs.',
          options: [
            { label: 'Demander une démo', next: 'demo' },
            { label: 'Question sur la facturation', next: 'facturation' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        facturation: {
          message: 'Facturation mensuelle ou annuelle (-20 %), paiement CB ou virement, factures téléchargeables depuis votre espace.',
          options: [
            { label: "Écrire à l'équipe", next: 'support' },
            { label: '↩ Retour au menu', next: 'root' },
          ],
        },
        support: {
          message: "Décrivez votre demande (bug, question technique, facturation) : l'équipe vous répond rapidement par email.",
          type: 'lead', fields: ['email', 'message'],
          options: [{ label: '↩ Retour au menu', next: 'root' }],
        },
        demo: {
          message: 'Réservez une démo de 30 minutes avec un expert produit.',
          type: 'appointment', url: 'https://calendly.com/votre-equipe/demo-30min',
          options: [{ label: '↩ Retour au menu', next: 'root' }],
        },
      },
    },
  },
]

