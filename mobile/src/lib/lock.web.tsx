// Version web : pas de verrouillage (l'interrupteur reste visible pour les captures).
import { createContext, useContext, useState, type ReactNode } from 'react'
interface LockCtx { enabled: boolean; supported: boolean; label: string; setEnabled: (v: boolean) => Promise<string | null> }
const Ctx = createContext<LockCtx>({ enabled: false, supported: true, label: 'Empreinte ou visage', setEnabled: async () => null })
export const useLock = () => useContext(Ctx)
export function LockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false)
  return <Ctx.Provider value={{ enabled, supported: true, label: 'Empreinte ou visage', setEnabled: async v => { setEnabled(v); return null } }}>{children}</Ctx.Provider>
}
