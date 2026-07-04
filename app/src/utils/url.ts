// URL — garde anti-XSS pour les href issus de données NON fiables (scrapées,
// saisies, prévisualisées). Un `href={url}` brut accepte `javascript:` / `data:`
// qui s'exécutent au clic. safeHref ne laisse passer que les schémas inoffensifs
// (http/https, et mailto en option pour les liens de contact) ; sinon undefined,
// pour ne PAS poser de href cliquable (l'appelant retombe alors sur du texte brut).

const SAFE_SCHEMES = ['http:', 'https:']

/**
 * Retourne l'URL telle quelle si son schéma est sûr, sinon undefined.
 * @param url      URL non fiable à valider.
 * @param mailto   Autorise aussi `mailto:` (liens de contact). Défaut: false.
 */
export function safeHref(url: unknown, mailto = false): string | undefined {
  if (typeof url !== 'string') return undefined
  const raw = url.trim()
  if (!raw) return undefined
  let scheme: string
  try {
    // base factice http://localhost/ : résout les URLs relatives (schéma http hérité)
    // tout en rejetant les URLs absolues à schéma dangereux (javascript:, data:…).
    scheme = new URL(raw, 'http://localhost/').protocol.toLowerCase()
  } catch {
    return undefined
  }
  const allowed = mailto ? [...SAFE_SCHEMES, 'mailto:'] : SAFE_SCHEMES
  return allowed.includes(scheme) ? raw : undefined
}
