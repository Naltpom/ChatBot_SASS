// Version web : pas de partage depuis la galerie.
import { createContext, useContext, type ReactNode } from 'react'
export interface SharedFile { path: string; mimeType?: string | null; fileName?: string | null; size?: number | null; duration?: number | null }
const Ctx = createContext<{ file: SharedFile | null; reset: () => void }>({ file: null, reset: () => {} })
export const shareAvailable = false
export function ShareProvider({ children }: { children: ReactNode }) { return <>{children}</> }
export const useSharedVideo = () => useContext(Ctx)
