// Données & primitives partagées de la landing « Chapote ».
// Tout le contenu statique (scénarios du hero, étapes du storytelling,
// comparatif, nav, footer, tokens typographiques, icônes) vit ici pour alléger
// les sous-composants présentationnels. Aucune logique d'état.
import { API_URL } from '../../api'

export const CLASH = "'Clash Display',sans-serif"
export const JAKARTA = "'Plus Jakarta Sans',sans-serif"
export const MONO = "'JetBrains Mono',monospace"

// Courbe d'easing commune à toutes les entrées animées de la landing.
export const EASE = 'cubic-bezier(.2,.8,.2,1)'

// Palette des trois guichets (arbre / IA / humain) : teinte vive + teinte foncée
// lisible sur fond clair.
export const GREEN = '#2F9E79'
export const GREEN_DARK = '#1C7A5C'
export const VIOLET = '#8C6DFF'
export const VIOLET_DARK = '#6B4FD8'
export const CORAL = '#E86A5F'
export const CORAL_DARK = '#C24E44'

// Sur-titre de section en mono capitales, précédé d'un trait coloré.
export const Kicker = ({ color, children, dark }: { color: string; children: React.ReactNode; dark?: boolean }) => (
  <div style={{ fontFamily: MONO, fontSize: 12.5, letterSpacing: '.08em', color: dark ? '#A8C0D0' : '#6B7B8D', display: 'flex', gap: 14, alignItems: 'center' }}>
    <span style={{ width: 32, height: 2, background: color, flexShrink: 0, transition: 'background .5s' }} />{children}
  </div>
)
// Titre de section (Coûts, Installation, Comparatif, Tarifs).
export const sectionH2: React.CSSProperties = { fontFamily: CLASH, fontWeight: 600, fontSize: 'clamp(38px,4.6vw,62px)', lineHeight: 1, letterSpacing: '-.03em', color: '#1E2A32', margin: '22px 0 0' }
// Paragraphe d'introduction sous un titre de section.
export const lead = { fontSize: 18, lineHeight: 1.6, color: '#4A5A68', margin: '24px 0 0', maxWidth: 520, textWrap: 'pretty' } as React.CSSProperties

// Boutons CTA réutilisés par plusieurs pages (landing, à propos).
export const btnPrimary: React.CSSProperties = { background: '#1C3F5C', color: '#fff', border: 'none', borderRadius: 12, padding: '16px 26px', fontWeight: 600, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }
export const btnSecondary: React.CSSProperties = { background: '#fff', color: '#1C3F5C', border: '1px solid #D8DEE6', borderRadius: 12, padding: '15px 24px', fontWeight: 600, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 9 }
// Lien souligné « Voir comment ça marche ».
export const btnUnderline: React.CSSProperties = { fontWeight: 600, fontSize: 16, color: '#1C3F5C', borderBottom: '2px solid #1C3F5C', paddingBottom: 3, textDecoration: 'none' }

// Le widget lit l'attribut `data-bot-key` (clé publique pk_…) et se charge
// depuis `{API_URL}/widget.js`. On reproduit fidèlement le `script_tag`
// renvoyé par GET /api/bots/{id}/embed (api/src/routers/bots.py). La clé est
// un exemple : l'utilisateur récupère la sienne dans l'onglet Intégration.
export const WIDGET_SRC = `${API_URL}/widget.js`
export const EXAMPLE_BOT_KEY = 'pk_votre_cle'
export const SNIPPET = `<script src="${WIDGET_SRC}" data-bot-key="${EXAMPLE_BOT_KEY}" defer></script>`
// Même balise, découpée en jetons colorés pour l'effet « tapé » de l'installation.
// La concaténation des textes doit rester strictement égale à SNIPPET.
export const SNIPPET_TOKENS: [string, string][] = [
  ['<', '#8A98A6'], ['script', '#B9A6FF'], [' src', '#7FE3BE'], ['=', '#8A98A6'], [`"${WIDGET_SRC}"`, '#A8D8C5'],
  [' data-bot-key', '#7FE3BE'], ['=', '#8A98A6'], [`"${EXAMPLE_BOT_KEY}"`, '#A8D8C5'], [' defer', '#7FE3BE'], ['></', '#8A98A6'], ['script', '#B9A6FF'], ['>', '#8A98A6'],
]

export const HatIcon = ({ size = 20, stroke = 'currentColor', w = 1.7 }: { size?: number; stroke?: string; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" stroke={stroke} strokeWidth={w} strokeLinecap="round" />
    <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
export const SendIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
export const Check = ({ stroke = GREEN, w = 2.2, size = 16 }: { stroke?: string; w?: number; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10.5" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" /></svg>
)

// ── Hero « Aiguillage » ─────────────────────────────────────────────────────
// Trois questions de visiteurs sur trois sites clients FICTIFS, chacune réglée
// par un guichet différent (route 0 = arbre, 1 = IA, 2 = humain).
export type Scenario = { site: string; q: string; route: 0 | 1 | 2; a: string; tag: string }
export const SCENARIOS: Scenario[] = [
  { site: 'atelier-brume.fr', q: 'Vous livrez en Belgique ?', route: 0, a: 'Oui ! Livraison en 3 à 5 jours ouvrés, offerte dès 60 €.', tag: 'Arbre · 0 crédit IA' },
  { site: 'cabinet-morel.fr', q: 'Je suis auto-entrepreneur, vous gérez la TVA ?', route: 1, a: 'Oui : déclarations de TVA et bilan sont inclus dans la formule Micro.', tag: 'IA · d’après votre page Tarifs' },
  { site: 'garage-du-pont.fr', q: 'Ça grince quand je freine, c’est grave ?', route: 2, a: 'Mieux vaut vérifier vite. Je vous propose demain 9 h, ça vous va ?', tag: 'Thomas · atelier, en direct' },
]
export type Route = { k: string; c: string; dark: string; idle: string; checking: string; fail: string }
export const ROUTES: Route[] = [
  { k: 'Arbre', c: GREEN, dark: GREEN_DARK, idle: 'Illimité, gratuit', checking: 'Je cherche dans l’arbre…', fail: 'Pas dans l’arbre' },
  { k: 'IA', c: VIOLET, dark: VIOLET_DARK, idle: 'Plafonnée', checking: 'L’IA lit vos contenus…', fail: 'Hors de son périmètre' },
  { k: 'Humain', c: CORAL, dark: CORAL_DARK, idle: 'Quand ça compte', checking: 'J’appelle un conseiller…', fail: '' },
]

// ── « Ce qu'est Chapote » : les trois approches à source unique ─────────────
export const SINGLE_SOURCE: { k: string; d: string }[] = [
  { k: 'Arbre seul', d: 'Rapide et gratuit, mais muet dès qu’on sort des boutons.' },
  { k: 'IA seule', d: 'Répond à tout, mais facture tout, même les questions simples.' },
  { k: 'Conseillers seuls', d: 'Justes et humains, mais pas disponibles à 23 h ni pour 200 demandes.' },
]

// ── « Pourquoi Chapote » : moins cher / plus malin / plus rapide ────────────
export type Why = { n: string; vs: string; c: string; h: string; d: string; before: [string, string]; after: string }
export const WHY: Why[] = [
  { n: '01', vs: 'face au chatbot 100 % IA', c: VIOLET_DARK, h: 'Moins cher.', d: 'Un chatbot 100 % IA facture chaque réponse, même « vous êtes ouverts le dimanche ? ». Chapote répond d’abord avec un arbre à clics, inclus et illimité. L’IA n’intervient que quand l’arbre ne suffit pas, dans la limite de votre palier. Au-delà du plafond, le widget continue en arbre seul.', before: ['100 % IA', 'chaque question consomme, la facture suit le trafic'], after: 'les classiques à 0 crédit, l’IA plafonnée, un prix fixe par bot' },
  { n: '02', vs: 'face à la FAQ', c: GREEN_DARK, h: 'Plus malin.', d: 'Une FAQ attend que le visiteur trouve la bonne page, puis la bonne ligne. Chapote vient à lui : il propose les questions fréquentes en boutons, comprend les questions tapées à la main et répond à partir de vos pages, PDF et FAQ. Vos contenus servent enfin à quelque chose.', before: ['FAQ', 'le visiteur cherche, scrolle, abandonne'], after: 'il pose sa question, il a sa réponse' },
  { n: '03', vs: 'face au ticket', c: CORAL_DARK, h: 'Plus rapide.', d: 'Un ticket, c’est un formulaire, un e-mail, et une réponse demain. Avec Chapote, la plupart des questions sont réglées sur le moment. Pour les autres, un conseiller reprend la conversation en direct depuis l’inbox, avec tout l’historique : le client n’a rien à réexpliquer.', before: ['Ticket', 'formulaire, file d’attente, réponse sous 24 h'], after: 'réponse immédiate, ou un humain dans la conversation' },
]

export const MARQUEE = ['Arbre guidé illimité', 'IA plafonnée', 'Relais humain', 'Hébergé en France', 'RGPD par défaut', 'Une seule balise']

// ── « Comment ça répond » (section scrollée) ────────────────────────────────
export const STEPS: { n: string; k: string; c: string; h: string; d: string }[] = [
  { n: '01', k: 'L’arbre', c: GREEN, h: 'Les classiques, en un clic.', d: 'Livraison, horaires, suivi de commande : un arbre à boutons répond tout seul. Illimité, instantané, sans consommer un seul crédit IA.' },
  { n: '02', k: 'L’IA', c: VIOLET, h: 'Le reste, avec vos mots.', d: 'Hors de l’arbre, l’IA répond à partir de vos pages, PDF et FAQ. Prompt verrouillé côté serveur, quota mensuel plafonné.' },
  { n: '03', k: 'L’humain', c: CORAL, h: 'Et quand ça compte, vous.', d: 'Un conseiller reprend la conversation depuis l’inbox, avec tout l’historique. Le client n’a rien à répéter.' },
]
// `t` = progression de scroll (0 → 1) à partir de laquelle le message apparaît.
export type StoryMsg =
  | { t: number; type: 'bot' | 'ai' | 'human'; text: string; tag?: string; tc?: string }
  | { t: number; type: 'user'; text: string }
  | { t: number; type: 'chips'; items: string[] }
  | { t: number; type: 'handoff' }
export const STORY: StoryMsg[] = [
  { t: 0.0, type: 'bot', text: 'Bonjour ! Je suis l’assistant de la boutique. Je peux vous aider ?' },
  { t: 0.05, type: 'chips', items: ['Suivre ma commande', 'Modifier l’abonnement', 'Autre question'] },
  { t: 0.13, type: 'user', text: 'Suivre ma commande' },
  { t: 0.21, type: 'bot', text: 'Parfait. Quel est votre numéro de commande ?', tag: 'via l’arbre', tc: GREEN_DARK },
  { t: 0.40, type: 'user', text: 'C’est compatible avec mon forfait Pro ?' },
  { t: 0.50, type: 'ai', text: 'Oui. Le forfait Pro inclut le suivi en temps réel et le multi-agent.', tag: 'via l’IA · d’après votre FAQ', tc: VIOLET_DARK },
  { t: 0.70, type: 'user', text: 'Mon colis est bloqué depuis 10 jours…' },
  { t: 0.79, type: 'handoff' },
  { t: 0.88, type: 'human', text: 'Je m’en occupe, je relance le transporteur tout de suite.', tag: 'Camille · en direct', tc: CORAL_DARK },
]

// ── Comparatif ──────────────────────────────────────────────────────────────
export type CmpRow = { l: string; a: string; b: string; c: string }
export const CMP_ROWS: CmpRow[] = [
  { l: 'Tarif', a: 'Prix par bot, net', b: 'Coût à l’usage', c: 'Masse salariale' },
  { l: 'RGPD & hébergement', a: 'Français, natif', b: 'Souvent hors UE', c: 'Selon l’outil' },
  { l: 'Installation', a: '1 balise, 1 min', b: 'Config requise', c: 'Projet long' },
  { l: 'Relais humain', a: 'Bascule fluide', b: 'Aucun', c: 'Oui, mais lent' },
  { l: 'Arbre guidé', a: 'Illimité, sans surcoût', b: 'Limité à l’IA', c: 'Manuel' },
]

export type NavLink = { href: string; label: string }
export const NAV: NavLink[] = [
  { href: '#story', label: 'Comment ça marche' },
  { href: '#couts', label: 'Coûts' },
  { href: '#install', label: 'Installation' },
  { href: '#tarifs', label: 'Tarifs' },
  { href: '/demo', label: 'Démo' },
]

export type FooterColumn = { title: string; links: NavLink[] }
// Liens en « / » → routes internes (rendues en <Link> par Footer). « # » → ancre
// ou placeholder. Le pack légal pointe vers les pages publiques réelles.
export const FOOTER_COLUMNS: FooterColumn[] = [
  { title: 'Produit', links: [{ href: '#story', label: 'Comment ça marche' }, { href: '#tarifs', label: 'Tarifs' }, { href: '#install', label: 'Installation' }, { href: '/demo', label: 'Démo' }, { href: '/a-propos', label: 'À propos' }] },
  { title: 'Légal', links: [{ href: '/legal/mentions-legales', label: 'Mentions légales' }, { href: '/legal/cgu', label: 'CGU' }, { href: '/legal/cgv', label: 'CGV' }, { href: '/legal/confidentialite', label: 'Confidentialité' }, { href: '/legal/tiktok-cgu', label: 'CGU module TikTok' }, { href: '/legal/tiktok-confidentialite', label: 'Confidentialité TikTok' }, { href: '/legal/youtube-cgu', label: 'CGU module YouTube' }, { href: '/legal/youtube-confidentialite', label: 'Confidentialité YouTube' }] },
  { title: 'Ressources', links: [{ href: '#', label: 'Documentation' }, { href: 'mailto:hello@chapote.fr', label: 'Contact' }] },
]
