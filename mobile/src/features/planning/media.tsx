// Média 9:16 d'une publication : vignette, puis lecture de la vidéo (expo-video) avec la session de l'app.
import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEffect, useState } from 'react'
import { Linking, Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
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

export function PostMedia({ stream, thumb, externalUrl, width = 120 }: { stream: string | null; thumb: string | null; externalUrl?: string | null; width?: number }) {
  const { c } = useTheme()
  const headers = useAuthHeaders()
  const [playing, setPlaying] = useState(false)
  const box: ViewStyle = { width, aspectRatio: 9 / 16, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' }
  if (playing && stream && headers) return <View style={box}><Player uri={stream} headers={isApi(stream) ? headers : {}} style={{ flex: 1 }} /></View>
  const can = !!stream || !!externalUrl
  return (
    <Pressable onPress={() => (stream ? setPlaying(true) : externalUrl ? openLink(externalUrl) : undefined)} disabled={!can}
      accessibilityRole="button" accessibilityLabel={stream ? t('Lire la vidéo') : externalUrl ? t('Voir la vidéo sur la plateforme') : t('Aperçu indisponible')}
      style={({ pressed }) => [box, { backgroundColor: c.surface2, opacity: pressed ? 0.8 : 1, alignItems: 'center', justifyContent: 'center' }]}>
      {thumb && (!isApi(thumb) || headers)
        ? <Image source={{ uri: thumb, headers: isApi(thumb) ? headers || undefined : undefined }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" />
        : <Icon name="video" size={28} color={c.faint} />}
      {can ? (
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={stream ? 'right' : 'external'} size={22} color="#fff" strokeWidth={2.4} />
        </View>
      ) : null}
    </Pressable>
  )
}
