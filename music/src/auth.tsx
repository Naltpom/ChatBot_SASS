// Compte partagé avec chapote.fr : la session est le cookie httpOnly posé par l'API.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getConfig, getMe, logout as apiLogout, type Me } from './api'

interface AuthCtx {
  me: Me | null
  ready: boolean
  googleClientId: string | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({ me: null, ready: false, googleClientId: null, refresh: async () => {}, signOut: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [googleClientId, setGoogle] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try { setMe(await getMe()) } catch { setMe(null) } finally { setReady(true) }
  }, [])
  useEffect(() => {
    refresh()
    getConfig().then(c => setGoogle(c.google_client_id)).catch(() => {})
  }, [refresh])
  const signOut = async () => { try { await apiLogout() } finally { setMe(null) } }
  return <Ctx.Provider value={{ me, ready, googleClientId, refresh, signOut }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
