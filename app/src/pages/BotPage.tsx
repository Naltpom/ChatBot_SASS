// Éditeur de bot — refonte charte Chapote. 7 onglets :
// Apparence / Arbre / IA / Humain / Actions / Intégration / Sécurité.
// Header bot (avatar navy, nom éditable inline, pills statut+mode, domaine · pk
// mono, bouton « Activer le bot » si inactif). L'état dirty est suivi PAR ONGLET
// (comparaison à savedBot, la photo du dernier état serveur, via useBotEditor) et
// matérialisé par une SAVE BAR SOMBRE fixée en bas (left:248px right:0) avec pills
// des onglets dirty + Annuler/Enregistrer + indication Ctrl/Cmd S.
// Stats / Insights / Leads / Inbox sont désormais des pages dédiées (les
// composants StatsPanel/InsightsPanel/InboxPanel restent dans components/ et
// sont importés ailleurs — ils ne sont plus montés ici).
import { Fragment, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useBotEditor } from '../hooks/useBotEditor'
import {
  Btn, BubbleIcon, Card, Chip, InfoBox, Meter,
  brandBg, modeChip, statusChip,
} from '../ui'
import { findModelOption } from '../botConstants'
import { canAccessBotPerm, isBotBillingOwner, isPersonalBot } from '../utils/permissions'
import { errMsg } from '../utils/errors'
import AppearanceTab from '../components/bot-tabs/AppearanceTab'
import TreeTab from '../components/bot-tabs/TreeTab'
import AiTab from '../components/bot-tabs/AiTab'
import HumanTab from '../components/bot-tabs/HumanTab'
import ActionsTab from '../components/bot-tabs/ActionsTab'
import IntegrationTab from '../components/bot-tabs/IntegrationTab'
import SecurityTab from '../components/bot-tabs/SecurityTab'
import WidgetPreview from '../components/WidgetPreview'
import BotConfigurator from '../components/billing/BotConfigurator'
import PriceCart from '../components/billing/PriceCart'
import { FALLBACK_CATALOG } from '../utils/billing'
import type { Bot, Integration, Tree } from '../types/bot'
import type {
  BillingCatalog, BotBilling, BotConfig,
  SubscriptionCancelResponse, SubscriptionUpdateResponse,
} from '../types/billing'

// L'entitlement (GET /api/bots/{id}/entitlement) enrichit `BotBilling` avec
// l'état d'essai 7 j (fin du gratuit à vie) : `status` brut (incl. 'trialing'),
// `trial_end` (epoch s|null) et `trial_expired`. Ces champs ne figurent pas
// encore sur le contrat partagé `BotBilling` ; on les déclare ici (lecture seule,
// alignés routers/billing.get_bot_entitlement) sans modifier le type partagé.
type BotEntitlementView = BotBilling & {
  status?: string
  trial_end?: number | null
  trial_expired?: boolean
}

// perm = permission par bot requise pour un MEMBER (admins : tout). Libellés
// EXACTS de la charte Chapote. L'onglet 'appearance' reste PREMIER (fallback
// activeTab).
const TABS = [
  { id: 'appearance', label: 'Apparence', perm: 'appearance' },
  { id: 'tree', label: 'Arbre', perm: 'context' },
  { id: 'ai', label: 'IA', perm: 'context' },           // si aiTabRelevant
  { id: 'human', label: 'Humain', perm: 'context' },     // relais / handoff
  { id: 'actions', label: 'Actions', perm: 'context' },  // si aiTabRelevant
  { id: 'install', label: 'Intégration', perm: 'copy' },
  { id: 'security', label: 'Sécurité', perm: 'security' },
  // Facturation : réutilise la perm 'security' (PAS de nouvelle BOT_PERMS), mais
  // en plus gardé OWNER-ONLY (isBotBillingOwner) dans visibleTabs, et masqué si
  // le billing est désactivé (is_billing_enabled). Détail produit § BotPage.
  { id: 'billing', label: 'Facturation', perm: 'security' },
]

export default function BotPage() {
  const { id } = useParams()
  const botId = Number(id)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  // Responsive : le shell passe la sidebar en drawer sous 860px (contrat
  // burger). La save bar sombre est fixée et alignée sur la sidebar (left:248px) ;
  // en mobile elle doit passer à left:0. Même breakpoint que le shell (860px).
  const isMobile = useIsMobile()

  // Éditeur : bot/savedBot, dirty-tracking par onglet, save/cancel, patchs,
  // CRUD listes JSON (actions/mcp/triggers), secrets write-only, Ctrl+S.
  const editor = useBotEditor(botId, user)
  const {
    bot, savedBot, setBot, setSavedBot, loadError, reload,
    byokKey, setByokKey, captchaSecret, setCaptchaSecret,
    actionSecrets, mcpTokens,
    setActionSecretAt, setMcpTokenAt,
    dirtyTabs, dirty, saved, setSaved, error, setError, save, cancelChanges,
    patch, patchDesign, hasPerm,
    updateAction, addAction, removeAction, updateActionField, updateActionType,
    updateMcpServer, addMcpServer, removeMcpServer,
    updateTrigger, updateTriggerType, addTrigger, removeTrigger,
  } = editor

  const [tab, setTab] = useState(params.get('tab') || 'appearance')
  const [treeView, setTreeView] = useState<'a' | 'b'>('a')                  // arbre affiché par TreeFlow (A/B)
  const [genOpen, setGenOpen] = useState(false)                            // panneau « Générer avec l'IA » (arbre A)
  const [genMode, setGenMode] = useState<'text' | 'url'>('text')
  const [genText, setGenText] = useState('')
  const [genUrl, setGenUrl] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState('')
  const treeFileRef = useRef<HTMLInputElement>(null)
  const [newDomain, setNewDomain] = useState('')
  const [moveTarget, setMoveTarget] = useState<number | ''>('')   // équipe cible du déplacement
  const [moveBusy, setMoveBusy] = useState(false)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [integType, setIntegType] = useState('html')
  const [copied, setCopied] = useState(false)
  const [pageError, setPageError] = useState('')   // erreurs hors save (import, delete) — dismissable
  // État de facturation du bot (onglet Facturation) : modules actifs / quota IA /
  // statut d'abonnement. Chargé paresseusement quand l'onglet devient visible.
  const [botBilling, setBotBilling] = useState<BotEntitlementView | null>(null)
  // Souscription / réactivation via Checkout (essai expiré) : busy + erreur.
  const [subscribeBusy, setSubscribeBusy] = useState(false)
  const [subscribeErr, setSubscribeErr] = useState('')
  // Gestion / annulation de l'essai via le Customer Portal : busy + erreur.
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalErr, setPortalErr] = useState('')
  // Gestion du plan EN APP (spec §1/§2) : catalogue (configurateur), bloc
  // « Modifier mon plan » ouvert + config en cours d'édition, application au
  // prorata (busy/err) et annulation fin de période (busy/err).
  const [catalog, setCatalog] = useState<BillingCatalog>(FALLBACK_CATALOG)
  const [planOpen, setPlanOpen] = useState(false)
  const [planConfig, setPlanConfig] = useState<BotConfig | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planErr, setPlanErr] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelErr, setCancelErr] = useState('')

  const fromAdmin = params.get('from') === 'admin'
  const isAdminView = !!user?.is_superadmin && fromAdmin

  useEffect(() => {
    api<{ integrations: Integration[] }>(`/api/bots/${botId}/embed`)
      .then(d => setIntegrations(d.integrations)).catch(() => {})
  }, [botId])

  // Facturation du bot : chargée uniquement quand l'onglet Facturation est
  // ouvert (billing actif + payeur). On lit GET /api/bots/{id}/entitlement
  // (require_billing_owner côté serveur ; échec silencieux -> on n'affiche rien).
  useEffect(() => {
    if (tab !== 'billing') return
    let alive = true
    api<BotEntitlementView>(`/api/bots/${botId}/entitlement`)
      .then(d => { if (alive) setBotBilling(d) })
      .catch(() => { if (alive) setBotBilling(null) })
    return () => { alive = false }
  }, [tab, botId])

  // Catalogue de facturation : chargé quand l'onglet Facturation est ouvert
  // (sert le configurateur « Modifier mon plan »). Repli silencieux sur
  // FALLBACK_CATALOG (déjà en état initial) si indisponible. Invariant billing
  // OFF : l'onglet n'est pas visible (billingTabVisible) -> jamais d'appel.
  useEffect(() => {
    if (tab !== 'billing') return
    let alive = true
    api<BillingCatalog>('/api/billing/catalog')
      .then(c => { if (alive) setCatalog(c) })
      .catch(() => { /* repli FALLBACK_CATALOG */ })
    return () => { alive = false }
  }, [tab])

  // Permissions par bot : admins d'org et superadmins ont tout, les members
  // voient uniquement les onglets couverts par leurs permissions. Un bot PERSO
  // (owner_user_id, pas d'organization_id) donne tous les droits à son
  // propriétaire — pas de notion d'org/de membership.
  const botOrg = user?.organizations.find(o => o.id === bot?.organization_id)
  const orgName = botOrg?.name || ''
  const isPersonalScope = !!bot && isPersonalBot(bot)
  // Admin d'org (ou superadmin / propriétaire perso) : zone de danger. La perm
  // « admin » n'est jamais accordée par bot → canAccessBotPerm ne renvoie true
  // que pour superadmin / propriétaire / role admin (équivalent à l'ancien calcul).
  const isOrgAdmin = !!bot && canAccessBotPerm(user, bot, 'admin')
  // Mode arbre pur : les onglets IA et Actions n'ont pas lieu d'être
  const aiTabRelevant = !!bot && bot.mode !== 'tree'
  // L'onglet Facturation n'apparaît que si : billing actif (clés Stripe posées)
  // ET l'utilisateur est le PAYEUR de ce bot (owner d'org / propriétaire perso /
  // superadmin). Sinon il disparaît purement (jamais d'onglet vide ou 403 visuel).
  const billingTabVisible = !!bot && !!user?.is_billing_enabled && isBotBillingOwner(user, bot)
  const visibleTabs = TABS.filter(t =>
    hasPerm(t.perm)
    && ((t.id !== 'ai' && t.id !== 'actions') || aiTabRelevant)
    && (t.id !== 'billing' || billingTabVisible),
  )
  const activeTab = visibleTabs.some(t => t.id === tab) ? tab : (visibleTabs[0]?.id || 'appearance')

  // Garde A/B : si la variante disparaît (Annuler, désactivation, reload), on
  // ne reste jamais sur la vue B — un seul TreeFlow monté, jamais avec
  // tree=null (couvre cancelChanges ET la désactivation).
  useEffect(() => {
    if (bot && !bot.tree_variant_json && treeView === 'b') setTreeView('a')
  }, [bot, treeView])

  function switchTab(t: string) {
    setTab(t)
    params.set('tab', t)
    setParams(params, { replace: true })
  }

  // Activer le bot depuis le header / la zone de danger. is_active est en
  // TAB_FIELDS.security : un PATCH direct (immédiat, hors save bar) serait plus
  // sain — mais pour respecter le pattern savedBot, on passe par patch() qui
  // rend l'onglet Sécurité dirty (la save bar apparaît, l'utilisateur confirme).
  // Le header n'apparaît que pour un bot inactif et n'est rendu que si
  // l'utilisateur peut sauver la sécurité.
  function activateBot() {
    patch({ is_active: true })
  }

  function exportConfig() {
    if (!bot) return
    api(`/api/bots/${botId}/config.json`).then(config => {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `bot-${bot.name.toLowerCase().replace(/\s+/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    }).catch((err: unknown) => setPageError(`Export échoué : ${errMsg(err, 'erreur')}`))
  }

  function importConfig(file: File) {
    file.text().then(text => api<Bot>(`/api/bots/${botId}/config.json`, { method: 'PUT', body: JSON.parse(text) }))
      .then(updated => {
        setBot(updated)
        setSavedBot(updated)
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      })
      .catch((err: unknown) => setPageError(`Import échoué : ${errMsg(err, 'erreur')}`))
  }

  // Copie de l'extrait d'intégration courant (clipboard + flag « Copié »
  // 1,6 s). Passé en prop à IntegrationTab.
  function copySnippet() {
    navigator.clipboard.writeText(currentInteg?.snippet || '').catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // Génération d'arbre par l'IA (perm contexte, treegen_limiter 10/24h/org) :
  // POST /tree/generate renvoie un tree_json NON sauvegardé → on le pose dans
  // l'arbre A local (la save bar apparaît, l'utilisateur prévisualise puis
  // enregistre). Réservée à la vue A : la variante B n'a pas de génération.
  async function generateTree() {
    if (!bot) return
    setGenError('')
    setGenBusy(true)
    try {
      const body = genMode === 'url' ? { url: genUrl.trim() } : { source_text: genText }
      const res = await api<{ tree_json: Tree }>(`/api/bots/${botId}/tree/generate`, { method: 'POST', body })
      const nodeCount = Object.keys(bot.tree_json?.nodes || {}).length
      if (nodeCount > 2 && !window.confirm("Remplacer l'arbre actuel par l'arbre généré ?")) return
      patch({ tree_json: res.tree_json })
      setGenText('')
      setGenUrl('')
      setGenOpen(false)
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status
      setGenError(status === 429
        ? "Limite quotidienne atteinte : 10 générations d'arbre par jour et par organisation. Réessayez demain."
        : errMsg(err, 'Erreur'))
    } finally {
      setGenBusy(false)
    }
  }

  // Déplacement d'un bot PERSO vers une équipe (sens unique). Immédiat (hors
  // save bar) : POST /api/bots/{id}/move puis on remplace bot + savedBot par le
  // BotOut renvoyé (scope devient team).
  async function moveToTeam() {
    if (moveTarget === '' || !bot) return
    const org = (user?.organizations || []).find(o => o.id === moveTarget)
    if (!org) return
    if (!window.confirm(`Déplacer « ${bot.name} » vers l'équipe « ${org.name} » ? Ce transfert est définitif (un bot d'équipe ne peut pas redevenir perso).`)) return
    setMoveBusy(true)
    setPageError('')
    try {
      const updated = await api<Bot>(`/api/bots/${botId}/move`, { method: 'POST', body: { organization_id: moveTarget } })
      setBot(updated)
      setSavedBot(updated)
      setMoveTarget('')
    } catch (err: unknown) {
      setPageError(`Déplacement échoué : ${errMsg(err, 'erreur')}`)
    } finally {
      setMoveBusy(false)
    }
  }

  async function deleteBot() {
    if (!bot) return
    if (!window.confirm(`Supprimer définitivement « ${bot.name} » ?\n\nLe widget cessera de fonctionner sur tous les sites où il est installé, et les conversations seront perdues.`)) return
    try {
      await api(`/api/bots/${botId}`, { method: 'DELETE' })
      navigate(isAdminView ? `/admin/clients/${bot.organization_id}` : '/app')
    } catch (err: unknown) {
      setPageError(errMsg(err, 'Erreur'))
    }
  }

  function addDomain() {
    if (!bot) return
    const dd = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (dd && !bot.allowed_domains.includes(dd)) patch({ allowed_domains: [...bot.allowed_domains, dd] })
    setNewDomain('')
  }

  // Réactivation via Checkout (essai expiré / abonnement annulé -> bot gate) :
  // recrée un abonnement (essai 7 j, carte requise) sur la config DÉJÀ active
  // (modules + variante BYOK) via POST /api/billing/checkout. Le backend recalcule
  // les line_items. checkout_url -> redirection Stripe ; null/free -> souscription
  // immédiate (MOCK / catalogue gratuit), on recharge l'entitlement.
  async function subscribeNow() {
    if (!botBilling) return
    setSubscribeBusy(true)
    setSubscribeErr('')
    // L'entitlement ne porte pas le palier IA précis (ai_tier_id null) : on
    // rejoue les modules actifs + la variante BYOK. Le backend dérive les codes.
    const config: BotConfig = {
      modules: botBilling.active_modules,
      ai_tier_id: botBilling.ai_tier_id,
      ai_byok: botBilling.ai_byok,
    }
    try {
      const res = await api<{ checkout_url?: string | null; free?: boolean; billing?: string }>(
        '/api/billing/checkout',
        { method: 'POST', body: { bot_id: botId, config } },
      )
      if (res.checkout_url) { window.location.href = res.checkout_url; return }
      // Souscription immédiate (MOCK / gratuit) : on recharge l'entitlement.
      const updated = await api<BotEntitlementView>(`/api/bots/${botId}/entitlement`)
      setBotBilling(updated)
    } catch (err: unknown) {
      setSubscribeErr(errMsg(err, "La souscription n'a pas pu démarrer."))
    } finally {
      setSubscribeBusy(false)
    }
  }

  // « Gérer / Annuler l'essai » : ouvre le Customer Portal Stripe (POST
  // /api/billing/portal -> {portal_url|url}). Le client y annule l'abonnement
  // d'essai avant J+7 (-> subscription.deleted -> bot gate, 0 € débité) ou met à
  // jour sa carte. Redirection directe vers l'URL renvoyée.
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

  // « Modifier mon plan » : ouvre le configurateur pré-rempli avec la config
  // ACTIVE du bot (modules actifs + variante BYOK). L'entitlement ne porte pas le
  // palier IA précis (ai_tier_id null) ; le configurateur le rétablit si l'IA
  // managée reste cochée.
  function openPlanEditor() {
    if (!botBilling) return
    setPlanConfig({
      modules: botBilling.active_modules,
      ai_tier_id: botBilling.ai_tier_id,
      ai_byok: botBilling.ai_byok,
    })
    setPlanErr('')
    setPlanOpen(true)
  }

  // « Appliquer (prorata) » : POST /api/billing/subscription/update — changement
  // INSTANTANÉ au prorata du mois en cours (PAS de portail). Sans abonnement actif
  // sur le bot, l'API renvoie { needs_checkout, checkout_url } -> on redirige vers
  // le Checkout (relance). Sinon { updated } -> on recharge l'entitlement et on
  // referme le bloc. Billing OFF -> { billing:'disabled' } (jamais ici : onglet masqué).
  async function applyPlan() {
    if (!planConfig) return
    setPlanBusy(true)
    setPlanErr('')
    try {
      const res = await api<SubscriptionUpdateResponse>(
        '/api/billing/subscription/update',
        { method: 'POST', body: { bot_id: botId, config: planConfig } },
      )
      if ('status' in res && res.status === 'needs_checkout') {
        window.location.href = res.checkout_url
        return
      }
      const updated = await api<BotEntitlementView>(`/api/bots/${botId}/entitlement`)
      setBotBilling(updated)
      setPlanOpen(false)
    } catch (err: unknown) {
      setPlanErr(errMsg(err, "La modification du plan a échoué."))
    } finally {
      setPlanBusy(false)
    }
  }

  // « Annuler l'abonnement » : POST /api/billing/subscription/cancel — pose
  // cancel_at_period_end=true (FIN DE PÉRIODE, sans remboursement). Le bot reste
  // actif jusqu'à la fin de période puis est gate. On confirme explicitement.
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
      setBotBilling(updated)
    } catch (err: unknown) {
      setCancelErr(errMsg(err, "L'annulation a échoué."))
    } finally {
      setCancelBusy(false)
    }
  }

  if (!bot) {
    if (loadError) {
      return (
        <div className="center-page">
          <Card style={{ textAlign: 'center', padding: '36px 28px', maxWidth: 440 }}>
            <div className="col" style={{ alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800 }}>Impossible de charger ce chatbot</div>
              <div style={{ fontSize: 12.5, color: 'var(--mut)', lineHeight: 1.55 }}>{loadError}</div>
              <div className="row g8" style={{ marginTop: 4 }}>
                <Btn kind="soft" onClick={reload}>Réessayer</Btn>
                <Btn kind="ghost" onClick={() => navigate(fromAdmin ? '/admin/clients' : '/app')}>
                  {fromAdmin ? 'Retour aux clients' : 'Retour à mes chatbots'}
                </Btn>
              </div>
            </div>
          </Card>
        </div>
      )
    }
    return <div className="center-page">Chargement…</div>
  }

  const d = bot.design_json || {}
  const site = bot.allowed_domains[0] || 'votre-site.fr'
  const currentModel = findModelOption(bot.ai_provider, bot.ai_model)
  const currentInteg = integrations.find(i => i.id === integType) || integrations[0]
  const actions = bot.actions_json || []
  const mcpServers = bot.mcp_servers_json || []
  const canActivate = !bot.is_active && hasPerm('security')
  // Bot perso déplaçable vers une équipe si l'utilisateur en a au moins une
  // (POST /move réservé serveur au propriétaire). isPersonalScope défini plus haut.
  const myTeams = user?.organizations || []
  const canMoveToTeam = isPersonalScope && myTeams.length > 0

  return (
    <div className="col" style={{ gap: 16, paddingBottom: dirty || saved || error ? 76 : 0 }}>
      {isAdminView && (
        <InfoBox tone="warn" title="Vue admin">
          Vous éditez le bot d'un client ({orgName}). Chaque modification est journalisée.
        </InfoBox>
      )}

      <div>
        <button className="back-link"
                onClick={() => navigate(isAdminView ? `/admin/clients/${bot.organization_id}` : '/app')}>
          {isAdminView ? `← Bots de ${orgName}` : '← Mes chatbots'}
        </button>
        <div className="bot-head">
          <span className={`bot-avatar ${d.bordered ? 'bordered' : ''}`}
                style={{ width: 46, height: 46, borderRadius: 13, background: brandBg(d) }}>
            <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? 46 : 22} avatarImg={d.avatarImage} />
          </span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* Nom éditable inline (perm appearance) — sinon affiché en lecture seule */}
              {hasPerm('appearance') ? (
                <input type="text" value={bot.name} placeholder="Nom du bot"
                       onChange={e => patch({ name: e.target.value })}
                       style={{
                         fontFamily: 'var(--display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.02em',
                         color: 'var(--ink)', border: '1px solid transparent', borderRadius: 8,
                         padding: '1px 8px', marginLeft: -8, background: 'transparent', width: 340, maxWidth: '100%',
                         boxShadow: 'none',
                       }} />
              ) : (
                <span className="bot-head-title" style={{ marginBottom: 0, fontSize: 25 }}>{bot.name}</span>
              )}
              {statusChip(bot.is_active)}
              {modeChip(bot.mode)}
            </div>
            <div className="bot-head-key" style={{ marginTop: 3, fontSize: 13, color: 'var(--mut)' }}>{site} · {bot.public_key}</div>
          </div>
          {canActivate && (
            <Btn kind="primary" onClick={activateBot}>Activer le bot</Btn>
          )}
        </div>
      </div>

      {pageError && (
        <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{pageError}</span>
          <button onClick={() => setPageError('')} aria-label="Fermer"
                  style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15, padding: 2, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* En mobile : barre d'onglets scrollable horizontalement (nowrap +
          overflow-x) plutôt que wrap sur plusieurs lignes — jamais de
          débordement hors viewport. En desktop : comportement .tabs natif (wrap),
          on n'override pas. */}
      <div className="tabs" style={isMobile
        ? { flexWrap: 'nowrap', overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }
        : undefined}>
        {visibleTabs.map(t => (
          <Fragment key={t.id}>
            <button className={activeTab === t.id ? 'active' : ''} onClick={() => switchTab(t.id)}
                    style={isMobile ? { flexShrink: 0 } : undefined}>
              {t.label}
              {dirtyTabs.includes(t.id) && <span className="tab-dot" aria-hidden="true" />}
            </button>
          </Fragment>
        ))}
      </div>

      {/* ================= APPARENCE ================= */}
      {activeTab === 'appearance' && (
        <AppearanceTab bot={bot} patch={patch} patchDesign={patchDesign} isMobile={isMobile}
                       site={site} orgName={orgName}
                       updateTrigger={updateTrigger} updateTriggerType={updateTriggerType}
                       addTrigger={addTrigger} removeTrigger={removeTrigger} />
      )}

      {/* ================= ARBRE ================= */}
      {activeTab === 'tree' && (
        <TreeTab bot={bot} patch={patch} hasPerm={hasPerm} aiTabRelevant={aiTabRelevant}
                 treeView={treeView} setTreeView={setTreeView}
                 genOpen={genOpen} setGenOpen={setGenOpen} genMode={genMode} setGenMode={setGenMode}
                 genText={genText} setGenText={setGenText} genUrl={genUrl} setGenUrl={setGenUrl}
                 genBusy={genBusy} genError={genError} generateTree={generateTree}
                 exportConfig={exportConfig} importConfig={importConfig} treeFileRef={treeFileRef} />
      )}

      {/* ================= IA ================= */}
      {activeTab === 'ai' && (
        <AiTab bot={bot} patch={patch} byokKey={byokKey} setByokKey={setByokKey}
               currentModel={currentModel} botId={botId} aiTabRelevant={aiTabRelevant} />
      )}

      {/* ================= HUMAIN (relais / handoff) ================= */}
      {activeTab === 'human' && (
        <HumanTab bot={bot} patch={patch} hasPerm={hasPerm} switchTab={switchTab}
                  aiTabRelevant={aiTabRelevant} />
      )}

      {/* ================= ACTIONS IA ================= */}
      {activeTab === 'actions' && (
        <ActionsTab bot={bot} savedBot={savedBot} patch={patch} actions={actions} mcpServers={mcpServers}
                    actionSecrets={actionSecrets} setActionSecretAt={setActionSecretAt}
                    mcpTokens={mcpTokens} setMcpTokenAt={setMcpTokenAt}
                    updateAction={updateAction} addAction={addAction} removeAction={removeAction}
                    updateActionField={updateActionField} updateActionType={updateActionType}
                    updateMcpServer={updateMcpServer} addMcpServer={addMcpServer} removeMcpServer={removeMcpServer} />
      )}

      {/* ================= INTÉGRATION ================= */}
      {activeTab === 'install' && (
        <IntegrationTab bot={bot} integrations={integrations} integType={integType}
                        setIntegType={setIntegType} currentInteg={currentInteg}
                        copied={copied} copySnippet={copySnippet} hasPerm={hasPerm}
                        activateBot={activateBot} isMobile={isMobile} />
      )}

      {/* ================= SÉCURITÉ ================= */}
      {activeTab === 'security' && (
        <SecurityTab bot={bot} patch={patch} newDomain={newDomain} setNewDomain={setNewDomain}
                     addDomain={addDomain} captchaSecret={captchaSecret} setCaptchaSecret={setCaptchaSecret}
                     canMoveToTeam={canMoveToTeam} myTeams={myTeams} moveTarget={moveTarget}
                     setMoveTarget={setMoveTarget} moveBusy={moveBusy} moveToTeam={moveToTeam}
                     isOrgAdmin={isOrgAdmin} deleteBot={deleteBot} />
      )}

      {/* ================= FACTURATION ================= */}
      {activeTab === 'billing' && (
        <BotBillingTab billing={botBilling} botName={bot.name}
                       onSubscribe={subscribeNow} subscribeBusy={subscribeBusy} subscribeErr={subscribeErr}
                       onPortal={openPortal} portalBusy={portalBusy} portalErr={portalErr}
                       catalog={catalog} isMobile={isMobile}
                       planOpen={planOpen} onOpenPlan={openPlanEditor} onClosePlan={() => setPlanOpen(false)}
                       planConfig={planConfig} onPlanChange={setPlanConfig}
                       onApplyPlan={applyPlan} planBusy={planBusy} planErr={planErr}
                       onCancel={cancelSubscription} cancelBusy={cancelBusy} cancelErr={cancelErr} />
      )}

      {/* Widget de TEST flottant : le vrai aperçu du chatbot, posé directement sur
          la page du bot (bulle en bas, comme s'il était déployé sur un site). Lit
          le tree_json EN MÉMOIRE -> reflète les modifications non enregistrées ;
          réponses IA simulées (aucun appel). Calque pointer-events:none -> ne bloque
          aucun clic de la page ; le wrap interne ré-active les clics du widget.
          Masqué sur l'onglet Apparence (qui a déjà son aperçu encadré dédié). */}
      {activeTab !== 'appearance' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto' }}>
            <WidgetPreview design={d} mode={bot.mode} botName={bot.name} defaultOpen={false}
                           tree={treeView === 'b' && bot.tree_variant_json ? bot.tree_variant_json : bot.tree_json} />
          </div>
        </div>
      )}

      {/* ================= SAVE BAR SOMBRE (fixée bas, left:248px) ================= */}
      {(dirty || saved || error) && (
        <div role="status" style={{
          // En mobile (<=860px) la sidebar est un drawer off-canvas : la barre
          // doit couvrir toute la largeur (left:0). En desktop elle reste alignée
          // sur la sidebar fixe de 248px.
          position: 'fixed', left: isMobile ? 0 : 248, right: 0, bottom: 0, zIndex: 90,
          background: '#1E2A32', color: '#fff',
          boxShadow: '0 -12px 32px -14px rgba(0,0,0,.4)',
        }}>
          <div style={{
            maxWidth: 1080, margin: '0 auto', padding: isMobile ? '11px 14px' : '13px 28px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: isMobile ? 10 : 16, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0, fontSize: 13.5 }}>
              {error ? (
                <span style={{ color: '#FFB4AC', fontWeight: 700 }}>{error}</span>
              ) : dirty ? (
                <>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: '#E0A82E', display: 'inline-block', flexShrink: 0 }} />
                    Modifications non enregistrées
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {dirtyTabs.map(t => {
                      const def = TABS.find(x => x.id === t)
                      if (!def || !visibleTabs.some(v => v.id === t)) return null
                      return (
                        <button key={t} onClick={() => switchTab(t)} style={{
                          background: 'rgba(255,255,255,.1)', color: '#fff', border: 'none',
                          borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}>{def.label}</button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: '#7FE3BE' }}>
                  <Check size={16} /> Enregistré
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, color: '#7FA0B5', whiteSpace: 'nowrap' }}>Ctrl/Cmd S pour enregistrer</span>
              {dirty && (
                <button onClick={cancelChanges} style={{
                  background: 'transparent', color: '#D6E2EA', border: '1px solid rgba(255,255,255,.22)',
                  borderRadius: 10, padding: '10px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                }}>Annuler</button>
              )}
              <button onClick={save} disabled={!dirty && !saved} style={{
                background: dirty ? '#2F9E79' : 'rgba(255,255,255,.15)', color: '#fff', border: 'none',
                borderRadius: 10, padding: '10px 20px', fontWeight: 600, fontSize: 14,
                cursor: dirty ? 'pointer' : 'default', fontFamily: 'inherit',
              }}>{saved ? 'Enregistré' : 'Enregistrer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Libellés FR des clés de module (entitlement) pour l'onglet Facturation.
const MODULE_LABELS: Record<string, string> = {
  ai: 'Intelligence artificielle',
  inbox: 'Live chat / Inbox',
  rag: 'Connaissances (RAG)',
  actions: 'Actions & MCP',
  ab: 'A/B testing',
  white_label: 'White-label',
}
const SUB_STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  trialing: 'Essai gratuit',
  past_due: 'Paiement en retard',
  inactive: 'Paiement requis',
  canceled: 'Résilié',
  none: 'Aucun abonnement',
}

// Plafond IA pendant l'essai 7 j (carte requise). Levé au premier débit (J+7).
// Informatif (pas un prix codé en dur).
const TRIAL_AI_CAP = 50
// Jours restants avant la fin d'essai (epoch s -> ms, arrondi au jour supérieur).
function daysUntil(epochSeconds: number): number {
  const ms = epochSeconds * 1000 - Date.now()
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000)
}
// Date FR de fin d'essai (epoch s -> ms).
function fmtDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Onglet Facturation d'un bot : état d'essai 7 j avec carte (compte à rebours +
// auto-débit à J+7 sauf annulation + plafond IA + bouton portail d'annulation),
// état « Paiement requis » (status='inactive' -> relance du Checkout), bloc
// « Modifier mon plan » (configurateur pré-rempli + application AU PRORATA +
// annulation FIN DE PÉRIODE), récap des modules actifs, quota IA (Meter) avec
// alerte « quota proche / atteint », et renvoi vers la page Facturation pour les
// moyens de paiement & factures. Owner-only et monté uniquement si le billing est
// actif (voir billingTabVisible / visibleTabs).
function BotBillingTab({ billing, botName, onSubscribe, subscribeBusy, subscribeErr,
                         onPortal, portalBusy, portalErr,
                         catalog, isMobile,
                         planOpen, onOpenPlan, onClosePlan, planConfig, onPlanChange,
                         onApplyPlan, planBusy, planErr,
                         onCancel, cancelBusy, cancelErr }: {
  billing: BotEntitlementView | null
  botName: string
  onSubscribe: () => void
  subscribeBusy: boolean
  subscribeErr: string
  onPortal: () => void
  portalBusy: boolean
  portalErr: string
  catalog: BillingCatalog
  isMobile: boolean
  planOpen: boolean
  onOpenPlan: () => void
  onClosePlan: () => void
  planConfig: BotConfig | null
  onPlanChange: (next: BotConfig) => void
  onApplyPlan: () => void
  planBusy: boolean
  planErr: string
  onCancel: () => void
  cancelBusy: boolean
  cancelErr: string
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

  // État d'essai (fin du gratuit à vie). `status`/`subscription_status` peut valoir
  // 'trialing' ; `trial_end` (epoch s) porte l'échéance ; `trial_expired` = essai
  // échu sans souscription (bot bloqué).
  const status = billing.status ?? billing.subscription_status
  const trialEnd = billing.trial_end ?? null
  const onTrial = status === 'trialing' && trialEnd != null && trialEnd * 1000 > Date.now()
  const trialDaysLeft = trialEnd != null ? daysUntil(trialEnd) : 0
  const trialExpired = !!billing.trial_expired
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
      {/* ESSAI EN COURS : compte à rebours + auto-débit à J+7 + plafond IA + bouton
          portail pour annuler avant la fin (0 € débité). */}
      {onTrial && (
        <InfoBox tone="info" title={`Essai : ${trialDaysLeft} ${trialDaysLeft > 1 ? 'jours restants' : 'jour restant'}`}>
          <div className="col" style={{ gap: 12 }}>
            <span style={{ fontSize: 12.5 }}>
              {trialEnd != null && <>Essai gratuit jusqu'au {fmtDate(trialEnd)}. </>}
              L'abonnement sera débité automatiquement à la fin de l'essai (J+7) sauf annulation.
              L'IA est plafonnée à {TRIAL_AI_CAP} réponses pendant l'essai ; ce plafond est levé au
              premier débit. Annulez avant la fin depuis le portail : aucun montant ne sera prélevé.
            </span>
            <div>
              <Btn kind="soft" onClick={onPortal} disabled={portalBusy}>
                {portalBusy ? 'Ouverture…' : "Gérer / Annuler l'essai"}
              </Btn>
            </div>
            {portalErr && <div className="error">{portalErr}</div>}
          </div>
        </InfoBox>
      )}

      {/* ESSAI TERMINÉ : bot bloqué jusqu'à souscription. */}
      {trialExpired && (
        <InfoBox tone="warn" title="Essai terminé, souscrivez pour réactiver">
          <div className="col" style={{ gap: 12 }}>
            <span style={{ fontSize: 12.5 }}>
              L'essai gratuit de « {botName} » est terminé. Souscrivez pour réactiver le bot
              et ses modules.
            </span>
            <div>
              <Btn kind="primary" onClick={onSubscribe} disabled={subscribeBusy}>
                {subscribeBusy ? 'Redirection…' : 'Souscrire maintenant'}
              </Btn>
            </div>
            {subscribeErr && <div className="error">{subscribeErr}</div>}
          </div>
        </InfoBox>
      )}

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
              {onTrial && trialEnd != null && ` · fin de l'essai dans ${trialDaysLeft} ${trialDaysLeft > 1 ? 'jours' : 'jour'}`}
            </div>
          </div>
          <Link to="/app/billing" className="btn btn-soft" style={{ textDecoration: 'none' }}>
            Moyens de paiement & factures
          </Link>
        </div>
      </Card>

      {/* MODIFIER MON PLAN (point 1/2) : changement EN APP au prorata + annulation
          fin de période. Disponible uniquement quand un abonnement est vivant
          (planManageable) ; sinon le bon chemin est la (re)souscription ci-dessus. */}
      {planManageable && (
        <Card style={{ padding: '22px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800 }}>Modifier mon plan</div>
              <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 3 }}>
                Ajoutez ou retirez des modules : le changement est appliqué immédiatement, facturé
                au prorata du mois en cours.
              </div>
            </div>
            {!planOpen && (
              <Btn kind="soft" onClick={onOpenPlan}>Modifier mon plan</Btn>
            )}
          </div>

          {planOpen && planConfig && (
            <div className="col" style={{ gap: 16, marginTop: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }}>
                <BotConfigurator catalog={catalog} config={planConfig} onChange={onPlanChange} />
                <PriceCart catalog={catalog} config={planConfig} title="Nouveau plan" />
              </div>
              <div style={{ fontSize: 12, color: 'var(--mut)' }}>
                L'écart de prix est facturé (ou crédité) au prorata des jours restants du mois en
                cours, dès l'application.
              </div>
              {planErr && <div className="error">{planErr}</div>}
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                <Btn kind="primary" onClick={onApplyPlan} disabled={planBusy}>
                  {planBusy ? 'Application…' : 'Appliquer (prorata)'}
                </Btn>
                <Btn kind="ghost" onClick={onClosePlan} disabled={planBusy}>Annuler</Btn>
              </div>
            </div>
          )}

          {/* Annulation fin de période (point 2) : sans remboursement, bot actif
              jusqu'à la fin de période puis gate. */}
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
        </Card>
      )}

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
