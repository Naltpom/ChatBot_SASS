import '../lib/demo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Stack, useRouter, useSegments } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect, useState, Fragment, type ReactNode } from 'react'
import type { ErrorBoundaryProps } from 'expo-router'
import { installCrashHandler, onCrash, remember } from '../lib/crash'
import { ErrorScreen } from '../ui/ErrorScreen'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SessionProvider, useSession } from '../lib/session'
import { autoEnablePush, usePushRouting } from '../lib/push'
import { laterAt } from '../features/storage'
import { IdentityProvider, useIdentity } from '../lib/identity'
import { ShareProvider, useSharedVideo } from '../lib/share'
import { launchUpdateChecked, UpdateBanner, useAppUpdate } from '../lib/app-update'
import { ThemeProvider, useTheme } from '../ui/theme'
import { DialogHost } from '../ui/dialog'
import { LaunchCover, launchDone } from '../ui/LaunchCover'
import { loadFonts } from '../ui/fonts'
import { takeResume } from '../lib/app-icon'
import { offerPasskey } from '../lib/passkey'
import { AppearanceSync } from '../lib/appearance-sync'

loadFonts()

SplashScreen.preventAutoHideAsync().catch(() => {})
installCrashHandler()

/** Erreur d'affichage : message lisible au lieu d'une fermeture. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => { remember(error); launchDone() }, [error])
  return <ThemeProvider><ErrorScreen message={error.message} stack={String(error.stack || '').split('\n').slice(0, 8).join('\n')} onRetry={retry} /></ThemeProvider>
}

// L'écran de démarrage reste affiché le temps de vérifier une nouvelle version (4 s au plus).
const hideSplash = () => { launchUpdateChecked.then(launchDone).catch(launchDone) }

function Gate() {
  const { me, ready, spaces, org } = useSession()
  const { c, dark } = useTheme()
  const segments = useSegments()
  // Inscription : informations et conditions (obligatoires), âge minimum (null = pas encore lues).
  const { identity } = useIdentity()
  const onboarded = identity ? identity.done : null
  const blocked = !!identity?.blocked_until
  const router = useRouter()
  usePushRouting()
  const updateReady = useAppUpdate()
  useEffect(() => { if (me?.id) autoEnablePush() }, [me?.id])
  // Espace sans Drive (obligatoire pour publier) : écran « Connecter votre Google Drive » une fois par jour au plus.
  const storageState = spaces.find(s => s.org_id === org)?.storage?.state
  useEffect(() => {
    if (!ready || !me || storageState !== 'missing' || ['storage', 'login', 'welcome', 'onboarding', 'account', 'oauth-return', 'setup', 'join'].includes(segments[0] as string)) return
    laterAt(org).then(t => { if (Date.now() - t > 86_400_000) router.push('/storage') })
  }, [ready, me, org, storageState]) // eslint-disable-line react-hooks/exhaustive-deps
  // Lien d'invitation ouvert avant la connexion : on y revient une fois connecté et inscrit.
  useEffect(() => {
    if (!ready || !me || !onboarded || segments[0] === 'join') return
    AsyncStorage.getItem('cm.pending-join').then(t => { if (t) router.push({ pathname: '/join', params: { t } }) }).catch(() => {})
  }, [ready, me?.id, onboarded]) // eslint-disable-line react-hooks/exhaustive-deps
  // Juste après une connexion : proposer l'empreinte (une fois ; « Plus tard » = pas avant 30 jours).
  useEffect(() => {
    if (!ready || !me || !onboarded || !me.twofa_enabled) return
    const id = me.id
    const t = setTimeout(() => offerPasskey(id, () => router.push({ pathname: '/settings', params: { passkey: '1' } })), 1200)
    return () => clearTimeout(t)
  }, [ready, me?.id, onboarded]) // eslint-disable-line react-hooks/exhaustive-deps
  // Changement d'icône : si le téléphone a relancé l'app, on revient sur la page où l'on était (Réglages).
  useEffect(() => {
    if (!ready || !me || !onboarded) return
    takeResume().then(path => { if (path) router.push(path as never) })
  }, [ready, me?.id, onboarded]) // eslint-disable-line react-hooks/exhaustive-deps
  // Vidéo partagée depuis la galerie : nouvelle publication avec ce fichier (une fois connecté).
  const shared = useSharedVideo()
  useEffect(() => {
    if (ready && me && shared.file && segments[0] !== 'new') router.push({ pathname: '/new', params: { shared: '1' } })
  }, [ready, me, shared.file]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { SystemUI.setBackgroundColorAsync(c.bg).catch(() => {}) }, [c.bg])
  useEffect(() => {
    if (!ready || (me && onboarded === null)) return
    if (me && blocked) { if (!['blocked', 'account'].includes(segments[0] as string)) router.replace('/blocked'); hideSplash(); return }
    hideSplash()
    const onLogin = segments[0] === 'login'
    const isPublic = onLogin || segments[0] === 'reset-password' || segments[0] === 'join'
    // Aucun réseau connecté dans aucun espace : écran d'accueil (sauf pages utiles pour en connecter un).
    const empty = !!me && spaces.length > 0 && spaces.every(s => !(s.accounts || 0))
    const free = ['welcome', 'accounts', 'settings', 'people', 'reset-password', 'account', 'onboarding', 'oauth-return', 'setup', 'join']
    if (!me && !isPublic) router.replace('/login')
    else if (me && onboarded === false && !['onboarding', 'account', 'reset-password', 'oauth-return', 'setup', 'join'].includes(segments[0] as string)) router.replace('/onboarding')
    else if (me && onboarded === false) return
    else if (me && empty && !free.includes(segments[0] as string)) router.replace('/welcome')
    else if (me && onLogin) router.replace('/')
  }, [me, ready, spaces, segments, router, onboarded, blocked])

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
        <Stack.Screen name="welcome" options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="new" options={{ presentation: 'modal', title: 'Nouvelle publication' }} />
        <Stack.Screen name="post/[id]" options={{ presentation: 'modal', title: 'Publication' }} />
        <Stack.Screen name="video/[id]" options={{ title: 'Fiche vidéo' }} />
        <Stack.Screen name="asset/[id]" options={{ title: 'Vidéo de la bibliothèque' }} />
        <Stack.Screen name="accounts" options={{ title: 'Comptes' }} />
        <Stack.Screen name="people" options={{ title: 'Personnes et partage' }} />
        <Stack.Screen name="drafts" options={{ title: 'Brouillons à valider' }} />
        <Stack.Screen name="videos" options={{ title: 'Vidéos' }} />
        <Stack.Screen name="settings" options={{ title: 'Réglages' }} />
        <Stack.Screen name="assistant-settings" options={{ title: 'Assistant IA' }} />
        <Stack.Screen name="activity" options={{ title: 'Activité' }} />
        <Stack.Screen name="account" options={{ title: 'Mon compte' }} />
        <Stack.Screen name="storage" options={{ title: 'Stockage' }} />
        <Stack.Screen name="reset-password" options={{ title: 'Mot de passe' }} />
        <Stack.Screen name="oauth-return" options={{ title: 'Connexion du compte', presentation: 'modal' }} />
        <Stack.Screen name="onboarding" options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="blocked" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
      <UpdateBanner visible={updateReady} />
    </>
  )
}

/** Autre langue choisie : tous les écrans se réaffichent dans la nouvelle langue. */
function ByLanguage({ children }: { children: ReactNode }) {
  const { lang } = useTheme()
  return <Fragment key={lang}>{children}</Fragment>
}

export default function RootLayout() {
  const [fatal, setFatal] = useState<{ message: string; stack?: string } | null>(null)
  useEffect(() => onCrash(e => { launchDone(); setFatal(e) }), [])
  if (fatal) return <ThemeProvider><ErrorScreen message={fatal.message} stack={fatal.stack} onRetry={() => setFatal(null)} /></ThemeProvider>
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ShareProvider>
            <SessionProvider>
                <AppearanceSync />
                <IdentityProvider>
                  <ByLanguage>
                    <Gate />
                    <DialogHost />
                  </ByLanguage>
                </IdentityProvider>
            </SessionProvider>
          </ShareProvider>
          <LaunchCover />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
