// Session (compte partagé avec chapote.fr : cookie httpOnly posé par l'API) et périmètre affiché :
// un espace (perso ou une équipe) et, éventuellement, un groupe de comptes. Gardés dans le navigateur.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getAccounts, getConfig, getGroups, getMe, getSpaces, logout as apiLogout, publicConfig,
  type Account, type Config, type Group, type Me, type Scope, type Space,
} from './api'

interface SessionCtx {
  me: Me | null
  ready: boolean
  googleClientId: string | null
  appUrl: string
  config: Config | null
  spaces: Space[]
  /** Espaces utiles (avec des comptes, ou celui ouvert) : un seul, la plupart du temps. */
  visibleSpaces: Space[]
  org: number | null
  setOrg: (org: number | null) => void
  groups: Group[]
  group: Group | null
  setGroup: (id: number | null) => void
  /** Un seul compte affiché ("tiktok:12"), ou null. Exclusif avec le groupe. */
  account: string | null
  setAccount: (key: string | null) => void
  reloadGroups: () => Promise<void>
  /** Comptes de l'espace (pour le sélecteur). */
  accounts: Account[]
  scope: Scope
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionCtx | null>(null)
const ORG_KEY = 'cm.org'
const groupKey = (org: number | null) => `cm.group.${org ?? 'perso'}`
const accountKey = (org: number | null) => `cm.account.${org ?? 'perso'}`

function read(key: string): number | null {
  try {
    const v = localStorage.getItem(key)
    return v ? Number(v) || null : null
  } catch { return null }
}
function write(key: string, v: number | string | null) {
  try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, String(v)) } catch { /* stockage indisponible */ }
}
function readStr(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [googleClientId, setGoogle] = useState<string | null>(null)
  const [appUrl, setAppUrl] = useState('https://chapote.fr')
  const [config, setConfig] = useState<Config | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [org, setOrgState] = useState<number | null>(() => read(ORG_KEY))
  const [groups, setGroups] = useState<Group[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [groupId, setGroupId] = useState<number | null>(() => read(groupKey(read(ORG_KEY))))
  const [account, setAccountState] = useState<string | null>(() => readStr(accountKey(read(ORG_KEY))))

  const refresh = useCallback(async () => {
    try {
      const m = await getMe()
      setMe(m)
      const [c, s] = await Promise.all([getConfig(), getSpaces()])
      setConfig(c)
      setSpaces(s)
      setOrgState(cur => {
        let next = cur != null && !s.some(x => x.org_id === cur) ? null : cur
        // Espace perso vide (ex. devenu partagé) : on ouvre le premier espace qui a des comptes.
        const here = s.find(x => x.org_id === next)
        if (here && !here.accounts) {
          const other = s.find(x => x.org_id !== next && (x.accounts || 0) > 0)
          if (other) next = other.org_id
        }
        if (next !== cur) write(ORG_KEY, next)
        return next
      })
    } catch {
      setMe(null)
    } finally {
      setReady(true)
    }
  }, [])

  const reloadGroups = useCallback(async () => {
    if (!me) { setGroups([]); return }
    try {
      const [g, a] = await Promise.all([getGroups(org), getAccounts(org).catch(() => [] as Account[])])
      setGroups(g)
      setAccounts(a)
      setGroupId(cur => (cur != null && !g.some(x => x.id === cur) ? null : cur))
      setAccountState(cur => (cur && !a.some(x => `${x.platform}:${x.id}` === cur) ? null : cur))
    } catch { setGroups([]) }
  }, [me, org])

  useEffect(() => {
    refresh()
    publicConfig().then(c => { setGoogle(c.google_client_id); setAppUrl(c.app_url) }).catch(() => {})
  }, [refresh])
  useEffect(() => { reloadGroups() }, [reloadGroups])

  const setOrg = (v: number | null) => {
    setOrgState(v)
    write(ORG_KEY, v)
    setGroupId(read(groupKey(v)))
    setAccountState(readStr(accountKey(v)))
  }
  const setGroup = (id: number | null) => {
    setGroupId(id); write(groupKey(org), id)
    setAccountState(null); write(accountKey(org), null)
  }
  const setAccount = (key: string | null) => {
    setAccountState(key); write(accountKey(org), key)
    if (key) { setGroupId(null); write(groupKey(org), null) }
  }
  const signOut = async () => { try { await apiLogout() } finally { cache.clear(); setMe(null) } }

  const group = groups.find(g => g.id === groupId) || null
  const scope = useMemo<Scope>(() => ({ org, group: account ? null : group?.id ?? null, account }), [org, group?.id, account])
  const visibleSpaces = useMemo(() => {
    const v = spaces.filter(x => (x.accounts || 0) > 0 || x.org_id === org)
    return v.length ? v : spaces.slice(0, 1)
  }, [spaces, org])

  return (
    <Ctx.Provider value={{ me, ready, googleClientId, appUrl, config, spaces, visibleSpaces, org, setOrg, groups, group, setGroup,
      account, setAccount, accounts,
      reloadGroups, scope, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('SessionProvider manquant')
  return c
}

// Cache mémoire des lectures : une page revisitée s'affiche aussitôt avec ses dernières données,
// puis se met à jour en arrière-plan (« stale-while-revalidate »).
const cache = new Map<string, unknown>()

/** Charge une ressource liée au périmètre courant (espace + groupe) ; `reload()` la relit. */
export function useLoad<T>(fn: (scope: Scope) => Promise<T>, deps: unknown[] = []) {
  const { scope } = useSession()
  const key = `${fn.toString()}|${JSON.stringify(scope)}|${JSON.stringify(deps)}`
  const [data, setData] = useState<T | null>(() => (cache.get(key) as T) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    if (cache.has(key)) setData(cache.get(key) as T)
    fn(scope).then(d => { cache.set(key, d); if (alive) { setData(d); setError(null) } })
      .catch(e => { if (alive) setError(e?.message || 'Erreur') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [key, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: () => setTick(t => t + 1), setData }
}

/** Vide le cache (déconnexion). */
export const clearCache = () => cache.clear()

/** Rôle cm dans l'espace courant (perso = admin) et ce qu'il permet. */
export function useRole() {
  const { spaces, org } = useSession()
  const role = spaces.find(s => s.org_id === org)?.cm_role || 'admin'
  return { role, canEdit: role !== 'viewer', canAdmin: role === 'admin' }
}
