// Back-office — boutique de partitions (music.chapote.fr).
// Vue d'ensemble, toutes les partitions (diffusées ou privées : l'admin choisit, partition par
// partition), prix généraux et prix propres modifiés directement dans le tableau, codes promo,
// commandes, avis. Pagination côté API ; une modification ne met à jour que sa ligne.
import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api, API_URL } from '../api'
import { useApiResource } from '../hooks/useApiResource'
import { ErrorRetry } from '../components/ErrorRetry'
import { Btn, Card, Chip, Field, InfoBox, SectionTitle, Seg, Stat, Toggle } from '../ui'

interface Overview {
  sheets: { total: number; published: number; private: number }
  orders: { paid: number; paid_30d: number; by_status: Record<string, number> }
  revenue_cents: { total: number; last_30d: number }
  pricing: { unit_price_cents: number; bundle_price_cents: number | null; currency: string }
  accounts: { using_music: number; signed_up_on_music: number }
  reviews: number
  top_sheets: { id: number; title: string; sales: number; revenue_cents: number }[]
}
interface Sheet {
  id: number; source_ref: string; piece_title: string; composer: string | null; instrument: string
  instrument_label: string; title: string; rights: string | null; public_domain: boolean; published: boolean
  pages: number; reel_url: string | null; price_cents: number | null; effective_price_cents: number
  released_at: string | null; sales: number; revenue_cents: number; url: string; preview: string
  likes: number | null; has_notes: boolean; owners: number
}
interface Owner {
  order_id: number; item_id: number; email: string | null; user_id: number | null; name: string | null
  has_account: boolean; source: 'grant' | 'purchase'; amount_cents: number; at: string | null
}
interface Promo {
  id: number; code: string; kind: 'percent' | 'amount'; value: number; active: boolean; max_uses: number | null
  uses: number; expires_at: string | null; note: string | null; usable: boolean
}
interface Order {
  id: number; public_id: string; status: string; email: string | null; amount_cents: number
  discount_cents: number; promo_code: string | null; created_at: string; paid_at: string | null
  emailed_at: string | null; items: string[]; instagram_username: string | null; instagram_status: string | null
  user_id: number | null; granted?: boolean; item_links?: { label: string; url: string }[]
}
interface Review { id: number; rating: number; comment: string | null; hidden: boolean; date: string; user: string; sheet: string }
interface Page<T> { total: number; next_offset: number | null }

const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €'
const toCents = (s: string) => Math.round(parseFloat(s.replace(',', '.').replace('€', '').trim()) * 100)
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—')
const STATUS: Record<string, { label: string; tone: 'go' | 'warn' | 'danger' | 'mut' }> = {
  paid: { label: 'Payée', tone: 'go' }, pending: { label: 'En attente', tone: 'warn' },
  expired: { label: 'Expirée', tone: 'mut' }, failed: { label: 'Refusée', tone: 'danger' },
  refunded: { label: 'Remboursée', tone: 'mut' }, disputed: { label: 'Litige en cours', tone: 'danger' },
}
const IG: Record<string, string> = {
  sent: 'envoyé en DM', no_conversation: 'pas de conversation', window_closed: 'fenêtre de 24 h fermée', error: 'erreur',
}

/** Liste paginée côté API : première page, « Charger plus », mise à jour d'une ligne sans tout recharger. */
function usePaged<T extends { id: number }>(base: string, key: 'sheets' | 'orders' | 'reviews', size = 50) {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const gen = useRef(0)
  const sep = base.includes('?') ? '&' : '?'
  const load = useCallback(async (offset: number) => {
    const g = offset === 0 ? ++gen.current : gen.current
    setLoading(true); setError(null)
    try {
      const d = await api<Page<T> & Record<string, T[]>>(`${base}${sep}offset=${offset}&limit=${size}`)
      if (g !== gen.current) return
      setItems(prev => (offset === 0 ? d[key] : [...prev, ...d[key]]))
      setTotal(d.total); setNext(d.next_offset)
    } catch (e: any) { if (g === gen.current) setError(e.message || 'Erreur') }
    finally { if (g === gen.current) setLoading(false) }
  }, [base, key, sep, size])
  useEffect(() => { load(0) }, [load])
  const update = (id: number, patch: Partial<T>) => setItems(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)))
  return { items, total, next, loading, error, more: () => next != null && load(next), reload: () => load(0), update }
}

function MoreBar({ shown, total, next, loading, onMore }: { shown: number; total: number; next: number | null; loading: boolean; onMore: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, gap: 10, flexWrap: 'wrap' }}>
      <span className="muted" style={{ fontSize: 13 }}>{shown} sur {total}</span>
      {next != null && <Btn small kind="ghost" onClick={onMore} disabled={loading}>{loading ? 'Chargement…' : 'Charger plus'}</Btn>}
    </div>
  )
}

export default function AdminMusic() {
  const [tab, setTab] = useState('sheets')
  const ov = useApiResource<Overview>('/api/admin/music/overview')
  const title = (
    <SectionTitle sub={<>Partitions des vidéos @ghosthands.music vendues sur <a href="https://music.chapote.fr" target="_blank" rel="noreferrer">music.chapote.fr</a>.</>}>
      Musique
    </SectionTitle>
  )
  if (ov.error && !ov.data) return <div className="col g18">{title}<ErrorRetry message={ov.error} onRetry={ov.reload} title="Impossible de charger les données" /></div>
  if (!ov.data) return <div className="center-page">Chargement…</div>
  const d = ov.data
  return (
    <div className="col g18">
      {title}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        <Stat label="Partitions en vente" value={d.sheets.published} sub={`${d.sheets.private} privée(s)`} />
        <Stat label="Commandes payées" value={d.orders.paid} sub={`${d.orders.paid_30d} sur 30 jours`} />
        <Stat label="Chiffre" value={eur(d.revenue_cents.total)} sub={`${eur(d.revenue_cents.last_30d)} sur 30 jours`} />
        <Stat label="Comptes music" value={d.accounts.using_music} sub={`${d.accounts.signed_up_on_music} inscrits via music · ${d.reviews} avis`} />
      </div>
      <Seg value={tab} onChange={setTab} options={[
        { value: 'sheets', label: 'Partitions' }, { value: 'pricing', label: 'Prix' },
        { value: 'promos', label: 'Codes promo' }, { value: 'orders', label: 'Commandes' }, { value: 'reviews', label: 'Avis' }, { value: 'tracking', label: 'Suivi des liens' },
      ]} />
      {tab === 'sheets' && <Sheets onChange={ov.reload} unitPrice={d.pricing.unit_price_cents} />}
      {tab === 'pricing' && <Pricing initial={d.pricing} onSaved={ov.reload} />}
      {tab === 'promos' && <Promos />}
      {tab === 'orders' && <Orders top={d.top_sheets} />}
      {tab === 'reviews' && <Reviews />}
      {tab === 'tracking' && <Tracking />}
    </div>
  )
}

/** Prix modifiable dans la cellule : clic, saisie, Entrée (vide = prix général), Échap pour annuler. */
function PriceCell({ s, onSave }: { s: Sheet; onSave: (cents: number | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const start = () => { setValue(s.price_cents != null ? (s.price_cents / 100).toFixed(2).replace('.', ',') : ''); setEditing(true) }
  const commit = async () => {
    const v = value.trim()
    const cents = v === '' ? null : toCents(v)
    if (cents !== null && (Number.isNaN(cents) || cents < 0)) return
    setBusy(true)
    try { await onSave(cents); setEditing(false) } finally { setBusy(false) }
  }
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditing(false)
  }
  if (!editing) {
    return (
      <button type="button" className="btn btn-ghost small" onClick={start} title="Modifier le prix de cette partition">
        {eur(s.effective_price_cents)}{s.price_cents != null ? ' · propre' : ''}
      </button>
    )
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input type="text" inputMode="decimal" autoFocus value={value} disabled={busy} onChange={e => setValue(e.target.value)}
             onKeyDown={key} placeholder="général" aria-label="Prix en euros (vide = prix général)" style={{ width: 90 }} />
      <Btn small onClick={commit} disabled={busy}>OK</Btn>
    </span>
  )
}

/** Qui possède la partition (achats et dons) ; donner la partition à une adresse e-mail ; retirer un don. */
function Owners({ sheet, onCount }: { sheet: Sheet; onCount: (n: number) => void }) {
  const [owners, setOwners] = useState<Owner[] | null>(null)
  const [email, setEmail] = useState('')
  const [sendMail, setSendMail] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'go' | 'danger'; text: string } | null>(null)
  const load = useCallback(async () => {
    const r = await api<{ owners: Owner[] }>(`/api/admin/music/sheets/${sheet.id}/owners`)
    setOwners(r.owners)
    onCount(r.owners.length)
  }, [sheet.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load().catch(e => setMsg({ tone: 'danger', text: e.message || 'Erreur' })) }, [load])
  const give = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await api<{ email: string; has_account: boolean; emailed: boolean }>(`/api/admin/music/sheets/${sheet.id}/grant`,
        { method: 'POST', body: { email, send_email: sendMail } })
      setMsg({ tone: 'go', text: `Donnée à ${r.email}${r.has_account ? ' (compte existant)' : ' (pas encore de compte : elle apparaîtra à son inscription avec cette adresse)'}${r.emailed ? ', e-mail envoyé' : ''}.` })
      setEmail('')
      await load()
    } catch (e: any) { setMsg({ tone: 'danger', text: e.message || 'Erreur' }) } finally { setBusy(false) }
  }
  const revoke = async (o: Owner) => {
    setMsg(null)
    try {
      await api(`/api/admin/music/sheets/${sheet.id}/grant/${o.order_id}`, { method: 'DELETE' })
      await load()
    } catch (e: any) { setMsg({ tone: 'danger', text: e.message || 'Erreur' }) }
  }
  return (
    <div style={{ padding: '12px 14px', display: 'grid', gap: 10, background: 'var(--bg-soft, rgba(127,127,127,0.06))' }}>
      <div style={{ fontWeight: 600 }}>Propriétaires de « {sheet.piece_title} — {sheet.instrument_label} »</div>
      {owners === null ? <span className="muted">Chargement…</span> : owners.length === 0 ? <span className="muted">Personne pour l’instant.</span> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {owners.map(o => (
            <div key={o.item_id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
              {o.source === 'grant' ? <Chip tone="acc">Don</Chip> : <Chip tone="go">Achat · {eur(o.amount_cents)}</Chip>}
              <span>{o.name ? `${o.name} · ` : ''}{o.email || '—'}</span>
              <span className="muted">{o.has_account ? 'compte' : 'sans compte'} · {day(o.at)}</span>
              {o.source === 'grant' && <Btn small kind="ghost" onClick={() => revoke(o)}>Retirer le don</Btn>}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input type="email" placeholder="adresse e-mail de la personne" aria-label="Adresse e-mail" value={email}
               onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && email) give() }}
               style={{ flex: '1 1 240px', minWidth: 0 }} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={sendMail} onChange={e => setSendMail(e.target.checked)} /> lui envoyer l’e-mail avec le PDF
        </label>
        <Btn small onClick={give} disabled={!email || busy}>{busy ? '…' : 'Donner la partition'}</Btn>
      </div>
      {msg && <InfoBox tone={msg.tone}>{msg.text}</InfoBox>}
    </div>
  )
}

function Sheets({ onChange, unitPrice }: { onChange: () => void; unitPrice: number }) {
  const [open, setOpen] = useState<number | null>(null)
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const h = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(h) }, [q])
  const list = usePaged<Sheet>(`/api/admin/music/sheets?status=${status === 'all' ? '' : status}&q=${encodeURIComponent(debounced)}`, 'sheets')
  const [err, setErr] = useState('')

  const patch = async (s: Sheet, body: object) => {
    setErr('')
    try {
      const r = await api<{ published: boolean; price_cents: number | null }>(`/api/admin/music/sheets/${s.id}`, { method: 'PATCH', body })
      list.update(s.id, { published: r.published, price_cents: r.price_cents,
                          effective_price_cents: r.price_cents ?? unitPrice })
      onChange()
    } catch (e: any) { setErr(e.message || 'Erreur'); throw e }
  }
  const savePrice = async (s: Sheet, cents: number | null) => {
    await patch(s, cents === null ? { reset_price: true } : { price_cents: cents })
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
      {list.error && !list.items.length ? <div style={{ padding: 14 }}><ErrorRetry message={list.error} onRetry={list.reload} /></div>
        : list.loading && !list.items.length ? <p className="muted" style={{ padding: 14, margin: 0 }}>Chargement…</p>
        : list.items.length === 0 ? <p className="muted" style={{ padding: 14, margin: 0 }}>Aucune partition.</p> : (
        <>
          <div className="table-scroll">
            <table className="kc">
              <thead><tr><th>Page 1</th><th>Morceau</th><th>Instrument</th><th>Droits</th><th>Diffusée</th><th>Prix</th><th>Ventes</th><th>Propriétaires</th><th>J’aime</th><th>Sortie</th></tr></thead>
              <tbody>
                {list.items.map(s => (<Fragment key={s.id}>
                  <tr>
                    <td><img src={`${API_URL}${s.preview}`} alt="" loading="lazy" width={44} height={58}
                             style={{ objectFit: 'cover', objectPosition: 'top', borderRadius: 4, border: '1px solid var(--border)', background: '#fff' }} /></td>
                    <td>
                      <a href={s.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: 'inherit' }} title="Ouvrir la fiche de la boutique">{s.piece_title} ↗</a>
                      <div className="muted" style={{ fontSize: 12.5 }}>{s.composer || '—'} · {s.pages} p.{s.has_notes ? ' · lecteur' : ''} · {s.source_ref}</div>
                      <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>{s.published ? 'Voir la page' : 'Voir la page privée'}</a>
                      {s.reel_url && <> · <a href={s.reel_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>Reel</a></>}
                    </td>
                    <td>{s.instrument_label}</td>
                    <td>{s.public_domain ? <Chip tone="go">Domaine public</Chip> : <Chip tone="warn">{s.rights || 'Protégé'}</Chip>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Toggle on={s.published} label={`Diffuser ${s.piece_title}`}
                                onChange={v => { list.update(s.id, { published: v }); patch(s, { published: v }).catch(() => list.update(s.id, { published: !v })) }} />
                        {s.published ? <Chip tone="go">En vente</Chip> : <Chip tone="mut">Privé · non diffusé</Chip>}
                      </div>
                    </td>
                    <td><PriceCell s={s} onSave={c => savePrice(s, c)} /></td>
                    <td>{s.sales ? `${s.sales} · ${eur(s.revenue_cents)}` : '—'}</td>
                    <td><Btn small kind="ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>
                      {s.owners} {open === s.id ? '▴' : '▾'}</Btn></td>
                    <td>{s.likes != null ? s.likes.toLocaleString('fr-FR') : '—'}</td>
                    <td>{day(s.released_at)}</td>
                  </tr>
                  {open === s.id && (
                    <tr><td colSpan={10} style={{ padding: 0 }}><Owners sheet={s} onCount={n => list.update(s.id, { owners: n })} /></td></tr>
                  )}
                </Fragment>))}
              </tbody>
            </table>
          </div>
          <MoreBar shown={list.items.length} total={list.total} next={list.next} loading={list.loading} onMore={list.more} />
        </>
      )}
    </Card>
  )
}

function Pricing({ initial, onSaved }: { initial: Overview['pricing']; onSaved: () => void }) {
  const [unit, setUnit] = useState((initial.unit_price_cents / 100).toFixed(2).replace('.', ','))
  const [bundle, setBundle] = useState(initial.bundle_price_cents != null ? (initial.bundle_price_cents / 100).toFixed(2).replace('.', ',') : '')
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
          Le prix est calculé par le serveur à chaque commande puis donné à Stripe. Une partition peut avoir son prix propre (colonne Prix de l’onglet Partitions).
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
  const { data, error, reload } = useApiResource<{ promos: Promo[] }>('/api/admin/music/promos')
  const [promos, setPromos] = useState<Promo[] | null>(null)
  useEffect(() => { if (data) setPromos(data.promos) }, [data])
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
      const p = await api<Promo>('/api/admin/music/promos', { method: 'POST', body: {
        code: code.trim(), kind, value: v, max_uses: maxUses ? parseInt(maxUses, 10) : null,
        expires_at: expires ? new Date(expires + 'T23:59:59').toISOString() : null, note: note || null } })
      setPromos(prev => [p, ...(prev || [])])
      setCode(''); setValue(''); setMaxUses(''); setExpires(''); setNote('')
    } catch (e: any) { setErr(e.message || 'Erreur') }
  }
  const toggle = async (p: Promo) => {
    setPromos(prev => prev && prev.map(x => (x.id === p.id ? { ...x, active: !p.active } : x)))
    try {
      const r = await api<Promo>(`/api/admin/music/promos/${p.id}`, { method: 'PATCH', body: { active: !p.active } })
      setPromos(prev => prev && prev.map(x => (x.id === p.id ? r : x)))
    } catch (e: any) { setErr(e.message || 'Erreur'); setPromos(prev => prev && prev.map(x => (x.id === p.id ? p : x))) }
  }

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
          <Field label="Valable jusqu’au" hint="Vide = sans fin"><input type="date" value={expires} onChange={e => setExpires(e.target.value)} style={{ width: '100%', padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)' }} /></Field>
          <Field label="Note"><input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Live du 24/11" /></Field>
        </div>
        {err && <div style={{ marginTop: 10 }}><InfoBox tone="danger">{err}</InfoBox></div>}
        <div style={{ marginTop: 12 }}><Btn onClick={create}>Créer le code</Btn></div>
      </Card>
      <Card nopad>
        {error && !promos ? <div style={{ padding: 14 }}><ErrorRetry message={error} onRetry={reload} /></div>
          : !promos ? <p className="muted" style={{ padding: 14, margin: 0 }}>Chargement…</p>
          : promos.length === 0 ? <p className="muted" style={{ padding: 14, margin: 0 }}>Aucun code promo.</p> : (
          <div className="table-scroll">
            <table className="kc">
              <thead><tr><th>Code</th><th>Réduction</th><th>Utilisations</th><th>Fin</th><th>Note</th><th>Actif</th></tr></thead>
              <tbody>
                {promos.map(p => (
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
  const list = usePaged<Order>(`/api/admin/music/orders?status=${status === 'all' ? '' : status}`, 'orders')
  const [msg, setMsg] = useState('')
  const resend = async (o: Order) => {
    setMsg('')
    try { await api(`/api/admin/music/orders/${o.id}/resend`, { method: 'POST' }); setMsg(`E-mail renvoyé à ${o.email}`); list.update(o.id, { emailed_at: new Date().toISOString() }) }
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
        {list.error && !list.items.length ? <div style={{ padding: 14 }}><ErrorRetry message={list.error} onRetry={list.reload} /></div>
          : list.loading && !list.items.length ? <p className="muted" style={{ padding: 14, margin: 0 }}>Chargement…</p>
          : list.items.length === 0 ? <p className="muted" style={{ padding: 14, margin: 0 }}>Aucune commande.</p> : (
          <>
            <div className="table-scroll">
              <table className="kc">
                <thead><tr><th>Date</th><th>Statut</th><th>Client</th><th>Partitions</th><th>Montant</th><th>Code</th><th>Instagram</th><th></th></tr></thead>
                <tbody>
                  {list.items.map(o => (
                    <tr key={o.id}>
                      <td>{day(o.paid_at || o.created_at)}</td>
                      <td>{o.granted ? <Chip tone="acc">Offerte</Chip> : <Chip tone={(STATUS[o.status] || STATUS.expired).tone}>{(STATUS[o.status] || { label: o.status }).label}</Chip>}</td>
                      <td>{o.email || '—'}{o.user_id ? <span className="muted"> · compte</span> : null}</td>
                      <td style={{ fontSize: 13 }}>{o.item_links?.length
                        ? o.item_links.map((l, i) => <span key={i}>{i > 0 && ', '}<a href={l.url} target="_blank" rel="noreferrer">{l.label}</a></span>)
                        : o.items.join(', ')}</td>
                      <td>{eur(o.amount_cents)}{o.discount_cents ? <span className="muted"> (−{eur(o.discount_cents)})</span> : null}</td>
                      <td>{o.promo_code || '—'}</td>
                      <td style={{ fontSize: 13 }}>{o.instagram_username ? <>@{o.instagram_username}<span className="muted"> · {o.instagram_status ? IG[o.instagram_status] || o.instagram_status : 'en attente'}</span></> : '—'}</td>
                      <td>{o.status === 'paid' && o.email && <Btn small kind="ghost" onClick={() => resend(o)}>Renvoyer l’e-mail</Btn>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <MoreBar shown={list.items.length} total={list.total} next={list.next} loading={list.loading} onMore={list.more} />
          </>
        )}
      </Card>
    </div>
  )
}

function Reviews() {
  const list = usePaged<Review>('/api/admin/music/reviews', 'reviews')
  const toggle = async (r: Review) => {
    list.update(r.id, { hidden: !r.hidden })
    try { await api(`/api/admin/music/reviews/${r.id}`, { method: 'PATCH', body: { hidden: !r.hidden } }) }
    catch { list.update(r.id, { hidden: r.hidden }) }
  }
  return (
    <Card nopad>
      <p className="muted" style={{ margin: 0, padding: 14, fontSize: 13.5 }}>
        Avis des acheteurs vérifiés. On peut masquer un avis contraire aux CGU (injurieux, hors sujet, données de tiers) ; on ne modifie jamais son contenu ni sa note.
      </p>
      {list.error && !list.items.length ? <div style={{ padding: 14 }}><ErrorRetry message={list.error} onRetry={list.reload} /></div>
        : list.loading && !list.items.length ? <p className="muted" style={{ padding: 14, margin: 0 }}>Chargement…</p>
        : list.items.length === 0 ? <p className="muted" style={{ padding: 14, margin: 0 }}>Aucun avis pour l’instant.</p> : (
        <>
          <div className="table-scroll">
            <table className="kc">
              <thead><tr><th>Date</th><th>Partition</th><th>Note</th><th>Commentaire</th><th>Compte</th><th>Visible</th></tr></thead>
              <tbody>
                {list.items.map(r => (
                  <tr key={r.id}>
                    <td>{day(r.date)}</td>
                    <td style={{ fontSize: 13 }}>{r.sheet}</td>
                    <td>{'★'.repeat(r.rating)}<span className="muted">{'★'.repeat(5 - r.rating)}</span></td>
                    <td style={{ fontSize: 13, maxWidth: 360 }}>{r.comment || '—'}</td>
                    <td style={{ fontSize: 13 }}>{r.user}</td>
                    <td><Toggle on={!r.hidden} onChange={() => toggle(r)} label="Avis visible" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MoreBar shown={list.items.length} total={list.total} next={list.next} loading={list.loading} onMore={list.more} />
        </>
      )}
    </Card>
  )
}


interface TrackRow {
  code: string; instagram: string | null; source: string | null; sheet_ref: string | null; sent_at: string | null
  sheet?: { title: string; url: string } | null
  first_at: string | null; last_at: string | null; events: number; visits: number; kinds: Record<string, number>
  orders: number; revenue_cents: number
}
interface TrackDetail {
  code: string; instagram: string | null; sent_at: string | null
  events: { at: string; visit: string; kind: string; path: string | null; data: string | null }[]
  orders: { public_id: string; status: string; amount_cents: number; created_at: string; promo_code: string | null }[]
}
const KIND: Record<string, string> = {
  landing: 'Arrivée par le lien', page: 'Page', play: '▶ Lecture', pause: '⏸ Pause', add_to_cart: 'Ajout au panier',
  checkout_open: 'Ouvre le paiement', checkout: 'Lance le paiement', purchase: 'Achat ✓', promo: 'Code promo',
  reel_click: 'Clic vers le Reel', lang: 'Change de langue',
}
const hour = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

/** Liens suivis (?b=…) : qui a cliqué et ce qu'il a fait sur music.chapote.fr (visiteurs qui ont accepté le suivi). */
function Tracking() {
  const [data, setData] = useState<{ links_sent: number; links_with_visits: number; next_offset: number | null; rows: TrackRow[] } | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<TrackDetail | null>(null)
  const load = useCallback(async (offset = 0) => {
    try {
      const r = await api<{ links_sent: number; links_with_visits: number; next_offset: number | null; rows: TrackRow[] }>(`/api/admin/music/tracking?offset=${offset}`)
      setData(d => (offset && d ? { ...r, rows: [...d.rows, ...r.rows] } : r))
    } catch (e: any) { setErr(e.message || 'Erreur') }
  }, [])
  useEffect(() => { load() }, [load])
  const show = async (code: string) => {
    if (open === code) { setOpen(null); return }
    setOpen(code); setDetail(null)
    try { setDetail(await api<TrackDetail>(`/api/admin/music/tracking/${code}`)) } catch (e: any) { setErr(e.message || 'Erreur') }
  }
  if (err && !data) return <ErrorRetry message={err} onRetry={() => { setErr(''); load() }} />
  if (!data) return <p className="muted">Chargement…</p>
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <InfoBox>Chaque lien envoyé après un « SHEET » porte un code (<code>?b=…</code>). Seuls les visiteurs qui acceptent la bannière sont suivis.
        Liens envoyés : <b>{data.links_sent}</b> · liens avec au moins une visite suivie : <b>{data.links_with_visits}</b>.</InfoBox>
      <Card nopad>
        {data.rows.length === 0 ? <p className="muted" style={{ padding: 14, margin: 0 }}>Aucune visite suivie pour l’instant.</p> : (
          <div className="table-scroll">
            <table className="kc">
              <thead><tr><th>Instagram</th><th>Code</th><th>Envoyé</th><th>Dernière visite</th><th>Visites</th><th>Lectures</th><th>Panier</th><th>Paiement</th><th>Achats</th><th></th></tr></thead>
              <tbody>
                {data.rows.map(r => (<Fragment key={r.code}>
                  <tr>
                    <td>{r.instagram ? `@${r.instagram}` : <span className="muted">inconnu</span>}<div style={{ fontSize: 12 }}>{r.sheet ? <a href={r.sheet.url} target="_blank" rel="noreferrer">{r.sheet.title} ↗</a> : <span className="muted">{r.sheet_ref || ''}</span>}</div></td>
                    <td><code>{r.code}</code></td>
                    <td>{hour(r.sent_at)}</td>
                    <td>{hour(r.last_at)}</td>
                    <td>{r.visits}</td>
                    <td>{r.kinds.play || 0}</td>
                    <td>{r.kinds.add_to_cart || 0}</td>
                    <td>{(r.kinds.checkout_open || 0) + (r.kinds.checkout || 0)}</td>
                    <td>{r.orders ? <Chip tone="go">{r.orders} · {eur(r.revenue_cents)}</Chip> : '—'}</td>
                    <td><Btn small kind="ghost" onClick={() => show(r.code)}>{open === r.code ? 'Fermer' : 'Parcours'}</Btn></td>
                  </tr>
                  {open === r.code && (
                    <tr><td colSpan={10} style={{ padding: '10px 14px' }}>
                      {!detail ? <span className="muted">Chargement…</span> : (
                        <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13.5 }}>
                          {detail.events.map((e, i) => (
                            <li key={i}><span className="muted">{hour(e.at)} · visite {e.visit.slice(0, 4)}</span> — <b>{KIND[e.kind] || e.kind}</b>
                              {e.path ? <span className="muted"> · {e.path}</span> : null}{e.data ? <span className="muted"> · {e.data}</span> : null}</li>
                          ))}
                          {detail.orders.map(o => (
                            <li key={o.public_id}><b>Commande {STATUS[o.status]?.label || o.status}</b> · {eur(o.amount_cents)}{o.promo_code ? ` · ${o.promo_code}` : ''} · {hour(o.created_at)}</li>
                          ))}
                        </ol>
                      )}
                    </td></tr>
                  )}
                </Fragment>))}
              </tbody>
            </table>
          </div>
        )}
        {data.next_offset != null && <div style={{ padding: 14 }}><Btn small kind="ghost" onClick={() => load(data.next_offset!)}>Charger plus</Btn></div>}
      </Card>
    </div>
  )
}
