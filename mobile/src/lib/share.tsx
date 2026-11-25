// « Partager → Chapote CM » depuis la galerie (app installée seulement : Expo Go n'a pas ce module).
// La vidéo partagée ouvre la nouvelle publication avec ce fichier.
import Constants, { ExecutionEnvironment } from 'expo-constants'
import { createContext, useContext, type ReactNode } from 'react'

export interface SharedFile { path: string; mimeType?: string | null; fileName?: string | null; size?: number | null; duration?: number | null }
interface ShareCtx { file: SharedFile | null; reset: () => void }
const Ctx = createContext<ShareCtx>({ file: null, reset: () => {} })
export const shareAvailable = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient

function Inner({ children, mod }: { children: ReactNode; mod: any }) {
  const { shareIntent, resetShareIntent } = mod.useShareIntentContext()
  const files = (shareIntent?.files || []) as SharedFile[]
  const file = files.find(f => (f.mimeType || '').startsWith('video/')) || null
  return <Ctx.Provider value={{ file, reset: resetShareIntent }}>{children}</Ctx.Provider>
}

export function ShareProvider({ children }: { children: ReactNode }) {
  if (!shareAvailable) return <>{children}</>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('expo-share-intent')
  return <mod.ShareIntentProvider options={{ resetOnBackground: false }}><Inner mod={mod}>{children}</Inner></mod.ShareIntentProvider>
}

export const useSharedVideo = () => useContext(Ctx)
