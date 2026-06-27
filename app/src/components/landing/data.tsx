// Données & primitives partagées de la landing « Chapote » (extraction R4).
// Tout le contenu statique (piliers, comparatif, témoignages, logos, nav,
// tokens typographiques, icônes) vit ici pour alléger les sous-composants
// présentationnels. Aucune logique d'état.
import { API_URL } from '../../api'

// ---- Tokens typographiques -------------------------------------------------
export const CLASH = "'Clash Display',sans-serif"
export const JAKARTA = "'Plus Jakarta Sans',sans-serif"
export const MONO = "'JetBrains Mono',monospace"
export const eyebrow = (color: string): React.CSSProperties => ({ fontSize: 13, fontWeight: 700, letterSpacing: '.12em', color })
// Style de titre de section partagé par les 5 sections (Piliers/Temoignages/Comparatif/Install/Pricing).
export const sectionH2: React.CSSProperties = { fontFamily: CLASH, fontWeight: 600, fontSize: 40, lineHeight: 1.15, letterSpacing: '-.02em', color: '#1E2A32', margin: '12px 0 0' }

// Boutons CTA réutilisés par plusieurs sections (hero, pricing).
export const btnPrimary: React.CSSProperties = { background: '#1C3F5C', color: '#fff', border: 'none', borderRadius: 14, padding: '15px 26px', fontWeight: 600, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', boxShadow: '0 12px 26px -10px rgba(28,63,92,.6)' }
export const btnSecondary: React.CSSProperties = { background: '#fff', color: '#1C3F5C', border: '1px solid #D8DEE6', borderRadius: 14, padding: '15px 24px', fontWeight: 600, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 9 }

// ---- Snippet d'installation RÉEL (corrige §5.1 D13) ------------------------
// Le widget lit l'attribut `data-bot-key` (clé publique pk_…) et se charge
// depuis `{API_URL}/widget.js`. On reproduit fidèlement le `script_tag`
// renvoyé par GET /api/bots/{id}/embed (api/src/routers/bots.py). La clé est
// un exemple : l'utilisateur récupère la sienne dans l'onglet Intégration.
export const WIDGET_SRC = `${API_URL}/widget.js`
export const EXAMPLE_BOT_KEY = 'pk_votre_cle'
export const SNIPPET = `<script src="${WIDGET_SRC}" data-bot-key="${EXAMPLE_BOT_KEY}" defer></script>`

// ---- Icônes (SVG inline, tracés repris du design) --------------------------
export const HatIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
export const Check = ({ stroke = '#2F9E79', w = 2.2, size = 16 }: { stroke?: string; w?: number; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10.5" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" /></svg>
)

// ---- Piliers ---------------------------------------------------------------
export type Pilier = { bg: string; co: string; t: string; d: string; icon: React.ReactNode }
export const PILIERS: Pilier[] = [
  { bg: 'rgba(47,158,121,.12)', co: '#2F9E79', t: 'Sans engagement', d: '1er mois remisé, puis un tarif clair par bot. Annulable à tout moment, sans surprise.', icon: <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" /><path d="M14.5 9.4a3.2 3.2 0 100 5.2M8 11h4.5M8 13.2h3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg> },
  { bg: 'rgba(47,158,121,.12)', co: '#2F9E79', t: 'RGPD par défaut', d: 'Hébergement français, données locales. Conforme sans la moindre configuration.', icon: <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 2.6v5.2c0 4.4-3 7.4-7 8.9-4-1.5-7-4.5-7-8.9V5.6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M9 12l2 2 4-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { bg: 'rgba(140,109,255,.12)', co: '#8C6DFF', t: 'Installation 1 minute', d: 'Une seule balise <script> à coller. Aucun autre réglage requis.', icon: <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M9 7l-4.5 5L9 17M15 7l4.5 5L15 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { bg: 'rgba(232,106,95,.12)', co: '#E86A5F', t: 'Relais humain', d: "Bascule fluide vers un conseiller quand l'humain fait la différence.", icon: <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 6h16v10H9l-4 3.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="11" r="2.2" stroke="currentColor" strokeWidth="1.8" /></svg> },
]

// ---- Comparatif ------------------------------------------------------------
export type Cell = { kind: 'ok' | 'warn' | 'no'; label: string; strong?: boolean }
export type CmpRow = { label: string; badge?: string; chapote: Cell; ia: Cell; classic: Cell }
export const CMP_ROWS: CmpRow[] = [
  { label: 'Tarif transparent', chapote: { kind: 'ok', label: 'Prix par bot, net' }, ia: { kind: 'warn', label: "Coût à l'usage" }, classic: { kind: 'no', label: 'Masse salariale' } },
  { label: 'RGPD & hébergement FR', chapote: { kind: 'ok', label: 'Français, natif' }, ia: { kind: 'no', label: 'Souvent hors UE' }, classic: { kind: 'warn', label: "Selon l'outil" } },
  { label: 'Installation', chapote: { kind: 'ok', label: '1 balise, 1 min' }, ia: { kind: 'warn', label: 'Config requise' }, classic: { kind: 'no', label: 'Projet long' } },
  { label: 'Relais humain', chapote: { kind: 'ok', label: 'Bascule fluide' }, ia: { kind: 'no', label: 'Aucun' }, classic: { kind: 'ok', label: 'Oui, mais lent' } },
  { label: 'Arbre guidé', badge: 'ILLIMITÉ', chapote: { kind: 'ok', label: 'Sans surcoût', strong: true }, ia: { kind: 'no', label: "Limité à l'IA" }, classic: { kind: 'no', label: 'Manuel' } },
]

// ---- L'impact (ex-« témoignages ») -----------------------------------------
// Révision design : on n'invente pas de témoignages clients. On décrit ce que la
// mécanique produit « par design » (3 cartes à icône, même charte que Piliers).
export type Impact = { bg: string; co: string; t: string; d: string; icon: React.ReactNode }
export const IMPACTS: Impact[] = [
  { bg: 'rgba(47,158,121,.12)', co: '#2F9E79', t: 'Le niveau 1 absorbé 24/7', d: "L'arbre guidé répond aux questions répétitives sans consommer d'IA. Vos conseillers ne traitent que ce qui mérite un humain.", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 7l-4.5 5L9 17M15 7l4.5 5L15 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { bg: 'rgba(232,106,95,.12)', co: '#E86A5F', t: 'Un coût plafonné, pas à l\'usage', d: "L'IA est bornée par paliers : vous savez exactement ce que vous payez chaque mois. Aucune facture qui dérape.", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" /><path d="M14.5 9.4a3.2 3.2 0 100 5.2M8 11h4.5M8 13.2h3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg> },
  { bg: 'rgba(140,109,255,.12)', co: '#8C6DFF', t: 'Conforme dès le premier jour', d: "Hébergement français, données locales. Votre service juridique valide en un coup d'œil, sans dossier de transfert hors UE.", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 2.6v5.2c0 4.4-3 7.4-7 8.9-4-1.5-7-4.5-7-8.9V5.6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M9 12l2 2 4-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
]

// Plateformes d'intégration (le widget s'installe partout via une seule balise).
export const LOGOS = ['WordPress', 'Shopify', 'Webflow', 'Wix', 'PrestaShop']

// ---- Navigation (types explicites — §8 évite les as-casts) -----------------
export type NavLink = { href: string; label: string }
export const NAV: NavLink[] = [
  { href: '#features', label: 'Fonctionnalités' },
  { href: '#why', label: 'Comparatif' },
  { href: '#pricing', label: 'Tarifs' },
  { href: '/demo', label: 'Démo' },
]

// ---- Colonnes de liens du footer (types explicites — §8) -------------------
export type FooterColumn = { title: string; links: NavLink[] }
// Liens en « / » → routes internes (rendues en <Link> par Footer). « # » → ancre
// ou placeholder. Le pack légal pointe vers les pages publiques réelles.
export const FOOTER_COLUMNS: FooterColumn[] = [
  { title: 'Produit', links: [{ href: '#features', label: 'Fonctionnalités' }, { href: '#why', label: 'Comparatif' }, { href: '#pricing', label: 'Tarifs' }, { href: '#install', label: 'Installation' }, { href: '/demo', label: 'Démo' }] },
  { title: 'Légal', links: [{ href: '/legal/mentions-legales', label: 'Mentions légales' }, { href: '/legal/cgu', label: 'CGU' }, { href: '/legal/cgv', label: 'CGV' }, { href: '/legal/confidentialite', label: 'Confidentialité' }] },
  { title: 'Ressources', links: [{ href: '#', label: 'Documentation' }, { href: '#', label: 'Contact' }, { href: '#', label: 'GitHub' }] },
]
