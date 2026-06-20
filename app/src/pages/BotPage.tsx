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
import type { Bot, Integration, Tree } from '../types/bot'
import type { BotBilling } from '../types/billing'

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
  const [botBilling, setBotBilling] = useState<BotBilling | null>(null)

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
    api<BotBilling>(`/api/bots/${botId}/entitlement`)
      .then(d => { if (alive) setBotBilling(d) })
      .catch(() => { if (alive) setBotBilling(null) })
    return () => { alive = false }
  }, [tab, botId])

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
        <BotBillingTab billing={botBilling} botName={bot.name} />
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
const SUB_STATUS_LABELS: Record<BotBilling['subscription_status'], string> = {
  active: 'Actif',
  past_due: 'Paiement en retard',
  canceled: 'Résilié',
  none: 'Aucun abonnement',
}

// Onglet Facturation d'un bot : récap lecture seule des modules actifs, du quota
// IA et du statut d'abonnement, avec renvoi vers la page Facturation pour gérer
// l'abonnement (changement de modules, portail Stripe, factures). Owner-only et
// monté uniquement si le billing est actif (voir billingTabVisible / visibleTabs).
function BotBillingTab({ billing, botName }: { billing: BotBilling | null; botName: string }) {
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
  const modules = billing.active_modules || []

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card style={{ padding: '22px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 800 }}>Abonnement de « {botName} »</div>
            <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 3 }}>
              Statut : {SUB_STATUS_LABELS[billing.subscription_status]}
            </div>
          </div>
          <Link to="/app/billing" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Gérer la facturation
          </Link>
        </div>
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
          <Meter pct={pct} tone={overQuota ? 'danger' : pct >= 80 ? 'warn' : 'acc'} />
          {overQuota && (
            <div style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>
              Quota atteint : les nouvelles réponses IA sont bloquées jusqu'au prochain cycle.
            </div>
          )}
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
