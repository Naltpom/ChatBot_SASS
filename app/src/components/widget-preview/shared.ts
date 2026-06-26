// Types et helpers partagés par WidgetPreview et ses sous-composants
// présentationnels. Aucune logique d'orchestration ici : l'état et la machine
// à états de la conversation simulée restent dans WidgetPreview.tsx.

export interface Msg {
  from: 'bot' | 'user'
  text: string
  ai?: boolean
  sys?: boolean      // bulle système du flux LIVE (attente conseiller) : italique, sans CSAT
  advisor?: boolean  // réponse « Conseiller » simulée : étiquette, sans CSAT (parité : jamais sur human)
  animate?: boolean  // révélé progressif « machine à écrire » (parité typeInto de widget.js) :
                     // posé sur les réponses bot ISSUES D'UNE INTERACTION ; jamais sur le
                     // message d'accueil/reset (sinon il se re-taperait à chaque frappe d'édition).
}

// Formulaire de contact simulé (nœud d'arbre type 'lead') — mêmes clés que
// widget.js : fields filtrés sur le référentiel, email forcé en tête.
export interface LeadSim { fields: string[]; after: { label: string; next: string }[] }

// Référentiel des champs lead autorisés (parité widget.js). Interne au module :
// seul leadFieldsOf() le consomme, pas d'usage hors d'ici (export retiré).
const LEAD_FIELD_KEYS = ['email', 'name', 'phone', 'message']

export function leadFieldsOf(fields?: string[]): string[] {
  const f = (fields || ['email', 'message']).filter(x => LEAD_FIELD_KEYS.includes(x))
  if (!f.includes('email')) f.unshift('email')
  return f
}

export function hostnameOf(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// Polices SANS chargement externe — mêmes stacks que widget.js (FONTS)
export const FONT_STACKS: Record<string, string> = {
  system: "'Public Sans',-apple-system,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
}

export function clampInt(v: any, min: number, max: number, fallback: number): number {
  const n = parseInt(v, 10)
  return isNaN(n) ? fallback : Math.min(max, Math.max(min, n))
}

// Validation d'une couleur hex (#rgb | #rrggbb) — miroir de safeColor (widget.js)
// pour accentColor. Toute valeur non conforme retombe sur le fallback.
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
export function safeHex(v: any, fallback: string): string {
  return typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : fallback
}

// Multiplicateur de taille de texte (clé textScale) — mêmes facteurs que widget.js.
export const TEXT_SCALE: Record<string, number> = { sm: 0.92, md: 1, lg: 1.1 }

// Heure statique HH:MM pour l'horodatage simulé (clé timestamps). Pas de
// persistance : parité visuelle seule (placeholder, comme dans widget.js).
export function nowHHMM(): string {
  const dt = new Date()
  const h = String(dt.getHours()).padStart(2, '0')
  const m = String(dt.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

// Tokens visuels résolus une fois dans WidgetPreview puis passés aux
// sous-composants présentationnels (évite de repropager 20 props).
export interface PreviewStyle {
  brand: string
  bg: string
  r14: number
  compact: boolean
  square: boolean
  dark: boolean
  botBg: string
  botBorder: string
  botText: string
  inputBg: string
  inputBorder: string
  mutedText: string
  panelBg: string
  anim: string
  // --- Refonte Apparence (clés additives, défauts = rendu actuel) ---
  accent: string         // couleur des boutons/options/envoi (accentColor || brand)
  scale: number          // multiplicateur de taille de texte (textScale)
  tail: boolean          // ergot des bulles (bubbleTail), false = coins égaux
  optBtn: boolean        // quickReplyStyle === 'button' (option rectangulaire pleine largeur)
  timestamps: boolean    // horodatage sous les bulles
  ts: string             // heure statique HH:MM (placeholder)
}

export type T = (k: string) => string
