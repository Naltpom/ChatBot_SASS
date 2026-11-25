// Assistant Chapote CM (le chatbot de chapote.fr) : affiché dans une WebView, module natif présent à partir de
// la version 5 de l'app (et dans Expo Go). Avant, l'onglet est caché. Voir docs/WIDGET_CM.md, section 7.
import { Platform, TurboModuleRegistry } from 'react-native'

export const assistantAvailable = (() => {
  if (Platform.OS === 'web') return false
  try { return TurboModuleRegistry.get('RNCWebViewModule') != null } catch { return false }
})()

/** Clé PUBLIQUE du bot (pas un secret), la même que sur cm.chapote.fr. */
export const BOT_KEY = 'pk_fladg1AxA074Nd79-nsB2l6zuK88RW2P'
export const FRAME = 'https://chapote.fr/widget-frame'
/** Page parente : le bot vérifie que l'iframe est ouverte depuis cm.chapote.fr. */
export const BASE = 'https://cm.chapote.fr/assistant'
/** Seules ces adresses s'ouvrent dans l'assistant ; tout autre lien part dans le navigateur. */
export const INSIDE = [BASE, FRAME, 'https://challenges.cloudflare.com/', 'about:blank']

/** Page qui contient l'iframe du bot, aux couleurs de l'app. Aucune donnée du compte n'y est mise.
 * Le bandeau du chat (nom, statut) sert de titre : l'onglet n'affiche pas le sien. */
export function assistantHtml(color: string, text: string, theme: 'light' | 'dark', bg: string): string {
  const src = `${FRAME}?key=${BOT_KEY}&color=${encodeURIComponent(color)}&color_text=${encodeURIComponent(text)}&theme=${theme}`
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body,iframe{margin:0;border:0;width:100%;height:100%;background:${bg}}</style>
</head><body><iframe src="${src}" title="Assistant Chapote CM"></iframe></body></html>`
}
