// Langue de l'interface (français ou anglais), commune au site et à l'app.
//
// Le français est la langue source : chaque texte est écrit en français dans le code et passé à t().
//   t('Nouvelle publication')                    → « New post » en anglais
//   t('{n} comptes', { n: 3 })                   → « 3 accounts » ; {n} est remplacé dans les deux langues
// Les traductions anglaises sont dans i18n/en/*.ts (un fichier par partie du site, même clé = le texte français).
// Texte absent du dictionnaire : affiché en français (scripts : `npm run i18n:check` liste les manquants).
//
// Choix de la langue : réglage « Langue » (Réglages → Apparence), comme le thème : « Comme l'appareil »
// par défaut (français si le navigateur est en français, sinon anglais), enregistré sur le compte.
export type Lang = 'fr' | 'en'
export type LangPref = 'system' | Lang

const files = import.meta.glob('./en/*.ts', { eager: true, import: 'default' }) as Record<string, Record<string, string>>
const EN: Record<string, string> = Object.assign({}, ...Object.values(files))

const nav = () => (typeof navigator !== 'undefined' && navigator.language) || 'fr-FR'
export const systemLang = (): Lang => (nav().toLowerCase().startsWith('fr') ? 'fr' : 'en')
export const resolve = (pref: LangPref | undefined | null): Lang => (pref === 'fr' || pref === 'en' ? pref : systemLang())

function initial(): Lang {
  try { return resolve(JSON.parse(localStorage.getItem('cm.appearance') || 'null')?.language) } catch { return systemLang() }
}
let lang: Lang = initial()
if (typeof document !== 'undefined') document.documentElement.lang = lang

export const getLang = (): Lang => lang
/** Change la langue tout de suite (la page se recharge pour tout réafficher). */
export function applyLang(next: Lang, reload = true) {
  if (next === lang) return
  lang = next
  document.documentElement.lang = next
  if (reload) window.location.reload()
}

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

/** Locale des dates et nombres : celle du navigateur si elle est dans la langue choisie, sinon fr-FR / en-US. */
export function locale(): string {
  const n = nav()
  return n.toLowerCase().startsWith(lang) ? n : lang === 'fr' ? 'fr-FR' : 'en-US'
}

export const LANGS: { id: LangPref; label: string }[] = [
  { id: 'system', label: 'Comme l’appareil' }, { id: 'fr', label: 'Français' }, { id: 'en', label: 'English' },
]
