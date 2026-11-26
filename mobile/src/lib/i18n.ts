// Langue de l'app (français ou anglais), commune au site et à l'app (cm/src/i18n/index.ts : mêmes règles).
//
// Le français est la langue source : chaque texte est écrit en français dans le code et passé à t().
//   t('Nouvelle publication')        → « New post » en anglais
//   t('{n} comptes', { n: 3 })       → « 3 accounts » ; {n} est remplacé dans les deux langues
// Traductions anglaises : src/i18n/en/*.ts (même clé = le texte français). Texte absent : affiché en français
// (`npm run i18n:check` liste les manquants).
// Choix : Réglages → Apparence → Langue (« Comme le téléphone » par défaut), enregistré sur le compte.
import common from '../i18n/en/common'
import part1 from '../i18n/en/part1'
import part2 from '../i18n/en/part2'
import part3 from '../i18n/en/part3'
import part4 from '../i18n/en/part4'
import part5 from '../i18n/en/part5'

export type Lang = 'fr' | 'en'
export type LangPref = 'system' | Lang

const EN: Record<string, string> = { ...common, ...part1, ...part2, ...part3, ...part4, ...part5 }

// Langue du téléphone : donnée par ui/theme.tsx (expo-localization) au démarrage. Ce fichier n'importe rien de
// natif pour rester utilisable dans les tests (node --test), où tout est en français.
let device = 'fr-FR'
export function setDeviceTag(tag: string | null | undefined) { if (tag) device = tag }
const deviceTag = () => device
export const systemLang = (): Lang => (deviceTag().toLowerCase().startsWith('fr') ? 'fr' : 'en')
export const resolve = (pref: LangPref | null | undefined): Lang => (pref === 'fr' || pref === 'en' ? pref : systemLang())

let lang: Lang = systemLang()
export const getLang = (): Lang => lang
/** Appelé par ThemeProvider (choix relu ou changé) ; l'app se réaffiche entièrement (clé de langue). */
export function setLang(l: Lang) { lang = l }

// Modèles : une clé avec {nom} reconnaît aussi un texte déjà rempli (« Vidéo trop longue (3 min au plus). »
// trouve « Vidéo trop longue ({max} au plus). ») : utile pour les messages construits dans les fichiers de logique.
let patterns: [RegExp, string, string[]][] | null = null
const found = new Map<string, string | null>()
function lookup(fr: string): string | undefined {
  const hit = EN[fr]
  if (hit !== undefined) return hit
  if (found.has(fr)) return found.get(fr) ?? undefined
  if (!patterns) {
    patterns = []
    for (const [k, v] of Object.entries(EN)) {
      if (!/\{\w+\}/.test(k) || k.replace(/\{\w+\}/g, '').trim().length < 3) continue
      const names: string[] = []
      const rx = k.split(/(\{\w+\})/).map(p => {
        const m = /^\{(\w+)\}$/.exec(p)
        if (m) { names.push(m[1]); return '([\\s\\S]+?)' }
        return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }).join('')
      patterns.push([new RegExp(`^${rx}$`), v, names])
    }
  }
  for (const [rx, v, names] of patterns) {
    const m = rx.exec(fr)
    if (!m) continue
    const out = v.replace(/\{(\w+)\}/g, (x, n) => { const i = names.indexOf(n); return i >= 0 ? (lookup(m[i + 1]) ?? m[i + 1]) : x })
    found.set(fr, out)
    return out
  }
  found.set(fr, null)
  return undefined
}

/** Le texte dans la langue choisie ; {nom} remplacés par les valeurs données. */
export function t(fr: string, vars?: Record<string, string | number | null | undefined>): string {
  let s = lang === 'en' ? (lookup(fr) ?? fr) : fr
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] != null ? String(vars[k]) : m))
  return s
}

/** Locale des dates et nombres : celle du téléphone si elle est dans la langue choisie, sinon fr-FR / en-US. */
export function locale(): string {
  const tag = deviceTag()
  return tag.toLowerCase().startsWith(lang) ? tag : lang === 'fr' ? 'fr-FR' : 'en-US'
}
