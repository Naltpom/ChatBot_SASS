// Nouvelle publication (même parcours que l'app) : 1. la vidéo, puis titre et légende, public, droits, IA ;
// 2. les comptes et le jour / l'heure ; puis « Planifier » directement, ou « Réglages » (un onglet par compte,
// carrousel) quand un réseau en demande. Une fenêtre fait valider chaque compte avant l'envoi.
// TikTok (Content Sharing Guidelines) : options du créateur relues à chaque choix du compte,
// pseudo affiché, confidentialité SANS valeur présélectionnée, interactions décochées et grisées
// si coupées chez le créateur, divulgation commerciale, Music Usage Confirmation avant l'envoi.
// Rien n'est envoyé à une plateforme avant l'heure choisie.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PlatformLogo } from '../components/PlatformLogo'
import { AccountPicker } from '../components/AccountPicker'
import { FramePicker } from '../components/FramePicker'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ALL, creatorInfo, createPost, getAccounts, getAsset, getProposal, getRobot, putCover, putPart, submitPost, PLATFORM_LABEL,
  RIGHTS_LABEL, RIGHTS_WARNING, type Account, type Asset, type CreatorInfo, type Platform, type Rights,
  type Proposal,
} from '../api'
import { Avatar, GroupDot, Icon, Loading, Msg, Seg, Sheet } from '../components/ui'
import { AssetGrid } from './Library'
import { fmtDuration, fmtSize, TIKTOK_BC_URL, TIKTOK_MUSIC_URL, TIKTOK_PRIVACY, toLocalInput } from '../format'
import { useLoad, useRole, useSession } from '../session'
import { DateParts } from '../components/DateParts'
import { AccountPager } from '../components/AccountPager'
import { ReviewSheet } from '../components/ReviewSheet'
import { fmtTime as fmtMs } from '../components/FramePicker'
import { LOCALE } from '../compose'
import { t, locale } from '../i18n'

interface TikTokOpts { mode: 'direct' | 'draft'; privacy: string; comment: boolean; duet: boolean; stitch: boolean
  commercial: boolean; yourBrand: boolean; branded: boolean; text: string; coverMs?: number | null; aigc?: boolean }
interface YouTubeOpts { title: string; description: string; privacy: string; kids: '' | 'yes' | 'no'; synthetic: boolean
  category: string; notify: boolean; tags: string }
interface InstaOpts { text: string; feed: boolean; coverMs?: number | null }
type Opts = TikTokOpts | YouTubeOpts | InstaOpts

const key = (a: Account) => `${a.platform}:${a.id}`
const YT_CATEGORIES: [string, string][] = [['10', 'Musique'], ['22', 'Personnes et blogs'], ['24', 'Divertissement'], ['27', 'Éducation'], ['26', 'Vie pratique et style']]

function defaults(a: Account): Opts {
  if (a.platform === 'tiktok') return { mode: a.can_direct === false ? 'draft' : 'direct', privacy: '', comment: false, duet: false, stitch: false, commercial: false, yourBrand: false, branded: false, text: '' }
  if (a.platform === 'youtube') return { title: '', description: '', privacy: 'public', kids: '', synthetic: false, category: '10', notify: true, tags: '' }
  return { text: '', feed: true }
}

const STEP_LABELS = ['Votre vidéo', 'Comptes et date', 'Réglages']

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card col" style={{ gap: 14 }}>
      <div className="card-head"><h2>{title}</h2>{aside && <span className="muted small row-nw" style={{ gap: 8 }}>{aside}</span>}</div>
      {children}
    </section>
  )
}

function Check({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className={`check${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span>{label}{hint && <><br /><span className="field-hint">{hint}</span></>}</span>
    </label>
  )
}

export default function Composer() {
  const { org: home, config, groups, group: currentGroup, account: currentAccount, ownerOf } = useSession()
  const nav = useNavigate()
  const { canEdit } = useRole()
  // Tous mes comptes (et ceux partagés avec moi) ; une publication = un seul propriétaire (espace).
  const accounts = useLoad(() => getAccounts(ALL), ['all'])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [rights, setRights] = useState<Rights | ''>('')       // droits d'auteur de l'œuvre (vide = non précisés)
  const [rightsNote, setRightsNote] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [opts, setOpts] = useState<Record<string, Opts>>({})
  // Autre vidéo : les miniatures choisies (instants de l'ancienne vidéo) sont oubliées.
  const forgetCovers = () => setOpts(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, 'coverMs' in v ? { ...v, coverMs: null } : v])))
  const [creators, setCreators] = useState<Record<string, CreatorInfo | 'loading' | { error: string }>>({})
  const [when, setWhen] = useState<'now' | 'at'>('at')
  // Heure proposée : dans une heure au moins, arrondie au quart d'heure suivant.
  const [at, setAt] = useState(() => { const d = new Date(Date.now() + 3600000); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return toLocalInput(d) })
  const [sameTime, setSameTime] = useState(true)
  const [times, setTimes] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState<number | null>(null)
  const [cover, setCover] = useState<File | null>(null)          // image Instagram à part (facultative)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  useEffect(() => () => { if (coverUrl) URL.revokeObjectURL(coverUrl) }, [coverUrl])
  const [err, setErr] = useState('')
  // Vidéo de la bibliothèque (dossier Drive) : rien à envoyer, téléchargée à l'heure de publication.
  const [params] = useSearchParams()
  const [asset, setAsset] = useState<Asset | null>(null)
  const [picking, setPicking] = useState(false)
  // Téléphone : en 3 étapes comme l'app (contenu → comptes et heure → réglages par réseau). Ordinateur : tout sur une vue.
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const go = (n: 1 | 2 | 3) => { setStep(n); window.scrollTo(0, 0) }
  // Communs à tous les comptes (étape 1), recopiés dans les réglages des réseaux qui les connaissent.
  const [kids, setKids] = useState<'' | 'yes' | 'no'>('')
  const [ai, setAi] = useState(false)
  const [review, setReview] = useState(false)
  const [captionOpen, setCaptionOpen] = useState(false)
  const textCard = useRef<HTMLElement>(null)
  const [pickQ, setPickQ] = useState('')
  const robot = useLoad(() => getRobot(), [])
  const useAsset = (a: Asset) => {
    setAsset(a); setPicking(false); setErr('')
    setFile(null); if (preview) URL.revokeObjectURL(preview); setPreview(null)
    setDuration(a.duration_sec); forgetCovers()
    setTitle(a.title.slice(0, 200))
    setCaption(a.caption || '')
    if (a.group_id) add(groupAccounts(a.group_id))
  }
  useEffect(() => {
    const id = Number(params.get('video'))
    if (!id || asset) return
    getAsset(baseOrg, id).then(a => { if (accounts.data) useAsset(a); else setPendingAsset(a) }).catch(e => setErr((e as Error).message))
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  // Brouillon automatique (« À valider ») : vidéo, comptes, heure, titre et légende pré-remplis.
  const [draft, setDraft] = useState<Proposal | null>(null)
  useEffect(() => {
    const id = Number(params.get('brouillon'))
    if (!id) return
    getProposal(baseOrg, id).then(setDraft).catch(e => setErr((e as Error).message))
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!draft || !accounts.data || !draft.asset) return
    const a = draft.asset
    setAsset(a); setFile(null); setDuration(a.duration_sec)
    setTitle((draft.title || a.title).slice(0, 200))
    setCaption(draft.caption ?? a.caption ?? '')
    add(accounts.data.filter(x => draft.accounts.some(k => k.key === key(x))))
    if (draft.scheduled_at) { setWhen('at'); setAt(toLocalInput(new Date(draft.scheduled_at))) }
  }, [draft, accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const [pendingAsset, setPendingAsset] = useState<Asset | null>(null)
  useEffect(() => { if (pendingAsset && accounts.data) { useAsset(pendingAsset); setPendingAsset(null) } }, [pendingAsset, accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const all = accounts.data || []
  const chosen = all.filter(a => picked.includes(key(a)))
  // Espace de la publication : celui des comptes choisis, sinon celui du brouillon / de la vidéo, sinon le mien.
  const fixed = params.get('org')
  const baseOrg = fixed ? (fixed === 'perso' ? null : Number(fixed)) : home
  const org = chosen.length ? chosen[0].org_id ?? null : baseOrg
  const sameOrg = (a: Account) => (a.org_id ?? null) === org
  const why = (a: Account): string | null => {
    if (!a.can_publish) return a.needs_reconnect ? t('Indisponible : à reconnecter') : t('Indisponible')
    if (a.role === 'viewer') return t('Lecture seule')
    if ((chosen.length || asset || draft) && !sameOrg(a)) return t('Autre propriétaire : publication à part')
    return null
  }
  const busy = progress != null

  const add = (list: Account[]) => {
    const first = picked.length ? all.find(a => key(a) === picked[0]) : null
    const where = first ? first.org_id ?? null : (asset || draft ? baseOrg : list.find(a => a.can_publish && a.role !== 'viewer')?.org_id ?? null)
    const fresh = list.filter(a => a.can_publish && a.role !== 'viewer' && (a.org_id ?? null) === where && !picked.includes(key(a)))
    if (!fresh.length) return
    setPicked(p => [...p, ...fresh.map(key)])
    setOpts(o => {
      const n = { ...o }
      for (const a of fresh) {
        if (n[key(a)]) continue
        const d = defaults(a)
        n[key(a)] = a.platform === 'youtube' ? { ...d, kids, synthetic: ai } : a.platform === 'tiktok' ? { ...d, aigc: ai } : d
      }
      return n
    })
    for (const a of fresh) {
      if (a.platform !== 'tiktok') continue
      const k = key(a)
      setCreators(c => ({ ...c, [k]: 'loading' }))
      creatorInfo(a.id).then(ci => setCreators(c => ({ ...c, [k]: ci })))
        .catch(e => setCreators(c => ({ ...c, [k]: { error: (e as Error).message } })))
    }
  }
  const toggle = (a: Account) => {
    const k = key(a)
    if (picked.includes(k)) setPicked(p => p.filter(x => x !== k))
    else add([a])
  }
  const groupAccounts = (gid: number) => {
    const g = groups.find(x => x.id === gid)
    return g ? all.filter(a => g.accounts.some(x => x.platform === a.platform && x.id === a.id)) : []
  }
  const groupFull = (gid: number) => { const l = groupAccounts(gid).filter(a => a.can_publish); return l.length > 0 && l.every(a => picked.includes(key(a))) }
  const toggleGroup = (gid: number) => {
    const l = groupAccounts(gid)
    if (groupFull(gid)) setPicked(p => p.filter(k => !l.some(a => key(a) === k)))
    else add(l)
  }
  // Filtre choisi sur l'accueil / le planning (un compte ou un groupe) : proposé d'office (une fois).
  const [preset, setPreset] = useState(false)
  useEffect(() => {
    if (preset || !accounts.data || (!currentGroup && !currentAccount)) return
    setPreset(true)
    add(currentAccount ? accounts.data.filter(a => key(a) === currentAccount) : groupAccounts(currentGroup!.id))
  }, [accounts.data, currentGroup, currentAccount]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = <T extends Opts>(k: string, patch: Partial<T>) => setOpts(o => ({ ...o, [k]: { ...(o[k] as T), ...patch } }))

  const onFile = (f: File | null) => {
    setFile(f); setDuration(null); setErr(''); setAsset(null); forgetCovers()
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : null)
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 100))
  }

  // Communs → réglages de chaque compte qui les connaît (YouTube : enfants, synthétique ; TikTok : IA).
  useEffect(() => {
    setOpts(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k,
      k.startsWith('youtube:') ? { ...v, kids, synthetic: ai } : k.startsWith('tiktok:') ? { ...v, aigc: ai } : v])))
  }, [kids, ai])
  // Vidéo choisie : la carte du titre et de la légende apparaît, la page descend jusqu'à elle.
  const hasVideo = !!file || !!asset
  useEffect(() => { if (hasVideo) setTimeout(() => textCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150) }, [hasVideo])

  // Problèmes bloquants : contenu (étape 1), comptes et heure (étape 2), puis réglages de chaque compte.
  const accProblems = (a: Account): string[] => {
    const k = key(a), o = opts[k], out: string[] = []
    if (!o) return out
    if (a.platform === 'tiktok') {
      const tk = o as TikTokOpts, ci = creators[k]
      if (ci === 'loading') out.push(t('options du compte en cours de lecture…'))
      else if (!ci || 'error' in ci) out.push(t('options du compte TikTok illisibles.'))
      else if (!ci.can_post) out.push(ci.message || t('publication impossible sur ce compte.'))
      else {
        const max = Math.min(ci.creator?.max_video_post_duration_sec || 600, 600)
        if (duration != null && duration > max) out.push(t('vidéo trop longue ({max} au plus sur ce compte).', { max: fmtDuration(max) }))
        if (tk.mode === 'direct' && !tk.privacy) out.push(t('choisissez qui peut voir la vidéo.'))
        if (tk.mode === 'direct' && tk.commercial && !tk.yourBrand && !tk.branded) out.push(t("indiquez si le contenu fait votre promotion, celle d'un tiers, ou les deux."))
      }
    } else if (a.platform === 'youtube') {
      const y = o as YouTubeOpts
      if (!y.kids) out.push(t('indiquez si la vidéo est conçue pour les enfants.'))
      if (duration != null && duration > (config?.youtube_max_duration_sec || 180)) out.push(t('vidéo trop longue pour un Short (3 min au plus).'))
    } else if (duration != null && (duration < 3 || duration > (config?.instagram_max_duration_sec || 900))) {
      out.push(t('un Reel dure de 3 s à 15 min.'))
    }
    return out
  }
  const contentProblems = useMemo(() => {
    const out: string[] = []
    if (!file && !asset) out.push(t('Choisissez une vidéo.'))
    if (!title.trim()) out.push(t('Donnez un titre à la publication.'))
    if (file && config && file.size > config.max_upload_bytes) out.push(t('Vidéo trop volumineuse ({max} au plus).', { max: fmtSize(config.max_upload_bytes) }))
    return out
  }, [file, asset, title, config])
  const soon = (d: string) => new Date(d).getTime() < Date.now() + 14 * 60000
  const targetProblems = useMemo(() => {
    const out: string[] = []
    if (!chosen.length) out.push(t('Choisissez au moins un compte.'))
    if (when === 'at' && sameTime && soon(at)) out.push(t('Choisissez une heure au moins 15 minutes plus tard.'))
    if (when === 'at' && !sameTime) for (const a of chosen) if (times[key(a)] && soon(times[key(a)])) out.push(t('{account} : choisissez une heure au moins 15 minutes plus tard.', { account: a.name }))
    if (chosen.some(a => a.platform === 'youtube') && !kids) out.push(t('Indiquez la limite d’âge à l’étape 1 (YouTube le demande).'))
    return out
  }, [chosen, when, at, sameTime, times, kids]) // eslint-disable-line react-hooks/exhaustive-deps
  const problems = [...contentProblems, ...targetProblems, ...chosen.flatMap(a => accProblems(a).map(p => t('{account} : {problem}', { account: a.name || PLATFORM_LABEL[a.platform], problem: p })))]
  // Réglages compte par compte seulement si un réseau en demande (TikTok direct : visibilité à choisir à la main).
  const needSettings = chosen.some(a => a.platform === 'tiktok' && (opts[key(a)] as TikTokOpts)?.mode === 'direct')
    || chosen.some(a => accProblems(a).length > 0)

  const buildTarget = (a: Account) => {
    const k = key(a), o = opts[k]
    const scheduled_at = when === 'now' ? null : new Date(sameTime ? at : (times[k] || at)).toISOString()
    if (a.platform === 'tiktok') {
      const t = o as TikTokOpts
      return { platform: a.platform, account_id: a.id, scheduled_at, options: {
        mode: t.mode, privacy_level: t.mode === 'direct' ? t.privacy : null, allow_comment: t.comment, allow_duet: t.duet,
        allow_stitch: t.stitch, brand_organic: t.commercial && t.yourBrand, brand_content: t.commercial && t.branded,
        ...(t.mode === 'direct' && t.coverMs != null ? { cover_timestamp_ms: t.coverMs } : {}),
        ...(t.mode === 'direct' && t.aigc ? { is_aigc: true } : {}),
        ...(t.text.trim() ? { title: t.text } : {}) } }
    }
    if (a.platform === 'youtube') {
      const y = o as YouTubeOpts
      return { platform: a.platform, account_id: a.id, scheduled_at, options: {
        ...(y.title.trim() ? { title: y.title.trim() } : {}), ...(y.description.trim() ? { description: y.description } : {}),
        tags: y.tags.split(',').map(s => s.trim()).filter(Boolean), privacy_status: y.privacy, made_for_kids: y.kids === 'yes',
        synthetic_media: y.synthetic, category_id: y.category, notify_subscribers: y.notify } }
    }
    const i = o as InstaOpts
    return { platform: a.platform, account_id: a.id, scheduled_at, options: { share_to_feed: i.feed,
      ...(i.coverMs != null && !cover ? { thumb_offset_ms: i.coverMs } : {}), ...(i.text.trim() ? { caption: i.text } : {}) } }
  }

  const publish = async () => {
    if ((!file && !asset) || problems.length) return
    if ((rights === 'protected' || rights === 'unknown') && chosen.length
        && !window.confirm(`${t(RIGHTS_WARNING)}\n\n${t('Publier quand même sur {platforms} ?', { platforms: [...new Set(chosen.map(a => PLATFORM_LABEL[a.platform]))].join(', ') })}`)) return
    setReview(false); setErr(''); setProgress(0)
    const rightsBody = rights ? { rights, rights_note: rightsNote.trim() || undefined } : {}
    try {
      if (asset) {
        const made = await createPost({ org_id: org, title: title.trim(), caption, asset_id: asset.id, ...rightsBody, targets: chosen.map(buildTarget) })
        if (cover) await putCover(made.post_id, cover)
        nav('/planning', { state: { flash: when === 'now' ? t('Publication lancée depuis la bibliothèque.') : t('Publication programmée : la vidéo sera récupérée dans le Drive à l’heure prévue.') } })
        return
      }
      if (!file) return
      const plan = await createPost({ org_id: org, title: title.trim(), caption, file_name: file.name, video_size: file.size, ...rightsBody,
        targets: chosen.map(buildTarget) })
      const parts = plan.part_count || 0, partSize = plan.part_size || file.size
      for (let i = 0; i < parts; i++) {
        await putPart(plan.post_id, i, file.slice(i * partSize, Math.min(file.size, (i + 1) * partSize)))
        setProgress((i + 1) / parts)
      }
      if (cover) await putCover(plan.post_id, cover)
      await submitPost(plan.post_id)
      nav('/planning', { state: { flash: when === 'now' ? t('Publication lancée.') : t('Publication programmée.') } })
    } catch (e) {
      setErr((e as Error).message)
      setProgress(null)
    }
  }

  const tiktokBranded = chosen.some(a => a.platform === 'tiktok' && (opts[key(a)] as TikTokOpts)?.mode === 'direct'
    && (opts[key(a)] as TikTokOpts)?.commercial && (opts[key(a)] as TikTokOpts)?.branded)
  const hasTikTok = chosen.some(a => a.platform === 'tiktok')
  const total = needSettings || step === 3 ? 3 : 2
  const timeOf = (a: Account) => new Date(sameTime ? at : (times[key(a)] || at))
  const media: Media = { src: preview || asset?.stream || (asset ? `/api/cm/assets/${asset.id}/stream` : null), duration }
  const common: Common = { title, caption }
  const panel = (a: Account) => {
    const k = key(a), o = opts[k]
    if (!o) return null
    if (a.platform === 'tiktok') return <TikTokPanel account={a} o={o as TikTokOpts} ci={creators[k]} busy={busy} set={p => set<TikTokOpts>(k, p)} media={media} common={common} />
    if (a.platform === 'youtube') return <YouTubePanel account={a} o={o as YouTubeOpts} busy={busy} set={p => set<YouTubeOpts>(k, p)} common={common} />
    return <InstaPanel account={a} o={o as InstaOpts} busy={busy} set={p => set<InstaOpts>(k, p)} media={media} common={common}
                       image={{ url: coverUrl, fromDrive: !!asset?.has_cover,
                                pick: f => { if (coverUrl) URL.revokeObjectURL(coverUrl); setCover(f); setCoverUrl(f ? URL.createObjectURL(f) : null) } }} />
  }
  const recap = (a: Account): [string, string][] => {
    const o = opts[key(a)]
    const ms = (v: number | null | undefined) => (v == null ? t('choisie par le réseau') : t('image à {time}', { time: fmtMs(v / 1000) }))
    const yes = (b: boolean) => (b ? t('oui') : t('non'))
    if (!o) return []
    if (a.platform === 'tiktok') {
      const tk = o as TikTokOpts
      if (tk.mode === 'draft') return [[t('Mode'), t('brouillon dans l’app TikTok')], [t('Légende'), t('à écrire dans l’app')]]
      return [[t('Légende'), (tk.text || caption || title).trim() || '—'], [t('Visibilité'), tk.privacy ? (TIKTOK_PRIVACY[tk.privacy] ? t(TIKTOK_PRIVACY[tk.privacy]) : tk.privacy) : t('à choisir')],
        [t('Autorisés'), [tk.comment && t('commentaires'), tk.duet && t('duos'), tk.stitch && t('collages')].filter(Boolean).join(', ') || t('rien')],
        [t('Miniature'), ms(tk.coverMs)], [t('Contenu IA'), yes(!!tk.aigc)],
        ...(tk.commercial ? [[t('Contenu commercial'), [tk.yourBrand && t('votre marque'), tk.branded && t('contenu de marque')].filter(Boolean).join(' + ') || t('à préciser')] as [string, string]] : [])]
    }
    if (a.platform === 'youtube') {
      const y = o as YouTubeOpts
      const yv = ({ public: 'Publique', unlisted: 'Non répertoriée', private: 'Privée' } as Record<string, string>)[y.privacy]
      const yc = YT_CATEGORIES.find(([v]) => v === y.category)?.[1]
      return [[t('Titre'), (y.title || title).trim() || '—'], [t('Description'), (y.description || caption).trim() || '—'],
        [t('Visibilité'), yv ? t(yv) : y.privacy],
        [t('Catégorie'), yc ? t(yc) : y.category],
        [t('Pour les enfants'), y.kids ? yes(y.kids === 'yes') : t('à indiquer')], [t('Contenu IA'), yes(y.synthetic)], [t('Miniature'), t('choisie par YouTube')]]
    }
    const i = o as InstaOpts
    return [[t('Légende'), (i.text || caption).trim() || '—'], [t('Fil'), i.feed ? t('Reel + fil') : t('Reel seulement')],
      [t('Couverture'), cover ? t('image envoyée à part') : ms(i.coverMs)]]
  }
  const canPlan = canEdit && !busy && !contentProblems.length && !targetProblems.length
  const planBtn = (
    <button type="button" className="btn btn-primary btn-lg" disabled={!canPlan} onClick={() => setReview(true)}>
      <Icon name={when === 'now' ? 'bolt' : 'clock'} />{when === 'now' ? t('Publier') : t('Planifier')}
    </button>
  )
  const blocking = step === 1 ? contentProblems : step === 2 ? targetProblems : problems

  return (
    <div className="compose-flow col" style={{ gap: 16 }}>
      <div className="steps" aria-label={t('Étape {step} sur {total} : {label}', { step, total, label: t(STEP_LABELS[step - 1]) })}>
        <div className="row between small"><span className="strong">{t(STEP_LABELS[step - 1])}</span><span className="muted">{t('Étape {step} sur {total}', { step, total })}</span></div>
        <div className="steps-bar" aria-hidden="true">{Array.from({ length: total }, (_, n) => <span key={n} className={n < step ? 'on' : ''} />)}</div>
      </div>
      {!canEdit && <Msg kind="err">{t('Vous êtes en « Lecture seule » sur ces comptes : demandez « Peut publier » à leur propriétaire.')}</Msg>}
      {accounts.loading && !accounts.data && <Loading />}
      {accounts.data && all.length === 0 && (
        <Msg>{t('Aucun compte connecté.')} <Link to="/comptes">{t('Connectez TikTok, YouTube ou Instagram')}</Link> {t('pour publier.')}</Msg>
      )}

      {step === 1 && (
        <>
          <section className="card col" style={{ gap: 12 }} aria-label={t('Vidéo')}>
            {asset && (
              <div className="row-nw" style={{ gap: 12, alignItems: 'flex-start' }}>
                {asset.thumbnail ? <img src={asset.thumbnail} alt="" width={72} height={104} style={{ width: 72, height: 104, objectFit: 'cover', borderRadius: 10, flex: 'none', background: 'var(--surface-2)' }} />
                  : <span style={{ width: 72, height: 104, borderRadius: 10, background: 'var(--surface-2)', flex: 'none' }} />}
                <div className="col small grow" style={{ gap: 4, minWidth: 0 }}>
                  <span className="strong ellipsis">{asset.name}</span>
                  <span className="muted">{fmtDuration(asset.duration_sec)}{asset.size ? ` · ${fmtSize(asset.size)}` : ''}</span>
                  <span className="muted row-nw" style={{ gap: 6 }}><Icon name="layers" size={14} /><span className="ellipsis">{asset.source_name}{asset.folder ? ` / ${asset.folder}` : ''}</span></span>
                </div>
              </div>
            )}
            {file && <span className="small"><span className="strong">{file.name}</span> <span className="muted">· {fmtSize(file.size)} · {fmtDuration(duration)}</span></span>}
            {preview && (
              <video src={preview} controls muted playsInline preload="metadata" onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
                     style={{ width: '100%', maxHeight: 420, borderRadius: 12, background: '#000' }} />
            )}
            <div className="row-nw" style={{ gap: 8 }}>
              {robot.data?.enabled && (
                <button type="button" className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => setPicking(true)}><Icon name="layers" />{t('Bibliothèque')}</button>
              )}
              <label className="btn" style={{ flex: 1 }}>
                <Icon name="upload" />{file ? t('Autre fichier') : t('Fichier')}
                <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={busy} className="sr-only"
                       onChange={e => onFile(e.target.files?.[0] || null)} />
              </label>
            </div>
            {!hasVideo && <span className="tiny muted" style={{ textAlign: 'center' }}>{t('MP4 ou MOV, vertical, {max} au plus', { max: config ? fmtSize(config.max_upload_bytes) : t('1 Go') })}</span>}
          </section>

          {hasVideo && (
            <section className="card col" style={{ gap: 14, scrollMarginTop: 80 }} ref={textCard} aria-label={t('Titre et légende')}>
              <label className="field">
                <span className="row-nw" style={{ gap: 6 }}>{t('Titre')}
                  <button type="button" className="icon-btn btn-ghost" style={{ minHeight: 0, padding: 2 }} aria-label={t('À quoi sert le titre')}
                          onClick={() => window.alert(t('Le titre est le nom de la publication dans votre planning. Il est aussi proposé aux réseaux qui acceptent un titre (modifiable pour chacun dans les réglages).'))}>
                    <Icon name="info" size={16} />
                  </button>
                </span>
                <input className="input" value={title} maxLength={200} disabled={busy} onChange={e => setTitle(e.target.value)} placeholder={t('Ex. : Tuto coiffure en 30 secondes')} />
              </label>
              <label className="field">
                <span className="row between">{t('Légende')}
                  {caption.length > 120 && <button type="button" className="linkbtn small" onClick={() => setCaptionOpen(o => !o)} aria-expanded={captionOpen}>{captionOpen ? t('Réduire') : t('Tout afficher')}</button>}
                </span>
                <textarea className="textarea" value={caption} disabled={busy} onChange={e => setCaption(e.target.value)} maxLength={2200}
                          rows={captionOpen ? Math.min(30, caption.split('\n').length + Math.ceil(caption.length / 60)) : 4}
                          placeholder={t('Le texte sous la vidéo, avec vos #hashtags')} />
                <span className="field-hint">{t('{count} / 2 200 · {n} hashtag(s)', { count: caption.length.toLocaleString(LOCALE), n: (caption.match(/#/g) || []).length })}</span>
              </label>
            </section>
          )}

          {hasVideo && (
            <section className="card col" style={{ gap: 14 }} aria-label={t('Public, droits et IA')}>
              <div className="col" style={{ gap: 6 }}>
                <span className="small strong">{t('Limite d’âge')}</span>
                <Seg<'' | 'yes' | 'no'> label={t('Vidéo conçue pour les enfants')} value={kids} onChange={v => !busy && setKids(v)}
                     options={[['no', t('Tout public')], ['yes', t('Pour les enfants')]]} />
                <span className="field-hint">{t('« Pour les enfants » : conçue avant tout pour les moins de 13 ans (YouTube le demande à chaque vidéo).')}</span>
              </div>
              <div className="col" role="group" aria-labelledby="t-droits" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <span id="t-droits" className="small strong">{t('Droits d’auteur')}</span>
                <span className="field-hint">{t('La vidéo reprend-elle une œuvre (musique, chorégraphie, extrait) ?')}</span>
                <div className="seg" role="radiogroup" aria-label={t('Droits d’auteur')}>
                  {(['public_domain', 'protected', 'unknown'] as Rights[]).map(r => (
                    <button key={r} type="button" role="radio" aria-checked={rights === r} aria-pressed={rights === r} disabled={busy}
                            onClick={() => setRights(rights === r ? '' : r)}>{t(RIGHTS_LABEL[r])}</button>
                  ))}
                </div>
                {(rights === 'protected' || rights === 'unknown') && <div role="alert" className="msg msg-warn">{t(RIGHTS_WARNING)}</div>}
                {rights && <input className="input" value={rightsNote} maxLength={300} disabled={busy} onChange={e => setRightsNote(e.target.value)}
                                  placeholder={t('Note (ex. reprise — Wicked, Stephen Schwartz)')} aria-label={t('Note sur les droits')} />}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <Check label={t('Contenu généré ou modifié par IA')} checked={ai} disabled={busy} onChange={setAi}
                       hint={t('Une personne, un lieu ou un événement réaliste créé ou modifié (IA comprise). Signalé à YouTube et TikTok.')} />
              </div>
            </section>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <Section title={t('Comptes')} aside={chosen.length ? (chosen.length > 1 ? t('{n} comptes', { n: chosen.length }) : t('{n} compte', { n: chosen.length })) : undefined}>
            {chosen.length > 0 && (
              <ul className="chosen" aria-label={t('Comptes choisis')}>
                {chosen.map(a => (
                  <li key={key(a)} className="fchip fchip-acc">
                    <span className="fchip-av"><Avatar src={a.avatar_url} name={a.name} size="sm" /><PlatformLogo platform={a.platform} size={12} /></span>
                    <span className="ellipsis" style={{ maxWidth: 160 }}>{a.name}</span>
                    <button type="button" className="chosen-x" aria-label={t('Retirer {name}', { name: a.name })} disabled={busy} onClick={() => toggle(a)}><Icon name="close" size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
            <AccountPicker mode="multi" accounts={all} groups={groups} picked={picked}
                           onChange={keys => {
                             if (busy) return
                             const added = all.filter(a => keys.includes(key(a)) && !picked.includes(key(a)))
                             setPicked(p => p.filter(k => keys.includes(k)))
                             add(added)
                           }}
                           disabled={why} ownerOf={ownerOf}
                           detail={a => `${PLATFORM_LABEL[a.platform]}${a.platform === 'youtube' ? ' · Short' : a.platform === 'instagram' ? ` · Reel${a.mode === 'routine' ? ' · routine' : ''}` : ''}`} />
          </Section>
          <Section title={t('Quand')}>
            <Seg<'at' | 'now'> label={t('Quand')} value={when} onChange={v => !busy && setWhen(v)} options={[['at', t('Planifier')], ['now', t('Tout de suite')]]} />
            {when === 'at' ? (
              <div className="col" style={{ gap: 12 }}>
                {sameTime && <DateParts value={new Date(at)} onChange={d => setAt(toLocalInput(d))} disabled={busy} />}
                {chosen.length > 1 && <Check label={t('Même jour et heure pour tous les comptes')} checked={sameTime} onChange={setSameTime} disabled={busy} />}
                {!sameTime && chosen.map(a => (
                  <DateParts key={key(a)} label={`${a.name} (${PLATFORM_LABEL[a.platform]})`} value={new Date(times[key(a)] || at)} disabled={busy}
                             onChange={d => setTimes(t => ({ ...t, [key(a)]: toLocalInput(d) }))} />
                ))}
              </div>
            ) : <span className="small muted">{t('La publication part dès que la vidéo est envoyée.')}</span>}
          </Section>
        </>
      )}

      {step === 3 && (
        <AccountPager accounts={chosen} render={panel} problems={a => accProblems(a).length} disabled={busy}
                      onRemove={a => { toggle(a); if (chosen.length <= 1) go(2) }} />
      )}

      {step > 1 && hasTikTok && (
        <p className="tiny muted" style={{ margin: 0 }}>
          {tiktokBranded
            ? <>{t('En publiant, vous acceptez la')} <a href={TIKTOK_BC_URL} target="_blank" rel="noreferrer">Branded Content Policy</a>{t(' et la ')}<a href={TIKTOK_MUSIC_URL} target="_blank" rel="noreferrer">Music Usage Confirmation</a>{t(' de TikTok.')}</>
            : <>{t('En publiant, vous acceptez la')} <a href={TIKTOK_MUSIC_URL} target="_blank" rel="noreferrer">Music Usage Confirmation</a>{t(' de TikTok.')}</>}
          {' '}{t('Le traitement peut prendre quelques minutes avant que la vidéo soit visible.')}
        </p>
      )}
      {err && <Msg kind="err">{err}</Msg>}

      <div className="actionbar">
        <div className="col" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          <span className="small muted ellipsis">{busy ? t('Envoi de la vidéo… {pct} %', { pct: Math.round((progress || 0) * 100) }) : blocking[0] || (step === 2 && !needSettings && chosen.length
            ? <button type="button" className="linkbtn" onClick={() => go(3)}>{t('Régler chaque compte (facultatif)')}</button> : '')}</span>
          {busy && <div className="progress"><span style={{ width: `${Math.round((progress || 0) * 100)}%` }} /></div>}
        </div>
        <div className="row-nw" style={{ gap: 8 }}>
          {step > 1 ? <button type="button" className="btn" disabled={busy} onClick={() => go((step - 1) as 1 | 2)}><Icon name="left" />{t('Retour')}</button>
            : <Link className="btn" to="/planning">{t('Annuler')}</Link>}
          {step === 1 && <button type="button" className="btn btn-primary btn-lg" disabled={contentProblems.length > 0} onClick={() => go(2)}>{t('Suivant')}<Icon name="right" /></button>}
          {step === 2 && (needSettings
            ? <button type="button" className="btn btn-primary btn-lg" disabled={targetProblems.length > 0} onClick={() => go(3)}>{t('Suivant · réglages')}<Icon name="right" /></button>
            : planBtn)}
          {step === 3 && planBtn}
        </div>
      </div>

      {review && (
        <ReviewSheet onClose={() => setReview(false)} accounts={chosen} busy={busy} finalLabel={when === 'now' ? t('Valider et publier') : t('Valider et planifier')}
                     when={a => (when === 'now' ? null : timeOf(a))} recap={recap} problems={accProblems} renderEdit={panel}
                     onRemove={a => toggle(a)} onDone={publish} />
      )}
      {picking && (
        <Sheet title={t('Choisir dans la bibliothèque')} onClose={() => setPicking(false)}>
          <div className="col" style={{ gap: 12 }}>
            <input className="input" type="search" placeholder={t('Rechercher (nom, légende, dossier)')} aria-label={t('Rechercher une vidéo')}
                   value={pickQ} onChange={e => setPickQ(e.target.value)} />
            <AssetGrid state="all" q={pickQ.trim()} onOpen={useAsset} />
            <Link className="small" to="/bibliotheque">{t('Gérer les dossiers Drive')}</Link>
          </div>
        </Sheet>
      )}
    </div>
  )
}

type Media = { src: string | null; duration: number | null }
type Common = { title: string; caption: string }

/** Texte propre à un réseau, déjà rempli avec le texte commun (modifié ici : seulement pour ce réseau). */
function OwnText({ label, value, common, onChange, busy, max }: { label: string; value: string; common: string; onChange: (v: string) => void; busy: boolean; max: number }) {
  const shown = value || common
  const own = !!value && value !== common
  return (
    <label className="field">{label}
      <textarea className="textarea" value={shown} maxLength={max} disabled={busy} onChange={e => onChange(e.target.value === common ? '' : e.target.value)}
                placeholder={t('Le texte sous la vidéo')} />
      <span className="field-hint">{shown.length.toLocaleString(locale())} / {max.toLocaleString(locale())} · {own ? <>{t('propre à ce réseau')} · <button type="button" className="linkbtn" onClick={() => onChange('')} disabled={busy}>{t('reprendre le texte commun')}</button></> : t('le texte commun')}</span>
    </label>
  )
}

/** Miniature d'un réseau : une image de la vidéo (Instagram : ou une image envoyée à part). */
function Thumb({ media, value, onChange, busy, note, children }: { media?: Media; value: number | null | undefined; onChange: (ms: number | null) => void; busy: boolean; note: ReactNode; children?: ReactNode }) {
  return (
    <div className="col" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <strong className="small">{t('Miniature')}</strong>
      <span className="field-hint">{note}</span>
      {media && <FramePicker src={media.src} duration={media.duration} value={value ?? null} onChange={onChange} disabled={busy} />}
      {children}
    </div>
  )
}

function TikTokPanel({ account, o, ci, busy, set, media, common }: { account: Account; o: TikTokOpts; ci: CreatorInfo | 'loading' | { error: string } | undefined; busy: boolean; set: (p: Partial<TikTokOpts>) => void; media: Media; common: Common }) {
  if (!ci || ci === 'loading') return <Section title={`TikTok · ${account.name}`}><Loading label={t('Lecture des options du compte TikTok…')} /></Section>
  if ('error' in ci) return <Section title={`TikTok · ${account.name}`}><Msg kind="err">{ci.error}</Msg></Section>
  if (!ci.can_post || !ci.creator) return <Section title={`TikTok · ${account.name}`}><Msg kind="err">{ci.message}</Msg></Section>
  const c = ci.creator
  const direct = o.mode === 'direct'
  const brandedOn = direct && o.commercial && o.branded
  return (
    <Section title="TikTok" aside={<span className="row" style={{ gap: 8 }}><Avatar src={c.avatar_url} name={c.nickname} />{t('Publié sur {name}', { name: c.nickname || c.username })}</span>}>
      {account.can_draft && account.can_direct && (
        <fieldset className="row" style={{ gap: 16 }}>
          <legend>{t('Mode')}</legend>
          <label className="check"><input type="radio" checked={direct} onChange={() => set({ mode: 'direct' })} disabled={busy} />{t('Publication directe')}</label>
          <label className="check"><input type="radio" checked={!direct} onChange={() => set({ mode: 'draft' })} disabled={busy} />{t("Brouillon dans l'app TikTok")}</label>
        </fieldset>
      )}
      {direct ? (
        <>
          <OwnText label={t('Légende TikTok')} value={o.text} common={common.caption || common.title} onChange={v => set({ text: v })} busy={busy} max={2200} />
          <label className="field">{t('Qui peut voir cette vidéo')}
            <select className="select" value={o.privacy} disabled={busy} onChange={e => set({ privacy: e.target.value })}>
              <option value="" disabled>{t('Choisir…')}</option>
              {c.privacy_level_options.map(p => (
                <option key={p} value={p} disabled={p === 'SELF_ONLY' && brandedOn}>{TIKTOK_PRIVACY[p] ? t(TIKTOK_PRIVACY[p]) : p}</option>
              ))}
            </select>
            {brandedOn && <span className="field-hint">{t("La visibilité d'un contenu de marque ne peut pas être privée.")}</span>}
          </label>
          <fieldset className="row" style={{ gap: 4, columnGap: 20 }}>
            <legend>{t('Autoriser')}</legend>
            {([['Commentaires', 'comment', c.comment_disabled], ['Duos', 'duet', c.duet_disabled], ['Collages', 'stitch', c.stitch_disabled]] as const).map(([l, f, off]) => (
              <Check key={f} label={t(l)} checked={!off && o[f]} disabled={off || busy} onChange={v => set({ [f]: v } as Partial<TikTokOpts>)} />
            ))}
          </fieldset>
          {(c.comment_disabled || c.duet_disabled || c.stitch_disabled) && <span className="field-hint">{t('Les options grisées sont désactivées dans les paramètres de votre compte TikTok.')}</span>}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }} className="col">
            <Check label={<strong>{t('Divulgation de contenu commercial')}</strong>} checked={o.commercial} disabled={busy}
                   hint={t("Activez si cette vidéo fait la promotion de vous-même, d'une marque, d'un produit ou d'un service.")}
                   onChange={v => set(v ? { commercial: true } : { commercial: false, yourBrand: false, branded: false })} />
            {o.commercial && (
              <div className="col" style={{ paddingLeft: 26, gap: 6 }}>
                <Check label={t('Votre marque')} hint={t('Vous faites la promotion de vous-même ou de votre propre activité.')} checked={o.yourBrand} disabled={busy} onChange={v => set({ yourBrand: v })} />
                <Check label={t('Contenu de marque')} hint={t("Vous faites la promotion d'une autre marque ou d'un tiers.")} checked={o.branded} disabled={busy}
                       onChange={v => set({ branded: v, ...(v && o.privacy === 'SELF_ONLY' ? { privacy: '' } : {}) })} />
                {o.branded ? <Msg>{t('Votre vidéo sera étiquetée « Partenariat rémunéré ».')}</Msg>
                  : o.yourBrand ? <Msg>{t('Votre vidéo sera étiquetée « Contenu promotionnel ».')}</Msg>
                  : <span className="field-hint">{t("Vous devez indiquer si votre contenu fait la promotion de vous-même, d'un tiers, ou des deux.")}</span>}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>{t("La vidéo arrivera dans la boîte de réception TikTok du compte : vous terminerez la légende et la publication dans l'app.")}</p>
      )}
      {direct && <Check label={t('Contenu généré par IA')} hint={t('TikTok affiche l’étiquette « Généré par IA ».')} checked={!!o.aigc} disabled={busy} onChange={v => set({ aigc: v })} />}
      {direct && <Thumb media={media} value={o.coverMs} onChange={v => set({ coverMs: v })} busy={busy}
                        note={t('TikTok prend une image de la vidéo : choisissez-la ici (sinon TikTok choisit).')} />}
    </Section>
  )
}

function YouTubePanel({ account, o, busy, set, common }: { account: Account; o: YouTubeOpts; busy: boolean; set: (p: Partial<YouTubeOpts>) => void; common: Common }) {
  return (
    <Section title="YouTube" aside={t('Short sur {name}', { name: account.name })}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <label className="field grow" style={{ flex: '1 1 220px' }}>{t('Titre YouTube')}
          <input className="input" value={o.title || common.title.slice(0, 100)} maxLength={100} disabled={busy} onChange={e => set({ title: e.target.value === common.title ? '' : e.target.value })} placeholder={t('Le titre de la vidéo')} />
        </label>
        <label className="field" style={{ flex: '1 1 160px' }}>{t('Visibilité')}
          <select className="select" value={o.privacy} disabled={busy} onChange={e => set({ privacy: e.target.value })}>
            <option value="public">{t('Publique')}</option><option value="unlisted">{t('Non répertoriée')}</option><option value="private">{t('Privée')}</option>
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 160px' }}>{t('Catégorie')}
          <select className="select" value={o.category} disabled={busy} onChange={e => set({ category: e.target.value })}>
            {YT_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
          </select>
        </label>
      </div>
      <OwnText label={t('Description YouTube')} value={o.description} common={common.caption} onChange={v => set({ description: v })} busy={busy} max={5000} />
      <label className="field">{t('Mots-clés')}<input className="input" value={o.tags} disabled={busy} onChange={e => set({ tags: e.target.value })} placeholder={t('piano, debussy, partition')} />
        <span className="field-hint">{t('Séparés par des virgules.')}</span></label>
      <fieldset className="row" style={{ gap: 20 }}>
        <legend>{t('Conçue pour les enfants ? (obligatoire)')}</legend>
        <label className="check"><input type="radio" checked={o.kids === 'yes'} onChange={() => set({ kids: 'yes' })} disabled={busy} />{t('Oui')}</label>
        <label className="check"><input type="radio" checked={o.kids === 'no'} onChange={() => set({ kids: 'no' })} disabled={busy} />{t('Non')}</label>
      </fieldset>
      <Check label={t('Contenu modifié ou synthétique réaliste')} hint={t('Une personne, un lieu ou un événement réaliste créé ou modifié (IA comprise).')} checked={o.synthetic} disabled={busy} onChange={v => set({ synthetic: v })} />
      <Check label={t('Prévenir les abonnés')} checked={o.notify} disabled={busy} onChange={v => set({ notify: v })} />
      <Thumb busy={busy} value={null} onChange={() => {}} note={t('YouTube choisit lui-même l’image des Shorts : l’API ne permet pas de la choisir.')} />
    </Section>
  )
}

function InstaPanel({ account, o, busy, set, media, common, image }: { account: Account; o: InstaOpts; busy: boolean; set: (p: Partial<InstaOpts>) => void
  media: Media; common: Common; image: { url: string | null; fromDrive: boolean; pick: (f: File | null) => void } }) {
  return (
    <Section title="Instagram" aside={account.mode === 'routine' ? t('Reel publié par la routine sur {name}', { name: account.name }) : t('Reel sur {name}', { name: account.name })}>
      <OwnText label={t('Légende Instagram')} value={o.text} common={common.caption} onChange={v => set({ text: v })} busy={busy} max={2200} />
      <Check label={t('Afficher aussi le Reel dans le fil')} checked={o.feed} disabled={busy} onChange={v => set({ feed: v })} />
      <Thumb media={image.url ? undefined : media} value={o.coverMs} onChange={v => set({ coverMs: v })} busy={busy}
             note={image.url ? t('Image envoyée à part : c’est elle qui sert de couverture.')
               : <>{t('Une image de la vidéo, ou une autre image ci-dessous.')}{image.fromDrive ? <> {t('Image trouvée à côté de la vidéo dans le Drive : utilisée si vous ne choisissez rien.')}</> : null}</>}>
        <div className="row-nw" style={{ gap: 12, alignItems: 'center' }}>
          {image.url ? <img src={image.url} alt={t('Image de couverture choisie')} style={{ width: 54, height: 96, objectFit: 'cover', borderRadius: 8, flex: 'none' }} />
            : <span aria-hidden="true" style={{ width: 54, height: 96, borderRadius: 8, background: 'var(--surface-2)', flex: 'none' }} />}
          <div className="col grow" style={{ gap: 6 }}>
            <label className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
              {image.url ? t('Changer l’image') : t('Choisir une autre image')}
              <input type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy} onChange={e => image.pick(e.target.files?.[0] || null)} />
            </label>
            {image.url && <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => image.pick(null)}>{t('Retirer')}</button>}
            <span className="field-hint">{t('JPEG ou PNG, 8 Mo au plus. Même image pour tous les comptes Instagram de la publication.')}</span>
          </div>
        </div>
      </Thumb>
    </Section>
  )
}
