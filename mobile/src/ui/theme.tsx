// Couleurs du site (cm/src/styles.css), en clair et en sombre. Par défaut : réglage du téléphone ;
// modifiable dans Réglages (gardé sur le téléphone).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'

const light = {
  bg: '#f5f5f7', surface: '#ffffff', surface2: '#fafafa', border: '#e8e8ed', borderStrong: '#d2d2d7',
  text: '#1d1d1f', muted: '#6e6e73', faint: '#86868b', primary: '#0071e3', onPrimary: '#ffffff',
  ink: '#1d1d1f', onInk: '#ffffff', accent: '#0066cc', ok: '#1d8a3a', warn: '#b25000', danger: '#d70015',
  dangerBg: '#fff2f3', dangerBorder: '#ffc2c7', infoBg: '#f0f6ff', okBg: '#eaf7ee', warnBg: '#fff6e8',
  tiktok: '#1d1d1f', youtube: '#ff0033', instagram: '#c13584', overlay: 'rgba(0,0,0,0.35)',
}
export type Colors = typeof light
const dark: Colors = {
  bg: '#000000', surface: '#1c1c1e', surface2: '#2c2c2e', border: '#2c2c2e', borderStrong: '#48484a',
  text: '#f5f5f7', muted: '#a1a1a6', faint: '#8e8e93', primary: '#0a84ff', onPrimary: '#ffffff',
  ink: '#f5f5f7', onInk: '#000000', accent: '#2997ff', ok: '#30d158', warn: '#ffb340', danger: '#ff6961',
  dangerBg: '#2a1211', dangerBorder: '#5c1d1a', infoBg: '#0b2340', okBg: '#0e2a17', warnBg: '#2a1e0a',
  tiktok: '#f5f5f7', youtube: '#ff4d6a', instagram: '#e1306c', overlay: 'rgba(0,0,0,0.6)',
}

export const GROUP_HEX: Record<string, string> = {
  blue: '#0071e3', orange: '#e8590c', green: '#1d8a3a', purple: '#7c5cd6', pink: '#d63384', teal: '#138a9a',
  amber: '#b58100', slate: '#6e6e73', red: '#d92d20', indigo: '#4f46e5', cyan: '#0891b2', lime: '#65a30d',
  rose: '#e11d48', sky: '#0284c7', emerald: '#059669', brown: '#92400e',
}

export type ThemePref = 'system' | 'light' | 'dark'
interface ThemeCtx { c: Colors; dark: boolean; pref: ThemePref; setPref: (p: ThemePref) => void }
const Ctx = createContext<ThemeCtx>({ c: light, dark: false, pref: 'system', setPref: () => {} })
const KEY = 'cm.theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [pref, setPrefState] = useState<ThemePref>('system')
  useEffect(() => {
    AsyncStorage.getItem(KEY).then(v => { if (v === 'light' || v === 'dark' || v === 'system') setPrefState(v) }).catch(() => {})
  }, [])
  const setPref = (p: ThemePref) => { setPrefState(p); AsyncStorage.setItem(KEY, p).catch(() => {}) }
  const isDark = pref === 'system' ? system === 'dark' : pref === 'dark'
  const value = useMemo(() => ({ c: isDark ? dark : light, dark: isDark, pref, setPref }), [isDark, pref])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }
export const radius = { sm: 10, md: 14, lg: 20 }
