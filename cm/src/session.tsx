// Session (compte partagé avec chapote.fr : cookie httpOnly posé par l'API) et espace
// de travail choisi (espace perso ou une équipe), gardé dans le navigateur.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getConfig, getMe, getSpaces, logout as apiLogout, publicConfig, type Config, type Me, type Space } from './api'

interface SessionCtx {
  me: Me | null
  ready: boolean
  googleClientId: string | null
  appUrl: string
  config: Config | null
  spaces: Space[]
  org: number | null
  setOrg: (org: number | null) => void
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionCtx | null>(null)
const ORG_KEY = 'cm.org'

function readOrg(): number | null {
  try {
    const v = localStorage.getItem(ORG_KEY)
    return v ? Number(v) || null : null
  } catch { return null }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [googleClientId, setGoogle] = useState<string | null>(null)
  const [appUrl, setAppUrl] = useState('https://chapote.fr')
  const [config, setConfig] = useState<Config | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [org, setOrgState] = useState<number | null>(readOrg)

  const refresh = useCallback(async () => {
    try {
      const m = await getMe()
      setMe(m)
      const [c, s] = await Promise.all([getConfig(), getSpaces()])
      setConfig(c)
      setSpaces(s)
      setOrgState(cur => (cur != null && !s.some(x => x.org_id === cur) ? null : cur))
    } catch {
      setMe(null)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    refresh()
    publicConfig().then(c => { setGoogle(c.google_client_id); setAppUrl(c.app_url) }).catch(() => {})
  }, [refresh])

  const setOrg = (v: number | null) => {
    setOrgState(v)
    try { v == null ? localStorage.removeItem(ORG_KEY) : localStorage.setItem(ORG_KEY, String(v)) } catch { /* */ }
  }
  const signOut = async () => { try { await apiLogout() } finally { setMe(null) } }

  return (
    <Ctx.Provider value={{ me, ready, googleClientId, appUrl, config, spaces, org, setOrg, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('SessionProvider manquant')
  return c
}

/** Charge une ressource liée à l'espace courant ; `reload()` la relit. */
export function useLoad<T>(fn: (org: number | null) => Promise<T>, deps: unknown[] = []) {
  const { org } = useSession()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fn(org).then(d => { if (alive) { setData(d); setError(null) } })
      .catch(e => { if (alive) setError(e?.message || 'Erreur') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [org, tick, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: () => setTick(t => t + 1), setData }
}
