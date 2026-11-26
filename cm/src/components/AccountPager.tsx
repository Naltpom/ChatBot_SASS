// Réglages compte par compte (même parcours que l'app) : les comptes en onglets, et dessous une page par compte
// qu'on fait défiler à gauche / à droite comme un carrousel (glisser au doigt, flèches du clavier, onglets).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PLATFORM_LABEL, type Account } from '../api'
import { Avatar, Icon } from './ui'
import { t } from '../i18n'

const keyOf = (a: Account) => `${a.platform}:${a.id}`

export function AccountPager({ accounts, render, problems, onRemove, disabled }: {
  accounts: Account[]; render: (a: Account) => ReactNode; problems: (a: Account) => number
  onRemove: (a: Account) => void; disabled?: boolean
}) {
  const [index, setIndex] = useState(0)
  const track = useRef<HTMLDivElement>(null)
  const tabs = useRef<HTMLDivElement>(null)
  const last = Math.max(accounts.length - 1, 0)
  useEffect(() => { if (index > last) go(last) }, [last]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = (i: number) => {
    setIndex(i)
    const tr = track.current
    if (tr) tr.scrollTo({ left: i * (tr.clientWidth + 16), behavior: 'smooth' })
    tabs.current?.children[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }
  const onScroll = () => {
    const tr = track.current
    if (!tr) return
    const i = Math.round(tr.scrollLeft / (tr.clientWidth + 16))
    if (i !== index && i >= 0 && i <= last) { setIndex(i); tabs.current?.children[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  }
  if (!accounts.length) return null
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="acc-tabs" role="tablist" aria-label={t('Comptes à régler')} ref={tabs}
           onKeyDown={e => { if (e.key === 'ArrowRight') go(Math.min(index + 1, last)); if (e.key === 'ArrowLeft') go(Math.max(index - 1, 0)) }}>
        {accounts.map((a, i) => {
          const n = problems(a)
          return (
            <button key={keyOf(a)} type="button" role="tab" className="acc-tab" aria-selected={i === index} tabIndex={i === index ? 0 : -1}
                    aria-label={`${a.name || PLATFORM_LABEL[a.platform]}, ${PLATFORM_LABEL[a.platform]}${n ? `, ${n > 1 ? t('{n} réglages à compléter', { n }) : t('{n} réglage à compléter', { n })}` : ''}`}
                    onClick={() => go(i)}>
              <Avatar src={a.avatar_url} name={a.name} platform={a.platform} size="sm" />
              <span className="ellipsis" style={{ maxWidth: 160 }}>{a.name || PLATFORM_LABEL[a.platform]}</span>
              {n > 0 && <span className="dot" aria-hidden="true">{n}</span>}
            </button>
          )
        })}
      </div>
      <div className="pager" ref={track} onScroll={onScroll}>
        {accounts.map(a => (
          <div key={keyOf(a)} className="pager-page" role="tabpanel" aria-label={a.name || PLATFORM_LABEL[a.platform]}>
            {render(a)}
            <button type="button" className="btn btn-ghost btn-danger" style={{ alignSelf: 'center' }} disabled={disabled} onClick={() => onRemove(a)}>
              <Icon name="close" />{t('Retirer ce compte de la programmation')}
            </button>
          </div>
        ))}
      </div>
      {accounts.length > 1 && (
        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          <button type="button" className="btn btn-sm btn-ghost" disabled={index === 0} onClick={() => go(index - 1)} aria-label={t('Compte précédent')}><Icon name="left" /></button>
          <span className="small muted">{index + 1} / {accounts.length}</span>
          <button type="button" className="btn btn-sm btn-ghost" disabled={index === last} onClick={() => go(index + 1)} aria-label={t('Compte suivant')}><Icon name="right" /></button>
        </div>
      )}
    </div>
  )
}
