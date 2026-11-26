// Commentaires et messages de tous les comptes, au même endroit. Filtrés par la barre de comptes.
// - À traiter : répondre, réponse privée (Instagram), masquer, ignorer ; recherche et tri par l'API.
// - Mot-clé : ceux qui ont écrit « SHEET » (ou un autre mot), une ligne par personne, pour les
//   contacter : réponse privée quand Instagram le permet, sinon message prêt à copier + profil.
// - Messages : conversations Instagram (fenêtre de 24 h imposée par Instagram).
// Sans la permission de la plateforme, l'écran le dit au lieu d'échouer en silence.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { byVideo, CommentCard } from '../components/CommentCard'
import {
  ApiError, getCommentsPage, PLATFORM_LABEL, getConversation, getConversations, getInboxAccounts, getKeyword, sendDm, syncInbox,
  type Comment, type Conversation, type DmMessage, type InboxAccount,
} from '../api'
import { LiveCount, SearchBox, SortControl, useListState, useMorePages } from '../components/list'
import { Empty, Icon, Msg, Seg, Skeleton } from '../components/ui'
import { useLoad, useRole, useSession } from '../session'
import { t } from '../i18n'

type Tab = 'todo' | 'keyword' | 'messages'
const STATUS: [string, string][] = [['todo', 'À traiter'], ['replied', 'Répondus'], ['contacted', 'Contactés'], ['hidden', 'Masqués'], ['ignored', 'Ignorés'], ['all', 'Tous']]

function store(key: string, fallback: string): [string, (v: string) => void] {
  let v = fallback
  try { v = localStorage.getItem(key) ?? fallback } catch { /* stockage indisponible */ }
  return [v, (x: string) => { try { localStorage.setItem(key, x) } catch { /* idem */ } }]
}

function errText(e: unknown) {
  const ae = e as ApiError
  return ae?.data?.message || ae?.message || t('Erreur')
}

function VideoGroup({ g, canEdit, onChanged, template }: {
  g: ReturnType<typeof byVideo>[number]; canEdit: boolean; template?: string; onChanged: (id: number, c: Comment | null) => void
}) {
  const fresh = g.items.filter(c => c.status === 'new').length
  const plats = [...new Set(g.items.map(c => PLATFORM_LABEL[c.platform]))].join(', ')
  const head = (
    <>
      {g.thumb ? <img className="cgroup-thumb" src={g.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="cgroup-thumb" aria-hidden="true" />}
      <span className="grow col" style={{ minWidth: 0, gap: 0 }}>
        <span className="strong ellipsis">{g.title || t('Vidéo')}</span>
        <span className="tiny muted">{fresh ? `${fresh > 1 ? t('{n} nouveaux', { n: fresh }) : t('{n} nouveau', { n: fresh })} · ` : ''}{plats}</span>
      </span>
      {g.videoId && <Icon name="right" />}
    </>
  )
  return (
    <section className="cgroup" aria-label={g.title ? t('Commentaires de « {title} »', { title: g.title }) : t('Commentaires de la vidéo')}>
      {g.videoId ? <Link className="cgroup-head" to={`/videos/${g.videoId}`}>{head}</Link> : <div className="cgroup-head">{head}</div>}
      {g.items.map(c => <CommentCard key={c.id} c={c} canEdit={canEdit} template={template} onChanged={n => onChanged(c.id, n)} />)}
    </section>
  )
}

function Notices({ accounts }: { accounts: InboxAccount[] }) {
  const by = new Map<string, string[]>()
  for (const a of accounts) if (a.notice) by.set(a.notice, [...(by.get(a.notice) || []), a.name || a.platform])
  if (!by.size) return null
  return (
    <details className="card notice">
      <summary className="small strong">{by.size === 1 ? t('Une permission en attente pour certains comptes') : t('Des permissions en attente pour certains comptes')}</summary>
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
        <SearchBox value={list.input} onChange={list.setInput} label={t('Rechercher (texte, pseudo, vidéo)')} />
        <select className="select select-sm" aria-label={t('Afficher')} value={st} onChange={e => setSt(e.target.value)}>
          {STATUS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
        </select>
        <span className="sortctl"><SortControl list={list} options={[['recent', t('Date')], ['likes', t('J’aime')]]} /></span>
      </div>
      <LiveCount n={shown.length} more={!!pages.next} what={t('commentaires')} />
      {first.error && <Msg kind="err">{first.error}</Msg>}
      {!first.data && first.loading && <Skeleton h={90} n={4} />}
      {first.data && shown.length === 0 && (
        <Empty title={st === 'todo' ? t('Rien à traiter') : t('Aucun commentaire')} icon="comment">
          {list.q ? t('Rien ne correspond à « {q} ».', { q: list.q }) : t('Les nouveaux commentaires de vos vidéos arrivent ici.')}
        </Empty>
      )}
      <div className="col" style={{ gap: 14 }}>
        {byVideo(shown).map(g => <VideoGroup key={g.key} g={g} canEdit={canEdit} onChanged={(id, n) => setChanged(m => ({ ...m, [id]: n }))} />)}
      </div>
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
        <label className="field">{t('Mot écrit en commentaire')}
          <input className="input" value={word} onChange={e => setWord(e.target.value)} maxLength={40} placeholder="SHEET" />
        </label>
        <label className="field">{t('Message à envoyer ({pseudo} = la personne)')}
          <textarea className="input" rows={3} value={tpl} onChange={e => { setTpl(e.target.value); saveTpl(e.target.value) }} maxLength={1000} />
        </label>
        <p className="tiny muted" style={{ margin: 0 }}>
          {t('Instagram ne donne pas la liste des personnes qui aiment un commentaire (seulement leur nombre) : la liste vient de celles qui ont')}{' '}
          <b>{t('écrit')}</b> {t('le mot. Réponse privée possible 7 jours après le commentaire ; sinon copiez le message et ouvrez la conversation Instagram.')}
        </p>
      </div>
      <LiveCount n={rows.length} what={t('personnes')} />
      {people.loading && !people.data && <Skeleton h={80} n={3} />}
      {people.data && rows.length === 0 && <Empty title={t('Personne à contacter')} icon="check">{t('Aucun nouveau commentaire contenant « {w} ».', { w })}</Empty>}
      <div className="col" style={{ gap: 14 }}>
        {byVideo(rows).map(g => <VideoGroup key={g.key} g={g} canEdit={canEdit} template={tpl}
          onChanged={(id, n) => { if (!n || n.status !== 'new' || n.private_replied_at) setDone(d => [...d, id]) }} />)}
      </div>
    </>
  )
}

function Messages({ accounts }: { accounts: InboxAccount[] }) {
  const { orgOf } = useSession()
  const ig = accounts.filter(a => a.platform === 'instagram')
  const [acc, setAcc] = useState<number | null>(ig.find(a => a.messages)?.id ?? ig[0]?.id ?? null)
  const current = ig.find(a => a.id === acc)
  const org = current ? orgOf('instagram', current.id) : null
  const convs = useLoad(() => (current?.messages ? getConversations(org, current.id) : Promise.resolve(null as Conversation[] | null)), [acc, current?.messages])
  const [open, setOpen] = useState<Conversation | null>(null)
  const [thread, setThread] = useState<{ messages: DmMessage[]; can_write: boolean } | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    setThread(null)
    if (open && current) getConversation(org, current.id, open.id).then(setThread).catch(e => setErr(errText(e)))
  }, [open?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ig.length) return <Empty title={t('Aucun compte Instagram')} icon="comment">{t('Les messages privés concernent Instagram.')}</Empty>
  return (
    <div className="col" style={{ gap: 12 }}>
      {ig.length > 1 && (
        <select className="select" aria-label={t('Compte Instagram')} value={acc ?? ''} onChange={e => { setAcc(Number(e.target.value)); setOpen(null) }}>
          {ig.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      {current && !current.messages && <Msg>{current.source === 'routine' ? t('Les messages de ce compte (géré par la routine) se lisent dans Instagram.') : current.notice}</Msg>}
      {convs.error && <Msg kind="err">{convs.error}</Msg>}
      {current?.messages && !open && (
        <ul className="list card card-flush list-pad">
          {(convs.data || []).map(c => (
            <li key={c.id}>
              <button type="button" className="menu-item grow" style={{ textAlign: 'left' }} onClick={() => setOpen(c)}>
                <span className="grow col" style={{ minWidth: 0, gap: 0 }}>
                  <span className="strong ellipsis">@{c.with}</span>
                  <span className="tiny muted ellipsis">{c.last_from_me ? t('Vous : ') : ''}{c.last}</span>
                </span>
                <Icon name="right" />
              </button>
            </li>
          ))}
          {convs.data && !convs.data.length && <li className="muted small">{t('Aucune conversation.')}</li>}
        </ul>
      )}
      {open && current && (
        <section className="card col" style={{ gap: 10 }} aria-label={t('Conversation avec @{name}', { name: open.with })}>
          <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(null)}><Icon name="left" />{t('Conversations')}</button>
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
              <input className="input grow" value={text} onChange={e => setText(e.target.value)} placeholder={t('Message')} aria-label={t('Message')} maxLength={1000} />
              <button className="btn btn-primary" disabled={!text.trim()}>{t('Envoyer')}</button>
            </form>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>{t('Instagram n’autorise une réponse que dans les 24 h qui suivent le dernier message de la personne.')}
              {open.with && <> <a href={`https://ig.me/m/${open.with}`} target="_blank" rel="noreferrer">{t('Écrire depuis Instagram')}</a></>}</p>
          ))}
        </section>
      )}
    </div>
  )
}

export default function Comments() {
  const { accounts: mine } = useSession()
  const { canEdit } = useRole()
  const [tab, setTab] = useState<Tab>('todo')
  const accounts = useLoad(s => getInboxAccounts(s))
  const [syncMsg, setSyncMsg] = useState('')
  const sync = async () => {
    setSyncMsg('')
    try {
      // Un relevé par espace des comptes affichés où je peux agir.
      const orgs = [...new Set(mine.filter(a => a.role !== 'viewer').map(a => a.org_id ?? null))]
      let n = 0
      for (const o of orgs.length ? orgs : [null]) n += (await syncInbox(o)).comments
      const r = { comments: n }
      setSyncMsg(r.comments > 1 ? t('{n} commentaires relus.', { n: r.comments }) : t('{n} commentaire relu.', { n: r.comments }))
    } catch (e) { setSyncMsg(errText(e)) }
  }
  return (
    <>
      <div className="page-head">
        <div><h1>{t('Commentaires')}</h1><p>{t('Tous vos comptes au même endroit : répondre, remercier, envoyer la partition.')}</p></div>
        <button type="button" className="btn btn-sm" onClick={sync}><Icon name="refresh" size={16} />{t('Relire')}</button>
      </div>
      {syncMsg && <Msg>{syncMsg}</Msg>}
      {accounts.data && <Notices accounts={accounts.data} />}
      <Seg<Tab> value={tab} onChange={setTab} label={t('Vue')}
           options={[['todo', t('À traiter')], ['keyword', t('Mot-clé')], ['messages', t('Messages')]]} />
      {tab === 'todo' && <Todo canEdit={canEdit} />}
      {tab === 'keyword' && <Keyword canEdit={canEdit} />}
      {tab === 'messages' && accounts.data && <Messages accounts={accounts.data} />}
    </>
  )
}
