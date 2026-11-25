// Stockage Drive de l'espace : obligatoire pour publier (docs/CM_ROUTINES.md §9).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { openAuthorize, startDriveOAuth, type Space, type Storage } from '../lib/api'
import { fmtSize } from '../lib/format'
import { Button, Msg, Txt } from '../ui/kit'
import { radius, useTheme } from '../ui/theme'

export const storageLater = (org: number | null) => `cm.storage-later.${org ?? 'perso'}`
export const markLater = (org: number | null) => AsyncStorage.setItem(storageLater(org), String(Date.now())).catch(() => {})
export const laterAt = async (org: number | null) => Number(await AsyncStorage.getItem(storageLater(org)).catch(() => null)) || 0

/** Ouvre la connexion Google Drive (même connexion que le site, dans le navigateur). */
export async function connectDrive(org: number | null) {
  const { authorize_url } = await startDriveOAuth(org)
  await openAuthorize(authorize_url)
}

export function usedRatio(s: Storage): number | null {
  if (s.used_bytes == null) return null
  const cap = s.quota_gb != null ? s.quota_gb * 1024 ** 3 : s.drive_free_bytes != null ? s.used_bytes + s.drive_free_bytes : null
  return cap ? Math.min(1, s.used_bytes / cap) : null
}

export function Gauge({ s }: { s: Storage }) {
  const { c } = useTheme()
  const r = usedRatio(s)
  const color = s.state === 'full' ? c.danger : s.state === 'almost_full' ? c.warn : c.primary
  const cap = s.quota_gb != null ? `${s.quota_gb} Go réservés` : s.drive_free_bytes != null ? `${fmtSize(s.drive_free_bytes)} libres sur le Drive` : ''
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`Stockage : ${s.used_bytes != null ? fmtSize(s.used_bytes) : '—'} utilisés${cap ? `, ${cap}` : ''}`}>
      <View style={{ height: 10, borderRadius: radius.sm, backgroundColor: c.surface2, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round((r ?? 0) * 100)}%`, height: '100%', backgroundColor: color }} />
      </View>
      <Txt small muted>{s.used_bytes != null ? fmtSize(s.used_bytes) : '—'} utilisés par Chapote{cap ? ` · ${cap}` : ''}</Txt>
    </View>
  )
}

/** Bandeau presque plein / plein / Drive manquant, pour l'espace affiché. */
export function StorageBanner({ space }: { space: Space | undefined }) {
  const router = useRouter()
  const st = space?.storage?.state
  if (!st || st === 'ok') return null
  const text = st === 'missing' ? 'Connectez un Google Drive à cet espace pour publier.'
    : st === 'full' ? 'Stockage Drive plein : libérez de la place ou augmentez le quota pour publier.'
    : 'Stockage Drive presque plein (90 %).'
  return (
    <Msg kind={st === 'almost_full' ? 'warn' : 'err'}>
      <Txt small>{text}</Txt>
      <Button small kind="ghost" title="Voir le stockage" onPress={() => router.push('/storage')} style={{ alignSelf: 'flex-start' }} />
    </Msg>
  )
}
