// Page Facturation (/app/billing) — espace PAYEUR. Réservée à un owner d'org ou
// à un compte perso (canSeeBilling côté nav + Protected côté route ; le backend
// rejette 403 tout POST /api/billing/* d'un non-owner — défense en profondeur).
//
// Contenu (spec §5.3) :
//   - statut d'abonnement (GET /api/billing/summary) ;
//   - FORMAT DE FACTURE : Seg 3 options (per_bot | total | per_org) + modale de
//     confirmation -> PUT /api/billing/grouping -> refreshUser() ;
//   - bots FACTURABLES (GET /api/bots filtrés isBotBillingOwner) ;
//   - factures (GET /api/billing/invoices, `created` epoch -> ms) ;
//   - portail Stripe (POST /api/billing/portal -> redirection).
//
// INVARIANT : si le billing est désactivé (user.is_billing_enabled === false) on
// n'affiche QU'UNE InfoBox « bientôt disponible » et on masque tout le reste —
// aucun appel /api/billing/* n'est émis.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, InfoBox, Meter, Modal, Seg, billingChip } from '../ui'
import { errMsg } from '../utils/errors'
import { isBotBillingOwner } from '../utils/permissions'
import type { BotSummary } from '../types/bot'
import type {
  BillingGrouping, Invoice,
  CheckoutResponse, SubscriptionCancelResponse,
} from '../types/billing'

// Libellés FR des formats de facture (User.billing_grouping).
const GROUPING_OPTIONS: { value: BillingGrouping; label: string; desc: string }[] = [
  { value: 'total', label: 'Facture unique', desc: 'Une seule facture mensuelle, un line item par bot et module.' },
  { value: 'per_bot', label: 'Par bot', desc: 'Une facture distincte pour chaque bot.' },
  { value: 'per_org', label: 'Par équipe', desc: 'Une facture par équipe (+ une pour vos bots perso).' },
]

const INVOICE_STATUS_LABELS: Record<Invoice['status'], string> = {
  paid: 'Payée', open: 'En attente', void: 'Annulée',
  uncollectible: 'Impayée', draft: 'Brouillon',
}

// Résumé d'abonnement renvoyé par GET /api/billing/summary. On reste tolérant
// (champs optionnels) : le backend peut enrichir sans casser le front.
// `subscription_status` peut encore valoir 'trialing' : état RÉSIDUEL d'anciens
// abonnements Stripe legacy (ce statut n'est plus créé désormais). Il reste
// considéré ACTIF (accès modules) et s'affiche en neutre « Actif ». `trial_end`
// (epoch s) n'est plus exploité côté front mais conservé (legacy). Voir get_summary.
interface BillingSummary {
  subscription_status?: 'active' | 'past_due' | 'canceled' | 'none' | 'trialing'
  billable_bots?: number
  trial_end?: number | null      // epoch secondes — legacy résiduel, conservé
  next_invoice_cents?: number | null
  next_invoice_at?: number | null // epoch secondes
}

// Seuil d'alerte « quota proche » (>= 80 % de la conso IA mensuelle).
const QUOTA_WARN_PCT = 80

// GET /api/billing/usage — conso IA mensuelle par bot facturable du payeur.
// CONTRAT 3 : ajoute le DÉPASSEMENT IA métré (optionnel — billing/backend ancien
// ne le renvoie pas). `reported_overage` = réponses déjà facturées au-delà du
// quota ce mois ; `overage_mode` = 'block' (défaut) | 'meter' ; `overage_cap` =
// plafond de sécurité (réponses/mois).
interface UsageRow {
  bot_id: number
  usage_ai_replies: number
  quota_ai_replies: number | null // null = illimité (BYOK)
  byok: boolean
  overage_mode?: 'block' | 'meter'
  reported_overage?: number
  overage_cap?: number | null
}
interface UsageResponse {
  period: string
  usage: UsageRow[]
}

function fmtEur(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}
function fmtDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function Billing() {
  const { user, refreshUser } = useAuth()
  const [params, setParams] = useSearchParams()

  // --- Garde billing désactivé : InfoBox seule, aucun appel /api/billing/* ----
  // (on lit user après les hooks pour respecter l'ordre des hooks React).
  const billingOff = !user?.is_billing_enabled

  // Retour Stripe (?checkout=success|cancelled, ?portal=mock). Banni­ère + refresh.
  const checkoutResult = params.get('checkout')   // success | cancelled
  const portalResult = params.get('portal')       // mock

  // Ressources chargées UNIQUEMENT si le billing est actif (invariant : aucun
  // appel /api/billing/* ni /api/bots de facturation quand billing OFF).
  const [bots, setBots] = useState<BotSummary[] | null>(null)
  const [botsLoading, setBotsLoading] = useState(true)
  const [botsError, setBotsError] = useState('')
  // Action par bot (annulation / relance paiement) : id du bot en cours + erreur.
  // Une seule action à la fois (le bouton concerné passe en busy).
  const [botActionBusy, setBotActionBusy] = useState<number | null>(null)
  const [botActionErr, setBotActionErr] = useState<Record<number, string>>({})
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [invoicesError, setInvoicesError] = useState('')
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [usage, setUsage] = useState<UsageRow[] | null>(null)
  // Compteur de rechargement (re-fetch après retour de checkout).
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  // Modale de confirmation du changement de format de facture.
  const [pendingGrouping, setPendingGrouping] = useState<BillingGrouping | null>(null)
  const [groupingBusy, setGroupingBusy] = useState(false)
  const [groupingErr, setGroupingErr] = useState('')
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalErr, setPortalErr] = useState('')

  // Résumé d'abonnement (best-effort). Echec silencieux : la page reste utile.
  useEffect(() => {
    if (billingOff) return
    let alive = true
    api<BillingSummary>('/api/billing/summary')
      .then(s => { if (alive) setSummary(s) })
      .catch(() => { /* résumé indisponible : on n'affiche pas le bloc */ })
    return () => { alive = false }
  }, [billingOff, tick])

  // Conso IA mensuelle par bot (GET /api/billing/usage) — sert l'alerte « quota
  // proche / atteint ». Best-effort : échec silencieux (l'alerte reste masquée).
  useEffect(() => {
    if (billingOff) return
    let alive = true
    api<UsageResponse>('/api/billing/usage')
      .then(u => { if (alive) setUsage(u.usage ?? []) })
      .catch(() => { if (alive) setUsage(null) })
    return () => { alive = false }
  }, [billingOff, tick])

  // Bots facturables (GET /api/bots, filtrés ensuite par isBotBillingOwner).
  useEffect(() => {
    if (billingOff) { setBotsLoading(false); return }
    let alive = true
    setBotsLoading(true); setBotsError('')
    api<BotSummary[]>('/api/bots')
      .then(d => { if (alive) setBots(d) })
      .catch((err: unknown) => { if (alive) setBotsError(errMsg(err, 'Erreur')) })
      .finally(() => { if (alive) setBotsLoading(false) })
    return () => { alive = false }
  }, [billingOff, tick])

  // Factures (GET /api/billing/invoices).
  useEffect(() => {
    if (billingOff) { setInvoicesLoading(false); return }
    let alive = true
    setInvoicesLoading(true); setInvoicesError('')
    api<Invoice[]>('/api/billing/invoices')
      .then(d => { if (alive) setInvoices(d) })
      .catch((err: unknown) => { if (alive) setInvoicesError(errMsg(err, 'Erreur')) })
      .finally(() => { if (alive) setInvoicesLoading(false) })
    return () => { alive = false }
  }, [billingOff, tick])

  // Au retour d'un checkout réussi : on rafraîchit le user (grouping, billing) et
  // les ressources, puis on nettoie le query param (replace:true) pour ne pas
  // rejouer la bannière au prochain rendu.
  useEffect(() => {
    if (checkoutResult !== 'success' && portalResult !== 'mock') return
    refreshUser().catch(() => {})
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutResult, portalResult])

  function clearReturnParam() {
    const next = new URLSearchParams(params)
    next.delete('checkout')
    next.delete('portal')
    setParams(next, { replace: true })
  }

  const billableBots = useMemo(
    () => (bots ?? []).filter(b => isBotBillingOwner(user, b)),
    [bots, user],
  )

  async function confirmGrouping() {
    if (!pendingGrouping) return
    setGroupingBusy(true)
    setGroupingErr('')
    try {
      await api('/api/billing/grouping', { method: 'PUT', body: { grouping: pendingGrouping } })
      await refreshUser()
      setPendingGrouping(null)
    } catch (err: unknown) {
      setGroupingErr(errMsg(err, 'Le changement de format a échoué.'))
    } finally {
      setGroupingBusy(false)
    }
  }

  async function openPortal() {
    setPortalBusy(true)
    setPortalErr('')
    try {
      const res = await api<{ portal_url?: string; url?: string }>('/api/billing/portal', { method: 'POST' })
      const url = res.portal_url || res.url
      if (url) window.location.href = url
      else setPortalErr('Portail indisponible pour le moment.')
    } catch (err: unknown) {
      setPortalErr(errMsg(err, "Impossible d'ouvrir le portail."))
    } finally {
      setPortalBusy(false)
    }
  }

  function setBotErr(botId: number, msg: string) {
    setBotActionErr(prev => ({ ...prev, [botId]: msg }))
  }

  // Annulation d'un bot facturable (point 2) : cancel_at_period_end=true (fin de
  // période, sans remboursement). Le bot reste actif jusqu'à la fin de période
  // puis ses modules sont gate. Confirmation explicite, puis re-fetch de la liste.
  async function cancelBot(botId: number, name: string) {
    if (!window.confirm(
      `Annuler l'abonnement de « ${name} » ?\n\nL'abonnement prend fin à la fin de la `
      + 'période en cours (aucun remboursement). Le bot reste actif jusque-là.',
    )) return
    setBotActionBusy(botId)
    setBotErr(botId, '')
    try {
      await api<SubscriptionCancelResponse>(
        '/api/billing/subscription/cancel',
        { method: 'POST', body: { bot_id: botId } },
      )
      reload()
    } catch (err: unknown) {
      setBotErr(botId, errMsg(err, "L'annulation a échoué."))
    } finally {
      setBotActionBusy(null)
    }
  }

  // Relance du paiement d'un bot 'inactive' (point 3) : POST /api/billing/checkout
  // (sans config -> l'API rejoue la dernière compo connue). checkout_url ->
  // redirection Stripe ; sinon (MOCK / gratuit) on recharge la liste.
  async function resumeBot(botId: number) {
    setBotActionBusy(botId)
    setBotErr(botId, '')
    try {
      const res = await api<CheckoutResponse>(
        '/api/billing/checkout', { method: 'POST', body: { bot_id: botId } },
      )
      if (res.checkout_url) { window.location.href = res.checkout_url; return }
      reload()
    } catch (err: unknown) {
      setBotErr(botId, errMsg(err, 'La relance du paiement a échoué.'))
    } finally {
      setBotActionBusy(null)
    }
  }

  // --- Rendu : billing désactivé -------------------------------------------
  if (billingOff) {
    return (
      <div className="col" style={{ gap: 18 }}>
        <Header />
        <InfoBox tone="info" title="Bientôt disponible">
          La facturation n'est pas encore activée sur votre espace. Toutes les capacités
          sont actuellement incluses gratuitement. Vous pourrez ici composer votre
          abonnement, choisir le format de vos factures et accéder au portail de paiement.
        </InfoBox>
      </div>
    )
  }

  const currentGrouping: BillingGrouping = user?.billing_grouping ?? 'total'
  const subStatus = summary?.subscription_status

  // Bots du payeur dont la conso IA approche / atteint le quota (managés, non BYOK,
  // quota fini). >= seuil => alerte ; >= 100 % => IA en pause (blocage v1).
  const quotaAlerts = (usage ?? [])
    .filter(u => !u.byok && u.quota_ai_replies != null && u.quota_ai_replies > 0
      && u.usage_ai_replies / u.quota_ai_replies >= QUOTA_WARN_PCT / 100)
    .map(u => {
      const quota = u.quota_ai_replies as number
      const pct = Math.min(100, Math.round((u.usage_ai_replies / quota) * 100))
      const bot = (bots ?? []).find(b => b.id === u.bot_id)
      return { ...u, quota, pct, atQuota: u.usage_ai_replies >= quota, name: bot?.name ?? `Bot #${u.bot_id}` }
    })

  return (
    <div className="col" style={{ gap: 18 }}>
      <Header />

      {/* ALERTE QUOTA IA proche / atteint (par bot). Au quota : soit l'IA est en
          pause (mode 'block', défaut -> message « plan supérieur »), soit le
          dépassement facturé est actif (mode 'meter' -> l'IA continue, facturée
          au-delà du quota). `reported_overage` est affiché s'il y a déjà eu du
          dépassement ce mois. */}
      {quotaAlerts.map(a => {
        const metering = a.overage_mode === 'meter'
        const reported = a.reported_overage ?? 0
        return (
          <InfoBox key={a.bot_id} tone={a.atQuota && !metering ? 'danger' : 'warn'}
                   title={a.atQuota ? `Quota IA atteint — ${a.name}` : `Quota IA bientôt atteint — ${a.name}`}>
            <div className="col" style={{ gap: 8 }}>
              <div style={{ fontSize: 12.5 }}>
                {a.usage_ai_replies.toLocaleString('fr-FR')} / {a.quota.toLocaleString('fr-FR')} réponses IA ce mois-ci.
                {reported > 0 && (
                  <> {' '}<strong>+ {reported.toLocaleString('fr-FR')} réponses en dépassement</strong> (facturées).</>
                )}
                {a.atQuota
                  ? (metering
                      ? " Le dépassement facturé est actif : l'IA continue de répondre au-delà du quota (dans la limite du plafond)."
                      : " L'IA est en pause jusqu'au prochain cycle — souscrivez un plan supérieur pour augmenter le quota.")
                  : ' Pensez à passer à un plan supérieur pour éviter une coupure.'}
              </div>
              <Meter pct={a.pct} tone={a.atQuota && !metering ? 'danger' : 'warn'} />
            </div>
          </InfoBox>
        )
      })}

      {/* Bannière de retour Stripe (checkout / portail). */}
      {checkoutResult === 'success' && (
        <InfoBox tone="go" title="Abonnement confirmé">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>Votre paiement a été pris en compte. L'activation des modules peut prendre quelques instants.</span>
            <button onClick={clearReturnParam} className="btn btn-ghost small">OK</button>
          </div>
        </InfoBox>
      )}
      {checkoutResult === 'cancelled' && (
        <InfoBox tone="warn" title="Paiement annulé">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>Vous avez annulé le paiement. Aucun montant n'a été prélevé.</span>
            <button onClick={clearReturnParam} className="btn btn-ghost small">OK</button>
          </div>
        </InfoBox>
      )}
      {portalResult === 'mock' && (
        <InfoBox tone="info" title="Portail (simulation)">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>Le portail Stripe est simulé en environnement de test.</span>
            <button onClick={clearReturnParam} className="btn btn-ghost small">OK</button>
          </div>
        </InfoBox>
      )}

      {/* Statut d'abonnement + portail. */}
      <Card style={{ padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 800 }}>Votre abonnement</div>
            <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 4 }}>
              {subStatus === 'active' && 'Abonnement actif.'}
              {/* 'trialing' = état RÉSIDUEL (abonnement legacy) : affiché en neutre « actif ». */}
              {subStatus === 'trialing' && 'Abonnement actif.'}
              {subStatus === 'past_due' && 'Paiement en retard — régularisez via le portail.'}
              {subStatus === 'canceled' && 'Abonnement résilié.'}
              {(subStatus === 'none' || subStatus === undefined) && 'Aucun abonnement payant — vous êtes sur le socle gratuit.'}
            </div>
            {summary?.next_invoice_cents != null && summary?.next_invoice_at != null && (
              <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 4 }}>
                Prochaine facture : {fmtEur(summary.next_invoice_cents)} le {fmtDate(summary.next_invoice_at)}.
              </div>
            )}
          </div>
          <Btn kind="soft" onClick={openPortal} disabled={portalBusy}>
            {portalBusy ? 'Ouverture…' : 'Moyens de paiement & factures'}
          </Btn>
        </div>
        {portalErr && <div className="error" style={{ marginTop: 12 }}>{portalErr}</div>}
      </Card>

      {/* Format de facture. */}
      <Card style={{ padding: '20px 22px' }}>
        <div style={{ fontSize: 14.5, fontWeight: 800 }}>Format de vos factures</div>
        <div style={{ fontSize: 12.5, color: 'var(--mut)', margin: '4px 0 14px' }}>
          Choisissez comment vos abonnements sont regroupés. Changer de format réorganise
          vos abonnements (au prorata) sans perdre vos modules.
        </div>
        <Seg
          options={GROUPING_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          value={currentGrouping}
          onChange={v => { if (v !== currentGrouping) setPendingGrouping(v as BillingGrouping) }}
        />
        <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 10 }}>
          {GROUPING_OPTIONS.find(o => o.value === currentGrouping)?.desc}
        </div>
      </Card>

      {/* Bots facturables. */}
      <Card style={{ padding: '20px 22px' }}>
        <div id="billable-bots" style={{ fontSize: 14.5, fontWeight: 800, marginBottom: 12, scrollMarginTop: 16 }}>Bots facturables</div>
        {botsLoading ? (
          <div style={{ fontSize: 13, color: 'var(--mut)' }}>Chargement…</div>
        ) : botsError ? (
          <div className="error">{botsError}</div>
        ) : billableBots.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--mut)' }}>
            Aucun bot facturable pour le moment. Les bots que vous payez (perso ou des
            équipes dont vous êtes propriétaire) apparaîtront ici.
          </div>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            {billableBots.map(b => {
              const inactive = b.billing_status === 'inactive'
              // Plan modifiable EN APP tant que l'abonnement est vivant (actif/relance,
              // + 'trialing' RÉSIDUEL legacy). 'inactive' -> relance du Checkout.
              const manageable = b.billing_status === 'active' || b.billing_status === 'trialing' || b.billing_status === 'past_due'
              const busy = botActionBusy === b.id
              const rowErr = botActionErr[b.id]
              return (
                <div key={b.id} style={{
                  display: 'flex', flexDirection: 'column',
                  gap: 10, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                        {billingChip(b.billing_status, b.trial_end)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--mut)' }}>
                        {b.organization_id == null ? 'Perso' : 'Équipe'} · {b.mode}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {inactive && (
                        <Btn kind="primary" small onClick={() => resumeBot(b.id)} disabled={busy}>
                          {busy ? 'Redirection…' : 'Finaliser le paiement'}
                        </Btn>
                      )}
                      {/* Changement de plan EN APP (prorata) : le configurateur vit
                          sur l'onglet Facturation du bot — on y renvoie (pas portail). */}
                      {manageable && (
                        <Link to={`/app/bots/${b.id}?tab=billing`} className="btn btn-soft small" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          Modifier le plan
                        </Link>
                      )}
                      {manageable && (
                        <Btn kind="ghost" small onClick={() => cancelBot(b.id, b.name)} disabled={busy}>
                          {busy ? 'Annulation…' : 'Annuler'}
                        </Btn>
                      )}
                      <Link to={`/app/bots/${b.id}?tab=billing`} className="btn btn-ghost small" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        Détail
                      </Link>
                    </div>
                  </div>
                  {rowErr && <div className="error">{rowErr}</div>}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Factures. */}
      <Card style={{ padding: '20px 22px' }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, marginBottom: 12 }}>Factures</div>
        {invoicesLoading ? (
          <div style={{ fontSize: 13, color: 'var(--mut)' }}>Chargement…</div>
        ) : invoicesError ? (
          <div className="error">{invoicesError}</div>
        ) : (invoices ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--mut)' }}>Aucune facture pour le moment.</div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {(invoices ?? []).map(inv => (
              <div key={inv.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 12,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    {inv.number || inv.period_label || fmtDate(inv.created)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--mut)' }}>{fmtDate(inv.created)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtEur(inv.amount_paid_cents)}</span>
                  <Chip tone={inv.status === 'paid' ? 'go' : inv.status === 'open' ? 'warn' : 'acc'}>
                    {INVOICE_STATUS_LABELS[inv.status]}
                  </Chip>
                  {inv.hosted_invoice_url && (
                    <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer"
                       className="btn btn-ghost small" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
                      Voir
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Modale de confirmation du changement de format. */}
      {pendingGrouping && (
        <Modal title="Changer le format de facture ?"
               onClose={groupingBusy ? undefined : () => { setPendingGrouping(null); setGroupingErr('') }}>
          <p style={{ fontSize: 13.5, color: 'var(--mut)', lineHeight: 1.55, margin: '10px 0 0' }}>
            Vos abonnements vont passer en «&nbsp;{GROUPING_OPTIONS.find(o => o.value === pendingGrouping)?.label}&nbsp;».
            Les abonnements sont réorganisés au prorata, sans perte de vos modules.
          </p>
          {groupingErr && <div className="error" role="alert" style={{ marginTop: 12 }}>{groupingErr}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
            <Btn kind="ghost" onClick={() => { setPendingGrouping(null); setGroupingErr('') }} disabled={groupingBusy}>Annuler</Btn>
            <Btn kind="primary" onClick={confirmGrouping} disabled={groupingBusy}>
              {groupingBusy ? 'Application…' : 'Confirmer'}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 32, margin: 0, letterSpacing: '-.02em' }}>Facturation</h1>
      <p style={{ fontSize: 14, color: 'var(--mut)', margin: '6px 0 0' }}>
        Gérez votre abonnement, le format de vos factures et vos moyens de paiement.
      </p>
    </div>
  )
}
