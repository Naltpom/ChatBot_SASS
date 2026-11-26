// Session (compte partagé avec chapote.fr : cookie httpOnly posé par l'API) et périmètre affiché.
// Plus d'« espaces » visibles : « Tous » = mes comptes + les groupes partagés avec moi (tous espaces
// confondus), ou quelques groupes, ou un seul compte. Gardé dans le navigateur.
// `org` reste l'espace « où agir » (gestion, nouvelle publication) : celui du compte ou du groupe
// choisi, sinon mon espace perso. Chaque action sur un élément utilise l'espace de son compte (`orgOf`).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ALL, getAccounts, getCapabilities, getConfig, getGroups, getInvitations, getMe, getSpaces, logout as apiLogout, publicConfig,
  type Account, type Capabilities, type CmRole, type Config, type Group, type Me, type Scope, type Space,
} from './api'
import { t } from './i18n'

interface SessionCtx {
  me: Me | null
  ready: boolean
  googleClientId: string | null
  appUrl: string
  config: Config | null
  spaces: Space[]
  /** Espaces utiles (avec des comptes, ou celui ouvert). En arrière-plan seulement. */
  visibleSpaces: Space[]
  /** Espace où agir (voir en tête). */
  org: number | null
  /** Change l'espace où agir (après une connexion de compte, de Drive…) ; garde le choix affiché. */
  setOrg: (org: number | null) => void
  /** Tous mes groupes (les miens et ceux partagés avec moi), chacun avec son `org_id`. */
  groups: Group[]
  /** Groupes affichés (vide = tous). */
  picked: number[]
  /** Le groupe affiché quand il n'y en a qu'un. */
  group: Group | null
  /** Affiche un seul groupe (null = Tous). */
  setGroup: (id: number | null) => void
  /** Ajoute ou retire un groupe des groupes affichés. */
  toggleGroup: (id: number) => void
  /** Un seul compte affiché ("tiktok:12"), ou null. Exclusif avec les groupes. */
  account: string | null
  setAccount: (key: string | null) => void
  reloadGroups: () => Promise<void>
  /** Tous mes comptes visibles (annotés : org_id, owner, mine, role). */
  accounts: Account[]
  caps: Capabilities | null
  /** Espace d'un compte (pour agir sur un de ses éléments). */
  orgOf: (platform: string, id: number) => number | null
  /** Mon rôle sur un compte. */
  roleOf: (platform: string, id: number) => CmRole
  /** Nom d'espace affiché pour un groupe ou un compte qui n'est pas à moi (« de Nathan »), sinon null. */
  ownerOf: (x: { org_id?: number | null }) => string | null
  invitations: number
  scope: Scope
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionCtx | null>(null)
const SEL_KEY = 'cm.sel'
const HOME_KEY = 'cm.org'
type Sel = { groups: number[]; account: string | null }

function readSel(): Sel {
  try {
    const v = JSON.parse(localStorage.getItem(SEL_KEY) || 'null')
    if (v && Array.isArray(v.groups)) return { groups: v.groups.filter((x: unknown) => typeof x === 'number'), account: typeof v.account === 'string' ? v.account : null }
  } catch { /* rien */ }
  return { groups: [], account: null }
}
function writeSel(v: Sel) {
  try { localStorage.setItem(SEL_KEY, JSON.stringify(v)) } catch { /* stockage indisponible */ }
}
function readHome(): number | null {
  try { const v = localStorage.getItem(HOME_KEY); return v ? Number(v) || null : null } catch { return null }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [googleClientId, setGoogle] = useState<string | null>(null)
  const [appUrl, setAppUrl] = useState('https://chapote.fr')
  const [config, setConfig] = useState<Config | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [home, setHome] = useState<number | null>(readHome)
  const [groups, setGroups] = useState<Group[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [invitations, setInvitations] = useState(0)
  const [sel, setSelState] = useState<Sel>(readSel)
  const setSel = (v: Sel) => { setSelState(v); writeSel(v) }

  const refresh = useCallback(async () => {
    try {
      const m = await getMe()
      setMe(m)
      const [c, s] = await Promise.all([getConfig(), getSpaces()])
      setConfig(c)
      setSpaces(s)
      setHome(cur => (cur != null && !s.some(x => x.org_id === cur) ? null : cur))
    } catch {
      setMe(null)
    } finally {
      setReady(true)
    }
  }, [])

  const reloadGroups = useCallback(async () => {
    if (!me) { setGroups([]); return }
    try {
      const [g, a, cp, inv] = await Promise.all([
        getGroups(ALL), getAccounts(ALL).catch(() => [] as Account[]), getCapabilities().catch(() => null),
        getInvitations().catch(() => []),
      ])
      setGroups(g)
      setAccounts(a)
      setCaps(cp)
      setInvitations(inv.length)
      setSelState(cur => {
        const next = {
          groups: cur.groups.filter(id => g.some(x => x.id === id)),
          account: cur.account && a.some(x => `${x.platform}:${x.id}` === cur.account) ? cur.account : null,
        }
        if (next.groups.length !== cur.groups.length || next.account !== cur.account) writeSel(next)
        return next
      })
    } catch { setGroups([]) }
  }, [me])

  useEffect(() => {
    refresh()
    publicConfig().then(c => { setGoogle(c.google_client_id); setAppUrl(c.app_url) }).catch(() => {})
  }, [refresh])
  useEffect(() => { reloadGroups() }, [reloadGroups, spaces])

  const byKey = useMemo(() => new Map(accounts.map(a => [`${a.platform}:${a.id}`, a])), [accounts])
  const orgOf = useCallback((platform: string, id: number) => byKey.get(`${platform}:${id}`)?.org_id ?? null, [byKey])
  const roleOf = useCallback((platform: string, id: number): CmRole => byKey.get(`${platform}:${id}`)?.role || 'admin', [byKey])
  const ownerOf = useCallback((x: { org_id?: number | null }) => {
    if (x.org_id == null) return null
    const sp = spaces.find(s => s.org_id === x.org_id)
    return sp && !sp.owner ? sp.owner_name || sp.name : null
  }, [spaces])

  const account = sel.account
  const pickedGroups = groups.filter(g => sel.groups.includes(g.id))
  const group = !account && pickedGroups.length === 1 ? pickedGroups[0] : null
  // Espace où agir : celui du compte / du groupe choisi, sinon celui gardé, sinon perso (ou le seul espace qui a des comptes).
  const org = useMemo(() => {
    if (account && byKey.has(account)) return byKey.get(account)!.org_id ?? null
    if (group) return group.org_id ?? null
    if (home != null) return home
    const perso = spaces.find(s => s.org_id == null)
    if (perso && (perso.accounts || 0) > 0) return null
    // Mes comptes sont dans une équipe que j'administre (ancien modèle) : on agit là ; sinon dans mon espace perso.
    return spaces.find(s => s.org_id != null && (s.accounts || 0) > 0 && s.cm_role === 'admin' && s.owner)?.org_id ?? null
  }, [account, byKey, group, home, spaces])

  const setOrg = (v: number | null) => {
    setHome(v)
    try { v == null ? localStorage.removeItem(HOME_KEY) : localStorage.setItem(HOME_KEY, String(v)) } catch { /* rien */ }
  }
  const setGroup = (id: number | null) => setSel({ groups: id == null ? [] : [id], account: null })
  const toggleGroup = (id: number) => setSel({ groups: sel.groups.includes(id) ? sel.groups.filter(x => x !== id) : [...sel.groups, id], account: null })
  const setAccount = (key: string | null) => setSel({ groups: key ? [] : sel.groups, account: key })
  const signOut = async () => { try { await apiLogout() } finally { cache.clear(); setMe(null) } }

  const scope = useMemo<Scope>(() => {
    if (account) {
      const a = byKey.get(account)
      const [p, id] = account.split(':')
      return a ? { org: null, group: null, scope: `acc:${p}:${id}` } : ALL
    }
    if (pickedGroups.length) return { org: null, group: null, scope: pickedGroups.map(g => `group:${g.id}`).join(',') }
    return ALL
  }, [account, byKey, pickedGroups.map(g => g.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const visibleSpaces = useMemo(() => {
    const v = spaces.filter(x => (x.accounts || 0) > 0 || x.org_id === org)
    return v.length ? v : spaces.slice(0, 1)
  }, [spaces, org])

  return (
    <Ctx.Provider value={{ me, ready, googleClientId, appUrl, config, spaces, visibleSpaces, org, setOrg, groups,
      picked: pickedGroups.map(g => g.id), group, setGroup, toggleGroup,
      account, setAccount, accounts, caps, orgOf, roleOf, ownerOf, invitations,
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
      .catch(e => { if (alive) setError(e?.message || t('Erreur')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [key, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: () => setTick(n => n + 1), setData }
}

/** Vide le cache (déconnexion). */
export const clearCache = () => cache.clear()

/** Ce que je peux faire. `canEdit` : publier sur au moins un compte affiché (ou le compte choisi) ;
 *  `canAdmin` : gérer l'espace où j'agis (comptes, groupes, bibliothèque). */
export function useRole() {
  const { spaces, org, caps, account, roleOf } = useSession()
  const role = spaces.find(s => s.org_id === org)?.cm_role || 'admin'
  let canEdit = role !== 'viewer'
  if (account) { const [p, id] = account.split(':'); canEdit = roleOf(p, Number(id)) !== 'viewer' }
  else if (caps) canEdit = caps.can_publish_any
  return { role, canEdit, canAdmin: role === 'admin' }
}
