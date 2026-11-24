// Session de l'app (même rôle que cm/src/session.tsx) : utilisateur, espace (perso ou équipe),
// groupe de comptes ou compte affiché, configuration. Le choix d'espace est gardé sur le téléphone.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import {
  getAccounts, getConfig, getGroups, getMe, getSpaces,
  type Account, type Config, type Group, type Me, type Scope, type Space,
} from './api'
import { loadDevice, onSignedOut } from './http'
import { logout as authLogout } from './auth'

interface SessionCtx {
  me: Me | null
  ready: boolean
  config: Config | null
  spaces: Space[]
  visibleSpaces: Space[]
  org: number | null
  setOrg: (org: number | null) => void
  groups: Group[]
  group: Group | null
  setGroup: (id: number | null) => void
  account: string | null
  setAccount: (key: string | null) => void
  accounts: Account[]
  reloadGroups: () => Promise<void>
  scope: Scope
  refresh: () => Promise<void>
  signedIn: (me: Me) => void
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionCtx | null>(null)
const ORG_KEY = 'cm.org'
const groupKey = (org: number | null) => `cm.group.${org ?? 'perso'}`
const accountKey = (org: number | null) => `cm.account.${org ?? 'perso'}`
const write = (key: string, v: number | string | null) =>
  (v == null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, String(v))).catch(() => {})
const readNum = async (key: string) => { const v = await AsyncStorage.getItem(key).catch(() => null); return v ? Number(v) || null : null }

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<Config | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [org, setOrgState] = useState<number | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [groupId, setGroupId] = useState<number | null>(null)
  const [account, setAccountState] = useState<string | null>(null)
  const loaded = useRef(false)
  // Espace choisi à la main (perso compris) : jamais remplacé automatiquement.
  const chosen = useRef(false)

  const refresh = useCallback(async () => {
    try {
      if (!loaded.current) {
        loaded.current = true
        const raw = await AsyncStorage.getItem(ORG_KEY).catch(() => null)
        chosen.current = raw != null
        const o = raw && raw !== 'perso' ? Number(raw) || null : null
        setOrgState(o)
        setGroupId(await readNum(groupKey(o)))
        setAccountState(await AsyncStorage.getItem(accountKey(o)).catch(() => null))
        if (!(await loadDevice())) { setMe(null); return }
      }
      const m = await getMe()
      setMe(m)
      const [c, s] = await Promise.all([getConfig(), getSpaces()])
      setConfig(c)
      setSpaces(s)
      setOrgState(cur => {
        let next = cur != null && !s.some(x => x.org_id === cur) ? null : cur
        const here = s.find(x => x.org_id === next)
        if (here && !here.accounts && !chosen.current) {
          const other = s.find(x => x.org_id !== next && (x.accounts || 0) > 0)
          if (other) next = other.org_id
        }
        if (next !== cur) write(ORG_KEY, next ?? (chosen.current ? 'perso' : null))
        return next
      })
    } catch (e: any) {
      if (e?.status === 401) setMe(null)
    } finally {
      setReady(true)
    }
  }, [])

  const reloadGroups = useCallback(async () => {
    if (!me) { setGroups([]); setAccounts([]); return }
    try {
      const [g, a] = await Promise.all([getGroups(org), getAccounts(org).catch(() => [] as Account[])])
      setGroups(g)
      setAccounts(a)
      setGroupId(cur => (cur != null && !g.some(x => x.id === cur) ? null : cur))
      setAccountState(cur => (cur && !a.some(x => `${x.platform}:${x.id}` === cur) ? null : cur))
    } catch { setGroups([]) }
  }, [me, org])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { reloadGroups() }, [reloadGroups])
  useEffect(() => onSignedOut(() => { clearCache(); setMe(null) }), [])
  // Retour dans l'app : espaces et comptes relus (connexion d'un compte faite dans le navigateur…).
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active' && me) { refresh(); reloadGroups() } })
    return () => sub.remove()
  }, [me, refresh, reloadGroups])

  const setOrg = (v: number | null) => {
    chosen.current = true
    setOrgState(v)
    write(ORG_KEY, v ?? 'perso')
    readNum(groupKey(v)).then(setGroupId)
    AsyncStorage.getItem(accountKey(v)).then(setAccountState).catch(() => setAccountState(null))
  }
  const setGroup = (id: number | null) => {
    setGroupId(id); write(groupKey(org), id)
    setAccountState(null); write(accountKey(org), null)
  }
  const setAccount = (key: string | null) => {
    setAccountState(key); write(accountKey(org), key)
    if (key) { setGroupId(null); write(groupKey(org), null) }
  }
  const signedIn = (m: Me) => { setMe(m); setReady(false); refresh() }
  const signOut = async () => { await authLogout(); clearCache(); setMe(null) }

  const group = groups.find(g => g.id === groupId) || null
  const scope = useMemo<Scope>(() => ({ org, group: account ? null : group?.id ?? null, account }), [org, group?.id, account])
  const visibleSpaces = useMemo(() => {
    const v = spaces.filter(x => (x.accounts || 0) > 0 || x.org_id === org)
    return v.length ? v : spaces.slice(0, 1)
  }, [spaces, org])

  return (
    <Ctx.Provider value={{ me, ready, config, spaces, visibleSpaces, org, setOrg, groups, group, setGroup,
      account, setAccount, accounts, reloadGroups, scope, refresh, signedIn, signOut }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('SessionProvider manquant')
  return c
}

// Cache mémoire des lectures : un écran revisité s'affiche aussitôt, puis se met à jour.
const cache = new Map<string, unknown>()
export const clearCache = () => cache.clear()

/** Charge une ressource liée au périmètre courant ; `reload()` la relit (tirer pour actualiser). */
export function useLoad<T>(fn: (scope: Scope) => Promise<T>, deps: unknown[] = [], key = '') {
  const { scope, me } = useSession()
  const k = `${key || fn.toString()}|${JSON.stringify(scope)}|${JSON.stringify(deps)}`
  const [data, setData] = useState<T | null>(() => (cache.get(k) as T) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!me) return
    let alive = true
    setLoading(true)
    if (cache.has(k)) setData(cache.get(k) as T)
    fn(scope).then(d => { cache.set(k, d); if (alive) { setData(d); setError(null) } })
      .catch(e => { if (alive) setError(e?.message || 'Erreur') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [k, tick, me]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: () => setTick(t => t + 1), setData }
}

/** Rôle cm dans l'espace courant (perso = admin) et ce qu'il permet. */
export function useRole() {
  const { spaces, org } = useSession()
  const role = spaces.find(s => s.org_id === org)?.cm_role || 'admin'
  return { role, canEdit: role !== 'viewer', canAdmin: role === 'admin' }
}
