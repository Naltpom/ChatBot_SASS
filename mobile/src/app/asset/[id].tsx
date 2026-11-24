// Une vidéo de la bibliothèque (comme la feuille AssetSheet de cm/src/pages/Library.tsx) : lecture,
// titre et légende modifiables, liens par plateforme, dossier Drive, « Programmer » (ouvre le composeur).
import { useVideoPlayer, VideoView } from 'expo-video'
import * as WebBrowser from 'expo-web-browser'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getAsset, patchAsset, PLATFORM_LABEL, type Asset, type Platform } from '../../lib/api'
import { fmtDate, fmtDuration, fmtSize } from '../../lib/format'
import { API_URL, authHeaders } from '../../lib/http'
import { useRole, useSession } from '../../lib/session'
import { Button, Card, Field, Icon, Msg, PlatformLogo, Row, Screen, Skeleton, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { captionHint, mediaUrl, streamPath, usageText } from '../../features/library/logic'

const open = (url: string) => Linking.openURL(url).catch(() => WebBrowser.openBrowserAsync(url).catch(() => {}))

function Player({ a, org }: { a: Asset; org: number | null }) {
  const { c } = useTheme()
  const player = useVideoPlayer(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    const uri = mediaUrl(API_URL, streamPath(a), org)
    if (!uri) return
    authHeaders()
      .then(headers => { if (alive) return player.replaceAsync({ uri, headers, metadata: { title: a.title } }) })
      .catch(() => { if (alive) setErr('Lecture impossible pour le moment.') })
    return () => { alive = false }
  }, [a.id, org]) // eslint-disable-line react-hooks/exhaustive-deps
  const ratio = a.width && a.height ? a.width / a.height : 9 / 16
  return (
    <View style={{ alignItems: 'center', gap: space.sm }}>
      <View style={{ width: ratio < 1 ? 260 : '100%', maxWidth: '100%', aspectRatio: ratio, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
        <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="contain" nativeControls
          fullscreenOptions={{ enable: true }} accessibilityLabel={`Lecture de ${a.title}`} />
      </View>
      {err ? <Txt small color={c.danger}>{err}</Txt> : null}
    </View>
  )
}

export default function AssetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { org } = useSession()
  const { canEdit } = useRole()
  const [a, setA] = useState<Asset | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    try {
      const r = await getAsset(org, Number(id))
      setA(r); setTitle(r.title); setCaption(r.caption || ''); setLoadErr('')
    } catch (e) { setLoadErr((e as Error).message) }
  }
  useEffect(() => { load() }, [id, org]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) {
    return (
      <Screen>
        {loadErr ? <Msg kind="err">{loadErr}</Msg> : <Skeleton h={300} />}
        {loadErr ? <Button title="Réessayer" icon="refresh" onPress={load} /> : null}
      </Screen>
    )
  }
  const dirty = title !== a.title || caption !== (a.caption || '')
  const save = async (): Promise<Asset | null> => {
    setBusy(true); setErr(''); setOk('')
    try { const r = await patchAsset(org, a.id, { title, caption }); setA(r); setTitle(r.title); setCaption(r.caption || ''); setOk('Enregistré.'); return r }
    catch (e) { setErr((e as Error).message); return null } finally { setBusy(false) }
  }
  const program = async () => {
    if (dirty && !(await save())) return
    router.push({ pathname: '/new', params: { asset: String(a.id) } })
  }
  const links = Object.entries(a.links || {}) as [Platform, string][]
  const info = [fmtDuration(a.duration_sec), a.height && a.width ? `${a.width}×${a.height}` : '', a.size ? fmtSize(a.size) : '',
    a.drive_created_at ? `déposée le ${fmtDate(a.drive_created_at)}` : ''].filter(Boolean).join(' · ')

  return (
    <Screen onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} refreshing={refreshing}
      footer={canEdit ? (
        <FooterBar>
          {dirty ? <Button title="Enregistrer" disabled={busy} onPress={save} flex /> : null}
          <Button kind="primary" icon="calendar" title="Programmer" disabled={busy} onPress={program} flex />
        </FooterBar>
      ) : undefined}>
      <Txt size={20} bold accessibilityRole="header">{a.title}</Txt>
      <Player a={a} org={org} />
      <Txt small muted center>{info}</Txt>
      <Txt small muted center>{usageText(a, fmtDate)}</Txt>
      {a.removed ? <Msg kind="warn">Ce fichier n’est plus dans le dossier Drive.</Msg> : null}
      {a.kind === 'waiting' ? <Txt small muted center>En attente : planifiée par votre outil de publication, une histoire à la fois. Rien à valider ici.</Txt> : null}
      {a.kind === 'routine' ? <Txt small muted center>Programmée par votre outil de publication : elle arrive dans le planning toute seule.</Txt> : null}
      {links.length ? (
        <Row gap={space.sm} wrap style={{ justifyContent: 'center' }}>
          {links.map(([p, url]) => <PlatformLink key={p} platform={p} url={url} />)}
        </Row>
      ) : null}
      <Card>
        <Row gap={space.sm}>
          <Icon name="folder" size={18} />
          <Txt small muted style={{ flex: 1 }} numberOfLines={2}>{a.source_name}{a.folder ? ` / ${a.folder}` : ''}</Txt>
        </Row>
        <Row gap={space.sm} wrap>
          {a.folder_url ? <Button small icon="layers" title="Dossier Drive" onPress={() => open(a.folder_url!)} /> : null}
          {a.drive_url ? <Button small icon="external" title="Fichier Drive" onPress={() => open(a.drive_url)} /> : null}
        </Row>
      </Card>
      <Field label="Titre" value={title} onChangeText={setTitle} maxLength={200} editable={canEdit} />
      <Field label="Légende et hashtags" value={caption} onChangeText={setCaption} maxLength={2200} multiline editable={canEdit}
        placeholder="Reprise sur chaque compte lors de la programmation" hint={captionHint(a.caption_from)} />
      {err ? <Msg kind="err">{err}</Msg> : null}
      {ok && !dirty ? <Msg kind="ok">{ok}</Msg> : null}
    </Screen>
  )
}

/** « Voir sur TikTok » avec le logo de la plateforme. */
function PlatformLink({ platform, url }: { platform: Platform; url: string }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={() => open(url)} accessibilityRole="link" accessibilityLabel={`Voir sur ${PLATFORM_LABEL[platform]}`}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderStrong,
        backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.7 : 1 })}>
      <PlatformLogo platform={platform} size={16} />
      <Txt small bold>Voir sur {PLATFORM_LABEL[platform]}</Txt>
    </Pressable>
  )
}

function FooterBar({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, padding: space.lg, paddingBottom: insets.bottom + space.md, backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.border }}>
      {children}
    </View>
  )
}
