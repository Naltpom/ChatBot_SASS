// Connexion Google native (choix du compte du téléphone). Seulement dans l'app installée : Expo Go n'a
// pas ce module, l'écran de connexion passe alors par la page de cm.chapote.fr.
import Constants, { ExecutionEnvironment } from 'expo-constants'

const extra = (Constants.expoConfig?.extra || {}) as { googleWebClientId?: string; googleIosClientId?: string }
export const nativeGoogleAvailable = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient && !!extra.googleWebClientId

/** Jeton d'identité Google (audience : Client ID web du site, déjà accepté par /api/auth/google), ou null si annulé. */
export async function googleIdToken(): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GoogleSignin, isSuccessResponse } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin')
  GoogleSignin.configure({ webClientId: extra.googleWebClientId, iosClientId: extra.googleIosClientId })
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
  const r = await GoogleSignin.signIn()
  if (!isSuccessResponse(r)) return null
  // Un autre compte au prochain essai : on ne garde pas la session Google dans l'app.
  GoogleSignin.signOut().catch(() => {})
  return r.data.idToken
}
