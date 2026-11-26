// Icône de l'app assortie à la couleur choisie (orange par défaut, bleu océan, vert forêt).
// Module natif présent seulement à partir de la version 4 : avant, l'option n'apparaît pas.
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Palette } from '../ui/theme'
import { showDialog } from '../ui/dialog'

type Mod = typeof import('expo-alternate-app-icons')
let mod: Mod | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require('expo-alternate-app-icons') as Mod
  if (!mod.supportsAlternateIcons) mod = null
} catch { mod = null }

const NAME: Record<Palette, string | null> = { warm: null, ocean: 'Ocean', forest: 'Forest' }
/** Page à rouvrir si le téléphone redémarre l'app en changeant d'icône. */
export const RESUME_KEY = 'cm.resume'

export const iconAvailable = () => mod != null

export function currentIcon(): Palette | null {
  if (!mod) return null
  try {
    const n = mod.getAppIconName()
    return n === 'Ocean' ? 'ocean' : n === 'Forest' ? 'forest' : 'warm'
  } catch { return null }
}

export async function setIcon(p: Palette, resumeTo: string): Promise<void> {
  if (!mod) return
  await AsyncStorage.setItem(RESUME_KEY, JSON.stringify({ path: resumeTo, at: Date.now() })).catch(() => {})
  await mod.setAlternateAppIcon(NAME[p])
  // L'app n'a pas été fermée : rien à rouvrir.
  AsyncStorage.removeItem(RESUME_KEY).catch(() => {})
}

/** Au démarrage : page à rouvrir si l'app vient d'être relancée par un changement d'icône (2 minutes au plus). */
export async function takeResume(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(RESUME_KEY)
    if (!raw) return null
    await AsyncStorage.removeItem(RESUME_KEY)
    const r = JSON.parse(raw) as { path: string; at: number }
    return Date.now() - r.at < 120000 && r.path.startsWith('/') ? r.path : null
  } catch { return null }
}

const LABEL: Record<Palette, string> = { warm: 'orange', ocean: 'bleu océan', forest: 'vert forêt' }

/** Propose l'icône assortie à la couleur (rien si elle l'est déjà, ou si ce téléphone ne le permet pas). */
export function offerIcon(p: Palette, resumeTo: string, done?: () => void, intro?: string) {
  if (!iconAvailable() || currentIcon() === p) return
  showDialog(`Icône ${LABEL[p]} ?`,
    `${intro ? `${intro}\n\n` : ''}Sur certains téléphones, l’app redémarre pour changer d’icône : vous reviendrez ici. L’icône peut mettre quelques secondes à changer sur l’écran d’accueil.`, [
      { text: 'Non, garder l’icône actuelle', style: 'cancel' },
      { text: 'Oui, changer', onPress: () => { setIcon(p, resumeTo).then(() => done?.()).catch(() => {}) } },
    ])
}
