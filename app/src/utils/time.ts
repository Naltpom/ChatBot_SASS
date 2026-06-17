// Dates & heures — utilitaires partagés (résorption du bug §5.1 D9).
//
// CONTEXTE CLÉ : l'API renvoie des datetimes UTC *naïfs* (sérialisés par les
// schémas Pydantic *Out, sans suffixe « Z » ni offset). Les pages existantes
// parsaient de façon incohérente :
//   - InboxPanel/StatsPanel  → new Date(iso + 'Z')   (correct : interprète UTC)
//   - Analytics/AdminUsers/Profile → new Date(iso)    (faux : interprété en
//     heure locale, décalé du fuseau du navigateur)
//
// parseUtc() unifie : si la chaîne ne porte aucun fuseau (ni « Z » ni offset
// ±HH:MM), on la traite comme UTC en ajoutant « Z ». Une chaîne déjà
// suffixée (Z ou offset) est laissée telle quelle. Tout le formatage FR passe
// ensuite par cette base, garantissant un affichage cohérent.

// Détecte un fuseau explicite en fin de chaîne ISO : « Z », ou un offset
// numérique du type +02:00 / -0500 / +02.
const HAS_TZ = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/

/**
 * Parse une chaîne ISO en Date, en interprétant comme UTC les datetimes
 * *naïfs* (sans fuseau). Sémantique alignée sur l'impl historique correcte
 * (InboxPanel/StatsPanel) : `new Date(iso + 'Z')`.
 *
 * - "2026-06-16T09:30:00"        → traité comme UTC (ajout de « Z »)
 * - "2026-06-16T09:30:00Z"       → tel quel
 * - "2026-06-16T09:30:00+02:00"  → tel quel (offset respecté)
 *
 * Renvoie une Date potentiellement Invalid (NaN) si la chaîne est illisible,
 * pour rester non-jetant comme le code appelant existant.
 */
export function parseUtc(iso: string): Date {
  if (!iso) return new Date(NaN)
  // Une date seule (YYYY-MM-DD) reste interprétée par Date comme minuit UTC ;
  // on n'ajoute « Z » que pour les formes datetime sans fuseau explicite.
  const needsZ = iso.includes('T') && !HAS_TZ.test(iso)
  return new Date(needsZ ? iso + 'Z' : iso)
}

/**
 * Formate une chaîne ISO (UTC naïf) en français. Par défaut : date + heure
 * (jj/mm/aaaa hh:mm), équivalent aux `toLocaleString('fr-FR')` /
 * `toLocaleDateString + toLocaleTimeString` éparpillés dans les pages.
 *
 * - formatFr(iso)                                  → "16/06/2026 11:30"
 * - formatFr(iso, { dateStyle: 'short' })          → "16/06/2026" (date seule)
 * - formatFr(iso, { hour: '2-digit', minute: '2-digit' }) → personnalisé
 *
 * Renvoie "—" si la chaîne est absente ou invalide (placeholder usuel de l'UI).
 */
export function formatFr(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—'
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '—'
  const options: Intl.DateTimeFormatOptions = opts ?? {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
  return d.toLocaleString('fr-FR', options)
}

/**
 * Nombre de minutes écoulées depuis `iso` (UTC naïf), borné à >= 0.
 * Repris à l'identique de InboxPanel/StatsPanel.
 */
export function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - parseUtc(iso).getTime()) / 60000))
}

/**
 * Libellé relatif en français : « il y a N min / h / j ».
 * Repris de l'impl la plus complète (InboxPanel/StatsPanel, identiques).
 */
export function timeAgo(iso: string): string {
  const mins = minutesSince(iso)
  if (mins < 60) return `il y a ${mins} min`
  if (mins < 60 * 24) return `il y a ${Math.round(mins / 60)} h`
  return `il y a ${Math.round(mins / 1440)} j`
}

/**
 * Extrait le pathname d'une URL, robuste aux URL invalides ou vides :
 * retourne la chaîne d'entrée telle quelle si elle n'est pas parsable.
 * Repris de InboxPanel.pathnameOf (qui acceptait aussi null).
 */
export function pathnameOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}
