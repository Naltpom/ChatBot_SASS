// Brouillons proposés automatiquement depuis la bibliothèque (rangement du dossier lu par Chapote).
// « Valider » ouvre le composeur pré-rempli : on vérifie, on règle les options de chaque
// plateforme (dont les choix TikTok), on programme. « Écarter » : la vidéo ne sera plus proposée.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { dismissProposal, getProposalsPage, type Proposal } from '../api'
import { LiveCount, useMorePages } from '../components/list'
import { PlatformLogo } from '../components/PlatformLogo'
import { Empty, Icon, Msg, Skeleton } from '../components/ui'
import { fmtDateTime, fmtDuration } from '../format'
import { useLoad, useRole, useSession } from '../session'

function Card({ p, onDismiss, canEdit }: { p: Proposal; onDismiss: () => void; canEdit: boolean }) {
  const nav = useNavigate()
  const a = p.asset
  return (
    <article className="card draft">
      {a?.thumbnail ? <img className="draft-thumb" src={a.thumbnail} alt="" loading="lazy" decoding="async" />
        : <span className="draft-thumb" aria-hidden="true" />}
      <div className="col grow" style={{ gap: 6, minWidth: 0 }}>
        <h2 className="ellipsis" style={{ fontSize: 16, margin: 0 }}>{p.title || a?.title || 'Sans titre'}</h2>
        <div className="tiny muted">
          {p.scheduled_at ? <><Icon name="clock" size={13} /> {fmtDateTime(p.scheduled_at)}{p.when_from === 'date' ? ' (heure par défaut)' : ''}</>
            : <span className="status-warn">Heure à choisir</span>}
          {a?.duration_sec ? ` · ${fmtDuration(a.duration_sec)}` : ''}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {p.accounts.slice(0, 4).map(x => <span key={x.key} className="ptag"><PlatformLogo platform={x.platform} size={14} /><span>{x.name}</span></span>)}
          {p.accounts.length > 4 && <span className="ptag">+{p.accounts.length - 4}</span>}
          {!p.accounts.length && <span className="tiny status-warn">Aucun compte : à choisir</span>}
        </div>
        {p.caption && <p className="small muted clamp2" style={{ margin: 0 }}>{p.caption}</p>}
        {a?.folder && <span className="tiny muted ellipsis" title={a.folder}><Icon name="layers" size={12} /> {a.source_name} / {a.folder}</span>}
        {canEdit && (
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => nav(`/nouvelle?brouillon=${p.id}`)}><Icon name="check" size={16} />Vérifier et programmer</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss}>Écarter</button>
          </div>
        )}
      </div>
    </article>
  )
}

export default function Drafts() {
  const { org, scope } = useSession()
  const { canEdit } = useRole()
  const [hidden, setHidden] = useState<number[]>([])
  const [err, setErr] = useState('')
  const first = useLoad(s => getProposalsPage(s))
  const pages = useMorePages(first.data, c => getProposalsPage(scope, c), [scope])
  const items = (pages.items || []).filter(p => !hidden.includes(p.id))
  const dismiss = async (p: Proposal) => {
    setErr('')
    try { await dismissProposal(org, p.id); setHidden(h => [...h, p.id]) } catch (e) { setErr((e as Error).message) }
  }
  return (
    <>
      <div className="page-head">
        <div><h1>À valider</h1><p>Brouillons préparés depuis vos dossiers Drive. Rien ne part sans vous.</p></div>
      </div>
      {err && <Msg kind="err">{err}</Msg>}
      {first.error && <Msg kind="err">{first.error}</Msg>}
      {!first.data && first.loading && <Skeleton h={120} n={3} />}
      {first.data && items.length === 0 && (
        <Empty title="Rien à valider" icon="check">
          <p style={{ margin: 0 }}>Activez les <b>brouillons automatiques</b> sur un dossier de la <Link to="/bibliotheque">Bibliothèque</Link> :
            chaque nouvelle vidéo y arrivera prête à vérifier.</p>
        </Empty>
      )}
      <LiveCount n={items.length} more={!!pages.next} what="brouillons" />
      <div className="col" style={{ gap: 12 }}>
        {items.map(p => <Card key={p.id} p={p} canEdit={canEdit} onDismiss={() => dismiss(p)} />)}
      </div>
      <div ref={pages.sentinel} />
      {pages.busy && <Skeleton h={80} />}
    </>
  )
}
