// Avant de planifier (même parcours que l'app) : chaque compte l'un après l'autre. « Valider » passe au suivant ;
// « Modifier » ouvre ses champs sur place (puis « Enregistrer ») ; « Retirer » l'enlève. Le dernier lance l'envoi.
import { useEffect, useState, type ReactNode } from 'react'
import { PLATFORM_LABEL, type Account } from '../api'
import { longDate } from '../compose'
import { Avatar, Icon, Msg, Sheet } from './ui'

export function ReviewSheet({ onClose, accounts, when, recap, problems, renderEdit, onRemove, onDone, busy, finalLabel }: {
  onClose: () => void; accounts: Account[]; when: (a: Account) => Date | null
  recap: (a: Account) => [string, string][]; problems: (a: Account) => string[]; renderEdit: (a: Account) => ReactNode
  onRemove: (a: Account) => void; onDone: () => void; busy?: boolean; finalLabel: string
}) {
  const [i, setI] = useState(0)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (i > accounts.length - 1) setI(Math.max(accounts.length - 1, 0)) }, [accounts.length, i])
  const a = accounts[i]
  if (!a) return null
  const errs = problems(a)
  const at = when(a)
  const last = i === accounts.length - 1
  return (
    <Sheet title={`Vérification · ${i + 1} / ${accounts.length}`} onClose={busy ? () => {} : onClose}>
      <div className="col" style={{ gap: 12 }}>
        <div className="row-nw" style={{ gap: 12 }}>
          <Avatar src={a.avatar_url} name={a.name} platform={a.platform} />
          <div className="col" style={{ minWidth: 0 }}>
            <span className="strong ellipsis">{a.name || PLATFORM_LABEL[a.platform]}</span>
            <span className="small muted">{PLATFORM_LABEL[a.platform]} · {at ? longDate(at) : 'tout de suite'}</span>
          </div>
        </div>
        {errs.length > 0 && <Msg kind="err">À corriger : {errs.join(' ')}</Msg>}
        {editing ? renderEdit(a) : (
          <div>
            {recap(a).map(([k, v]) => (
              <div key={k} className="review-row">
                <span className="tiny muted">{k}</span>
                <span className={`v${/^à (choisir|indiquer|préciser)/.test(v) ? ' todo' : ''}`}>{v}</span>
              </div>
            ))}
          </div>
        )}
        {accounts.length > 1 && (
          <span className="small muted">{accounts.map((_, j) => (j < i ? '✓' : j === i ? '●' : '○')).join('  ')}  ·  {i} validé{i > 1 ? 's' : ''} sur {accounts.length}</span>
        )}
        {editing ? (
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setEditing(false)}><Icon name="check" />Enregistrer</button>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            <div className="row-nw" style={{ gap: 8 }}>
              <button type="button" className="btn btn-lg" style={{ flex: 1 }} disabled={busy} onClick={() => setEditing(true)}><Icon name="edit" />Modifier</button>
              <button type="button" className="btn btn-primary btn-lg" style={{ flex: 1.4 }} disabled={busy || errs.length > 0}
                      onClick={() => { if (last) onDone(); else { setI(i + 1); setEditing(false) } }}>
                <Icon name={last ? 'clock' : 'check'} />{last ? finalLabel : 'Valider'}
              </button>
            </div>
            <button type="button" className="btn btn-ghost btn-danger" disabled={busy || accounts.length < 2} onClick={() => { onRemove(a); setEditing(false) }}>
              <Icon name="close" />Retirer ce compte
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
