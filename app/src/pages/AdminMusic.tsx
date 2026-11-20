// Back-office — boutique de partitions (music.chapote.fr).
// Vue d'ensemble (partitions, commandes payées, chiffre), toutes les partitions
// (diffusées ou privées : l'admin choisit, partition par partition), prix
// généraux et prix propres, codes promo, commandes.
import { useState } from 'react'
import { api, API_URL } from '../api'
import { useApiResource } from '../hooks/useApiResource'
import { ErrorRetry } from '../components/ErrorRetry'
import { Btn, Card, Chip, Field, InfoBox, SectionTitle, Seg, Stat, Toggle } from '../ui'

interface Overview {
  sheets: { total: number; published: number; private: number }
  orders: { paid: number; paid_30d: number; by_status: Record<string, number> }
  revenue_cents: { total: number; last_30d: number }
  pricing: { unit_price_cents: number; bundle_price_cents: number | null; currency: string }
  top_sheets: { id: number; title: string; sales: number; revenue_cents: number }[]
}
interface Sheet {
  id: number; source_ref: string; piece_title: string; composer: string | null; instrument: string
  instrument_label: string; title: string; rights: string | null; public_domain: boolean; published: boolean
  pages: number; reel_url: string | null; price_cents: number | null; effective_price_cents: number
  released_at: string | null; sales: number; revenue_cents: number; url: string; preview: string
}
interface Promo {
  id: number; code: string; kind: 'percent' | 'amount'; value: number; active: boolean; max_uses: number | null
  uses: number; expires_at: string | null; note: string | null; usable: boolean
}
interface Order {
  id: number; public_id: string; status: string; email: string | null; amount_cents: number
  discount_cents: number; promo_code: string | null; created_at: string; paid_at: string | null
  emailed_at: string | null; items: string[]
}

const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €'
const toCents = (s: string) => Math.round(parseFloat(s.replace(',', '.')) * 100)
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—')
const STATUS: Record<string, { label: string; tone: 'go' | 'warn' | 'danger' | 'mut' }> = {
  paid: { label: 'Payée', tone: 'go' }, pending: { label: 'En attente', tone: 'warn' },
  expired: { label: 'Expirée', tone: 'mut' }, failed: { label: 'Refusée', tone: 'danger' },
  refunded: { label: 'Remboursée', tone: 'mut' },
}

export default function AdminMusic() {
  const [tab, setTab] = useState('sheets')
  const ov = useApiResource<Overview>('/api/admin/music/overview')
  const title = (
    <SectionTitle sub={<>Partitions des vidéos @ghosthands.music vendues sur <a href="https://music.chapote.fr" target="_blank" rel="noreferrer">music.chapote.fr</a>.</>}>
      Musique
    </SectionTitle>
  )
  if (ov.error) return <div className="col g18">{title}<ErrorRetry message={ov.error} onRetry={ov.reload} title="Impossible de charger les données" /></div>
  if (ov.loading || !ov.data) return <div className="center-page">Chargement…</div>
  const d = ov.data
  return (
    <div className="col g18">
      {title}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <Stat label="Partitions en vente" value={d.sheets.published} sub={`${d.sheets.private} privée(s)`} />
        <Stat label="Commandes payées" value={d.orders.paid} sub={`${d.orders.paid_30d} sur 30 jours`} />
        <Stat label="Chiffre" value={eur(d.revenue_cents.total)} sub={`${eur(d.revenue_cents.last_30d)} sur 30 jours`} />
        <Stat label="Prix" value={eur(d.pricing.unit_price_cents)}
              sub={d.pricing.bundle_price_cents != null ? `lot d'un morceau : ${eur(d.pricing.bundle_price_cents)}` : 'pas de lot'} />
      </div>
      <Seg value={tab} onChange={setTab} options={[
        { value: 'sheets', label: 'Partitions' }, { value: 'pricing', label: 'Prix' },
        { value: 'promos', label: 'Codes promo' }, { value: 'orders', label: 'Commandes' },
      ]} />
      {tab === 'sheets' && <Sheets onChange={ov.reload} />}
      {tab === 'pricing' && <Pricing initial={d.pricing} onSaved={ov.reload} />}
      {tab === 'promos' && <Promos />}
      {tab === 'orders' && <Orders top={d.top_sheets} />}
    </div>
  )
}

function Sheets({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const path = `/api/admin/music/sheets?status=${status === 'all' ? '' : status}&q=${encodeURIComponent(q)}`
  const { data, loading, error, reload } = useApiResource<{ sheets: Sheet[] }>(path)
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState('')

  const patch = async (s: Sheet, body: object) => {
    setBusy(s.id); setErr('')
    try { await api(`/api/admin/music/sheets/${s.id}`, { method: 'PATCH', body }); reload(); onChange() }
    catch (e: any) { setErr(e.message || 'Erreur') }
    finally { setBusy(null) }
  }
  const editPrice = (s: Sheet) => {
    const v = window.prompt(`Prix de « ${s.piece_title} — ${s.instrument_label} » en euros (vide = prix général)`,
      s.price_cents != null ? (s.price_cents / 100).toFixed(2) : '')
    if (v === null) return
    if (v.trim() === '') patch(s, { reset_price: true })
    else if (!Number.isNaN(toCents(v))) patch(s, { price_cents: toCents(v) })
  }

  return (
    <Card nopad>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 14, alignItems: 'center' }}>
        <Seg small value={status} onChange={setStatus} options={[
          { value: 'all', label: 'Toutes' }, { value: 'published', label: 'En vente' }, { value: 'private', label: 'Privées' }]} />
        <input type="text" style={{ flex: '1 1 220px', minWidth: 0 }} placeholder="Rechercher un morceau, un compositeur…"
               aria-label="Rechercher" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {err && <div style={{ padding: '0 14px 10px' }}><InfoBox tone="danger">{err}</InfoBox></div>}
      {error ? <div style={{ padding: 14 }}><ErrorRetry message={error} onRetry={reload} /></div>
        : loading || !data ? <p className="muted" style={{ padding: 14, margin: 0 }}>Chargement…</p>
        : data.sheets.length === 0 ? <p className="muted" style={{ padding: 14, margin: 0 }}>Aucune partition.</p> : (
        <div className="table-scroll">
          <table className="kc">
            <thead><tr><th>Page 1</th><th>Morceau</th><th>Instrument</th><th>Droits</th><th>Diffusée</th><th>Prix</th><th>Ventes</th><th>Sortie</th></tr></thead>
            <tbody>
              {data.sheets.map(s => (
                <tr key={s.id}>
                  <td><img src={`${API_URL}${s.preview}`} alt="" loading="lazy" width={44} height={58}
                           style={{ objectFit: 'cover', objectPosition: 'top', borderRadius: 4, border: '1px solid var(--border)', background: '#fff' }} /></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{s.piece_title}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>{s.composer || '—'} · {s.pages} p. · {s.source_ref}</div>
                    {s.published && <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>Voir la page</a>}
                    {s.reel_url && <> · <a href={s.reel_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>Reel</a></>}
                  </td>
                  <td>{s.instrument_label}</td>
                  <td>{s.public_domain ? <Chip tone="go">Domaine public</Chip> : <Chip tone="warn">{s.rights || 'Protégé'}</Chip>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Toggle on={s.published} disabled={busy === s.id} label={`Diffuser ${s.piece_title}`}
                              onChange={v => patch(s, { published: v })} />
                      {s.published ? <Chip tone="go">En vente</Chip> : <Chip tone="mut">Privé · non diffusé</Chip>}
                    </div>
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost small" onClick={() => editPrice(s)} disabled={busy === s.id}>
                      {eur(s.effective_price_cents)}{s.price_cents != null ? ' (propre)' : ''}
                    </button>
                  </td>
                  <td>{s.sales ? `${s.sales} · ${eur(s.revenue_cents)}` : '—'}</td>
                  <td>{day(s.released_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function Pricing({ initial, onSaved }: { initial: Overview['pricing']; onSaved: () => void }) {
  const [unit, setUnit] = useState((initial.unit_price_cents / 100).toFixed(2))
  const [bundle, setBundle] = useState(initial.bundle_price_cents != null ? (initial.bundle_price_cents / 100).toFixed(2) : '')
  const [msg, setMsg] = useState<{ tone: 'go' | 'danger'; text: string } | null>(null)
  const save = async () => {
    setMsg(null)
    const u = toCents(unit)
    const b = bundle.trim() === '' ? null : toCents(bundle)
    if (Number.isNaN(u) || (b !== null && Number.isNaN(b))) { setMsg({ tone: 'danger', text: 'Montant invalide' }); return }
    try {
      await api('/api/admin/music/pricing', { method: 'PUT', body: { unit_price_cents: u, bundle_price_cents: b } })
      setMsg({ tone: 'go', text: 'Prix enregistrés : ils s’appliquent aux prochaines commandes.' }); onSaved()
    } catch (e: any) { setMsg({ tone: 'danger', text: e.message || 'Erreur' }) }
  }
  return (
    <Card>
      <div className="col g14" style={{ maxWidth: 460 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          Le prix est calculé par le serveur à chaque commande puis donné à Stripe. Une partition peut avoir son prix propre (onglet Partitions).
        </p>
        <Field label="Prix d’une partition (€)">
          <input type="text" inputMode="decimal" value={unit} onChange={e => setUnit(e.target.value)} />
        </Field>
        <Field label="Prix du lot d’un morceau (€)" hint="Plusieurs instruments du même morceau dans la commande. Vide = pas de lot.">
          <input type="text" inputMode="decimal" value={bundle} onChange={e => setBundle(e.target.value)} />
        </Field>
        {msg && <InfoBox tone={msg.tone}>{msg.text}</InfoBox>}
        <div><Btn onClick={save}>Enregistrer</Btn></div>
      </div>
    </Card>
  )
}

function Promos() {
  const { data, loading, error, reload } = useApiResource<{ promos: Promo[] }>('/api/admin/music/promos')
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [expires, setExpires] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  const create = async () => {
    setErr('')
    const v = kind === 'percent' ? parseInt(value, 10) : toCents(value)
    if (!code.trim() || !v || Number.isNaN(v)) { setErr('Code et valeur obligatoires'); return }
    try {
      await api('/api/admin/music/promos', { method: 'POST', body: {
        code: code.trim(), kind, value: v, max_uses: maxUses ? parseInt(maxUses, 10) : null,
        expires_at: expires ? new Date(expires + 'T23:59:59').toISOString() : null, note: note || null } })
      setCode(''); setValue(''); setMaxUses(''); setExpires(''); setNote(''); reload()
    } catch (e: any) { setErr(e.message || 'Erreur') }
  }
  const toggle = async (p: Promo) => { await api(`/api/admin/music/promos/${p.id}`, { method: 'PATCH', body: { active: !p.active } }); reload() }

  return (
    <div className="col g14">
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
          <Field label="Code"><input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="NOEL20" /></Field>
          <Field label="Type">
            <Seg small value={kind} onChange={v => setKind(v as 'percent' | 'amount')} options={[{ value: 'percent', label: '%' }, { value: 'amount', label: '€' }]} />
          </Field>
          <Field label={kind === 'percent' ? 'Réduction (%)' : 'Réduction (€)'}><input type="text" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} /></Field>
          <Field label="Utilisations max" hint="Vide = illimité"><input type="text" inputMode="numeric" value={maxUses} onChange={e => setMaxUses(e.target.value)} /></Field>
          <Field label="Valable jusqu’au" hint="Vide = sans fin"><input type="date" style={{ width: '100%', padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)' }} value={expires} onChange={e => setExpires(e.target.value)} /></Field>
          <Field label="Note"><input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Live du 24/11" /></Field>
        </div>
        {err && <div style={{ marginTop: 10 }}><InfoBox tone="danger">{err}</InfoBox></div>}
        <div style={{ marginTop: 12 }}><Btn onClick={create}>Créer le code</Btn></div>
      </Card>
      <Card nopad>
        {error ? <div style={{ padding: 14 }}><ErrorRetry message={error} onRetry={reload} /></div>
          : loading || !data ? <p className="muted" style={{ padding: 14, margin: 0 }}>Chargement…</p>
          : data.promos.length === 0 ? <p className="muted" style={{ padding: 14, margin: 0 }}>Aucun code promo.</p> : (
          <div className="table-scroll">
            <table className="kc">
              <thead><tr><th>Code</th><th>Réduction</th><th>Utilisations</th><th>Fin</th><th>Note</th><th>Actif</th></tr></thead>
              <tbody>
                {data.promos.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.code}</strong> {!p.usable && <Chip tone="mut">inutilisable</Chip>}</td>
                    <td>{p.kind === 'percent' ? `${p.value} %` : eur(p.value)}</td>
                    <td>{p.uses}{p.max_uses != null ? ` / ${p.max_uses}` : ''}</td>
                    <td>{day(p.expires_at)}</td>
                    <td>{p.note || '—'}</td>
                    <td><Toggle on={p.active} onChange={() => toggle(p)} label={`Activer ${p.code}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Orders({ top }: { top: Overview['top_sheets'] }) {
  const [status, setStatus] = useState('paid')
  const { data, loading, error, reload } = useApiResource<{ orders: Order[] }>(`/api/admin/music/orders?status=${status === 'all' ? '' : status}`)
  const [msg, setMsg] = useState('')
  const resend = async (o: Order) => {
    setMsg('')
    try { await api(`/api/admin/music/orders/${o.id}/resend`, { method: 'POST' }); setMsg(`E-mail renvoyé à ${o.email}`); reload() }
    catch (e: any) { setMsg(e.message || 'Erreur') }
  }
  return (
    <div className="col g14">
      {top.length > 0 && (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Meilleures ventes</div>
          {top.map(t => <div key={t.id} style={{ fontSize: 13.5 }}>{t.title} — {t.sales} vente(s), {eur(t.revenue_cents)}</div>)}
        </Card>
      )}
      <Card nopad>
        <div style={{ padding: 14 }}>
          <Seg small value={status} onChange={setStatus} options={[
            { value: 'paid', label: 'Payées' }, { value: 'pending', label: 'En attente' }, { value: 'all', label: 'Toutes' }]} />
        </div>
        {msg && <div style={{ padding: '0 14px 10px' }}><InfoBox>{msg}</InfoBox></div>}
        {error ? <div style={{ padding: 14 }}><ErrorRetry message={error} onRetry={reload} /></div>
          : loading || !data ? <p className="muted" style={{ padding: 14, margin: 0 }}>Chargement…</p>
          : data.orders.length === 0 ? <p className="muted" style={{ padding: 14, margin: 0 }}>Aucune commande.</p> : (
          <div className="table-scroll">
            <table className="kc">
              <thead><tr><th>Date</th><th>Statut</th><th>Client</th><th>Partitions</th><th>Montant</th><th>Code</th><th></th></tr></thead>
              <tbody>
                {data.orders.map(o => (
                  <tr key={o.id}>
                    <td>{day(o.paid_at || o.created_at)}</td>
                    <td><Chip tone={(STATUS[o.status] || STATUS.expired).tone}>{(STATUS[o.status] || { label: o.status }).label}</Chip></td>
                    <td>{o.email || '—'}</td>
                    <td style={{ fontSize: 13 }}>{o.items.join(', ')}</td>
                    <td>{eur(o.amount_cents)}{o.discount_cents ? <span className="muted"> (−{eur(o.discount_cents)})</span> : null}</td>
                    <td>{o.promo_code || '—'}</td>
                    <td>{o.status === 'paid' && o.email && <Btn small kind="ghost" onClick={() => resend(o)}>Renvoyer l’e-mail</Btn>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
