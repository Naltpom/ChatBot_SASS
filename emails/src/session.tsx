// Session (compte partagé avec chapote.fr : cookie httpOnly posé par l'API, domaine chapote.fr)
// et droit d'accès à emails.chapote.fr (superadmin + session ayant franchi la 2FA).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getAccess, getMe, logout as apiLogout, publicConfig, type Access, type Me, type PublicConfig } from './api'

interface SessionCtx {
  me: Me | null
  access: Access | null
  ready: boolean
  config: PublicConfig | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionCtx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [access, setAccess] = useState<Access | null>(null)
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<PublicConfig | null>(null)

  const refresh = useCallback(async () => {
    try {
      const m = await getMe()
      setMe(m)
      setAccess(await getAccess())
    } catch {
      setMe(null)
      setAccess(null)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    refresh()
    publicConfig().then(setConfig).catch(() => {})
  }, [refresh])

  const signOut = async () => {
    try { await apiLogout() } finally { setMe(null); setAccess(null) }
  }

  return <Ctx.Provider value={{ me, access, ready, config, refresh, signOut }}>{children}</Ctx.Provider>
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('SessionProvider manquant')
  return c
}

/** Après la connexion : `suite` interne à l'interface, ou /oauth/authorize (route de l'API : rechargement complet). */
export function goToSuite(suite: string | null, navigate: (to: string, o?: { replace?: boolean }) => void) {
  const s = suite && suite.startsWith('/') && !suite.startsWith('//') ? suite : '/'
  if (s.startsWith('/oauth/')) window.location.assign(s)
  else navigate(s, { replace: true })
}

/** Charge une ressource ; `reload()` la relit. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fn().then(d => { if (alive) { setData(d); setError(null) } })
      .catch(e => { if (alive) setError(e?.message || 'Erreur') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [tick, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: () => setTick(t => t + 1), setData }
}
