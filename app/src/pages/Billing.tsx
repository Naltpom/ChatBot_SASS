// « Facturation » — plan actuel, consommation du mois, changement de plan
// self-serve par les admins de l'organisation (l'API revérifie le rôle et
// applique les garde-fous de downgrade). Branché Stripe : checkout pour un
// nouvel abonnement, portail client pour modifier/résilier, factures lues à
// la demande. Si billing_enabled=false, application immédiate (historique).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Check, CreditCard, ExternalLink } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, InfoBox, Meter, SectionTitle } from '../ui'
import { PLAN_LABELS, PublicPlan, planFeatures } from '../botConstants'
import { Invoice, formatCents, invoiceDate, invoiceStatusChip } from '../billingUtils'

interface Usage {
  plan: string
  plan_price: number
  type: string
  ai_messages_used: number
  ai_messages_quota: number
  bots_used: number
  bots_quota: number
  tree_only: boolean
  max_tree_nodes: number | null
  byok: boolean
  billing_enabled: boolean
  stripe_subscription: boolean
}

interface PlanChangeRes {
  applied: boolean
  billing_enabled: boolean
  checkout_url?: string
  portal_url?: string
  plan?: string
}

function UsageMeter({ label, used, quota, unit }: { label: string; used: number; quota: number; unit: string }) {
  const pct = Math.round((used / Math.max(1, quota)) * 100)
  const tone = pct > 95 ? 'danger' : pct > 70 ? 'warn' : 'acc'
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>
          {used.toLocaleString('fr-FR')} / {quota.toLocaleString('fr-FR')} {unit}
        </span>
      </div>
      <Meter pct={pct} tone={tone} height={6} />
    </div>
  )
}

// Bannière de retour Stripe : success = le plan est appliqué PAR LE WEBHOOK
// (asynchrone) → on polle l'usage quelques secondes avant de conclure.
type CheckoutState = '' | 'pending' | 'activated' | 'timeout' | 'cancelled'

export default function Billing() {
  const { user, activeOrg, refreshUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [plans, setPlans] = useState<PublicPlan[]>([])
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [checkout, setCheckout] = useState<CheckoutState>('')
  const [activatedLabel, setActivatedLabel] = useState('')
  const planAtReturnRef = useRef<string | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const isAdmin = !!user?.is_superadmin || activeOrg?.role === 'admin'

  const loadUsage = useCallback(() => {
    if (!activeOrg) return
    api<Usage>(`/api/orgs/${activeOrg.id}/usage`).then(setUsage).catch(() => setUsage(null))
  }, [activeOrg?.id])
  useEffect(loadUsage, [loadUsage])

  // Source des plans : GET /api/public/plans (remplace l'ancien miroir manuel local)
  const [plansError, setPlansError] = useState('')
  const [plansRetry, setPlansRetry] = useState(0)
  useEffect(() => {
    setPlansError('')
    api<{ billing_enabled: boolean; plans: PublicPlan[] }>('/api/public/plans')
      .then(d => setPlans(d.plans))
      .catch((err: any) => setPlansError(err.message))
  }, [plansRetry])

  // Retour Stripe : /app/billing?checkout=success|cancelled (param nettoyé)
  useEffect(() => {
    const c = searchParams.get('checkout')
    if (!c) return
    const next = new URLSearchParams(searchParams)
    next.delete('checkout')
    setSearchParams(next, { replace: true })
    if (c === 'success') setCheckout('pending')
    else if (c === 'cancelled') setCheckout('cancelled')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Polling post-checkout : le webhook applique le plan de façon asynchrone.
  useEffect(() => {
    if (checkout !== 'pending' || !activeOrg) return
    let stopped = false
    let tries = 0
    const orgId = activeOrg.id
    const interval = window.setInterval(async () => {
      if (stopped) return
      tries += 1
      try {
        const u = await api<Usage>(`/api/orgs/${orgId}/usage`)
        if (stopped) return
        setUsage(u)
        if (planAtReturnRef.current === null) planAtReturnRef.current = u.plan
        if (u.stripe_subscription || u.plan !== planAtReturnRef.current) {
          stopped = true
          window.clearInterval(interval)
          setActivatedLabel(PLAN_LABELS[u.plan] || u.plan)
          setCheckout('activated')
          refreshUser()
          return
        }
      } catch { /* réessaie au tick suivant */ }
      if (!stopped && tries >= 10) {
        stopped = true
        window.clearInterval(interval)
        setCheckout('timeout')
      }
    }, 2000)
    return () => { stopped = true; window.clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout, activeOrg?.id])

  // Factures Stripe de l'org (admins, billing actif uniquement)
  useEffect(() => {
    setInvoices(null)
    if (!activeOrg || !isAdmin || !usage?.billing_enabled) return
    api<{ billing_enabled: boolean; invoices: Invoice[] }>(`/api/orgs/${activeOrg.id}/invoices`)
      .then(d => setInvoices(d.invoices))
      .catch(() => setInvoices([]))
  }, [activeOrg?.id, isAdmin, usage?.billing_enabled])

  if (!activeOrg) return <Card>Sélectionnez d'abord une organisation.</Card>

  const currentKey = usage?.plan || activeOrg.plan
  const current = plans.find(p => p.id === currentKey)
  const labelOf = (key: string) => plans.find(p => p.id === key)?.label || PLAN_LABELS[key] || key

  async function changePlan(planKey: string) {
    if (!activeOrg) return
    setSaving(true)
    setError('')
    setInfo('')
    try {
      const res = await api<PlanChangeRes>(`/api/orgs/${activeOrg.id}/plan`, {
        method: 'POST', body: { plan: planKey },
      })
      if (res.applied) {
        setConfirming(null)
        setInfo(`Plan ${labelOf(planKey)} activé pour ${activeOrg.name}.`)
        await refreshUser()
        loadUsage()
        setSaving(false)
      } else if (res.checkout_url) {
        window.location.href = res.checkout_url   // saving reste true : on quitte la page
      } else if (res.portal_url) {
        window.location.href = res.portal_url
      } else {
        setSaving(false)
      }
    } catch (err: any) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function openPortal() {
    if (!activeOrg) return
    setPortalLoading(true)
    setError('')
    try {
      const res = await api<{ portal_url: string }>(`/api/orgs/${activeOrg.id}/billing/portal`, { method: 'POST' })
      window.location.href = res.portal_url
    } catch (err: any) {
      setError(err.message)
      setPortalLoading(false)
    }
  }

  // Copy de confirmation selon le chemin réel (checkout / portail / immédiat) :
  // avec un abonnement existant, un changement paid→paid passe par le PORTAIL
  // client (le backend renvoie portal_url), pas par un checkout.
  function confirmCopy(p: PublicPlan): string {
    if (usage?.billing_enabled && usage.stripe_subscription && p.price === 0) {
      return 'Vous serez redirigé vers le portail pour résilier.'
    }
    if (usage?.billing_enabled && usage.stripe_subscription && p.price > 0) {
      return 'Vous serez redirigé vers le portail client (Stripe) pour modifier votre abonnement.'
    }
    if (usage?.billing_enabled && p.price > 0) {
      return 'Vous allez être redirigé vers le paiement sécurisé (Stripe).'
    }
    return 'Effet immédiat.'
  }

  return (
    <div className="col g18">
      <SectionTitle sub={`Plan, consommation du mois et changement de formule pour ${activeOrg.name}.`}>
        Facturation
      </SectionTitle>

      {error && <div className="error">{error}</div>}
      {info && <InfoBox tone="go">{info}</InfoBox>}

      {/* ---- Retour Stripe ---- */}
      {checkout === 'pending' && (
        <InfoBox tone="go">Paiement confirmé — activation du plan en cours…</InfoBox>
      )}
      {checkout === 'activated' && (
        <InfoBox tone="go">Plan {activatedLabel} activé.</InfoBox>
      )}
      {checkout === 'timeout' && (
        <InfoBox tone="info">
          L'activation arrive par webhook et peut prendre quelques instants — rechargez la page si besoin.
        </InfoBox>
      )}
      {checkout === 'cancelled' && (
        <InfoBox tone="warn">Paiement annulé — aucun changement effectué.</InfoBox>
      )}

      {/* ---- Plan actuel + usage du mois ---- */}
      <Card>
        <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 10, background: 'var(--acc-soft, rgba(13,148,136,.12))',
              color: 'var(--acc)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <CreditCard size={17} />
            </span>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 800 }}>
                Plan {labelOf(currentKey)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                {current?.description || 'Formule actuelle de votre organisation.'}
              </div>
            </div>
          </div>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <Chip tone="acc">{(usage?.plan_price ?? current?.price ?? 0).toLocaleString('fr-FR')} €/mois</Chip>
            {isAdmin && usage?.billing_enabled && usage.stripe_subscription && (
              <Btn kind="soft" small onClick={openPortal} disabled={portalLoading}>
                {portalLoading ? 'Ouverture…' : <>Gérer mon abonnement <ExternalLink size={13} /></>}
              </Btn>
            )}
          </div>
        </div>
        {usage ? (
          <div className="row" style={{ gap: 22, flexWrap: 'wrap' }}>
            <UsageMeter label="Réponses IA ce mois-ci" used={usage.ai_messages_used}
                        quota={usage.ai_messages_quota} unit="réponses" />
            <UsageMeter label="Chatbots" used={usage.bots_used} quota={usage.bots_quota} unit="bots" />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>Chargement de la consommation…</div>
        )}
      </Card>

      {/* ---- Grille des plans (source : GET /api/public/plans) ---- */}
      {plansError && (
        <InfoBox tone="danger" title="Impossible de charger les plans">
          <div className="col" style={{ gap: 8, alignItems: 'flex-start' }}>
            <span>{plansError}</span>
            <Btn kind="soft" small onClick={() => setPlansRetry(n => n + 1)}>Réessayer</Btn>
          </div>
        </InfoBox>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: 14, alignItems: 'stretch' }}>
        {plans.map(p => {
          const isCurrent = p.id === currentKey
          const popular = p.id === 'pro'
          return (
            <Card key={p.id} style={{
              display: 'flex', flexDirection: 'column', gap: 10,
              borderColor: isCurrent ? 'var(--acc)' : undefined,
            }}>
              <div className="row g8" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>{p.label}</span>
                {isCurrent ? <Chip tone="go">Plan actuel</Chip> : popular ? <Chip tone="acc">Populaire</Chip> : null}
              </div>
              <div>
                <span style={{ fontSize: 24, fontWeight: 800 }}>{p.price.toLocaleString('fr-FR')} €</span>
                <span style={{ fontSize: 11.5, color: 'var(--faint)' }}> /mois</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', minHeight: 30 }}>{p.description}</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                {planFeatures(p).map(f => (
                  <li key={f} className="row" style={{ gap: 7, fontSize: 12, color: 'var(--ink)' }}>
                    <Check size={13} style={{ color: 'var(--acc)', flexShrink: 0 }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {/* Action : changement de plan (admins uniquement), confirmation inline */}
              {!isCurrent && isAdmin && (
                confirming === p.id ? (
                  <div className="col" style={{ gap: 8 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.45 }}>
                      Passer au plan {p.label} ({p.price.toLocaleString('fr-FR')} €/mois) ? {confirmCopy(p)}
                    </div>
                    <div className="row g8">
                      <Btn small onClick={() => changePlan(p.id)} disabled={saving}>
                        {saving ? 'Changement…' : 'Confirmer'}
                      </Btn>
                      <Btn small kind="ghost" onClick={() => setConfirming(null)} disabled={saving}>Annuler</Btn>
                    </div>
                  </div>
                ) : (
                  <Btn kind={popular ? 'primary' : 'soft'} small
                       onClick={() => { setError(''); setInfo(''); setConfirming(p.id) }}>
                    Passer à ce plan <ArrowUpRight size={13} />
                  </Btn>
                )
              )}
            </Card>
          )
        })}
      </div>

      {/* ---- Factures Stripe ---- */}
      {isAdmin && usage?.billing_enabled && (
        <Card nopad>
          <div className="card-title" style={{ padding: '14px 16px 0' }}>Factures</div>
          {invoices === null ? (
            <div style={{ fontSize: 12, color: 'var(--faint)', padding: '10px 16px 14px' }}>Chargement des factures…</div>
          ) : invoices.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--faint)', padding: '10px 16px 14px' }}>Aucune facture pour l'instant.</div>
          ) : (
            <table className="kc" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Numéro</th><th>Statut</th><th>Montant</th><th>Date</th><th></th></tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td className="mono" style={{ fontSize: 11.5 }}>{inv.number || inv.id}</td>
                    <td>{invoiceStatusChip(inv.status)}</td>
                    <td style={{ fontWeight: 700 }}>{formatCents(inv.total)} {inv.currency.toUpperCase()}</td>
                    <td>{invoiceDate(inv.created)}</td>
                    <td>
                      <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                        {inv.hosted_invoice_url && (
                          <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer"
                             style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--acc)' }}>Voir</a>
                        )}
                        {inv.invoice_pdf && (
                          <a href={inv.invoice_pdf} target="_blank" rel="noopener noreferrer"
                             style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--acc)' }}>PDF</a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* ---- Bandeaux d'état ---- */}
      {isAdmin ? (
        usage?.billing_enabled === false && (
          <InfoBox tone="info" title="Paiement en ligne non configuré">
            Les changements de plan sont appliqués immédiatement, sans facturation. Un passage à un plan
            inférieur reste refusé tant que vos bots dépassent ses limites (nombre de bots, mode IA,
            taille d'arbre, BYOK).
          </InfoBox>
        )
      ) : (
        <InfoBox tone="info">
          Seuls les admins de l'organisation peuvent changer de plan. Contactez un admin de {activeOrg.name}.
        </InfoBox>
      )}
    </div>
  )
}
