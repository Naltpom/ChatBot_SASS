// Langue d'affichage des dates et heures : celle du téléphone (le réglage « Langue » de l'app viendra la remplacer).
import { getLocales } from 'expo-localization'

export function deviceLocale(): string {
  try { return getLocales()[0]?.languageTag || 'fr-FR' } catch { return 'fr-FR' }
}
export const LOCALE = deviceLocale()
