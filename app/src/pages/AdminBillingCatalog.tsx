// Sous-page ADMIN FACTURATION — CATALOGUE (/admin/billing/catalog).
// SUPERADMIN UNIQUEMENT (route protégée front + serveur). Édition de la table
// billing_products — libellé (PATCH label),
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
import { Btn, Card, Chip, InfoBox, Modal, SectionTitle, Toggle } from '../ui'
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
  const [tab, setTab] = useState<'products' | 'presets'>('products')

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

      <div className="tabs">
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>
          Produits &amp; prix
        </button>
        <button className={tab === 'presets' ? 'active' : ''} onClick={() => setTab('presets')}>
          Présélections
        </button>
      </div>

      {tab === 'products' ? (
        <div className="col g10">
          <p style={{ fontSize: 12.5, color: 'var(--mut)', margin: 0, lineHeight: 1.5 }}>
            Libellés, prix (un changement crée un nouveau Price Stripe et désactive l'ancien),
            quotas IA, remise d'intro du 1er mois et activation.
          </p>
          {error ? (
            <Card><div className="error">{error}</div></Card>
          ) : catalog == null ? (
            <Card style={{ color: 'var(--faint)' }}>Chargement…</Card>
          ) : catalog.length === 0 ? (
            <Card style={{ color: 'var(--faint)' }}>Aucun produit dans le catalogue local.</Card>
          ) : (
            <Card nopad>
              <div className="table-scroll">
              <table className="kc">
                <thead>
                  <tr>
                    <th>Code</th><th>Libellé</th><th>Type</th>
                    <th>Prix</th><th>Réponses incluses</th><th>Intro 1er mois</th><th>Actif</th><th></th>
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
              </div>
            </Card>
          )}
        </div>
      ) : (
        <PresetsSection tiers={(catalog ?? []).filter(p => p.kind === 'ai_tier')} />
      )}

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
  const [introStr, setIntroStr] = useState(
    product.intro_percent == null ? '' : String(product.intro_percent),
  )
  const [activeLocal, setActiveLocal] = useState(product.is_active)
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState('')

  // Resynchronise les champs locaux quand la ligne est rechargée (après mutation).
  useEffect(() => { setLabel(product.label) }, [product.label])
  useEffect(() => {
    setRepliesStr(product.included_replies == null ? '' : String(product.included_replies))
  }, [product.included_replies])
  useEffect(() => {
    setIntroStr(product.intro_percent == null ? '' : String(product.intro_percent))
  }, [product.intro_percent])
  useEffect(() => { setActiveLocal(product.is_active) }, [product.is_active])

  // Remise d'intro (1er mois) : éditable sur les paliers IA + le socle ('base').
  const introEditable = product.kind === 'ai_tier' || product.code === 'base'

  // Valeurs saisies normalisées + détection des champs modifiés (pas de save
  // automatique : l'enregistrement est déclenché explicitement par le bouton).
  const labelTrim = label.trim()
  const repliesVal = repliesStr.trim() === '' ? null : Number(repliesStr.trim())
  const introVal = introStr.trim() === '' ? 0 : Number(introStr.trim())
  const labelChanged = labelTrim !== '' && labelTrim !== product.label
  const repliesChanged = product.kind === 'ai_tier' && repliesVal !== (product.included_replies ?? null)
  const introChanged = introEditable && introVal !== (product.intro_percent ?? 0)
  const activeChanged = activeLocal !== product.is_active
  const dirty = labelChanged || repliesChanged || introChanged || activeChanged

  function discard() {
    setLabel(product.label)
    setRepliesStr(product.included_replies == null ? '' : String(product.included_replies))
    setIntroStr(product.intro_percent == null ? '' : String(product.intro_percent))
    setActiveLocal(product.is_active)
    setRowError('')
  }

  // Enregistrement EXPLICITE : un seul PATCH pour label/quota/actif + un POST
  // dédié pour la remise d'intro (rotation du coupon Stripe côté serveur).
  async function save() {
    if (!dirty) return
    setRowError('')
    if (repliesChanged && repliesVal != null && (!Number.isInteger(repliesVal) || repliesVal < 0)) {
      setRowError('Les réponses incluses doivent être un entier positif (ou vide).')
      return
    }
    if (introChanged && (!Number.isInteger(introVal) || introVal < 0 || introVal > 100)) {
      setRowError('La remise d’intro doit être un entier entre 0 et 100 (vide = 0).')
      return
    }
    setBusy(true)
    try {
      const body: { label?: string; included_replies?: number | null; is_active?: boolean } = {}
      if (labelChanged) body.label = labelTrim
      if (repliesChanged) body.included_replies = repliesVal
      if (activeChanged) body.is_active = activeLocal
      if (Object.keys(body).length > 0) {
        await api<CatalogProduct>(`/api/admin/billing/catalog/${product.code}`, { method: 'PATCH', body })
      }
      if (introChanged) {
        await api<CatalogProduct>(`/api/admin/billing/catalog/${product.code}/intro`,
          { method: 'POST', body: { intro_percent: introVal } })
      }
      onChanged()
    } catch (err: unknown) {
      setRowError(errMsg(err, "L'enregistrement a échoué."))
    } finally {
      setBusy(false)
    }
  }

  const onEnterSave = (e: React.KeyboardEvent) => { if (e.key === 'Enter') save() }

  return (
    <tr>
      <td style={{ fontFamily: 'monospace', fontSize: 11.5, color: 'var(--mut)' }}>{product.code}</td>
      <td>
        <input type="text" value={label} onChange={e => setLabel(e.target.value)}
               onKeyDown={onEnterSave}
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
                 onKeyDown={onEnterSave}
                 disabled={busy} style={{ width: 96 }} />
        ) : (
          <span style={{ color: 'var(--faint)' }}>—</span>
        )}
      </td>
      <td className="num">
        {introEditable ? (
          <div className="row g6" style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
            <input type="number" min={0} max={100} step={1} value={introStr}
                   placeholder="0"
                   onChange={e => setIntroStr(e.target.value)}
                   onKeyDown={onEnterSave}
                   disabled={busy} style={{ width: 60 }} />
            <span style={{ color: 'var(--mut)' }}>%</span>
          </div>
        ) : (
          <span style={{ color: 'var(--faint)' }}>—</span>
        )}
      </td>
      <td>
        <Toggle label="Produit actif" on={activeLocal} disabled={busy}
                onChange={setActiveLocal} />
      </td>
      <td>
        <div className="row g6" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          {dirty && (
            <Btn kind="ghost" small onClick={discard} disabled={busy}>Annuler</Btn>
          )}
          <Btn kind="primary" small onClick={save} disabled={busy || !dirty}>
            {busy ? 'Enregistrement…' : 'Sauvegarder'}
          </Btn>
        </div>
      </td>
    </tr>
  )
}

// --- Présélections (bundles) éditables : GET/POST/PATCH/DELETE presets -----

interface AdminPreset {
  key: string
  label: string
  tagline: string
  ai_tier_id: string | null
  modules: string[]
  recommended: boolean
  sort_order: number
  is_active: boolean
}

// Modules proposables dans une présélection (clés d'entitlement, hors 'ai' porté
// par le palier). Liste stable staff — alignée sur MODULE_KEYS backend.
const PRESET_MODULES: { key: string; label: string }[] = [
  { key: 'rag', label: 'RAG' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'actions', label: 'Actions' },
  { key: 'mcp', label: 'MCP' },
  { key: 'ab', label: 'A/B' },
  { key: 'white_label', label: 'White-label' },
]

function PresetsSection({ tiers }: { tiers: CatalogProduct[] }) {
  const [presets, setPresets] = useState<AdminPreset[] | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let alive = true
    api<AdminPreset[]>('/api/admin/billing/presets')
      .then(d => { if (alive) setPresets(d) })
      .catch(e => { if (alive) setError(errMsg(e, 'Chargement des présélections impossible.')) })
    return () => { alive = false }
  }, [tick])

  async function addPreset() {
    setError('')
    const nextOrder = presets && presets.length ? Math.max(...presets.map(p => p.sort_order)) + 10 : 10
    try {
      await api('/api/admin/billing/presets', { method: 'POST', body: {
        key: `preset_${Date.now()}`, label: 'Nouvelle présélection', tagline: '',
        ai_tier_id: null, modules: [], recommended: false, sort_order: nextOrder, is_active: true,
      } })
      reload()
    } catch (e: unknown) { setError(errMsg(e, 'Création impossible.')) }
  }

  return (
    <div className="col g10">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <p style={{ fontSize: 12.5, color: 'var(--mut)', margin: 0, lineHeight: 1.5, maxWidth: 560 }}>
          Bundles proposés au configurateur. Le prix affiché est recalculé automatiquement
          depuis le catalogue (socle + palier IA + modules).
        </p>
        <Btn kind="soft" small onClick={addPreset}>+ Ajouter une présélection</Btn>
      </div>
      {error && <InfoBox tone="danger" title="Erreur">{error}</InfoBox>}
      {presets == null ? (
        <Card style={{ color: 'var(--faint)' }}>Chargement…</Card>
      ) : presets.length === 0 ? (
        <Card style={{ color: 'var(--faint)' }}>Aucune présélection.</Card>
      ) : (
        <div className="col g14">
          {presets.map(p => <PresetCard key={p.key} preset={p} tiers={tiers} onChanged={reload} />)}
        </div>
      )}
    </div>
  )
}

function PresetCard({ preset, tiers, onChanged }: {
  preset: AdminPreset; tiers: CatalogProduct[]; onChanged: () => void
}) {
  const [label, setLabel] = useState(preset.label)
  const [tagline, setTagline] = useState(preset.tagline)
  const [orderStr, setOrderStr] = useState(String(preset.sort_order))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => setLabel(preset.label), [preset.label])
  useEffect(() => setTagline(preset.tagline), [preset.tagline])
  useEffect(() => setOrderStr(String(preset.sort_order)), [preset.sort_order])

  async function patch(body: Record<string, unknown>) {
    setBusy(true); setErr('')
    try {
      await api(`/api/admin/billing/presets/${preset.key}`, { method: 'PATCH', body })
      onChanged()
    } catch (e: unknown) { setErr(errMsg(e, 'Mise à jour impossible.')); setBusy(false) }
  }
  async function remove() {
    if (!window.confirm(`Supprimer la présélection « ${preset.label} » ?`)) return
    setBusy(true); setErr('')
    try { await api(`/api/admin/billing/presets/${preset.key}`, { method: 'DELETE' }); onChanged() }
    catch (e: unknown) { setErr(errMsg(e, 'Suppression impossible.')); setBusy(false) }
  }
  function toggleModule(key: string, on: boolean) {
    patch({ modules: on ? [...preset.modules, key] : preset.modules.filter(m => m !== key) })
  }

  return (
    <Card>
      <div className="row g10" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="col g6" style={{ flex: '1 1 260px', minWidth: 220 }}>
          <input type="text" value={label} onChange={e => setLabel(e.target.value)}
                 onBlur={() => { const v = label.trim(); if (v && v !== preset.label) patch({ label: v }); else setLabel(preset.label) }}
                 disabled={busy} style={{ fontWeight: 700 }} placeholder="Libellé" />
          <input type="text" value={tagline} onChange={e => setTagline(e.target.value)}
                 onBlur={() => { if (tagline !== preset.tagline) patch({ tagline }) }}
                 disabled={busy} placeholder="Accroche" />
        </div>
        <div className="col g6" style={{ flex: '0 0 auto' }}>
          <label style={{ fontSize: 11.5, color: 'var(--mut)' }}>Palier IA</label>
          <select value={preset.ai_tier_id ?? ''} disabled={busy}
                  onChange={e => patch({ ai_tier_id: e.target.value || null })}>
            <option value="">Aucune IA</option>
            {tiers.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
          <Btn kind="ghost" small onClick={remove} disabled={busy}>Supprimer</Btn>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 6 }}>Modules inclus</div>
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          {PRESET_MODULES.map(m => {
            const on = preset.modules.includes(m.key)
            return (
              <button key={m.key} type="button" disabled={busy}
                      onClick={() => toggleModule(m.key, !on)}
                      style={{ padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
                               border: `1px solid ${on ? 'var(--acc)' : 'var(--bd)'}`,
                               background: on ? 'var(--acc-soft)' : 'transparent',
                               color: on ? 'var(--acc)' : 'var(--mut)', fontSize: 12, fontWeight: 600 }}>
                {on ? '✓ ' : ''}{m.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="row g14" style={{ flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <label className="row g6" style={{ alignItems: 'center', fontSize: 12.5 }}>
          <Toggle label="Recommandé" on={preset.recommended} disabled={busy} onChange={v => patch({ recommended: v })} /> Recommandé
        </label>
        <label className="row g6" style={{ alignItems: 'center', fontSize: 12.5 }}>
          <Toggle label="Présélection active" on={preset.is_active} disabled={busy} onChange={v => patch({ is_active: v })} /> Actif
        </label>
        <label className="row g6" style={{ alignItems: 'center', fontSize: 12.5, color: 'var(--mut)' }}>
          Ordre
          <input type="number" value={orderStr} disabled={busy}
                 onChange={e => setOrderStr(e.target.value)}
                 onBlur={() => { const v = Number(orderStr); if (Number.isInteger(v) && v !== preset.sort_order) patch({ sort_order: v }) }}
                 style={{ width: 64 }} />
        </label>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--faint)' }}>{preset.key}</span>
      </div>
      {err && <div className="error" style={{ marginTop: 8, fontSize: 12 }}>{err}</div>}
    </Card>
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
    <Modal title={`Changer le prix — ${product.label}`} maxWidth={440}
           onClose={saving ? undefined : onClose}>
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

        {saveError && <div className="error" role="alert" style={{ marginTop: 12 }}>{saveError}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <Btn kind="ghost" onClick={onClose} disabled={saving}>Annuler</Btn>
          <Btn kind="primary" onClick={save} disabled={saving}>
            {saving ? 'Application…' : 'Appliquer le nouveau prix'}
          </Btn>
        </div>
    </Modal>
  )
}
