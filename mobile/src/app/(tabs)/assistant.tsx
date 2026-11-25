// Onglet « Assistant » : le chatbot de chapote.fr, aux couleurs de l'app (orange, bleu océan, vert forêt)
// et en clair ou sombre. Il répond sur l'utilisation de Chapote CM ; il ne reçoit aucune donnée du compte.
import { Linking, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { assistantAvailable, assistantHtml, BASE, INSIDE } from '../../lib/assistant'
import { Empty } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'

export default function Assistant() {
  const { c, dark, palette } = useTheme()
  // Pas de titre d'onglet : le bandeau du chat en tient lieu ; on garde la place de la barre d'état.
  const insets = useSafeAreaInsets()
  if (!assistantAvailable) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: space.lg, paddingTop: insets.top + space.lg, justifyContent: 'center' }}>
        <Empty title="Assistant bientôt disponible" icon="comment">Mettez l’app à jour depuis le Play Store pour discuter avec l’assistant.</Empty>
      </View>
    )
  }
  // Chargé seulement ici : le module natif n'existe pas dans les versions plus anciennes de l'app.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview') as typeof import('react-native-webview')
  const theme = dark ? 'dark' : 'light'
  const html = assistantHtml(c.primary, c.onPrimary, theme, c.bg)
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: c.bg }}>
    <WebView
      key={`${palette}-${theme}`}
      source={{ html, baseUrl: BASE }}
      originWhitelist={['https://*', 'about:*']}
      javaScriptEnabled
      domStorageEnabled
      onShouldStartLoadWithRequest={req => {
        if (INSIDE.some(p => req.url.startsWith(p))) return true
        Linking.openURL(req.url).catch(() => {})
        return false
      }}
      setSupportMultipleWindows
      onOpenWindow={e => { Linking.openURL(e.nativeEvent.targetUrl).catch(() => {}) }}
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
