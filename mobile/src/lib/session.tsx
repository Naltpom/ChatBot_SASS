// Session de l'app (même rôle que cm/src/session.tsx) : utilisateur, espace (perso ou équipe),
// groupe de comptes ou compte affiché, configuration. Le choix d'espace est gardé sur le téléphone.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import {
  getAccounts, getAllGroups, getCapabilities, getConfig, getGroups, getInvitations, getMe, getSpaces,
  type Account, type Capability, type Config, type Group, type Invitation, type Me, type Scope, type Space,
} from './api'
import { loadDevice, onSignedOut } from './http'
import { logout as authLogout } from './auth'

interface SessionCtx {
  me: Me | null
  ready: boolean
  config: Config | null
  spaces: Space[]
  visibleSpaces: Space[]
  /** Espace utilisé pour les écritures (réglages, bibliothèque…) : celui de la sélection, sinon l'espace perso. */
  org: number | null
  setOrg: (org: number | null) => void
  /** Tous les groupes visibles (mes espaces + groupes partagés avec moi), avec leur espace. */
  groups: (Group & { org_id: number | null })[]
  group: Group | null
  setGroup: (id: number | null) => void
  account: string | null
  setAccount: (key: string | null) => void
  /** Tous mes comptes + ceux des groupes partagés avec moi (org_id, owner, mine, groups, role). */
  accounts: Account[]
  /** Sélection affichée : ['all'], des groupes ('org:12/group:3'), ou un compte ('acc:tiktok:7'). */
  sel: string[]
  setSel: (sel: string[]) => void
  caps: Capabilities | null
  invitations: Invitation[]
  reloadGroups: () => Promise<void>
  /** Espace d'un compte (pour agir sur un élément vu dans « Tous ») ; à défaut l'espace courant. */
  orgOf: (platform: string, id: number) => number | null
  scope: Scope
  refresh: () => Promise<void>
  signedIn: (me: Me) => void
  signOut: () => Promise<void>
}

type Capabilities = { can_publish_any: boolean; accounts: Capability[] }
const Ctx = createContext<SessionCtx | null>(null)
const SEL_KEY = 'cm.sel'
export const groupToken = (g: { id: number; org_id: number | null }) => g.org_id == null ? `group:${g.id}` : `org:${g.org_id}/group:${g.id}`

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<Config | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [groups, setGroups] = useState<(Group & { org_id: number | null })[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [sel, setSelState] = useState<string[]>(['all'])
  const loaded = useRef(false)

  const refresh = useCallback(async () => {
    try {
      if (!loaded.current) {
        loaded.current = true
        const raw = await AsyncStorage.getItem(SEL_KEY).catch(() => null)
        try { const v = raw ? JSON.parse(raw) : null; if (Array.isArray(v) && v.length) setSelState(v) } catch { /* ancien format */ }
        if (!(await loadDevice())) { setMe(null); return }
      }
      const m = await getMe()
      setMe(m)
      const [c, s] = await Promise.all([getConfig(), getSpaces()])
      setConfig(c)
      setSpaces(s)
      getCapabilities().then(setCaps).catch(() => setCaps(null))
      getInvitations().then(setInvitations).catch(() => setInvitations([]))
    } catch (e: any) {
      if (e?.status === 401) setMe(null)
    } finally {
      setReady(true)
    }
  }, [])

  const reloadGroups = useCallback(async () => {
    if (!me) { setGroups([]); setAccounts([]); return }
    try {
      const [lists, a] = await Promise.all([
        getAllGroups().catch(() => Promise.all(spaces.map(sp => getGroups(sp.org_id).then(gs => gs.map(g => ({ ...g, org_id: sp.org_id }))).catch(() => []))).then(l => l.flat())),
        getAccounts({ org: null, group: null, sel: ['all'] }).catch(() => [] as Account[]),
      ])
      const all = lists
      setGroups(all)
      setAccounts(a)
      // Sélection qui ne correspond plus à rien (groupe supprimé, partage retiré) : retour à « Tous ».
      setSelState(cur => {
        const ok = cur.every(t => t === 'all' || t === 'perso' || t.startsWith('org:') && !t.includes('/group:')
          || all.some(g => groupToken(g) === t) || (t.startsWith('acc:') && a.some(x => `acc:${x.platform}:${x.id}` === t)))
        return ok ? cur : ['all']
      })
    } catch { setGroups([]) }
  }, [me, spaces])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { reloadGroups() }, [reloadGroups])
  useEffect(() => onSignedOut(() => { clearCache(); setMe(null) }), [])
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => { if (st === 'active' && me) { refresh() } })
    return () => sub.remove()
  }, [me, refresh])

  const setSel = (v: string[]) => {
    const next = v.length ? v : ['all']
    setSelState(next)
    AsyncStorage.setItem(SEL_KEY, JSON.stringify(next)).catch(() => {})
  }
  const setOrg = (v: number | null) => setSel([v == null ? 'perso' : `org:${v}`])
  const setGroup = (id: number | null) => {
    const g = id == null ? null : groups.find(x => x.id === id)
    setSel(g ? [groupToken(g)] : ['all'])
  }
  const setAccount = (key: string | null) => setSel(key ? [`acc:${key}`] : ['all'])
  const signedIn = (m: Me) => { setMe(m); setReady(false); refresh() }
  const signOut = async () => { await authLogout(); clearCache(); setMe(null) }

  // Compatibilité avec les écrans : un seul groupe / un seul compte choisi.
  const account = sel.length === 1 && sel[0].startsWith('acc:') ? sel[0].slice(4) : null
  const group = sel.length === 1 ? groups.find(g => groupToken(g) === sel[0]) || null : null
  // Espace des écritures : celui du compte ou des groupes choisis s'ils sont dans un même espace, sinon le perso.
  const org = useMemo(() => {
    const orgs = new Set<number | null>()
    for (const t of sel) {
      if (t.startsWith('acc:')) orgs.add(accounts.find(a => `acc:${a.platform}:${a.id}` === t)?.org_id ?? null)
      else if (t.includes('group:')) orgs.add(groups.find(g => groupToken(g) === t)?.org_id ?? null)
      else if (t.startsWith('org:')) orgs.add(Number(t.slice(4)) || null)
      else orgs.add(null)
    }
    return orgs.size === 1 ? [...orgs][0] : null
  }, [sel, accounts, groups])
  const scope = useMemo<Scope>(() => ({ org: null, group: null, account: null, sel }), [sel])
  const orgOf = useCallback((platform: string, id: number) => {
    const a = accounts.find(x => x.platform === platform && x.id === id)
    return a && a.org_id !== undefined ? a.org_id : org
  }, [accounts, org])
  const visibleSpaces = useMemo(() => {
    const v = spaces.filter(x => (x.accounts || 0) > 0 || x.org_id === org)
    return v.length ? v : spaces.slice(0, 1)
  }, [spaces, org])

  return (
    <Ctx.Provider value={{ me, ready, config, spaces, visibleSpaces, org, setOrg, groups, group, setGroup,
      account, setAccount, accounts, sel, setSel, caps, invitations, reloadGroups, orgOf, scope, refresh, signedIn, signOut }}>
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
  const { spaces, org, caps } = useSession()
  const role = spaces.find(s => s.org_id === org)?.cm_role || 'admin'
  // Publier : au moins un compte où j'ai « Peut publier » ou « Admin » (droits par compte, docs §10).
  const canEdit = caps ? caps.can_publish_any : role !== 'viewer'
  return { role, canEdit, canAdmin: role === 'admin' }
}
