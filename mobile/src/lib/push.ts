// Notifications : permission, jeton Expo envoyé à l'API (PUT /api/cm/mobile/push), ouverture du bon
// écran quand on touche une notification. Android dans Expo Go : pas de notifications distantes
// (build de développement nécessaire), l'app le dit dans Réglages.
import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { API_URL, ApiError, currentDevice } from './http'

export type PushPrefs = { published: boolean; failed: boolean; draft: boolean; comments: boolean; storage?: boolean }
export interface PushState { enabled: boolean; prefs: PushPrefs }

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
})

export const pushUnsupported = (): string | null => {
  if (!Device.isDevice) return 'Les notifications ne marchent que sur un vrai téléphone.'
  if (Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient)
    return 'Sur Android, Expo Go ne reçoit pas les notifications : il faudra l’app installée (build de développement).'
  return null
}

async function api<T>(method: 'GET' | 'PUT', body?: Record<string, unknown>): Promise<T> {
  const token = currentDevice()
  if (!token) throw new ApiError(401, 'Connectez-vous.')
  const url = `${API_URL}/api/cm/mobile/push` + (method === 'GET' ? `?refresh_token=${encodeURIComponent(token)}` : '')
  const res = await fetch(url, {
    method, credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: method === 'PUT' ? JSON.stringify({ refresh_token: token, ...body }) : undefined,
  })
  if (!res.ok) throw new ApiError(res.status, 'Réglage des notifications impossible')
  return await res.json() as T
}

export const getPush = () => api<PushState>('GET')
export const setPushPrefs = (prefs: Partial<PushPrefs>) => api<PushState>('PUT', { prefs })
export const disablePush = () => api<PushState>('PUT', { push_token: '' })

/** Demande la permission et enregistre le jeton. Renvoie un message si c'est impossible. */
export async function enablePush(): Promise<PushState | string> {
  const why = pushUnsupported()
  if (why) return why
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Publications et commentaires', importance: Notifications.AndroidImportance.DEFAULT })
  }
  let { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return 'Notifications refusées : autorisez-les dans les réglages du téléphone.'
  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? Constants.easConfig?.projectId
  try {
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data
    return await api<PushState>('PUT', { push_token: token })
  } catch {
    return 'Impossible d’obtenir le jeton de notifications pour ce téléphone.'
  }
}

/** Toucher une notification ouvre la publication ou les commentaires. */
export function usePushRouting() {
  const router = useRouter()
  const last = Notifications.useLastNotificationResponse()
  useEffect(() => {
    const data = last?.notification.request.content.data as Record<string, any> | undefined
    if (!data) return
    if (data.type === 'comment') router.push('/comments')
    else if (data.type === 'storage') router.push('/storage')
    else if (data.post_id) router.push({ pathname: '/post/[id]', params: { id: String(data.post_id) } })
  }, [last, router])
}
