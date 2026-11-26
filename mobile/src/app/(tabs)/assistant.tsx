// Onglet « Assistant » : le chatbot de chapote.fr, aux couleurs de l'app (orange, bleu océan, vert forêt)
// et en clair ou sombre. Il répond sur l'utilisation de Chapote CM ; avec l'accord IA donné (réglages de
// l'assistant), il reçoit un jeton court (« mes données ») et peut préparer un brouillon. Ses deux liens
// (« Lancer la programmation », « Ouvrir le brouillon ») sont faits et signés par le serveur ; l'app les ouvre ici.
import { useRouter } from 'expo-router'
import { useRef } from 'react'
import { Alert, Linking, View } from 'react-native'
import { assistantToken, launchProposal } from '../../lib/api'
import { appRoute, assistantAvailable, assistantHtml, BASE, draftLink, INSIDE, tokenReply } from '../../lib/assistant'
import { Empty } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'
import { t } from '../../lib/i18n'

export default function Assistant() {
  const { c, dark, palette } = useTheme()
  const router = useRouter()
  const web = useRef<{ injectJavaScript: (js: string) => void } | null>(null)
  const launching = useRef(false)
  const openDraft = (url: string) => {
    const d = draftLink(url)
    if (!d) {
      // Autre page de cm citée par l'assistant (statistiques, planning…) : l'écran de l'app, pas le navigateur.
      const r = appRoute(url)
      if (!r) return false
      router.push(r as never)
      return true
    }
    if (!d.launch) { router.push({ pathname: '/new', params: { proposal: String(d.id) } }); return true }
    if (launching.current) return true
    launching.current = true
    launchProposal(d.id, d.launch).then(() => {
      Alert.alert(t('C’est programmé'), t('La vidéo partira à l’heure prévue. Vous pouvez la vérifier dans le planning.'), [
        { text: t('OK'), style: 'cancel' },
        { text: t('Voir le planning'), onPress: () => router.push('/') },
      ])
    }).catch(e => {
      Alert.alert(t('Programmation impossible'), (e as Error).message, [
        { text: t('OK'), style: 'cancel' },
        { text: t('Ouvrir le brouillon'), onPress: () => router.push({ pathname: '/new', params: { proposal: String(d.id) } }) },
      ])
    }).finally(() => { launching.current = false })
    return true
  }
  if (!assistantAvailable) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: space.lg, justifyContent: 'center' }}>
        <Empty title={t('Assistant bientôt disponible')} icon="comment">{t('Mettez l’app à jour depuis le Play Store pour discuter avec l’assistant.')}</Empty>

      </View>
    )
  }
  // Chargé seulement ici : le module natif n'existe pas dans les versions plus anciennes de l'app.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview') as typeof import('react-native-webview')
  const theme = dark ? 'dark' : 'light'
  const html = assistantHtml(c.primary, c.onPrimary, theme, c.bg)
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    <WebView
      ref={r => { web.current = r }}
      onMessage={e => {
        let m: { kind?: string; id?: string } = {}
        try { m = JSON.parse(e.nativeEvent.data) } catch { return }
        if (m.kind !== 'token' || typeof m.id !== 'string') return
        const id = m.id
        assistantToken().then(r => web.current?.injectJavaScript(tokenReply(id, r?.token ?? null, r?.aliases ?? null)))
      }}
      key={`${palette}-${theme}`}
      source={{ html, baseUrl: BASE }}
      originWhitelist={['https://*', 'about:*']}
      javaScriptEnabled
      domStorageEnabled
      onShouldStartLoadWithRequest={req => {
        if (openDraft(req.url)) return false
        if (INSIDE.some(p => req.url.startsWith(p))) return true
        Linking.openURL(req.url).catch(() => {})
        return false
      }}
      setSupportMultipleWindows
      onOpenWindow={e => { if (openDraft(e.nativeEvent.targetUrl)) return; Linking.openURL(e.nativeEvent.targetUrl).catch(() => {}) }}
      geolocationEnabled={false}
      mediaCapturePermissionGrantType="deny"
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      allowsBackForwardNavigationGestures={false}
      style={{ flex: 1, backgroundColor: c.bg }}
    />
    </View>
  )
}
