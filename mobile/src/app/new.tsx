// Nouvelle publication : une vidéo (galerie du téléphone ou bibliothèque Drive), un ou plusieurs comptes,
// tout de suite ou à l'heure choisie. Mêmes règles que cm/src/pages/Composer.tsx.
// Paramètres : `asset` (vidéo de la bibliothèque) et `proposal` (brouillon automatique « À valider »).
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { File } from 'expo-file-system'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  creatorInfo, createPost, deletePost, getAccounts, getAsset, getProposal, getRobot, submitPost, PLATFORM_LABEL,
  type Account, type Asset,
} from '../lib/api'
import { fmtDuration, fmtSize, TIKTOK_BC_URL, TIKTOK_MUSIC_URL, TIKTOK_PRIVACY } from '../lib/format'
import { useLoad, useRole, useSession } from '../lib/session'
import { uploadCover, uploadParts } from '../lib/upload'
import { Avatar, Button, Field, Icon, Loading, Msg, Row, Screen, Seg, Txt } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'
import {
  accKey, buildBody, captionCount, CAPTION_MAX, defaults, fileNameOf, groupAccounts, landingDay, nextHour, problems as findProblems,
  titleFromFile, YT_PRIVACY, type ComposeState, type CreatorState, type InstaOpts, type Opts, type TikTokOpts, type YouTubeOpts,
} from '../features/planning/compose'
import { AccountSheet } from '../features/planning/AccountSheet'
import { LibrarySheet } from '../features/planning/LibrarySheet'
import { apiUrl, openLink, useAuthHeaders } from '../features/planning/media'
import { InstaPanel, TikTokPanel, YouTubePanel } from '../features/planning/Panels'
import { Check, DateTimeField, Section } from '../features/planning/ui'

interface PickedVideo { uri: string; name: string; size: number; duration: number | null; mime: string | null }
interface Cover { uri: string; mime: string }

function LocalPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.muted = true })
  return <VideoView player={player} nativeControls contentFit="contain" accessibilityLabel="Aperçu de la vidéo"
    style={{ width: '100%', height: 320, borderRadius: radius.md, backgroundColor: '#000' }} />
}

const detail = (a: Account) => `${PLATFORM_LABEL[a.platform]}${a.platform === 'youtube' ? ' · Short'
  : a.platform === 'instagram' ? ` · Reel${a.mode === 'routine' ? ' · routine' : ''}`
  : a.can_direct === false ? ' · brouillon dans l’app' : ''}`

/** Ce qui est choisi pour un compte, en quelques mots. */
function summaryOf(a: Account, o: Opts | undefined): string {
  if (!o) return PLATFORM_LABEL[a.platform]
  if (a.platform === 'tiktok') {
    const t = o as TikTokOpts
    return t.mode === 'draft' ? 'brouillon dans l’app' : `publication directe${t.privacy ? ` · ${(TIKTOK_PRIVACY[t.privacy] || t.privacy).toLowerCase()}` : ''}`
  }
  if (a.platform === 'youtube') {
    const y = o as YouTubeOpts
    return `Short · ${(YT_PRIVACY.find(([v]) => v === y.privacy)?.[1] || '').toLowerCase()}${y.kids === 'yes' ? ' · pour enfants' : ''}`
  }
  return (o as InstaOpts).feed ? 'Reel + fil' : 'Reel seulement'
}

export default function NewPost() {
  const { c } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ asset?: string; proposal?: string }>()
  const { org, config, groups, group: currentGroup, account: currentAccount } = useSession()
  const { canEdit } = useRole()
  const accounts = useLoad(s => getAccounts({ org: s.org, group: null }), [], 'compose-all')
  const robot = useLoad(() => getRobot().catch(() => null), [], 'robot')
  const headers = useAuthHeaders()

  const [video, setVideo] = useState<PickedVideo | null>(null)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [known, setKnown] = useState<Record<string, Account>>({})
  const [picked, setPicked] = useState<string[]>([])
  const [opts, setOpts] = useState<Record<string, Opts>>({})
  const [creators, setCreators] = useState<Record<string, CreatorState>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [when, setWhen] = useState<'now' | 'at'>('at')
  const [at, setAt] = useState(() => nextHour())
  const [sameTime, setSameTime] = useState(true)
  const [times, setTimes] = useState<Record<string, Date>>({})
  const [cover, setCover] = useState<Cover | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [picking, setPicking] = useState(false)
  const [library, setLibrary] = useState(false)
  const busy = progress != null
  // Envoi interrompu : on reprend le même post (même contenu) là où il s'est arrêté.
  const sent = useRef<{ sig: string; postId: number; partSize: number; done: number } | null>(null)

  const all = accounts.data || []
  useEffect(() => { if (accounts.data) setKnown(k => ({ ...k, ...Object.fromEntries(accounts.data!.map(a => [accKey(a), a])) })) }, [accounts.data])
  const chosen = picked.map(k => known[k]).filter(Boolean) as Account[]

  const add = (list: Account[]) => {
    const fresh = list.filter(a => a.can_publish)
    if (!fresh.length) return
    setKnown(k => ({ ...k, ...Object.fromEntries(fresh.map(a => [accKey(a), a])) }))
    setPicked(p => [...p, ...fresh.map(accKey).filter(k => !p.includes(k))])
    setOpts(o => { const n = { ...o }; for (const a of fresh) if (!n[accKey(a)]) n[accKey(a)] = defaults(a); return n })
    for (const a of fresh) {
      if (a.platform !== 'tiktok') continue
      const k = accKey(a)
      setCreators(x => ({ ...x, [k]: 'loading' }))
      creatorInfo(a.id).then(ci => setCreators(x => ({ ...x, [k]: ci })))
        .catch(e => setCreators(x => ({ ...x, [k]: { error: (e as Error).message } })))
    }
  }
  const remove = (k: string) => setPicked(p => p.filter(x => x !== k))
  const groupList = (gid: number) => { const g = groups.find(x => x.id === gid); return g ? groupAccounts(g, all) : [] }

  const takeAsset = (a: Asset) => {
    setAsset(a); setLibrary(false); setErr(''); setVideo(null)
    setTitle(a.title.slice(0, 200)); setCaption(a.caption || '')
    if (a.group_id) add(groupList(a.group_id))
  }

  // Vidéo de la bibliothèque passée en paramètre (Bibliothèque → « Programmer »).
  const assetDone = useRef(false)
  useEffect(() => {
    const id = Number(params.asset)
    if (!id || assetDone.current || !accounts.data) return
    assetDone.current = true
    getAsset(org, id).then(takeAsset).catch(e => setErr((e as Error).message))
  }, [params.asset, accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps
  // Brouillon automatique (« À valider ») : vidéo, comptes, heure, titre et légende pré-remplis.
  const draftDone = useRef(false)
  useEffect(() => {
    const id = Number(params.proposal)
    if (!id || draftDone.current || !accounts.data) return
    draftDone.current = true
    getProposal(org, id).then(d => {
      if (d.asset) { setAsset(d.asset); setVideo(null) }
      setTitle((d.title || d.asset?.title || '').slice(0, 200))
      setCaption(d.caption ?? d.asset?.caption ?? '')
      add(all.filter(x => d.accounts.some(k => k.key === accKey(x))))
      if (d.scheduled_at) { setWhen('at'); setAt(new Date(d.scheduled_at)) }
    }).catch(e => setErr((e as Error).message))
  }, [params.proposal, accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps
  // Compte ou groupe affiché dans l'app : proposé d'office (une fois), sauf pour un brouillon.
  const preset = useRef(false)
  useEffect(() => {
    if (preset.current || !accounts.data || params.proposal || (!currentGroup && !currentAccount)) return
    preset.current = true
    add(currentAccount ? accounts.data.filter(a => accKey(a) === currentAccount) : groupList(currentGroup!.id))
  }, [accounts.data, currentGroup, currentAccount]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <T extends Opts>(k: string, patch: Partial<T>) => setOpts(o => ({ ...o, [k]: { ...(o[k] as T), ...patch } }))

  const pickVideo = async () => {
    try {
      await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null)
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsEditing: false, quality: 1 })
      if (r.canceled || !r.assets?.length) return
      const a = r.assets[0]
      let size = a.fileSize || 0
      if (!size) { try { size = new File(a.uri).size || 0 } catch { /* taille inconnue */ } }
      const name = fileNameOf(a.uri, a.fileName, a.mimeType)
      setVideo({ uri: a.uri, name, size, duration: a.duration != null ? a.duration / 1000 : null, mime: a.mimeType || null })
      setAsset(null); setErr('')
      if (!title.trim()) setTitle(titleFromFile(name))
    } catch (e) { Alert.alert('Galerie indisponible', (e as Error).message) }
  }
  const pickCover = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.9 })
      if (r.canceled || !r.assets?.length) return
      const a = r.assets[0]
      if (a.fileSize && a.fileSize > 8 * 1024 * 1024) { Alert.alert('Image trop lourde', 'JPEG ou PNG, 8 Mo au plus.'); return }
      setCover({ uri: a.uri, mime: a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg' })
    } catch (e) { Alert.alert('Galerie indisponible', (e as Error).message) }
  }

  const state: ComposeState = {
    hasVideo: !!video || !!asset, size: video ? video.size : null, duration: video ? video.duration : asset ? asset.duration_sec : null,
    title, chosen, opts, creators, when, at, sameTime, times,
  }
  const problems = useMemo(() => findProblems(state, config, Date.now(), fmtSize, fmtDuration),
    [video, asset, title, chosen.map(accKey).join(), opts, creators, when, at, sameTime, times, config]) // eslint-disable-line react-hooks/exhaustive-deps
  const count = captionCount(caption)
  const hasTikTok = chosen.some(a => a.platform === 'tiktok')
  const tiktokBranded = chosen.some(a => { const o = opts[accKey(a)] as TikTokOpts | undefined; return a.platform === 'tiktok' && o?.mode === 'direct' && o.commercial && o.branded })
  const n = chosen.length
  const cta = when === 'now' ? `Publier sur ${n} compte${n > 1 ? 's' : ''}` : `Programmer sur ${n} compte${n > 1 ? 's' : ''}`
  const summary = n
    ? `${n} compte${n > 1 ? 's' : ''} · ${when === 'now' ? 'dès l’envoi de la vidéo' : sameTime ? at.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'heures par compte'}`
    : 'Aucun compte choisi'

  const publish = async () => {
    if (!state.hasVideo || problems.length || busy) return
    setErr(''); setProgress(0)
    const s = { ...state, caption }
    try {
      if (asset) {
        const made = await createPost(buildBody(org, s, { kind: 'asset', id: asset.id }))
        if (cover) await uploadCover(made.post_id, cover.uri, cover.mime)
      } else if (video) {
        const body = buildBody(org, s, { kind: 'file', name: video.name, size: video.size })
        const sig = JSON.stringify({ ...body, uri: video.uri })
        let job = sent.current
        if (job && job.sig !== sig) { deletePost(job.postId).catch(() => {}); job = null }
        if (!job) {
          const plan = await createPost(body)
          job = { sig, postId: plan.post_id, partSize: plan.part_size || video.size, done: 0 }
          sent.current = job
        }
        const j = job
        await uploadParts(j.postId, video.uri, video.size, j.partSize, (done, total) => {
          setProgress(total ? done / total : 0)
          j.done = Math.ceil(done / j.partSize)
        }, j.done)
        if (cover) await uploadCover(j.postId, cover.uri, cover.mime)
        await submitPost(j.postId)
        sent.current = null
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      const flash = asset
        ? (when === 'now' ? 'Publication lancée depuis la bibliothèque.' : 'Publication programmée : la vidéo sera récupérée dans le Drive à l’heure prévue.')
        : (when === 'now' ? 'Publication lancée.' : 'Publication programmée.')
      router.dismissTo({ pathname: '/', params: { day: landingDay(s), flash, t: String(Date.now()) } })
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      setErr(`${(e as Error).message}${sent.current ? ' Touchez de nouveau le bouton : l’envoi reprendra où il s’est arrêté.' : ''}`)
      setProgress(null)
    }
  }

  const pct = Math.round((progress || 0) * 100)
  const footer = (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: insets.bottom + space.md, gap: space.sm,
      backgroundColor: c.surface, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
      <Txt small muted numberOfLines={2} accessibilityRole="text">
        {busy ? (video && !asset ? `Envoi de la vidéo… ${pct} %${video.size ? ` (${fmtSize(video.size * (progress || 0))} / ${fmtSize(video.size)})` : ''}` : 'Envoi…')
          : problems.length && state.hasVideo && n ? problems[0] : summary}
      </Txt>
      {busy ? (
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}
          style={{ height: 6, borderRadius: 3, backgroundColor: c.surface2, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: 6, backgroundColor: c.primary }} />
        </View>
      ) : null}
      {busy ? <Txt size={12} faint>Gardez l’app ouverte pendant l’envoi.</Txt> : null}
      <Button kind="primary" icon={when === 'now' ? 'bolt' : 'clock'} title={busy ? 'Envoi en cours…' : n ? cta : 'Choisir les comptes'}
        loading={busy} disabled={!canEdit || (n > 0 && problems.length > 0)} onPress={() => (n ? publish() : setPicking(true))} />
    </View>
  )

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <Screen footer={footer}>
        {!canEdit ? <Msg kind="err">Votre rôle dans cette équipe (lecteur) ne permet pas de publier. Demandez à un administrateur de l’équipe.</Msg> : null}
        {accounts.loading && !accounts.data ? <Loading /> : null}
        {accounts.error ? <Msg kind="err">{accounts.error}</Msg> : null}
        {accounts.data && all.length === 0 ? (
          <Msg>Aucun compte connecté. Connectez TikTok, YouTube ou Instagram dans Comptes pour publier.</Msg>
        ) : null}

        <Section title="Vidéo">
          {asset ? (
            <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
              <View style={{ width: 72, height: 104, borderRadius: radius.sm, backgroundColor: c.surface2, overflow: 'hidden' }}>
                {asset.thumbnail && headers ? <Image source={{ uri: apiUrl(asset.thumbnail, org), headers }} style={{ width: 72, height: 104 }} contentFit="cover" /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Txt bold numberOfLines={2}>{asset.name}</Txt>
                <Txt small muted>{fmtDuration(asset.duration_sec)}{asset.size ? ` · ${fmtSize(asset.size)}` : ''}</Txt>
                <Txt small muted numberOfLines={1}>{asset.source_name}{asset.folder ? ` / ${asset.folder}` : ''}</Txt>
                <Txt size={12} muted>Récupérée dans le Drive à l’heure de la publication.</Txt>
                <Row gap={6} wrap>
                  <Button small title="Changer" disabled={busy} onPress={() => setLibrary(true)} />
                  <Button small kind="ghost" title="Envoyer un fichier à la place" disabled={busy} onPress={() => { setAsset(null); pickVideo() }} />
                </Row>
              </View>
            </Row>
          ) : (
            <>
              <Pressable onPress={pickVideo} disabled={busy} accessibilityRole="button" accessibilityLabel={video ? 'Choisir une autre vidéo' : 'Choisir une vidéo dans la galerie'}
                style={({ pressed }) => ({ minHeight: 84, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.borderStrong,
                  alignItems: 'center', justifyContent: 'center', gap: 4, padding: space.md, opacity: pressed ? 0.7 : 1 })}>
                <Icon name={video ? 'video' : 'upload'} size={22} color={c.muted} />
                <Txt bold numberOfLines={1}>{video ? video.name : 'Choisir une vidéo'}</Txt>
                <Txt size={12} muted>{video ? `${video.size ? fmtSize(video.size) : 'taille inconnue'} · ${fmtDuration(video.duration)}` : `MP4 ou MOV, vertical, ${config ? fmtSize(config.max_upload_bytes) : '1 Go'} au plus`}</Txt>
              </Pressable>
              {video ? <Button small kind="ghost" title="Choisir une autre vidéo" disabled={busy} onPress={pickVideo} /> : null}
              {robot.data?.enabled ? <Button icon="layers" title="Choisir dans la bibliothèque" disabled={busy} onPress={() => setLibrary(true)} /> : null}
              {video ? <LocalPreview key={video.uri} uri={video.uri} /> : null}
            </>
          )}
        </Section>

        <Section title="Texte">
          <Field label="Titre" value={title} maxLength={200} editable={!busy} onChangeText={setTitle} placeholder="Nom de la vidéo (titre YouTube par défaut)" />
          <Field label="Légende" value={caption} maxLength={CAPTION_MAX} editable={!busy} onChangeText={setCaption} multiline
            placeholder="Reprise sur chaque compte, sauf texte propre à un compte"
            hint={`${count.chars.toLocaleString('fr-FR')} / 2 200 · ${count.tags} hashtag${count.tags > 1 ? 's' : ''}`} />
        </Section>

        <Section title={`Comptes${n ? ` · ${n}` : ''}`} aside={<Button small kind="ghost" title={n ? 'Modifier' : 'Choisir'} disabled={busy} onPress={() => setPicking(true)} />}>
          {!n ? <Txt small muted>Choisissez un ou plusieurs comptes (ou un groupe entier).</Txt> : null}
          {chosen.map(a => {
            const k = accKey(a), o = opts[k], isOpen = !!open[k]
            return (
              <View key={k} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingTop: space.sm, gap: space.sm }}>
                <Row gap={space.md}>
                  <Pressable onPress={() => setOpen(x => ({ ...x, [k]: !isOpen }))} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={`${a.name || PLATFORM_LABEL[a.platform]}, ${summaryOf(a, o)}. Options ${PLATFORM_LABEL[a.platform]}`}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}>
                    <Avatar src={a.avatar_url} name={a.name} platform={a.platform} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt bold numberOfLines={1}>{a.name || PLATFORM_LABEL[a.platform]}</Txt>
                      <Txt small muted numberOfLines={1}>{summaryOf(a, o)}</Txt>
                    </View>
                    <View style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}><Icon name="down" size={18} color={c.muted} /></View>
                  </Pressable>
                  <Pressable onPress={() => remove(k)} disabled={busy} accessibilityRole="button" accessibilityLabel={`Retirer ${a.name || PLATFORM_LABEL[a.platform]}`}
                    style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="close" size={18} color={c.muted} />
                  </Pressable>
                </Row>
                {isOpen && o ? (
                  a.platform === 'tiktok' ? <TikTokPanel account={a} o={o as TikTokOpts} ci={creators[k]} busy={busy} set={p => set<TikTokOpts>(k, p)} />
                  : a.platform === 'youtube' ? <YouTubePanel o={o as YouTubeOpts} busy={busy} set={p => set<YouTubeOpts>(k, p)} />
                  : <InstaPanel o={o as InstaOpts} busy={busy} set={p => set<InstaOpts>(k, p)} />
                ) : null}
              </View>
            )
          })}
          {n ? <Txt size={12} muted>La flèche ouvre ce qui est propre à la plateforme (titre YouTube, visibilité, duos TikTok…). Par défaut : texte commun.</Txt> : null}
        </Section>

        {chosen.some(a => a.platform === 'instagram') ? (
          <Section title="Couverture" aside="Instagram">
            <Row gap={space.md} style={{ alignItems: 'center' }}>
              {cover ? <Image source={{ uri: cover.uri }} style={{ width: 54, height: 96, borderRadius: 8 }} contentFit="cover" accessibilityLabel="Couverture choisie" />
                : <View style={{ width: 54, height: 96, borderRadius: 8, backgroundColor: c.surface2 }} />}
              <View style={{ flex: 1, gap: 6 }}>
                <Button small title={cover ? 'Changer l’image' : 'Choisir une image'} disabled={busy} onPress={pickCover} style={{ alignSelf: 'flex-start' }} />
                {cover ? <Button small kind="ghost" title="Retirer" disabled={busy} onPress={() => setCover(null)} style={{ alignSelf: 'flex-start' }} /> : null}
                <Txt size={12} muted>JPEG ou PNG, 8 Mo max. Sinon : l’image à côté de la vidéo dans le Drive{asset?.has_cover ? ' (trouvée)' : ''}, ou celle choisie par Instagram.</Txt>
              </View>
            </Row>
          </Section>
        ) : null}

        <Section title="Quand">
          <Seg label="Quand" value={when} onChange={v => !busy && setWhen(v)} options={[['now', 'Tout de suite'], ['at', 'Programmer']]} />
          {when === 'at' ? (
            <>
              {sameTime ? <DateTimeField label="Jour et heure" value={at} onChange={setAt} disabled={busy} minimumDate={new Date()} /> : null}
              <Check label="Même heure pour tous les comptes" checked={sameTime} onChange={setSameTime} disabled={busy} />
              {!sameTime ? chosen.map(a => (
                <DateTimeField key={accKey(a)} label={`${a.name || ''} (${PLATFORM_LABEL[a.platform]})`} value={times[accKey(a)] || at} disabled={busy}
                  minimumDate={new Date()} onChange={d => setTimes(t => ({ ...t, [accKey(a)]: d }))} />
              )) : null}
              <Txt size={12} muted>Fuseau : {Intl.DateTimeFormat().resolvedOptions().timeZone}. L’heure se change ensuite compte par compte dans le planning.</Txt>
            </>
          ) : <Txt small muted>La publication part dès que la vidéo est envoyée.</Txt>}
        </Section>

        {hasTikTok ? (
          <Txt size={12} muted>
            En publiant, vous acceptez {tiktokBranded ? <><Text style={{ color: c.accent }} onPress={() => openLink(TIKTOK_BC_URL)} accessibilityRole="link">la Branded Content Policy</Text> et </> : null}
            <Text style={{ color: c.accent }} onPress={() => openLink(TIKTOK_MUSIC_URL)} accessibilityRole="link">la Music Usage Confirmation</Text> de TikTok.
            {' '}Le traitement peut prendre quelques minutes avant que la vidéo soit visible.
          </Txt>
        ) : null}
        {err ? <Msg kind="err">{err}</Msg> : null}
        {problems.length > 0 && n > 0 && state.hasVideo ? (
          <View style={{ gap: 4 }} accessibilityLabel="À corriger avant l’envoi">
            {problems.map(p => <Txt key={p} small muted>• {p}</Txt>)}
          </View>
        ) : null}
      </Screen>

      <AccountSheet visible={picking} onClose={() => setPicking(false)} picked={picked} detail={detail}
        onChange={(keys, added) => {
          if (busy) return
          setPicked(p => p.filter(k => keys.includes(k)))
          add(added)
        }} />
      <LibrarySheet visible={library} onClose={() => setLibrary(false)} onPick={takeAsset} />
    </>
  )
}
