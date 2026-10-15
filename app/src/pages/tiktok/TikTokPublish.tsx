// /tiktok/publish?account=<open_id> — publication Direct Post, conforme aux
// UX guidelines TikTok (https://developers.tiktok.com/doc/content-sharing-guidelines) :
//  - creator_info interrogé à l'ouverture : pseudo/avatar affichés, publication
//    bloquée si le créateur ne peut pas publier, durée max vérifiée ;
//  - confidentialité issue de privacy_level_options, SANS valeur par défaut ;
//  - commentaires / Duo / Stitch décochés par défaut, grisés si désactivés côté TikTok ;
//  - divulgation commerciale (off par défaut) : « Votre marque » / « Contenu de
//    marque », libellés associés, « Moi uniquement » impossible pour le contenu de marque ;
//  - déclaration Music Usage Confirmation (+ Branded Content Policy) ;
//  - aperçu vidéo, légende éditable, bouton Publier actif seulement si tout est rempli.
// Les octets passent par l'API (chunks), qui seule parle à TikTok.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, putBytes } from '../../api'
import { Btn, Card, InfoBox, SectionTitle, Toggle } from '../../ui'
import { errMsg } from '../../utils/errors'
import { PRIVACY_LABELS, useNoIndex } from './common'

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
interface InitOut { publish_id: string; chunk_size: number; total_chunk_count: number; video_size: number }
interface StatusOut { status: string; fail_reason: string | null; post_ids: (string | number)[] }

const MUSIC_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en'
const BC_POLICY_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en'
const TITLE_MAX = 2200

const STATUS_LABELS: Record<string, string> = {
  PROCESSING_UPLOAD: 'TikTok traite la vidéo envoyée…',
  PROCESSING_DOWNLOAD: 'TikTok récupère la vidéo…',
  SEND_TO_USER_INBOX: 'Vidéo envoyée dans la boîte de réception TikTok.',
  PUBLISH_COMPLETE: 'Publication terminée.',
  FAILED: 'La publication a échoué.',
}

type Phase = 'form' | 'uploading' | 'processing' | 'done' | 'failed'

function mimeOf(file: File): string | null {
  if (file.type === 'video/mp4' || file.type === 'video/quicktime') return file.type
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'mov') return 'video/quicktime'
  return null
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60)
  return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`
}

export default function TikTokPublish() {
  useNoIndex()
  const [params] = useSearchParams()
  const openId = params.get('account') || ''

  const [info, setInfo] = useState<CreatorInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  // Codec illisible par le navigateur (ex. HEVC) : pas de durée côté client.
  const [metaFailed, setMetaFailed] = useState(false)

  const [title, setTitle] = useState('')
  const [privacy, setPrivacy] = useState('')
  const [allowComment, setAllowComment] = useState(false)
  const [allowDuet, setAllowDuet] = useState(false)
  const [allowStitch, setAllowStitch] = useState(false)
  const [commercial, setCommercial] = useState(false)
  const [yourBrand, setYourBrand] = useState(false)
  const [branded, setBranded] = useState(false)
  const [privacyHint, setPrivacyHint] = useState<string | null>(null)

  const [phase, setPhase] = useState<Phase>('form')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<StatusOut | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    if (!openId) { setLoadError('Aucun compte sélectionné.'); return }
    api<CreatorInfo>(`/api/admin/tiktok/accounts/${encodeURIComponent(openId)}/creator-info`)
      .then(setInfo)
      .catch(e => setLoadError(errMsg(e)))
  }, [openId])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const creator = info?.creator || null
  const maxDur = creator?.max_video_post_duration_sec || null
  const durationOk = metaFailed || (duration !== null && (!maxDur || duration <= maxDur))

  const pickFile = (f: File | null) => {
    setFileError(null); setDuration(null); setMetaFailed(false)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    if (!f) { setFile(null); setPreviewUrl(null); return }
    if (!mimeOf(f)) {
      setFile(null); setPreviewUrl(null)
      setFileError('Format non pris en charge : choisissez une vidéo MP4 ou MOV.')
      return
    }
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  const onMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const d = e.currentTarget.duration
    if (!Number.isFinite(d)) return
    setDuration(d)
    if (maxDur && d > maxDur) {
      setFileError(`Vidéo trop longue (${fmtDuration(d)}) : ce compte accepte ${fmtDuration(maxDur)} maximum.`)
    }
  }

  const toggleBranded = (v: boolean) => {
    setBranded(v)
    if (v && privacy === 'SELF_ONLY') {
      setPrivacy('')
      setPrivacyHint('La visibilité du contenu de marque ne peut pas être « Moi uniquement » : choisissez une autre option.')
    } else {
      setPrivacyHint(null)
    }
  }

  const toggleCommercial = (v: boolean) => {
    setCommercial(v)
    if (!v) { setYourBrand(false); setBranded(false); setPrivacyHint(null) }
  }

  const commercialIncomplete = commercial && !yourBrand && !branded
  const missing = useMemo(() => {
    const m: string[] = []
    if (!file) m.push('une vidéo')
    else if (!durationOk) m.push('une vidéo de durée valide')
    if (!privacy) m.push('qui peut voir cette vidéo')
    if (commercialIncomplete) m.push('le type de contenu commercial')
    return m
  }, [file, durationOk, privacy, commercialIncomplete])
  const canSubmit = !!info?.can_post && missing.length === 0 && phase === 'form'

  const poll = async (publishId: string) => {
    const started = Date.now()
    while (alive.current && Date.now() - started < 10 * 60 * 1000) {
      try {
        const s = await api<StatusOut>(`/api/admin/tiktok/publishes/${encodeURIComponent(publishId)}/status`)
        if (!alive.current) return
        setStatus(s)
        if (s.status === 'PUBLISH_COMPLETE' || s.status === 'SEND_TO_USER_INBOX') { setPhase('done'); return }
        if (s.status === 'FAILED') { setPhase('failed'); return }
      } catch (e) {
        if (!alive.current) return
        setSubmitError(errMsg(e))
      }
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  const submit = async () => {
    if (!canSubmit || !file) return
    setSubmitError(null); setStatus(null); setProgress(0); setPhase('uploading')
    try {
      const init = await api<InitOut>(`/api/admin/tiktok/accounts/${encodeURIComponent(openId)}/publish`, {
        method: 'POST',
        body: {
          title,
          privacy_level: privacy,
          allow_comment: allowComment,
          allow_duet: allowDuet,
          allow_stitch: allowStitch,
          brand_organic_toggle: commercial && yourBrand,
          brand_content_toggle: commercial && branded,
          video_size: file.size,
          mime_type: mimeOf(file),
          duration_sec: duration,
        },
      })
      for (let i = 0; i < init.total_chunk_count; i++) {
        const start = i * init.chunk_size
        const end = i === init.total_chunk_count - 1 ? file.size : start + init.chunk_size
        await putBytes(`/api/admin/tiktok/publishes/${encodeURIComponent(init.publish_id)}/chunks/${i}`, file.slice(start, end))
        if (!alive.current) return
        setProgress(Math.round((end / file.size) * 100))
      }
      setPhase('processing')
      await poll(init.publish_id)
    } catch (e) {
      if (!alive.current) return
      setSubmitError(errMsg(e))
      setPhase('failed')
    }
  }

  const reset = () => {
    pickFile(null); setTitle(''); setPrivacy(''); setAllowComment(false); setAllowDuet(false)
    setAllowStitch(false); toggleCommercial(false); setPhase('form'); setStatus(null)
    setSubmitError(null); setProgress(0)
  }

  const back = <Link to="/tiktok" className="btn btn-ghost" style={{ textDecoration: 'none' }}>← Comptes</Link>

  if (loadError) {
    return (
      <div className="col g18" style={{ maxWidth: 760 }}>
        <SectionTitle right={back}>Publier sur TikTok</SectionTitle>
        <InfoBox tone="danger" title="Impossible de préparer la publication">{loadError}</InfoBox>
      </div>
    )
  }
  if (!info) return <div className="center-page">Chargement des informations du compte TikTok…</div>

  const locked = phase !== 'form'
  const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }
  const disabledStyle: React.CSSProperties = { ...labelStyle, color: 'var(--faint, #9ca3af)', cursor: 'not-allowed' }

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
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {creator?.nickname || 'Compte TikTok'}
              {creator?.username && <span className="muted" style={{ fontWeight: 500 }}> @{creator.username}</span>}
            </div>
          </div>
        </div>
      </Card>

      {!info.can_post ? (
        <InfoBox tone="danger" title="Publication impossible pour le moment">{info.message}</InfoBox>
      ) : (
        <Card>
          <div className="col" style={{ gap: 20 }}>
            {/* Vidéo */}
            <div>
              <span className="field-label">Vidéo</span>
              <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" disabled={locked}
                     onChange={e => pickFile(e.target.files?.[0] || null)} />
              {maxDur && <div className="field-hint">MP4 ou MOV, {fmtDuration(maxDur)} maximum pour ce compte.</div>}
              {fileError && <div style={{ marginTop: 8 }}><InfoBox tone="danger">{fileError}</InfoBox></div>}
              {previewUrl && (
                <video src={previewUrl} controls playsInline preload="metadata" onLoadedMetadata={onMetadata}
                       onError={() => setMetaFailed(true)}
                       style={{ display: 'block', marginTop: 12, maxWidth: '100%', maxHeight: 420, borderRadius: 10, background: '#000' }} />
              )}
              {metaFailed && (
                <div style={{ marginTop: 8 }}>
                  <InfoBox tone="warn">Aperçu indisponible dans ce navigateur (codec non pris en charge) : la durée sera vérifiée par TikTok à la publication.</InfoBox>
                </div>
              )}
              {file && duration !== null && (
                <div className="field-hint">{file.name} — {fmtDuration(duration)} — {(file.size / 1024 / 1024).toFixed(1)} Mo</div>
              )}
            </div>

            {/* Légende */}
            <label style={{ display: 'block' }}>
              <span className="field-label">Légende</span>
              <textarea value={title} maxLength={TITLE_MAX} rows={3} disabled={locked}
                        placeholder="Décrivez votre vidéo, ajoutez des #hashtags…"
                        onChange={e => setTitle(e.target.value)} />
              <div className="field-hint">{title.length} / {TITLE_MAX}</div>
            </label>

            {/* Confidentialité : aucune valeur par défaut */}
            <label style={{ display: 'block' }}>
              <span className="field-label">Qui peut voir cette vidéo</span>
              <select value={privacy} disabled={locked} required
                      onChange={e => { setPrivacy(e.target.value); setPrivacyHint(null) }}>
                <option value="" disabled>Choisir…</option>
                {creator!.privacy_level_options.map(opt => {
                  const blocked = opt === 'SELF_ONLY' && commercial && branded
                  return (
                    <option key={opt} value={opt} disabled={blocked}>
                      {PRIVACY_LABELS[opt] || opt}{blocked ? ' (indisponible pour le contenu de marque)' : ''}
                    </option>
                  )
                })}
              </select>
              {privacyHint && <div className="field-hint" style={{ color: 'var(--warn)' }}>{privacyHint}</div>}
            </label>

            {/* Interactions */}
            <div>
              <span className="field-label">Autoriser les utilisateurs à</span>
              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                {([
                  ['Commentaires', allowComment, setAllowComment, creator!.comment_disabled],
                  ['Duo', allowDuet, setAllowDuet, creator!.duet_disabled],
                  ['Stitch', allowStitch, setAllowStitch, creator!.stitch_disabled],
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
                    Indiquez si cette vidéo fait la promotion de vous-même, d'une marque, d'un produit ou d'un service.
                  </div>
                </div>
                <Toggle on={commercial} onChange={toggleCommercial} disabled={locked} label="Divulgation de contenu commercial" />
              </div>
              {commercial && (
                <div className="col" style={{ gap: 12, marginTop: 14, paddingLeft: 4 }}>
                  <label style={{ ...labelStyle, alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={yourBrand} disabled={locked} onChange={e => setYourBrand(e.target.checked)} style={{ marginTop: 4 }} />
                    <span>
                      <strong>Votre marque</strong><br />
                      <span className="muted" style={{ fontSize: 12.5 }}>Vous faites la promotion de vous-même ou de votre propre activité. Cette vidéo sera classée « Brand Organic ».</span>
                    </span>
                  </label>
                  <label style={{ ...labelStyle, alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={branded} disabled={locked} onChange={e => toggleBranded(e.target.checked)} style={{ marginTop: 4 }} />
                    <span>
                      <strong>Contenu de marque</strong><br />
                      <span className="muted" style={{ fontSize: 12.5 }}>Vous faites la promotion d'une autre marque ou d'un tiers. Cette vidéo sera classée « Branded Content ».</span>
                    </span>
                  </label>
                  {commercialIncomplete && (
                    <InfoBox tone="warn">Vous devez indiquer si votre contenu fait la promotion de vous-même, d'un tiers, ou des deux.</InfoBox>
                  )}
                  {branded ? (
                    <InfoBox tone="info">Votre vidéo sera étiquetée « Partenariat rémunéré ».</InfoBox>
                  ) : yourBrand ? (
                    <InfoBox tone="info">Votre vidéo sera étiquetée « Contenu promotionnel ».</InfoBox>
                  ) : null}
                </div>
              )}
            </div>

            {/* Déclaration */}
            <p style={{ fontSize: 12.5, margin: 0 }} className="muted">
              {commercial && branded ? (
                <>En publiant, vous acceptez la <a href={BC_POLICY_URL} target="_blank" rel="noreferrer">Branded Content Policy</a> et
                  la <a href={MUSIC_URL} target="_blank" rel="noreferrer">Music Usage Confirmation</a> de TikTok.</>
              ) : (
                <>En publiant, vous acceptez la <a href={MUSIC_URL} target="_blank" rel="noreferrer">Music Usage Confirmation</a> de TikTok.</>
              )}
            </p>

            {phase === 'form' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span title={commercialIncomplete ? 'Vous devez indiquer si votre contenu fait la promotion de vous-même, d\'un tiers, ou des deux.' : undefined}>
                  <Btn onClick={submit} disabled={!canSubmit}>Publier</Btn>
                </span>
                {missing.length > 0 && <span className="muted" style={{ fontSize: 12.5 }}>À compléter : {missing.join(', ')}.</span>}
              </div>
            )}
          </div>
        </Card>
      )}

      {phase !== 'form' && (
        <Card>
          <div className="col" style={{ gap: 10 }}>
            {phase === 'uploading' && <div>Envoi de la vidéo à TikTok… {progress} %</div>}
            {(phase === 'processing' || phase === 'done') && (
              <InfoBox tone={phase === 'done' ? 'go' : 'info'} title={phase === 'done' ? 'Vidéo envoyée' : 'Traitement en cours'}>
                {status ? STATUS_LABELS[status.status] || status.status : 'Vidéo envoyée, en attente du statut TikTok…'}
                <div style={{ marginTop: 4 }}>La vidéo peut prendre quelques minutes à apparaître sur votre profil TikTok.</div>
              </InfoBox>
            )}
            {phase === 'failed' && (
              <InfoBox tone="danger" title="La publication a échoué">
                {status?.fail_reason ? `Raison TikTok : ${status.fail_reason}` : submitError}
              </InfoBox>
            )}
            {submitError && phase !== 'failed' && <InfoBox tone="warn">{submitError}</InfoBox>}
            {(phase === 'done' || phase === 'failed') && (
              <div><Btn kind="ghost" onClick={reset}>Publier une autre vidéo</Btn></div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
