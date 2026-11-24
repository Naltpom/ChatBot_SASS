import { Stack, useRouter, useSegments } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SessionProvider, useSession } from '../lib/session'
import { usePushRouting } from '../lib/push'
import { useAppUpdate } from '../lib/app-update'
import { ThemeProvider, useTheme } from '../ui/theme'

SplashScreen.preventAutoHideAsync().catch(() => {})

function Gate() {
  const { me, ready, spaces } = useSession()
  const { c, dark } = useTheme()
  const segments = useSegments()
  const router = useRouter()
  usePushRouting()
  useAppUpdate()

  useEffect(() => { SystemUI.setBackgroundColorAsync(c.bg).catch(() => {}) }, [c.bg])
  useEffect(() => {
    if (!ready) return
    SplashScreen.hideAsync().catch(() => {})
    const onLogin = segments[0] === 'login'
    // Aucun réseau connecté dans aucun espace : écran d'accueil (sauf pages utiles pour en connecter un).
    const empty = !!me && spaces.length > 0 && spaces.every(s => !(s.accounts || 0))
    const free = ['welcome', 'accounts', 'settings', 'people']
    if (!me && !onLogin) router.replace('/login')
    else if (me && empty && !free.includes(segments[0] as string)) router.replace('/welcome')
    else if (me && onLogin) router.replace('/')
  }, [me, ready, spaces, segments, router])

  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: c.bg }, headerTintColor: c.primary, headerTitleStyle: { color: c.text },
        headerShadowVisible: false, contentStyle: { backgroundColor: c.bg }, headerBackButtonDisplayMode: 'minimal',
      }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ title: 'Bienvenue', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="new" options={{ presentation: 'modal', title: 'Nouvelle publication' }} />
        <Stack.Screen name="post/[id]" options={{ presentation: 'modal', title: 'Publication' }} />
        <Stack.Screen name="video/[id]" options={{ title: 'Fiche vidéo' }} />
        <Stack.Screen name="asset/[id]" options={{ title: 'Vidéo de la bibliothèque' }} />
        <Stack.Screen name="accounts" options={{ title: 'Comptes' }} />
        <Stack.Screen name="people" options={{ title: 'Personnes et partage' }} />
        <Stack.Screen name="drafts" options={{ title: 'Brouillons à valider' }} />
        <Stack.Screen name="videos" options={{ title: 'Vidéos' }} />
        <Stack.Screen name="settings" options={{ title: 'Réglages' }} />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <Gate />
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
