// Onglet Facturation d'un bot : état « Paiement requis » (status='inactive' ->
// relance du Checkout), bloc « Modifier mon plan » (configurateur pré-rempli +
// application AU PRORATA + annulation FIN DE PÉRIODE), récap des modules actifs,
// quota IA (Meter) avec alerte « quota proche / atteint », dépassement IA métré
// (toggle owner + plafond) et renvoi vers la page Facturation pour les moyens de
// paiement & factures. Owner-only et monté uniquement si le billing est actif
// (voir billingTabVisible / visibleTabs côté BotPage). Présentationnel : tout
// l'état/les handlers viennent de useBotBilling via BotPage.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Card, Chip, InfoBox, Meter, Toggle } from '../../ui'
import BotConfigurator from '../billing/BotConfigurator'
import PriceCart from '../billing/PriceCart'
import type { BillingCatalog, BotConfig, BotEntitlementView } from '../../types/billing'
import type { Tree } from '../../types/bot'

// Libellés FR des clés de module (entitlement) pour l'onglet Facturation.
const MODULE_LABELS: Record<string, string> = {
  ai: 'Intelligence artificielle',
  inbox: 'Live chat / Inbox',
  rag: 'Connaissances (RAG)',
  actions: 'Actions',
  mcp: 'MCP (outils IA)',
  ab: 'A/B testing',
  white_label: 'White-label',
}
const SUB_STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  // 'trialing' résiduel (abonnements Stripe legacy) : affiché en NEUTRE « Actif »
  // (plus d'essai créé). On GARDE la clé : ces abonnements restent actifs (accès modules).
  trialing: 'Actif',
  past_due: 'Paiement en retard',
  inactive: 'Paiement requis',
  canceled: 'Résilié',
  none: 'Aucun abonnement',
}

export default function BotBillingTab({ billing, botName, onSubscribe, subscribeBusy, subscribeErr,
                                       onPortal, portalBusy, portalErr,
                                       catalog, catalogErr, isMobile,
                                       planConfig, onPlanChange,
                                       onApplyPlan, planBusy, planErr, planConsent, onConsentChange,
                                       onCancel, cancelBusy, cancelErr,
                                       onToggleOverage, overageBusy, overageErr, tree }: {
  billing: BotEntitlementView | null
  botName: string
  onSubscribe: () => void
  subscribeBusy: boolean
  subscribeErr: string
  onPortal: () => void
  portalBusy: boolean
  portalErr: string
  catalog: BillingCatalog | null
  catalogErr: boolean
  isMobile: boolean
  planConfig: BotConfig | null
  onPlanChange: (next: BotConfig) => void
  onApplyPlan: () => void
  planBusy: boolean
  planErr: string
  planConsent: boolean
  onConsentChange: (v: boolean) => void
  onCancel: () => void
  cancelBusy: boolean
  cancelErr: string
  onToggleOverage: (enabled: boolean, cap: number | null) => void
  overageBusy: boolean
  overageErr: string
  // Arbre du bot — passé au configurateur pour l'aperçu d'élagage : décocher un
  // module utilisé par l'arbre (ex. Inbox/handoff) confirme « élaguera N étape(s) ».
  tree?: Tree
}) {
  if (!billing) {
    return (
      <Card style={{ padding: '24px 22px' }}>
        <div style={{ fontSize: 13.5, color: 'var(--mut)' }}>Chargement de la facturation…</div>
      </Card>
    )
  }
  const quota = billing.quota_ai_replies
  const used = billing.usage_ai_replies
  const pct = quota && quota > 0 ? Math.round((used / quota) * 100) : 0
  const overQuota = quota != null && quota > 0 && used >= quota
  const nearQuota = !overQuota && quota != null && quota > 0 && pct >= 80
  const modules = billing.active_modules || []

  // Statut d'abonnement. `status`/`subscription_status` peut encore valoir
  // 'trialing' pour des abonnements Stripe LEGACY : on le traite comme ACTIF
  // (cf. planManageable + SUB_STATUS_LABELS neutre « Actif »), sans plus créer
  // ni afficher d'essai. (legacy : trial_end/trial_expired restent lus côté back
  // mais ne sont plus dérivés ici.)
  const status = billing.status ?? billing.subscription_status
  // « Paiement requis » : Checkout abandonné ou abonnement annulé (point 3/4).
  // Le bot est gardé (config sauvegardée) mais ses modules sont gate tant que pas
  // payé -> on propose de relancer le Checkout.
  const paymentRequired = status === 'inactive'
  // Plan modifiable EN APP : un abonnement vivant (essai/payé/relance). Pour un
  // bot 'inactive'/'none'/'canceled', le bon chemin est la (re)souscription via
  // Checkout, pas le changement au prorata.
  const planManageable = status === 'active' || status === 'trialing' || status === 'past_due'

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* PAIEMENT REQUIS (point 3) : Checkout abandonné ou abonnement annulé. Le
          bot est conservé (config sauvegardée) ; on relance le Checkout pour le
          (ré)activer. Avec BILLING_ENFORCE, l'IA & les modules restent coupés
          (402) tant que pas payé. */}
      {paymentRequired && (
        <InfoBox tone="warn" title="Paiement requis">
          <div className="col" style={{ gap: 12 }}>
            <span style={{ fontSize: 12.5 }}>
              « {botName} » est conservé avec sa configuration, mais son abonnement n'est pas
              actif : les modules payants et l'IA sont suspendus tant que le paiement n'est pas
              finalisé. Reprenez là où vous en étiez en finalisant le paiement.
            </span>
            <div>
              <Btn kind="primary" onClick={onSubscribe} disabled={subscribeBusy}>
                {subscribeBusy ? 'Redirection…' : 'Finaliser le paiement'}
              </Btn>
            </div>
            {subscribeErr && <div className="error">{subscribeErr}</div>}
          </div>
        </InfoBox>
      )}

      <Card style={{ padding: '22px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 800 }}>Abonnement de « {botName} »</div>
            <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 3 }}>
              Statut : {SUB_STATUS_LABELS[status] ?? SUB_STATUS_LABELS.none}
            </div>
          </div>
          <Link to="/app/billing" className="btn btn-soft" style={{ textDecoration: 'none' }}>
            Moyens de paiement & factures
          </Link>
        </div>
      </Card>

      {/* COMPOSEZ / MODIFIEZ VOTRE PLAN — la liste des modules est TOUJOURS
          visible (cochez/décochez), même sans abonnement. planManageable ->
          changement au prorata (ajouts) + fin de période (retraits) ; sinon ->
          « Valider et payer » ouvre le Checkout. */}
      <Card style={{ padding: '22px 22px' }}>
        <div style={{ minWidth: 0, marginBottom: 16 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>
            {planManageable ? 'Modifier mon plan' : 'Composez votre abonnement'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 3, lineHeight: 1.5 }}>
            Cochez les modules à activer.{' '}
            {planManageable
              ? 'Appliqué immédiatement : les ajouts sont facturés au prorata du mois, les retraits prennent effet en fin de période (sans crédit).'
              : 'La validation ouvre le paiement : 1er mois à tarif réduit, puis plein tarif (sans engagement, annulable à tout moment).'}
          </div>
        </div>
        {!catalog ? (
          <div style={{ fontSize: 12.5, color: catalogErr ? 'var(--danger)' : 'var(--mut)' }}>
            {catalogErr
              ? 'Catalogue indisponible pour le moment — réessayez dans un instant.'
              : 'Chargement du catalogue…'}
          </div>
        ) : planConfig && (
          <div className="col" style={{ gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }}>
              <BotConfigurator catalog={catalog} config={planConfig} onChange={onPlanChange} tree={tree} />
              <PriceCart catalog={catalog} config={planConfig}
                         baseline={planManageable && billing
                           ? { modules: billing.active_modules, ai_tier_id: billing.ai_tier_id, ai_byok: billing.ai_byok }
                           : null}
                         title={planManageable ? 'Nouveau plan' : 'Votre plan'} />
            </div>
            {planErr && <div className="error">{planErr}</div>}
            {/* Consentement OBLIGATOIRE à l'exécution immédiate (rétractation 14 j) —
                souscription initiale uniquement. Bloque « Valider et payer » tant que
                non coché ; horodaté côté serveur dans les métadonnées Stripe. */}
            {!planManageable && (
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer',
                              fontSize: 12, color: 'var(--mut)', lineHeight: 1.5 }}>
                <input type="checkbox" checked={planConsent}
                       onChange={e => onConsentChange(e.target.checked)}
                       style={{ marginTop: 2, flex: '0 0 auto' }} />
                <span>
                  Je demande l'exécution immédiate du service et reconnais perdre mon droit de
                  rétractation au fur et à mesure de son exécution.
                </span>
              </label>
            )}
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <Btn kind="primary" onClick={onApplyPlan} disabled={planBusy || (!planManageable && !planConsent)}>
                {planBusy ? 'Traitement…' : planManageable ? 'Appliquer (prorata)' : 'Valider et payer'}
              </Btn>
            </div>
          </div>
        )}

        {/* Annulation fin de période — seulement si un abonnement est vivant. */}
        {planManageable && (
          <div style={{ borderTop: '1px solid var(--bd)', marginTop: 18, paddingTop: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Annuler l'abonnement</div>
            <div style={{ fontSize: 12.5, color: 'var(--mut)', margin: '3px 0 10px' }}>
              L'abonnement prend fin à la fin de la période en cours (aucun remboursement). Le bot
              reste actif jusque-là.
            </div>
            <Btn kind="danger" onClick={onCancel} disabled={cancelBusy}>
              {cancelBusy ? 'Annulation…' : "Annuler l'abonnement"}
            </Btn>
            {cancelErr && <div className="error" style={{ marginTop: 10 }}>{cancelErr}</div>}
          </div>
        )}
      </Card>

      {/* Quota IA (seulement si un plan managé avec quota est actif ; BYOK =
          illimité => quota_ai_replies null, on n'affiche pas de barre). */}
      {billing.ai_byok ? (
        <Card style={{ padding: '18px 22px' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>IA — BYOK</div>
          <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 4 }}>
            Clé du client : réponses illimitées, bot non métré.
          </div>
        </Card>
      ) : quota != null && quota > 0 ? (
        <Card style={{ padding: '18px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Réponses IA ce mois-ci</span>
            <span style={{ fontSize: 13, color: overQuota ? 'var(--danger)' : 'var(--mut)', fontWeight: 600 }}>
              {used.toLocaleString('fr-FR')} / {quota.toLocaleString('fr-FR')}
            </span>
          </div>
          <Meter pct={pct} tone={overQuota ? 'danger' : nearQuota ? 'warn' : 'acc'} />
          {overQuota ? (
            <div style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>
              Quota atteint : l'IA est en pause jusqu'au prochain cycle — souscrivez un plan
              supérieur pour augmenter le quota.
            </div>
          ) : nearQuota ? (
            <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 8 }}>
              Quota bientôt atteint ({pct}%). Pensez à passer à un plan supérieur pour éviter
              une coupure de l'IA.
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* DÉPASSEMENT FACTURÉ (toggle owner) — visible seulement pour un plan IA
          managé métré (metering_available, non BYOK, quota fini). Servir + facturer
          au-delà du quota, avec un plafond de sécurité. Défaut 'block' (rien ne
          change tant que l'owner n'active pas). */}
      {billing.metering_available && !billing.ai_byok && quota != null && quota > 0 && catalog && (
        <OverageCard billing={billing} catalog={catalog}
                     onToggleOverage={onToggleOverage} overageBusy={overageBusy} overageErr={overageErr} />
      )}

      <Card style={{ padding: '18px 22px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Modules actifs</div>
        {modules.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--mut)' }}>
            Aucun module payant — socle gratuit (arbre, apparence, triggers, analytics).
          </div>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {modules.map(m => <Chip key={m} tone="acc">{MODULE_LABELS[m] || m}</Chip>)}
          </div>
        )}
      </Card>
    </div>
  )
}

// Prix unitaire de dépassement (en centimes, ex. 1.5) -> « 0,015 € ». On divise
// par 100 (centimes -> euros) et on garde jusqu'à 3 décimales pour le sous-centime.
function fmtPerReply(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 3,
  })
}

// Carte « Dépassement facturé » (toggle owner + plafond de sécurité) — rendue
// uniquement pour un plan IA managé métré (gate dans BotBillingTab). Quand l'owner
// active le dépassement, l'IA continue de répondre au-delà du quota (servie +
// facturée 0,015 €/réponse) jusqu'au PLAFOND choisi, puis se met en pause. Le
// plafond est éditable localement avant d'être envoyé (onToggleOverage refetch).
function OverageCard({ billing, catalog, onToggleOverage, overageBusy, overageErr }: {
  billing: BotEntitlementView
  catalog: BillingCatalog
  onToggleOverage: (enabled: boolean, cap: number | null) => void
  overageBusy: boolean
  overageErr: string
}) {
  const enabled = billing.overage_enabled ?? billing.overage_mode === 'meter'
  // Plafond par défaut : valeur serveur du bot -> défaut du catalogue -> 1000.
  const defaultCap = billing.overage_cap ?? catalog.overage_cap_default ?? 1000
  // Prix unitaire métré : entitlement -> catalogue -> fallback 1,5 centime.
  const perReply = billing.overage_cents_per_reply ?? catalog.overage_cents_per_reply ?? 1.5
  const reported = billing.reported_overage ?? 0

  // Saisie locale du plafond (avant validation). On part de la valeur effective
  // du bot (overage_cap) si présente, sinon du défaut. Resync si le bot change.
  const [capInput, setCapInput] = useState<number>(billing.overage_cap ?? defaultCap)
  useEffect(() => {
    setCapInput(billing.overage_cap ?? defaultCap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billing.overage_cap])

  const cap = capInput > 0 ? capInput : defaultCap
  const capPct = cap > 0 ? Math.round((reported / cap) * 100) : 0
  const atCap = reported >= cap

  return (
    <Card style={{ padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Dépassement facturé</div>
          <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 4, lineHeight: 1.5 }}>
            Au-delà du quota mensuel, l'IA continue de répondre (au lieu de se mettre en pause)
            et chaque réponse supplémentaire est facturée {fmtPerReply(perReply)}, dans la limite
            d'un plafond de sécurité que vous fixez.
          </div>
        </div>
        <Toggle label="Dépassement facturé" on={enabled} disabled={overageBusy}
                onChange={v => onToggleOverage(v, v ? cap : null)} />
      </div>

      {enabled && (
        <div className="col" style={{ gap: 12, marginTop: 14 }}>
          <div>
            <span className="field-label">Plafond (réponses/mois au-delà du quota)</span>
            <div className="row g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="number" min={0} step={100} value={capInput}
                     disabled={overageBusy}
                     onChange={e => setCapInput(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                     style={{ width: 140 }} />
              <Btn kind="soft" small disabled={overageBusy || capInput === (billing.overage_cap ?? defaultCap)}
                   onClick={() => onToggleOverage(true, cap)}>
                {overageBusy ? 'Enregistrement…' : 'Enregistrer le plafond'}
              </Btn>
            </div>
            <div className="field-hint">
              {fmtPerReply(perReply)} par réponse au-delà du quota. Au plafond, l'IA se met en pause
              jusqu'au prochain cycle (aucun dépassement non plafonné).
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, color: 'var(--mut)', fontWeight: 600 }}>Dépassement ce mois-ci</span>
              <span style={{ fontSize: 12.5, color: atCap ? 'var(--danger)' : 'var(--mut)', fontWeight: 600 }}>
                {reported.toLocaleString('fr-FR')} / {cap.toLocaleString('fr-FR')}
              </span>
            </div>
            <Meter pct={capPct} tone={atCap ? 'danger' : capPct >= 80 ? 'warn' : 'acc'} />
          </div>
        </div>
      )}

      {overageErr && <div className="error" style={{ marginTop: 12 }}>{overageErr}</div>}
    </Card>
  )
}
