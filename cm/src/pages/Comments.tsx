// Commentaires et messages de tous les comptes, au même endroit. Filtrés par la barre de comptes.
// - À traiter : répondre, réponse privée (Instagram), masquer, ignorer ; recherche et tri par l'API.
// - Mot-clé : ceux qui ont écrit « SHEET » (ou un autre mot), une ligne par personne, pour les
//   contacter : réponse privée quand Instagram le permet, sinon message prêt à copier + profil.
// - Messages : conversations Instagram (fenêtre de 24 h imposée par Instagram).
// Sans la permission de la plateforme, l'écran le dit au lieu d'échouer en silence.
import { useEffect, useState } from 'react'
import {
  ApiError, commentAction, getCommentsPage, getConversation, getConversations, getInboxAccounts, getKeyword, sendDm, syncInbox,
  type Comment, type Conversation, type DmMessage, type InboxAccount,
} from '../api'
import { LiveCount, SearchBox, SortControl, useListState, useMorePages } from '../components/list'
import { PlatformLogo } from '../components/PlatformLogo'
import { Empty, Icon, Msg, Seg, Skeleton } from '../components/ui'
import { fmtDateTime } from '../format'
import { useLoad, useRole, useSession } from '../session'

type Tab = 'todo' | 'keyword' | 'messages'
const STATUS: [string, string][] = [['todo', 'À traiter'], ['replied', 'Répondus'], ['contacted', 'Contactés'], ['hidden', 'Masqués'], ['ignored', 'Ignorés'], ['all', 'Tous']]

function store(key: string, fallback: string): [string, (v: string) => void] {
  let v = fallback
  try { v = localStorage.getItem(key) ?? fallback } catch { /* stockage indisponible */ }
  return [v, (x: string) => { try { localStorage.setItem(key, x) } catch { /* idem */ } }]
}

function errText(e: unknown) {
  const ae = e as ApiError
  return ae?.data?.message || ae?.message || 'Erreur'
}

function CommentItem({ c, onChanged, canEdit, template }: { c: Comment; onChanged: (c: Comment | null) => void; canEdit: boolean; template?: string }) {
  const { org } = useSession()
  const [mode, setMode] = useState<'reply' | 'private' | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const personal = (template || '').replace(/\{pseudo\}/g, c.author ? `@${c.author}` : '')
  const run = async (fn: () => Promise<Comment>) => {
    setBusy(true); setErr('')
    try { onChanged(await fn()); setMode(null); setText('') } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(personal); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { setErr('Copie impossible : sélectionnez le texte.') }
  }
  return (
    <li className="cmt">
      <div className="row-nw" style={{ gap: 8, alignItems: 'baseline', minWidth: 0 }}>
        <PlatformLogo platform={c.platform} size={14} />
        {c.profile_url ? <a className="strong ellipsis" href={c.profile_url} target="_blank" rel="noreferrer">@{c.author}</a>
          : <span className="strong ellipsis">{c.author || 'Anonyme'}</span>}
        {c.count && c.count > 1 && <span className="tiny muted">×{c.count}</span>}
        <span className="grow" />
        <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{c.published_at ? fmtDateTime(c.published_at) : ''}</span>
      </div>
      <p className="cmt-text">{c.text}</p>
      <div className="tiny muted row" style={{ gap: 8 }}>
        <span className="ellipsis" style={{ maxWidth: 220 }}>{c.account_name}</span>
        {c.video_title && (c.video_url ? <a className="ellipsis" style={{ maxWidth: 220 }} href={c.video_url} target="_blank" rel="noreferrer">« {c.video_title} »</a> : <span className="ellipsis">« {c.video_title} »</span>)}
        {c.like_count ? <span><Icon name="heart" size={12} /> {c.like_count}</span> : null}
        {c.parent_id && <span>réponse</span>}
      </div>
      {c.reply_text && <p className="cmt-reply"><Icon name="comment" size={12} /> {c.reply_text}</p>}
      {c.pending && <Msg>Envoi par la routine en cours ({c.pending === 'reply' ? 'réponse' : c.pending === 'hide' ? 'masquage' : 'réponse privée'}).</Msg>}
      {c.error && <Msg kind="err">{c.error}</Msg>}
      {err && <Msg kind="err">{err}</Msg>}
      {canEdit && !c.pending && (
        <div className="row" style={{ gap: 6 }}>
          {c.platform !== 'tiktok' && c.status !== 'replied' && <button type="button" className="btn btn-sm" aria-expanded={mode === 'reply'} onClick={() => { setMode(mode === 'reply' ? null : 'reply'); setText('') }}>Répondre</button>}
          {(c.can_private_reply ?? (c.platform === 'instagram' && !c.private_replied_at)) && (
            <button type="button" className="btn btn-sm" aria-expanded={mode === 'private'} onClick={() => { setMode(mode === 'private' ? null : 'private'); setText(personal) }}>Réponse privée</button>
          )}
          {template !== undefined && <button type="button" className="btn btn-sm btn-ghost" onClick={copy}>{copied ? 'Copié ✓' : 'Copier le message'}</button>}
          {template !== undefined && c.dm_url && <a className="btn btn-sm btn-ghost" href={c.dm_url} target="_blank" rel="noreferrer">Écrire sur Instagram <Icon name="external" size={14} /></a>}
          {c.status === 'new' && template !== undefined && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => commentAction(org, c.id, 'contacted'))}>Fait</button>}
          {c.status === 'new' && template === undefined && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => commentAction(org, c.id, 'ignore'))}>Ignorer</button>}
          {c.status === 'new' && c.platform !== 'tiktok' && template === undefined && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { if (window.confirm('Masquer ce commentaire pour tout le monde ?')) run(() => commentAction(org, c.id, 'hide')) }}>Masquer</button>}
          {c.status !== 'new' && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => commentAction(org, c.id, 'reopen'))}>Remettre à traiter</button>}
        </div>
      )}
      {mode && (
        <form className="col" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); run(() => commentAction(org, c.id, mode === 'reply' ? 'reply' : 'private-reply', text.trim())) }}>
          <label className="sr-only" htmlFor={`r${c.id}`}>{mode === 'reply' ? 'Réponse publique' : 'Message privé'}</label>
          <textarea id={`r${c.id}`} className="input" rows={3} value={text} onChange={e => setText(e.target.value)} maxLength={2200} autoFocus
                    placeholder={mode === 'reply' ? `Répondre à @${c.author || ''}` : 'Message privé (une seule fois, 7 jours au plus après le commentaire)'} />
          <div className="row-nw" style={{ gap: 6 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>{mode === 'reply' ? 'Publier la réponse' : 'Envoyer en privé'}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMode(null)}>Annuler</button>
          </div>
        </form>
      )}
    </li>
  )
}

function Notices({ accounts }: { accounts: InboxAccount[] }) {
  const by = new Map<string, string[]>()
  for (const a of accounts) if (a.notice) by.set(a.notice, [...(by.get(a.notice) || []), a.name || a.platform])
  if (!by.size) return null
  return (
    <details className="card notice">
      <summary className="small strong">{by.size === 1 ? 'Une permission' : 'Des permissions'} en attente pour certains comptes</summary>
      {[...by.entries()].map(([n, names]) => <p key={n} className="small" style={{ margin: '8px 0 0' }}><b>{names.join(', ')}</b> : {n}</p>)}
    </details>
  )
}

function Todo({ canEdit }: { canEdit: boolean }) {
  const { scope } = useSession()
  const [st, setSt] = useState('todo')
  const list = useListState<'recent' | 'likes'>('recent', () => 'desc', 'c')
  const opts = { status: st, q: list.q || undefined, sort: list.sort, order: list.order }
  const first = useLoad(s => getCommentsPage(s, opts), [st, list.q, list.sort, list.order])
  const pages = useMorePages(first.data, cursor => getCommentsPage(scope, { ...opts, cursor }), [scope, st, list.q, list.sort, list.order])
  const [changed, setChanged] = useState<Record<number, Comment | null>>({})
  const items = (pages.items || []).map(c => (c.id in changed ? changed[c.id] : c)).filter(Boolean) as Comment[]
  const shown = st === 'todo' ? items.filter(c => c.status === 'new' || c.pending) : items
  return (
    <>
      <div className="listbar">
        <SearchBox value={list.input} onChange={list.setInput} label="Rechercher (texte, pseudo, vidéo)" />
        <select className="select select-sm" aria-label="Afficher" value={st} onChange={e => setSt(e.target.value)}>
          {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="sortctl"><SortControl list={list} options={[['recent', 'Date'], ['likes', 'J’aime']]} /></span>
      </div>
      <LiveCount n={shown.length} more={!!pages.next} what="commentaires" />
      {first.error && <Msg kind="err">{first.error}</Msg>}
      {!first.data && first.loading && <Skeleton h={90} n={4} />}
      {first.data && shown.length === 0 && (
        <Empty title={st === 'todo' ? 'Rien à traiter' : 'Aucun commentaire'} icon="comment">
          {list.q ? `Rien ne correspond à « ${list.q} ».` : 'Les nouveaux commentaires de vos vidéos arrivent ici.'}
        </Empty>
      )}
      <ul className="list card card-flush list-pad">
        {shown.map(c => <CommentItem key={c.id} c={c} canEdit={canEdit} onChanged={n => setChanged(m => ({ ...m, [c.id]: n }))} />)}
      </ul>
      <div ref={pages.sentinel} />
      {pages.busy && <Skeleton h={70} />}
    </>
  )
}

function Keyword({ canEdit }: { canEdit: boolean }) {
  const [savedWord, saveWord] = store('cm.kw', 'SHEET')
  const [savedTpl, saveTpl] = store('cm.kw.msg', 'Hello {pseudo}! Thanks for your comment 🎹 Here is the sheet: ')
  const [word, setWord] = useState(savedWord)
  const [tpl, setTpl] = useState(savedTpl)
  const [w, setW] = useState(savedWord)
  useEffect(() => { const t = window.setTimeout(() => { setW(word.trim()); saveWord(word.trim()) }, 400); return () => window.clearTimeout(t) }, [word]) // eslint-disable-line react-hooks/exhaustive-deps
  const people = useLoad(s => (w.length >= 2 ? getKeyword(s, w) : Promise.resolve([] as Comment[])), [w])
  const [done, setDone] = useState<number[]>([])
  const rows = (people.data || []).filter(p => !done.includes(p.id))
  return (
    <>
      <div className="card col" style={{ gap: 10 }}>
        <label className="field">Mot écrit en commentaire
          <input className="input" value={word} onChange={e => setWord(e.target.value)} maxLength={40} placeholder="SHEET" />
        </label>
        <label className="field">Message à envoyer ({'{pseudo}'} = la personne)
          <textarea className="input" rows={3} value={tpl} onChange={e => { setTpl(e.target.value); saveTpl(e.target.value) }} maxLength={1000} />
        </label>
        <p className="tiny muted" style={{ margin: 0 }}>
          Instagram ne donne pas la liste des personnes qui aiment un commentaire (seulement leur nombre) : la liste vient de
          celles qui ont <b>écrit</b> le mot. Réponse privée possible 7 jours après le commentaire ; sinon copiez le message et
          ouvrez la conversation Instagram.
        </p>
      </div>
      <LiveCount n={rows.length} what="personnes" />
      {people.loading && !people.data && <Skeleton h={80} n={3} />}
      {people.data && rows.length === 0 && <Empty title="Personne à contacter" icon="check">Aucun nouveau commentaire contenant « {w} ».</Empty>}
      <ul className="list card card-flush list-pad">
        {rows.map(c => <CommentItem key={c.id} c={c} canEdit={canEdit} template={tpl} onChanged={n => { if (!n || n.status !== 'new' || n.private_replied_at) setDone(d => [...d, c.id]) }} />)}
      </ul>
    </>
  )
}

function Messages({ accounts }: { accounts: InboxAccount[] }) {
  const { org } = useSession()
  const ig = accounts.filter(a => a.platform === 'instagram')
  const [acc, setAcc] = useState<number | null>(ig.find(a => a.messages)?.id ?? ig[0]?.id ?? null)
  const current = ig.find(a => a.id === acc)
  const convs = useLoad(() => (current?.messages ? getConversations(org, current.id) : Promise.resolve(null as Conversation[] | null)), [acc, current?.messages])
  const [open, setOpen] = useState<Conversation | null>(null)
  const [thread, setThread] = useState<{ messages: DmMessage[]; can_write: boolean } | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    setThread(null)
    if (open && current) getConversation(org, current.id, open.id).then(setThread).catch(e => setErr(errText(e)))
  }, [open?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ig.length) return <Empty title="Aucun compte Instagram" icon="comment">Les messages privés concernent Instagram.</Empty>
  return (
    <div className="col" style={{ gap: 12 }}>
      {ig.length > 1 && (
        <select className="select" aria-label="Compte Instagram" value={acc ?? ''} onChange={e => { setAcc(Number(e.target.value)); setOpen(null) }}>
          {ig.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      {current && !current.messages && <Msg>{current.source === 'routine' ? 'Les messages de ce compte (géré par la routine) se lisent dans Instagram.' : current.notice}</Msg>}
      {convs.error && <Msg kind="err">{convs.error}</Msg>}
      {current?.messages && !open && (
        <ul className="list card card-flush list-pad">
          {(convs.data || []).map(c => (
            <li key={c.id}>
              <button type="button" className="menu-item grow" style={{ textAlign: 'left' }} onClick={() => setOpen(c)}>
                <span className="grow col" style={{ minWidth: 0, gap: 0 }}>
                  <span className="strong ellipsis">@{c.with}</span>
                  <span className="tiny muted ellipsis">{c.last_from_me ? 'Vous : ' : ''}{c.last}</span>
                </span>
                <Icon name="right" />
              </button>
            </li>
          ))}
          {convs.data && !convs.data.length && <li className="muted small">Aucune conversation.</li>}
        </ul>
      )}
      {open && current && (
        <section className="card col" style={{ gap: 10 }} aria-label={`Conversation avec @${open.with}`}>
          <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(null)}><Icon name="left" />Conversations</button>
          {err && <Msg kind="err">{err}</Msg>}
          {!thread && <Skeleton h={60} n={2} />}
          <div className="dm">
            {(thread?.messages || []).slice().reverse().map(m => <p key={m.id} className={`dm-msg${m.from_me ? ' me' : ''}`}>{m.text}</p>)}
          </div>
          {thread && (thread.can_write ? (
            <form className="row-nw" style={{ gap: 6 }} onSubmit={async e => {
              e.preventDefault(); setErr('')
              try { await sendDm(org, current.id, open.id, open.with_id || '', text.trim()); setText(''); setThread(await getConversation(org, current.id, open.id)) }
              catch (ex) { setErr(errText(ex)) }
            }}>
              <input className="input grow" value={text} onChange={e => setText(e.target.value)} placeholder="Message" aria-label="Message" maxLength={1000} />
              <button className="btn btn-primary" disabled={!text.trim()}>Envoyer</button>
            </form>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>Instagram n’autorise une réponse que dans les 24 h qui suivent le dernier message de la personne.
              {open.with && <> <a href={`https://ig.me/m/${open.with}`} target="_blank" rel="noreferrer">Écrire depuis Instagram</a></>}</p>
          ))}
        </section>
      )}
    </div>
  )
}

export default function Comments() {
  const { org } = useSession()
  const { canEdit } = useRole()
  const [tab, setTab] = useState<Tab>('todo')
  const accounts = useLoad(s => getInboxAccounts(s))
  const [syncMsg, setSyncMsg] = useState('')
  const sync = async () => {
    setSyncMsg('')
    try { const r = await syncInbox(org); setSyncMsg(`${r.comments} commentaire${r.comments > 1 ? 's' : ''} relu${r.comments > 1 ? 's' : ''}.`) }
    catch (e) { setSyncMsg(errText(e)) }
  }
  return (
    <>
      <div className="page-head">
        <div><h1>Commentaires</h1><p>Tous vos comptes au même endroit : répondre, remercier, envoyer la partition.</p></div>
        <button type="button" className="btn btn-sm" onClick={sync}><Icon name="refresh" size={16} />Relire</button>
      </div>
      {syncMsg && <Msg>{syncMsg}</Msg>}
      {accounts.data && <Notices accounts={accounts.data} />}
      <Seg<Tab> value={tab} onChange={setTab} label="Vue"
           options={[['todo', 'À traiter'], ['keyword', 'Mot-clé'], ['messages', 'Messages']]} />
      {tab === 'todo' && <Todo canEdit={canEdit} />}
      {tab === 'keyword' && <Keyword canEdit={canEdit} />}
      {tab === 'messages' && accounts.data && <Messages accounts={accounts.data} />}
    </>
  )
}
