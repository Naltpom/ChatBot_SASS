// Hook éditeur de bot — extrait de BotPage pour isoler le chargement, le
// dirty-tracking PAR ONGLET, le save() (PATCH partiel limité aux onglets dirty),
// l'annulation et les helpers CRUD des listes JSON (actions / serveurs MCP /
// déclencheurs). Comportement strictement identique à l'inline d'origine
// (savebar/botpage/appearance/ab/triggers couvrent la rétro-compat).
//
// Les SECRETS write-only (BYOK, captcha, secrets d'actions, jetons MCP) sont
// suivis ici par INDEX et rejoués dans le payload à la sauvegarde ; ils ne sont
// jamais relus depuis l'API (seuls les flags *_set reviennent).
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { canAccessBotPerm } from '../utils/permissions'
import { errMsg } from '../utils/errors'
import type {
  Bot, BotAction, BotUpdate, McpServer, Trigger, Tree,
} from '../types/bot'
import type { User } from '../types/auth'

// Groupes de champs par onglet, alignés sur FIELD_PERMS (API) et sur le body de
// save() : ils pilotent le dirty tracking par onglet.
const TAB_FIELDS: Record<string, (keyof Bot)[]> = {
  // triggers_json : perm serveur = appearance (FIELD_PERMS), même onglet
  appearance: ['name', 'design_json', 'mode', 'triggers_json'],
  tree: ['tree_json', 'tree_variant_json', 'ab_split_pct'],
  ai: ['system_prompt', 'ai_provider', 'ai_model', 'temperature', 'api_key_mode'],
  // handoff_webhook_url : perm serveur = context (credential) — l'API la masque
  // à null dans bot ET savedBot pour un member sans context → jamais de faux dirty.
  human: ['handoff_webhook_url'],
  actions: ['actions_json', 'mcp_servers_json'],
  security: ['allowed_domains', 'captcha_provider', 'captcha_site_key', 'is_active'],
}

// ---------- Helpers listes JSON (CRUD générique) ----------
// updateList : remplace l'élément i par un merge { ...elt, ...fields }.
function listUpdate<T>(list: T[] | undefined, i: number, fields: Partial<T>): T[] {
  return (list || []).map((x, j) => (j === i ? { ...x, ...fields } : x))
}
// listRemove : retire l'élément i.
function listRemove<T>(list: T[] | undefined, i: number): T[] {
  return (list || []).filter((_, j) => j !== i)
}
// listAdd : ajoute un élément en fin de liste (append-only).
function listAdd<T>(list: T[] | undefined, item: T): T[] {
  return [...(list || []), item]
}
// reindexAfterRemove : ré-indexe une map secret-par-index après suppression de
// l'index `removed` (les index > removed glissent de 1, l'index removed disparaît).
function reindexAfterRemove(
  prev: Record<number, string>, removed: number,
): Record<number, string> {
  const next: Record<number, string> = {}
  Object.entries(prev).forEach(([k, v]) => {
    const idx = Number(k)
    if (idx < removed) next[idx] = v
    else if (idx > removed) next[idx - 1] = v
  })
  return next
}

export interface BotEditor {
  bot: Bot | null
  savedBot: Bot | null
  setBot: React.Dispatch<React.SetStateAction<Bot | null>>
  setSavedBot: React.Dispatch<React.SetStateAction<Bot | null>>
  loadError: string
  reload: () => void
  // secrets write-only
  byokKey: string
  setByokKey: (v: string) => void
  captchaSecret: string
  setCaptchaSecret: (v: string) => void
  actionSecrets: Record<number, string>
  setActionSecrets: React.Dispatch<React.SetStateAction<Record<number, string>>>
  setActionSecretAt: (i: number, v: string) => void
  mcpTokens: Record<number, string>
  setMcpTokens: React.Dispatch<React.SetStateAction<Record<number, string>>>
  setMcpTokenAt: (i: number, v: string) => void
  // dirty / save
  dirtyTabs: string[]
  dirty: boolean
  saved: boolean
  setSaved: (v: boolean) => void
  error: string
  setError: (v: string) => void
  save: () => Promise<void>
  cancelChanges: () => void
  // patchs
  patch: (fields: BotUpdate) => void
  patchDesign: (fields: Record<string, unknown>) => void
  hasPerm: (perm: string | null) => boolean
  // CRUD actions
  updateAction: (i: number, fields: Partial<BotAction>) => void
  addAction: () => void
  removeAction: (i: number) => void
  updateActionField: (ai: number, fi: number, fields: Record<string, unknown>) => void
  updateActionType: (i: number, v: string) => void
  // CRUD MCP
  updateMcpServer: (i: number, fields: Partial<McpServer>) => void
  addMcpServer: () => void
  removeMcpServer: (i: number) => void
  // CRUD déclencheurs
  updateTrigger: (i: number, fields: Partial<Trigger>) => void
  updateTriggerType: (i: number, v: string) => void
  addTrigger: () => void
  removeTrigger: (i: number) => void
}

export function useBotEditor(botId: number, user: User | null | undefined): BotEditor {
  const [bot, setBot] = useState<Bot | null>(null)
  const [savedBot, setSavedBot] = useState<Bot | null>(null) // photo du dernier état serveur
  const [byokKey, setByokKey] = useState('')
  const [captchaSecret, setCaptchaSecret] = useState('')
  const [actionSecrets, setActionSecrets] = useState<Record<number, string>>({})
  const [mcpTokens, setMcpTokens] = useState<Record<number, string>>({}) // jetons Bearer MCP, par INDEX (pattern actionSecrets)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('') // erreurs de SAUVEGARDE uniquement (save bar)
  const [loadError, setLoadError] = useState('') // échec du chargement initial (403/404, réseau)
  const [loadTry, setLoadTry] = useState(0)

  useEffect(() => {
    // Garde `alive` : sous StrictMode (double-montage en dev) ou si l'id change,
    // une réponse tardive ne doit PAS réécrire setBot/setSavedBot et écraser une
    // édition en cours (sinon la saisie est avalée « mi-parcours »).
    let alive = true
    setLoadError('')
    api<Bot>(`/api/bots/${botId}`).then(b => {
      if (!alive) return
      setBot(b)
      setSavedBot(b)
    }).catch((err: unknown) => { if (alive) setLoadError(errMsg(err, 'Erreur')) })
    return () => { alive = false }
  }, [botId, loadTry])

  // hasPerm délègue à canAccessBotPerm (source unique) — perm null = onglet
  // public, et tant que le bot n'est pas chargé on refuse (état de chargement).
  const hasPerm = (perm: string | null) =>
    perm === null || (!!bot && canAccessBotPerm(user, bot, perm))

  // ---------- Dirty tracking par onglet ----------
  const dirtyTabs = useMemo(() => {
    if (!bot || !savedBot) return [] as string[]
    const pick = (obj: Bot, fields: (keyof Bot)[]) => JSON.stringify(fields.map(f => obj[f]))
    const extras: Record<string, boolean> = {
      ai: byokKey !== '',
      actions: Object.keys(actionSecrets).length > 0 || Object.keys(mcpTokens).length > 0,
      security: captchaSecret !== '',
    }
    return Object.keys(TAB_FIELDS).filter(t =>
      extras[t] || pick(bot, TAB_FIELDS[t]) !== pick(savedBot, TAB_FIELDS[t]))
  }, [bot, savedBot, byokKey, captchaSecret, actionSecrets, mcpTokens])
  const dirty = dirtyTabs.length > 0

  function patch(fields: BotUpdate) {
    setBot(b => (b ? { ...b, ...fields } as Bot : b))
  }
  function patchDesign(fields: Record<string, unknown>) {
    setBot(b => (b ? { ...b, design_json: { ...b.design_json, ...fields } } : b))
  }

  // Secrets write-only par INDEX : valeur saisie → posée à l'index, vidée →
  // index retiré (omis du payload = conservé côté serveur). Clé React = index :
  // ne jamais désaligner (les secrets sont indexés par position).
  function setSecretAt(
    setMap: React.Dispatch<React.SetStateAction<Record<number, string>>>, i: number, v: string,
  ) {
    setMap(prev => {
      const next = { ...prev }
      if (v) next[i] = v
      else delete next[i]
      return next
    })
  }
  const setActionSecretAt = (i: number, v: string) => setSecretAt(setActionSecrets, i, v)
  const setMcpTokenAt = (i: number, v: string) => setSecretAt(setMcpTokens, i, v)

  function serializeActions(): BotUpdate['actions_json'] {
    // Secret tapé : envoyé pour (re)poser (api_key sur calendar_slots, secret
    // HMAC sinon — 1 secret max par action), omis pour conserver. Les flags
    // secret_set/api_key_set (posés par BotOut sur TOUTES les actions) ne
    // repartent jamais au PATCH.
    return (bot?.actions_json || []).map((a, i) => {
      const { secret_set, api_key_set, ...rest } = a as BotAction & Record<string, unknown>
      void secret_set; void api_key_set
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
      if (!actionSecrets[i]) return rest as BotAction
      return rest.type === 'calendar_slots'
        ? { ...rest, api_key: actionSecrets[i] }
        : { ...rest, secret: actionSecrets[i] }
    })
  }

  function serializeMcpServers(): BotUpdate['mcp_servers_json'] {
    // Jeton Bearer : même mécanique write-only (envoyé = posé, omis = conservé
    // par nom à URL inchangée côté serveur) ; auth_token_set jamais renvoyé.
    return (bot?.mcp_servers_json || []).map((s, i) => {
      const { auth_token_set, ...rest } = s
      void auth_token_set
      return mcpTokens[i] ? { ...rest, auth_token: mcpTokens[i] } : rest
    })
  }

  async function save() {
    if (!bot) return
    setError('')
    // Body limité aux groupes des onglets DIRTY (TAB_FIELDS), croisés avec les
    // permissions (FIELD_PERMS côté API vérifie chaque champ présent). Le PATCH
    // est partiel (exclude_unset serveur) : un changement de design seul
    // n'envoie ni mode/tree_json ni api_key_mode inchangés.
    const body: BotUpdate = {}
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
        // sur la variante) sont affichés tels quels par la save bar.
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
    if (hasPerm('security') && dirtySet.has('security')) {
      body.allowed_domains = bot.allowed_domains
      body.captcha_provider = bot.captcha_provider
      body.captcha_site_key = bot.captcha_site_key || null
      body.is_active = bot.is_active
      if (captchaSecret) body.captcha_secret = captchaSecret
    }
    try {
      const updated = await api<Bot>(`/api/bots/${botId}`, { method: 'PATCH', body })
      setBot(updated)
      setSavedBot(updated)
      setByokKey('')
      setCaptchaSecret('')
      setActionSecrets({})
      setMcpTokens({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: unknown) {
      // 402 = module payant non souscrit (gate serveur). On NE montre PAS l'objet
      // brut {error, module} : message clair qui renvoie vers Facturation.
      if (err instanceof ApiError && err.status === 402) {
        setError("Cette option fait partie d'un module payant. Ouvre l'onglet « Facturation » pour l'ajouter à ton abonnement, puis réessaie d'enregistrer.")
      } else {
        setError(errMsg(err, 'Erreur'))
      }
    }
  }

  function cancelChanges() {
    setBot(savedBot ? (JSON.parse(JSON.stringify(savedBot)) as Bot) : null)
    setByokKey('')
    setCaptchaSecret('')
    setActionSecrets({})
    setMcpTokens({})
    setError('')
  }

  // ---------- Actions IA ----------
  function updateAction(i: number, fields: Partial<BotAction>) {
    patch({ actions_json: listUpdate(bot?.actions_json, i, fields) })
  }
  function addAction() {
    const list = bot?.actions_json || []
    if (list.length >= 5) return
    patch({ actions_json: listAdd(list, { name: '', description: '', type: 'webhook', url: '', fields: [], secret_set: false }) })
  }
  function removeAction(i: number) {
    patch({ actions_json: listRemove(bot?.actions_json, i) })
    setActionSecrets(prev => reindexAfterRemove(prev, i))
  }
  function updateActionField(ai: number, fi: number, fields: Record<string, unknown>) {
    const a = (bot?.actions_json || [])[ai]
    updateAction(ai, { fields: listUpdate(a?.fields, fi, fields) })
  }
  // Changement de type = reconstruction propre : nom/description conservés,
  // défauts du type posés, flags *_set remis à plat et secret tapé jeté (un
  // secret HMAC ne doit jamais partir comme api_key Cal.com, ni l'inverse).
  function updateActionType(i: number, v: string) {
    const a = (bot?.actions_json || [])[i] || ({} as BotAction)
    if (a.type === v) return
    const next: Record<string, unknown> = {
      name: a.name || '', description: a.description || '', type: v,
      secret_set: false, api_key_set: false,
    }
    if (v === 'webhook') { next.url = ''; next.fields = [] }
    // create_ticket : PAS de to_email seedé — clé absente = envoi aux admins
    // (le serveur rejette la chaîne vide ; serializeActions l'omet de toute façon)
    else if (v === 'calendar_slots') { next.event_type_id = ''; next.timezone = 'Europe/Paris' }
    patch({ actions_json: (bot?.actions_json || []).map((x, j) => (j === i ? (next as unknown as BotAction) : x)) })
    setActionSecrets(prev => {
      const rest = { ...prev }
      delete rest[i]
      return rest
    })
  }

  // ---------- Serveurs MCP ----------
  function updateMcpServer(i: number, fields: Partial<McpServer>) {
    patch({ mcp_servers_json: listUpdate(bot?.mcp_servers_json, i, fields) })
  }
  function addMcpServer() {
    const list = bot?.mcp_servers_json || []
    if (list.length >= 2) return
    patch({ mcp_servers_json: listAdd(list, { name: '', url: '', auth_token_set: false }) })
  }
  function removeMcpServer(i: number) {
    patch({ mcp_servers_json: listRemove(bot?.mcp_servers_json, i) })
    // Ré-indexation des jetons tapés (même mécanique que removeAction)
    setMcpTokens(prev => reindexAfterRemove(prev, i))
  }

  // ---------- Déclencheurs proactifs ----------
  function updateTrigger(i: number, fields: Partial<Trigger>) {
    patch({ triggers_json: listUpdate(bot?.triggers_json, i, fields) })
  }
  // Changement de type = reconstruction (message/once conservés, value remise
  // au défaut du type) ; exit_intent = SANS clé value (le serveur l'ignore mais
  // on reste aligné sur ce qu'il stocke).
  function updateTriggerType(i: number, v: string) {
    const tr = (bot?.triggers_json || [])[i] || ({} as Trigger)
    if (tr.type === v) return
    const next: Record<string, unknown> = { type: v, message: tr.message || '', once_per_session: tr.once_per_session ?? true }
    if (v === 'time_on_page') next.value = 30
    else if (v === 'scroll_depth') next.value = 50
    else if (v === 'url_pattern') next.value = ''
    patch({ triggers_json: (bot?.triggers_json || []).map((t, j) => (j === i ? (next as unknown as Trigger) : t)) })
  }
  function addTrigger() {
    const list = bot?.triggers_json || []
    if (list.length >= 5) return
    patch({ triggers_json: listAdd(list, { type: 'time_on_page', value: 30, message: '', once_per_session: true }) })
  }
  function removeTrigger(i: number) {
    patch({ triggers_json: listRemove(bot?.triggers_json, i) })
  }

  // Garde « modifications non enregistrées » : tant qu'un onglet est dirty, on
  // intercepte la fermeture/rechargement de l'onglet (beforeunload) pour que le
  // navigateur affiche sa confirmation native « quitter le site ? » (#UX-7). On
  // s'en tient au beforeunload : l'app monte un <BrowserRouter> classique (pas un
  // data router), donc useBlocker/usePrompt de react-router 6 n'est pas
  // disponible pour bloquer la navigation interne SPA — voir le rapport.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '' // requis par Chrome pour déclencher l'invite native
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // saveRef : Ctrl+S sans listener périmé (consommé par BotPage).
  const saveRef = useRef<{ dirty: boolean; save: () => void }>({ dirty: false, save: () => {} })
  saveRef.current = { dirty, save: () => { void save() } }
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

  return {
    bot, savedBot, setBot, setSavedBot, loadError, reload: () => setLoadTry(n => n + 1),
    byokKey, setByokKey, captchaSecret, setCaptchaSecret,
    actionSecrets, setActionSecrets, setActionSecretAt,
    mcpTokens, setMcpTokens, setMcpTokenAt,
    dirtyTabs, dirty, saved, setSaved, error, setError, save, cancelChanges,
    patch, patchDesign, hasPerm,
    updateAction, addAction, removeAction, updateActionField, updateActionType,
    updateMcpServer, addMcpServer, removeMcpServer,
    updateTrigger, updateTriggerType, addTrigger, removeTrigger,
  }
}
