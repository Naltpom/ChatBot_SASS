import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { api, getToken, setToken } from './api'
import type { AuthResponse, Org, RegisterPayload, User } from './types/auth'

// Source de vérité des formes auth = types/auth (fidèles à l'API). On les
// re-exporte pour les consommateurs historiques (Layout/MyOrgs : `Org` ;
// permissions/Header : `User`). Une organisation = une ÉQUIPE ; un compte solo
// a organizations: [].
export type { AuthResponse, Org, RegisterPayload, User }

interface AuthState {
  user: User | null
  loading: boolean
  activeOrg: Org | null
  setActiveOrg: (org: Org) => void
  login: (email: string, password: string) => Promise<void>
  register: (payload: RegisterPayload) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState>(null as any)

function pickActiveOrg(user: User): Org | null {
  const savedId = Number(localStorage.getItem('cbsaas_org') || 0)
  return user.organizations.find(o => o.id === savedId) || user.organizations[0] || null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [activeOrg, setActive] = useState<Org | null>(null)
  const [loading, setLoading] = useState(true)

  function applyUser(u: User) {
    setUser(u)
    setActive(pickActiveOrg(u))
  }

  useEffect(() => {
    async function init() {
      try {
        if (getToken()) {
          applyUser(await api<User>('/api/auth/me'))
          return
        }
        // Auto-login admin en dev : l'endpoint n'existe qu'avec
        // AUTO_LOGIN_ADMIN_DEV=true et ENV=dev, sinon 404 silencieux.
        // Opt-out (tests E2E) : la clé localStorage kc_no_autologin le neutralise.
        if (localStorage.getItem('kc_no_autologin')) return
        const data = await api<AuthResponse>('/api/auth/dev-login', { method: 'POST' })
        setToken(data.access_token)
        applyUser(data.user)
      } catch {
        setToken(null)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  function setActiveOrg(org: Org) {
    localStorage.setItem('cbsaas_org', String(org.id))
    setActive(org)
  }

  async function login(email: string, password: string) {
    const data = await api<AuthResponse>('/api/auth/login', { method: 'POST', body: { email, password } })
    setToken(data.access_token)
    applyUser(data.user)
  }

  async function register(payload: RegisterPayload) {
    const data = await api<AuthResponse>('/api/auth/register', { method: 'POST', body: payload })
    setToken(data.access_token)
    applyUser(data.user)
  }

  async function refreshUser() {
    applyUser(await api<User>('/api/auth/me'))
  }

  function logout() {
    setToken(null)
    setUser(null)
    setActive(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, activeOrg, setActiveOrg, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
