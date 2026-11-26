// Nouvelle publication : une vidéo, un ou plusieurs comptes, maintenant ou à une heure précise.
// TikTok (Content Sharing Guidelines) : options du créateur relues à chaque choix du compte,
// pseudo affiché, confidentialité SANS valeur présélectionnée, interactions décochées et grisées
// si coupées chez le créateur, divulgation commerciale, Music Usage Confirmation avant l'envoi.
// Rien n'est envoyé à une plateforme avant l'heure choisie.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PlatformLogo } from '../components/PlatformLogo'
import { AccountPicker } from '../components/AccountPicker'
import { FramePicker } from '../components/FramePicker'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ALL, creatorInfo, createPost, getAccounts, getAsset, getProposal, getRobot, putCover, putPart, submitPost, PLATFORM_LABEL,
  RIGHTS_LABEL, RIGHTS_WARNING, type Account, type Asset, type CreatorInfo, type Platform, type Rights,
  type Proposal,
} from '../api'
import { Avatar, GroupDot, Icon, Loading, Msg, Sheet } from '../components/ui'
import { AssetGrid } from './Library'
import { fmtDuration, fmtSize, TIKTOK_BC_URL, TIKTOK_MUSIC_URL, TIKTOK_PRIVACY, toLocalInput } from '../format'
import { useLoad, useRole, useSession } from '../session'
import { useDesktop } from '../hooks'

interface TikTokOpts { mode: 'direct' | 'draft'; privacy: string; comment: boolean; duet: boolean; stitch: boolean
  commercial: boolean; yourBrand: boolean; branded: boolean; text: string }
interface YouTubeOpts { title: string; description: string; privacy: string; kids: '' | 'yes' | 'no'; synthetic: boolean
  category: string; notify: boolean; tags: string }
interface InstaOpts { text: string; feed: boolean }
type Opts = TikTokOpts | YouTubeOpts | InstaOpts

const key = (a: Account) => `${a.platform}:${a.id}`
const YT_CATEGORIES: [string, string][] = [['10', 'Musique'], ['22', 'Personnes et blogs'], ['24', 'Divertissement'], ['27', 'Éducation'], ['26', 'Vie pratique et style']]

function defaults(a: Account): Opts {
  if (a.platform === 'tiktok') return { mode: a.can_direct === false ? 'draft' : 'direct', privacy: '', comment: false, duet: false, stitch: false, commercial: false, yourBrand: false, branded: false, text: '' }
  if (a.platform === 'youtube') return { title: '', description: '', privacy: 'public', kids: '', synthetic: false, category: '10', notify: true, tags: '' }
  return { text: '', feed: true }
}

const STEP_LABELS = ['Vidéo et texte', 'Comptes et heure', 'Réglages par réseau']
const STEP_INTRO = [
  'Vidéo, titre et légende : écrits une fois, ils partent sur tous les comptes.',
  'Choisissez les comptes et l’heure.',
  'Dernière étape : vérifiez les réglages de chaque réseau, puis programmez.',
]

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
  const [creators, setCreators] = useState<Record<string, CreatorInfo | 'loading' | { error: string }>>({})
  const [when, setWhen] = useState<'now' | 'at'>('at')
  const [at, setAt] = useState(() => { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); return toLocalInput(d) })
  const [sameTime, setSameTime] = useState(true)
  const [times, setTimes] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState<number | null>(null)
  const [cover, setCover] = useState<File | null>(null)          // image Instagram à part (facultative)
  const [coverMs, setCoverMs] = useState<number | null>(null)     // miniature : instant de la vidéo (TikTok, et Instagram sans image)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  useEffect(() => () => { if (coverUrl) URL.revokeObjectURL(coverUrl) }, [coverUrl])
  const [err, setErr] = useState('')
  // Vidéo de la bibliothèque (dossier Drive) : rien à envoyer, téléchargée à l'heure de publication.
  const [params] = useSearchParams()
  const [asset, setAsset] = useState<Asset | null>(null)
  const [picking, setPicking] = useState(false)
  // Téléphone : en 3 étapes comme l'app (contenu → comptes et heure → réglages par réseau). Ordinateur : tout sur une vue.
  const desktop = useDesktop()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const show = (n: 1 | 2 | 3) => desktop || step === n
  const go = (n: 1 | 2 | 3) => { setStep(n); window.scrollTo(0, 0) }
  const [pickQ, setPickQ] = useState('')
  const robot = useLoad(() => getRobot(), [])
  const useAsset = (a: Asset) => {
    setAsset(a); setPicking(false); setErr('')
    setFile(null); if (preview) URL.revokeObjectURL(preview); setPreview(null)
    setDuration(a.duration_sec); setCoverMs(null)
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
    if (!a.can_publish) return `Indisponible${a.needs_reconnect ? ' : à reconnecter' : ''}`
    if (a.role === 'viewer') return 'Lecture seule'
    if ((chosen.length || asset || draft) && !sameOrg(a)) return 'Autre propriétaire : publication à part'
    return null
  }
  const busy = progress != null

  const add = (list: Account[]) => {
    const first = picked.length ? all.find(a => key(a) === picked[0]) : null
    const where = first ? first.org_id ?? null : (asset || draft ? baseOrg : list.find(a => a.can_publish && a.role !== 'viewer')?.org_id ?? null)
    const fresh = list.filter(a => a.can_publish && a.role !== 'viewer' && (a.org_id ?? null) === where && !picked.includes(key(a)))
    if (!fresh.length) return
    setPicked(p => [...p, ...fresh.map(key)])
    setOpts(o => { const n = { ...o }; for (const a of fresh) if (!n[key(a)]) n[key(a)] = defaults(a); return n })
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
    setFile(f); setDuration(null); setErr(''); setAsset(null); setCoverMs(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : null)
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 100))
  }

  // Problèmes bloquants, par compte et en général.
  const problems = useMemo(() => {
    const out: string[] = []
    if (!file && !asset) out.push('Choisissez une vidéo.')
    if (!title.trim()) out.push('Donnez un titre à la publication.')
    if (!chosen.length) out.push('Choisissez au moins un compte.')
    if (file && config && file.size > config.max_upload_bytes) out.push(`Vidéo trop volumineuse (${fmtSize(config.max_upload_bytes)} au plus).`)
    if (when === 'at' && sameTime && new Date(at).getTime() < Date.now() - 60000) out.push("L'heure choisie est déjà passée.")
    for (const a of chosen) {
      const k = key(a), o = opts[k], n = a.name || PLATFORM_LABEL[a.platform]
      if (!o) continue
      if (a.platform === 'tiktok') {
        const t = o as TikTokOpts, ci = creators[k]
        if (ci === 'loading') out.push(`${n} : options du compte en cours de lecture…`)
        else if (!ci || 'error' in ci) out.push(`${n} : options du compte TikTok illisibles.`)
        else if (!ci.can_post) out.push(`${n} : ${ci.message}`)
        else {
          const max = Math.min(ci.creator?.max_video_post_duration_sec || 600, 600)
          if (duration != null && duration > max) out.push(`${n} : vidéo trop longue (${fmtDuration(max)} au plus sur ce compte).`)
          if (t.mode === 'direct' && !t.privacy) out.push(`${n} : choisissez qui peut voir la vidéo.`)
          if (t.mode === 'direct' && t.commercial && !t.yourBrand && !t.branded) out.push(`${n} : indiquez si le contenu fait votre promotion, celle d'un tiers, ou les deux.`)
        }
      } else if (a.platform === 'youtube') {
        const y = o as YouTubeOpts
        if (!y.kids) out.push(`${n} : indiquez si la vidéo est conçue pour les enfants.`)
        if (duration != null && duration > (config?.youtube_max_duration_sec || 180)) out.push(`${n} : vidéo trop longue pour un Short (3 min au plus).`)
      } else if (duration != null && (duration < 3 || duration > (config?.instagram_max_duration_sec || 900))) {
        out.push(`${n} : un Reel dure de 3 s à 15 min.`)
      }
      if (when === 'at' && !sameTime && times[k] && new Date(times[k]).getTime() < Date.now() - 60000) out.push(`${n} : l'heure choisie est déjà passée.`)
    }
    return out
  }, [file, asset, title, chosen, opts, creators, duration, when, at, sameTime, times, config]) // eslint-disable-line react-hooks/exhaustive-deps

  const buildTarget = (a: Account) => {
    const k = key(a), o = opts[k]
    const scheduled_at = when === 'now' ? null : new Date(sameTime ? at : (times[k] || at)).toISOString()
    if (a.platform === 'tiktok') {
      const t = o as TikTokOpts
      return { platform: a.platform, account_id: a.id, scheduled_at, options: {
        mode: t.mode, privacy_level: t.mode === 'direct' ? t.privacy : null, allow_comment: t.comment, allow_duet: t.duet,
        allow_stitch: t.stitch, brand_organic: t.commercial && t.yourBrand, brand_content: t.commercial && t.branded,
        ...(t.mode === 'direct' && coverMs != null ? { cover_timestamp_ms: coverMs } : {}),
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
      ...(coverMs != null && !cover ? { thumb_offset_ms: coverMs } : {}), ...(i.text.trim() ? { caption: i.text } : {}) } }
  }

  const publish = async () => {
    if ((!file && !asset) || problems.length) return
    if ((rights === 'protected' || rights === 'unknown') && chosen.length
        && !window.confirm(`${RIGHTS_WARNING}\n\nPublier quand même sur ${[...new Set(chosen.map(a => PLATFORM_LABEL[a.platform]))].join(', ')} ?`)) return
    setErr(''); setProgress(0)
    const rightsBody = rights ? { rights, rights_note: rightsNote.trim() || undefined } : {}
    try {
      if (asset) {
        const made = await createPost({ org_id: org, title: title.trim(), caption, asset_id: asset.id, ...rightsBody, targets: chosen.map(buildTarget) })
        if (cover) await putCover(made.post_id, cover)
        nav('/planning', { state: { flash: when === 'now' ? 'Publication lancée depuis la bibliothèque.' : 'Publication programmée : la vidéo sera récupérée dans le Drive à l’heure prévue.' } })
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
      nav('/planning', { state: { flash: when === 'now' ? 'Publication lancée.' : 'Publication programmée.' } })
    } catch (e) {
      setErr((e as Error).message)
      setProgress(null)
    }
  }

  const tiktokBranded = chosen.some(a => a.platform === 'tiktok' && (opts[key(a)] as TikTokOpts)?.mode === 'direct'
    && (opts[key(a)] as TikTokOpts)?.commercial && (opts[key(a)] as TikTokOpts)?.branded)
  const hasTikTok = chosen.some(a => a.platform === 'tiktok')
  const summary = chosen.length
    ? `${chosen.length} compte${chosen.length > 1 ? 's' : ''} · ${when === 'now' ? 'dès l’envoi de la vidéo' : sameTime ? new Date(at).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'heures par compte'}`
    : 'Aucun compte choisi'

  return (
    <>
      <div className="page-head only-desktop">
        <div>
          <h1>Nouvelle publication</h1>
          <p>Une vidéo, un ou plusieurs comptes, maintenant ou à l’heure choisie.</p>
        </div>
      </div>
      {!canEdit && <Msg kind="err">Vous êtes en « Lecture seule » sur ces comptes : demandez « Peut publier » à leur propriétaire.</Msg>}
      {accounts.loading && !accounts.data && <Loading />}
      {accounts.data && all.length === 0 && (
        <Msg>Aucun compte connecté. <Link to="/comptes">Connectez TikTok, YouTube ou Instagram</Link> pour publier.</Msg>
      )}
      {!desktop && (
        <div className="steps" aria-label={`Étape ${step} sur 3 : ${STEP_LABELS[step - 1]}`}>
          <div className="row between small"><span className="strong">{STEP_LABELS[step - 1]}</span><span className="muted">Étape {step} sur 3</span></div>
          <div className="steps-bar" aria-hidden="true">{[1, 2, 3].map(n => <span key={n} className={n <= step ? 'on' : ''} />)}</div>
          <p className="small muted" style={{ margin: 0 }}>{STEP_INTRO[step - 1]}</p>
        </div>
      )}
      <div className="compose">
        <div className="side col" style={{ gap: 16 }}>
          {show(1) && <Section title="Vidéo">
            {asset ? (
              <div className="row-nw" style={{ gap: 12, alignItems: 'flex-start' }}>
                {asset.thumbnail ? <img src={asset.thumbnail} alt="" width={72} height={104} style={{ width: 72, height: 104, objectFit: 'cover', borderRadius: 10, flex: 'none', background: 'var(--surface-2)' }} />
                  : <span style={{ width: 72, height: 104, borderRadius: 10, background: 'var(--surface-2)', flex: 'none' }} />}
                <div className="col small grow" style={{ gap: 4, minWidth: 0 }}>
                  <span className="strong ellipsis">{asset.name}</span>
                  <span className="muted">{fmtDuration(asset.duration_sec)}{asset.size ? ` · ${fmtSize(asset.size)}` : ''}</span>
                  <span className="muted row-nw" style={{ gap: 6 }}><Icon name="layers" size={14} /><span className="ellipsis">{asset.source_name}{asset.folder ? ` / ${asset.folder}` : ''}</span></span>
                  <span className="tiny muted">Récupérée dans le Drive à l’heure de la publication.</span>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setPicking(true)}>Changer</button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { setAsset(null); setDuration(null) }}>Envoyer un fichier à la place</button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <label className="drop">
                  <span className="drop-ico"><Icon name={file ? 'video' : 'upload'} size={22} /></span>
                  <span className="strong ellipsis" style={{ maxWidth: '100%' }}>{file ? file.name : 'Choisir une vidéo'}</span>
                  <span className="tiny muted">{file ? `${fmtSize(file.size)} · ${fmtDuration(duration)}` : `MP4 ou MOV, vertical, ${config ? fmtSize(config.max_upload_bytes) : '1 Go'} au plus`}</span>
                  <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={busy} className="sr-only"
                         onChange={e => onFile(e.target.files?.[0] || null)} />
                </label>
                {robot.data?.enabled && (
                  <button type="button" className="btn" disabled={busy} onClick={() => setPicking(true)}><Icon name="layers" />Choisir dans la bibliothèque</button>
                )}
                {preview && (
                  <video src={preview} controls muted playsInline preload="metadata" onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
                         style={{ width: '100%', maxHeight: 420, borderRadius: 12, background: '#000' }} />
                )}
              </>
            )}
            <label className="field">Titre
              <input className="input" value={title} maxLength={200} disabled={busy} onChange={e => setTitle(e.target.value)} placeholder="Nom de la vidéo (titre YouTube par défaut)" />
            </label>
            <label className="field">Légende
              <textarea className="textarea" value={caption} disabled={busy} onChange={e => setCaption(e.target.value)} maxLength={2200}
                        placeholder="Reprise sur chaque compte, sauf texte propre à un compte" />
              <span className="field-hint">{caption.length} / 2 200 · {(caption.match(/#/g) || []).length} hashtag(s)</span>
            </label>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>Droits d’auteur de l’œuvre</legend>
              <div className="seg" role="radiogroup" aria-label="Droits d’auteur">
                {(['public_domain', 'protected', 'unknown'] as Rights[]).map(r => (
                  <button key={r} type="button" role="radio" aria-checked={rights === r} aria-pressed={rights === r} disabled={busy}
                          onClick={() => setRights(rights === r ? '' : r)}>{RIGHTS_LABEL[r]}</button>
                ))}
              </div>
              {(rights === 'protected' || rights === 'unknown') && <div role="alert" className="msg msg-warn">{RIGHTS_WARNING}</div>}
              {rights && <input className="input" value={rightsNote} maxLength={300} disabled={busy} onChange={e => setRightsNote(e.target.value)}
                                placeholder="Note (ex. reprise — Wicked, Stephen Schwartz)" aria-label="Note sur les droits" />}
            </fieldset>
          </Section>}

          {show(2) && <Section title="Quand">
            <label className="check"><input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} disabled={busy} />Dès que la vidéo est envoyée</label>
            <label className="check"><input type="radio" name="when" checked={when === 'at'} onChange={() => setWhen('at')} disabled={busy} />À une heure précise</label>
            {when === 'at' && (
              <div className="col" style={{ paddingLeft: 26, gap: 10 }}>
                {sameTime && <label className="field">Date et heure<input className="input" type="datetime-local" value={at} onChange={e => setAt(e.target.value)} disabled={busy} /></label>}
                <Check label="Même heure pour tous les comptes" checked={sameTime} onChange={setSameTime} disabled={busy} />
                {!sameTime && chosen.map(a => (
                  <label key={key(a)} className="field">{a.name} ({PLATFORM_LABEL[a.platform]})
                    <input className="input" type="datetime-local" value={times[key(a)] || at} disabled={busy}
                           onChange={e => setTimes(t => ({ ...t, [key(a)]: e.target.value }))} />
                  </label>
                ))}
                <span className="field-hint">Fuseau : {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
              </div>
            )}
          </Section>}
        </div>

        <div className="main col" style={{ gap: 16 }}>
          {show(2) && <Section title="Où publier" aside={chosen.length ? `${chosen.length} compte${chosen.length > 1 ? 's' : ''}` : undefined}>
            {chosen.length > 0 && (
              <ul className="chosen" aria-label="Comptes choisis">
                {chosen.map(a => (
                  <li key={key(a)} className="fchip fchip-acc">
                    <span className="fchip-av"><Avatar src={a.avatar_url} name={a.name} size="sm" /><PlatformLogo platform={a.platform} size={12} /></span>
                    <span className="ellipsis" style={{ maxWidth: 160 }}>{a.name}</span>
                    <button type="button" className="chosen-x" aria-label={`Retirer ${a.name}`} disabled={busy} onClick={() => toggle(a)}><Icon name="close" size={14} /></button>
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
          </Section>}

          {(file || asset) && (desktop ? chosen.some(a => a.platform !== 'youtube') || !chosen.length : step === 1) && (
            <Section title="Miniature" aside="TikTok · Instagram · facultatif">
              <span className="field-hint">Choisissez l’image de la vidéo qui sert de miniature. TikTok n’accepte qu’une image de la vidéo ; YouTube choisit lui-même celle des Shorts.</span>
              <FramePicker src={preview || asset?.stream || (asset ? `/api/cm/assets/${asset.id}/stream` : null)} duration={duration}
                           value={coverMs} onChange={setCoverMs} disabled={busy} />
              <div className="col" style={{ gap: 6, borderTop: '1px solid var(--line, var(--surface-2))', paddingTop: 12 }}>
                <span className="strong small">Instagram : une autre image (facultatif)</span>
                <div className="row-nw" style={{ gap: 12, alignItems: 'center' }}>
                  {coverUrl ? <img src={coverUrl} alt="Image Instagram choisie" style={{ width: 54, height: 96, objectFit: 'cover', borderRadius: 8, flex: 'none' }} />
                    : <span aria-hidden="true" style={{ width: 54, height: 96, borderRadius: 8, background: 'var(--surface-2)', flex: 'none' }} />}
                  <div className="col grow" style={{ gap: 6 }}>
                    <label className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
                      {cover ? 'Changer l’image' : 'Choisir une image'}
                      <input type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy}
                             onChange={e => { const f = e.target.files?.[0] || null; if (coverUrl) URL.revokeObjectURL(coverUrl); setCover(f); setCoverUrl(f ? URL.createObjectURL(f) : null) }} />
                    </label>
                    {cover && <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => { setCover(null); if (coverUrl) URL.revokeObjectURL(coverUrl); setCoverUrl(null) }}>Retirer</button>}
                    <span className="field-hint">JPEG ou PNG, 8 Mo max, prioritaire sur l’image de la vidéo pour Instagram. Sinon : l’image à côté de la vidéo dans le Drive{asset?.has_cover ? ' (trouvée)' : ''}, ou l’image choisie ci-dessus.</span>
                  </div>
                </div>
              </div>
            </Section>
          )}

          {show(3) && chosen.length === 0 && <Msg>Choisissez d’abord les comptes (étape 2).</Msg>}
          {show(3) && chosen.map(a => {
            const k = key(a), o = opts[k]
            if (!o) return null
            if (a.platform === 'tiktok') return <TikTokPanel key={k} account={a} o={o as TikTokOpts} ci={creators[k]} busy={busy} set={p => set<TikTokOpts>(k, p)} />
            if (a.platform === 'youtube') return <YouTubePanel key={k} account={a} o={o as YouTubeOpts} busy={busy} set={p => set<YouTubeOpts>(k, p)} />
            return <InstaPanel key={k} account={a} o={o as InstaOpts} busy={busy} set={p => set<InstaOpts>(k, p)} />
          })}

          {show(3) && hasTikTok && (
            <p className="tiny muted" style={{ margin: 0 }}>
              {tiktokBranded
                ? <>En publiant, vous acceptez la <a href={TIKTOK_BC_URL} target="_blank" rel="noreferrer">Branded Content Policy</a> et la <a href={TIKTOK_MUSIC_URL} target="_blank" rel="noreferrer">Music Usage Confirmation</a> de TikTok.</>
                : <>En publiant, vous acceptez la <a href={TIKTOK_MUSIC_URL} target="_blank" rel="noreferrer">Music Usage Confirmation</a> de TikTok.</>}
              {' '}Le traitement peut prendre quelques minutes avant que la vidéo soit visible.
            </p>
          )}
          {err && <Msg kind="err">{err}</Msg>}
          {problems.length > 0 && chosen.length > 0 && (file || asset) && (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{problems.map(p => <li key={p}>{p}</li>)}</ul>
          )}
          {!desktop && step < 3 ? (
            <div className="actionbar">
              <span className="small muted ellipsis" style={{ flex: 1, minWidth: 0 }}>{step === 1 ? (file || asset ? title.trim() || 'Sans titre' : 'Choisissez une vidéo') : summary}</span>
              <div className="row-nw" style={{ gap: 8 }}>
                {step > 1 ? <button type="button" className="btn" onClick={() => go((step - 1) as 1 | 2)}><Icon name="left" />Retour</button>
                  : <Link className="btn" to="/planning">Annuler</Link>}
                <button type="button" className="btn btn-primary btn-lg" disabled={step === 1 ? !(file || asset) : chosen.length === 0} onClick={() => go((step + 1) as 2 | 3)}>
                  Suivant<Icon name="right" />
                </button>
              </div>
            </div>
          ) : (
          <div className="actionbar">
            <div className="col" style={{ gap: 6, flex: 1, minWidth: 0 }}>
              <span className="small muted ellipsis">{busy ? `Envoi de la vidéo… ${Math.round((progress || 0) * 100)} %` : problems.length && file && chosen.length ? problems[0] : summary}</span>
              {busy && <div className="progress"><span style={{ width: `${Math.round((progress || 0) * 100)}%` }} /></div>}
            </div>
            <div className="row-nw" style={{ gap: 8 }}>
              {!desktop && <button type="button" className="btn" disabled={busy} onClick={() => go(2)}><Icon name="left" />Retour</button>}
              <Link className="btn only-desktop" to="/planning">Annuler</Link>
              <button type="button" className="btn btn-primary btn-lg" disabled={busy || problems.length > 0} onClick={publish}>
                <Icon name={when === 'now' ? 'bolt' : 'clock'} />{when === 'now' ? 'Publier' : 'Programmer'}
              </button>
            </div>
          </div>
          )}
        </div>
      </div>
      {picking && (
        <Sheet title="Choisir dans la bibliothèque" onClose={() => setPicking(false)}>
          <div className="col" style={{ gap: 12 }}>
            <input className="input" type="search" placeholder="Rechercher (nom, légende, dossier)" aria-label="Rechercher une vidéo"
                   value={pickQ} onChange={e => setPickQ(e.target.value)} />
            <AssetGrid state="all" q={pickQ.trim()} onOpen={useAsset} />
            <Link className="small" to="/bibliotheque">Gérer les dossiers Drive</Link>
          </div>
        </Sheet>
      )}
    </>
  )
}

function OwnText({ value, onChange, busy, label, max }: { value: string; onChange: (v: string) => void; busy: boolean; label: string; max: number }) {
  return (
    <details open={!!value}>
      <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>{label}</summary>
      <textarea className="textarea" style={{ marginTop: 8 }} value={value} maxLength={max} disabled={busy} onChange={e => onChange(e.target.value)}
                placeholder="Vide = la légende commune" />
    </details>
  )
}

function TikTokPanel({ account, o, ci, busy, set }: { account: Account; o: TikTokOpts; ci: CreatorInfo | 'loading' | { error: string } | undefined; busy: boolean; set: (p: Partial<TikTokOpts>) => void }) {
  if (!ci || ci === 'loading') return <Section title={`TikTok · ${account.name}`}><Loading label="Lecture des options du compte TikTok…" /></Section>
  if ('error' in ci) return <Section title={`TikTok · ${account.name}`}><Msg kind="err">{ci.error}</Msg></Section>
  if (!ci.can_post || !ci.creator) return <Section title={`TikTok · ${account.name}`}><Msg kind="err">{ci.message}</Msg></Section>
  const c = ci.creator
  const direct = o.mode === 'direct'
  const brandedOn = direct && o.commercial && o.branded
  return (
    <Section title="TikTok" aside={<span className="row" style={{ gap: 8 }}><Avatar src={c.avatar_url} name={c.nickname} />Publié sur {c.nickname || c.username}</span>}>
      {account.can_draft && account.can_direct && (
        <fieldset className="row" style={{ gap: 16 }}>
          <legend>Mode</legend>
          <label className="check"><input type="radio" checked={direct} onChange={() => set({ mode: 'direct' })} disabled={busy} />Publication directe</label>
          <label className="check"><input type="radio" checked={!direct} onChange={() => set({ mode: 'draft' })} disabled={busy} />Brouillon dans l'app TikTok</label>
        </fieldset>
      )}
      {direct ? (
        <>
          <OwnText label="Légende propre à TikTok" value={o.text} onChange={v => set({ text: v })} busy={busy} max={2200} />
          <label className="field">Qui peut voir cette vidéo
            <select className="select" value={o.privacy} disabled={busy} onChange={e => set({ privacy: e.target.value })}>
              <option value="" disabled>Choisir…</option>
              {c.privacy_level_options.map(p => (
                <option key={p} value={p} disabled={p === 'SELF_ONLY' && brandedOn}>{TIKTOK_PRIVACY[p] || p}</option>
              ))}
            </select>
            {brandedOn && <span className="field-hint">La visibilité d'un contenu de marque ne peut pas être privée.</span>}
          </label>
          <fieldset className="row" style={{ gap: 4, columnGap: 20 }}>
            <legend>Autoriser</legend>
            {([['Commentaires', 'comment', c.comment_disabled], ['Duos', 'duet', c.duet_disabled], ['Collages', 'stitch', c.stitch_disabled]] as const).map(([l, f, off]) => (
              <Check key={f} label={l} checked={!off && o[f]} disabled={off || busy} onChange={v => set({ [f]: v } as Partial<TikTokOpts>)} />
            ))}
          </fieldset>
          {(c.comment_disabled || c.duet_disabled || c.stitch_disabled) && <span className="field-hint">Les options grisées sont désactivées dans les paramètres de votre compte TikTok.</span>}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }} className="col">
            <Check label={<strong>Divulgation de contenu commercial</strong>} checked={o.commercial} disabled={busy}
                   hint="Activez si cette vidéo fait la promotion de vous-même, d'une marque, d'un produit ou d'un service."
                   onChange={v => set(v ? { commercial: true } : { commercial: false, yourBrand: false, branded: false })} />
            {o.commercial && (
              <div className="col" style={{ paddingLeft: 26, gap: 6 }}>
                <Check label="Votre marque" hint="Vous faites la promotion de vous-même ou de votre propre activité." checked={o.yourBrand} disabled={busy} onChange={v => set({ yourBrand: v })} />
                <Check label="Contenu de marque" hint="Vous faites la promotion d'une autre marque ou d'un tiers." checked={o.branded} disabled={busy}
                       onChange={v => set({ branded: v, ...(v && o.privacy === 'SELF_ONLY' ? { privacy: '' } : {}) })} />
                {o.branded ? <Msg>Votre vidéo sera étiquetée « Partenariat rémunéré ».</Msg>
                  : o.yourBrand ? <Msg>Votre vidéo sera étiquetée « Contenu promotionnel ».</Msg>
                  : <span className="field-hint">Vous devez indiquer si votre contenu fait la promotion de vous-même, d'un tiers, ou des deux.</span>}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>La vidéo arrivera dans la boîte de réception TikTok du compte : vous terminerez la légende et la publication dans l'app.</p>
      )}
    </Section>
  )
}

function YouTubePanel({ account, o, busy, set }: { account: Account; o: YouTubeOpts; busy: boolean; set: (p: Partial<YouTubeOpts>) => void }) {
  return (
    <Section title="YouTube" aside={`Short sur ${account.name}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <label className="field grow" style={{ flex: '1 1 220px' }}>Titre YouTube
          <input className="input" value={o.title} maxLength={100} disabled={busy} onChange={e => set({ title: e.target.value })} placeholder="Vide = le titre de la publication" />
        </label>
        <label className="field" style={{ flex: '1 1 160px' }}>Visibilité
          <select className="select" value={o.privacy} disabled={busy} onChange={e => set({ privacy: e.target.value })}>
            <option value="public">Publique</option><option value="unlisted">Non répertoriée</option><option value="private">Privée</option>
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 160px' }}>Catégorie
          <select className="select" value={o.category} disabled={busy} onChange={e => set({ category: e.target.value })}>
            {YT_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <OwnText label="Description propre à YouTube" value={o.description} onChange={v => set({ description: v })} busy={busy} max={5000} />
      <label className="field">Mots-clés<input className="input" value={o.tags} disabled={busy} onChange={e => set({ tags: e.target.value })} placeholder="piano, debussy, partition" />
        <span className="field-hint">Séparés par des virgules.</span></label>
      <fieldset className="row" style={{ gap: 20 }}>
        <legend>Conçue pour les enfants ? (obligatoire)</legend>
        <label className="check"><input type="radio" checked={o.kids === 'yes'} onChange={() => set({ kids: 'yes' })} disabled={busy} />Oui</label>
        <label className="check"><input type="radio" checked={o.kids === 'no'} onChange={() => set({ kids: 'no' })} disabled={busy} />Non</label>
      </fieldset>
      <Check label="Contenu modifié ou synthétique réaliste" hint="Une personne, un lieu ou un événement réaliste créé ou modifié (IA comprise)." checked={o.synthetic} disabled={busy} onChange={v => set({ synthetic: v })} />
      <Check label="Prévenir les abonnés" checked={o.notify} disabled={busy} onChange={v => set({ notify: v })} />
    </Section>
  )
}

function InstaPanel({ account, o, busy, set }: { account: Account; o: InstaOpts; busy: boolean; set: (p: Partial<InstaOpts>) => void }) {
  return (
    <Section title="Instagram" aside={account.mode === 'routine' ? `Reel publié par la routine sur ${account.name}` : `Reel sur ${account.name}`}>
      <OwnText label="Légende propre à Instagram" value={o.text} onChange={v => set({ text: v })} busy={busy} max={2200} />
      <Check label="Afficher aussi le Reel dans le fil" checked={o.feed} disabled={busy} onChange={v => set({ feed: v })} />
    </Section>
  )
}
