import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { api, getToken, setToken } from './api'
import type { AuthResponse, LoginChallenge, Org, RegisterPayload, User } from './types/auth'

// Source de vérité des formes auth = types/auth (fidèles à l'API). On les
// re-exporte pour les consommateurs historiques (Layout/MyOrgs : `Org` ;
// permissions/Header : `User`). Une organisation = une ÉQUIPE ; un compte solo
// a organizations: [].
export type { AuthResponse, LoginChallenge, Org, RegisterPayload, User }

interface AuthState {
  user: User | null
  loading: boolean
  activeOrg: Org | null
  setActiveOrg: (org: Org) => void
  // login/loginWithGoogle : renvoient un LoginChallenge si la 2FA est requise
  // (aucun token posé alors — l'appelant doit finir via finish2fa), sinon null.
  login: (email: string, password: string) => Promise<LoginChallenge | null>
  loginWithGoogle: (credential: string) => Promise<LoginChallenge | null>
  // Finalise une connexion 2FA : applique le token + le user renvoyés par
  // /api/auth/2fa/login/*.
  finish2fa: (resp: AuthResponse) => void
  register: (payload: RegisterPayload) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState>(null as any)

function pickActiveOrg(user: User): Org | null {
  // Garde SSR : pas de localStorage côté Node (prérendu). N'est de toute façon
  // atteint que via des effets/handlers, jamais au rendu serveur.
  const savedId = typeof window === 'undefined' ? 0 : Number(localStorage.getItem('cbsaas_org') || 0)
  return user.organizations.find(o => o.id === savedId) || user.organizations[0] || null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [activeOrg, setActive] = useState<Org | null>(null)
  const [loading, setLoading] = useState(true)

  // Normalise les champs facturation : garantit que billing_grouping /
  // is_billing_enabled / owned_org_ids sont toujours présents pour les
  // consommateurs (canSeeBilling, page Billing), même si une réponse historique
  // ou le prérendu SSR les omet. Défaut billing-OFF => comportement actuel (gratuit).
  function normalizeUser(u: User): User {
    return {
      ...u,
      billing_grouping: u.billing_grouping ?? 'total',
      is_billing_enabled: u.is_billing_enabled ?? false,
      owned_org_ids:
        u.owned_org_ids ?? u.organizations.filter(o => o.is_owner).map(o => o.id),
      twofa_enabled: u.twofa_enabled ?? false,
      twofa_required: u.twofa_required ?? u.is_superadmin ?? false,
      // Défaut vérifié si une réponse historique/SSR l'omet : évite d'afficher la
      // bannière à tort (la vraie valeur vient de l'API).
      email_verified: u.email_verified ?? true,
    }
  }

  function applyUser(u: User) {
    const normalized = normalizeUser(u)
    setUser(normalized)
    setActive(pickActiveOrg(normalized))
  }

  useEffect(() => {
    async function init() {
      try {
        if (getToken()) {
          applyUser(await api<User>('/api/auth/me'))
          return
        }
        // Auto-login admin : convenance DEV, tentée UNIQUEMENT sur un hôte LOCAL.
        // En prod (chapote.fr) la condition est fausse à l'EXÉCUTION -> aucune
        // requête dev-login, donc aucun 404 console (Best Practices).
        // NB : on NE se fie PAS à import.meta.env.DEV — le build de prod sous Bun
        // le laisse à `true` (quirk vite+bun), un test d'hôte runtime est fiable.
        // Opt-out (tests E2E) : localStorage kc_no_autologin.
        const host = typeof window === 'undefined' ? '' : window.location.hostname
        if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
          if (localStorage.getItem('kc_no_autologin')) return
          const data = await api<AuthResponse>('/api/auth/dev-login', { method: 'POST' })
          setToken(data.access_token)
          applyUser(data.user)
        }
      } catch {
        setToken(null)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  function setActiveOrg(org: Org) {
    if (typeof window !== 'undefined') localStorage.setItem('cbsaas_org', String(org.id))
    setActive(org)
  }

  // Réponse de login : soit un AuthResponse (token), soit un LoginChallenge
  // (2FA requise). On distingue par la présence de `twofa_required`.
  function handleAuthResult(data: AuthResponse | LoginChallenge): LoginChallenge | null {
    if ((data as LoginChallenge).twofa_required) return data as LoginChallenge
    const ok = data as AuthResponse
    setToken(ok.access_token)
    applyUser(ok.user)
    return null
  }

  async function login(email: string, password: string) {
    const data = await api<AuthResponse | LoginChallenge>(
      '/api/auth/login', { method: 'POST', body: { email, password } })
    return handleAuthResult(data)
  }

  async function loginWithGoogle(credential: string) {
    const data = await api<AuthResponse | LoginChallenge>(
      '/api/auth/google', { method: 'POST', body: { credential } })
    return handleAuthResult(data)
  }

  // Finalise une connexion 2FA (token issu de /api/auth/2fa/login/*).
  function finish2fa(resp: AuthResponse) {
    setToken(resp.access_token)
    applyUser(resp.user)
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
    <AuthContext.Provider value={{ user, loading, activeOrg, setActiveOrg, login, loginWithGoogle, finish2fa, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
