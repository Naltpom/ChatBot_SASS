// Miniature choisie dans la vidéo (même règle que cm/src/components/FramePicker.tsx) : on glisse sur la barre
// ou on avance image par image, la vidéo montre l'image ; « Utiliser cette image » fixe l'instant (ms).
// TikTok : video_cover_timestamp_ms ; Instagram : thumb_offset, sauf image envoyée à part.
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEffect, useRef, useState } from 'react'
import { PanResponder, View } from 'react-native'
import { Button, Row, Txt } from '../../ui/kit'
import { radius, useTheme } from '../../ui/theme'

const FRAME = 1 / 30

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60), r = s - m * 60
  return `${m}:${r.toFixed(2).padStart(5, '0')}`
}

export function FramePicker({ source, duration, value, onChange, disabled }: {
  source: string | { uri: string; headers?: Record<string, string> } | null; duration: number | null
  value: number | null; onChange: (ms: number | null) => void; disabled?: boolean
}) {
  const { c } = useTheme()
  const player = useVideoPlayer(source, p => { p.muted = true; p.pause() })
  const [t, setT] = useState(value != null ? value / 1000 : 0)
  const len = duration || 0
  const width = useRef(1)
  const last = Math.max(len - 0.05, 0)
  const clamp = (s: number) => Math.max(0, Math.min(last, s))
  useEffect(() => { try { player.currentTime = t } catch { /* lecteur pas prêt */ } }, [t, player])
  const seek = (s: number) => {
    const x = clamp(s)
    setT(x)
    if (value != null) onChange(Math.round(x * 1000))
  }
  const seekRef = useRef(seek)
  seekRef.current = seek
  const lenRef = useRef(len)
  lenRef.current = len
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => seekRef.current((e.nativeEvent.locationX / width.current) * lenRef.current),
    onPanResponderMove: e => seekRef.current((e.nativeEvent.locationX / width.current) * lenRef.current),
  })).current
  const off = disabled || !len
  const chosen = value != null && Math.round(t * 1000) === value
  return (
    <View style={{ gap: 10 }}>
      <Row gap={12} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 108, height: 192, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#000' }}>
          {source ? <VideoView player={player} nativeControls={false} contentFit="cover" style={{ width: 108, height: 192 }}
            accessibilityLabel="Image choisie pour la miniature" /> : null}
        </View>
        <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
          <Txt bold>{value != null ? `Image à ${fmtTime(value / 1000)}` : 'Choix automatique du réseau'}</Txt>
          <Txt small muted>Position : {fmtTime(t)}{len ? ` / ${fmtTime(len)}` : ''}</Txt>
          <Row gap={6} wrap>
            <Button small title="◀ image" disabled={off} onPress={() => seek(t - FRAME)} />
            <Button small title="image ▶" disabled={off} onPress={() => seek(t + FRAME)} />
            <Button small title="Fin" disabled={off} onPress={() => seek(last)} />
          </Row>
        </View>
      </Row>
      <View {...(off ? {} : pan.panHandlers)} onLayout={e => { width.current = e.nativeEvent.layout.width || 1 }}
        accessibilityRole="adjustable" accessibilityLabel="Position de la miniature dans la vidéo"
        accessibilityValue={{ text: fmtTime(t) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e => seek(t + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
        style={{ height: 36, justifyContent: 'center', opacity: off ? 0.5 : 1 }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: c.surface2 }}>
          <View style={{ width: `${len ? (t / len) * 100 : 0}%`, height: 4, borderRadius: 2, backgroundColor: c.primary }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: `${len ? (t / len) * 100 : 0}%`, marginLeft: -10,
          width: 20, height: 20, borderRadius: 10, backgroundColor: c.primary }} />
      </View>
      <Row gap={6} wrap>
        <Button small title={chosen ? 'Image choisie ✓' : 'Utiliser cette image'} disabled={off} onPress={() => onChange(Math.round(t * 1000))} />
        {value != null ? <Button small kind="ghost" title="Choix automatique" disabled={disabled} onPress={() => onChange(null)} /> : null}
      </Row>
    </View>
  )
}
