// Éditeur de bot (onglets définis dans TABS ci-dessous).
// Header bot (avatar navy, nom éditable inline, pills statut+mode, domaine · pk
// mono, bouton « Activer le bot » si inactif). L'état dirty est suivi PAR ONGLET
// (comparaison à savedBot, la photo du dernier état serveur, via useBotEditor) et
// matérialisé par une SAVE BAR SOMBRE fixée en bas (left:248px right:0) avec pills
// des onglets dirty + Annuler/Enregistrer + indication Ctrl/Cmd S.
//
// BotPage est un ORCHESTRATEUR fin : il compose l'éditeur (useBotEditor) et les
// hooks de domaine — facturation/abonnement (useBotBilling), intégrations
// (useBotIntegrations), génération d'arbre (useTreeGeneration) — puis distribue
// l'état aux sous-composants d'onglet (components/bot-tabs/*). Aucune logique
// métier n'est inline ici : seuls restent l'édition directe du bot
// (activate/move/domaine), l'import/export de config et l'assemblage du rendu.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useBotEditor } from '../hooks/useBotEditor'
import { useBotBilling } from '../hooks/useBotBilling'
import { useBotIntegrations } from '../hooks/useBotIntegrations'
import { useTreeGeneration } from '../hooks/useTreeGeneration'
import { Btn, Card, InfoBox } from '../ui'
import { findModelOption } from '../botConstants'
import { canAccessBotPerm, isBotBillingOwner, isPersonalBot } from '../utils/permissions'
import { errMsg } from '../utils/errors'
import OverviewTab from '../components/bot-tabs/OverviewTab'
import AppearanceTab from '../components/bot-tabs/AppearanceTab'
import TreeTab from '../components/bot-tabs/TreeTab'
import AiTab from '../components/bot-tabs/AiTab'
import HumanTab from '../components/bot-tabs/HumanTab'
import ActionsTab from '../components/bot-tabs/ActionsTab'
import IntegrationTab from '../components/bot-tabs/IntegrationTab'
import SecurityTab from '../components/bot-tabs/SecurityTab'
import BotBillingTab from '../components/bot-tabs/BotBillingTab'
import BotHeader from '../components/bot-tabs/BotHeader'
import SaveBar from '../components/bot-tabs/SaveBar'
import WidgetPreview from '../components/WidgetPreview'
import type { Bot } from '../types/bot'
import type { BotConfig, ModuleKey } from '../types/billing'

// 7 onglets au plus, regroupés par intention (au-delà, on ne s'y retrouve plus) :
// Aperçu, Apparence, Arbre, IA (+ actions et connecteurs), Humain, Installation
// (+ domaines, captcha, équipe, zone sensible), Facturation. Chaque onglet regroupe
// une ou plusieurs SECTIONS d'édition (useBotEditor suit le « sale » par section).
// perm = permission par bot requise pour un MEMBER (admins : tout) ; un onglet est
// visible si au moins une de ses sections l'est.
const TABS = [
  // Aperçu : landing de suivi du bot (perm 'appearance' : visible par tous).
  { id: 'overview', label: 'Aperçu', perm: 'appearance', sections: ['overview'] },
  { id: 'appearance', label: 'Apparence', perm: 'appearance', sections: ['appearance'] },
  { id: 'tree', label: 'Arbre', perm: 'context', sections: ['tree'] },
  { id: 'ai', label: 'IA et actions', perm: 'context', sections: ['ai', 'actions'] },
  { id: 'human', label: 'Humain', perm: 'context', sections: ['human'] },     // relais / handoff
  { id: 'install', label: 'Installation', perm: 'copy', sections: ['install', 'security'] },
  // Facturation : perm 'security', OWNER-ONLY (isBotBillingOwner), masqué si le
  // billing est désactivé (is_billing_enabled).
  { id: 'billing', label: 'Facturation', perm: 'security', sections: ['billing'] },
]
// Anciens liens (?tab=actions, ?tab=security) : vers l'onglet qui les contient.
const TAB_ALIASES: Record<string, string> = { actions: 'ai', security: 'install', integration: 'install' }
const tabOfSection = (section: string) => TABS.find(t => t.sections.includes(section))?.id || section

export default function BotPage() {
  const { id } = useParams()
  const botId = Number(id)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  // Config d'abonnement pré-remplie par le wizard de création (« Payer et activer
  // maintenant ») : portée via l'état de navigation, sert à amorcer le
  // configurateur de l'onglet Facturation (report des options choisies au wizard).
  const initialPlanConfig = (location.state as { initialConfig?: BotConfig } | null)?.initialConfig ?? null
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
    dirtyTabs, dirty, saved, setSaved, error, save, cancelChanges,
    patch, patchDesign, hasPerm,
    updateAction, addAction, removeAction, updateActionField, updateActionType,
    updateMcpServer, addMcpServer, removeMcpServer,
    updateTrigger, updateTriggerType, addTrigger, removeTrigger,
  } = editor

  const [tab, setTab] = useState(() => {
    const t = params.get('tab') || 'overview'
    return TAB_ALIASES[t] || t
  })

  // Domaine FACTURATION (entitlement + 5 flux d'abonnement + catalogue) : tout
  // l'état/les handlers vivent dans useBotBilling. `botBilling` alimente aussi les
  // verrous par module + le bandeau « Bot non activé » de la page.
  const {
    billing: botBilling,
    catalog, catalogErr,
    planConfig, setPlanConfig, planConsent, setPlanConsent,
    subscribeNow, subscribeBusy, subscribeErr,
    openPortal, portalBusy, portalErr,
    applyPlan, planBusy, planErr,
    cancelSubscription, cancelBusy, cancelErr,
    toggleOverage, overageBusy, overageErr,
  } = useBotBilling(botId, initialPlanConfig, tab)

  // Domaine INTÉGRATION (extraits d'intégration + copie de l'extrait courant).
  const { integrations, integType, setIntegType, currentInteg, copied, copySnippet } = useBotIntegrations(botId)

  // Domaine GÉNÉRATION D'ARBRE (panneau « Générer avec l'IA » de l'arbre A).
  const {
    genOpen, setGenOpen, genMode, setGenMode, genText, setGenText,
    genUrl, setGenUrl, genBusy, genError, generateTree,
  } = useTreeGeneration(botId, bot, patch)

  const [treeView, setTreeView] = useState<'a' | 'b'>('a')                  // arbre affiché par TreeFlow (A/B)
  const treeFileRef = useRef<HTMLInputElement>(null)
  const [newDomain, setNewDomain] = useState('')
  const [moveTarget, setMoveTarget] = useState<number | ''>('')   // équipe cible du déplacement
  const [moveBusy, setMoveBusy] = useState(false)
  const [pageError, setPageError] = useState('')   // erreurs hors save (import, delete) — dismissable

  // Save bar (modifications non enregistrées / erreur / enregistré) : on mesure
  // sa hauteur réelle pour relever le widget flottant juste au-dessus quand elle
  // est affichée — sinon la barre masque la bulle posée en bas de page.
  const barVisible = dirty || saved || !!error
  const saveBarRef = useRef<HTMLDivElement>(null)
  const [saveBarH, setSaveBarH] = useState(0)
  useLayoutEffect(() => {
    if (!barVisible) { setSaveBarH(0); return }
    const measure = () => setSaveBarH(saveBarRef.current?.offsetHeight ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [barVisible, isMobile])

  // Aperçu de l'onglet Apparence : ouvrir/fermer le panneau de la DÉMO flottante
  // et choisir son côté (DÉMO uniquement — n'affecte pas design.position), pour
  // pouvoir lire/modifier avec le panneau ouvert sans qu'il masque les réglages.
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSide, setPreviewSide] = useState<'left' | 'right'>('left')

  const fromAdmin = params.get('from') === 'admin'
  const isAdminView = !!user?.is_superadmin && fromAdmin

  // Permissions par bot : admins d'org et superadmins ont tout, les members
  // voient uniquement les onglets couverts par leurs permissions. Un bot PERSO
  // (owner_user_id, pas d'organization_id) donne tous les droits à son
  // propriétaire — pas de notion d'org/de membership.
  const botOrg = user?.organizations.find(o => o.id === bot?.organization_id)
  const orgName = botOrg?.name || ''
  const isPersonalScope = !!bot && isPersonalBot(bot)
  // Admin d'org (ou superadmin / propriétaire perso) : zone de danger. La perm
  // « admin » n'est jamais accordée par bot → canAccessBotPerm ne renvoie true
  // que pour superadmin / propriétaire / role admin.
  const isOrgAdmin = !!bot && canAccessBotPerm(user, bot, 'admin')
  // Mode arbre pur : les onglets IA et Actions n'ont pas lieu d'être
  const aiTabRelevant = !!bot && bot.mode !== 'tree'
  // L'onglet Facturation n'apparaît que si : billing actif (clés Stripe posées)
  // ET l'utilisateur est le PAYEUR de ce bot (owner d'org / propriétaire perso /
  // superadmin). Sinon il disparaît purement (jamais d'onglet vide ou 403 visuel).
  const billingTabVisible = !!bot && !!user?.is_billing_enabled && isBotBillingOwner(user, bot)
  // Verrou par module (VISIBLE-MAIS-VERROUILLÉ) : un module est verrouillé quand
  // l'entitlement est chargé ET qu'il ne figure pas dans active_modules. On NE
  // garde PAS le garde user.is_billing_enabled : active_modules reflète déjà
  // resolve() côté serveur — billing OFF (clés Stripe absentes) renvoie TOUS les
  // modules, donc rien ne se verrouille. Tant que l'entitlement n'est pas chargé
  // (botBilling null), rien n'est verrouillé non plus (pas de faux cadenas).
  const moduleLocked = (m: ModuleKey) => !!botBilling && !(botBilling.active_modules || []).includes(m)
  // Modules entitlés (Set) pour l'éditeur d'arbre : un nœud dont le module n'est
  // pas actif affiche un cadenas. Non chargé (botBilling null) => undefined =>
  // aucun cadenas (même règle que moduleLocked : pas de faux verrou en chargement).
  const activeModules = useMemo<Set<ModuleKey> | undefined>(
    () => botBilling ? new Set(botBilling.active_modules || []) : undefined,
    [botBilling],
  )
  // Verrou « Propulsé par » : la retirer en production demande le module
  // White-label. Recalculé via moduleLocked pour la cohérence (même règle que les
  // autres modules ; le garde is_billing_enabled est retiré, cf. moduleLocked).
  const whiteLabelLocked = moduleLocked('white_label')
  // Onglet Installation : visible avec la perm « copy » OU « security » (domaines, captcha).
  const visibleTabs = TABS.filter(t =>
    (hasPerm(t.perm) || (t.id === 'install' && hasPerm('security')))
    && (t.id !== 'billing' || billingTabVisible),
  )
  const activeTab = visibleTabs.some(t => t.id === tab) ? tab : (visibleTabs[0]?.id || 'appearance')
  // Sections modifiées -> onglets qui les contiennent (pastille sur l'onglet, liens de la save bar).
  const dirtyGroups = useMemo(() => [...new Set(dirtyTabs.map(tabOfSection))], [dirtyTabs])

  // Bot à activer : entitlement chargé (owner) ET non actif/essai -> bandeau qui
  // pousse vers le paiement. Billing OFF => status 'active' (tout débloqué) => pas
  // de bandeau ; non-owner => botBilling null => pas de bandeau.
  const needsActivation = !!botBilling && botBilling.status !== 'active' && botBilling.status !== 'trialing'

  // Garde A/B : si la variante disparaît (Annuler, désactivation, reload), on
  // ne reste jamais sur la vue B — un seul TreeFlow monté, jamais avec
  // tree=null (couvre cancelChanges ET la désactivation).
  useEffect(() => {
    if (bot && !bot.tree_variant_json && treeView === 'b') setTreeView('a')
  }, [bot, treeView])

  function switchTab(target: string) {
    const t = TAB_ALIASES[target] || target
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

  function addDomain() {
    if (!bot) return
    const dd = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (dd && !bot.allowed_domains.includes(dd)) patch({ allowed_domains: [...bot.allowed_domains, dd] })
    setNewDomain('')
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
  const actions = bot.actions_json || []
  const mcpServers = bot.mcp_servers_json || []
  const canActivate = !bot.is_active && hasPerm('security')
  // Bot perso déplaçable vers une équipe si l'utilisateur en a au moins une
  // (POST /move réservé serveur au propriétaire).
  const myTeams = user?.organizations || []
  const canMoveToTeam = isPersonalScope && myTeams.length > 0

  return (
    <div className="col" style={{ gap: 16, paddingBottom: dirty || saved || error ? 76 : 0 }}>
      {isAdminView && (
        <InfoBox tone="warn" title="Vue admin">
          Vous éditez le bot d'un client ({orgName}). Chaque modification est journalisée.
        </InfoBox>
      )}

      <BotHeader bot={bot} design={d} site={site} orgName={orgName} isAdminView={isAdminView}
                 hasPerm={hasPerm} patch={patch} canActivate={canActivate} activateBot={activateBot}
                 onBack={() => navigate(isAdminView ? `/admin/clients/${bot.organization_id}` : '/app')} />

      {pageError && (
        <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{pageError}</span>
          <button onClick={() => setPageError('')} aria-label="Fermer"
                  style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15, padding: 2, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Bandeau « Bot non activé » : pousse vers le paiement, présent sur tous les
          onglets (sauf Facturation) tant que le bot n'est pas souscrit. Skippable :
          n'empêche pas la configuration ; le widget reste hors ligne jusqu'au paiement. */}
      {needsActivation && tab !== 'billing' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                      background: 'var(--warn-soft)', border: '1px solid var(--warn-bd)',
                      borderRadius: 10, padding: '11px 14px', marginBottom: 14 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>Bot non activé</div>
            <div style={{ fontSize: 12.5, color: 'var(--mut)' }}>
              Le widget reste hors ligne tant que tu n'as pas souscrit. Configure‑le librement — il s'active dès le paiement.
            </div>
          </div>
          <Btn kind="primary" small onClick={() => switchTab('billing')}>Activer / Payer →</Btn>
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
              {dirtyGroups.includes(t.id) && <span className="tab-dot" aria-hidden="true" />}
            </button>
          </Fragment>
        ))}
      </div>

      {/* ================= APERÇU ================= */}
      {activeTab === 'overview' && (
        <OverviewTab
          bot={bot}
          billing={botBilling}
          billingTabVisible={billingTabVisible}
          hasPerm={hasPerm}
          switchTab={switchTab}
          activateBot={activateBot}
          newDomain={newDomain}
          setNewDomain={setNewDomain}
          addDomain={addDomain}
          patch={patch}
          subscribeNow={subscribeNow}
          subscribeBusy={subscribeBusy}
          integrationSnippet={integrations[0]?.snippet}
        />
      )}

      {/* ================= APPARENCE ================= */}
      {activeTab === 'appearance' && (
        <AppearanceTab bot={bot} patch={patch} patchDesign={patchDesign} isMobile={isMobile}
                       site={site} orgName={orgName}
                       updateTrigger={updateTrigger} updateTriggerType={updateTriggerType}
                       addTrigger={addTrigger} removeTrigger={removeTrigger}
                       previewOpen={previewOpen} setPreviewOpen={setPreviewOpen}
                       previewSide={previewSide} setPreviewSide={setPreviewSide}
                       whiteLabelLocked={whiteLabelLocked} onUpgrade={() => switchTab('billing')} />
      )}

      {/* ================= ARBRE ================= */}
      {/* abLocked : seule la carte « Test A/B de l'arbre » est verrouillée
          (module 'ab') ; l'éditeur d'arbre reste gratuit (socle). */}
      {activeTab === 'tree' && (
        <TreeTab bot={bot} patch={patch} hasPerm={hasPerm} aiTabRelevant={aiTabRelevant}
                 treeView={treeView} setTreeView={setTreeView}
                 genOpen={genOpen} setGenOpen={setGenOpen} genMode={genMode} setGenMode={setGenMode}
                 genText={genText} setGenText={setGenText} genUrl={genUrl} setGenUrl={setGenUrl}
                 genBusy={genBusy} genError={genError} generateTree={generateTree}
                 exportConfig={exportConfig} importConfig={importConfig} treeFileRef={treeFileRef}
                 abLocked={moduleLocked('ab')} onUpgrade={() => switchTab('billing')}
                 activeModules={activeModules} />
      )}

      {/* ================= IA ================= */}
      {/* locked : panneau de config IA (module 'ai') ; ragLocked : base de
          connaissances (module 'rag', rendue via KbPanel dans AiTab). */}
      {activeTab === 'ai' && (
        <AiTab bot={bot} patch={patch} byokKey={byokKey} setByokKey={setByokKey}
               currentModel={currentModel} botId={botId} aiTabRelevant={aiTabRelevant}
               locked={moduleLocked('ai')} ragLocked={moduleLocked('rag')}
               onUpgrade={() => switchTab('billing')} />
      )}

      {/* ================= HUMAIN (relais / handoff) ================= */}
      {/* locked : configuration du relais humain / live chat (module 'inbox'). */}
      {activeTab === 'human' && (
        <HumanTab bot={bot} patch={patch} hasPerm={hasPerm} switchTab={switchTab}
                  aiTabRelevant={aiTabRelevant}
                  locked={moduleLocked('inbox')} onUpgrade={() => switchTab('billing')} />
      )}

      {/* ================= ACTIONS ET CONNECTEURS (dans l'onglet IA) ================= */}
      {/* Deux modules distincts : actionsLocked → 'actions' (sans IA) ; mcpLocked →
          'mcp' (outils appelés par l'IA). aiActive masque/verrouille la section MCP
          quand l'IA est OFF (mode arbre). Sans IA : rien à brancher, section masquée. */}
      {activeTab === 'ai' && aiTabRelevant && (
        <ActionsTab bot={bot} savedBot={savedBot} patch={patch} actions={actions} mcpServers={mcpServers}
                    actionSecrets={actionSecrets} setActionSecretAt={setActionSecretAt}
                    mcpTokens={mcpTokens} setMcpTokenAt={setMcpTokenAt}
                    updateAction={updateAction} addAction={addAction} removeAction={removeAction}
                    updateActionField={updateActionField} updateActionType={updateActionType}
                    updateMcpServer={updateMcpServer} addMcpServer={addMcpServer} removeMcpServer={removeMcpServer}
                    actionsLocked={moduleLocked('actions')} mcpLocked={moduleLocked('mcp')}
                    aiActive={aiTabRelevant} onUpgrade={() => switchTab('billing')} />
      )}

      {/* ================= INTÉGRATION ================= */}
      {activeTab === 'install' && hasPerm('copy') && (
        <IntegrationTab bot={bot} integrations={integrations} integType={integType}
                        setIntegType={setIntegType} currentInteg={currentInteg}
                        copied={copied} copySnippet={copySnippet} hasPerm={hasPerm}
                        activateBot={activateBot} isMobile={isMobile} />
      )}

      {/* ================= SÉCURITÉ (dans l'onglet Installation) ================= */}
      {activeTab === 'install' && hasPerm('security') && (
        <SecurityTab bot={bot} patch={patch} newDomain={newDomain} setNewDomain={setNewDomain}
                     addDomain={addDomain} captchaSecret={captchaSecret} setCaptchaSecret={setCaptchaSecret}
                     canMoveToTeam={canMoveToTeam} myTeams={myTeams} moveTarget={moveTarget}
                     setMoveTarget={setMoveTarget} moveBusy={moveBusy} moveToTeam={moveToTeam}
                     isOrgAdmin={isOrgAdmin} />
      )}

      {/* ================= FACTURATION ================= */}
      {activeTab === 'billing' && (
        <BotBillingTab billing={botBilling} botName={bot.name}
                       onSubscribe={subscribeNow} subscribeBusy={subscribeBusy} subscribeErr={subscribeErr}
                       onPortal={openPortal} portalBusy={portalBusy} portalErr={portalErr}
                       catalog={catalog} catalogErr={catalogErr} isMobile={isMobile}
                       planConfig={planConfig} onPlanChange={setPlanConfig}
                       onApplyPlan={applyPlan} planBusy={planBusy} planErr={planErr}
                       planConsent={planConsent} onConsentChange={setPlanConsent}
                       onCancel={cancelSubscription} cancelBusy={cancelBusy} cancelErr={cancelErr}
                       onToggleOverage={toggleOverage} overageBusy={overageBusy} overageErr={overageErr}
                       tree={bot.tree_json} />
      )}

      {/* Widget de TEST flottant : le vrai aperçu du chatbot, posé directement sur
          la page du bot (bulle en bas, comme s'il était déployé sur un site). Lit
          le tree_json EN MÉMOIRE -> reflète les modifications non enregistrées ;
          réponses IA simulées (aucun appel). Calque pointer-events:none -> ne bloque
          aucun clic de la page ; le wrap interne ré-active les clics du widget.
          Affiché sur TOUS les onglets, y compris Apparence. */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        // Le bas du calque s'arrête au-dessus de la save bar quand elle est
        // affichée : la bulle (positionnée bottom:offsetY dans WidgetPreview)
        // remonte d'autant et n'est plus masquée.
        bottom: barVisible ? saveBarH : 0,
        zIndex: 60, pointerEvents: 'none', transition: 'bottom .18s ease',
      }}>
        <div style={{ pointerEvents: 'auto' }}>
          {/* key sur previewOpen : remonte la démo ouverte/fermée selon le contrôle
              d'aperçu de l'onglet Apparence. Le côté n'est forcé que sur Apparence. */}
          <WidgetPreview key={`fp-${previewOpen}`} design={d} mode={bot.mode} botName={bot.name}
                         defaultOpen={previewOpen}
                         positionOverride={activeTab === 'appearance' ? previewSide : undefined}
                         tree={treeView === 'b' && bot.tree_variant_json ? bot.tree_variant_json : bot.tree_json} />
        </div>
      </div>

      {/* ================= SAVE BAR SOMBRE (fixée bas, left:248px) ================= */}
      {(dirty || saved || error) && (
        <SaveBar saveBarRef={saveBarRef} isMobile={isMobile} dirty={dirty} saved={saved} error={error}
                 dirtyTabs={dirtyGroups} visibleTabs={visibleTabs} switchTab={switchTab}
                 cancelChanges={cancelChanges} save={save} />
      )}
    </div>
  )
}
