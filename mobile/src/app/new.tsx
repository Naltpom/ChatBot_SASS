// Nouvelle publication, en étapes : 1. la vidéo et son texte (communs à tous les comptes) ;
// 2. les comptes et l'heure (avec ce qui est déjà prévu sur chaque compte) ; 3. les réglages propres
// à un réseau, seulement s'il en manque un obligatoire (ou si on les ouvre). Mêmes règles que cm/src/pages/Composer.tsx.
// Paramètres : `asset` (vidéo de la bibliothèque) et `proposal` (brouillon automatique « À valider »).
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { File } from 'expo-file-system'
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useSharedVideo } from '../lib/share'
import { StorageBanner } from '../features/storage'
import { useVideoPlayer, VideoView } from 'expo-video'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  creatorInfo, createPost, getCalendar, sendFeedback, type AbandonReason, isRisky, RIGHTS_LABEL, RIGHTS_WARNING, type Rights, deletePost, getAccounts, getAsset, getProposal, getRobot, submitPost, PLATFORM_LABEL,
  type Account, type Asset,
} from '../lib/api'
import { fmtDuration, fmtSize, TIKTOK_BC_URL, TIKTOK_MUSIC_URL, TIKTOK_PRIVACY } from '../lib/format'
import { useLoad, useRole, useSession } from '../lib/session'
import { uploadCover, uploadParts } from '../lib/upload'
import { Avatar, Button, Card, Chip, Field, Icon, Loading, Msg, Row, Screen, Seg, Sheet, Txt } from '../ui/kit'
import { Missing, StepProgress } from '../ui/Progress'
import { radius, space, useTheme } from '../ui/theme'
import {
  accKey, buildBody, postOrg, captionCount, CAPTION_MAX, defaults, fileNameOf, groupAccounts, landingDay, nearbyPosts, needsOptions, earliestSlot,
  stepProblems, tooClose,
  titleFromFile, YT_PRIVACY, type ComposeState, type CreatorState, type InstaOpts, type Opts, type TikTokOpts, type YouTubeOpts,
} from '../features/planning/compose'
import { AccountSheet } from '../features/planning/AccountSheet'
import { LibrarySheet } from '../features/planning/LibrarySheet'
import { apiUrl, openLink, useAuthHeaders } from '../features/planning/media'
import { InstaPanel, TikTokPanel, YouTubePanel } from '../features/planning/Panels'
import { Check, DateTimeField, Section, TooSoon, useNow } from '../features/planning/ui'
import { showDialog } from '../ui/dialog'

const TIPS = [
  'vous pouvez fermer l’app : l’envoi reprend où il s’est arrêté.',
  'déposez vos vidéos dans votre dossier Drive : elles arrivent dans la Bibliothèque, prêtes à planifier.',
  'une légende écrite une fois part sur chaque compte ; vous pouvez l’adapter par réseau.',
  'les heures de 18 h à 21 h marchent souvent bien pour les vidéos courtes.',
]

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
  const params = useLocalSearchParams<{ asset?: string; proposal?: string; shared?: string; org?: string; first?: string }>()
  const sharedVideo = useSharedVideo()
  const { org, config, groups, group: currentGroup, account: currentAccount, refresh: refreshSession, spaces: spacesAll } = useSession()
  // Rôle relu à l'ouverture (un administrateur a pu le changer depuis).
  useEffect(() => { refreshSession() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const { canEdit } = useRole()
  const accounts = useLoad(() => getAccounts({ org: null, group: null, sel: ['all'] }), [], 'compose-all')
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
  const [when, setWhen] = useState<'now' | 'at'>('at')
  const [at, setAt] = useState(() => earliestSlot())
  const [sameTime, setSameTime] = useState(true)
  const [times, setTimes] = useState<Record<string, Date>>({})
  const [cover, setCover] = useState<Cover | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [picking, setPicking] = useState(false)
  const [library, setLibrary] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [wantOpts, setWantOpts] = useState(false)
  const busy = progress != null
  const [errCode, setErrCode] = useState<string | null>(null)
  const published = useRef(false)
  // Quitter sans publier : une seule question facultative (une fois par semaine au plus).
  const navigation = useNavigation()
  const [ask, setAsk] = useState<null | (() => void)>(null)
  const [otherText, setOtherText] = useState('')
  useEffect(() => (navigation as any).addListener('beforeRemove', (e: any) => {
    // Retour (bouton du haut, geste, touche Android) : d'abord l'étape d'avant.
    if (!published.current && step > 1 && progress == null) { e.preventDefault(); setStep(x => (x - 1) as 1 | 2); return }
    if (published.current || ask || (!video && !asset && !title.trim() && !caption.trim())) return
    e.preventDefault()
    const leave = () => navigation.dispatch(e.data.action)
    AsyncStorage.getItem('cm.feedback.asked').then(v => {
      if (v && Date.now() - Number(v) < 7 * 864e5) { leave(); return }
      AsyncStorage.setItem('cm.feedback.asked', String(Date.now())).catch(() => {})
      setAsk(() => leave)
    }).catch(leave)
  }), [navigation, video, asset, title, caption, ask, step, progress])
  const answer = (reason: AbandonReason | null) => {
    if (reason) sendFeedback(reason, reason === 'other' ? otherText.trim() : undefined).catch(() => {})
    const go = ask; setAsk(null); go?.()
  }
  // Envoi interrompu : on reprend le même post (même contenu) là où il s'est arrêté.
  const sent = useRef<{ sig: string; postId: number; partSize: number; done: number } | null>(null)

  const all = accounts.data || []
  useEffect(() => { if (accounts.data) setKnown(k => ({ ...k, ...Object.fromEntries(accounts.data!.map(a => [accKey(a), a])) })) }, [accounts.data])
  const chosen = picked.map(k => known[k]).filter(Boolean) as Account[]
  const [rights, setRights] = useState<Rights | ''>('')   // droits d'auteur (vide = non précisés)
  const [rightsNote, setRightsNote] = useState('')

  // Saisie gardée sur le téléphone (appel, notification, app fermée) : reprise à la réouverture.
  const { me } = useSession()
  const draftKey = `cm.draft.new.${me?.id ?? 0}`
  const fresh = !params.asset && !params.proposal && !params.shared
  const restored = useRef(false)
  const [resumed, setResumed] = useState(false)
  type Draft = { title: string; caption: string; picked: string[]; when: 'now' | 'at'; at: string; sameTime: boolean; video: PickedVideo | null; rights: Rights | ''; rightsNote: string; savedAt: number; step?: 1 | 2 | 3 }
  useEffect(() => {
    if (!fresh || restored.current || !accounts.data) return
    restored.current = true
    AsyncStorage.getItem(draftKey).then(raw => {
      if (!raw) return
      const d = JSON.parse(raw) as Draft
      if (Date.now() - d.savedAt > 7 * 864e5 || (!d.title && !d.caption && !d.video)) return
      setTitle(d.title); setCaption(d.caption); setWhen(d.when); setSameTime(d.sameTime); setRights(d.rights); setRightsNote(d.rightsNote)
      if (new Date(d.at).getTime() > Date.now()) setAt(new Date(d.at))
      if (d.video) setVideo(d.video)
      if (d.step && d.video) setStep(d.step === 3 ? 2 : d.step)
      add((accounts.data || []).filter(a => d.picked.includes(accKey(a))))
      setResumed(true)
    }).catch(() => {})
  }, [accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fresh || !restored.current || asset) return
    const t = setTimeout(() => {
      const d: Draft = { title, caption, picked, when, at: at.toISOString(), sameTime, video, rights, rightsNote, savedAt: Date.now(), step }
      AsyncStorage.setItem(draftKey, JSON.stringify(d)).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [title, caption, picked, when, at, sameTime, video, rights, rightsNote, step]) // eslint-disable-line react-hooks/exhaustive-deps
  const clearDraft = () => AsyncStorage.removeItem(draftKey).catch(() => {})
  const restart = () => {
    clearDraft(); setResumed(false); setTitle(''); setCaption(''); setVideo(null); setPicked([]); setRights(''); setRightsNote(''); setWhen('at'); setAt(earliestSlot()); setStep(1)
  }

  const add = (list: Account[]) => {
    const fresh = list.filter(a => a.can_publish && a.role !== 'viewer')
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
    getProposal(params.org ? Number(params.org) : org, id).then(d => {
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

  // Vidéo reçue par « Partager → Chapote CM ».
  useEffect(() => {
    const f = sharedVideo.file
    if (!f) return
    const name = fileNameOf(f.path, f.fileName || null, f.mimeType || null)
    let size = f.size || 0
    if (!size) { try { size = new File(f.path).size || 0 } catch { /* taille inconnue */ } }
    setVideo({ uri: f.path, name, size, duration: f.duration != null ? f.duration / 1000 : null, mime: f.mimeType || null })
    setAsset(null); setErr('')
    setTitle(t => t.trim() ? t : titleFromFile(name))
    sharedVideo.reset()
  }, [sharedVideo.file]) // eslint-disable-line react-hooks/exhaustive-deps

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
    } catch (e) { showDialog('Galerie indisponible', (e as Error).message) }
  }
  const pickCover = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.9 })
      if (r.canceled || !r.assets?.length) return
      const a = r.assets[0]
      if (a.fileSize && a.fileSize > 8 * 1024 * 1024) { showDialog('Image trop lourde', 'JPEG ou PNG, 8 Mo au plus.'); return }
      setCover({ uri: a.uri, mime: a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg' })
    } catch (e) { showDialog('Galerie indisponible', (e as Error).message) }
  }

  const state: ComposeState = {
    hasVideo: !!video || !!asset, size: video ? video.size : null, duration: video ? video.duration : asset ? asset.duration_sec : null,
    title, chosen, opts, creators, when, at, sameTime, times,
  }
  const now = useNow()
  const sp = useMemo(() => stepProblems(state, config, now.getTime(), fmtSize, fmtDuration),
    [video, asset, title, chosen.map(accKey).join(), opts, creators, when, at, sameTime, times, config, now]) // eslint-disable-line react-hooks/exhaustive-deps
  const problems = [...sp.content, ...sp.targets, ...sp.options]
  const count = captionCount(caption)
  const hasTikTok = chosen.some(a => a.platform === 'tiktok')
  const tiktokBranded = chosen.some(a => { const o = opts[accKey(a)] as TikTokOpts | undefined; return a.platform === 'tiktok' && o?.mode === 'direct' && o.commercial && o.branded })
  const n = chosen.length
  const needOpts = needsOptions(chosen, opts)
  const total = needOpts || wantOpts ? 3 : 2
  const timeOf = (k: string) => (when === 'now' ? new Date() : sameTime ? at : times[k] || at)
  const whenTxt = when === 'now' ? 'dès l’envoi de la vidéo'
    : sameTime ? at.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'heures par compte'
  const summary = n ? `${n} compte${n > 1 ? 's' : ''} · ${whenTxt}` : 'Aucun compte choisi'
  const nets = [...new Set(chosen.filter(a => {
    const o = opts[accKey(a)]
    return a.platform === 'youtube' ? !(o as YouTubeOpts)?.kids : a.platform === 'tiktok' && (o as TikTokOpts)?.mode === 'direct' && !(o as TikTokOpts)?.privacy
  }).map(a => PLATFORM_LABEL[a.platform]))]

  // Ce qui est déjà prévu sur les comptes choisis, le jour de cette publication.
  const dayKeys = [...new Set(chosen.map(a => timeOf(accKey(a)).toDateString()))].sort().join('|')
  const near = useLoad(() => {
    if (step !== 2 || !n) return Promise.resolve(null)
    const ds = chosen.map(a => timeOf(accKey(a)).getTime())
    const a = new Date(Math.min(...ds)); a.setHours(0, 0, 0, 0)
    const b = new Date(Math.max(...ds)); b.setHours(23, 59, 59, 999)
    return getCalendar({ org: null, group: null, sel: ['all'] }, a, b).catch(() => null)
  }, [step, dayKeys, picked.join()], 'compose-near')
  const nearby = useMemo(() => nearbyPosts((near.data?.items || []).map(i => ({ ...i, status: (i as { status?: string }).status })), chosen, timeOf),
    [near.data, chosen.map(accKey).join(), when, at.getTime(), sameTime, times]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = tooClose(nearby).map(k => known[k]?.name || k)

  const publish = async () => {
    if (!state.hasVideo || problems.length || busy) return
    if (isRisky(rights || null) && n) {
      const names = [...new Set(chosen.map(a => PLATFORM_LABEL[a.platform]))].join(', ')
      const ok = await new Promise<boolean>(res => showDialog('Œuvre protégée', `${RIGHTS_WARNING}\n\nPublier quand même sur ${names} ?`, [
        { text: 'Annuler', style: 'cancel', onPress: () => res(false) }, { text: 'Publier quand même', style: 'destructive', onPress: () => res(true) },
      ], { cancelable: true, onDismiss: () => res(false) }))
      if (!ok) return
    }
    setErr(''); setErrCode(null); setProgress(0)
    const s = { ...state, caption, rights: rights || undefined, rightsNote }
    try {
      if (asset) {
        const made = await createPost(buildBody(postOrg(chosen, org).org, s, { kind: 'asset', id: asset.id }))
        if (cover) await uploadCover(made.post_id, cover.uri, cover.mime)
      } else if (video) {
        const body = buildBody(postOrg(chosen, org).org, s, { kind: 'file', name: video.name, size: video.size })
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
      clearDraft()
      published.current = true
      const flash = asset
        ? (when === 'now' ? 'Publication lancée depuis la bibliothèque.' : 'Publication programmée : la vidéo sera récupérée dans le Drive à l’heure prévue.')
        : (when === 'now' ? 'Publication lancée.' : 'Publication programmée.')
      if (params.first) {
        // Première vidéo de l'inscription : écran de réussite (et demande de notifications).
        const names = [...new Set(chosen.map(a => PLATFORM_LABEL[a.platform]))].join(', ')
        const w = when === 'now' ? 'dans quelques minutes' : at.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
        router.replace({ pathname: '/setup/done', params: { when: w, accounts: names } })
        return
      }
      router.dismissTo({ pathname: '/', params: { day: landingDay(s), flash, t: String(Date.now()) } })
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      setErrCode(((e as { data?: { code?: string } }).data?.code) || null)
      setErr(`${(e as Error).message}${sent.current ? ' Touchez de nouveau le bouton : l’envoi reprendra où il s’est arrêté.' : ''}`)
      setProgress(null)
    }
  }

  const go = (to: 1 | 2 | 3) => { Haptics.selectionAsync().catch(() => {}); setStep(to) }
  const pct = Math.round((progress || 0) * 100)
  const finalTitle = busy ? 'Envoi en cours…' : when === 'now' ? 'Terminer et publier' : 'Terminer et planifier'
  const blocking = step === 1 ? sp.content : step === 2 ? [...sp.targets, ...(total === 2 ? sp.options : [])] : sp.options
  const isLast = step === total
  const primary = step === 1
    ? <Button kind="primary" icon="right" title="Suivant" disabled={sp.content.length > 0} onPress={() => go(2)} style={{ flex: 1 }} />
    : !isLast
      ? <Button kind="primary" icon="right" title={nets.length ? `Suivant · ${nets.join(' et ')}` : 'Suivant · réglages'} disabled={sp.targets.length > 0} onPress={() => go(3)} style={{ flex: 1 }} />
      : <Button kind="primary" icon={when === 'now' ? 'bolt' : 'clock'} title={finalTitle} loading={busy}
          disabled={!canEdit || problems.length > 0} onPress={publish} style={{ flex: 1 }} />
  const footer = (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: insets.bottom + space.md, gap: space.sm,
      backgroundColor: c.surface, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
      {busy ? (
        <>
          <Txt small muted numberOfLines={2} accessibilityRole="text">
            {video && !asset ? pct >= 100 ? 'Vidéo envoyée · préparation de la publication…' : `Envoi de la vidéo… ${pct} %${video.size ? ` (${fmtSize(video.size * (progress || 0))} / ${fmtSize(video.size)})` : ''}` : 'Envoi…'}
          </Txt>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}
            style={{ height: 6, borderRadius: 3, backgroundColor: c.surface2, overflow: 'hidden' }}>
            <View style={{ width: `${pct}%`, height: 6, backgroundColor: c.primary }} />
          </View>
          <Txt size={12} faint>Astuce · {TIPS[Math.floor(Date.now() / 6000) % TIPS.length]}</Txt>
          <Txt size={12} faint>Gardez l’app ouverte pendant l’envoi.</Txt>
        </>
      ) : isLast && step > 1 ? <Txt small muted numberOfLines={2}>{summary}</Txt> : null}
      <Row gap={space.sm}>
        {step > 1 ? <Button kind="ghost" icon="left" title="Retour" disabled={busy} onPress={() => go((step - 1) as 1 | 2)} /> : null}
        {primary}
      </Row>
      {!busy ? <Missing items={blocking.slice(0, 2).map(p => p.replace(/\.$/, '').replace(/^./, x => x.toLowerCase()))} /> : null}
    </View>
  )

  const labels = ['Votre vidéo', 'Où et quand', 'Réglages par réseau']
  const intro = step === 1 ? 'Vidéo, titre et légende : écrits une fois, ils partent sur tous les comptes.'
    : step === 2 ? (total === 2 ? 'Dernière étape : choisissez les comptes et l’heure, et c’est programmé.' : 'Plus qu’à choisir les comptes et l’heure.')
    : `Encore un détail${nets.length ? ` demandé par ${nets.join(' et ')}` : ''}, et c’est en ligne.`
  const thumb = cover?.uri || null

  return (
    <>
      <Stack.Screen options={{ title: labels[step - 1], gestureEnabled: !busy }} />
      <Screen key={step} footer={footer}>
        <StepProgress step={step} total={total} label={labels[step - 1]} />
        <Txt muted>{intro}</Txt>
        {step === 1 ? <StorageBanner space={spacesAll.find(x => x.org_id === org)} /> : null}
        {resumed && step === 1 ? (
          <Msg kind="info">Saisie reprise là où vous l’aviez laissée.{' '}
            <Text onPress={restart} style={{ color: c.primary, fontWeight: '600' }} accessibilityRole="button">Repartir de zéro</Text>
          </Msg>
        ) : null}
        {!canEdit ? <Msg kind="err">Votre rôle dans cette équipe (lecteur) ne permet pas de publier. Demandez à un administrateur de l’équipe.</Msg> : null}
        {accounts.error ? <Msg kind="err">{accounts.error}</Msg> : null}

        {step === 1 ? (
          <>
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
                    style={({ pressed }) => ({ minHeight: 96, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.borderStrong,
                      alignItems: 'center', justifyContent: 'center', gap: 4, padding: space.md, opacity: pressed ? 0.7 : 1 })}>
                    <Icon name={video ? 'video' : 'upload'} size={22} color={c.muted} />
                    <Txt bold numberOfLines={1}>{video ? video.name : 'Choisir une vidéo'}</Txt>
                    <Txt size={12} muted>{video ? `${video.size ? fmtSize(video.size) : 'taille inconnue'} · ${fmtDuration(video.duration)} · toucher pour changer` : `MP4 ou MOV, vertical, ${config ? fmtSize(config.max_upload_bytes) : '1 Go'} au plus`}</Txt>
                  </Pressable>
                  {robot.data?.enabled ? <Button icon="layers" title="Choisir dans la bibliothèque" disabled={busy} onPress={() => setLibrary(true)} /> : null}
                  {video ? <LocalPreview key={video.uri} uri={video.uri} /> : null}
                </>
              )}
            </Section>

            <Section title="Texte">
              <Field label="Titre" value={title} maxLength={200} editable={!busy} onChangeText={setTitle}
                placeholder="Ex. : Tuto coiffure en 30 secondes" hint="Titre sur YouTube et dans votre planning. Pas affiché sur TikTok ni Instagram." />
              <Field label="Légende" value={caption} maxLength={CAPTION_MAX} editable={!busy} onChangeText={setCaption} multiline
                placeholder="Le texte sous la vidéo, avec vos #hashtags"
                hint={`${count.chars.toLocaleString('fr-FR')} / 2 200 · ${count.tags} hashtag${count.tags > 1 ? 's' : ''} · la même sur chaque compte`} />
            </Section>

            <Section title="Couverture" aside={<Txt small muted>Facultatif</Txt>}>
              <Row gap={space.md} style={{ alignItems: 'center' }}>
                {cover ? <Image source={{ uri: cover.uri }} style={{ width: 54, height: 96, borderRadius: 8 }} contentFit="cover" accessibilityLabel="Couverture choisie" />
                  : <View style={{ width: 54, height: 96, borderRadius: 8, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="upload" size={18} color={c.faint} /></View>}
                <View style={{ flex: 1, gap: 6 }}>
                  <Button small title={cover ? 'Changer l’image' : 'Choisir une image'} disabled={busy} onPress={pickCover} style={{ alignSelf: 'flex-start' }} />
                  {cover ? <Button small kind="ghost" title="Retirer" disabled={busy} onPress={() => setCover(null)} style={{ alignSelf: 'flex-start' }} /> : null}
                  <Txt size={12} muted>Utilisée pour Instagram. Sinon : l’image à côté de la vidéo dans le Drive{asset?.has_cover ? ' (trouvée)' : ''}, ou celle choisie par le réseau.</Txt>
                </View>
              </Row>
            </Section>

            <Section title="Droits d’auteur" aside={<Txt small muted>Facultatif</Txt>}>
              <Txt small muted>La vidéo reprend-elle une œuvre (musique, chorégraphie, extrait) ?</Txt>
              <Row wrap>
                {(['public_domain', 'protected', 'unknown'] as Rights[]).map(r => (
                  <Chip key={r} label={RIGHTS_LABEL[r]} selected={rights === r} onPress={busy ? undefined : () => setRights(rights === r ? '' : r)} />
                ))}
              </Row>
              {isRisky(rights || null) ? <Msg kind="warn">{RIGHTS_WARNING}</Msg> : null}
              {rights ? <Field value={rightsNote} onChangeText={setRightsNote} maxLength={300} editable={!busy}
                placeholder="Note (ex. reprise — Wicked, Stephen Schwartz)" accessibilityLabel="Note sur les droits" /> : null}
            </Section>

            {title.trim() || caption.trim() || video || asset ? (
              <Card style={{ gap: space.sm }}>
                <Txt small bold muted>Aperçu</Txt>
                <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
                  <View style={{ width: 54, height: 96, borderRadius: 8, backgroundColor: c.ink, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                    {thumb ? <Image source={{ uri: thumb }} style={{ width: 54, height: 96 }} contentFit="cover" />
                      : asset?.thumbnail && headers ? <Image source={{ uri: apiUrl(asset.thumbnail, org), headers }} style={{ width: 54, height: 96 }} contentFit="cover" />
                      : <Icon name="video" size={18} color={c.onInk} />}
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Txt bold numberOfLines={2}>{title.trim() || 'Sans titre'}</Txt>
                    <Txt small muted numberOfLines={4}>{caption.trim() || 'Pas de légende'}</Txt>
                  </View>
                </Row>
              </Card>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            {accounts.loading && !accounts.data ? <Loading /> : null}
            {accounts.data && all.length === 0 ? (
              <Msg>Aucun compte connecté. Connectez TikTok, YouTube ou Instagram dans Comptes pour publier.</Msg>
            ) : null}
            <Section title={`Comptes${n ? ` · ${n}` : ''}`} aside={n ? <Button small kind="ghost" title="Modifier" disabled={busy} onPress={() => setPicking(true)} /> : undefined}>
              {!n ? (
                <>
                  <Txt small muted>Un ou plusieurs comptes, ou un groupe entier en une fois.</Txt>
                  <Button kind="secondary" icon="plus" title="Choisir les comptes" onPress={() => setPicking(true)} />
                </>
              ) : null}
              {chosen.map(a => {
                const k = accKey(a)
                return (
                  <Row key={k} gap={space.md} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingTop: space.sm }}>
                    <Avatar src={a.avatar_url} name={a.name} platform={a.platform} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt bold numberOfLines={1}>{a.name || PLATFORM_LABEL[a.platform]}</Txt>
                      <Txt small muted numberOfLines={1}>{summaryOf(a, opts[k])}</Txt>
                    </View>
                    <Pressable onPress={() => remove(k)} disabled={busy} accessibilityRole="button" accessibilityLabel={`Retirer ${a.name || PLATFORM_LABEL[a.platform]}`}
                      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="close" size={18} color={c.muted} />
                    </Pressable>
                  </Row>
                )
              })}
            </Section>

            <Section title="Quand">
              <Seg label="Quand" value={when} onChange={v => !busy && setWhen(v)} options={[['at', 'Planifier'], ['now', 'Tout de suite']]} />
              {when === 'at' ? (
                <>
                  {sameTime ? <TooSoon at={at} now={now} onNext={setAt} onNow={() => setWhen('now')} /> : null}
                  {sameTime ? <DateTimeField label="Jour et heure" value={at} onChange={setAt} disabled={busy} minimumDate={new Date()} /> : null}
                  {n > 1 ? <Check label="Même heure pour tous les comptes" checked={sameTime} onChange={setSameTime} disabled={busy} /> : null}
                  {!sameTime ? chosen.map(a => (
                    <View key={accKey(a)} style={{ gap: 8 }}>
                    <TooSoon at={times[accKey(a)] || at} now={now} onNext={d => setTimes(t => ({ ...t, [accKey(a)]: d }))} />
                    <DateTimeField label={`${a.name || ''} (${PLATFORM_LABEL[a.platform]})`} value={times[accKey(a)] || at} disabled={busy}
                      minimumDate={new Date()} onChange={d => setTimes(t => ({ ...t, [accKey(a)]: d }))} />
                    </View>
                  )) : null}
                  <Txt size={12} muted>Fuseau : {Intl.DateTimeFormat().resolvedOptions().timeZone}.</Txt>
                </>
              ) : <Txt small muted>La publication part dès que la vidéo est envoyée.</Txt>}
            </Section>

            {n ? (
              <Section title="Déjà prévu ce jour-là">
                {close.length ? (
                  <Msg kind="warn">Attention : cette vidéo sera postée à moins d’1 h d’une autre sur {close.join(', ')}. Les réseaux montrent moins deux vidéos trop proches.</Msg>
                ) : null}
                {near.loading && !near.data ? <Txt small muted>Lecture du planning…</Txt> : null}
                {chosen.map(a => {
                  const k = accKey(a), list = nearby[k] || [], mine = timeOf(k)
                  return (
                    <View key={k} style={{ gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingTop: space.sm }}>
                      <Row gap={6}><Avatar src={a.avatar_url} name={a.name} platform={a.platform} size={20} /><Txt small bold numberOfLines={1} style={{ flex: 1 }}>{a.name || PLATFORM_LABEL[a.platform]}</Txt></Row>
                      {[...list.map(x => ({ at: x.at, title: x.title, warn: x.minutes < 60, me: false })), { at: mine, title: title.trim() || 'Cette vidéo', warn: false, me: true }]
                        .sort((x, y) => x.at.getTime() - y.at.getTime())
                        .map((x, i) => (
                          <Row key={i} gap={space.sm}>
                            <Txt small bold color={x.me ? c.primary : x.warn ? c.warn : c.muted} style={{ width: 48 }}>
                              {x.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </Txt>
                            <Txt small numberOfLines={1} style={{ flex: 1 }} color={x.me ? c.primary : c.text}>{x.me ? `${x.title} (celle-ci)` : x.title}</Txt>
                            {x.warn ? <Icon name="clock" size={14} color={c.warn} /> : null}
                          </Row>
                        ))}
                      {!list.length && near.data ? <Txt size={12} muted>Rien d’autre ce jour-là.</Txt> : null}
                    </View>
                  )
                })}
              </Section>
            ) : null}

            {!needOpts && n && step === total ? (
              <Button kind="ghost" icon="settings" title="Réglages par réseau (facultatif)" onPress={() => { setWantOpts(true); go(3) }} />
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            {when === 'at' && sameTime ? <TooSoon at={at} now={now} onNext={setAt} onNow={() => setWhen('now')} /> : null}
            {when === 'at' && !sameTime && sp.targets.length ? <Msg kind="warn">{sp.targets[0]} Revenez à l’étape précédente pour la changer.</Msg> : null}
            {chosen.map(a => {
              const k = accKey(a), o = opts[k]
              if (!o) return null
              return (
                <Section key={k} title={a.name || PLATFORM_LABEL[a.platform]} aside={<Txt small muted>{PLATFORM_LABEL[a.platform]}</Txt>}>
                  {a.platform === 'tiktok' ? <TikTokPanel account={a} o={o as TikTokOpts} ci={creators[k]} busy={busy} set={p => set<TikTokOpts>(k, p)} />
                    : a.platform === 'youtube' ? <YouTubePanel o={o as YouTubeOpts} busy={busy} set={p => set<YouTubeOpts>(k, p)} />
                    : <InstaPanel o={o as InstaOpts} busy={busy} set={p => set<InstaOpts>(k, p)} />}
                </Section>
              )
            })}
          </>
        ) : null}

        {isLast && hasTikTok ? (
          <Txt size={12} muted>
            En publiant, vous acceptez {tiktokBranded ? <><Text style={{ color: c.accent }} onPress={() => openLink(TIKTOK_BC_URL)} accessibilityRole="link">la Branded Content Policy</Text> et </> : null}
            <Text style={{ color: c.accent }} onPress={() => openLink(TIKTOK_MUSIC_URL)} accessibilityRole="link">la Music Usage Confirmation</Text> de TikTok.
            {' '}Le traitement peut prendre quelques minutes avant que la vidéo soit visible.
          </Txt>
        ) : null}
        {err ? <Msg kind="err">{err}</Msg> : null}
        {errCode === 'storage_required' || errCode === 'storage_full' ? (
          <Button icon="folder" title={errCode === 'storage_full' ? 'Voir le stockage' : 'Relier Google Drive'} onPress={() => router.push('/storage')} />
        ) : null}
        {isLast && step === 2 && sp.options.length > 0 && n > 0 ? (
          <View style={{ gap: 4 }} accessibilityLabel="À corriger avant l’envoi">
            {sp.options.map(p => <Txt key={p} small muted>• {p}</Txt>)}
          </View>
        ) : null}
        {step === 3 && sp.options.length > 0 ? (
          <View style={{ gap: 4 }} accessibilityLabel="À corriger avant l’envoi">
            {sp.options.map(p => <Txt key={p} small muted>• {p}</Txt>)}
          </View>
        ) : null}
        <Sheet visible={!!ask} title="Une question rapide" onClose={() => answer(null)}>
          <Txt muted>Qu’est-ce qui vous a arrêté ? Facultatif, ça nous aide à simplifier l’app.</Txt>
          {([['no_video', 'Ma vidéo n’était pas prête'], ['when', 'Je ne savais pas quand publier'], ['accounts', 'Un souci avec mes comptes'], ['too_complex', 'C’était trop compliqué']] as [AbandonReason, string][]).map(([k, l]) => (
            <Button key={k} title={l} onPress={() => answer(k)} />
          ))}
          <Field label="Autre raison" value={otherText} onChangeText={setOtherText} maxLength={500} placeholder="En quelques mots" />
          {otherText.trim() ? <Button kind="primary" title="Envoyer" onPress={() => answer('other')} /> : null}
          <Button kind="ghost" title="Passer" onPress={() => answer(null)} />
        </Sheet>
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
