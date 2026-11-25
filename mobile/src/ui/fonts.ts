// Police des titres : Bricolage Grotesque (700 et 800, licence OFL). Le texte courant garde la police système.
// Chargée sans risque : une version de l'app installée avant l'ajout du module natif des polices
// (mise à jour reçue par EAS Update) garde simplement la police système.
import { useSyncExternalStore } from 'react'

export const HEADING = { bold: 'BricolageGrotesque-700', black: 'BricolageGrotesque-800' }
let ready = false
const listeners = new Set<() => void>()

export function loadFonts() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Font = require('expo-font') as typeof import('expo-font')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const f = require('@expo-google-fonts/bricolage-grotesque') as typeof import('@expo-google-fonts/bricolage-grotesque')
    Font.loadAsync({ [HEADING.bold]: f.BricolageGrotesque_700Bold, [HEADING.black]: f.BricolageGrotesque_800ExtraBold })
      .then(() => { ready = true; listeners.forEach(l => l()) })
      .catch(() => { /* police système */ })
  } catch { /* module natif absent : police système */ }
}

export function useHeadingFont(): boolean {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => ready, () => ready)
}
