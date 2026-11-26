// Nouvelle publication, deux grandes étapes : 1. la vidéo, puis (carte qui apparaît) titre et légende, puis public,
// droits et IA ; 2. les comptes et le jour / l'heure. Ensuite « Planifier » directement, ou « Réglages » (un onglet par
// compte, on glisse de l'un à l'autre) quand un réseau en demande (TikTok). Avant l'envoi, une fenêtre fait valider
// chaque compte (modifiable sur place, ou retiré). Mêmes règles que cm/src/pages/Composer.tsx.
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
import { Pressable, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  creatorInfo, createPost, getCalendar, sendFeedback, type AbandonReason, isRisky, RIGHTS_LABEL, RIGHTS_WARNING, type Rights, deletePost, getAccounts, getAsset, getProposal, getRobot, submitPost, PLATFORM_LABEL,
  type Account, type Asset,
} from '../lib/api'
import { fmtDuration, fmtSize, TIKTOK_BC_URL, TIKTOK_MUSIC_URL, TIKTOK_PRIVACY } from '../lib/format'
import { useLoad, useRole, useSession } from '../lib/session'
import { uploadCover, uploadParts } from '../lib/upload'
import { Avatar, Button, Chip, Field, Icon, Loading, Msg, Row, Screen, Seg, Sheet, Txt } from '../ui/kit'
import { Missing, StepProgress } from '../ui/Progress'
import { locale } from '../lib/locale'
import { radius, space, useTheme } from '../ui/theme'
import {
  accKey, accountProblems, buildBody, postOrg, captionCount, CAPTION_MAX, defaults, fileNameOf, groupAccounts, landingDay, nearbyPosts, earliestSlot,
  needsOptions, recapOf, stepProblems, tooClose,
  titleFromFile, YT_PRIVACY, type ComposeState, type CreatorState, type InstaOpts, type Opts, type TikTokOpts, type YouTubeOpts,
} from '../features/planning/compose'
import { AccountSheet } from '../features/planning/AccountSheet'
import { LibrarySheet } from '../features/planning/LibrarySheet'
import { apiUrl, openLink, useAuthHeaders } from '../features/planning/media'
import { InstaPanel, TikTokPanel, YouTubePanel, type Common, type Media } from '../features/planning/Panels'
import { Check, Section, useNow } from '../features/planning/ui'
import { DateParts } from '../features/planning/DateParts'
import { AccountPager } from '../features/planning/AccountPager'
import { ReviewSheet } from '../features/planning/ReviewSheet'
import { fmtTime as fmtMs } from '../features/planning/FramePicker'
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
  const [cover, setCover] = useState<Cover | null>(null)          // image Instagram à part (facultative)
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [picking, setPicking] = useState(false)
  const [library, setLibrary] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)
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
  // Communs à tous les comptes (étape 1), recopiés dans les réglages de chaque réseau qui les connaît.
  const [kids, setKids] = useState<'' | 'yes' | 'no'>('')   // YouTube : conçue pour les enfants (à dire explicitement)
  const [ai, setAi] = useState(false)                        // YouTube « synthétique », TikTok « généré par IA »
  useEffect(() => {
    setOpts(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k,
      k.startsWith('youtube:') ? { ...v, kids, synthetic: ai } : k.startsWith('tiktok:') ? { ...v, aigc: ai } : v])))
  }, [kids, ai])
  const [review, setReview] = useState(false)
  const [captionOpen, setCaptionOpen] = useState(false)
  const scroll = useRef<ScrollViewInstance>(null)
  const textY = useRef(0)

  // Saisie gardée sur le téléphone (appel, notification, app fermée) : reprise à la réouverture.
  const { me } = useSession()
  const draftKey = `cm.draft.new.${me?.id ?? 0}`
  const fresh = !params.asset && !params.proposal && !params.shared
  const restored = useRef(false)
  const [resumed, setResumed] = useState(false)
  type Draft = { title: string; caption: string; picked: string[]; when: 'now' | 'at'; at: string; sameTime: boolean; video: PickedVideo | null; rights: Rights | ''; rightsNote: string; savedAt: number; step?: 1 | 2 | 3; kids?: '' | 'yes' | 'no'; ai?: boolean }
  useEffect(() => {
    if (!fresh || restored.current || !accounts.data) return
    restored.current = true
    AsyncStorage.getItem(draftKey).then(raw => {
      if (!raw) return
      const d = JSON.parse(raw) as Draft
      if (Date.now() - d.savedAt > 7 * 864e5 || (!d.title && !d.caption && !d.video)) return
      setTitle(d.title); setCaption(d.caption); setWhen(d.when); setSameTime(d.sameTime); setRights(d.rights); setRightsNote(d.rightsNote)
      setKids(d.kids || ''); setAi(!!d.ai)
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
      const d: Draft = { title, caption, picked, when, at: at.toISOString(), sameTime, video, rights, rightsNote, savedAt: Date.now(), step, kids, ai }
      AsyncStorage.setItem(draftKey, JSON.stringify(d)).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [title, caption, picked, when, at, sameTime, video, rights, rightsNote, step, kids, ai]) // eslint-disable-line react-hooks/exhaustive-deps
  const clearDraft = () => AsyncStorage.removeItem(draftKey).catch(() => {})
  const restart = () => {
    clearDraft(); setResumed(false); setTitle(''); setCaption(''); setVideo(null); setPicked([]); setRights(''); setRightsNote(''); setWhen('at'); setAt(earliestSlot()); setStep(1); setKids(''); setAi(false)
  }

  const add = (list: Account[]) => {
    const fresh = list.filter(a => a.can_publish && a.role !== 'viewer')
    if (!fresh.length) return
    setKnown(k => ({ ...k, ...Object.fromEntries(fresh.map(a => [accKey(a), a])) }))
    setPicked(p => [...p, ...fresh.map(accKey).filter(k => !p.includes(k))])
    setOpts(o => {
      const n = { ...o }
      for (const a of fresh) {
        if (n[accKey(a)]) continue
        const d = defaults(a)
        n[accKey(a)] = a.platform === 'youtube' ? { ...d, kids, synthetic: ai } : a.platform === 'tiktok' ? { ...d, aigc: ai } : d
      }
      return n
    })
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

  // Autre vidéo : les miniatures choisies (instants de l'ancienne vidéo) sont oubliées.
  useEffect(() => {
    setOpts(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, 'coverMs' in v ? { ...v, coverMs: null } : v])))
  }, [video?.uri, asset?.id])
  const state: ComposeState = {
    hasVideo: !!video || !!asset, size: video ? video.size : null, duration: video ? video.duration : asset ? asset.duration_sec : null,
    title, chosen, opts, creators, when, at, sameTime, times, coverImage: !!cover,
  }
  const now = useNow()
  const sp = useMemo(() => stepProblems(state, config, now.getTime(), fmtSize, fmtDuration),
    [video, asset, title, chosen.map(accKey).join(), opts, creators, when, at, sameTime, times, config, now]) // eslint-disable-line react-hooks/exhaustive-deps
  const problems = [...sp.content, ...sp.targets, ...sp.options]
  const count = captionCount(caption)
  const hasTikTok = chosen.some(a => a.platform === 'tiktok')
  const tiktokBranded = chosen.some(a => { const o = opts[accKey(a)] as TikTokOpts | undefined; return a.platform === 'tiktok' && o?.mode === 'direct' && o.commercial && o.branded })
  const n = chosen.length
  const hasYouTube = chosen.some(a => a.platform === 'youtube')
  // Réglages compte par compte seulement si un réseau en demande (TikTok direct : visibilité à choisir à la main).
  const needSettings = needsOptions(chosen, opts)
  const total = needSettings || step === 3 ? 3 : 2
  const timeOf = (k: string) => (when === 'now' ? new Date() : sameTime ? at : times[k] || at)
  const kidsMissing = hasYouTube && !kids ? ['Indiquez si la vidéo est conçue pour les enfants (YouTube le demande).'] : []

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
    setReview(false); setErr(''); setErrCode(null); setProgress(0)
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
        const w = when === 'now' ? 'dans quelques minutes' : at.toLocaleString(locale(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
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
  const finalLabel = when === 'now' ? 'Valider et publier' : 'Valider et planifier'
  const accProblems = (a: Account) => accountProblems(a, state, config, fmtDuration)
  const openReview = () => { Haptics.selectionAsync().catch(() => {}); setReview(true) }
  const blocking = step === 1 ? sp.content : step === 2 ? [...sp.targets, ...kidsMissing] : sp.options
  const toSettings = <Button kind="primary" icon="right" title="Suivant · réglages" disabled={sp.targets.length > 0 || kidsMissing.length > 0} onPress={() => go(3)} style={{ flex: 1 }} />
  const plan = <Button kind="primary" icon={when === 'now' ? 'bolt' : 'clock'} title={busy ? 'Envoi en cours…' : when === 'now' ? 'Publier' : 'Planifier'} loading={busy}
    disabled={!canEdit || sp.targets.length > 0 || kidsMissing.length > 0 || sp.content.length > 0} onPress={openReview} style={{ flex: 1 }} />
  const primary = step === 1
    ? <Button kind="primary" icon="right" title="Suivant" disabled={sp.content.length > 0} onPress={() => go(2)} style={{ flex: 1 }} />
    : step === 2 ? (needSettings ? toSettings : plan) : plan
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
      ) : null}
      <Row gap={space.sm}>
        {step > 1 ? <Button kind="ghost" icon="left" title="Retour" disabled={busy} onPress={() => go((step - 1) as 1 | 2)} /> : null}
        {primary}
      </Row>
      {step === 2 && !needSettings && n > 0 && !busy ? (
        <Button small kind="ghost" icon="settings" title="Régler chaque compte (facultatif)" onPress={() => go(3)} />
      ) : null}
      {!busy ? <Missing items={blocking.slice(0, 2).map(p => p.replace(/\.$/, '').replace(/^./, x => x.toLowerCase()))} /> : null}
    </View>
  )

  const labels = ['Votre vidéo', 'Comptes et date', 'Réglages']
  const media: Media = { duration: state.duration,
    source: video ? video.uri : asset && headers ? { uri: apiUrl(asset.stream || `/api/cm/assets/${asset.id}/stream`, org), headers } : null }
  const common: Common = { title, caption }
  const hasVideo = !!video || !!asset
  // Vidéo choisie : la carte du titre et de la légende apparaît, l'écran descend jusqu'à elle.
  const wasVideo = useRef(hasVideo)
  useEffect(() => {
    if (hasVideo && !wasVideo.current) setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, textY.current - 12), animated: true }), 250)
    wasVideo.current = hasVideo
  }, [hasVideo])
  const panel = (a: Account) => {
    const k = accKey(a), o = opts[k]
    if (!o) return null
    return a.platform === 'tiktok' ? <TikTokPanel account={a} o={o as TikTokOpts} ci={creators[k]} busy={busy} set={p => set<TikTokOpts>(k, p)} media={media} common={common} />
      : a.platform === 'youtube' ? <YouTubePanel o={o as YouTubeOpts} busy={busy} set={p => set<YouTubeOpts>(k, p)} common={common} />
      : <InstaPanel o={o as InstaOpts} busy={busy} set={p => set<InstaOpts>(k, p)} media={media} common={common}
          image={{ uri: cover?.uri || null, pick: pickCover, remove: () => setCover(null), fromDrive: !!asset?.has_cover }} />
  }
  const recap = (a: Account) => {
    const o = opts[accKey(a)]
    return o ? recapOf(a, o, common, { privacyLabel: v => TIKTOK_PRIVACY[v] || v, coverImage: !!cover, fmtMs: ms => fmtMs(ms / 1000) }) : []
  }
  const pickers = (
    <Row gap={space.sm}>
      {robot.data?.enabled ? <Button icon="layers" title="Bibliothèque" disabled={busy} onPress={() => setLibrary(true)} style={{ flex: 1 }} /> : null}
      <Button icon="upload" title={video ? 'Autre fichier' : 'Fichier'} disabled={busy} onPress={pickVideo} style={{ flex: 1 }} />
    </Row>
  )

  return (
    <>
      <Stack.Screen options={{ title: labels[step - 1], gestureEnabled: !busy }} />
      <Screen key={step} footer={footer} scrollRef={scroll}>
        <StepProgress step={step} total={total} label={labels[step - 1]} />
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
            <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
              {asset ? (
                <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
                  <View style={{ width: 72, height: 104, borderRadius: radius.sm, backgroundColor: c.surface2, overflow: 'hidden' }}>
                    {asset.thumbnail && headers ? <Image source={{ uri: apiUrl(asset.thumbnail, org), headers }} style={{ width: 72, height: 104 }} contentFit="cover" /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Txt bold numberOfLines={2}>{asset.name}</Txt>
                    <Txt small muted>{fmtDuration(asset.duration_sec)}{asset.size ? ` · ${fmtSize(asset.size)}` : ''}</Txt>
                    <Txt small muted numberOfLines={1}>{asset.source_name}{asset.folder ? ` / ${asset.folder}` : ''}</Txt>
                  </View>
                </Row>
              ) : video ? (
                <>
                  <Txt bold numberOfLines={1}>{video.name}</Txt>
                  <Txt size={12} muted>{video.size ? fmtSize(video.size) : 'taille inconnue'} · {fmtDuration(video.duration)}</Txt>
                  <LocalPreview key={video.uri} uri={video.uri} />
                </>
              ) : null}
              {pickers}
              {!hasVideo ? <Txt size={12} muted center>MP4 ou MOV, vertical, {config ? fmtSize(config.max_upload_bytes) : '1 Go'} au plus</Txt> : null}
            </View>

            {hasVideo ? (
              <View onLayout={e => { textY.current = e.nativeEvent.layout.y }}
                style={{ backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
                <View style={{ gap: 6 }}>
                  <Row gap={6}>
                    <Txt small bold>Titre</Txt>
                    <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel="À quoi sert le titre"
                      onPress={() => showDialog('Titre', 'Le titre est le nom de la publication dans votre planning. Il est aussi proposé aux réseaux qui acceptent un titre (modifiable pour chacun dans les réglages).')}>
                      <Icon name="info" size={16} color={c.muted} />
                    </Pressable>
                  </Row>
                  <Field value={title} maxLength={200} editable={!busy} onChangeText={setTitle} accessibilityLabel="Titre" placeholder="Ex. : Tuto coiffure en 30 secondes" />
                </View>
                <View style={{ gap: 6 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt small bold>Légende</Txt>
                    {caption.length > 120 ? (
                      <Pressable hitSlop={10} onPress={() => setCaptionOpen(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: captionOpen }}>
                        <Txt small bold color={c.accent}>{captionOpen ? 'Réduire' : 'Tout afficher'}</Txt>
                      </Pressable>
                    ) : null}
                  </Row>
                  <Field value={caption} maxLength={CAPTION_MAX} editable={!busy} onChangeText={setCaption} multiline accessibilityLabel="Légende"
                    placeholder="Le texte sous la vidéo, avec vos #hashtags" style={captionOpen ? undefined : { maxHeight: 150 }}
                    hint={`${count.chars.toLocaleString(locale())} / ${CAPTION_MAX.toLocaleString(locale())} · ${count.tags} hashtag${count.tags > 1 ? 's' : ''}`} />
                </View>
              </View>
            ) : null}

            {hasVideo ? (
              <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
                <View style={{ gap: 6 }}>
                  <Txt small bold>Limite d’âge</Txt>
                  <Seg<'' | 'yes' | 'no'> label="Vidéo conçue pour les enfants" value={kids} onChange={v => !busy && setKids(v)}
                    options={[['no', 'Tout public'], ['yes', 'Pour les enfants']]} />
                  <Txt size={12} muted>« Pour les enfants » : conçue avant tout pour les moins de 13 ans (YouTube le demande à chaque vidéo).</Txt>
                </View>
                <View style={{ gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingTop: space.md }}>
                  <Txt small bold>Droits d’auteur</Txt>
                  <Txt size={12} muted>La vidéo reprend-elle une œuvre (musique, chorégraphie, extrait) ?</Txt>
                  <Row wrap>
                    {(['public_domain', 'protected', 'unknown'] as Rights[]).map(r => (
                      <Chip key={r} label={RIGHTS_LABEL[r]} selected={rights === r} onPress={busy ? undefined : () => setRights(rights === r ? '' : r)} />
                    ))}
                  </Row>
                  {isRisky(rights || null) ? <Msg kind="warn">{RIGHTS_WARNING}</Msg> : null}
                  {rights ? <Field value={rightsNote} onChangeText={setRightsNote} maxLength={300} editable={!busy}
                    placeholder="Note (ex. reprise — Wicked, Stephen Schwartz)" accessibilityLabel="Note sur les droits" /> : null}
                </View>
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingTop: space.md }}>
                  <Check label="Contenu généré ou modifié par IA" checked={ai} disabled={busy} onChange={setAi}
                    hint="Une personne, un lieu ou un événement réaliste créé ou modifié (IA comprise). Signalé à YouTube et TikTok." />
                </View>
              </View>
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
              {!n ? <Button kind="secondary" icon="plus" title="Choisir les comptes" onPress={() => setPicking(true)} /> : null}
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
                  {sameTime ? <DateParts value={at} onChange={setAt} disabled={busy} /> : null}
                  {n > 1 ? <Check label="Même jour et heure pour tous les comptes" checked={sameTime} onChange={setSameTime} disabled={busy} /> : null}
                  {!sameTime ? chosen.map(a => (
                    <DateParts key={accKey(a)} label={`${a.name || ''} (${PLATFORM_LABEL[a.platform]})`} value={times[accKey(a)] || at} disabled={busy}
                      onChange={d => setTimes(t => ({ ...t, [accKey(a)]: d }))} />
                  )) : null}
                </>
              ) : <Txt small muted>La publication part dès que la vidéo est envoyée.</Txt>}
            </Section>

            {n && near.data ? (
              <Section title="Déjà prévu ce jour-là">
                {close.length ? (
                  <Txt small color={c.warn}>À moins d’1 h d’une autre vidéo sur {close.join(', ')} : les réseaux montrent moins deux vidéos trop proches.</Txt>
                ) : null}
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
                              {x.at.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}
                            </Txt>
                            <Txt small numberOfLines={1} style={{ flex: 1 }} color={x.me ? c.primary : c.text}>{x.me ? `${x.title} (celle-ci)` : x.title}</Txt>
                          </Row>
                        ))}
                      {!list.length ? <Txt size={12} muted>Rien d’autre ce jour-là.</Txt> : null}
                    </View>
                  )
                })}
              </Section>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <AccountPager accounts={chosen} render={panel} problems={a => accProblems(a).length} disabled={busy}
            onRemove={a => { remove(accKey(a)); if (n <= 1) go(2) }} />
        ) : null}

        {step > 1 && hasTikTok ? (
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

      <ReviewSheet visible={review} onClose={() => setReview(false)} accounts={chosen} busy={busy} finalLabel={finalLabel}
        when={a => (when === 'now' ? null : timeOf(accKey(a)))} recap={recap} problems={accProblems} renderEdit={panel}
        onRemove={a => remove(accKey(a))} onDone={publish} />
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
