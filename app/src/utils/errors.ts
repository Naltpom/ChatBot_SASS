// Localisation / normalisation des messages d'erreur affichés à l'utilisateur.
//
// Trois sources d'erreur convergent ici :
//  1. erreurs RÉSEAU : `fetch` rejette avec un TypeError (« Failed to fetch »,
//     « NetworkError… ») quand la requête n'aboutit pas (serveur down, offline,
//     DNS, CORS). On masque ce texte technique anglais derrière un libellé FR.
//  2. erreurs API : `ApiError` (api.ts) porte `status`, `message` (le `detail`
//     backend, déjà FR) et `code` (contrat d'erreur unifié {detail, code, message}).
//  3. autres `Error` : on remonte `.message` tel quel.

// Message FR pour toute erreur réseau (fetch n'a pas pu joindre le serveur).
export const NETWORK_ERROR_MESSAGE =
  'Connexion au serveur impossible. Vérifiez votre connexion internet, puis réessayez.'

// `code` machine du contrat d'erreur backend -> message FR de repli. Utilisé
// seulement quand le `message`/`detail` serveur est absent ou trop générique.
const CODE_MESSAGES: Record<string, string> = {
  rate_limited: 'Trop de requêtes. Patientez quelques instants, puis réessayez.',
  unauthorized: 'Session expirée. Reconnectez-vous.',
  forbidden: 'Vous n’avez pas accès à cette ressource.',
  not_found: 'Ressource introuvable.',
  conflict: 'Cette action entre en conflit avec l’état actuel.',
  validation_error: 'Certaines informations saisies sont invalides.',
  payload_too_large: 'Le contenu envoyé est trop volumineux.',
  server_error: 'Une erreur serveur est survenue. Réessayez plus tard.',
  bad_gateway: 'Le service est momentanément indisponible. Réessayez plus tard.',
  service_unavailable: 'Le service est momentanément indisponible. Réessayez plus tard.',
}

// `fetch` signale l'échec réseau par un TypeError ; on reconnaît les libellés
// usuels des navigateurs (Chrome « Failed to fetch », Firefox « NetworkError… »,
// Safari « Load failed »). On ne se fie pas qu'au texte : un TypeError issu de
// fetch est, en pratique, toujours d'origine réseau.
export function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    /failed to fetch|networkerror|load failed|fetch/i.test(err.message)
  )
}

// Helper partagé d'extraction d'un message d'erreur AFFICHABLE (FR), pour les
// blocs `catch (err: unknown)`. Priorité : réseau > message serveur localisé >
// repli par `code` > fallback.
export function errMsg(err: unknown, fallback = 'Une erreur est survenue.'): string {
  if (isNetworkError(err)) return NETWORK_ERROR_MESSAGE

  // ApiError (et toute Error portant un `code`) : le `message` serveur (= detail,
  // déjà FR) prime ; à défaut on mappe le `code` machine ; sinon le fallback.
  const code = (err as { code?: unknown } | null)?.code
  const message = err instanceof Error ? err.message : ''
  if (message) return message
  if (typeof code === 'string' && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  return fallback
}
