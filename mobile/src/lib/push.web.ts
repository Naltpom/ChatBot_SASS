// Version web (captures d'écran de démonstration) : pas de notifications.
export type PushPrefs = { published: boolean; failed: boolean; draft: boolean; comments: boolean; storage?: boolean }
export interface PushState { enabled: boolean; prefs: PushPrefs }
const prefs: PushPrefs = { published: true, failed: true, draft: true, comments: true, storage: true }
export const pushUnsupported = (): string | null => null
export const getPush = async (): Promise<PushState> => ({ enabled: false, prefs })
export const setPushPrefs = async (p: Partial<PushPrefs>): Promise<PushState> => ({ enabled: true, prefs: { ...prefs, ...p } })
export const disablePush = async (): Promise<PushState> => ({ enabled: false, prefs })
export async function enablePush(): Promise<PushState | string> { return { enabled: true, prefs } }
export async function autoEnablePush(): Promise<void> {}
export function usePushRouting() {}
