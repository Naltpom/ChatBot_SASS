// /app/youtube/publish?account=<id> — composer de publication d'un Short :
//  - titre (100 caractères), description, mots-clés, catégorie, langue ;
//  - visibilité sans valeur présélectionnée, ou mise en ligne programmée
//    (privée jusqu'à la date, exigence YouTube) ;
//  - déclarations obligatoires : « conçue pour les enfants » (COPPA, aucun
//    choix par défaut) et contenu modifié ou synthétique ;
//  - aperçu ; durée d'un Short (3 min) vérifiée ; RIEN n'est envoyé avant « Publier ».
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, putBytes } from '../../api'
import { useApiResource } from '../../hooks/useApiResource'
import { Btn, Card, InfoBox, SectionTitle, Seg, Toggle } from '../../ui'
import { errMsg } from '../../utils/errors'
import {
  CATEGORIES, FINAL_STATUSES, STATUS_LABELS, TXT, YouTubeAccount, YouTubeConfig, YouTubePost,
  fmtDuration, fmtSize, useYouTubeSpace,
} from './common'

interface CreateOut { post_id: number; part_size: number; part_count: number }
type Phase = 'form' | 'sending' | 'tracking' | 'done' | 'failed'
type When = 'now' | 'later'

const VIDEO_EXT: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }

function isVideo(file: File, formats: string[]): boolean {
  if (formats.includes(file.type)) return true
  const ext = file.name.toLowerCase().split('.').pop() || ''
  return formats.includes(VIDEO_EXT[ext])
}

function tagsLength(tags: string[]) {
  return tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0), 0) + Math.max(tags.length - 1, 0)
}

const utf8Len = (s: string) => new TextEncoder().encode(s).length

export default function YouTubeComposer() {
  const [params] = useSearchParams()
  const accountId = Number(params.get('account') || 0)
  const space = useYouTubeSpace()
  const backHref = `/app/youtube${space.spaceParam ? `?${space.spaceParam}` : ''}`
  const config = useApiResource<YouTubeConfig>('/api/youtube/config')
  const accounts = useApiResource<YouTubeAccount[]>(`/api/youtube/accounts${space.query}`)
  const account = accounts.data?.find(a => a.id === accountId) || null

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [vertical, setVertical] = useState<boolean | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [metaFailed, setMetaFailed] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [category, setCategory] = useState('22')
  const [language, setLanguage] = useState('')
  const [privacy, setPrivacy] = useState('')
  const [when, setWhen] = useState<When>('now')
  const [publishAt, setPublishAt] = useState('')
  const [kids, setKids] = useState<'' | 'yes' | 'no'>('')
  const [synthetic, setSynthetic] = useState(false)
  const [notify, setNotify] = useState(true)

  const [phase, setPhase] = useState<Phase>('form')
  const [progress, setProgress] = useState(0)
  const [post, setPost] = useState<YouTubePost | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const formats = config.data?.formats || ['video/mp4', 'video/quicktime', 'video/webm']
  const maxBytes = config.data?.max_upload_bytes || 0
  const maxDur = config.data?.max_duration_sec || 180
  const titleMax = config.data?.title_max || 100
  const descMax = config.data?.description_max_bytes || 5000
  const tagsMax = config.data?.tags_max || 500
  const tags = useMemo(() => tagsText.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean), [tagsText])
  const durationOk = metaFailed || (duration !== null && duration <= maxDur)

  const pickFile = (f: File | null) => {
    setFileError(null); setDuration(null); setVertical(null); setMetaFailed(false)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null); setPreviewUrl(null)
    if (!f) return
    if (!isVideo(f, formats)) { setFileError('Format non pris en charge : choisissez une vidéo MP4, MOV ou WebM.'); return }
    if (maxBytes && f.size > maxBytes) { setFileError(`Vidéo trop volumineuse (${fmtSize(f.size)}) : ${fmtSize(maxBytes)} maximum.`); return }
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  const onMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    if (!Number.isFinite(v.duration)) return
    setDuration(v.duration)
    if (v.videoWidth && v.videoHeight) setVertical(v.videoHeight >= v.videoWidth)
    if (v.duration > maxDur) setFileError(`Vidéo trop longue pour un Short (${fmtDuration(v.duration)}) : ${fmtDuration(maxDur)} maximum.`)
  }

  const badChars = (s: string) => s.includes('<') || s.includes('>')
  const publishAtDate = publishAt ? new Date(publishAt) : null
  const missing = useMemo(() => {
    const m: string[] = []
    if (!file) m.push('une vidéo')
    else if (!durationOk) m.push('une vidéo de 3 minutes au plus')
    if (!title.trim()) m.push('un titre')
    if (when === 'now' && !privacy) m.push('la visibilité')
    if (when === 'later' && !publishAtDate) m.push('la date de mise en ligne')
    if (!kids) m.push('si la vidéo est conçue pour les enfants')
    return m
  }, [file, durationOk, title, when, privacy, publishAtDate, kids])
  const invalid = title.length > titleMax || badChars(title) || utf8Len(description) > descMax || badChars(description)
    || tagsLength(tags) > tagsMax
  const canSubmit = !!account && !account.needs_reconnect && account.can_upload && missing.length === 0 && !invalid
    && phase === 'form'

  const track = async (postId: number) => {
    const started = Date.now()
    while (alive.current && Date.now() - started < 10 * 60 * 1000) {
      try {
        const p = await api<YouTubePost>(`/api/youtube/posts/${postId}`)
        if (!alive.current) return
        setPost(p)
        if (FINAL_STATUSES.has(p.status)) { setPhase(p.status === 'FAILED' ? 'failed' : 'done'); return }
      } catch (e) {
        if (!alive.current) return
        setSubmitError(errMsg(e))
      }
      await new Promise(r => setTimeout(r, 4000))
    }
  }

  const submit = async () => {
    if (!canSubmit || !file) return
    setSubmitError(null); setPost(null); setProgress(0); setPhase('sending')
    let postId: number | null = null
    try {
      const plan = await api<CreateOut>('/api/youtube/posts', {
        method: 'POST',
        body: {
          account_id: accountId,
          title: title.trim(),
          description,
          tags,
          category_id: category,
          default_language: language || null,
          privacy_status: when === 'later' ? 'private' : privacy,
          publish_at: when === 'later' && publishAtDate ? publishAtDate.toISOString() : null,
          made_for_kids: kids === 'yes',
          synthetic_media: synthetic,
          notify_subscribers: notify,
          file_name: file.name,
          video_size: file.size,
        },
      })
      postId = plan.post_id
      for (let i = 0; i < plan.part_count; i++) {
        const start = i * plan.part_size
        const end = Math.min(file.size, start + plan.part_size)
        await putBytes(`/api/youtube/posts/${postId}/parts/${i}`, file.slice(start, end))
        if (!alive.current) return
        setProgress(Math.round((end / file.size) * 100))
      }
      const p = await api<YouTubePost>(`/api/youtube/posts/${postId}/submit`, { method: 'POST' })
      if (!alive.current) return
      setPost(p)
      setPhase('tracking')
      await track(postId)
    } catch (e) {
      if (!alive.current) return
      setSubmitError(errMsg(e))
      setPhase('failed')
      if (postId) api(`/api/youtube/posts/${postId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  const reset = () => {
    pickFile(null); setTitle(''); setDescription(''); setTagsText(''); setPrivacy(''); setWhen('now')
    setPublishAt(''); setKids(''); setSynthetic(false); setNotify(true); setPhase('form'); setPost(null)
    setSubmitError(null); setProgress(0)
  }

  const back = <Link to={backHref} className="btn btn-ghost" style={{ textDecoration: 'none' }}>← Chaînes</Link>

  if (!accounts.data || !config.data) return <div className="center-page">Chargement…</div>
  if (!account) {
    return (
      <div className="col g18" style={{ maxWidth: 760 }}>
        <SectionTitle right={back}>Publier un Short</SectionTitle>
        <InfoBox tone="danger">Chaîne YouTube introuvable dans cet espace.</InfoBox>
      </div>
    )
  }

  const locked = phase !== 'form'
  const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }
  const minDate = new Date(Date.now() + 10 * 60 * 1000)
  const localMin = new Date(minDate.getTime() - minDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

  return (
    <div className="col g18" style={{ maxWidth: 760 }}>
      <SectionTitle right={back}>Publier un Short</SectionTitle>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {account.thumbnail_url
            ? <img src={account.thumbnail_url} alt="" width={44} height={44} referrerPolicy="no-referrer"
                   style={{ borderRadius: '50%', objectFit: 'cover' }} />
            : <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#e5e7eb' }} />}
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Publication sur la chaîne YouTube</div>
            <div data-testid="channel-title" style={{ fontWeight: 700, fontSize: 15 }}>
              {account.title || 'Chaîne YouTube'}
              {account.handle && <span className="muted" style={{ fontWeight: 500 }}> {account.handle}</span>}
            </div>
          </div>
        </div>
      </Card>

      {account.needs_reconnect ? (
        <InfoBox tone="danger" title="Chaîne à reconnecter">
          L'autorisation Google de cette chaîne a expiré ou a été révoquée : reconnectez-la depuis la page YouTube.
        </InfoBox>
      ) : (
        <Card>
          <div className="col" style={{ gap: 20 }}>
            <div>
              <span className="field-label">Vidéo</span>
              <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={locked}
                     aria-label="Vidéo" onChange={e => pickFile(e.target.files?.[0] || null)} />
              <div className="field-hint">
                MP4, MOV ou WebM{maxBytes ? `, ${fmtSize(maxBytes)} maximum` : ''}, {fmtDuration(maxDur)} maximum. {TXT.short}
              </div>
              {fileError && <div style={{ marginTop: 8 }}><InfoBox tone="danger">{fileError}</InfoBox></div>}
              {vertical === false && (
                <div style={{ marginTop: 8 }}>
                  <InfoBox tone="warn">Vidéo horizontale : YouTube la publiera comme une vidéo classique, pas comme un Short.</InfoBox>
                </div>
              )}
              {previewUrl && (
                <video data-testid="video-preview" src={previewUrl} controls playsInline preload="metadata"
                       onLoadedMetadata={onMetadata} onError={() => setMetaFailed(true)}
                       style={{ display: 'block', marginTop: 12, maxWidth: '100%', maxHeight: 420, borderRadius: 10, background: '#000' }} />
              )}
              {metaFailed && (
                <div style={{ marginTop: 8 }}>
                  <InfoBox tone="warn">Aperçu indisponible dans ce navigateur : la durée sera vérifiée par Chapote avant l'envoi.</InfoBox>
                </div>
              )}
              {file && (
                <div className="field-hint">{file.name} — {duration !== null ? `${fmtDuration(duration)} — ` : ''}{fmtSize(file.size)}</div>
              )}
            </div>

            <label style={{ display: 'block' }}>
              <span className="field-label">Titre</span>
              <input value={title} maxLength={titleMax} disabled={locked} aria-label="Titre" style={{ width: '100%' }}
                     onChange={e => setTitle(e.target.value)} />
              <div className="field-hint">{title.length} / {titleMax}{badChars(title) ? ' — les caractères < et > sont refusés par YouTube' : ''}</div>
            </label>

            <label style={{ display: 'block' }}>
              <span className="field-label">Description</span>
              <textarea value={description} rows={4} disabled={locked} aria-label="Description"
                        onChange={e => setDescription(e.target.value)} />
              <div className="field-hint" style={{ color: utf8Len(description) > descMax ? 'var(--danger)' : undefined }}>
                {utf8Len(description)} / {descMax} octets{badChars(description) ? ' — les caractères < et > sont refusés par YouTube' : ''}
              </div>
            </label>

            <label style={{ display: 'block' }}>
              <span className="field-label">Mots-clés (séparés par des virgules)</span>
              <input value={tagsText} disabled={locked} aria-label="Mots-clés" style={{ width: '100%' }} onChange={e => setTagsText(e.target.value)} />
              <div className="field-hint" style={{ color: tagsLength(tags) > tagsMax ? 'var(--danger)' : undefined }}>
                {tagsLength(tags)} / {tagsMax}
              </div>
            </label>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <label style={{ display: 'block', flex: 1, minWidth: 200 }}>
                <span className="field-label">Catégorie</span>
                <select value={category} disabled={locked} aria-label="Catégorie" onChange={e => setCategory(e.target.value)}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'block', flex: 1, minWidth: 200 }}>
                <span className="field-label">Langue de la vidéo</span>
                <select value={language} disabled={locked} aria-label="Langue" onChange={e => setLanguage(e.target.value)}>
                  <option value="">Non précisée</option>
                  <option value="fr">Français</option>
                  <option value="en">Anglais</option>
                  <option value="es">Espagnol</option>
                  <option value="de">Allemand</option>
                </select>
              </label>
            </div>

            <div>
              <span className="field-label">Mise en ligne</span>
              <Seg value={when} onChange={v => !locked && setWhen(v as When)}
                   options={[{ value: 'now', label: 'Maintenant' }, { value: 'later', label: 'Programmer' }]} />
              {when === 'now' ? (
                <label style={{ display: 'block', marginTop: 10 }}>
                  <span className="field-label">Visibilité</span>
                  <select value={privacy} disabled={locked} required aria-label="Visibilité" onChange={e => setPrivacy(e.target.value)}>
                    <option value="" disabled>Choisir…</option>
                    <option value="public">Publique</option>
                    <option value="unlisted">Non répertoriée</option>
                    <option value="private">Privée</option>
                  </select>
                </label>
              ) : (
                <label style={{ display: 'block', marginTop: 10 }}>
                  <span className="field-label">Date et heure (votre fuseau horaire)</span>
                  <input type="datetime-local" value={publishAt} min={localMin} disabled={locked}
                         aria-label="Date de mise en ligne" onChange={e => setPublishAt(e.target.value)} />
                  <div className="field-hint">La vidéo reste privée jusqu'à cette date, puis devient publique.</div>
                </label>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--border, #eee)', paddingTop: 16 }} className="col">
              <span className="field-label">Public (obligatoire, loi COPPA)</span>
              <label style={labelStyle}>
                <input type="radio" name="kids" checked={kids === 'no'} disabled={locked} onChange={() => setKids('no')} />
                Non, elle n'est pas conçue pour les enfants
              </label>
              <label style={labelStyle}>
                <input type="radio" name="kids" checked={kids === 'yes'} disabled={locked} onChange={() => setKids('yes')} />
                Oui, elle est conçue pour les enfants
              </label>
              <div className="field-hint">
                Une vidéo conçue pour les enfants n'a ni commentaires ni publicité personnalisée.{' '}
                <a href="https://support.google.com/youtube/answer/9528076" target="_blank" rel="noreferrer">En savoir plus</a>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>Contenu modifié ou synthétique</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Activez si la vidéo montre de façon réaliste une personne, un lieu ou un événement créé ou modifié (IA, montage).
                </div>
              </div>
              <Toggle on={synthetic} onChange={setSynthetic} disabled={locked} label="Contenu modifié ou synthétique" />
            </div>

            <label style={labelStyle}>
              <input type="checkbox" checked={notify} disabled={locked} onChange={e => setNotify(e.target.checked)} />
              Prévenir les abonnés
            </label>

            <p data-testid="consent" style={{ fontSize: 12.5, margin: 0 }} className="muted">
              En publiant, vous acceptez les <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">Conditions d'utilisation de YouTube</a>{' '}
              et confirmez détenir les droits sur la vidéo et sa musique.
            </p>

            {phase === 'form' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Btn onClick={submit} disabled={!canSubmit}>{when === 'later' ? 'Programmer' : 'Publier'}</Btn>
                {missing.length > 0 && <span className="muted" style={{ fontSize: 12.5 }}>À compléter : {missing.join(', ')}.</span>}
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
              <InfoBox tone={phase === 'done' ? (post?.fail_reason === 'locked_private' ? 'warn' : 'go') : 'info'}
                       title={post ? STATUS_LABELS[post.status] || post.status : 'Vidéo envoyée'}>
                {post?.error_message || (post?.url
                  ? <a href={post.url} target="_blank" rel="noreferrer">{post.url}</a>
                  : 'Le traitement par YouTube peut prendre quelques minutes.')}
              </InfoBox>
            )}
            {phase === 'failed' && (
              <InfoBox tone="danger" title="La publication a échoué">{post?.error_message || submitError}</InfoBox>
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
