// Planning : une ligne par vidéo et UNE fenêtre de publication (maquette Claude Design, itération 3).
// Ligne : heure, titre court, logos des plateformes (plein = publiée, pointillé = programmée, rouge = échec),
// bordure gauche à la couleur du groupe. Fenêtre : média 9:16 (lit la vidéo), titre en gros, commun à
// toutes les plateformes (légende petite et repliable, hashtags), puis une carte par plateforme qui se déplie
// sur place : seulement ce qui diffère, ses chiffres, le lien de la publication et ses actions.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  cancelTarget, getAsset, getPost, patchTarget, publishNow, retryTarget, PLATFORM_LABEL,
  type Asset, type CalendarItem, type Group, type Post,
} from '../api'
import { PlatformLogo } from '../components/PlatformLogo'
import { GroupDot, Icon, Msg, Sheet } from '../components/ui'
import { fmtDateTime, fmtDuration, fmtTime, num, short, toLocalInput } from '../format'
import { useSession } from '../session'

export interface Group_ { key: string; items: CalendarItem[]; at: string; title: string | null }
type State = 'done' | 'planned' | 'failed'
const isPlanned = (i: CalendarItem) => i.kind === 'target' && i.status !== 'PUBLISHED' && i.status !== 'INBOX'
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
  const title = shortTitle(g.title) || 'Sans titre'
  return (
    <button type="button" className="prow" onClick={() => onOpen(g)}
            style={{ borderLeftColor: group ? `var(--g-${group.color || 'slate'})` : 'var(--border)' }}
            aria-label={`${fmtTime(g.at)}, ${title}${group ? `, groupe ${group.name}` : ''} : ${g.items.map((i, n) => `${PLATFORM_LABEL[i.platform]} ${STATE_LABEL[states[n]].toLowerCase()}`).join(', ')}`}>
      <span className="prow-time">{fmtTime(g.at)}</span>
      <span className="prow-main">
        <span className="prow-title">{title}</span>
        <span className="prow-plats" aria-hidden="true">
          {g.items.map((i, n) => <span key={`${i.kind}-${i.id}`} className={`ppill ${states[n]}`}><PlatformLogo platform={i.platform} size={14} /></span>)}
        </span>
      </span>
      <span className={`prow-side${failed ? ' err' : ''}`}>
        {failed ? `${failed} échec${failed > 1 ? 's' : ''}` : planned ? 'programmée' : views ? `${short(views)} vues` : ''}
      </span>
    </button>
  )
}

const HASHTAG = /#[^\s#.,;!?]+/g

function PlatformCard({ item, common, open, onToggle, onChanged }: {
  item: CalendarItem; common: string; open: boolean; onToggle: () => void; onChanged: () => void
}) {
  const st = stateOf(item)
  const [editing, setEditing] = useState(false)
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
    if (own && String(own).trim() !== common.trim()) diffs.push([item.platform === 'youtube' ? 'Description' : 'Légende', String(own)])
    if (item.platform === 'youtube' && o.title) diffs.push(['Titre YouTube', String(o.title)])
    if (item.platform === 'youtube' && Array.isArray(o.tags) && o.tags.length) diffs.push(['Tags', o.tags.join(', ')])
    if (item.platform === 'youtube' && o.privacy_status) diffs.push(['Visibilité', `${o.privacy_status === 'public' ? 'Publique' : o.privacy_status === 'unlisted' ? 'Non répertoriée' : 'Privée'}${o.made_for_kids ? ' · pour enfants' : ''}`])
    if (item.platform === 'tiktok' && o.mode === 'draft') diffs.push(['Envoi', 'Brouillon dans l’app TikTok'])
    if (item.platform === 'instagram' && Array.isArray(o.collaborators) && o.collaborators.length) diffs.push(['Collaborateurs', o.collaborators.map((c: string) => `@${c}`).join(', ')])
  }
  const url = item.kind === 'video' ? item.url : item.url
  const when = item.kind === 'target' ? (item.published_at || item.scheduled_at) : item.at
  return (
    <div className={`pcard ${st}`}>
      <button type="button" className="pcard-head" aria-expanded={open} onClick={onToggle}>
        <PlatformLogo platform={item.platform} size={22} />
        <span className="grow col" style={{ minWidth: 0, gap: 0, textAlign: 'left' }}>
          <span className="strong">{PLATFORM_LABEL[item.platform]}</span>
          <span className="small muted ellipsis">{item.account_name} · {st === 'planned' ? 'prévue' : 'publiée'} {fmtDateTime(when)}</span>
        </span>
        <span className={`small strong pstate ${st}`}>{STATE_LABEL[st]}</span>
        <Icon name="down" size={16} />
      </button>
      {item.kind === 'target' && item.status === 'FAILED' && item.error_message && <p className="pcard-err">{item.error_message}</p>}
      {open && (
        <div className="pcard-body">
          {item.kind === 'target' && item.notice && <Msg>{item.notice}</Msg>}
          {url && <a className="linkbtn" href={url} target="_blank" rel="noreferrer">Voir sur {PLATFORM_LABEL[item.platform]} <Icon name="external" size={14} /></a>}
          {diffs.length > 0 ? (
            <dl className="rx-dl pdl">{diffs.flatMap(([k, v]) => [<dt key={`${k}t`}>{k}</dt>, <dd key={`${k}d`} className="clamp3" style={{ whiteSpace: 'pre-wrap' }}>{v}</dd>])}</dl>
          ) : item.kind === 'target' ? <p className="small muted" style={{ margin: 0 }}>Rien de propre à {PLATFORM_LABEL[item.platform]} : texte commun.</p> : null}
          {item.kind === 'video' && (
            <div className="row small" style={{ gap: 14 }}>
              <span><b>{num(item.views)}</b> vues</span><span><b>{num(item.likes)}</b> j’aime</span>
              {item.comments != null && <span><b>{num(item.comments)}</b> comm.</span>}
              {item.shares != null && <span><b>{num(item.shares)}</b> partages</span>}
              {item.saves != null && <span><b>{num(item.saves)}</b> enreg.</span>}
            </div>
          )}
          {err && <Msg kind="err">{err}</Msg>}
          {item.kind === 'target' && editing && <EditInline item={item} onDone={() => { setEditing(false); onChanged() }} onCancel={() => setEditing(false)} />}
          {item.kind === 'target' && !editing && (
            <div className="row" style={{ gap: 8 }}>
              {item.status === 'SCHEDULED' && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)}>Changer l’heure ou le texte</button>}
              {item.status === 'SCHEDULED' && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act(() => publishNow(item.id), `Publier maintenant sur ${PLATFORM_LABEL[item.platform]} ?`)}>Publier maintenant</button>}
              {item.can_retry && <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(() => retryTarget(item.id))}>Réessayer</button>}
              {item.can_edit && <button type="button" className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={() => act(() => cancelTarget(item.id), `Annuler la publication sur ${PLATFORM_LABEL[item.platform]} ?`)}>Annuler</button>}
            </div>
          )}
        </div>
      )}
    </div>
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
      <label className="field">Date et heure<input className="input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></label>
      {editText && (
        <label className="field">{item.platform === 'youtube' ? 'Titre YouTube' : 'Légende'}
          {item.platform === 'youtube' ? <input className="input" value={text} maxLength={100} onChange={e => setText(e.target.value)} />
            : <textarea className="textarea" value={text} onChange={e => setText(e.target.value)} />}
        </label>
      )}
      {err && <Msg kind="err">{err}</Msg>}
      <div className="row-nw" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm" onClick={onCancel}>Annuler</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>Enregistrer</button>
      </div>
    </div>
  )
}

export function PublicationSheet({ g, group, onClose, onChanged }: { g: Group_; group: Group | null; onClose: () => void; onChanged: () => void }) {
  const { org } = useSession()
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
      if (assetId) getAsset(org, assetId).then(setAsset).catch(() => {})
    }).catch(() => {})
  }, [postId]) // eslint-disable-line react-hooks/exhaustive-deps
  const video = g.items.find(i => i.kind === 'video') as Extract<CalendarItem, { kind: 'video' }> | undefined
  const common = post?.caption || video?.title || ''
  const title = shortTitle(post?.title || g.title) || 'Sans titre'
  const tags = [...new Set(common.match(HASHTAG) || [])]
  const body = common.replace(HASHTAG, '').replace(/\n{3,}/g, '\n\n').trim()
  const duration = post?.duration_sec ?? video?.duration_sec ?? null
  const thumb = video?.thumbnail_url || asset?.thumbnail || null
  const stream = asset?.stream || null
  const fiche = g.items.find(i => i.kind === 'video')
  return (
    <Sheet title={<span className="sr-only">Publication</span>} onClose={onClose}>
      <div className="pub" style={group ? { ['--gcolor' as string]: `var(--g-${group.color || 'slate'})` } : undefined}>
        {group && <span className="pub-stripe" aria-hidden="true" />}
        <div className="pub-head">
          {playing && stream ? (
            <video className="pub-media" src={stream} poster={thumb || undefined} controls autoPlay playsInline />
          ) : (
            <button type="button" className="pub-media" aria-label={stream ? 'Lire la vidéo' : video?.url ? 'Voir la vidéo sur la plateforme' : 'Aperçu indisponible'}
                    onClick={() => (stream ? setPlaying(true) : video?.url ? window.open(video.url, '_blank', 'noopener') : undefined)}
                    style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
              {(stream || video?.url) && <span className="pub-play" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg></span>}
            </button>
          )}
          <div className="col" style={{ gap: 6, minWidth: 0 }}>
            {group && <span className="row-nw tiny strong" style={{ gap: 6 }}><GroupDot color={group.color} />{group.name}</span>}
            <h2 className="pub-title">{title}</h2>
            <span className="small muted">{fmtDateTime(g.at)}{duration ? ` · ${fmtDuration(duration)}` : ''}</span>
            {fiche && <Link className="linkbtn" to={`/videos/${fiche.id}`}>Fiche vidéo : stats et commentaires</Link>}
            {asset?.folder_url && <a className="linkbtn muted" href={asset.folder_url} target="_blank" rel="noreferrer">Dossier Drive</a>}
          </div>
        </div>

        {((body && shortTitle(body) !== title) || tags.length > 0) && (
          <section className="col" style={{ gap: 6 }} aria-labelledby="pub-common">
            <h3 id="pub-common" className="rx-h">Commun à toutes les plateformes</h3>
            {body && shortTitle(body) !== title && <p className={`small${more ? '' : ' clamp3'}`} style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-2, inherit)' }}>{body}</p>}
            {body.length > 180 && <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start', minHeight: 32 }} onClick={() => setMore(m => !m)}>{more ? 'Voir moins' : 'Voir plus'}</button>}
            {tags.length > 0 && <div className="row" style={{ gap: 6 }}>{tags.map(t => <span key={t} className="chip chip-sm">{t}</span>)}</div>}
          </section>
        )}

        <section className="col" style={{ gap: 10 }} aria-labelledby="pub-plats">
          <h3 id="pub-plats" className="rx-h">Plateformes</h3>
          {g.items.map(i => {
            const k = `${i.kind}-${i.id}`
            return <PlatformCard key={k} item={i} common={common} open={openKey === k} onToggle={() => setOpenKey(openKey === k ? null : k)} onChanged={onChanged} />
          })}
        </section>
        <p className="tiny muted" style={{ margin: 0 }}>Trait plein : publiée · pointillé : programmée · rouge : échec.</p>
      </div>
    </Sheet>
  )
}
