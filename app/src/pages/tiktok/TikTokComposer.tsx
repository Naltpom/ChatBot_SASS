// /app/tiktok/publish?account=<id> — composer de publication TikTok, conforme
// aux Content Sharing Guidelines (https://developers.tiktok.com/docs/en/content-sharing-guidelines) :
//  - creator_info interrogé à chaque ouverture : pseudo affiché, publication
//    bloquée si le créateur ne peut pas publier, durée max vérifiée ;
//  - titre éditable, aucun texte/hashtag/filigrane imposé ;
//  - confidentialité issue de privacy_level_options, SANS valeur présélectionnée ;
//  - commentaires / Duo / Collage décochés par défaut, grisés si coupés chez le créateur ;
//  - divulgation de contenu commercial (désactivée par défaut) : « Votre marque » /
//    « Contenu de marque », libellés associés, « Moi uniquement » interdit pour
//    le contenu de marque, Publier désactivé tant que le choix est incomplet ;
//  - déclaration Music Usage Confirmation (+ Branded Content Policy) avant Publier ;
//  - aperçu de la vidéo ; RIEN n'est envoyé avant le clic sur Publier.
// Deux modes : Publication directe (video.publish) ou brouillon (video.upload,
// boîte de réception TikTok du créateur).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, putBytes } from '../../api'
import { useApiResource } from '../../hooks/useApiResource'
import { Btn, Card, InfoBox, SectionTitle, Seg, Toggle } from '../../ui'
import { errMsg } from '../../utils/errors'
import {
  BC_POLICY_URL, FINAL_STATUSES, MUSIC_URL, PRIVACY_LABELS, STATUS_LABELS, TXT, TikTokAccount, TikTokConfig,
  TikTokPost, fmtDuration, fmtSize, useTikTokSpace,
} from './common'

interface Creator {
  nickname: string | null
  username: string | null
  avatar_url: string | null
  privacy_level_options: string[]
  comment_disabled: boolean
  duet_disabled: boolean
  stitch_disabled: boolean
  max_video_post_duration_sec: number | null
}
interface CreatorInfo { can_post: boolean; reason_code?: string; message?: string; creator: Creator | null }
interface CreateOut { post_id: number; part_size: number; part_count: number }

type Mode = 'direct' | 'draft'
type Phase = 'form' | 'sending' | 'tracking' | 'done' | 'failed'

const VIDEO_EXT: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }

function isVideo(file: File, formats: string[]): boolean {
  if (formats.includes(file.type)) return true
  const ext = file.name.toLowerCase().split('.').pop() || ''
  return formats.includes(VIDEO_EXT[ext])
}

export default function TikTokComposer() {
  const [params] = useSearchParams()
  const accountId = Number(params.get('account') || 0)
  const space = useTikTokSpace()
  const backHref = `/app/tiktok${space.spaceParam ? `?${space.spaceParam}` : ''}`
  const config = useApiResource<TikTokConfig>('/api/tiktok/config')
  const accounts = useApiResource<TikTokAccount[]>(`/api/tiktok/accounts${space.query}`)
  const account = accounts.data?.find(a => a.id === accountId) || null

  const [info, setInfo] = useState<CreatorInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [mode, setMode] = useState<Mode>('direct')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  // Codec illisible par le navigateur (ex. HEVC) : la durée sera vérifiée par le serveur.
  const [metaFailed, setMetaFailed] = useState(false)

  const [title, setTitle] = useState('')
  const [privacy, setPrivacy] = useState('')
  const [allowComment, setAllowComment] = useState(false)
  const [allowDuet, setAllowDuet] = useState(false)
  const [allowStitch, setAllowStitch] = useState(false)
  const [commercial, setCommercial] = useState(false)
  const [yourBrand, setYourBrand] = useState(false)
  const [branded, setBranded] = useState(false)

  const [phase, setPhase] = useState<Phase>('form')
  const [progress, setProgress] = useState(0)
  const [post, setPost] = useState<TikTokPost | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])  // remis à true : StrictMode démonte puis remonte

  // creator_info à CHAQUE ouverture du composer (exigence TikTok).
  useEffect(() => {
    if (!accountId) { setLoadError('Aucun compte sélectionné.'); return }
    setInfo(null); setLoadError(null)
    api<CreatorInfo>(`/api/tiktok/accounts/${accountId}/creator-info`)
      .then(setInfo)
      .catch(e => setLoadError(errMsg(e)))
  }, [accountId])

  // Mode par défaut selon les autorisations du compte.
  useEffect(() => {
    if (account && !account.can_publish && account.can_upload) setMode('draft')
  }, [account])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const creator = info?.creator || null
  const formats = config.data?.formats || ['video/mp4', 'video/quicktime', 'video/webm']
  const maxBytes = config.data?.max_upload_bytes || 0
  const maxDur = Math.min(creator?.max_video_post_duration_sec || Infinity, config.data?.max_duration_sec || Infinity)
  const durationKnown = duration !== null && Number.isFinite(maxDur)
  const durationOk = metaFailed || (duration !== null && (!Number.isFinite(maxDur) || duration <= maxDur))
  const direct = mode === 'direct'

  const pickFile = (f: File | null) => {
    setFileError(null); setDuration(null); setMetaFailed(false)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null); setPreviewUrl(null)
    if (!f) return
    if (!isVideo(f, formats)) {
      setFileError('Format non pris en charge : choisissez une vidéo MP4, MOV ou WebM.')
      return
    }
    if (maxBytes && f.size > maxBytes) {
      setFileError(`Vidéo trop volumineuse (${fmtSize(f.size)}) : ${fmtSize(maxBytes)} maximum.`)
      return
    }
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  const onMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const d = e.currentTarget.duration
    if (!Number.isFinite(d)) return
    setDuration(d)
    if (Number.isFinite(maxDur) && d > maxDur) {
      setFileError(`Vidéo trop longue (${fmtDuration(d)}) : ce compte accepte ${fmtDuration(maxDur)} maximum.`)
    }
  }

  const toggleBranded = (v: boolean) => {
    setBranded(v)
    if (v && privacy === 'SELF_ONLY') setPrivacy('')   // « Moi uniquement » interdit pour le contenu de marque
  }

  const toggleCommercial = (v: boolean) => {
    setCommercial(v)
    if (!v) { setYourBrand(false); setBranded(false) }
  }

  const commercialIncomplete = direct && commercial && !yourBrand && !branded
  const brandedOn = direct && commercial && branded
  const missing = useMemo(() => {
    const m: string[] = []
    if (!file) m.push('une vidéo')
    else if (!durationOk) m.push('une vidéo de durée valide')
    if (direct && !privacy) m.push('qui peut voir cette vidéo')
    if (commercialIncomplete) m.push('le type de contenu commercial')
    return m
  }, [file, durationOk, direct, privacy, commercialIncomplete])
  const modeAllowed = direct ? !!account?.can_publish : !!account?.can_upload
  const canSubmit = !!info?.can_post && modeAllowed && missing.length === 0 && phase === 'form'

  const track = async (postId: number) => {
    const started = Date.now()
    while (alive.current && Date.now() - started < 10 * 60 * 1000) {
      try {
        const p = await api<TikTokPost>(`/api/tiktok/posts/${postId}`)
        if (!alive.current) return
        setPost(p)
        if (FINAL_STATUSES.has(p.status)) { setPhase(p.status === 'FAILED' ? 'failed' : 'done'); return }
      } catch (e) {
        if (!alive.current) return
        setSubmitError(errMsg(e))
      }
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // Clic « Publier » : seul déclencheur de l'envoi (vers Chapote puis TikTok).
  const submit = async () => {
    if (!canSubmit || !file) return
    setSubmitError(null); setPost(null); setProgress(0); setPhase('sending')
    let postId: number | null = null
    try {
      const plan = await api<CreateOut>('/api/tiktok/posts', {
        method: 'POST',
        body: {
          account_id: accountId,
          mode,
          title: direct ? title : '',
          privacy_level: direct ? privacy : null,
          allow_comment: direct && allowComment,
          allow_duet: direct && allowDuet,
          allow_stitch: direct && allowStitch,
          brand_organic: direct && commercial && yourBrand,
          brand_content: direct && commercial && branded,
          file_name: file.name,
          video_size: file.size,
        },
      })
      postId = plan.post_id
      for (let i = 0; i < plan.part_count; i++) {
        const start = i * plan.part_size
        const end = Math.min(file.size, start + plan.part_size)
        await putBytes(`/api/tiktok/posts/${postId}/parts/${i}`, file.slice(start, end))
        if (!alive.current) return
        setProgress(Math.round((end / file.size) * 100))
      }
      const p = await api<TikTokPost>(`/api/tiktok/posts/${postId}/submit`, { method: 'POST' })
      if (!alive.current) return
      setPost(p)
      setPhase('tracking')
      await track(postId)
    } catch (e) {
      if (!alive.current) return
      setSubmitError(errMsg(e))
      setPhase('failed')
      if (postId) api(`/api/tiktok/posts/${postId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  const reset = () => {
    pickFile(null); setTitle(''); setPrivacy(''); setAllowComment(false); setAllowDuet(false)
    setAllowStitch(false); toggleCommercial(false); setPhase('form'); setPost(null)
    setSubmitError(null); setProgress(0)
  }

  const back = <Link to={backHref} className="btn btn-ghost" style={{ textDecoration: 'none' }}>← Comptes</Link>

  if (loadError) {
    return (
      <div className="col g18" style={{ maxWidth: 760 }}>
        <SectionTitle right={back}>Publier sur TikTok</SectionTitle>
        <InfoBox tone="danger" title="Impossible de préparer la publication">{loadError}</InfoBox>
      </div>
    )
  }
  if (!info || !accounts.data) return <div className="center-page">Chargement des informations du compte TikTok…</div>
  if (!account) {
    return (
      <div className="col g18" style={{ maxWidth: 760 }}>
        <SectionTitle right={back}>Publier sur TikTok</SectionTitle>
        <InfoBox tone="danger">Compte TikTok introuvable dans cet espace.</InfoBox>
      </div>
    )
  }

  const locked = phase !== 'form'
  const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }
  const disabledStyle: React.CSSProperties = { ...labelStyle, color: 'var(--faint, #9ca3af)', cursor: 'not-allowed', opacity: 0.6 }

  return (
    <div className="col g18" style={{ maxWidth: 760 }}>
      <SectionTitle right={back}>Publier sur TikTok</SectionTitle>

      {/* Compte de publication (creator_info) */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {creator?.avatar_url
            ? <img src={creator.avatar_url} alt="" width={44} height={44} referrerPolicy="no-referrer"
                   style={{ borderRadius: '50%', objectFit: 'cover' }} />
            : <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#e5e7eb' }} />}
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Publication sur le compte TikTok</div>
            <div data-testid="creator-nickname" style={{ fontWeight: 700, fontSize: 15 }}>
              {creator?.nickname || account.display_name || 'Compte TikTok'}
              {creator?.username && <span className="muted" style={{ fontWeight: 500 }}> @{creator.username}</span>}
            </div>
          </div>
        </div>
      </Card>

      {!info.can_post ? (
        <InfoBox tone="danger" title="Publication impossible pour le moment">
          {info.message} Réessayez plus tard.
        </InfoBox>
      ) : (
        <Card>
          <div className="col" style={{ gap: 20 }}>
            {/* Mode */}
            <div>
              <span className="field-label">Mode de publication</span>
              <Seg value={mode} onChange={v => !locked && setMode(v as Mode)}
                   options={[
                     ...(account.can_publish ? [{ value: 'direct', label: 'Publier directement' }] : []),
                     ...(account.can_upload ? [{ value: 'draft', label: 'Envoyer en brouillon' }] : []),
                   ]} />
              <div className="field-hint">
                {direct
                  ? 'La vidéo est publiée sur le profil TikTok avec les réglages ci-dessous.'
                  : "La vidéo est envoyée dans la boîte de réception TikTok de ce compte. Vous recevrez une notification dans l'app TikTok pour terminer l'édition (légende, son, confidentialité) et la publier vous-même."}
              </div>
            </div>

            {/* Vidéo + aperçu */}
            <div>
              <span className="field-label">Vidéo</span>
              <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={locked}
                     aria-label="Vidéo" onChange={e => pickFile(e.target.files?.[0] || null)} />
              <div className="field-hint">
                MP4, MOV ou WebM{maxBytes ? `, ${fmtSize(maxBytes)} maximum` : ''}
                {Number.isFinite(maxDur) ? `, ${fmtDuration(maxDur)} maximum pour ce compte` : ''}.
              </div>
              {fileError && <div style={{ marginTop: 8 }}><InfoBox tone="danger">{fileError}</InfoBox></div>}
              {previewUrl && (
                <video data-testid="video-preview" src={previewUrl} controls playsInline preload="metadata"
                       onLoadedMetadata={onMetadata} onError={() => setMetaFailed(true)}
                       style={{ display: 'block', marginTop: 12, maxWidth: '100%', maxHeight: 420, borderRadius: 10, background: '#000' }} />
              )}
              {metaFailed && (
                <div style={{ marginTop: 8 }}>
                  <InfoBox tone="warn">Aperçu indisponible dans ce navigateur (codec non pris en charge) : la durée sera vérifiée par Chapote avant l'envoi.</InfoBox>
                </div>
              )}
              {file && (
                <div className="field-hint">
                  {file.name} — {durationKnown || duration !== null ? `${fmtDuration(duration!)} — ` : ''}{fmtSize(file.size)}
                </div>
              )}
            </div>

            {direct && (
              <>
                {/* Titre : éditable, rien d'imposé */}
                <label style={{ display: 'block' }}>
                  <span className="field-label">Titre</span>
                  <textarea value={title} maxLength={config.data?.title_max || 2200} rows={3} disabled={locked}
                            aria-label="Titre" onChange={e => setTitle(e.target.value)} />
                  <div className="field-hint">{title.length} / {config.data?.title_max || 2200}</div>
                </label>

                {/* Confidentialité : options de creator_info, aucune présélection */}
                <label style={{ display: 'block' }}>
                  <span className="field-label">Qui peut voir cette vidéo</span>
                  <select value={privacy} disabled={locked} required aria-label="Qui peut voir cette vidéo"
                          onChange={e => {
                            // « Moi uniquement » interdit pour le contenu de marque (même forcé).
                            if (!(e.target.value === 'SELF_ONLY' && brandedOn)) setPrivacy(e.target.value)
                          }}>
                    <option value="" disabled>Choisir…</option>
                    {creator!.privacy_level_options.map(opt => {
                      const blocked = opt === 'SELF_ONLY' && brandedOn
                      return (
                        <option key={opt} value={opt} disabled={blocked} title={blocked ? TXT.brandedNotPrivate : undefined}>
                          {PRIVACY_LABELS[opt] || opt}
                        </option>
                      )
                    })}
                  </select>
                  {brandedOn && creator!.privacy_level_options.includes('SELF_ONLY') && (
                    <div className="field-hint" data-testid="branded-private-hint">{TXT.brandedNotPrivate}</div>
                  )}
                </label>

                {/* Interactions : décochées par défaut, grisées si coupées chez le créateur */}
                <div>
                  <span className="field-label">Interactions</span>
                  <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                    {([
                      ['Autoriser les commentaires', allowComment, setAllowComment, creator!.comment_disabled],
                      ['Autoriser les Duos', allowDuet, setAllowDuet, creator!.duet_disabled],
                      ['Autoriser les Collages', allowStitch, setAllowStitch, creator!.stitch_disabled],
                    ] as const).map(([label, value, set, off]) => (
                      <label key={label} style={off ? disabledStyle : labelStyle}
                             title={off ? 'Désactivé dans les paramètres de votre compte TikTok' : undefined}>
                        <input type="checkbox" checked={off ? false : value} disabled={off || locked}
                               onChange={e => set(e.target.checked)} />
                        {label}
                      </label>
                    ))}
                  </div>
                  {(creator!.comment_disabled || creator!.duet_disabled || creator!.stitch_disabled) && (
                    <div className="field-hint">Les options grisées sont désactivées dans les paramètres de votre compte TikTok.</div>
                  )}
                </div>

                {/* Divulgation de contenu commercial */}
                <div style={{ borderTop: '1px solid var(--border, #eee)', paddingTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>Divulgation de contenu commercial</div>
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        Activez si cette vidéo fait la promotion de vous-même, d'une marque, d'un produit ou d'un service.
                      </div>
                    </div>
                    <Toggle on={commercial} onChange={toggleCommercial} disabled={locked} label="Divulgation de contenu commercial" />
                  </div>
                  {commercial && (
                    <div className="col" style={{ gap: 12, marginTop: 14, paddingLeft: 4 }}>
                      <label style={{ ...labelStyle, alignItems: 'flex-start' }}>
                        <input type="checkbox" checked={yourBrand} disabled={locked} onChange={e => setYourBrand(e.target.checked)}
                               style={{ marginTop: 4 }} aria-label="Votre marque" />
                        <span>
                          <strong>Votre marque</strong><br />
                          <span className="muted" style={{ fontSize: 12.5 }}>Vous faites la promotion de vous-même ou de votre propre activité.</span>
                        </span>
                      </label>
                      <label style={{ ...labelStyle, alignItems: 'flex-start' }}>
                        <input type="checkbox" checked={branded} disabled={locked} onChange={e => toggleBranded(e.target.checked)}
                               style={{ marginTop: 4 }} aria-label="Contenu de marque" />
                        <span>
                          <strong>Contenu de marque</strong><br />
                          <span className="muted" style={{ fontSize: 12.5 }}>Vous faites la promotion d'une autre marque ou d'un tiers.</span>
                        </span>
                      </label>
                      {branded ? (
                        <InfoBox tone="info"><span data-testid="commercial-label">{TXT.labelPaidPartnership}</span></InfoBox>
                      ) : yourBrand ? (
                        <InfoBox tone="info"><span data-testid="commercial-label">{TXT.labelPromotional}</span></InfoBox>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Déclaration de consentement, juste avant Publier */}
                <p data-testid="consent" style={{ fontSize: 12.5, margin: 0 }} className="muted">
                  {brandedOn ? (
                    <>En publiant, vous acceptez la <a href={BC_POLICY_URL} target="_blank" rel="noreferrer">Branded Content Policy</a> et
                      la <a href={MUSIC_URL} target="_blank" rel="noreferrer">Music Usage Confirmation</a> de TikTok.</>
                  ) : (
                    <>En publiant, vous acceptez la <a href={MUSIC_URL} target="_blank" rel="noreferrer">Music Usage Confirmation</a> de TikTok.</>
                  )}
                </p>
              </>
            )}

            {phase === 'form' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span data-testid="publish-wrap" title={commercialIncomplete ? TXT.commercialIncomplete : undefined}>
                  <Btn onClick={submit} disabled={!canSubmit}>{direct ? 'Publier' : 'Envoyer en brouillon'}</Btn>
                </span>
                {commercialIncomplete ? (
                  <span style={{ fontSize: 12.5, color: 'var(--warn)' }}>{TXT.commercialIncomplete}</span>
                ) : missing.length > 0 && (
                  <span className="muted" style={{ fontSize: 12.5 }}>À compléter : {missing.join(', ')}.</span>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {phase !== 'form' && (
        <Card>
          <div className="col" style={{ gap: 10 }} data-testid="publish-status">
            {phase === 'sending' && <div>Envoi de la vidéo… {progress} %</div>}
            {(phase === 'tracking' || phase === 'done') && (
              <InfoBox tone={phase === 'done' ? 'go' : 'info'}
                       title={post ? STATUS_LABELS[post.status] || post.status : 'Vidéo envoyée'}>
                {post?.mode === 'draft'
                  ? "Ouvrez l'app TikTok : la vidéo vous attend dans votre boîte de réception pour être finalisée et publiée."
                  : TXT.processing}
              </InfoBox>
            )}
            {phase === 'failed' && (
              <InfoBox tone="danger" title="La publication a échoué">
                {post?.error_message || submitError}
              </InfoBox>
            )}
            {submitError && phase !== 'failed' && <InfoBox tone="warn">{submitError}</InfoBox>}
            {phase !== 'sending' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn kind="ghost" onClick={reset}>Publier une autre vidéo</Btn>
                <Link to={backHref} className="btn btn-ghost" style={{ textDecoration: 'none' }}>Voir l'historique</Link>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
