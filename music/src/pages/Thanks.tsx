import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getOrder, type OrderView } from '../api'
import { euros, useI18n } from '../i18n'
import { Center, Icon } from '../components/ui'
import Player from '../components/Player'
import { useAuth } from '../auth'

export default function ThanksPage() {
  const { t } = useI18n()
  const { me } = useAuth()
  const [params] = useSearchParams()
  const order = params.get('order') || ''
  const k = params.get('k') || undefined
  const sessionId = params.get('session_id') || undefined
  const [data, setData] = useState<OrderView | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true, tries = 0, timer: ReturnType<typeof setTimeout>
    const load = () => {
      getOrder(order, { k, session_id: sessionId }).then(o => {
        if (!alive) return
        setData(o)
        // paiement pas encore confirmé par Stripe : on réessaie quelques fois
        if (o.status === 'pending' && tries++ < 20) timer = setTimeout(load, 2000)
      }).catch(() => alive && setError(true))
    }
    if (order) load(); else setError(true)
    return () => { alive = false; clearTimeout(timer) }
  }, [order, k, sessionId])

  if (error) return <Center><p>{t.notFound}</p><Link to="/">{t.backHome}</Link></Center>
  if (!data) return <Center><div className="spinner" />{t.loading}</Center>
  if (data.status === 'pending') return <Center><div className="spinner" /><h1 style={{ color: 'var(--ink)', fontSize: 24 }}>{t.waitingTitle}</h1><p>{t.waitingText}</p></Center>
  if (data.status !== 'paid') return <Center><h1 style={{ color: 'var(--ink)', fontSize: 24 }}>{t.failedTitle}</h1><p>{t.failedText}</p><Link to="/">{t.backHome}</Link></Center>

  return (
    <main className="thanks">
      {Icon.ok}
      <h1>{t.thanksTitle}</h1>
      <p>{t.thanksText(data.email)}</p>
      <div className="dl-list">
        {data.items.map(it => (
          <a key={it.id} className="dl" href={it.download || undefined} aria-disabled={!it.download}>
            <span className="doc-tile" aria-hidden="true"><span /></span>
            <div className="info"><b>{it.piece_title}</b><small>{it.instrument_label} · {t.pages(it.pages)} · PDF</small></div>
            <span className="go" aria-label={t.download}>{Icon.down}</span>
          </a>
        ))}
      </div>
      {data.items.filter(it => it.has_notes).slice(0, 3).map(it => (
        <Player key={it.id} sheetId={it.sheet_id} instrument={it.instrument} title={`${it.piece_title} — ${it.instrument_label}`}
                auth={{ order: data.order, k: data.key || undefined }}
                pages={Array.from({ length: it.pages }, (_, i) => `/api/music/sheets/${it.sheet_id}/clear/${i + 1}.png?order=${data.order}&k=${data.key}`)} />
      ))}
      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', color: 'var(--ink2)' }}>
        <span>{t.orderTotal}</span><b style={{ color: 'var(--ink)' }}>{euros(data.amount_cents)}</b>
      </div>
      <p style={{ fontSize: 14, color: 'var(--mut)' }}>{t.thanksKeep}</p>
      {!me && <p style={{ fontSize: 14 }}><Link to="/account">{t.signUp}</Link> — {t.thanksAccount}</p>}
      <p style={{ fontSize: 14, color: 'var(--mut)' }}>{t.help} <a href="mailto:music@chapote.fr">music@chapote.fr</a>.</p>
      <Link to="/" className="link-more" style={{ fontSize: 17 }}>{t.more}</Link>
    </main>
  )
}
