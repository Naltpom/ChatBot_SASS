// Page bot à onglets — header avatar de marque + chips, onglets en 3 groupes
// (mesure : Stats / Leads / Inbox · construire : Arbre / Bot & IA / Actions /
// Connaissances · diffuser : Apparence / Sécurité / Intégration), bannière
// « Vue admin » pour les superadmins. L'état dirty est suivi PAR ONGLET
// (comparaison à savedBot, la photo du dernier état serveur) et matérialisé par
// une save bar sticky en bas de page (Enregistrer / Annuler, Ctrl+S).
// Inbox et Connaissances vivent HORS save bar (CRUD immédiat dans leurs panneaux).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, Inbox, Lock, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import {
  Btn, BubbleIcon, Card, Chip, Divider, Field, InfoBox, Meter, SectionTitle, Seg, Toggle,
  brandBg, modeChip, statusChip,
} from '../ui'
import { ACTION_TEMPLATES, CAPTCHA_OPTIONS, MODEL_OPTIONS, findModelOption } from '../botConstants'
import AppearanceForm from '../components/AppearanceForm'
import InboxPanel from '../components/InboxPanel'
import InsightsPanel from '../components/InsightsPanel'
import KbPanel from '../components/KbPanel'
import StatsPanel from '../components/StatsPanel'
import TreeBuilder from '../components/TreeBuilder'
import WidgetPreview, { PreviewFrame } from '../components/WidgetPreview'

// perm = permission par bot requise pour un MEMBER (admins : tout).
// 3 groupes de travail (mesurer / construire / diffuser) séparés visuellement ;
// 'stats' reste PREMIER (fallback activeTab) et les libellés existants sont
// inchangés à l'octet (contrat e2e : sélection par nom, jamais par position).
const TABS = [
  { id: 'stats', label: 'Stats', perm: null, group: 'mesure' },
  // Insights : PAS gaté par aiTabRelevant (le CTA upgrade doit rester visible
  // sur plan free) — seul le bouton Analyser est désactivé dans le panneau.
  { id: 'insights', label: 'Insights', perm: 'context', group: 'mesure' },
  { id: 'leads', label: 'Leads', perm: 'context', group: 'mesure' },         // toujours (nœuds lead = tous modes)
  { id: 'inbox', label: 'Inbox', perm: 'inbox', group: 'mesure' },
  { id: 'tree', label: 'Arbre', perm: 'context', group: 'construire' },
  { id: 'ai', label: 'Bot & IA', perm: 'context', group: 'construire' },     // si aiTabRelevant
  { id: 'actions', label: 'Actions', perm: 'context', group: 'construire' }, // si aiTabRelevant
  { id: 'kb', label: 'Connaissances', perm: 'context', group: 'construire' },
  { id: 'appearance', label: 'Apparence', perm: 'appearance', group: 'diffuser' },
  { id: 'security', label: 'Sécurité', perm: 'security', group: 'diffuser' },
  { id: 'install', label: 'Intégration', perm: 'copy', group: 'diffuser' },
]

// Groupes de champs par onglet, alignés sur FIELD_PERMS (API) et sur le body
// de save() : ils pilotent le dirty tracking par onglet.
const TAB_FIELDS: Record<string, string[]> = {
  tree: ['tree_json', 'tree_variant_json', 'ab_split_pct'],
  ai: ['system_prompt', 'ai_provider', 'ai_model', 'temperature', 'api_key_mode'],
  actions: ['actions_json', 'mcp_servers_json'],
  // triggers_json : perm serveur = appearance (FIELD_PERMS), même onglet
  appearance: ['name', 'design_json', 'mode', 'triggers_json'],
  // handoff_webhook_url : perm serveur = context (credential) — l'API la masque
  // à null dans bot ET savedBot pour un member sans context → jamais de faux dirty.
  security: ['allowed_domains', 'captcha_provider', 'captcha_site_key', 'daily_ai_message_cap', 'is_active', 'handoff_webhook_url'],
}

const ACTION_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/
// Nom de serveur MCP : règle serveur _check_mcp_servers (31 caractères max)
const MCP_NAME_RE = /^[a-z][a-z0-9_]{0,30}$/

// Chip d'en-tête par type d'action (spans : aucun bouton supplémentaire nommé
// « Webhook », le Seg garde l'exclusivité — contrat e2e exact:true)
const ACTION_TYPE_CHIPS: Record<string, { tone: 'info' | 'go' | 'acc'; label: string }> = {
  webhook: { tone: 'info', label: 'Webhook' },
  capture_lead: { tone: 'go', label: 'Capture de lead' },
  handoff: { tone: 'acc', label: 'Conseiller humain' },
  create_ticket: { tone: 'go', label: 'Ticket par email' },
  calendar_slots: { tone: 'info', label: 'Créneaux Cal.com' },
}

interface Integration { id: string; label: string; icon: string; description: string; snippet: string }
interface LeadRow {
  id: number; email: string; phone: string | null; name: string | null; message: string | null
  source: 'tree' | 'ai'; conversation_id: string | null; created_at: string
}

export default function BotPage() {
  const { id } = useParams()
  const botId = Number(id)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()

  const [bot, setBot] = useState<any>(null)
  const [savedBot, setSavedBot] = useState<any>(null)   // photo du dernier état serveur
  const [tab, setTab] = useState(params.get('tab') || 'stats')
  const [byokKey, setByokKey] = useState('')
  const [captchaSecret, setCaptchaSecret] = useState('')
  const [actionSecrets, setActionSecrets] = useState<Record<number, string>>({})
  const [mcpTokens, setMcpTokens] = useState<Record<number, string>>({})    // jetons Bearer MCP, par INDEX (pattern actionSecrets)
  const [treeView, setTreeView] = useState<'a' | 'b'>('a')                  // arbre affiché par le TreeBuilder (A/B)
  const [newDomain, setNewDomain] = useState('')
  const [previewDegraded, setPreviewDegraded] = useState(false)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [integType, setIntegType] = useState('html')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')           // erreurs de SAUVEGARDE uniquement (save bar)
  const [pageError, setPageError] = useState('')   // erreurs hors save (leads, import, delete) — dismissable
  const [loadError, setLoadError] = useState('')   // échec du chargement initial (403/404, réseau)
  const [loadTry, setLoadTry] = useState(0)
  const [usage, setUsage] = useState<{ tree_only: boolean; max_tree_nodes: number | null; byok: boolean } | null>(null)
  const [leadsData, setLeadsData] = useState<{ total: number; leads: LeadRow[] } | null>(null)
  const [leadsBusy, setLeadsBusy] = useState(false)
  const [pendingHandoffs, setPendingHandoffs] = useState(0)  // pastille « à prendre » sur l'onglet Inbox

  const fromAdmin = params.get('from') === 'admin'
  const isAdminView = !!user?.is_superadmin && fromAdmin

  useEffect(() => {
    setLoadError('')
    api(`/api/bots/${botId}`).then((b: any) => {
      setBot(b)
      setSavedBot(b)
      api(`/api/orgs/${b.organization_id}/usage`).then(setUsage).catch(() => {})
    }).catch((err: any) => setLoadError(err.message))
    api(`/api/bots/${botId}/embed`).then(d => setIntegrations(d.integrations)).catch(() => {})
  }, [botId, loadTry])

  // Permissions par bot : admins d'org et superadmins ont tout, les members
  // voient uniquement les onglets couverts par leurs permissions
  const botOrg = user?.organizations.find(o => o.id === bot?.organization_id)
  const orgName = botOrg?.name || ''
  const isOrgAdmin = !!user?.is_superadmin || botOrg?.role === 'admin'
  const hasPerm = (perm: string | null) =>
    perm === null || isOrgAdmin || (botOrg?.permissions?.[String(botId)] || []).includes(perm)
  // Mode arbre pur (ou plan free) : les onglets Bot & IA et Actions n'ont pas lieu d'être
  const aiTabRelevant = !!bot && bot.mode !== 'tree' && !usage?.tree_only
  const visibleTabs = TABS.filter(t => hasPerm(t.perm) && ((t.id !== 'ai' && t.id !== 'actions') || aiTabRelevant))
  const activeTab = visibleTabs.some(t => t.id === tab) ? tab : 'stats'

  // Pastille « à prendre » sur l'onglet Inbox : compteur léger (total des
  // human_requested), poll 30 s même onglet fermé. InboxPanel affine à 5 s
  // quand l'onglet est ouvert (via onPending). Échec silencieux.
  const canInbox = !!bot && hasPerm('inbox')
  useEffect(() => {
    if (!canInbox) return
    let alive = true
    const check = () => {
      api(`/api/bots/${botId}/conversations?status=human_requested&limit=1`)
        .then((d: any) => { if (alive) setPendingHandoffs(d.total) })
        .catch(() => {})
    }
    check()
    const h = setInterval(check, 30000)
    return () => { alive = false; clearInterval(h) }
  }, [botId, canInbox])

  // Garde A/B : si la variante disparaît (Annuler, désactivation, reload), on
  // ne reste jamais sur la vue B — un seul TreeBuilder monté, jamais avec
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

  // Leads : fetch au premier affichage de l'onglet
  useEffect(() => {
    if (activeTab === 'leads' && leadsData === null && !leadsBusy) loadLeads()
  }, [activeTab])  // eslint-disable-line react-hooks/exhaustive-deps

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

  // Pré-remplissage depuis un insight : nouveau nœud + option racine dans
  // l'arbre LOCAL (l'onglet Arbre devient dirty → save bar, comportement
  // attendu). Quota de bulles : non bloquant en pratique (insights = plans
  // payants, max_tree_nodes null hors free) — le 403 au save couvrirait le cas.
  function prefillFromInsight(theme: string, bubble: string) {
    const t = JSON.parse(JSON.stringify(bot.tree_json))
    let id
    do { id = 'ins' + Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 100) } while (t.nodes[id])
    t.nodes[id] = { message: bubble, options: [] }
    const root = t.nodes[t.start]
    root.options = [...(root.options || []), { label: theme.slice(0, 60), next: id }]
    patch({ tree_json: t })
    // La bulle est ajoutée à l'arbre A : forcer la vue A (le Seg a pu rester
    // sur la variante B, la bulle y serait invisible)
    setTreeView('a')
    switchTab('tree')
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
    }
    if (hasPerm('security') && dirtySet.has('security')) {
      body.allowed_domains = bot.allowed_domains
      body.captcha_provider = bot.captcha_provider
      body.captcha_site_key = bot.captcha_site_key || null
      body.daily_ai_message_cap = bot.daily_ai_message_cap
      body.is_active = bot.is_active
      if (captchaSecret) body.captcha_secret = captchaSecret
      // Garde dédiée : la perm serveur du champ est context (FIELD_PERMS), pas
      // security — un member security-sans-context ne doit jamais envoyer la clé.
      if (hasPerm('context') && bot.handoff_webhook_url !== savedBot?.handoff_webhook_url) {
        body.handoff_webhook_url = bot.handoff_webhook_url || null
      }
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
    const d = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (d && !bot.allowed_domains.includes(d)) patch({ allowed_domains: [...bot.allowed_domains, d] })
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

  // ---------- Leads ----------
  function loadLeads() {
    setLeadsBusy(true)
    setPageError('')  // un retry réussi efface l'erreur précédente
    api(`/api/bots/${botId}/leads?limit=100`)
      .then(setLeadsData)
      .catch((err: any) => setPageError(err.message))
      .finally(() => setLeadsBusy(false))
  }

  function exportLeadsCsv() {
    const rows = leadsData?.leads || []
    // Quoting CSV + anti-injection de formule (Excel/LibreOffice) : les valeurs
    // viennent de visiteurs anonymes — préfixe ' si la cellule commence par
    // = + - @ tab ou CR, sinon elle serait interprétée comme formule.
    const esc = (v: any) => {
      let s = String(v ?? '')
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
      return `"${s.replace(/"/g, '""')}"`
    }
    const header = ['created_at', 'email', 'name', 'phone', 'message', 'source']
    const csv = [header.join(','), ...rows.map(l => header.map(h => esc((l as any)[h])).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `leads-${bot.name.toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
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
  // BYOK : droit du plan (usage.byok) — le serveur re-vérifie (403)
  const byokLocked = !!usage && !usage.byok && bot.api_key_mode !== 'byok'
  const byokOutOfPlan = !!usage && !usage.byok && bot.api_key_mode === 'byok'

  return (
    <div className="col" style={{ gap: 16 }}>
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
                style={{ width: 42, height: 42, background: brandBg(d) }}>
            <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? 42 : 20} avatarImg={d.avatarImage} />
          </span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="bot-head-title">
              {bot.name} {statusChip(bot.is_active)} {modeChip(bot.mode)}
            </div>
            <div className="bot-head-key">{site} · {bot.public_key}</div>
          </div>
        </div>
      </div>

      {pageError && (
        <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{pageError}</span>
          <button onClick={() => setPageError('')} aria-label="Fermer"
                  style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15, padding: 2, lineHeight: 1 }}>×</button>
        </div>
      )}

      <div className="tabs">
        {visibleTabs.map((t, i) => (
          <Fragment key={t.id}>
            {/* Séparateur entre groupes, calculé sur visibleTabs : jamais de
                séparateur orphelin quand un member n'a qu'une partie des onglets */}
            {i > 0 && visibleTabs[i - 1].group !== t.group && <span className="tab-sep" aria-hidden="true" />}
            {/* aria-label dynamique : contient toujours « Inbox » (les sélecteurs
                e2e par nom et le contrat des libellés restent valides), la
                pastille visuelle reste aria-hidden */}
            <button className={activeTab === t.id ? 'active' : ''} onClick={() => switchTab(t.id)}
                    aria-label={t.id === 'inbox' && pendingHandoffs > 0
                      ? `Inbox — ${pendingHandoffs} en attente` : undefined}>
              {t.label}
              {dirtyTabs.includes(t.id) && <span className="tab-dot" aria-hidden="true" />}
              {t.id === 'inbox' && pendingHandoffs > 0 && (
                <span className="tab-badge" aria-hidden="true">{pendingHandoffs}</span>
              )}
            </button>
          </Fragment>
        ))}
      </div>

      {/* ================= STATS ================= */}
      {activeTab === 'stats' && (
        <StatsPanel botId={botId} botName={bot.name} orgId={bot.organization_id}
                    tree={bot.tree_json} variantTree={bot.tree_variant_json}
                    abSplit={bot.ab_split_pct ?? 0} />
      )}

      {/* ================= INSIGHTS ================= */}
      {activeTab === 'insights' && (
        <InsightsPanel botId={botId} treeOnly={!!usage?.tree_only}
                       isAdminView={isAdminView} onPrefill={prefillFromInsight} />
      )}

      {/* ================= INBOX (live chat) ================= */}
      {/* Monté UNIQUEMENT onglet ouvert : le refetch 5 s meurt au changement d'onglet */}
      {activeTab === 'inbox' && <InboxPanel botId={botId} onPending={setPendingHandoffs} />}

      {/* ================= CONNAISSANCES (KB) ================= */}
      {activeTab === 'kb' && <KbPanel botId={botId} aiActive={aiTabRelevant} />}

      {/* ================= ARBRE ================= */}
      {activeTab === 'tree' && (
        <div className="col g14">
          {bot.tree_variant_json == null ? (
            <Card>
              <div className="card-title">Test A/B de l'arbre</div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 10 }}>
                Servez une variante B à une partie des nouvelles conversations et comparez conversations
                et satisfaction dans l'onglet Stats. L'affectation est tirée au sort à l'ouverture et
                reste stable pour toute la conversation.
              </div>
              <Btn kind="soft" onClick={() => {
                patch({ tree_variant_json: JSON.parse(JSON.stringify(bot.tree_json)), ab_split_pct: bot.ab_split_pct || 50 })
                setTreeView('b')
              }}>Activer une variante B</Btn>
              {usage?.max_tree_nodes != null && (
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Le quota de bulles de votre plan s'applique aussi à la variante.
                </div>
              )}
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

          {/* UN SEUL TreeBuilder monté à la fois (contrat e2e strict mode :
              « Arbre de décision » / « Ajouter un choix racine » sans .first()).
              key force le remount au switch — l'inspecteur ne garde jamais une
              sélection pointant sur l'autre arbre. La variante B n'a ni
              export/import (config.json l'exclut) ni génération IA (elle
              remplacerait la variante : coût + confusion). */}
          {treeView === 'b' && bot.tree_variant_json ? (
            <TreeBuilder key="b" tree={bot.tree_variant_json}
                         onChange={t => patch({ tree_variant_json: t })}
                         maxNodes={usage?.max_tree_nodes ?? null}
                         allowAI={aiTabRelevant} />
          ) : (
            <TreeBuilder key="a" tree={bot.tree_json} onChange={t => patch({ tree_json: t })}
                         onExport={exportConfig}
                         onImport={hasPerm('context') && hasPerm('appearance') ? importConfig : undefined}
                         botId={botId}
                         canGenerate={!usage?.tree_only}
                         maxNodes={usage?.max_tree_nodes ?? null}
                         allowAI={aiTabRelevant} />
          )}
        </div>
      )}

      {/* ================= BOT & IA ================= */}
      {activeTab === 'ai' && (
        <div className="col g18">
          <SectionTitle sub="Modèle, clés API et instructions utilisées par l'IA pour répondre.">
            Bot &amp; IA
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
              <div title={byokLocked ? 'Plan Agence requis' : undefined}>
                <Seg value={bot.api_key_mode}
                     onChange={v => { if (v === 'byok' && byokLocked) return; patch({ api_key_mode: v }) }}
                     options={[{ value: 'managed', label: 'Clé Kertios (managée)' }, { value: 'byok', label: 'Ma propre clé (BYOK)' }]} />
              </div>
              {byokLocked && (
                <div style={{ marginTop: 10 }}>
                  <InfoBox tone="info"
                           title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Lock size={13} /> Réservé au plan Agence</span>}>
                    Votre propre clé API (BYOK) est réservée au plan Agence — passez au plan supérieur
                    pour l'activer.
                  </InfoBox>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                {bot.api_key_mode === 'managed' ? (
                  <InfoBox tone="go" title="Clé managée">
                    La consommation IA est facturée en crédits sur votre plan. Aucune clé à gérer, les plafonds
                    protègent votre budget.
                  </InfoBox>
                ) : (
                  <div className="col g8">
                    {byokOutOfPlan && (
                      <InfoBox tone="warn" title="BYOK hors plan">
                        L'IA de ce bot est coupée tant que le plan n'inclut pas l'option.
                      </InfoBox>
                    )}
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
            </div>
          </div>
        </div>
      )}

      {/* ================= ACTIONS IA ================= */}
      {activeTab === 'actions' && (
        <div className="col g18">
          <SectionTitle sub="Donnez à l'IA le pouvoir d'agir pendant la conversation : appeler vos webhooks (signés) ou enregistrer un contact. 5 actions maximum.">
            Actions IA
          </SectionTitle>

          {bot.ai_provider === 'gemini' && (
            <InfoBox tone="warn" title="Non supporté par Gemini">
              Les actions, la recherche dans les connaissances et les serveurs MCP sont ignorés tant que
              le modèle Gemini est sélectionné — choisissez Claude ou GPT dans l'onglet Bot &amp; IA.
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
                        <input type="text" className="mono" placeholder="https://api.votre-site.fr/hooks/kertios"
                               value={a.url || ''} onChange={e => updateAction(i, { url: e.target.value })} />
                      </Field>
                      <Field label="Secret HMAC" hint="Signature HMAC-SHA256 dans l'en-tête X-Kertios-Signature.">
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
                      d'attente (onglet Inbox), vos admins sont notifiés par email et par le webhook Slack
                      s'il est configuré (onglet Sécurité). Aucun champ à configurer.
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
                      dans l'onglet Leads (notification email aux admins si le serveur a un SMTP).
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

      {/* ================= LEADS ================= */}
      {activeTab === 'leads' && (
        <div className="col g18">
          <SectionTitle sub={`${leadsData?.total ?? 0} contact(s) capturé(s) par ce bot.`}
            right={
              <div className="row g8">
                <Btn kind="ghost" small onClick={loadLeads} disabled={leadsBusy}>
                  <RefreshCw size={13} /> Actualiser
                </Btn>
                <Btn kind="ghost" small onClick={exportLeadsCsv} disabled={!leadsData?.leads?.length}>
                  Exporter CSV
                </Btn>
              </div>
            }>
            Leads
          </SectionTitle>

          {leadsBusy && !leadsData ? (
            <Card style={{ textAlign: 'center', color: 'var(--mut)' }}>Chargement…</Card>
          ) : !leadsData || leadsData.leads.length === 0 ? (
            <Card style={{ textAlign: 'center', padding: '40px 24px' }}>
              <div className="col" style={{ alignItems: 'center', gap: 9 }}>
                <Inbox size={24} style={{ color: 'var(--faint)' }} />
                <div style={{ fontSize: 14, fontWeight: 800 }}>Aucun lead pour l'instant</div>
                <div style={{ fontSize: 12, color: 'var(--mut)', maxWidth: 400, lineHeight: 1.55 }}>
                  Ajoutez un nœud « Contact » dans l'arbre, ou une action « Capture de lead », pour
                  collecter des demandes.
                </div>
                {hasPerm('context') && (
                  <Btn kind="soft" small onClick={() => switchTab('tree')}>Ouvrir l'arbre</Btn>
                )}
              </div>
            </Card>
          ) : (
            <Card nopad>
              <table className="kc">
                <thead>
                  <tr><th>Date</th><th>Email</th><th>Nom</th><th>Téléphone</th><th>Message</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {leadsData.leads.map(l => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString('fr-FR')}</td>
                      <td className="mono">{l.email}</td>
                      <td>{l.name || '—'}</td>
                      <td className="mono">{l.phone || '—'}</td>
                      <td title={l.message || ''}>
                        {l.message ? (l.message.length > 60 ? `${l.message.slice(0, 60)}…` : l.message) : '—'}
                      </td>
                      <td>{l.source === 'ai' ? <Chip tone="acc">IA</Chip> : <Chip tone="mut">Arbre</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {isOrgAdmin && (
            <div className="field-hint">
              Notification email : sans SMTP configuré côté serveur (SMTP_HOST), les nouveaux leads sont
              uniquement journalisés.
            </div>
          )}
        </div>
      )}

      {/* ================= APPARENCE ================= */}
      {activeTab === 'appearance' && (
        <div className="col g18">
          <SectionTitle sub="Personnalisez le widget aux couleurs du site client. Aperçu en direct à droite.">
            Apparence du widget
          </SectionTitle>
          <div className="grid-controls">
            <div className="col g14">
              <Card>
                <AppearanceForm design={d} botName={bot.name}
                                onChange={patchDesign} onNameChange={v => patch({ name: v })} />
              </Card>
              <Card>
                <div className="card-title">Comportement</div>
                <div className="col" style={{ gap: 12 }}>
                  <Field label="Mode" hint={usage?.tree_only
                    ? 'Plan free : mode arbre uniquement. Passez au plan Starter pour activer l\'IA.'
                    : 'Hybride : arbre guidé d\'abord, IA à la demande. Les réponses arbre sont gratuites.'}>
                    {usage?.tree_only ? (
                      <Chip tone="mut"><Lock size={11} /> Arbre (plan free)</Chip>
                    ) : (
                      <Seg value={bot.mode} onChange={v => patch({ mode: v })}
                           options={[{ value: 'tree', label: 'Arbre' }, { value: 'hybrid', label: 'Hybride' }, { value: 'ai', label: 'IA' }]} />
                    )}
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
              <PreviewFrame site={site} siteName={orgName || site} brandColor={d.primaryColor || '#0d9488'}>
                <WidgetPreview design={d} mode={bot.mode} tree={bot.tree_json}
                               botName={bot.name} degraded={previewDegraded} />
              </PreviewFrame>
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
                <div className="card-title">Limites de débit</div>
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

              {/* Webhook handoff : perm serveur = context (credential), pas
                  security — un member security-sans-context ne voit pas le champ
                  (l'API le masque de toute façon à null en lecture). */}
              {hasPerm('context') && (
                <Card>
                  <div className="card-title">Notification live chat</div>
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
                  <div style={{ marginTop: 10 }}>
                    <InfoBox tone="info" title="Cette URL est un secret">
                      Un webhook Slack contient un jeton dans son chemin : il n'apparaît jamais dans les
                      exports config.json et n'est visible qu'avec la permission Contexte.
                    </InfoBox>
                  </div>
                </Card>
              )}

              {aiTabRelevant && (
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

      {/* ================= INTÉGRATION ================= */}
      {activeTab === 'install' && (
        <div className="col g18">
          <SectionTitle sub="Une seule balise avant </body>. Le widget pèse < 30 ko et ne bloque jamais le rendu de la page.">
            Intégration
          </SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, alignItems: 'start' }}>
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

      {/* ================= SAVE BAR STICKY ================= */}
      {(dirty || saved || error) && (
        <div className="save-bar" role="status">
          <div className="sb-state">
            {error ? (
              <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{error}</span>
            ) : dirty ? (
              <>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--warn)', display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontWeight: 700 }}>Modifications non enregistrées</span>
                {dirtyTabs.map(t => {
                  const def = TABS.find(x => x.id === t)
                  if (!def || !visibleTabs.some(v => v.id === t)) return null
                  return (
                    <button key={t} className="chip chip-warn" onClick={() => switchTab(t)}>{def.label}</button>
                  )
                })}
              </>
            ) : (
              <span style={{ color: 'var(--go)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Check size={14} /> Modifications enregistrées
              </span>
            )}
          </div>
          <Btn kind="ghost" onClick={cancelChanges} disabled={!dirty}>Annuler</Btn>
          <Btn kind={saved ? 'soft' : 'primary'} onClick={save} disabled={!dirty && !saved}>
            {saved ? <><Check size={14} /> Enregistré</> : 'Enregistrer'}
          </Btn>
        </div>
      )}
    </div>
  )
}
