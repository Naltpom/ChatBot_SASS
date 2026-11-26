// Assistant Chapote CM (le chatbot de chapote.fr) : affiché dans une WebView, module natif présent à partir de
// la version 5 de l'app (et dans Expo Go). Avant, l'onglet est caché. Voir docs/WIDGET_CM.md, section 7.
import { Platform, TurboModuleRegistry } from 'react-native'
import { t } from './i18n'

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

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
/** Origine de la page parente (cm) et du cadre du bot (chapote.fr), pour le jeton « mes données ». */
export const CM_ORIGIN = 'https://cm.chapote.fr'
export const FRAME_ORIGIN = 'https://chapote.fr'

/** Lien d'un brouillon de l'assistant : « Ouvrir » (/brouillon/12) ou « Lancer » (/brouillon/12/lancer?s=…). */
export function draftLink(url: string): { id: number; launch: string | null } | null {
  const m = /^https:\/\/cm\.chapote\.fr\/brouillon\/(\d+)(\/lancer)?\/?(?:\?(.*))?$/.exec(url)
  if (!m) return null
  const s = m[2] ? new URLSearchParams(m[3] || '').get('s') : null
  if (m[2] && !s) return null
  return { id: Number(m[1]), launch: m[2] ? s : null }
}

/** Page de cm.chapote.fr citée par l'assistant → écran de l'app (on reste dans l'app). null : pas d'équivalent,
 * le lien part dans le navigateur. */
const ROUTES: [RegExp, string][] = [
  [/^\/(planning)?\/?$/, '/'], [/^\/stats\/?$/, '/stats'], [/^\/bibliotheque\/?$/, '/library'],
  [/^\/nouvelle\/?$/, '/new'], [/^\/a-valider\/?$/, '/drafts'], [/^\/comptes\/?$/, '/accounts'],
  [/^\/(partage|personnes|equipe)\/?$/, '/people'], [/^\/commentaires\/?$/, '/comments'], [/^\/videos\/?$/, '/videos'],
  [/^\/reglages\/assistant-ia\/?$/, '/assistant-settings'], [/^\/reglages\/compte\/?$/, '/account'], [/^\/reglages\/?$/, '/settings'],
]
export function appRoute(url: string): string | null {
  // Pas de new URL(...).pathname : l'URL de React Native ne le fournit pas partout.
  const m = /^https:\/\/cm\.chapote\.fr(\/[^?#]*)?(?:[?#].*)?$/.exec(url)
  if (!m) return null
  const path = m[1] || '/'
  const v = /^\/videos\/(\d+)\/?$/.exec(path)
  if (v) return `/video/${v[1]}`
  return ROUTES.find(([re]) => re.test(path))?.[1] ?? null
}

/** Réponse du jeton au cadre du bot (injectée dans la page parente), seulement vers l'origine de chapote.fr. */
export function tokenReply(id: string, token: string | null, aliases: Record<string, string> | null): string {
  const msg = JSON.stringify({ type: 'chapote-user-token', id, token, aliases })
  return `(function(){var f=document.querySelector('iframe');if(f&&f.contentWindow){f.contentWindow.postMessage(${msg},${JSON.stringify(FRAME_ORIGIN)});}})();true;`
}

/** Page qui contient l'iframe du bot, aux couleurs de l'app. Aucune donnée du compte n'y est mise : le cadre
 * demande son jeton court par message, la page le relaie à l'app (qui seule a la session) et l'app répond.
 * Sans bandeau (header=0) : l'onglet « Assistant » de l'app suffit comme titre. Cadre en bloc : sinon une
 * fine bande (l'espace sous une ligne de texte) apparaît sous le chat. */
export function assistantHtml(color: string, text: string, theme: 'light' | 'dark', bg: string): string {
  const src = `${FRAME}?key=${BOT_KEY}&color=${encodeURIComponent(color)}&color_text=${encodeURIComponent(text)}&theme=${theme}&token_origin=${encodeURIComponent(CM_ORIGIN)}&header=0`
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;background:${bg};overflow:hidden}iframe{display:block}</style>
</head><body><iframe src="${src}" title="${escapeAttr(t('Assistant Chapote CM'))}"></iframe>
<script>window.addEventListener('message',function(e){var d=e.data;var f=document.querySelector('iframe');
if(e.origin!==${JSON.stringify(FRAME_ORIGIN)}||!f||e.source!==f.contentWindow||!d||d.type!=='need-user-token'||typeof d.id!=='string')return;
if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({kind:'token',id:d.id.slice(0,20)}));});</script>
</body></html>`
}
