// Média 9:16 d'une publication : vignette, puis lecture de la vidéo (expo-video) avec la session de l'app.
import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEffect, useState } from 'react'
import { Linking, Modal, Pressable, StatusBar, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { API_URL, authHeaders } from '../../lib/http'
import { t } from '../../lib/i18n'
import { Icon } from '../../ui/kit'
import { radius, useTheme } from '../../ui/theme'
import { showDialog } from '../../ui/dialog'

/** Adresse complète d'un chemin de l'API (« /api/cm/assets/3/stream »), avec l'espace. */
export function apiUrl(path: string, org: number | null): string {
  if (/^https?:\/\//.test(path)) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${API_URL}${path}${org != null ? `${sep}org_id=${org}` : ''}`
}
const isApi = (uri: string) => uri.startsWith(API_URL)

/** En-têtes de session (cookie) pour les images et vidéos servies par l'API. */
export function useAuthHeaders(): Record<string, string> | null {
  const [h, setH] = useState<Record<string, string> | null>(null)
  useEffect(() => { let alive = true; authHeaders().then(x => { if (alive) setH(x) }).catch(() => {}); return () => { alive = false } }, [])
  return h
}

/** Ouvre un lien externe (la publication sur la plateforme, le dossier Drive). */
export async function openLink(url: string) {
  try { await Linking.openURL(url) } catch { showDialog(t('Lien impossible à ouvrir'), url) }
}

function Player({ uri, headers, style }: { uri: string; headers: Record<string, string>; style: StyleProp<ViewStyle> }) {
  const player = useVideoPlayer({ uri, headers }, p => { p.play() })
  return <VideoView player={player} style={style} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} accessibilityLabel={t('Vidéo')} />
}

/** Vidéo en plein écran (fond noir, commandes du système), fermée par ✕ ou le bouton retour. */
function FullScreenPlayer({ uri, headers, onClose }: { uri: string; headers: Record<string, string>; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']} statusBarTranslucent>
      <StatusBar hidden />
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <Player uri={uri} headers={headers} style={{ flex: 1 }} />
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Fermer')} hitSlop={12}
          style={{ position: 'absolute', top: insets.top + 8, right: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={22} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  )
}

export function PostMedia({ stream, thumb, poster, externalUrl, width = 120, fullscreen }: {
  stream: string | null; thumb: string | null; externalUrl?: string | null; width?: number
  /** Image montrée en premier (miniature choisie) ; si elle ne charge pas : `thumb`. */
  poster?: string | null
  /** Lecture en plein écran au lieu de dans la vignette. */
  fullscreen?: boolean
}) {
  const { c } = useTheme()
  const headers = useAuthHeaders()
  const [playing, setPlaying] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const box: ViewStyle = { width, aspectRatio: 9 / 16, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' }
  if (playing && stream && headers && !fullscreen) return <View style={box}><Player uri={stream} headers={isApi(stream) ? headers : {}} style={{ flex: 1 }} /></View>
  const can = !!stream || !!externalUrl
  const shown = poster && !posterFailed ? poster : thumb
  return (
    <Pressable onPress={() => (stream ? setPlaying(true) : externalUrl ? openLink(externalUrl) : undefined)} disabled={!can}
      accessibilityRole="button" accessibilityLabel={stream ? t('Lire la vidéo') : externalUrl ? t('Voir la vidéo sur la plateforme') : t('Aperçu indisponible')}
      style={({ pressed }) => [box, { backgroundColor: c.surface2, opacity: pressed ? 0.8 : 1, alignItems: 'center', justifyContent: 'center' }]}>
      {shown && (!isApi(shown) || headers)
        ? <Image key={shown} source={{ uri: shown, headers: isApi(shown) ? headers || undefined : undefined }} onError={() => { if (shown === poster) setPosterFailed(true) }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" accessibilityLabel={t('Miniature')} />
        : <Icon name="video" size={28} color={c.faint} />}
      {can ? (
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={stream ? 'right' : 'external'} size={22} color="#fff" strokeWidth={2.4} />
        </View>
      ) : null}
      {fullscreen && playing && stream && headers ? <FullScreenPlayer uri={stream} headers={isApi(stream) ? headers : {}} onClose={() => setPlaying(false)} /> : null}
    </Pressable>
  )
}
