// Types et helpers partagés par WidgetPreview et ses sous-composants
// présentationnels. Aucune logique d'orchestration ici : l'état et la machine
// à états de la conversation simulée restent dans WidgetPreview.tsx.

export interface Msg {
  from: 'bot' | 'user'
  text: string
  ai?: boolean
  sys?: boolean      // bulle système du flux LIVE (attente conseiller) : italique, sans CSAT
  advisor?: boolean  // réponse « Conseiller » simulée : étiquette, sans CSAT (parité : jamais sur human)
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
}

export type T = (k: string) => string
