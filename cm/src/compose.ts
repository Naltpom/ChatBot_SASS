// Nouvelle publication : petites règles pures, les mêmes que l'app (mobile/src/features/planning/compose.ts).

/** Langue d'affichage des dates : celle du navigateur (le réglage « Langue » viendra la remplacer). */
export const LOCALE = (typeof navigator !== 'undefined' && navigator.language) || 'fr-FR'

/** Ordre des champs de date dans la langue (jour/mois/année) : fr → d m y, en-US → m d y, ja → y m d. */
export function dateOrder(locale: string = LOCALE): ('day' | 'month' | 'year')[] {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(2026, 10, 25))
    const order = parts.map(p => p.type).filter((t): t is 'day' | 'month' | 'year' => t === 'day' || t === 'month' || t === 'year')
    if (order.length === 3) return order
  } catch { /* Intl incomplet */ }
  return ['day', 'month', 'year']
}

/** Date complète en toutes lettres, dans la langue : « lundi 30 novembre 2026 à 19:10 ». */
export function longDate(d: Date, locale: string = LOCALE): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
  } catch { return d.toString() }
}

/** Date construite depuis les 5 champs (null si invalide : 31 février, 25 h…). */
export function fromParts(p: { day: number; month: number; year: number; hour: number; minute: number }): Date | null {
  if ([p.day, p.month, p.year, p.hour, p.minute].some(x => !Number.isFinite(x))) return null
  const d = new Date(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0)
  if (d.getFullYear() !== p.year || d.getMonth() !== p.month - 1 || d.getDate() !== p.day || d.getHours() !== p.hour || d.getMinutes() !== p.minute) return null
  return d
}
