// Informations d'inscription de l'utilisateur connecté (prénom, nom, naissance, conditions acceptées).
// null : pas encore lues. En cas d'erreur réseau, on ne bloque pas l'app (done = true par défaut).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getIdentity, type Identity } from './api'
import { useSession } from './session'

type Ctx = { identity: Identity | null; reload: () => Promise<Identity | null>; set: (i: Identity) => void }
const C = createContext<Ctx>({ identity: null, reload: async () => null, set: () => {} })

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { me } = useSession()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const reload = useCallback(async () => {
    try { const i = await getIdentity(); setIdentity(i); return i }
    catch (e: any) {
      // Serveur pas encore à jour (404) ou hors ligne : on laisse entrer.
      const fallback = { done: true, blocked_until: null } as Identity
      setIdentity(cur => cur ?? fallback)
      return null
    }
  }, [])
  useEffect(() => { setIdentity(null); if (me?.id) reload() }, [me?.id, reload])
  return <C.Provider value={{ identity, reload, set: setIdentity }}>{children}</C.Provider>
}

export const useIdentity = () => useContext(C)
