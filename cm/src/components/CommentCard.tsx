// Un commentaire (page Commentaires, fiche vidéo). Sobre : avatar, @pseudo, plateforme et heure,
// le texte ; une action visible (Répondre, et Réponse privée sur Instagram), le reste dans « … ».
// La réponse s'ouvre sous le commentaire ; envoyée, elle s'affiche en bulle « Vous ».
import { useEffect, useRef, useState } from 'react'
import { ApiError, commentAction, PLATFORM_LABEL, type Comment } from '../api'
import { fmtAgo } from '../format'
import { useSession } from '../session'
import { Icon, Msg } from './ui'

const TINTS = [['#DBEAFE', '#1E3A8A'], ['#FFEDD5', '#9A3412'], ['#DCFCE7', '#166534'], ['#F3E8FF', '#6B21A8'], ['#FCE7F3', '#9D174D']]
function tint(name: string | null) {
  let h = 0
  for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
}
const errText = (e: unknown) => (e as ApiError)?.data?.message || (e as Error)?.message || 'Erreur'
const STATUS_LABEL: Record<string, string> = { replied: 'Répondu', contacted: 'Contacté', hidden: 'Masqué', ignored: 'Traité' }

function MoreMenu({ items }: { items: { label: string; onClick?: () => void; href?: string; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  if (!items.length) return null
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button type="button" className="btn btn-ghost icon-btn" aria-label="Plus d’actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <div className="menu-pop" role="menu" style={{ right: 0, left: 'auto', minWidth: 220 }}>
          {items.map(it => it.href
            ? <a key={it.label} className="menu-item" role="menuitem" href={it.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>{it.label}</a>
            : <button key={it.label} type="button" className="menu-item" role="menuitem" style={it.danger ? { color: 'var(--danger, #B91C1C)' } : undefined}
                      onClick={() => { setOpen(false); it.onClick?.() }}>{it.label}</button>)}
        </div>
      )}
    </div>
  )
}

export function CommentCard({ c, onChanged, canEdit, template }:
  { c: Comment; onChanged: (c: Comment | null) => void; canEdit: boolean; template?: string }) {
  const { org } = useSession()
  const [mode, setMode] = useState<'reply' | 'private' | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const keyword = template !== undefined
  const personal = (template || '').replace(/\{pseudo\}/g, c.author ? `@${c.author}` : '')
  const canPrivate = c.can_private_reply ?? (c.platform === 'instagram' && !c.private_replied_at)
  const [bg, fg] = tint(c.author)
  const run = async (fn: () => Promise<Comment>) => {
    setBusy(true); setErr('')
    try { onChanged(await fn()); setMode(null); setText('') } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(personal); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }
    catch { setErr('Copie impossible : sélectionnez le message à la main.') }
  }
  const more = [
    ...(c.status === 'new' && c.platform !== 'tiktok' ? [{ label: 'Masquer le commentaire', danger: true, onClick: () => { if (window.confirm('Masquer ce commentaire pour tout le monde ?')) run(() => commentAction(org, c.id, 'hide')) } }] : []),
    ...(c.status === 'new' ? [{ label: keyword ? 'Marquer comme contacté' : 'Marquer comme traité', onClick: () => run(() => commentAction(org, c.id, keyword ? 'contacted' : 'ignore')) }] : []),
    ...(c.status !== 'new' ? [{ label: 'Remettre à traiter', onClick: () => run(() => commentAction(org, c.id, 'reopen')) }] : []),
    ...(c.profile_url ? [{ label: 'Ouvrir le profil', href: c.profile_url }] : []),
  ]
  return (
    <article className="ccard">
      <span className="ccard-av" aria-hidden="true" style={{ background: bg, color: fg }}>{(c.author || '?').replace('@', '').slice(0, 1).toUpperCase()}</span>
      <div className="ccard-body">
        <div className="ccard-head">
          {c.profile_url ? <a className="strong" href={c.profile_url} target="_blank" rel="noreferrer">@{c.author}</a> : <span className="strong">{c.author || 'Anonyme'}</span>}
          <span className="muted">{PLATFORM_LABEL[c.platform]} · {fmtAgo(c.published_at)}{c.count && c.count > 1 ? ` · ${c.count} commentaires` : ''}</span>
        </div>
        <p className="ccard-text">{c.text}</p>
        {c.reply_text && <div className="ccard-reply"><b>Vous</b><span>{c.reply_text}</span></div>}
        {c.status !== 'new' && STATUS_LABEL[c.status] && !c.pending && <span className="tiny" style={{ color: 'var(--ok, #166534)' }}>{STATUS_LABEL[c.status]}</span>}
        {c.pending && <span className="tiny muted">Envoi en cours par la routine…</span>}
        {c.error && <Msg kind="err">{c.error}</Msg>}
        {err && <Msg kind="err">{err}</Msg>}
        {canEdit && !c.pending && (
          <div className="ccard-actions">
            {c.platform !== 'tiktok' && c.status !== 'replied' && !keyword &&
              <button type="button" className="linkbtn" aria-expanded={mode === 'reply'} onClick={() => { setMode(mode === 'reply' ? null : 'reply'); setText('') }}>Répondre</button>}
            {canPrivate && c.status !== 'contacted' &&
              <button type="button" className={keyword ? 'linkbtn' : 'linkbtn muted'} aria-expanded={mode === 'private'} onClick={() => { setMode(mode === 'private' ? null : 'private'); setText(personal) }}>Réponse privée</button>}
            {c.platform === 'tiktok' && c.video_url && <a className="linkbtn muted" href={c.video_url} target="_blank" rel="noreferrer">Répondre dans TikTok</a>}
            {keyword && <button type="button" className="linkbtn muted" onClick={copy}>{copied ? 'Copié ✓' : 'Copier le message'}</button>}
            {keyword && c.dm_url && <a className="linkbtn muted" href={c.dm_url} target="_blank" rel="noreferrer">Écrire sur Instagram</a>}
            <span className="grow" />
            <MoreMenu items={more} />
          </div>
        )}
        {mode && (
          <form className="col" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); run(() => commentAction(org, c.id, mode === 'reply' ? 'reply' : 'private-reply', text.trim())) }}>
            <label className="sr-only" htmlFor={`r${c.id}`}>{mode === 'reply' ? 'Votre réponse' : 'Message privé'}</label>
            <textarea id={`r${c.id}`} className="input" rows={3} value={text} onChange={e => setText(e.target.value)} maxLength={2200} autoFocus
                      placeholder={mode === 'reply' ? `Votre réponse à @${c.author || ''}` : 'Message privé (une fois, dans les 7 jours)'} />
            <div className="row-nw" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Annuler</button>
              <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>{mode === 'reply' ? 'Publier' : 'Envoyer en privé'}</button>
            </div>
          </form>
        )}
      </div>
    </article>
  )
}

/** Regroupe une liste de commentaires par vidéo (en gardant l'ordre). */
export function byVideo(items: Comment[]) {
  const groups: { key: string; title: string | null; thumb: string | null; videoId: number | null; url: string | null; items: Comment[] }[] = []
  const at = new Map<string, number>()
  for (const c of items) {
    const key = `${c.platform}:${c.account_id}:${c.media_id || '?'}`
    let i = at.get(key)
    if (i === undefined) {
      i = groups.length; at.set(key, i)
      groups.push({ key, title: c.video_title, thumb: c.video_thumb || null, videoId: c.video_id ?? null, url: c.video_url, items: [] })
    }
    groups[i].items.push(c)
  }
  return groups
}
