// Apparence commune au site et à l'app (couleur, clair / sombre, langue), gardée dans le compte (GET / PATCH /api/cm/profile).
// Le téléphone garde sa copie (affichage immédiat) et le numéro `prefs_rev` vu en dernier : à l'ouverture et au retour
// dans l'app, on relit le compte et on n'applique que si ce numéro a changé (choix fait sur le site, par exemple), puis
// on propose l'icône assortie. Chaque choix fait dans l'app part au compte.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { getProfile, patchAppearance, type Profile } from './api'
import { offerIcon } from './app-icon'
import { useSession } from './session'
import { useTheme, type Palette, type ThemePref } from '../ui/theme'
import type { LangPref } from './i18n'

const revKey = (id: number) => `cm.prefs_rev.${id}`

export function AppearanceSync() {
  const { me } = useSession()
  const { palette, setPalette, pref, setPref, loaded, langPref, setLangPref } = useTheme()
  const cur = useRef({ palette, pref, langPref })
  cur.current = { palette, pref, langPref }
  // Valeurs connues du compte : tout écart vient d'un choix fait dans l'app et part au compte.
  const synced = useRef<{ palette: Palette; pref: ThemePref; langPref: LangPref } | null>(null)
  const busy = useRef(false)

  const save = async (id: number, p: Profile) => { if (p.prefs_rev != null) await AsyncStorage.setItem(revKey(id), String(p.prefs_rev)).catch(() => {}) }

  const pull = async () => {
    if (!me || !loaded || busy.current) return
    busy.current = true
    const id = me.id
    try {
      const p = await getProfile()
      if (!p.palette || !p.theme || p.prefs_rev == null) return       // serveur pas encore à jour : rien à faire
      const local = cur.current
      const seen = Number(await AsyncStorage.getItem(revKey(id)).catch(() => null) ?? -1)
      if (p.prefs_rev === 0 && (local.palette !== 'warm' || local.pref !== 'system' || local.langPref !== 'system')) {
        // Premier passage : le téléphone avait déjà un choix, il devient celui du compte.
        const r = await patchAppearance({ palette: local.palette, theme: local.pref, language: local.langPref })
        synced.current = { ...local }
        await save(id, r)
      } else if (p.prefs_rev !== seen) {
        const lp = p.language || 'system'
        synced.current = { palette: p.palette, pref: p.theme, langPref: lp }
        await save(id, p)
        if (p.theme !== local.pref) setPref(p.theme)
        if (lp !== local.langPref) setLangPref(lp)
        if (p.palette !== local.palette) {
          setPalette(p.palette)
          offerIcon(p.palette, '/', undefined, 'La couleur de l’app a changé (choisie sur le site).')
        }
      } else {
        synced.current = { ...local }
      }
    } catch { /* hors ligne : on garde le choix du téléphone */ } finally { busy.current = false }
  }

  useEffect(() => { synced.current = null; pull() }, [me?.id, loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') pull() })
    return () => sub.remove()
  }, [me?.id, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Choix fait dans l'app : envoyé au compte.
  useEffect(() => {
    const s = synced.current
    if (!me || !s || busy.current) return
    const body: { palette?: Palette; theme?: ThemePref; language?: LangPref } = {}
    if (palette !== s.palette) body.palette = palette
    if (pref !== s.pref) body.theme = pref
    if (langPref !== s.langPref) body.language = langPref
    if (!body.palette && !body.theme && !body.language) return
    synced.current = { palette, pref, langPref }
    const id = me.id
    patchAppearance(body).then(r => save(id, r)).catch(() => { synced.current = s })
  }, [palette, pref, langPref]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
