// Sous-page ADMIN FACTURATION — CATALOGUE (/admin/billing/catalog).
// SUPERADMIN UNIQUEMENT (route protégée front + serveur). Extraite de la console
// monolithique : édition de la table billing_products — libellé (PATCH label),
// quota inclus pour les paliers IA (PATCH included_replies), statut actif
// (PATCH is_active) et CHANGEMENT DE PRIX (POST .../price → nouveau Price Stripe +
// désactivation de l'ancien, les abonnés existants gardent l'ancien prix).
//
// GET /api/admin/billing/catalog renvoie TOUJOURS un tableau bare des lignes
// LOCALES, même billing OFF (pour visualiser/éditer le local) — donc PAS de
// sentinelle { billing:'disabled' } ici. On détecte néanmoins l'état billing via
// l'overview pour afficher l'encart « édition locale uniquement ».
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, InfoBox, SectionTitle, Toggle } from '../ui'
import { errMsg } from '../utils/errors'
import type { AdminBillingOverview, CatalogProduct } from '../types/billing'

// Libellés humains des kinds du catalogue (CatalogProduct.kind).
const KIND_LABELS: Record<CatalogProduct['kind'], string> = {
  base: 'Base', ai_tier: 'Palier IA', module: 'Module', metered: 'À l’usage',
}

function fmtEur(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

// Sentinelle billing-OFF : les routes admin renvoient { billing: 'disabled' }.
function isDisabled(x: unknown): boolean {
  return !!x && typeof x === 'object' && (x as { billing?: string }).billing === 'disabled'
}

export default function AdminBillingCatalog() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [billingOff, setBillingOff] = useState(false)
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null)
  const [error, setError] = useState('')
  // Code dont le prix est en cours de changement (modale dédiée).
  const [pricing, setPricing] = useState<CatalogProduct | null>(null)

  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  // État billing (pour l'encart « édition locale ») — best-effort, non bloquant.
  useEffect(() => {
    let alive = true
    api<AdminBillingOverview | { billing: 'disabled' }>('/api/admin/billing/overview')
      .then(d => { if (alive) setBillingOff(isDisabled(d)) })
      .catch(() => { /* l'état billing reste optimiste ; le catalogue se charge à part */ })
    return () => { alive = false }
  }, [tick])

  // Catalogue — chargé INCONDITIONNELLEMENT (même billing OFF) : la route renvoie
  // les lignes locales billing_products dans tous les cas.
  useEffect(() => {
    let alive = true
    setError('')
    api<CatalogProduct[]>('/api/admin/billing/catalog')
      .then(d => { if (alive) setCatalog(Array.isArray(d) ? d : []) })
      .catch((err: unknown) => { if (alive) setError(errMsg(err, 'Erreur')) })
    return () => { alive = false }
  }, [tick])

  // --- Garde superadmin (défense en profondeur ; la route est déjà protégée) ---
  if (!user?.is_superadmin) {
    return (
      <div className="col g18">
        <SectionTitle>Catalogue</SectionTitle>
        <InfoBox tone="danger" title="Accès refusé">
          Cette console est réservée au staff Chapote.
        </InfoBox>
      </div>
    )
  }

  return (
    <div className="col g18">
      <Header navigate={navigate} />

      {billingOff && (
        <InfoBox tone="warn" title="Édition locale uniquement">
          La facturation est désactivée : vous pouvez éditer les lignes du catalogue
          local, mais les changements ne seront <strong>poussés à Stripe</strong> (produits
          et prix) qu'une fois la facturation activée côté serveur.
        </InfoBox>
      )}

      <div>
        <div className="card-title" style={{ marginBottom: 11 }}>Catalogue (produits & prix)</div>
        {error ? (
          <Card><div className="error">{error}</div></Card>
        ) : catalog == null ? (
          <Card style={{ color: 'var(--faint)' }}>Chargement…</Card>
        ) : catalog.length === 0 ? (
          <Card style={{ color: 'var(--faint)' }}>Aucun produit dans le catalogue local.</Card>
        ) : (
          <Card nopad>
            <table className="kc">
              <thead>
                <tr>
                  <th>Code</th><th>Libellé</th><th>Type</th>
                  <th>Prix</th><th>Réponses incluses</th><th>Actif</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map(p => (
                  <CatalogRow
                    key={p.code} product={p}
                    onEditPrice={() => setPricing(p)}
                    onChanged={reload}
                  />
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {pricing && (
        <PriceEditor
          product={pricing} billingOff={billingOff}
          onClose={() => setPricing(null)}
          onSaved={() => { setPricing(null); reload() }}
        />
      )}
    </div>
  )
}

function Header({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <SectionTitle sub="Produits, prix et quotas du catalogue de facturation — staff uniquement."
                  right={<Btn kind="ghost" small onClick={() => navigate('/admin/billing')}>← Vue d'ensemble</Btn>}>
      Catalogue
    </SectionTitle>
  )
}

// Une ligne du catalogue : label éditable (PATCH label), quota inclus éditable
// pour kind='ai_tier' (PATCH included_replies), toggle actif (PATCH is_active),
// et bouton « Changer le prix » (ouvre la modale PriceEditor → POST .../price).
function CatalogRow({ product, onEditPrice, onChanged }: {
  product: CatalogProduct
  onEditPrice: () => void
  onChanged: () => void
}) {
  const [label, setLabel] = useState(product.label)
  const [repliesStr, setRepliesStr] = useState(
    product.included_replies == null ? '' : String(product.included_replies),
  )
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState('')

  // Resynchronise les champs locaux quand la ligne est rechargée (après mutation).
  useEffect(() => { setLabel(product.label) }, [product.label])
  useEffect(() => {
    setRepliesStr(product.included_replies == null ? '' : String(product.included_replies))
  }, [product.included_replies])

  async function patch(body: { label?: string; is_active?: boolean; included_replies?: number | null }) {
    setBusy(true)
    setRowError('')
    try {
      await api<CatalogProduct>(`/api/admin/billing/catalog/${product.code}`, { method: 'PATCH', body })
      onChanged()
    } catch (err: unknown) {
      setRowError(errMsg(err, 'La mise à jour a échoué.'))
    } finally {
      setBusy(false)
    }
  }

  function saveLabel() {
    const next = label.trim()
    if (next === '' || next === product.label) { setLabel(product.label); return }
    patch({ label: next })
  }

  function saveReplies() {
    const trimmed = repliesStr.trim()
    const value = trimmed === '' ? null : Number(trimmed)
    if (value != null && (!Number.isInteger(value) || value < 0)) {
      setRowError('Les réponses incluses doivent être un entier positif (ou vide).')
      setRepliesStr(product.included_replies == null ? '' : String(product.included_replies))
      return
    }
    if (value === product.included_replies) return
    patch({ included_replies: value })
  }

  return (
    <tr>
      <td style={{ fontFamily: 'monospace', fontSize: 11.5, color: 'var(--mut)' }}>{product.code}</td>
      <td>
        <input value={label} onChange={e => setLabel(e.target.value)}
               onBlur={saveLabel}
               onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
               disabled={busy} style={{ width: '100%', minWidth: 140 }} />
        {rowError && <div className="error" style={{ marginTop: 4, fontSize: 11.5 }}>{rowError}</div>}
      </td>
      <td><Chip tone="mut">{KIND_LABELS[product.kind]}</Chip></td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>
        <div className="row g8" style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
          <span style={{ fontWeight: 700 }}>{fmtEur(product.unit_amount)}</span>
          <Btn kind="ghost" small onClick={onEditPrice} disabled={busy}>Changer le prix</Btn>
        </div>
      </td>
      <td className="num">
        {product.kind === 'ai_tier' ? (
          <input type="number" min={0} step={1} value={repliesStr}
                 placeholder="—"
                 onChange={e => setRepliesStr(e.target.value)}
                 onBlur={saveReplies}
                 onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                 disabled={busy} style={{ width: 96 }} />
        ) : (
          <span style={{ color: 'var(--faint)' }}>—</span>
        )}
      </td>
      <td>
        <Toggle on={product.is_active} disabled={busy}
                onChange={v => patch({ is_active: v })} />
      </td>
    </tr>
  )
}

// Modale de CHANGEMENT DE PRIX. Saisie en EUROS (converti en centimes pour le
// contrat unit_amount:int). AVERTISSEMENT explicite : Stripe ne rétro-applique
// pas, les abonnés actuels gardent l'ancien prix (un nouveau Price est créé et
// l'ancien désactivé). Billing OFF : la mise à jour reste locale (pas de Stripe).
function PriceEditor({ product, billingOff, onClose, onSaved }: {
  product: CatalogProduct
  billingOff: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [eurosStr, setEurosStr] = useState((product.unit_amount / 100).toString())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  async function save() {
    setSaveError('')
    const euros = Number(eurosStr.replace(',', '.').trim())
    if (!Number.isFinite(euros) || euros < 0) {
      setSaveError('Saisissez un montant en euros positif (ou 0).')
      return
    }
    const cents = Math.round(euros * 100)
    setSaving(true)
    try {
      await api<CatalogProduct>(`/api/admin/billing/catalog/${product.code}/price`, {
        method: 'POST',
        body: { unit_amount: cents },
      })
      onSaved()
    } catch (err: unknown) {
      setSaveError(errMsg(err, 'Le changement de prix a échoué.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(28,63,92,.45)',
      backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <Card style={{ maxWidth: 440, width: '100%', padding: '26px 24px' }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Changer le prix — {product.label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 4 }}>
          Prix actuel : <strong>{fmtEur(product.unit_amount)}</strong>
          <span style={{ color: 'var(--faint)' }}> / {product.interval}</span>
        </div>

        <InfoBox tone="warn" title="Les abonnés actuels gardent l'ancien prix">
          {billingOff
            ? <>La facturation est désactivée : seul le montant local sera mis à jour
                (aucun appel Stripe). Une fois le billing actif, ce montant servira de base
                pour le futur Price Stripe.</>
            : <>Un <strong>nouveau Price</strong> Stripe sera créé et l'ancien désactivé.
                Stripe ne rétro-applique pas : les abonnements en cours conservent leur tarif
                jusqu'à un changement explicite.</>}
        </InfoBox>

        <div style={{ marginTop: 16 }}>
          <label style={{ display: 'block' }}>
            <span className="field-label">Nouveau montant (€)</span>
            <input type="number" min={0} step="0.01" value={eurosStr}
                   onChange={e => setEurosStr(e.target.value)} disabled={saving}
                   style={{ width: '100%' }} autoFocus />
            <div className="field-hint">Montant TTC en euros — converti en centimes ({product.currency.toUpperCase()}).</div>
          </label>
        </div>

        {saveError && <div className="error" style={{ marginTop: 12 }}>{saveError}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <Btn kind="ghost" onClick={onClose} disabled={saving}>Annuler</Btn>
          <Btn kind="primary" onClick={save} disabled={saving}>
            {saving ? 'Application…' : 'Appliquer le nouveau prix'}
          </Btn>
        </div>
      </Card>
    </div>
  )
}
