// Domaine FACTURATION de BotPage — regroupe l'état de facturation du bot et les 5
// flux d'abonnement (souscription/relance Checkout, Customer Portal, modification
// de plan au prorata, annulation fin de période, toggle dépassement IA métré),
// avec leurs busy/err locaux et les chargements paresseux associés (entitlement au
// montage, catalogue à l'ouverture de l'onglet).
import { useEffect, useState } from 'react'
import { api } from '../api'
import { errMsg } from '../utils/errors'
import type {
  BillingCatalog, BotConfig, BotEntitlementView,
  SubscriptionCancelResponse, SubscriptionUpdateResponse,
} from '../types/billing'

export function useBotBilling(botId: number, initialPlanConfig: BotConfig | null, tab: string) {
  // État de facturation du bot (onglet Facturation) : modules actifs / quota IA /
  // statut d'abonnement. Chargé au montage + à chaque changement de bot.
  const [billing, setBilling] = useState<BotEntitlementView | null>(null)
  // Souscription / réactivation via Checkout (paiement requis / abonnement annulé).
  const [subscribeBusy, setSubscribeBusy] = useState(false)
  const [subscribeErr, setSubscribeErr] = useState('')
  // Gestion de l'abonnement via le Customer Portal (carte, annulation).
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalErr, setPortalErr] = useState('')
  // Catalogue = SOURCE UNIQUE backend (GET /api/billing/catalog). null tant qu'il
  // n'est pas chargé ; catalogErr si l'appel échoue (état d'erreur PROPRE).
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null)
  const [catalogErr, setCatalogErr] = useState(false)
  // Amorcé depuis le wizard si présent (initialPlanConfig) ; sinon depuis
  // l'entitlement du bot (effet ci-dessous, sans écraser une édition en cours).
  const [planConfig, setPlanConfig] = useState<BotConfig | null>(initialPlanConfig)
  // Consentement à l'exécution immédiate (renonciation rétractation 14 j) coché au
  // checkout — obligatoire pour une souscription initiale.
  const [planConsent, setPlanConsent] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [planErr, setPlanErr] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelErr, setCancelErr] = useState('')
  // Dépassement IA métré (toggle owner + plafond) : busy/err locaux.
  const [overageBusy, setOverageBusy] = useState(false)
  const [overageErr, setOverageErr] = useState('')

  // La liste des modules (configurateur) est TOUJOURS visible dans Facturation :
  // on amorce planConfig depuis l'entitlement dès qu'il est chargé (sans écraser
  // une édition en cours — prev ?? …).
  useEffect(() => {
    setPlanConfig(prev => prev ?? (billing
      ? { modules: billing.active_modules, ai_tier_id: billing.ai_tier_id, ai_byok: billing.ai_byok }
      : null))
  }, [billing])

  // Facturation du bot : chargée AU MONTAGE (et à chaque changement de bot) pour
  // alimenter le bandeau « Bot non activé » + les verrous VISIBLE-MAIS-VERROUILLÉ.
  // GET /api/bots/{id}/entitlement (échec silencieux -> non-owner = null).
  useEffect(() => {
    let alive = true
    api<BotEntitlementView>(`/api/bots/${botId}/entitlement`)
      .then(d => { if (alive) setBilling(d) })
      .catch(() => { if (alive) setBilling(null) })
    return () => { alive = false }
  }, [botId])

  // Catalogue de facturation : chargé quand l'onglet Facturation est ouvert. SOURCE
  // UNIQUE backend : en cas d'échec on affiche un état d'erreur (pas de prix codé
  // en dur). Billing OFF : l'onglet n'est pas visible -> jamais d'appel.
  useEffect(() => {
    if (tab !== 'billing') return
    let alive = true
    api<BillingCatalog>('/api/billing/catalog')
      .then(c => { if (alive) { setCatalog(c); setCatalogErr(false) } })
      .catch(() => { if (alive) setCatalogErr(true) })
    return () => { alive = false }
  }, [tab])

  // Réactivation via Checkout : recrée un abonnement PAYANT immédiat sur la config
  // DÉJÀ active (modules + variante BYOK) via POST /api/billing/checkout. checkout_url
  // -> redirection Stripe ; null/free -> souscription immédiate, on recharge l'entitlement.
  async function subscribeNow() {
    if (!billing) return
    setSubscribeBusy(true)
    setSubscribeErr('')
    const config: BotConfig = {
      modules: billing.active_modules,
      ai_tier_id: billing.ai_tier_id,
      ai_byok: billing.ai_byok,
    }
    try {
      const res = await api<{ checkout_url?: string | null; free?: boolean; billing?: string }>(
        '/api/billing/checkout',
        { method: 'POST', body: { bot_id: botId, config } },
      )
      if (res.checkout_url) { window.location.href = res.checkout_url; return }
      const updated = await api<BotEntitlementView>(`/api/bots/${botId}/entitlement`)
      setBilling(updated)
    } catch (err: unknown) {
      setSubscribeErr(errMsg(err, "La souscription n'a pas pu démarrer."))
    } finally {
      setSubscribeBusy(false)
    }
  }

  // « Gérer l'abonnement » : ouvre le Customer Portal Stripe (POST /api/billing/portal).
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

  // « Appliquer (prorata) » : POST /api/billing/subscription/update — changement
  // INSTANTANÉ au prorata. Sans abonnement actif -> { needs_checkout } -> redirection.
  async function applyPlan() {
    if (!planConfig) return
    setPlanBusy(true)
    setPlanErr('')
    try {
      const res = await api<SubscriptionUpdateResponse>(
        '/api/billing/subscription/update',
        { method: 'POST', body: { bot_id: botId, config: planConfig, consent: planConsent } },
      )
      if ('status' in res && res.status === 'needs_checkout') {
        window.location.href = res.checkout_url
        return
      }
      const updated = await api<BotEntitlementView>(`/api/bots/${botId}/entitlement`)
      setBilling(updated)
    } catch (err: unknown) {
      setPlanErr(errMsg(err, "La modification du plan a échoué."))
    } finally {
      setPlanBusy(false)
    }
  }

  // « Annuler l'abonnement » : POST /api/billing/subscription/cancel — pose
  // cancel_at_period_end=true (FIN DE PÉRIODE, sans remboursement). Confirmation explicite.
  async function cancelSubscription() {
    if (!window.confirm(
      "Annuler l'abonnement de ce bot ?\n\nL'abonnement prend fin à la fin de la "
      + 'période en cours (aucun remboursement). Le bot reste actif jusque-là, '
      + 'puis ses modules payants seront coupés.',
    )) return
    setCancelBusy(true)
    setCancelErr('')
    try {
      await api<SubscriptionCancelResponse>(
        '/api/billing/subscription/cancel',
        { method: 'POST', body: { bot_id: botId } },
      )
      const updated = await api<BotEntitlementView>(`/api/bots/${botId}/entitlement`)
      setBilling(updated)
    } catch (err: unknown) {
      setCancelErr(errMsg(err, "L'annulation a échoué."))
    } finally {
      setCancelBusy(false)
    }
  }

  // Dépassement IA métré (CONTRAT 1) : POST /api/bots/{id}/overage {enabled, cap}.
  // La réponse a la MÊME forme que GET .../entitlement : on refetch pour re-render.
  async function toggleOverage(enabled: boolean, cap: number | null) {
    setOverageBusy(true)
    setOverageErr('')
    try {
      await api(`/api/bots/${botId}/overage`, { method: 'POST', body: { enabled, cap } })
      const updated = await api<BotEntitlementView>(`/api/bots/${botId}/entitlement`)
      setBilling(updated)
    } catch (err: unknown) {
      setOverageErr(errMsg(err, 'La modification du dépassement a échoué.'))
    } finally {
      setOverageBusy(false)
    }
  }

  return {
    billing,
    catalog, catalogErr,
    planConfig, setPlanConfig, planConsent, setPlanConsent,
    subscribeNow, subscribeBusy, subscribeErr,
    openPortal, portalBusy, portalErr,
    applyPlan, planBusy, planErr,
    cancelSubscription, cancelBusy, cancelErr,
    toggleOverage, overageBusy, overageErr,
  }
}
