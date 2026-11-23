// Connexion TikTok / YouTube lancée depuis cm.chapote.fr : la plateforme revient sur l'URI
// déjà déclarée (chapote.fr/<plateforme>/callback) ; on renvoie code + state vers la même page
// de cm.chapote.fr, qui fait l'échange (session partagée, state vérifié par l'API).
//
// La destination est FIXE (sous-domaine cm du site courant), jamais lue dans le state : un
// state forgé ne peut pas envoyer le code d'autorisation ailleurs.

function cmOrigin(): string {
  const { protocol, hostname } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:3003'
  return `${protocol}//cm.${hostname.replace(/^www\./, '')}`
}

function stateApp(state: string | null): string | null {
  if (!state) return null
  try {
    const part = state.split('.')[1] || ''
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4))
    const app = JSON.parse(json)?.app
    return typeof app === 'string' ? app : null
  } catch {
    return null
  }
}

/** Vrai (et redirection lancée) si ce retour OAuth appartient à cm.chapote.fr. */
export function bounceToCm(): boolean {
  if (typeof window === 'undefined') return false
  const state = new URLSearchParams(window.location.search).get('state')
  if (stateApp(state) !== 'cm') return false
  window.location.replace(`${cmOrigin()}${window.location.pathname}${window.location.search}`)
  return true
}
