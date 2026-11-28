// Planning : une ligne par vidéo et UNE fenêtre de publication (maquette Claude Design, itération 3).
// Ligne : heure, titre court, logos des plateformes (plein = publiée, pointillé = programmée, rouge = échec),
// bordure gauche à la couleur du groupe. Fenêtre : média 9:16 (lit la vidéo), titre en gros, commun à
// toutes les plateformes (légende petite et repliable, hashtags), puis une carte par plateforme qui se déplie
// sur place : seulement ce qui diffère, ses chiffres, le lien de la publication et ses actions.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  cancelTarget, fixLink, getAsset, getPost, markPublished, patchPost, patchTarget, publishNow, publishedByHand, resendDraft, retryTarget, PLATFORM_LABEL,
  RIGHTS_LABEL, RIGHTS_WARNING, type Rights,
  type Asset, type CalendarItem, type Group, type Post, type Target,
} from '../api'
import { linkOk, LINK_EXAMPLE, manualTexts } from '../manual'
import { PlatformLogo } from '../components/PlatformLogo'
import { GroupDot, Icon, Msg, Sheet } from '../components/ui'
import { fmtDateTime, fmtDuration, fmtTime, num, short, toLocalInput } from '../format'
import { useSession } from '../session'
import { t } from '../i18n'

export interface Group_ { key: string; items: CalendarItem[]; at: string; title: string | null }
type State = 'done' | 'planned' | 'failed'
// Brouillon TikTok (INBOX) : reste « à faire » tant qu'il n'est pas publié dans l'app.
const isPlanned = (i: CalendarItem) => i.kind === 'target' && i.status !== 'PUBLISHED'
export const stateOf = (i: CalendarItem): State => (i.kind === 'video' ? 'done' : i.status === 'FAILED' ? 'failed' : isPlanned(i) ? 'planned' : 'done')
const STATE_LABEL: Record<State, string> = { done: 'Publiée', planned: 'Programmée', failed: 'Échec' }

/** Titre lisible : 1re ligne, sans les hashtags de fin, 80 caractères au plus. */
export function shortTitle(t: string | null | undefined): string {
  const first = (t || '').split('\n').map(x => x.trim()).find(Boolean) || ''
  const clean = first.replace(/(\s#[^\s#]+)+\s*$/, '').trim() || first
  return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean
}

/** Couleur du groupe des comptes de la publication (le 1er groupe trouvé). */
export function useGroupOf() {
  const { groups } = useSession()
  return (items: CalendarItem[]): Group | null =>
    groups.find(g => items.some(i => g.accounts.some(a => a.platform === i.platform && a.id === i.account_id))) || null
}

export function PlanRow({ g, group, onOpen }: { g: Group_; group: Group | null; onOpen: (g: Group_) => void }) {
  const states = g.items.map(stateOf)
  const failed = states.filter(s => s === 'failed').length
  const planned = states.every(s => s === 'planned')
  const views = g.items.reduce((s, i) => s + (i.kind === 'video' ? i.views || 0 : 0), 0)
  const title = shortTitle(g.title) || t('Sans titre')
  const risky = g.items.some(i => i.kind === 'target' && (i.rights === 'protected' || i.rights === 'unknown'))
  return (
    <button type="button" className="prow" onClick={() => onOpen(g)}
            style={{ borderLeftColor: group ? `var(--g-${group.color || 'slate'})` : 'var(--border)' }}
            aria-label={`${fmtTime(g.at)}, ${title}${group ? `, ${t('groupe {name}', { name: group.name })}` : ''} : ${g.items.map((i, n) => `${PLATFORM_LABEL[i.platform]} ${t(STATE_LABEL[states[n]]).toLowerCase()}`).join(', ')}`}>
      <span className="prow-time">{fmtTime(g.at)}</span>
      <span className="prow-main">
        <span className="prow-title">{risky && <span role="img" aria-label={t('Œuvre protégée')} title={t('Œuvre protégée : risque de réclamation de droits d’auteur')}>⚠️ </span>}{title}</span>
        <span className="prow-plats" aria-hidden="true">
          {g.items.map((i, n) => <span key={`${i.kind}-${i.id}`} className={`ppill ${states[n]}`}><PlatformLogo platform={i.platform} size={14} /></span>)}
        </span>
      </span>
      <span className={`prow-side${failed ? ' err' : ''}`}>
        {failed ? (failed > 1 ? t('{n} échecs', { n: failed }) : t('{n} échec', { n: failed })) : planned ? t('programmée') : views ? t('{n} vues', { n: short(views) }) : ''}
      </span>
    </button>
  )
}

const HASHTAG = /#[^\s#.,;!?]+/g

function PlatformCard({ item, common, open, onToggle, onChanged, targets = [] }: {
  item: CalendarItem; common: string; open: boolean; onToggle: () => void; onChanged: () => void; targets?: Target[]
}) {
  const st = stateOf(item)
  const inbox = item.kind === 'target' && item.status === 'INBOX'
  // Cible publiée derrière la carte (vidéo relevée : retrouvée dans la publication) : son lien se corrige.
  const published = item.kind === 'target' ? (item.status === 'PUBLISHED' ? item : null)
    : targets.find(x => x.status === 'PUBLISHED' && x.platform === item.platform && x.account_id === item.account_id && x.external_id === item.external_id) || null
  const [editing, setEditing] = useState(false)
  const [manual, setManual] = useState(false)
  const [linkEdit, setLinkEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const act = async (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    setErr(''); setBusy(true)
    try { await fn(); onChanged() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const o = item.kind === 'target' ? item.options || {} : {}
  // Seulement ce qui diffère du commun.
  const diffs: [string, string][] = []
  if (item.kind === 'target') {
    const own = item.platform === 'instagram' ? o.caption : item.platform === 'tiktok' ? o.title : o.description
    if (own && item.status !== 'INBOX' && String(own).trim() !== common.trim()) diffs.push([item.platform === 'youtube' ? t('Description') : t('Légende'), String(own)])
    if (item.platform === 'youtube' && o.title) diffs.push([t('Titre YouTube'), String(o.title)])
    if (item.platform === 'youtube' && Array.isArray(o.tags) && o.tags.length) diffs.push([t('Tags'), o.tags.join(', ')])
    if (item.platform === 'youtube' && o.privacy_status) diffs.push([t('Visibilité'), `${o.privacy_status === 'public' ? t('Publique') : o.privacy_status === 'unlisted' ? t('Non répertoriée') : t('Privée')}${o.made_for_kids ? ` · ${t('pour enfants')}` : ''}`])
    if (item.platform === 'tiktok' && o.mode === 'draft' && item.status !== 'INBOX') diffs.push([t('Envoi'), t('Brouillon dans l’app TikTok')])
    if (item.platform === 'instagram' && Array.isArray(o.collaborators) && o.collaborators.length) diffs.push([t('Collaborateurs'), o.collaborators.map((c: string) => `@${c}`).join(', ')])
  }
  const url = item.kind === 'video' ? item.url : item.url
  const when = item.kind === 'target' ? (item.published_at || item.scheduled_at) : item.at
  return (
    <div className={`pcard ${st}`}>
      <button type="button" className="pcard-head" aria-expanded={open} onClick={onToggle}>
        <PlatformLogo platform={item.platform} size={22} />
        <span className="grow col" style={{ minWidth: 0, gap: 0, textAlign: 'left' }}>
          <span className="strong">{PLATFORM_LABEL[item.platform]}</span>
          <span className="small muted ellipsis">{item.account_name} · {inbox ? t('brouillon envoyé {date}', { date: fmtDateTime(when) }) : st === 'planned' ? t('prévue {date}', { date: fmtDateTime(when) }) : t('publiée {date}', { date: fmtDateTime(when) })}</span>
        </span>
        <span className={`small strong pstate ${st}`}>{inbox ? t('À publier dans l’app') : t(STATE_LABEL[st])}</span>
        <Icon name="down" size={16} />
      </button>
      {item.kind === 'target' && item.status === 'FAILED' && item.error_message && <p className="pcard-err">{item.error_message}</p>}
      {open && (
        <div className="pcard-body">
          {item.kind === 'target' && item.notice && <Msg>{item.notice}</Msg>}
          {url && <a className="linkbtn" href={url} target="_blank" rel="noreferrer">{t('Voir sur {platform}', { platform: PLATFORM_LABEL[item.platform] })} <Icon name="external" size={14} /></a>}
          {diffs.length > 0 ? (
            <dl className="rx-dl pdl">{diffs.flatMap(([k, v]) => [<dt key={`${k}t`}>{k}</dt>, <dd key={`${k}d`} className="clamp3" style={{ whiteSpace: 'pre-wrap' }}>{v}</dd>])}</dl>
          ) : item.kind === 'target' ? <p className="small muted" style={{ margin: 0 }}>{t('Rien de propre à {platform} : texte commun.', { platform: PLATFORM_LABEL[item.platform] })}</p> : null}
          {item.kind === 'video' && (
            <div className="row small" style={{ gap: 14 }}>
              <span><b>{num(item.views)}</b> {t('vues')}</span><span><b>{num(item.likes)}</b> {t('j’aime')}</span>
              {item.comments != null && <span><b>{num(item.comments)}</b> {t('comm.')}</span>}
              {item.shares != null && <span><b>{num(item.shares)}</b> {t('partages')}</span>}
              {item.saves != null && <span><b>{num(item.saves)}</b> {t('enreg.')}</span>}
            </div>
          )}
          {err && <Msg kind="err">{err}</Msg>}
          {item.kind === 'target' && editing && <EditInline item={item} onDone={() => { setEditing(false); onChanged() }} onCancel={() => setEditing(false)} />}
          {item.kind === 'target' && !editing && (inbox || item.status === 'FAILED' || (item.status === 'SCHEDULED' && manual)) && (
            <ManualBox item={item} common={common} busy={busy} act={act} onClose={item.status === 'SCHEDULED' ? () => setManual(false) : undefined} />
          )}
          {published && (linkEdit
            ? <LinkEdit target={published} busy={busy} act={act} onDone={() => setLinkEdit(false)} />
            : <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start', minHeight: 32 }} disabled={busy} onClick={() => setLinkEdit(true)}>
                {published.url ? t('Modifier le lien') : t('Ajouter le lien')}
              </button>)}
          {item.kind === 'target' && !editing && !inbox && (
            <div className="row" style={{ gap: 8 }}>
              {item.status === 'SCHEDULED' && !manual && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setManual(true)}>{t('Publier moi-même')}</button>}
              {item.status === 'SCHEDULED' && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)}>{t('Changer l’heure ou le texte')}</button>}
              {item.status === 'SCHEDULED' && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act(() => publishNow(item.id), t('Publier maintenant sur {platform} ?', { platform: PLATFORM_LABEL[item.platform] }))}>{t('Publier maintenant')}</button>}
              {item.can_retry && <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(() => retryTarget(item.id))}>{t('Réessayer')}</button>}
              {item.can_edit && <button type="button" className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={() => act(() => cancelTarget(item.id), t('Annuler la publication sur {platform} ?', { platform: PLATFORM_LABEL[item.platform] }))}>{t('Annuler')}</button>}
              {!item.can_edit && item.can_cancel && <button type="button" className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={() => act(() => cancelTarget(item.id), t('Retirer cette publication en échec sur {platform} du planning ? Vous pourrez rajouter la plateforme ensuite.', { platform: PLATFORM_LABEL[item.platform] }))}>{t('Retirer')}</button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Publier soi-même : textes à copier, « Publié dans l'app » (lien facultatif). Brouillon TikTok (arrivé sans
 *  légende) : aussi « Renvoyer le brouillon » et « Retirer ». Publication ratée : ouvert d'office ; prévue : derrière
 *  « Publier moi-même » (la publication prévue est alors retirée, rien ne part en double). */
function ManualBox({ item, common, busy, act, onClose }: {
  item: Extract<CalendarItem, { kind: 'target' }>; common: string; busy: boolean; onClose?: () => void
  act: (fn: () => Promise<unknown>, confirmText?: string) => Promise<void>
}) {
  const inbox = item.status === 'INBOX'
  const name = PLATFORM_LABEL[item.platform]
  const texts = manualTexts(item, common)
  const [copied, setCopied] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [link, setLink] = useState('')
  const ok = linkOk(item.platform, link)
  const copy = async (k: string, v: string) => {
    try { await navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(null), 2000) } catch { /* presse-papiers refusé */ }
  }
  const done = (url?: string) => (inbox ? markPublished(item.id, url) : publishedByHand(item.id, url))
  return (
    <div className="col" style={{ gap: 10 }}>
      {inbox
        ? <p className="small" style={{ margin: 0 }}>{t('La vidéo est dans vos brouillons TikTok,')} <b>{t('sans légende')}</b>{t(' : ouvrez l’app, collez la légende, publiez, puis revenez ici.')}</p>
        : <p className="small" style={{ margin: 0 }}>{t('Copiez le texte, publiez la vidéo vous-même dans {name}, puis revenez ici.', { name })}</p>}
      {texts.map(([k, v]) => (
        <div key={k} className="col" style={{ gap: 6 }}>
          <span className="tiny muted">{t(k)}</span>
          <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'var(--bg)', borderRadius: 10, padding: '10px 12px' }}>{v}</p>
          <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => copy(k, v)} aria-live="polite" aria-label={t('Copier : {what}', { what: t(k) })}>
            <Icon name="check" size={14} />{copied === k ? t('Copié') : t('Copier')}
          </button>
        </div>
      ))}
      {asking ? (
        <form className="col" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); if (ok) act(() => done(link.trim() || undefined)) }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="small">{t('Lien de la vidéo {name}', { name })} <span className="muted">{t('(facultatif)')}</span></span>
            <input className="input" type="url" inputMode="url" placeholder={LINK_EXAMPLE[item.platform] ?? 'https://…'} value={link} onChange={e => setLink(e.target.value)}
              aria-invalid={!ok} />
          </label>
          {!ok && <span className="small" style={{ color: 'var(--danger)' }}>{t('Collez un lien {name} (ou laissez vide).', { name })}</span>}
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !ok}>{t('Marquer publiée')}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAsking(false)}>{t('Annuler')}</button>
          </div>
        </form>
      ) : (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => setAsking(true)}>{t('Publié dans l’app')}</button>
            {inbox && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act(() => resendDraft(item.id), t('Renvoyer la vidéo dans vos brouillons TikTok ? (à faire seulement si le brouillon a été supprimé)'))}>{t('Renvoyer le brouillon')}</button>}
            {inbox && <button type="button" className="btn btn-sm btn-ghost btn-danger" disabled={busy}
                    onClick={() => act(() => cancelTarget(item.id), t('Retirer ce brouillon du planning ? Il reste dans vos brouillons TikTok : supprimez-le vous-même dans l’app.'))}>{t('Retirer')}</button>}
            {onClose && <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('Fermer')}</button>}
          </div>
          {item.status === 'SCHEDULED' && <p className="tiny muted" style={{ margin: 0 }}>{t('« Publié dans l’app » : collez le lien si vous l’avez. La publication prévue est alors retirée, rien ne partira en double.')}</p>}
        </>
      )}
    </div>
  )
}

/** Lien d'une publication publiée, corrigé ou retiré (vide). */
function LinkEdit({ target, busy, act, onDone }: {
  target: Target; busy: boolean; onDone: () => void
  act: (fn: () => Promise<unknown>, confirmText?: string) => Promise<void>
}) {
  const name = PLATFORM_LABEL[target.platform]
  const [link, setLink] = useState(target.url || '')
  const ok = linkOk(target.platform, link)
  return (
    <form className="col" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); if (ok) act(async () => { await fixLink(target.id, link.trim()); onDone() }) }}>
      <label className="col" style={{ gap: 4 }}>
        <span className="small">{t('Lien de la vidéo {name}', { name })} <span className="muted">{t('(vide pour le retirer)')}</span></span>
        <input className="input" type="url" inputMode="url" placeholder={LINK_EXAMPLE[target.platform] ?? 'https://…'} value={link} onChange={e => setLink(e.target.value)} aria-invalid={!ok} autoFocus />
      </label>
      {!ok && <span className="small" style={{ color: 'var(--danger)' }}>{t('Collez un lien {name} (ou laissez vide).', { name })}</span>}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !ok}>{t('Enregistrer le lien')}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>{t('Annuler')}</button>
      </div>
    </form>
  )
}

/** Droits d'auteur de l'œuvre : bandeau d'avertissement (protégée ou inconnue) et réglage. */
function RightsBox({ post, onSaved }: { post: Post; onSaved: (p: Post) => void }) {
  const [editing, setEditing] = useState(false)
  const [rights, setRights] = useState<Rights>(post.rights || 'unknown')
  const [note, setNote] = useState(post.rights_note || '')
  const [err, setErr] = useState('')
  const risky = post.rights === 'protected' || post.rights === 'unknown'
  const save = async () => {
    setErr('')
    try { onSaved({ ...(await patchPost(post.id, { rights, rights_note: note })) }); setEditing(false) } catch (e) { setErr((e as Error).message) }
  }
  return (
    <section className="col" style={{ gap: 8 }} aria-label={t('Droits d’auteur')}>
      {risky && <div role="alert" className="msg msg-warn" style={{ margin: 0 }}>{t(RIGHTS_WARNING)}</div>}
      {!editing ? (
        <div className="row small" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted">{t('Droits :')}</span>
          <b>{post.rights ? t(RIGHTS_LABEL[post.rights]) : t('Non précisés')}</b>
          {post.rights_note && <span className="muted ellipsis" style={{ minWidth: 0 }}>· {post.rights_note}</span>}
          <button type="button" className="linkbtn" onClick={() => setEditing(true)}>{t('Modifier')}</button>
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <div className="seg" role="radiogroup" aria-label={t('Droits d’auteur')}>
            {(['public_domain', 'protected', 'unknown'] as Rights[]).map(r => (
              <button key={r} type="button" role="radio" aria-checked={rights === r} aria-pressed={rights === r} onClick={() => setRights(r)}>{t(RIGHTS_LABEL[r])}</button>
            ))}
          </div>
          <input className="input" value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder={t('Note (ex. reprise — Wicked, Stephen Schwartz)')} aria-label={t('Note sur les droits')} />
          {err && <Msg kind="err">{err}</Msg>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={save}>{t('Enregistrer')}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>{t('Annuler')}</button>
          </div>
        </div>
      )}
    </section>
  )
}

function EditInline({ item, onDone, onCancel }: { item: Extract<CalendarItem, { kind: 'target' }>; onDone: () => void; onCancel: () => void }) {
  const [when, setWhen] = useState(toLocalInput(new Date(item.scheduled_at)))
  const key = item.platform === 'instagram' ? 'caption' : 'title'
  const [text, setText] = useState<string>(item.options[key] ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const editText = !(item.platform === 'tiktok' && item.options.mode === 'draft')
  const save = async () => {
    setBusy(true); setErr('')
    try { await patchTarget(item.id, { scheduled_at: new Date(when).toISOString(), ...(editText ? { options: { [key]: text } } : {}) }); onDone() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="col" style={{ gap: 10 }}>
      <label className="field">{t('Date et heure')}<input className="input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></label>
      {editText && (
        <label className="field">{item.platform === 'youtube' ? t('Titre YouTube') : t('Légende')}
          {item.platform === 'youtube' ? <input className="input" value={text} maxLength={100} onChange={e => setText(e.target.value)} />
            : <textarea className="textarea" value={text} onChange={e => setText(e.target.value)} />}
        </label>
      )}
      {err && <Msg kind="err">{err}</Msg>}
      <div className="row-nw" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm" onClick={onCancel}>{t('Annuler')}</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>{t('Enregistrer')}</button>
      </div>
    </div>
  )
}

export function PublicationSheet({ g, group, onClose, onChanged }: { g: Group_; group: Group | null; onClose: () => void; onChanged: () => void }) {
  const postId = (g.items.find(i => i.kind === 'target') as Extract<CalendarItem, { kind: 'target' }> | undefined)?.post_id
  const [post, setPost] = useState<Post | null>(null)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(() => {
    const f = g.items.find(i => stateOf(i) === 'failed') || (g.items.length === 1 ? g.items[0] : null)
    return f ? `${f.kind}-${f.id}` : null
  })
  const [more, setMore] = useState(false)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!postId) return
    getPost(postId).then(p => {
      setPost(p)
      const assetId = (p as Post & { asset_id?: number | null }).asset_id
      if (assetId) getAsset(p.org_id ?? null, assetId).then(setAsset).catch(() => {})
    }).catch(() => {})
  }, [postId]) // eslint-disable-line react-hooks/exhaustive-deps
  const video = g.items.find(i => i.kind === 'video') as Extract<CalendarItem, { kind: 'video' }> | undefined
  const common = post?.caption || video?.title || ''
  const title = shortTitle(post?.title || g.title) || t('Sans titre')
  const tags = [...new Set(common.match(HASHTAG) || [])]
  const body = common.replace(HASHTAG, '').replace(/\n{3,}/g, '\n\n').trim()
  const duration = post?.duration_sec ?? video?.duration_sec ?? null
  const thumb = video?.thumbnail_url || asset?.thumbnail || null
  const stream = asset?.stream || (post?.status === 'READY' ? `/api/cm/posts/${post.id}/video` : null)
  // Miniature choisie (couverture envoyée, ou image de la vidéo à l'instant choisi) ; sinon celle de la plateforme.
  const chosen = postId ? `/api/cm/posts/${postId}/thumbnail` : null
  const [chosenOk, setChosenOk] = useState<boolean | null>(null)
  const poster = chosen && chosenOk !== false ? chosen : thumb
  const openPlayer = () => {
    if (!stream) { if (video?.url) window.open(video.url, '_blank', 'noopener'); return }
    setPlaying(true)
    document.documentElement.requestFullscreen?.().catch(() => {})
  }
  const closePlayer = () => {
    setPlaying(false)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }
  const fiche = g.items.find(i => i.kind === 'video')
  return (
    <Sheet title={<span className="sr-only">{t('Publication')}</span>} onClose={onClose}>
      <div className="pub" style={group ? { ['--gcolor' as string]: `var(--g-${group.color || 'slate'})` } : undefined}>
        {group && <span className="pub-stripe" aria-hidden="true" />}
        <div className="pub-head">
          <button type="button" className="pub-media" aria-label={stream ? t('Lire la vidéo en plein écran') : video?.url ? t('Voir la vidéo sur la plateforme') : t('Aperçu indisponible')}
                  onClick={openPlayer}>
            {poster && <img src={poster} alt={t('Miniature')} className="pub-poster"
                            onLoad={() => { if (poster === chosen) setChosenOk(true) }} onError={() => { if (poster === chosen) setChosenOk(false) }} />}
            {(stream || video?.url) && <span className="pub-play" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg></span>}
          </button>
          {playing && stream && createPortal(
            <div className="vfull" role="dialog" aria-modal="true" aria-label={t('Vidéo')} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); closePlayer() } }}>
              <video src={stream} poster={poster || undefined} controls autoPlay playsInline />
              <button type="button" className="vfull-x" aria-label={t('Fermer')} onClick={closePlayer} autoFocus><Icon name="close" size={22} /></button>
            </div>, document.body)}
          <div className="col" style={{ gap: 6, minWidth: 0 }}>
            {group && <span className="row-nw tiny strong" style={{ gap: 6 }}><GroupDot color={group.color} />{group.name}</span>}
            <h2 className="pub-title">{title}</h2>
            <span className="small muted">{fmtDateTime(g.at)}{duration ? ` · ${fmtDuration(duration)}` : ''}</span>
            {fiche && <Link className="linkbtn" to={`/videos/${fiche.id}`}>{t('Fiche vidéo : stats et commentaires')}</Link>}
            {asset?.folder_url && <a className="linkbtn muted" href={asset.folder_url} target="_blank" rel="noreferrer">{t('Dossier Drive')}</a>}
          </div>
        </div>
        <div className="row-nw" style={{ gap: 8 }}>
          {post?.status === 'READY'
            ? <a className="btn btn-sm" style={{ flex: 1 }} href={`/api/cm/posts/${post.id}/video`} download><Icon name="download" />{t('Télécharger la vidéo')}</a>
            : <button type="button" className="btn btn-sm" style={{ flex: 1 }} disabled><Icon name="download" />{t('Télécharger la vidéo')}</button>}
          {chosen && chosenOk
            ? <a className="btn btn-sm" style={{ flex: 1 }} href={chosen} download><Icon name="download" />{t('Télécharger la miniature')}</a>
            : thumb
              ? <a className="btn btn-sm" style={{ flex: 1 }} href={thumb} target="_blank" rel="noreferrer" download><Icon name="download" />{t('Télécharger la miniature')}</a>
              : <button type="button" className="btn btn-sm" style={{ flex: 1 }} disabled><Icon name="download" />{t('Télécharger la miniature')}</button>}
        </div>

        {post && <RightsBox post={post} onSaved={p => { setPost(p); onChanged() }} />}

        {((body && shortTitle(body) !== title) || tags.length > 0) && (
          <section className="col" style={{ gap: 6 }} aria-labelledby="pub-common">
            <h3 id="pub-common" className="rx-h">{t('Commun à toutes les plateformes')}</h3>
            {body && shortTitle(body) !== title && <p className={`small${more ? '' : ' clamp3'}`} style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-2, inherit)' }}>{body}</p>}
            {body.length > 180 && <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start', minHeight: 32 }} onClick={() => setMore(m => !m)}>{more ? t('Voir moins') : t('Voir plus')}</button>}
            {tags.length > 0 && <div className="tags-line" aria-label={t('Hashtags')}>{tags.map(tag => <span key={tag} className="chip chip-sm">{tag}</span>)}</div>}
          </section>
        )}

        <section className="col" style={{ gap: 10 }} aria-labelledby="pub-plats">
          <h3 id="pub-plats" className="rx-h">{t('Plateformes')}</h3>
          {g.items.map(i => {
            const k = `${i.kind}-${i.id}`
            return <PlatformCard key={k} item={i} common={common} open={openKey === k} onToggle={() => setOpenKey(openKey === k ? null : k)} onChanged={onChanged} targets={post?.targets} />
          })}
        </section>
        <p className="tiny muted" style={{ margin: 0 }}>{t('Trait plein : publiée · pointillé : programmée · rouge : échec.')}</p>
      </div>
    </Sheet>
  )
}
