// Session (compte partagé avec chapote.fr : cookie httpOnly posé par l'API) et périmètre affiché :
// un espace (perso ou une équipe) et, éventuellement, un groupe de comptes. Gardés dans le navigateur.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getConfig, getGroups, getMe, getSpaces, logout as apiLogout, publicConfig,
  type Config, type Group, type Me, type Scope, type Space,
} from './api'

interface SessionCtx {
  me: Me | null
  ready: boolean
  googleClientId: string | null
  appUrl: string
  config: Config | null
  spaces: Space[]
  org: number | null
  setOrg: (org: number | null) => void
  groups: Group[]
  group: Group | null
  setGroup: (id: number | null) => void
  reloadGroups: () => Promise<void>
  scope: Scope
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionCtx | null>(null)
const ORG_KEY = 'cm.org'
const groupKey = (org: number | null) => `cm.group.${org ?? 'perso'}`

function read(key: string): number | null {
  try {
    const v = localStorage.getItem(key)
    return v ? Number(v) || null : null
  } catch { return null }
}
function write(key: string, v: number | null) {
  try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, String(v)) } catch { /* stockage indisponible */ }
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
  const [groupId, setGroupId] = useState<number | null>(() => read(groupKey(read(ORG_KEY))))

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

  const reloadGroups = useCallback(async () => {
    if (!me) { setGroups([]); return }
    try {
      const g = await getGroups(org)
      setGroups(g)
      setGroupId(cur => (cur != null && !g.some(x => x.id === cur) ? null : cur))
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
  }
  const setGroup = (id: number | null) => { setGroupId(id); write(groupKey(org), id) }
  const signOut = async () => { try { await apiLogout() } finally { cache.clear(); setMe(null) } }

  const group = groups.find(g => g.id === groupId) || null
  const scope = useMemo<Scope>(() => ({ org, group: group?.id ?? null }), [org, group?.id])

  return (
    <Ctx.Provider value={{ me, ready, googleClientId, appUrl, config, spaces, org, setOrg, groups, group, setGroup,
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
