// Console ADMIN FACTURATION — VUE D'ENSEMBLE (/admin/billing) — SUPERADMIN UNIQUEMENT.
// La route est protégée côté front (Protected adminOnly) ET côté serveur (toutes
// les routes /api/admin/* dépendent de la dépendance superadmin de admin.py). Le
// front masque en plus (garde + entrée visible seulement dans le back-office).
//
// Cette page ne porte QUE la vue d'ensemble :
//   - bandeau MRR + KPIs (payeurs actifs, nb de factures) ;
//   - tableau des payeurs (clients facturés) avec leurs bots ;
//   - éditeur d'entitlement par bot en MODALE (override manuel source='staff',
//     POST .../entitlement, SANS Stripe).
// Les Factures et le Catalogue sont désormais des SOUS-PAGES dédiées :
//   - /admin/billing/invoices  (AdminBillingInvoices)
//   - /admin/billing/catalog   (AdminBillingCatalog)
//
// INVARIANT billing-OFF : les routes admin renvoient { billing: 'disabled' } quand
// billing_enabled()==False. On détecte cette sentinelle et on n'affiche QU'UNE
// InfoBox « facturation désactivée » — aucun crash, aucune table vide mensongère.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreditCard, ReceiptText, Users } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, InfoBox, SectionTitle, Stat, Toggle } from '../ui'
import { errMsg } from '../utils/errors'
import type {
  AdminBillingOverview,
  AdminBotEntitlement,
  AdminPayer,
  AdminPayerBot,
  Invoice,
  ModuleKey,
} from '../types/billing'

// Clés de module débloquables — strictement alignées sur core/constants.MODULE_KEYS
// (ordre stable). Le backend valide modules ⊂ MODULE_KEYS au POST ; on liste ici
// le même ensemble pour l'éditeur de toggles.
const MODULE_LABELS: { key: ModuleKey; label: string }[] = [
  { key: 'ai', label: 'IA' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'rag', label: 'Base de connaissances' },
  { key: 'actions', label: 'Actions' },
  { key: 'ab', label: 'A/B testing' },
  { key: 'white_label', label: 'Marque blanche' },
]

function fmtEur(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

// Sentinelle billing-OFF : les routes admin renvoient { billing: 'disabled' }.
function isDisabled(x: unknown): boolean {
  return !!x && typeof x === 'object' && (x as { billing?: string }).billing === 'disabled'
}

function payerStatusChip(status: AdminPayer['status']) {
  if (status === 'active') return <Chip tone="go">Actif</Chip>
  if (status === 'past_due') return <Chip tone="danger">Paiement en retard</Chip>
  return <Chip tone="mut">Aucun</Chip>
}

function scopeChip(scope: AdminPayerBot['scope']) {
  return <Chip tone="mut">{scope === 'personal' ? 'Perso' : 'Équipe'}</Chip>
}

export default function AdminBilling() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [overview, setOverview] = useState<AdminBillingOverview | null>(null)
  const [billingOff, setBillingOff] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Nombre de factures — alimente uniquement le KPI « Factures » de cette vue
  // (le détail vit sur la sous-page /admin/billing/invoices).
  const [invoiceCount, setInvoiceCount] = useState<number | null>(null)

  // Bot dont l'éditeur d'entitlement est ouvert (modale).
  const [editingBot, setEditingBot] = useState<AdminPayerBot | null>(null)

  // Compteur de rechargement après un override d'entitlement.
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])
  const [resyncBusy, setResyncBusy] = useState(false)
  const [resyncMsg, setResyncMsg] = useState('')

  const doResync = useCallback(async () => {
    setResyncBusy(true); setResyncMsg('')
    try {
      const r = await api<{ payers: number; subscriptions: number; bots_touched: number } | { billing: 'disabled' }>(
        '/api/admin/billing/reconcile', { method: 'POST' })
      if (isDisabled(r)) {
        setResyncMsg('Facturation désactivée.')
      } else {
        const ok = r as { payers: number; subscriptions: number; bots_touched: number }
        setResyncMsg(`Resync OK : ${ok.subscriptions} abonnement(s), ${ok.bots_touched} bot(s) mis à jour.`)
      }
      reload()
    } catch (err: unknown) {
      setResyncMsg(errMsg(err, 'Resync impossible.'))
    } finally {
      setResyncBusy(false)
    }
  }, [reload])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    api<AdminBillingOverview | { billing: 'disabled' }>('/api/admin/billing/overview')
      .then(d => {
        if (!alive) return
        if (isDisabled(d)) { setBillingOff(true); setOverview(null) }
        else { setBillingOff(false); setOverview(d as AdminBillingOverview) }
      })
      .catch((err: unknown) => { if (alive) setError(errMsg(err, 'Chargement impossible.')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [tick])

  // Compteur de factures pour le KPI — seulement si le billing est actif.
  useEffect(() => {
    if (billingOff) return
    let alive = true
    api<Invoice[] | { billing: 'disabled' }>('/api/admin/billing/invoices')
      .then(d => {
        if (!alive) return
        setInvoiceCount(isDisabled(d) ? 0 : (d as Invoice[]).length)
      })
      .catch(() => { if (alive) setInvoiceCount(null) })
    return () => { alive = false }
  }, [billingOff, tick])

  // --- Garde superadmin (défense en profondeur ; la route est déjà protégée) ---
  if (!user?.is_superadmin) {
    return (
      <div className="col g18">
        <SectionTitle>Facturation</SectionTitle>
        <InfoBox tone="danger" title="Accès refusé">
          Cette console est réservée au staff Chapote.
        </InfoBox>
      </div>
    )
  }

  if (loading) return <div className="center-page">Chargement…</div>

  if (error) {
    return (
      <div className="col g18">
        <Header navigate={navigate} />
        <InfoBox tone="danger" title="Impossible de charger la facturation">
          {error}
          <div style={{ marginTop: 12 }}>
            <Btn kind="ghost" small onClick={reload}>Réessayer</Btn>
          </div>
        </InfoBox>
      </div>
    )
  }

  // --- INVARIANT billing-OFF : InfoBox seule (pas de table vide mensongère) -------
  // Le catalogue local (billing_products) reste visible et éditable sur sa sous-page
  // dédiée (/admin/billing/catalog), même billing OFF.
  if (billingOff) {
    return (
      <div className="col g18">
        <Header navigate={navigate} />
        <InfoBox tone="info" title="Facturation désactivée">
          La facturation est désactivée sur cette instance (aucune clé Stripe configurée).
          Toutes les capacités sont incluses gratuitement pour les clients. Activez le
          billing côté serveur pour piloter les abonnements et entitlements ici. Le
          catalogue local reste consultable et éditable.
        </InfoBox>
      </div>
    )
  }

  const payers = overview?.payers ?? []
  const activePayers = payers.filter(p => p.status === 'active').length

  return (
    <div className="col g18">
      <Header navigate={navigate} onResync={doResync} resyncBusy={resyncBusy} />
      {resyncMsg && <InfoBox tone="info">{resyncMsg}</InfoBox>}

      {/* ---- Bandeau MRR + KPIs ---- */}
      <div className="stat-row">
        <Stat label="MRR" value={fmtEur(overview?.mrr_cents ?? 0)} icon={<CreditCard size={15} />}
              sub="revenu mensuel récurrent" />
        <Stat label="Payeurs actifs" value={activePayers} icon={<Users size={15} />}
              sub={`sur ${payers.length} client${payers.length > 1 ? 's' : ''} facturé${payers.length > 1 ? 's' : ''}`} />
        <Stat label="Factures" value={invoiceCount == null ? '…' : invoiceCount}
              icon={<ReceiptText size={15} />} sub="émises sur le compte" />
      </div>

      {/* ---- Vue clients ---- */}
      <div>
        <div className="card-title" style={{ marginBottom: 11 }}>Clients facturés</div>
        {payers.length === 0 ? (
          <Card style={{ color: 'var(--faint)' }}>Aucun client facturé pour le moment.</Card>
        ) : (
          <Card nopad>
            <table className="kc">
              <thead>
                <tr>
                  <th>Client</th><th>Statut</th><th>Mensuel</th>
                  <th>Abos</th><th>Stripe</th><th>Bots</th>
                </tr>
              </thead>
              <tbody>
                {payers.map(p => (
                  <tr key={p.user_id}>
                    <td>
                      <span style={{ display: 'block', fontWeight: 700 }}>{p.name}</span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--faint)' }}>{p.email}</span>
                    </td>
                    <td>{payerStatusChip(p.status)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmtEur(p.monthly_cents)}</td>
                    <td className="num" style={{ color: 'var(--mut)' }}>{p.subscription_count}</td>
                    <td style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'monospace' }}>
                      {p.stripe_customer_id || '—'}
                    </td>
                    <td>
                      <div className="col" style={{ gap: 6 }}>
                        {p.bots.length === 0 && <span style={{ color: 'var(--faint)', fontSize: 12 }}>—</span>}
                        {p.bots.map(b => (
                          <div key={b.bot_id} className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, fontSize: 12.5 }}>{b.name}</span>
                            {scopeChip(b.scope)}
                            {b.source === 'staff' && <Chip tone="warn">Override staff</Chip>}
                            <span style={{ fontSize: 11, color: 'var(--mut)' }}>
                              {b.modules.length} module{b.modules.length > 1 ? 's' : ''}
                              {b.ai_monthly_quota != null && ` · quota ${b.ai_monthly_quota.toLocaleString('fr-FR')}`}
                            </span>
                            <Btn kind="ghost" small onClick={() => setEditingBot(b)}>Entitlements</Btn>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {/* ---- Éditeur d'entitlements (modale) ---- */}
      {editingBot && (
        <EntitlementEditor
          bot={editingBot}
          onClose={() => setEditingBot(null)}
          onSaved={() => { setEditingBot(null); reload() }}
        />
      )}
    </div>
  )
}

function Header({ navigate, onResync, resyncBusy }: {
  navigate: ReturnType<typeof useNavigate>
  onResync?: () => void
  resyncBusy?: boolean
}) {
  return (
    <SectionTitle sub="Vue d'ensemble des abonnements et entitlements — staff uniquement."
                  right={
                    <div className="row g8">
                      {onResync && (
                        <Btn kind="ghost" small onClick={onResync} disabled={resyncBusy}>
                          {resyncBusy ? 'Resync…' : '↻ Resync Stripe'}
                        </Btn>
                      )}
                      <Btn kind="ghost" small onClick={() => navigate('/admin/billing/invoices')}>Factures</Btn>
                      <Btn kind="ghost" small onClick={() => navigate('/admin/billing/catalog')}>Catalogue</Btn>
                      <Btn kind="ghost" small onClick={() => navigate('/admin')}>← Dashboard</Btn>
                    </div>
                  }>
      Facturation
    </SectionTitle>
  )
}

// ---------------------------------------------------------------------------
// Éditeur d'entitlement d'un bot : charge l'état courant (GET .../entitlement),
// permet de basculer les modules + fixer le quota IA, puis POST l'override manuel
// (source='staff', SANS Stripe). La validation modules ⊂ MODULE_KEYS est refaite
// côté serveur ; ici on n'expose QUE les clés valides.
// ---------------------------------------------------------------------------
function EntitlementEditor({ bot, onClose, onSaved }: {
  bot: AdminPayerBot
  onClose: () => void
  onSaved: () => void
}) {
  const [ent, setEnt] = useState<AdminBotEntitlement | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [modules, setModules] = useState<Set<ModuleKey>>(new Set())
  const [quotaStr, setQuotaStr] = useState('') // vide = illimité (null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError('')
    api<AdminBotEntitlement | { billing: 'disabled' }>(`/api/admin/bots/${bot.bot_id}/entitlement`)
      .then(d => {
        if (!alive) return
        if (isDisabled(d)) { setLoadError('Facturation désactivée.'); return }
        const e = d as AdminBotEntitlement
        setEnt(e)
        setModules(new Set(e.modules.filter((m): m is ModuleKey =>
          MODULE_LABELS.some(ml => ml.key === m))))
        setQuotaStr(e.ai_monthly_quota == null ? '' : String(e.ai_monthly_quota))
      })
      .catch((err: unknown) => { if (alive) setLoadError(errMsg(err, 'Chargement impossible.')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [bot.bot_id])

  function toggleModule(key: ModuleKey, on: boolean) {
    setModules(prev => {
      const next = new Set(prev)
      if (on) next.add(key); else next.delete(key)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setSaveError('')
    const trimmed = quotaStr.trim()
    const quota = trimmed === '' ? null : Number(trimmed)
    if (quota != null && (!Number.isInteger(quota) || quota < 0)) {
      setSaveError('Le quota doit être un entier positif (ou vide pour illimité).')
      setSaving(false)
      return
    }
    try {
      await api(`/api/admin/bots/${bot.bot_id}/entitlement`, {
        method: 'POST',
        body: {
          modules: MODULE_LABELS.filter(m => modules.has(m.key)).map(m => m.key),
          ai_monthly_quota: quota,
          status: ent?.status,
        },
      })
      onSaved()
    } catch (err: unknown) {
      setSaveError(errMsg(err, "L'enregistrement a échoué."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(28,63,92,.45)',
      backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <Card style={{ maxWidth: 480, width: '100%', padding: '26px 24px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Entitlements — {bot.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 4 }}>
          Override manuel (source <code>staff</code>) — applique les modules et le quota
          sans passer par Stripe.
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--mut)', marginTop: 18 }}>Chargement…</div>
        ) : loadError ? (
          <div className="error" style={{ marginTop: 18 }}>{loadError}</div>
        ) : (
          <>
            {ent && ent.source !== 'staff' && (
              <InfoBox tone="warn" title="Source actuelle : Stripe">
                Cet entitlement est piloté par Stripe (<code>source={ent.source}</code>).
                Enregistrer ici le passera en override manuel <code>staff</code>.
              </InfoBox>
            )}

            <div style={{ marginTop: 16 }}>
              <div className="field-label">Modules débloqués</div>
              <div className="col" style={{ gap: 8, marginTop: 8 }}>
                {MODULE_LABELS.map(m => (
                  <div key={m.key} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10,
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {m.label} <span style={{ color: 'var(--faint)', fontWeight: 400, fontSize: 11 }}>({m.key})</span>
                    </span>
                    <Toggle on={modules.has(m.key)} onChange={v => toggleModule(m.key, v)} disabled={saving} />
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'block' }}>
                <span className="field-label">Quota IA mensuel</span>
                <input type="number" min={0} step={1} value={quotaStr}
                       placeholder="Vide = illimité"
                       onChange={e => setQuotaStr(e.target.value)} disabled={saving}
                       style={{ width: '100%' }} />
                <div className="field-hint">Laissez vide pour un quota illimité (null).</div>
              </label>
            </div>

            {saveError && <div className="error" style={{ marginTop: 12 }}>{saveError}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <Btn kind="ghost" onClick={onClose} disabled={saving}>Annuler</Btn>
              <Btn kind="primary" onClick={save} disabled={saving}>
                {saving ? 'Enregistrement…' : 'Enregistrer (staff)'}
              </Btn>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
