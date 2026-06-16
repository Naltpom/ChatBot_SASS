// Éditeur de bot — refonte charte Chapote. 7 onglets :
// Apparence / Arbre / IA / Humain / Actions / Intégration / Sécurité.
// Header bot (avatar navy, nom éditable inline, pills statut+mode, domaine · pk
// mono, bouton « Activer le bot » si inactif). L'état dirty est suivi PAR ONGLET
// (comparaison à savedBot, la photo du dernier état serveur) et matérialisé par
// une SAVE BAR SOMBRE fixée en bas (left:248px right:0) avec pills des onglets
// dirty + Annuler/Enregistrer + indication Ctrl/Cmd S.
// Stats / Insights / Leads / Inbox sont désormais des pages dédiées (les
// composants StatsPanel/InsightsPanel/InboxPanel restent dans components/ et
// sont importés ailleurs — ils ne sont plus montés ici).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, Download, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import {
  Btn, BubbleIcon, Card, Chip, Divider, Field, InfoBox, Meter, SectionTitle, Seg, Toggle,
  brandBg, modeChip, statusChip,
} from '../ui'
import { ACTION_TEMPLATES, CAPTCHA_OPTIONS, MODEL_OPTIONS, findModelOption } from '../botConstants'
import AppearanceForm from '../components/AppearanceForm'
import KbPanel from '../components/KbPanel'
import TreeFlow from '../components/TreeFlow'
import WidgetPreview, { PreviewFrame } from '../components/WidgetPreview'

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
]

// Groupes de champs par onglet, alignés sur FIELD_PERMS (API) et sur le body
// de save() : ils pilotent le dirty tracking par onglet.
const TAB_FIELDS: Record<string, string[]> = {
  // triggers_json : perm serveur = appearance (FIELD_PERMS), même onglet
  appearance: ['name', 'design_json', 'mode', 'triggers_json'],
  tree: ['tree_json', 'tree_variant_json', 'ab_split_pct'],
  // daily_ai_message_cap : perm serveur = security (FIELD_PERMS) — affiché dans
  // l'onglet IA (charte) mais l'API exige la perm security ; la garde de save()
  // croise hasPerm('security').
  ai: ['system_prompt', 'ai_provider', 'ai_model', 'temperature', 'api_key_mode', 'daily_ai_message_cap'],
  // handoff_webhook_url : perm serveur = context (credential) — l'API la masque
  // à null dans bot ET savedBot pour un member sans context → jamais de faux dirty.
  human: ['handoff_webhook_url'],
  actions: ['actions_json', 'mcp_servers_json'],
  security: ['allowed_domains', 'captcha_provider', 'captcha_site_key', 'is_active'],
}

const ACTION_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/
// Nom de serveur MCP : règle serveur _check_mcp_servers (31 caractères max)
const MCP_NAME_RE = /^[a-z][a-z0-9_]{0,30}$/

// Chip d'en-tête par type d'action
const ACTION_TYPE_CHIPS: Record<string, { tone: 'info' | 'go' | 'acc'; label: string }> = {
  webhook: { tone: 'info', label: 'Webhook' },
  capture_lead: { tone: 'go', label: 'Capture de lead' },
  handoff: { tone: 'acc', label: 'Conseiller humain' },
  create_ticket: { tone: 'go', label: 'Ticket par email' },
  calendar_slots: { tone: 'info', label: 'Créneaux Cal.com' },
}

interface Integration { id: string; label: string; icon: string; description: string; snippet: string }

// Responsive : le shell passe la sidebar en drawer sous 860px (contrat burger).
// La save bar sombre est fixée et alignée sur la sidebar (left:248px) — en mobile
// la sidebar n'occupe plus la colonne de gauche, la barre doit donc passer à
// left:0. styles.css est réservé à l'agent shell → on détecte le breakpoint via
// matchMedia (les media queries sont impossibles en style inline) et on bascule
// les styles concernés. Même breakpoint que le shell (860px).
const MOBILE_MQ = '(max-width: 860px)'
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_MQ)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    // addEventListener('change') sur MediaQueryList (large support) ; pas de
    // dépendance nouvelle, cleanup obligatoire.
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

export default function BotPage() {
  const { id } = useParams()
  const botId = Number(id)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const isMobile = useIsMobile()

  const [bot, setBot] = useState<any>(null)
  const [savedBot, setSavedBot] = useState<any>(null)   // photo du dernier état serveur
  const [tab, setTab] = useState(params.get('tab') || 'appearance')
  const [byokKey, setByokKey] = useState('')
  const [captchaSecret, setCaptchaSecret] = useState('')
  const [actionSecrets, setActionSecrets] = useState<Record<number, string>>({})
  const [mcpTokens, setMcpTokens] = useState<Record<number, string>>({})    // jetons Bearer MCP, par INDEX (pattern actionSecrets)
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
  const [previewDegraded, setPreviewDegraded] = useState(false)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [integType, setIntegType] = useState('html')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')           // erreurs de SAUVEGARDE uniquement (save bar)
  const [pageError, setPageError] = useState('')   // erreurs hors save (import, delete) — dismissable
  const [loadError, setLoadError] = useState('')   // échec du chargement initial (403/404, réseau)
  const [loadTry, setLoadTry] = useState(0)

  const fromAdmin = params.get('from') === 'admin'
  const isAdminView = !!user?.is_superadmin && fromAdmin

  useEffect(() => {
    setLoadError('')
    api(`/api/bots/${botId}`).then((b: any) => {
      setBot(b)
      setSavedBot(b)
    }).catch((err: any) => setLoadError(err.message))
    api(`/api/bots/${botId}/embed`).then(d => setIntegrations(d.integrations)).catch(() => {})
  }, [botId, loadTry])

  // Permissions par bot : admins d'org et superadmins ont tout, les members
  // voient uniquement les onglets couverts par leurs permissions. Un bot PERSO
  // (owner_user_id, pas d'organization_id) donne tous les droits à son
  // propriétaire — pas de notion d'org/de membership.
  const botOrg = user?.organizations.find(o => o.id === bot?.organization_id)
  const orgName = botOrg?.name || ''
  const isPersonalScope = !!bot && (bot.scope === 'personal' || (bot.owner_user_id != null && bot.organization_id == null))
  const isOrgAdmin = !!user?.is_superadmin || isPersonalScope || botOrg?.role === 'admin'
  const hasPerm = (perm: string | null) =>
    perm === null || isOrgAdmin || (botOrg?.permissions?.[String(botId)] || []).includes(perm)
  // Mode arbre pur : les onglets IA et Actions n'ont pas lieu d'être
  const aiTabRelevant = !!bot && bot.mode !== 'tree'
  const visibleTabs = TABS.filter(t => hasPerm(t.perm) && ((t.id !== 'ai' && t.id !== 'actions') || aiTabRelevant))
  const activeTab = visibleTabs.some(t => t.id === tab) ? tab : (visibleTabs[0]?.id || 'appearance')

  // Garde A/B : si la variante disparaît (Annuler, désactivation, reload), on
  // ne reste jamais sur la vue B — un seul TreeFlow monté, jamais avec
  // tree=null (couvre cancelChanges ET la désactivation).
  useEffect(() => {
    if (bot && !bot.tree_variant_json && treeView === 'b') setTreeView('a')
  }, [bot, treeView])

  // ---------- Dirty tracking par onglet ----------
  const dirtyTabs = useMemo(() => {
    if (!bot || !savedBot) return [] as string[]
    const pick = (obj: any, fields: string[]) => JSON.stringify(fields.map(f => obj?.[f]))
    const extras: Record<string, boolean> = {
      ai: byokKey !== '',
      actions: Object.keys(actionSecrets).length > 0 || Object.keys(mcpTokens).length > 0,
      security: captchaSecret !== '',
    }
    return Object.keys(TAB_FIELDS).filter(t =>
      extras[t] || pick(bot, TAB_FIELDS[t]) !== pick(savedBot, TAB_FIELDS[t]))
  }, [bot, savedBot, byokKey, captchaSecret, actionSecrets, mcpTokens])
  const dirty = dirtyTabs.length > 0

  // Ctrl+S / Cmd+S -> save() si dirty (refs : pas de listener périmé)
  const saveRef = useRef<{ dirty: boolean; save: () => void }>({ dirty: false, save: () => {} })
  saveRef.current = { dirty, save: () => save() }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (saveRef.current.dirty) saveRef.current.save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function patch(fields: Record<string, any>) {
    setBot((b: any) => ({ ...b, ...fields }))
  }
  function patchDesign(fields: Record<string, any>) {
    setBot((b: any) => ({ ...b, design_json: { ...b.design_json, ...fields } }))
  }

  function switchTab(t: string) {
    setTab(t)
    params.set('tab', t)
    setParams(params, { replace: true })
  }

  function serializeActions() {
    // Secret tapé : envoyé pour (re)poser (api_key sur calendar_slots, secret
    // HMAC sinon — 1 secret max par action), omis pour conserver. Les flags
    // secret_set/api_key_set (posés par BotOut sur TOUTES les actions) ne
    // repartent jamais au PATCH.
    return ((bot?.actions_json || []) as any[]).map((a, i) => {
      const { secret_set, api_key_set, ...rest } = a
      // create_ticket : to_email vide = « envoi aux admins » → clé OMISE. Le
      // serveur valide AVANT sa normalisation `or None` et rejette '' en 422 ;
      // seuls null/clé absente passent. Couvre le template, le changement de
      // type et le champ vidé à la main.
      if (rest.type === 'create_ticket' && !(typeof rest.to_email === 'string' && rest.to_email.trim())) {
        delete rest.to_email
      }
      // calendar_slots : timezone vidée → clé omise, le serveur retombe sur
      // Europe/Paris — cohérent avec le fallback d'affichage de l'input.
      if (rest.type === 'calendar_slots' && !(typeof rest.timezone === 'string' && rest.timezone.trim())) {
        delete rest.timezone
      }
      if (!actionSecrets[i]) return rest
      return rest.type === 'calendar_slots'
        ? { ...rest, api_key: actionSecrets[i] }
        : { ...rest, secret: actionSecrets[i] }
    })
  }

  function serializeMcpServers() {
    // Jeton Bearer : même mécanique write-only (envoyé = posé, omis = conservé
    // par nom à URL inchangée côté serveur) ; auth_token_set jamais renvoyé.
    return ((bot?.mcp_servers_json || []) as any[]).map((s, i) => {
      const { auth_token_set, ...rest } = s
      return mcpTokens[i] ? { ...rest, auth_token: mcpTokens[i] } : rest
    })
  }

  async function save() {
    setError('')
    // Body limité aux groupes des onglets DIRTY (TAB_FIELDS), croisés avec les
    // permissions (FIELD_PERMS côté API vérifie chaque champ présent). Le PATCH
    // est partiel (exclude_unset serveur) : un changement de design seul
    // n'envoie ni mode/tree_json ni api_key_mode inchangés — les contraintes de
    // plan d'un bot hors plan (downgrade webhook, BYOK posé par un superadmin)
    // ne re-tournent donc pas à chaque save.
    const body: Record<string, any> = {}
    const dirtySet = new Set(dirtyTabs)
    if (hasPerm('appearance') && dirtySet.has('appearance')) {
      body.name = bot.name
      body.design_json = bot.design_json
      body.triggers_json = bot.triggers_json || []
      if (bot.mode !== savedBot?.mode) body.mode = bot.mode
    }
    if (hasPerm('context')) {
      if (dirtySet.has('tree')) {
        body.tree_json = bot.tree_json
        // null EXPLICITE = désactivation de la variante A/B — seul champ où le
        // PATCH serveur ne l'ignore pas (vérifié bots.py). Les 422 (validate_tree
        // sur la variante) et 403 plan sont affichés tels quels par la save bar.
        body.tree_variant_json = bot.tree_variant_json ?? null
        body.ab_split_pct = bot.ab_split_pct
      }
      if (dirtySet.has('ai')) {
        body.system_prompt = bot.system_prompt
        body.ai_provider = bot.ai_provider
        body.ai_model = bot.ai_model
        body.temperature = bot.temperature
        if (bot.api_key_mode !== savedBot?.api_key_mode) body.api_key_mode = bot.api_key_mode
        if (byokKey) body.byok_key = byokKey
      }
      if (dirtySet.has('actions')) {
        body.actions_json = serializeActions()
        body.mcp_servers_json = serializeMcpServers()
      }
      // handoff_webhook_url : perm serveur = context (credential), onglet Humain.
      if (dirtySet.has('human') && bot.handoff_webhook_url !== savedBot?.handoff_webhook_url) {
        body.handoff_webhook_url = bot.handoff_webhook_url || null
      }
    }
    // daily_ai_message_cap : champ affiché dans l'onglet IA mais perm serveur =
    // security (FIELD_PERMS) — n'est envoyé qu'avec la perm security.
    if (hasPerm('security') && dirtySet.has('ai')
        && bot.daily_ai_message_cap !== savedBot?.daily_ai_message_cap) {
      body.daily_ai_message_cap = bot.daily_ai_message_cap
    }
    if (hasPerm('security') && dirtySet.has('security')) {
      body.allowed_domains = bot.allowed_domains
      body.captcha_provider = bot.captcha_provider
      body.captcha_site_key = bot.captcha_site_key || null
      body.is_active = bot.is_active
      if (captchaSecret) body.captcha_secret = captchaSecret
    }
    try {
      const updated = await api(`/api/bots/${botId}`, { method: 'PATCH', body })
      setBot(updated)
      setSavedBot(updated)
      setByokKey('')
      setCaptchaSecret('')
      setActionSecrets({})
      setMcpTokens({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      setError(err.message)
    }
  }

  function cancelChanges() {
    setBot(JSON.parse(JSON.stringify(savedBot)))
    setByokKey('')
    setCaptchaSecret('')
    setActionSecrets({})
    setMcpTokens({})
    setError('')
  }

  // Activer le bot depuis le header / la zone de danger. is_active est en
  // TAB_FIELDS.security : un PATCH direct (immédiat, hors save bar) est plus
  // sain ici — mais pour respecter le pattern savedBot, on passe par patch()
  // qui rend l'onglet Sécurité dirty (la save bar apparaît, l'utilisateur
  // confirme). Le header n'apparaît que pour un bot inactif et n'est rendu que
  // si l'utilisateur peut sauver la sécurité.
  function activateBot() {
    patch({ is_active: true })
  }

  function exportConfig() {
    api(`/api/bots/${botId}/config.json`).then(config => {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `bot-${bot.name.toLowerCase().replace(/\s+/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    })
  }

  function importConfig(file: File) {
    file.text().then(text => api(`/api/bots/${botId}/config.json`, { method: 'PUT', body: JSON.parse(text) }))
      .then(updated => {
        setBot(updated)
        setSavedBot(updated)
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      })
      .catch(err => setPageError(`Import échoué : ${err.message}`))
  }

  // Génération d'arbre par l'IA (plans payants, treegen_limiter 10/24h/org) :
  // POST /tree/generate renvoie un tree_json NON sauvegardé → on le pose dans
  // l'arbre A local (la save bar apparaît, l'utilisateur prévisualise puis
  // enregistre). Réservée à la vue A : la variante B n'a pas de génération.
  async function generateTree() {
    setGenError('')
    setGenBusy(true)
    try {
      const body = genMode === 'url' ? { url: genUrl.trim() } : { source_text: genText }
      const res = await api(`/api/bots/${botId}/tree/generate`, { method: 'POST', body })
      const nodeCount = Object.keys(bot.tree_json?.nodes || {}).length
      if (nodeCount > 2 && !window.confirm("Remplacer l'arbre actuel par l'arbre généré ?")) return
      patch({ tree_json: res.tree_json })
      setGenText('')
      setGenUrl('')
      setGenOpen(false)
    } catch (err: any) {
      setGenError(err.status === 429
        ? "Limite quotidienne atteinte : 10 générations d'arbre par jour et par organisation. Réessayez demain."
        : err.message)
    } finally {
      setGenBusy(false)
    }
  }

  // Déplacement d'un bot PERSO vers une équipe (sens unique). Immédiat (hors
  // save bar) : POST /api/bots/{id}/move puis on remplace bot + savedBot par le
  // BotOut renvoyé (scope devient team).
  async function moveToTeam() {
    if (moveTarget === '' ) return
    const org = (user?.organizations || []).find(o => o.id === moveTarget)
    if (!org) return
    if (!window.confirm(`Déplacer « ${bot.name} » vers l'équipe « ${org.name} » ? Ce transfert est définitif (un bot d'équipe ne peut pas redevenir perso).`)) return
    setMoveBusy(true)
    setPageError('')
    try {
      const updated = await api(`/api/bots/${botId}/move`, { method: 'POST', body: { organization_id: moveTarget } })
      setBot(updated)
      setSavedBot(updated)
      setMoveTarget('')
    } catch (err: any) {
      setPageError(`Déplacement échoué : ${err.message}`)
    } finally {
      setMoveBusy(false)
    }
  }

  async function deleteBot() {
    if (!window.confirm(`Supprimer définitivement « ${bot.name} » ?\n\nLe widget cessera de fonctionner sur tous les sites où il est installé, et les conversations seront perdues.`)) return
    try {
      await api(`/api/bots/${botId}`, { method: 'DELETE' })
      navigate(isAdminView ? `/admin/clients/${bot.organization_id}` : '/app')
    } catch (err: any) {
      setPageError(err.message)
    }
  }

  function addDomain() {
    const dd = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (dd && !bot.allowed_domains.includes(dd)) patch({ allowed_domains: [...bot.allowed_domains, dd] })
    setNewDomain('')
  }

  // ---------- Actions IA ----------
  function updateAction(i: number, fields: Record<string, any>) {
    patch({ actions_json: (bot.actions_json || []).map((a: any, j: number) => (j === i ? { ...a, ...fields } : a)) })
  }
  function addAction() {
    const list = bot.actions_json || []
    if (list.length >= 5) return
    patch({ actions_json: [...list, { name: '', description: '', type: 'webhook', url: '', fields: [], secret_set: false }] })
  }
  function removeAction(i: number) {
    patch({ actions_json: (bot.actions_json || []).filter((_: any, j: number) => j !== i) })
    setActionSecrets(prev => {
      const next: Record<number, string> = {}
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k)
        if (idx < i) next[idx] = v
        else if (idx > i) next[idx - 1] = v
      })
      return next
    })
  }
  function updateActionField(ai: number, fi: number, fields: Record<string, any>) {
    const a = (bot.actions_json || [])[ai]
    updateAction(ai, { fields: (a.fields || []).map((f: any, j: number) => (j === fi ? { ...f, ...fields } : f)) })
  }
  // Changement de type = reconstruction propre : nom/description conservés,
  // défauts du type posés, flags *_set remis à plat et secret tapé jeté (un
  // secret HMAC ne doit jamais partir comme api_key Cal.com, ni l'inverse).
  function updateActionType(i: number, v: string) {
    const a = (bot.actions_json || [])[i] || {}
    if (a.type === v) return
    const next: Record<string, any> = {
      name: a.name || '', description: a.description || '', type: v,
      secret_set: false, api_key_set: false,
    }
    if (v === 'webhook') { next.url = ''; next.fields = [] }
    // create_ticket : PAS de to_email seedé — clé absente = envoi aux admins
    // (le serveur rejette la chaîne vide ; serializeActions l'omet de toute façon)
    else if (v === 'calendar_slots') { next.event_type_id = ''; next.timezone = 'Europe/Paris' }
    patch({ actions_json: (bot.actions_json || []).map((x: any, j: number) => (j === i ? next : x)) })
    setActionSecrets(prev => {
      const rest = { ...prev }
      delete rest[i]
      return rest
    })
  }

  // ---------- Serveurs MCP ----------
  function updateMcpServer(i: number, fields: Record<string, any>) {
    patch({ mcp_servers_json: (bot.mcp_servers_json || []).map((s: any, j: number) => (j === i ? { ...s, ...fields } : s)) })
  }
  function addMcpServer() {
    const list = bot.mcp_servers_json || []
    if (list.length >= 2) return
    patch({ mcp_servers_json: [...list, { name: '', url: '', auth_token_set: false }] })
  }
  function removeMcpServer(i: number) {
    patch({ mcp_servers_json: (bot.mcp_servers_json || []).filter((_: any, j: number) => j !== i) })
    // Ré-indexation des jetons tapés (même mécanique que removeAction)
    setMcpTokens(prev => {
      const next: Record<number, string> = {}
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k)
        if (idx < i) next[idx] = v
        else if (idx > i) next[idx - 1] = v
      })
      return next
    })
  }

  // ---------- Déclencheurs proactifs ----------
  function updateTrigger(i: number, fields: Record<string, any>) {
    patch({ triggers_json: (bot.triggers_json || []).map((t: any, j: number) => (j === i ? { ...t, ...fields } : t)) })
  }
  // Changement de type = reconstruction (message/once conservés, value remise
  // au défaut du type) ; exit_intent = SANS clé value (le serveur l'ignore mais
  // on reste aligné sur ce qu'il stocke).
  function updateTriggerType(i: number, v: string) {
    const tr = (bot.triggers_json || [])[i] || {}
    if (tr.type === v) return
    const next: Record<string, any> = { type: v, message: tr.message || '', once_per_session: tr.once_per_session ?? true }
    if (v === 'time_on_page') next.value = 30
    else if (v === 'scroll_depth') next.value = 50
    else if (v === 'url_pattern') next.value = ''
    patch({ triggers_json: (bot.triggers_json || []).map((t: any, j: number) => (j === i ? next : t)) })
  }
  function addTrigger() {
    const list = bot.triggers_json || []
    if (list.length >= 5) return
    patch({ triggers_json: [...list, { type: 'time_on_page', value: 30, message: '', once_per_session: true }] })
  }
  function removeTrigger(i: number) {
    patch({ triggers_json: (bot.triggers_json || []).filter((_: any, j: number) => j !== i) })
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
                <Btn kind="soft" onClick={() => setLoadTry(n => n + 1)}>Réessayer</Btn>
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
  const capPct = Math.min(100, Math.round((bot.daily_ai_message_cap / 2000) * 100))
  const actions: any[] = bot.actions_json || []
  const mcpServers: any[] = bot.mcp_servers_json || []
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
        <div className="col g18">
          <SectionTitle sub="Personnalisez le widget aux couleurs du site client. Aperçu en direct à droite.">
            Apparence du widget
          </SectionTitle>
          {/* Apparence : contrôles + aperçu live. En mobile on force 1 colonne
              (aperçu sous les contrôles, 100% de large) sans dépendre de la media
              query de styles.css (réservée à l'agent shell). En desktop : grille
              .grid-controls native (330px + 1fr). */}
          <div className="grid-controls" style={isMobile ? { gridTemplateColumns: '1fr' } : undefined}>
            <div className="col g14">
              <Card>
                <AppearanceForm design={d} botName={bot.name}
                                onChange={patchDesign} onNameChange={v => patch({ name: v })} />
              </Card>
              <Card>
                <div className="card-title">Comportement</div>
                <div className="col" style={{ gap: 12 }}>
                  <Field label="Mode" hint="Hybride : arbre guidé d'abord, IA à la demande. Les réponses arbre sont gratuites.">
                    <Seg value={bot.mode} onChange={v => patch({ mode: v })}
                         options={[{ value: 'tree', label: 'Arbre' }, { value: 'hybrid', label: 'Hybride' }, { value: 'ai', label: 'IA' }]} />
                  </Field>
                  <div className="toggle-row">
                    <div>
                      <div className="tl">Simuler le mode dégradé</div>
                      <div className="ts">Cap budget atteint → arbre seul (aperçu uniquement)</div>
                    </div>
                    <Toggle on={previewDegraded} onChange={setPreviewDegraded} />
                  </div>
                </div>
              </Card>

              <Card>
                <div className="card-title">Déclencheurs proactifs</div>
                <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 4 }}>
                  Ouvre le panneau avec un message local (aucun appel serveur), au plus un déclenchement
                  par chargement de page, jamais en mode iframe. 5 déclencheurs max.
                </div>
                <div className="field-hint" style={{ marginBottom: 10 }}>
                  Les déclencheurs ne sont pas simulés dans l'aperçu ci-contre.
                </div>
                <div className="col" style={{ gap: 10 }}>
                  {((bot.triggers_json || []) as any[]).map((tr: any, i: number) => (
                    <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 11, padding: '11px 13px' }}>
                      <div className="col" style={{ gap: 10 }}>
                        <Field label="Type">
                          <select value={tr.type} onChange={e => updateTriggerType(i, e.target.value)}>
                            <option value="time_on_page">Temps passé sur la page</option>
                            <option value="scroll_depth">Profondeur de défilement</option>
                            <option value="exit_intent">Intention de sortie</option>
                            <option value="url_pattern">Adresse de la page</option>
                          </select>
                        </Field>
                        {/* value : Number strict côté serveur (_check_triggers) — un
                            string numérique ferait 422. Input vide = '' conservé +
                            hint rouge, le 422 verbatim de la save bar reste le filet. */}
                        {tr.type === 'time_on_page' && (
                          <Field label="Après (secondes)"
                                 hint={typeof tr.value !== 'number'
                                   ? <span style={{ color: 'var(--danger)' }}>Valeur requise (1-600)</span>
                                   : undefined}>
                            <input type="number" min={1} max={600}
                                   value={typeof tr.value === 'number' ? tr.value : ''}
                                   onChange={e => updateTrigger(i, { value: e.target.value === '' ? '' : Number(e.target.value) })} />
                          </Field>
                        )}
                        {tr.type === 'scroll_depth' && (
                          <Field label="À partir de (% de page)"
                                 hint={typeof tr.value !== 'number'
                                   ? <span style={{ color: 'var(--danger)' }}>Valeur requise (1-100)</span>
                                   : undefined}>
                            <input type="number" min={1} max={100}
                                   value={typeof tr.value === 'number' ? tr.value : ''}
                                   onChange={e => updateTrigger(i, { value: e.target.value === '' ? '' : Number(e.target.value) })} />
                          </Field>
                        )}
                        {tr.type === 'url_pattern' && (
                          <Field label="Le chemin de la page contient">
                            <input type="text" className="mono" maxLength={200} placeholder="/tarifs"
                                   value={tr.value || ''}
                                   onChange={e => updateTrigger(i, { value: e.target.value })} />
                          </Field>
                        )}
                        {tr.type === 'exit_intent' && (
                          <div className="field-hint">
                            Souris quittant la page par le haut. Désactivé sur mobile.
                          </div>
                        )}
                        <Field label="Message"
                               hint={!tr.message
                                 ? <span style={{ color: 'var(--danger)' }}>Message requis (1 à 300 caractères)</span>
                                 : undefined}>
                          <textarea rows={2} maxLength={300} value={tr.message || ''}
                                    onChange={e => updateTrigger(i, { message: e.target.value })} />
                        </Field>
                        {/* once_per_session peut être ABSENT du JSON stocké → défaut true */}
                        <div className="toggle-row">
                          <div className="tl">Une seule fois par session</div>
                          <Toggle on={tr.once_per_session ?? true}
                                  onChange={v => updateTrigger(i, { once_per_session: v })} />
                        </div>
                        <div>
                          <Btn kind="danger" small onClick={() => removeTrigger(i)}>Retirer</Btn>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="row g10" style={{ marginTop: 10 }}>
                  <Btn kind="soft" small onClick={addTrigger} disabled={(bot.triggers_json || []).length >= 5}>
                    <Plus size={13} /> Ajouter un déclencheur
                  </Btn>
                  {(bot.triggers_json || []).length >= 5 && <Chip tone="warn">5/5</Chip>}
                </div>
              </Card>
            </div>
            <Card nopad>
              <PreviewFrame site={site} siteName={orgName || site} brandColor={d.primaryColor || '#1C3F5C'}>
                <WidgetPreview design={d} mode={bot.mode} tree={bot.tree_json}
                               botName={bot.name} degraded={previewDegraded} />
              </PreviewFrame>
            </Card>
          </div>
        </div>
      )}

      {/* ================= ARBRE ================= */}
      {activeTab === 'tree' && (
        <div className="col g14">
          {bot.tree_variant_json == null ? (
            <Card>
              <div className="card-title">Test A/B de l'arbre</div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 10 }}>
                Servez une variante B à une partie des nouvelles conversations et comparez conversations
                et satisfaction dans vos statistiques. L'affectation est tirée au sort à l'ouverture et
                reste stable pour toute la conversation.
              </div>
              <Btn kind="soft" onClick={() => {
                patch({ tree_variant_json: JSON.parse(JSON.stringify(bot.tree_json)), ab_split_pct: bot.ab_split_pct || 50 })
                setTreeView('b')
              }}>Activer une variante B</Btn>
            </Card>
          ) : (
            <Card>
              <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>Test A/B de l'arbre</div>
                <Chip tone="acc">A/B actif</Chip>
              </div>
              <div className="col" style={{ gap: 12 }}>
                <Seg value={treeView} onChange={v => setTreeView(v as 'a' | 'b')}
                     options={[{ value: 'a', label: 'Variante A (originale)' }, { value: 'b', label: 'Variante B' }]} />
                <Field label={`Répartition — ${bot.ab_split_pct ?? 0} % des nouvelles conversations voient la variante B`}
                       hint="0 % = variante en pause (aucun nouveau visiteur ne la voit). Les conversations déjà affectées gardent leur arbre.">
                  <input type="range" min={0} max={100} value={bot.ab_split_pct ?? 0}
                         onChange={e => patch({ ab_split_pct: Number(e.target.value) })} />
                </Field>
                <div>
                  <Btn kind="danger" small onClick={() => {
                    if (!window.confirm('Désactiver la variante B ? Son contenu sera perdu à l\'enregistrement.')) return
                    patch({ tree_variant_json: null, ab_split_pct: 0 })
                    setTreeView('a')
                  }}>Désactiver la variante B</Btn>
                </div>
              </div>
            </Card>
          )}

          {/* Barre d'outils config-as-code + génération IA (arbre A uniquement).
              TreeFlow ne porte plus l'export/import ni la génération : on les
              garde ici en boutons discrets. La variante B n'a ni export/import
              (config.json l'exclut) ni génération IA (elle remplacerait la
              variante : coût + confusion). */}
          {treeView === 'a' && (
            <div className="col g14">
              <div className="row g8" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Btn kind="ghost" small onClick={() => setGenOpen(o => !o)}>
                  <Sparkles size={13} /> Générer avec l'IA
                </Btn>
                <Btn kind="ghost" small onClick={exportConfig}>
                  <Download size={13} /> Exporter JSON
                </Btn>
                {hasPerm('context') && hasPerm('appearance') && (
                  <>
                    <Btn kind="ghost" small onClick={() => treeFileRef.current?.click()}>
                      <Upload size={13} /> Importer
                    </Btn>
                    <input ref={treeFileRef} type="file" accept=".json" hidden
                           onChange={e => { if (e.target.files?.[0]) importConfig(e.target.files[0]); e.target.value = '' }} />
                  </>
                )}
              </div>

              {genOpen && (
                <Card>
                  <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Sparkles size={14} style={{ color: 'var(--acc)' }} /> Générer l'arbre avec l'IA
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 10, lineHeight: 1.5 }}>
                    Collez votre FAQ / documentation, ou indiquez l'URL d'une page d'aide : l'IA construit un
                    arbre de décision complet que vous pourrez retoucher avant d'enregistrer.
                  </div>
                  <div className="col g10">
                    <Seg small value={genMode} onChange={v => setGenMode(v as 'text' | 'url')}
                         options={[{ value: 'text', label: 'Texte collé' }, { value: 'url', label: "URL d'une page" }]} />
                    {genMode === 'text' ? (
                      <textarea rows={5} value={genText} onChange={e => setGenText(e.target.value)}
                                placeholder={'Q : Quels sont vos horaires ?\nR : Du lundi au vendredi, 9h-18h…\n\nQ : Comment prendre rendez-vous ?\nR : …'} />
                    ) : (
                      <input type="text" className="mono" value={genUrl} onChange={e => setGenUrl(e.target.value)}
                             placeholder="https://votre-site.fr/faq" />
                    )}
                    {genError && <div className="error">{genError}</div>}
                    <div>
                      <Btn kind="soft" onClick={generateTree}
                           disabled={genBusy || (genMode === 'text' ? genText.trim().length < 50 : !genUrl.trim())}>
                        {genBusy ? 'Génération en cours…' : "Générer l'arbre"}
                      </Btn>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* UN SEUL TreeFlow monté à la fois (la variante absente ne reste
              jamais affichée — garde useEffect treeView). key force le remount
              au switch A/B. */}
          {treeView === 'b' && bot.tree_variant_json ? (
            <TreeFlow key="b" tree={bot.tree_variant_json}
                      onChange={t => patch({ tree_variant_json: t })}
                      allowAI={aiTabRelevant} />
          ) : (
            <TreeFlow key="a" tree={bot.tree_json}
                      onChange={t => patch({ tree_json: t })}
                      allowAI={aiTabRelevant} />
          )}
        </div>
      )}

      {/* ================= IA ================= */}
      {activeTab === 'ai' && (
        <div className="col g18">
          <SectionTitle sub="Modèle, clés API et instructions utilisées par l'IA pour répondre.">
            IA
          </SectionTitle>
          <div className="grid2">
            <Card>
              <div className="card-title">Modèle IA</div>
              <div className="col" style={{ gap: 8 }}>
                {MODEL_OPTIONS.map(m => {
                  const selected = currentModel?.model === m.model
                  return (
                    <button key={m.model} className={`radio-card ${selected ? 'selected' : ''}`}
                            onClick={() => patch({ ai_provider: m.provider, ai_model: m.model })}>
                      <span className="radio-dot" />
                      <span style={{ flex: 1 }}>
                        <span className="rc-name">{m.name}</span>
                        <span className="rc-desc">{m.desc}</span>
                      </span>
                      <Chip tone={m.recommended ? 'acc' : 'mut'}>{m.price}</Chip>
                    </button>
                  )
                })}
              </div>

              <Divider />
              <div className="card-title" style={{ marginBottom: 8 }}>Clé API</div>
              <div>
                <Seg value={bot.api_key_mode}
                     onChange={v => patch({ api_key_mode: v })}
                     options={[{ value: 'managed', label: 'Clé Chapote (managée)' }, { value: 'byok', label: 'Ma propre clé (BYOK)' }]} />
              </div>
              <div style={{ marginTop: 10 }}>
                {bot.api_key_mode === 'managed' ? (
                  <InfoBox tone="go" title="Clé managée">
                    L'IA utilise la clé Chapote managée. Aucune clé à gérer, les plafonds
                    protègent votre budget.
                  </InfoBox>
                ) : (
                  <div className="col g8">
                    <input type="password" className="mono"
                           placeholder={bot.byok_key_set ? '•••• (laisser vide pour conserver)' : 'sk-ant-api03-…'}
                           value={byokKey} onChange={e => setByokKey(e.target.value)} />
                    <InfoBox tone="info" title="BYOK — votre clé, chiffrée côté serveur">
                      Votre clé est stockée chiffrée et utilisée uniquement côté serveur. Elle n'est jamais
                      exposée dans le widget. Vous payez les tokens directement au fournisseur.
                    </InfoBox>
                  </div>
                )}
              </div>
            </Card>

            <div className="col g14">
              <Card>
                <div className="card-title" style={{ marginBottom: 8 }}>Instructions (prompt système)</div>
                <textarea rows={5} value={bot.system_prompt} onChange={e => patch({ system_prompt: e.target.value })} />
                <div style={{ marginTop: 8 }}>
                  <InfoBox tone="warn" title="Verrouillé côté serveur">
                    Le visiteur final ne peut jamais modifier ces instructions, le modèle ou la température — le
                    widget n'y a pas accès (protection prompt-injection).
                  </InfoBox>
                </div>
              </Card>
              <Card>
                <div className="card-title" style={{ marginBottom: 8 }}>Température : {(bot.temperature / 100).toFixed(2)}</div>
                <input type="range" min={0} max={100} value={bot.temperature}
                       onChange={e => patch({ temperature: Number(e.target.value) })} />
                <div className="field-hint">Basse = réponses factuelles et stables · haute = réponses plus créatives.</div>
              </Card>

              {/* Plafond IA journalier : champ backend RÉEL daily_ai_message_cap
                  (perm serveur security). Affiché dans l'onglet IA (charte). */}
              {hasPerm('security') && (
                <Card>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>Plafond IA journalier</div>
                    <Chip tone="acc">{bot.daily_ai_message_cap} rép. / jour</Chip>
                  </div>
                  <input type="range" min={0} max={2000} step={10} value={bot.daily_ai_message_cap}
                         onChange={e => patch({ daily_ai_message_cap: Number(e.target.value) })} />
                  <div style={{ margin: '6px 0' }}><Meter pct={capPct} height={6} /></div>
                  <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55 }}>
                    S'il est atteint, le widget passe en mode dégradé (arbre seul). C'est votre protection
                    cash-flow.
                  </div>
                </Card>
              )}
            </div>
          </div>

          {/* Base de connaissances (RAG) — KbPanel vit HORS save bar */}
          <Divider />
          <KbPanel botId={botId} aiActive={aiTabRelevant} />
        </div>
      )}

      {/* ================= HUMAIN (relais / handoff) ================= */}
      {activeTab === 'human' && (
        <div className="col g18">
          <SectionTitle sub="Bascule la conversation vers un conseiller en dernier recours. Le visiteur passe en file d'attente et vos équipes sont notifiées.">
            Relais humain
          </SectionTitle>

          {hasPerm('context') ? (
            <Card style={{ maxWidth: 720 }}>
              <div className="card-title">Notification de relais</div>
              <Field label="Webhook de notification (Slack)"
                     hint={bot.handoff_webhook_url && !/^https:\/\//.test(bot.handoff_webhook_url)
                       ? <span style={{ color: 'var(--danger)' }}>L'adresse doit commencer par https://</span>
                       : undefined}>
                <input type="text" className="mono" placeholder="https://hooks.slack.com/services/…"
                       value={bot.handoff_webhook_url || ''}
                       onChange={e => patch({ handoff_webhook_url: e.target.value })} />
              </Field>
              <div className="field-hint" style={{ marginTop: 8 }}>
                Appelé à chaque demande de conseiller (payload {'{"text": …}'} compatible Slack —
                fonctionne aussi avec Mattermost ou un connecteur Teams). Les admins de l'organisation
                reçoivent aussi un email ; sans SMTP configuré côté serveur, cette notification email
                est uniquement journalisée.
              </div>
              <div style={{ marginTop: 12 }}>
                <InfoBox tone="info" title="Cette URL est un secret">
                  Un webhook Slack contient un jeton dans son chemin : il n'apparaît jamais dans les
                  exports config.json et n'est visible qu'avec la permission Contexte.
                </InfoBox>
              </div>
            </Card>
          ) : (
            <Card style={{ maxWidth: 720 }}>
              <InfoBox tone="warn" title="Permission requise">
                La configuration du relais humain nécessite la permission Contexte sur ce bot.
              </InfoBox>
            </Card>
          )}

          <Card style={{ maxWidth: 720 }}>
            <div className="card-title">Comment activer le relais</div>
            <div className="col" style={{ gap: 10 }}>
              <InfoBox tone="info">
                Ajoutez un nœud de type <strong>« Conseiller »</strong> dans l'onglet Arbre, ou une
                action IA de type <strong>« Conseiller humain »</strong> dans l'onglet Actions : le
                visiteur est mis en relation, l'IA se met en retrait et la conversation apparaît dans
                votre boîte de réception.
              </InfoBox>
              <div className="row g10" style={{ flexWrap: 'wrap' }}>
                <Btn kind="soft" small onClick={() => switchTab('tree')}>Ouvrir l'arbre</Btn>
                {aiTabRelevant && (
                  <Btn kind="soft" small onClick={() => switchTab('actions')}>Ouvrir les actions</Btn>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ================= ACTIONS IA ================= */}
      {activeTab === 'actions' && (
        <div className="col g18">
          <SectionTitle sub="Donnez à l'IA le pouvoir d'agir pendant la conversation : appeler vos webhooks (signés) ou enregistrer un contact. 5 actions maximum.">
            Actions &amp; outils
          </SectionTitle>

          {bot.ai_provider === 'gemini' && (
            <InfoBox tone="warn" title="Non supporté par Gemini">
              Les actions, la recherche dans les connaissances et les serveurs MCP sont ignorés tant que
              le modèle Gemini est sélectionné — choisissez Claude ou GPT dans l'onglet IA.
            </InfoBox>
          )}

          <Card>
            <div className="card-title">Modèles d'actions</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
              {ACTION_TEMPLATES.map(tpl => (
                <div key={tpl.id} className="tpl-card">
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{tpl.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.5, flex: 1 }}>{tpl.blurb}</div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <Chip tone="mut">{tpl.action.type === 'create_ticket' ? 'Ticket email' : 'Webhook'}</Chip>
                    <Btn kind="soft" small disabled={actions.length >= 5}
                         onClick={() => patch({ actions_json: [...actions, JSON.parse(JSON.stringify(tpl.action))] })}>
                      Utiliser
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Pré-remplit une action — ajustez l'URL ou l'email avant d'enregistrer.
            </div>
          </Card>

          {actions.map((a: any, i: number) => {
            const nameBad = !ACTION_NAME_RE.test(a.name || '')
              || actions.filter((x: any) => x.name === a.name).length > 1
            // Le secret (HMAC ou clé Cal.com) est rattaché au NOM côté serveur
            // (_merge_action_secrets) : on compare donc la photo serveur sous le
            // nom COURANT — jamais par index, les index glissent après une
            // suppression locale non sauvegardée. Le flag *_set de l'action live
            // vient du serveur et survit aux édits : warning ssi l'action croit
            // avoir un secret qu'aucune action sauvegardée du même nom ne porte.
            const savedByName = (savedBot?.actions_json || []).find((x: any) => x.name === a.name)
            const renameWarn = ((a.type === 'webhook' && a.secret_set)
              || (a.type === 'calendar_slots' && a.api_key_set))
              && !(savedByName?.secret_set || savedByName?.api_key_set) && !actionSecrets[i]
            // event_type_id : même filet inline que nameBad/urlBad (le 422 FR de
            // la save bar reste le filet final)
            const etidBad = a.type === 'calendar_slots'
              && !(typeof a.event_type_id === 'number' && Number.isInteger(a.event_type_id) && a.event_type_id >= 1)
            return (
              <Card key={i}>
                <div className="row g10" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <input type="text" className="mono" placeholder="nom_de_l_action"
                           value={a.name || ''} onChange={e => updateAction(i, { name: e.target.value })} />
                  </div>
                  <Chip tone={(ACTION_TYPE_CHIPS[a.type] || ACTION_TYPE_CHIPS.webhook).tone}>
                    {(ACTION_TYPE_CHIPS[a.type] || ACTION_TYPE_CHIPS.webhook).label}
                  </Chip>
                  <Btn kind="danger" small onClick={() => removeAction(i)}>Retirer</Btn>
                </div>
                {nameBad && (
                  <div className="field-hint" style={{ color: 'var(--danger)', marginBottom: 8 }}>
                    minuscules, chiffres, _ — unique
                  </div>
                )}
                <div className="col" style={{ gap: 12, marginTop: 8 }}>
                  <Field label="Description (pour l'IA)"
                         hint="Expliquez quand l'IA doit déclencher cette action (1 à 500 caractères)">
                    <textarea rows={2} value={a.description || ''}
                              onChange={e => updateAction(i, { description: e.target.value })} />
                  </Field>
                  <Field label="Type">
                    <Seg small value={a.type} onChange={v => updateActionType(i, v)}
                         options={[
                           { value: 'webhook', label: 'Webhook' },
                           { value: 'capture_lead', label: 'Capture de lead' },
                           { value: 'handoff', label: 'Conseiller' },
                           { value: 'create_ticket', label: 'Ticket email' },
                           { value: 'calendar_slots', label: 'Créneaux Cal.com' },
                         ]} />
                  </Field>

                  {a.type === 'webhook' ? (
                    <>
                      <Field label="URL (https://…)"
                             hint={!/^https:\/\//.test(a.url || '')
                               ? <span style={{ color: 'var(--danger)' }}>L'URL doit commencer par https://</span>
                               : undefined}>
                        <input type="text" className="mono" placeholder="https://api.votre-site.fr/hooks/chapote"
                               value={a.url || ''} onChange={e => updateAction(i, { url: e.target.value })} />
                      </Field>
                      <Field label="Secret HMAC" hint="Signature HMAC-SHA256 dans l'en-tête X-Chapote-Signature.">
                        <input type="password" className="mono"
                               placeholder={a.secret_set ? '•••• (laisser vide pour conserver)' : 'Optionnel — signe chaque appel'}
                               value={actionSecrets[i] || ''}
                               onChange={e => setActionSecrets(prev => {
                                 const next = { ...prev }
                                 if (e.target.value) next[i] = e.target.value
                                 else delete next[i]
                                 return next
                               })} />
                        {renameWarn && (
                          <div className="field-hint" style={{ color: 'var(--warn)' }}>
                            Renommer sans ressaisir le secret le supprimera (le secret est rattaché au nom).
                          </div>
                        )}
                      </Field>
                      <div>
                        <div className="field-label">Champs transmis</div>
                        <div className="col g6">
                          {(a.fields || []).map((f: any, fi: number) => (
                            <div key={fi} className="row g8" style={{ flexWrap: 'wrap' }}>
                              <input type="text" className="mono" style={{ width: 130 }} placeholder="nom"
                                     value={f.name || ''}
                                     onChange={e => updateActionField(i, fi, { name: e.target.value })} />
                              <select value={f.type || 'string'} style={{ width: 102 }}
                                      onChange={e => updateActionField(i, fi, { type: e.target.value })}>
                                <option value="string">string</option>
                                <option value="number">number</option>
                                <option value="boolean">boolean</option>
                              </select>
                              <input type="text" style={{ flex: 1, minWidth: 140 }} placeholder="description"
                                     value={f.description || ''}
                                     onChange={e => updateActionField(i, fi, { description: e.target.value })} />
                              <span className="row g6" style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)' }}>
                                requis <Toggle on={!!f.required} onChange={v => updateActionField(i, fi, { required: v })} />
                              </span>
                              <button aria-label="Retirer le champ"
                                      onClick={() => updateAction(i, { fields: (a.fields || []).filter((_: any, j: number) => j !== fi) })}
                                      style={{ border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 14, padding: 2 }}>×</button>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <Btn kind="soft" small disabled={(a.fields || []).length >= 8}
                               onClick={() => updateAction(i, { fields: [...(a.fields || []), { name: '', type: 'string', description: '', required: false }] })}>
                            <Plus size={13} /> Ajouter un champ
                          </Btn>
                        </div>
                      </div>
                    </>
                  ) : a.type === 'handoff' ? (
                    <InfoBox tone="info">
                      L'IA transmet la conversation à un conseiller humain : le visiteur passe en file
                      d'attente, vos admins sont notifiés par email et par le webhook Slack s'il est
                      configuré (onglet Humain). Aucun champ à configurer.
                    </InfoBox>
                  ) : a.type === 'create_ticket' ? (
                    <>
                      <Field label="Email de destination (optionnel)"
                             hint="Vide : le ticket est envoyé aux admins de l'organisation. Sans SMTP configuré côté serveur, le ticket est uniquement journalisé.">
                        <input type="email" placeholder="support@votre-domaine.fr"
                               value={a.to_email || ''}
                               onChange={e => updateAction(i, { to_email: e.target.value })} />
                      </Field>
                      <InfoBox tone="info">
                        L'IA recueille sujet, résumé et coordonnées du visiteur, puis ouvre un ticket par
                        email (référence TK-XXXXXXXX, trace visible dans le transcript).
                      </InfoBox>
                    </>
                  ) : a.type === 'calendar_slots' ? (
                    <>
                      <Field label="Event type ID (Cal.com)"
                             hint={etidBad
                               ? <span style={{ color: 'var(--danger)' }}>Valeur requise (entier positif)</span>
                               : undefined}>
                        <input type="number" className="mono"
                               value={a.event_type_id ?? ''}
                               onChange={e => updateAction(i, { event_type_id: e.target.value === '' ? '' : Number(e.target.value) })} />
                      </Field>
                      <Field label="Fuseau horaire" hint="Identifiant IANA, ex. Europe/Paris.">
                        <input type="text" className="mono"
                               value={a.timezone || 'Europe/Paris'}
                               onChange={e => updateAction(i, { timezone: e.target.value })} />
                      </Field>
                      <Field label="Clé API Cal.com"
                             hint="Stockée chiffrée, jamais réaffichée. L'IA consultera les disponibilités des 7 prochains jours (40 créneaux max).">
                        <input type="password" className="mono"
                               placeholder={a.api_key_set ? '•••• (laisser vide pour conserver)' : 'cal_live_…'}
                               value={actionSecrets[i] || ''}
                               onChange={e => setActionSecrets(prev => {
                                 const next = { ...prev }
                                 if (e.target.value) next[i] = e.target.value
                                 else delete next[i]
                                 return next
                               })} />
                        {renameWarn && (
                          <div className="field-hint" style={{ color: 'var(--warn)' }}>
                            Renommer sans ressaisir le secret le supprimera (le secret est rattaché au nom).
                          </div>
                        )}
                      </Field>
                    </>
                  ) : (
                    <InfoBox tone="info">
                      L'IA recueillera email, nom, téléphone et message au fil de la discussion et les déposera
                      dans vos leads (notification email aux admins si le serveur a un SMTP).
                    </InfoBox>
                  )}
                </div>
              </Card>
            )
          })}

          <div className="row g10">
            <Btn kind="soft" onClick={addAction} disabled={actions.length >= 5}>
              <Plus size={14} /> Ajouter une action
            </Btn>
            {actions.length >= 5 && <Chip tone="warn">5/5</Chip>}
          </div>

          <Divider />
          <SectionTitle sub="Branchez l'IA sur vos services externes via le protocole MCP. 2 serveurs maximum.">
            Serveurs MCP
          </SectionTitle>

          <InfoBox tone="info" title="Qu'est-ce que MCP ?">
            MCP (Model Context Protocol) est une prise standard : votre serveur expose des outils
            (rechercher un client, consulter un stock…) et l'IA peut les appeler pendant la conversation.
            Les outils sont proposés au modèle sous le nom{' '}
            <span className="mono">{'mcp_<serveur>_<outil>'}</span>. Serveur en échec ou trop lent : ses
            outils sont simplement absents, le chat n'est jamais bloqué.
          </InfoBox>

          {mcpServers.map((s: any, i: number) => {
            const nameBad = !MCP_NAME_RE.test(s.name || '')
              || mcpServers.filter((x: any) => x.name === s.name).length > 1
            const urlBad = !/^https:\/\//.test(s.url || '')
            // Divergence voulue avec le webhook : le jeton Bearer est un
            // credential ENVOYÉ au serveur — il n'est hérité par nom qu'à URL
            // inchangée (_merge_mcp_secrets). Renommer OU changer l'URL = ressaisir.
            // Comparaison par nom+URL contre la photo serveur (jamais par index,
            // les index glissent après une suppression locale non sauvegardée).
            const tokenWarn = s.auth_token_set
              && !((savedBot?.mcp_servers_json || []).find((x: any) => x.name === s.name && x.url === s.url)?.auth_token_set)
              && !mcpTokens[i]
            return (
              <Card key={i}>
                <div className="row g10" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <input type="text" className="mono" placeholder="crm"
                           value={s.name || ''} onChange={e => updateMcpServer(i, { name: e.target.value })} />
                  </div>
                  <Btn kind="danger" small onClick={() => removeMcpServer(i)}>Retirer</Btn>
                </div>
                <div className="field-hint" style={nameBad ? { color: 'var(--danger)' } : undefined}>
                  nom court en minuscules (a-z, 0-9, _), 31 caractères max, unique
                </div>
                <div className="col" style={{ gap: 12, marginTop: 10 }}>
                  <Field label="URL du serveur"
                         hint={urlBad
                           ? <span style={{ color: 'var(--danger)' }}>L'URL du serveur doit commencer par https://</span>
                           : undefined}>
                    <input type="text" className="mono" placeholder="https://mcp.votre-site.fr/mcp"
                           value={s.url || ''} onChange={e => updateMcpServer(i, { url: e.target.value })} />
                  </Field>
                  <Field label="Jeton (Bearer, optionnel)">
                    <input type="password" className="mono"
                           placeholder={s.auth_token_set ? '•••• (laisser vide pour conserver le jeton)' : 'Jeton Bearer — optionnel'}
                           value={mcpTokens[i] || ''}
                           onChange={e => setMcpTokens(prev => {
                             const next = { ...prev }
                             if (e.target.value) next[i] = e.target.value
                             else delete next[i]
                             return next
                           })} />
                    {tokenWarn && (
                      <div className="field-hint" style={{ color: 'var(--warn)' }}>
                        Renommer le serveur ou changer son URL invalide le jeton enregistré — ressaisissez-le.
                      </div>
                    )}
                  </Field>
                </div>
              </Card>
            )
          })}

          <div className="row g10">
            <Btn kind="soft" onClick={addMcpServer} disabled={mcpServers.length >= 2}>
              <Plus size={14} /> Ajouter un serveur MCP
            </Btn>
            {mcpServers.length >= 2 && <Chip tone="warn">2/2</Chip>}
          </div>
        </div>
      )}

      {/* ================= INTÉGRATION ================= */}
      {activeTab === 'install' && (
        <div className="col g18">
          <SectionTitle sub="Une seule balise avant </body>. Le widget pèse < 30 ko et ne bloque jamais le rendu de la page.">
            Intégration
          </SectionTitle>

          {!bot.is_active && (
            <InfoBox tone="warn" title="Bot inactif">
              La balise ne répondra pas tant que le bot n'est pas activé.{' '}
              {hasPerm('security') && (
                <button onClick={activateBot}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--acc)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
                  Activer le bot
                </button>
              )}
            </InfoBox>
          )}

          {/* Intégration : extrait + timeline. Empilé en 1 colonne en mobile
              (grille inline, pas de classe globale à dépendre). */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr', gap: 14, alignItems: 'start' }}>
            <Card>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                <div className="card-title" style={{ marginBottom: 0 }}>Extrait à insérer</div>
                <Btn kind={copied ? 'soft' : 'primary'} small onClick={() => {
                  navigator.clipboard.writeText(currentInteg?.snippet || '').catch(() => {})
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                }}>{copied ? <><Check size={13} /> Copié</> : <><Clipboard size={13} /> Copier</>}</Btn>
              </div>
              <div className="snippet-pills" style={{ marginBottom: 10 }}>
                {integrations.map(it => (
                  <button key={it.id} className={integType === it.id ? 'active' : ''}
                          onClick={() => setIntegType(it.id)}>{it.label}</button>
                ))}
              </div>
              <pre className="snippet">{currentInteg?.snippet}</pre>
              {currentInteg?.description && (
                <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 8, lineHeight: 1.5 }}>{currentInteg.description}</div>
              )}
              <div style={{ marginTop: 10 }}>
                <InfoBox tone="info" title="pk_… est un identifiant public, pas un secret">
                  Elle permet uniquement d'initialiser une session de chat sur vos domaines autorisés. Vos clés
                  IA restent côté serveur — même modèle que les clés publiques Stripe.
                </InfoBox>
              </div>
              <div style={{ marginTop: 10 }}>
                <InfoBox tone="info" title="Site sous Content-Security-Policy">
                  Pour l'overlay de prise de rendez-vous (mode script), autorisez :{' '}
                  <span className="mono" style={{ fontSize: 10.5 }}>
                    frame-src https://calendly.com https://*.calendly.com https://cal.com https://*.cal.com
                  </span>
                  . Le mode iframe (/widget-frame) n'est pas concerné.
                </InfoBox>
              </div>
            </Card>

            <Card>
              <div className="card-title" style={{ marginBottom: 12 }}>Ce qui se passe au chargement</div>
              <div className="col">
                {[
                  ['1', 'Chargement du widget', 'async, < 30 ko'],
                  ['2', 'Handshake POST /session', 'clé publique + jeton Turnstile invisible'],
                  ['3', 'Vérif. Origin + captcha', 'côté serveur, liste de domaines'],
                  ['4', 'Émission du JWT éphémère', '30 min, lié au domaine + conversation'],
                  ['5', 'Chat prêt', 'arbre gratuit / IA décomptée'],
                ].map(([n, t, dsc], i, arr) => (
                  <div key={n} className="timeline-step">
                    <div className="col" style={{ alignItems: 'center' }}>
                      <span className="timeline-num">{n}</span>
                      {i < arr.length - 1 && <span className="timeline-line" />}
                    </div>
                    <div style={{ paddingBottom: i < arr.length - 1 ? 14 : 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t}</div>
                      <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 1 }}>{dsc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ================= SÉCURITÉ ================= */}
      {activeTab === 'security' && (
        <div className="col g18">
          <SectionTitle sub="Protection en couches : clé publique → vérif. d'origine → JWT éphémère → rate limits → cap budget. Vos vraies clés IA ne quittent jamais le serveur.">
            Sécurité &amp; anti-abus
          </SectionTitle>
          <div className="grid2">
            <div className="col g14">
              <Card>
                <div className="card-title" style={{ marginBottom: 4 }}>Domaines autorisés</div>
                <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 11, lineHeight: 1.5 }}>
                  Le widget ne s'initialise que si l'Origin correspond. Vérification côté serveur — les
                  navigateurs ne peuvent pas la forger.
                </div>
                <div className="col g6">
                  {bot.allowed_domains.map((dom: string) => (
                    <div key={dom} className="domain-row">
                      <span className="dot" />
                      <span className="dm">{dom}</span>
                      <button className="rm" aria-label="Retirer"
                              onClick={() => patch({ allowed_domains: bot.allowed_domains.filter((x: string) => x !== dom) })}>×</button>
                    </div>
                  ))}
                  {bot.allowed_domains.length === 0 && (
                    <InfoBox tone="danger" title="Aucun domaine autorisé">
                      Le widget ne fonctionnera nulle part tant qu'aucun domaine n'est déclaré.
                    </InfoBox>
                  )}
                </div>
                <div className="row g8" style={{ marginTop: 10 }}>
                  <input type="text" className="mono" value={newDomain} placeholder="autre-domaine.fr"
                         onChange={e => setNewDomain(e.target.value)}
                         onKeyDown={e => e.key === 'Enter' && addDomain()} style={{ flex: 1 }} />
                  <Btn kind="soft" small onClick={addDomain}><Plus size={13} /> Ajouter</Btn>
                </div>
              </Card>

              <Card>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>Limites de débit</div>
                  <Chip tone="mut">Lecture seule</Chip>
                </div>
                <div className="col" style={{ gap: 9 }}>
                  {[
                    ['Par session', '20 msg / 10 min', 'JWT éphémère (30 min)'],
                    ['Par IP', '100 req / min', 'anti-flood uniquement'],
                    ['Taille message', '4 000 caractères max', 'protection tokens'],
                    ['Historique IA', '20 messages max', 'envoyés au modèle'],
                  ].map(([k, v, hint]) => (
                    <div key={k} className="row g10">
                      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{k}</span>
                      <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--acc)' }}>{v}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--faint)', width: 130, textAlign: 'right' }}>{hint}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {canMoveToTeam && (
                <Card>
                  <div className="card-title">Déplacer vers une équipe</div>
                  <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 10 }}>
                    Ce chatbot est personnel. Transférez-le à une équipe pour le partager avec ses
                    membres. <strong>Transfert définitif</strong> : un bot d'équipe ne peut pas redevenir
                    personnel.
                  </div>
                  <div className="row g8" style={{ flexWrap: 'wrap' }}>
                    <select value={moveTarget === '' ? '' : String(moveTarget)}
                            onChange={e => setMoveTarget(e.target.value === '' ? '' : Number(e.target.value))}
                            style={{ flex: 1, minWidth: 180 }}>
                      <option value="">Choisir une équipe…</option>
                      {myTeams.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <Btn kind="soft" onClick={moveToTeam} disabled={moveTarget === '' || moveBusy}>
                      {moveBusy ? 'Déplacement…' : 'Déplacer'}
                    </Btn>
                  </div>
                </Card>
              )}

              {isOrgAdmin && (
                <Card style={{ borderColor: 'var(--danger-bd)' }}>
                  <div className="card-title" style={{ color: 'var(--danger)' }}>Zone de danger</div>
                  <div className="toggle-row" style={{ marginBottom: 12 }}>
                    <div>
                      <div className="tl">Widget actif</div>
                      <div className="ts">Désactivé : le chat disparaît des sites, sans rien supprimer.</div>
                    </div>
                    <Toggle on={bot.is_active} onChange={v => patch({ is_active: v })} />
                  </div>
                  <Btn kind="danger" onClick={deleteBot}>
                    <Trash2 size={14} /> Supprimer ce chatbot
                  </Btn>
                  <div className="field-hint" style={{ marginTop: 6 }}>
                    Suppression définitive : widget coupé partout, conversations et stats perdues.
                  </div>
                </Card>
              )}
            </div>

            <Card>
              <div className="card-title" style={{ marginBottom: 4 }}>Vérification anti-bot (captcha)</div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 12, lineHeight: 1.5 }}>
                Vérifié une seule fois à l'ouverture de session — invisible pour le visiteur, jamais à chaque
                message.
              </div>
              <div className="col g10">
                {CAPTCHA_OPTIONS.map(o => {
                  const selected = bot.captcha_provider === o.value
                  return (
                    <div key={o.value} onClick={() => patch({ captcha_provider: o.value })}
                         style={{
                           borderRadius: 11, cursor: 'pointer', padding: '11px 13px',
                           border: `1.5px solid ${selected ? 'var(--acc)' : 'var(--border)'}`,
                           background: selected ? 'var(--acc-soft)' : 'var(--surface)',
                         }}>
                      <div className="row g10">
                        <span className="radio-dot" style={selected ? { borderColor: 'var(--acc)', background: 'var(--acc)', boxShadow: 'inset 0 0 0 3px var(--surface)' } : {}} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{o.name}</span>
                        <Chip tone={o.tagTone}>{o.tag}</Chip>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--mut)', margin: '6px 0 0 25px', lineHeight: 1.5 }}>{o.desc}</div>
                      {selected && (
                        <div style={{ margin: '9px 0 0 25px' }} onClick={e => e.stopPropagation()}>
                          <InfoBox tone={o.rgpdTone} title="Flux de données (pour votre registre RGPD)">
                            {o.rgpd}
                          </InfoBox>
                          {o.value === 'recaptcha_v3' && (
                            <div className="col" style={{ gap: 7, marginTop: 9 }}>
                              <input type="text" className="mono" placeholder="Site key — 6Lc•••"
                                     value={bot.captcha_site_key || ''}
                                     onChange={e => patch({ captcha_site_key: e.target.value })} />
                              <input type="password" className="mono"
                                     placeholder={bot.captcha_secret_set ? 'Secret key — •••• (conservée si vide)' : 'Secret key — 6Lc•••'}
                                     value={captchaSecret}
                                     onChange={e => setCaptchaSecret(e.target.value)} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
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
