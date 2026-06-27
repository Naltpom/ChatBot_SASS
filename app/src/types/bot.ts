// Contrat de types partagé pour les bots — fidèle aux clés JSON réelles
// renvoyées par l'API (schémas Pydantic en snake_case). Ces types décrivent la
// FORME exacte des objets que le frontend reçoit/envoie ; ils ne modifient aucun
// comportement. Source de vérité :
//   - api/src/models/bot.py        (Bot, BotOut, BotUpdate, DEFAULT_DESIGN, DEFAULT_TREE)
//   - api/src/routers/bots.py      (GET /bots/{id}/embed -> integrations)
//   - api/src/routers/bots_helpers.py (formes actions/mcp/triggers validées)
//
// Convention : tout champ qui peut manquer/être null dans le JSON réel est
// marqué optionnel/`| null` ; les `Record<string, unknown>` correspondent aux
// colonnes JSON libres (tree_json/design_json sont des dict côté Pydantic).

// ============================================================================
// Arbre de conversation (tree_json / tree_variant_json)
// ============================================================================

// Une option d'un nœud : libellé cliquable + identifiant du nœud suivant
// (`__ai__` = bascule sur l'IA, pas un vrai nœud).
export interface NodeOption {
  label: string
  next: string
  // Point de pliage de la flèche dans l'éditeur de workflow (courbure manuelle).
  // Clé ADDITIVE, ignorée par le backend/widget (comme TreeNode.pos).
  bend?: { x: number; y: number }
}

// Un nœud de l'arbre. `type` absent = simple message ; les nœuds typés
// (handoff/appointment/lead) portent des clés annexes (url/fields).
export interface TreeNode {
  message?: string
  options?: NodeOption[]
  type?: 'message' | 'appointment' | 'lead' | 'handoff'
  url?: string
  fields?: string[]
  // Position du nœud dans l'éditeur de workflow (React Flow). Champ ADDITIF,
  // rétro-compatible : un arbre sans `pos` retombe sur le layout dagre auto.
  // Colonne tree_json opaque côté backend -> survit au round-trip sans migration.
  pos?: { x: number; y: number }
}

// tree_json complet : `start` = id du nœud racine, `nodes` = table d'index.
// Les deux clés peuvent manquer sur un arbre dégradé/vide (le front retombe
// sur 'root' / {}).
export interface Tree {
  start?: string
  nodes?: Record<string, TreeNode>
  // Position (éditeur de workflow) du nœud sentinelle IA, qui n'a pas d'entrée
  // dans `nodes`. Clé additive, ignorée par le backend/widget (comme node.pos).
  aiPos?: { x: number; y: number }
}

// ============================================================================
// Apparence (design_json) — clés EXACTES de DEFAULT_DESIGN (models/bot.py).
// Un design stocké peut omettre n'importe quelle clé (rétro-compat : défauts
// appliqués au rendu), d'où tous les champs optionnels.
// ============================================================================

export interface DesignJson {
  title?: string
  primaryColor?: string
  // 2e couleur -> dégradé si définie ; explicitement nullable côté API.
  secondaryColor?: string | null
  position?: 'right' | 'left'
  size?: 'sm' | 'md' | 'lg'
  borderRadius?: number
  icon?: 'chat' | 'spark' | 'help' | 'bot' | 'message' | 'headset' | 'smile' | 'zap' | 'image'
  avatarImage?: string
  bordered?: boolean
  welcomeMessage?: string
  placeholder?: string
  loadingAnimation?: 'dots' | 'wave' | 'pulse' | 'bars' | 'ring' | 'typing'
  poweredBy?: boolean
  // --- Personnalisation étendue (lot apparence) ---
  font?: 'system' | 'serif' | 'mono'
  headerStyle?: 'solid' | 'soft' | 'gradient'
  darkMode?: boolean
  bubbleStyle?: 'rounded' | 'square'
  density?: 'cozy' | 'compact'
  launcherText?: string
  offsetX?: number
  offsetY?: number
  locale?: 'auto' | 'fr' | 'en'
  // --- Refonte Apparence (sous-onglets + maquette intégrale) ---
  // Toutes ces clés sont ADDITIVES et rétro-compatibles : le défaut de chacune
  // reproduit le rendu actuel du widget (aucun widget existant n'est modifié
  // tant que le client n'y touche pas). Parité OBLIGATOIRE : chaque clé est lue
  // par WidgetPreview ET widget/widget.js, et bornée par _sanitize_design
  // (api/src/routers/widget_helpers.py) + présente dans DEFAULT_DESIGN (bot.py).
  // Lanceur
  launcherShape?: 'round' | 'pill' | 'square'   // défaut 'round' (= cercle actuel)
  launcherAnimation?: 'none' | 'float' | 'pulse' // animation au repos, défaut 'none'
  greeting?: boolean                             // bulle d'accroche au-dessus du lanceur fermé
  greetingText?: string                          // texte de l'accroche (max 80)
  // Fenêtre
  windowWidth?: number                           // largeur du panneau px [300,560], défaut 338 (= largeur actuelle)
  windowHeight?: number | null                   // hauteur du panneau px [360,720] ; null = auto (selon densité)
  headerAvatar?: boolean                         // avatar dans l'en-tête, défaut true
  headerStatus?: boolean                         // ligne « En ligne » dans l'en-tête, défaut false
  statusLabel?: string                           // libellé du statut (max 60), défaut '' → « En ligne »
  textScale?: 'sm' | 'md' | 'lg'                 // taille du texte des messages, défaut 'md'
  timestamps?: boolean                           // horodatage des messages, défaut false
  openAnimation?: 'zoom' | 'fade' | 'slide' | 'pop' | 'flip' // animation d'ouverture, défaut 'zoom'
  bubbleTail?: boolean                           // ergot (coins asymétriques), défaut true
  // Thème
  chatBg?: 'plain' | 'soft' | 'pattern'          // fond de conversation, défaut 'plain'
  accentColor?: string | null                    // couleur dédiée des boutons, null = marque
  shadow?: number                                // intensité d'ombre de la fenêtre [0,3], défaut 2
  // Messages
  quickReplyStyle?: 'pill' | 'button'            // style des réponses rapides, défaut 'pill'
  sendStyle?: 'icon' | 'colored'                 // style du bouton d'envoi, défaut 'icon'
  sound?: boolean                                // son à la réception, défaut false
}

// ============================================================================
// Actions IA (actions_json) — telles que RENVOYÉES par BotOut.from_bot :
// les secrets (secret_encrypted/api_key_encrypted) ne sortent JAMAIS, seuls les
// flags secret_set / api_key_set sont ajoutés (posés sur TOUTES les actions).
// Les champs spécifiques dépendent de `type` (cf. _project_action).
// ============================================================================

export type BotActionType =
  | 'webhook'
  | 'capture_lead'
  | 'handoff'
  | 'create_ticket'
  | 'calendar_slots'

// Champ d'un webhook (type d'action 'webhook' uniquement).
export interface BotActionField {
  name: string
  type?: 'string' | 'number' | 'boolean'
  description?: string
  required?: boolean
}

export interface BotAction {
  name: string
  description: string
  type: BotActionType
  // 'webhook'
  url?: string
  fields?: BotActionField[]
  // 'create_ticket' (null = envoi aux admins)
  to_email?: string | null
  // 'calendar_slots'
  event_type_id?: number
  timezone?: string
  // Flags posés en SORTIE sur toutes les actions (jamais renvoyés au PATCH).
  secret_set?: boolean
  api_key_set?: boolean
}

// ============================================================================
// Connecteur MCP (mcp_servers_json) — RENVOYÉ par BotOut.from_bot : le jeton
// (auth_token_encrypted) ne sort jamais, seul le flag auth_token_set existe.
// ============================================================================

export interface McpServer {
  name: string
  url: string
  auth_token_set?: boolean
}

// ============================================================================
// Déclencheurs proactifs (triggers_json) — clés validées par _check_triggers.
// value selon type : time_on_page = secondes, scroll_depth = %, url_pattern =
// motif ; exit_intent est sans value.
// ============================================================================

export type TriggerType = 'time_on_page' | 'scroll_depth' | 'exit_intent' | 'url_pattern'

export interface Trigger {
  type: TriggerType
  // number pour time_on_page/scroll_depth, string pour url_pattern, absent pour
  // exit_intent. Le front tolère '' transitoirement (saisie) avant validation.
  value?: number | string
  message: string
  // Peut être absent du JSON stocké -> le front retombe sur true.
  once_per_session?: boolean
}

// ============================================================================
// Intégration (GET /api/bots/{id}/embed -> { public_key, integrations: [...] })
// ============================================================================

export interface Integration {
  id: string
  label: string
  icon: string
  description: string
  snippet: string
}

// ============================================================================
// Bot — forme complète renvoyée par GET /api/bots/{id} (schéma BotOut).
// snake_case, exactement les clés de models/bot.py::BotOut.
// ============================================================================

export type BotScope = 'personal' | 'team'
export type BotMode = 'tree' | 'ai' | 'hybrid'
export type AiProvider = 'anthropic' | 'openai' | 'gemini'
export type ApiKeyMode = 'managed' | 'byok'
export type CaptchaProvider = 'turnstile' | 'recaptcha_v3' | 'disabled'

export interface Bot {
  id: number
  // Ownership polymorphe : exactement l'un des deux est renseigné (XOR SQL).
  organization_id: number | null
  owner_user_id: number | null
  scope: BotScope
  name: string
  public_key: string
  is_active: boolean
  mode: BotMode
  ai_provider: AiProvider
  ai_model: string
  system_prompt: string
  temperature: number // x100 (70 = 0.7)
  api_key_mode: ApiKeyMode
  byok_key_set: boolean
  tree_json: Tree
  design_json: DesignJson
  // null EXPLICITE = A/B désactivé.
  tree_variant_json: Tree | null
  ab_split_pct: number
  triggers_json: Trigger[]
  actions_json: BotAction[]
  // Masqué (null) pour les members sans la perm 'context' ; handoff_webhook_set
  // distingue « configuré » de « vide » dans ce cas.
  handoff_webhook_url: string | null
  handoff_webhook_set: boolean
  mcp_servers_json: McpServer[]
  allowed_domains: string[]
  captcha_provider: CaptchaProvider
  captcha_site_key: string | null
  captcha_secret_set: boolean
  created_at: string // ISO datetime
  updated_at: string // ISO datetime
  // Renseignés uniquement par les endpoints de liste (cards) ; 0 sur le détail.
  msgs_7d: number
  visitors_7d: number
  // État de facturation effectif du bot, exposé par GET /api/bots pour le badge.
  // 'trialing' (LEGACY résiduel — plus généré, traité comme actif) | 'active' (payé)
  // | 'past_due' (impayé en relance) | 'inactive' (paiement requis / annulé)
  // | 'suspended' (blocage admin — abus, widget coupé) | null (billing OFF — aucun badge).
  // INVARIANT billing OFF : null quand billing_enabled()==False (pas de gating).
  billing_status?: BotBillingStatus | null
  // Fin d'essai (epoch secondes) — champ LEGACY conservé pour les abonnements
  // 'trialing' résiduels. Plus d'essai généré ; null/absent sinon.
  trial_end?: number | null
}

// États de facturation d'un bot (cf. RÈGLES PRODUIT §4). null = billing OFF.
// 'trialing' conservé : statut LEGACY résiduel (plus généré, lu comme actif).
// 'suspended' : blocage admin d'un bot (abus) — widget coupé côté serveur.
export type BotBillingStatus = 'trialing' | 'active' | 'past_due' | 'inactive' | 'suspended'

// ============================================================================
// BotSummary — forme de la LISTE (GET /api/bots). C'est le MÊME schéma BotOut
// côté serveur : les cards n'utilisent qu'un sous-ensemble des clés, mais
// l'objet réel porte tous les champs de BotOut. On modélise donc le résumé
// comme un sous-ensemble de Bot pour rester strictement compatible avec
// l'objet renvoyé (et avec l'interface BotSummary existante de BotList.tsx).
// ============================================================================

export type BotSummary = Pick<
  Bot,
  | 'id'
  | 'name'
  | 'public_key'
  | 'is_active'
  | 'mode'
  | 'ai_provider'
  | 'allowed_domains'
  | 'design_json'
  | 'msgs_7d'
  | 'visitors_7d'
  | 'owner_user_id'
  | 'organization_id'
  | 'scope'
  // Champs de facturation pour le badge (null si billing OFF — cf. §4/§5).
  | 'billing_status'
  | 'trial_end'
>

// ============================================================================
// BotUpdate — corps PARTIEL du PATCH /api/bots/{id} (schéma BotUpdate). Tous
// les champs optionnels (envoi sélectif des onglets dirty). Les clés en clair
// (byok_key, captcha_secret, secret/api_key/auth_token dans les actions/MCP)
// ne sont JAMAIS renvoyées par l'API, seulement envoyées.
// ============================================================================

export interface BotUpdate {
  name?: string
  is_active?: boolean
  mode?: BotMode
  ai_provider?: AiProvider
  ai_model?: string
  system_prompt?: string
  temperature?: number
  api_key_mode?: ApiKeyMode
  byok_key?: string // en clair à l'entrée, chiffré au stockage
  tree_json?: Tree
  design_json?: DesignJson
  // null EXPLICITE = désactiver la variante A/B.
  tree_variant_json?: Tree | null
  ab_split_pct?: number
  triggers_json?: Trigger[]
  // À l'envoi, une action peut porter un secret/api_key en clair (write-only) ;
  // d'où l'élargissement des champs sensibles côté payload.
  actions_json?: Array<BotAction & { secret?: string; api_key?: string }>
  // "" = effacer.
  handoff_webhook_url?: string | null
  // auth_token en clair (write-only) à l'envoi.
  mcp_servers_json?: Array<Omit<McpServer, 'auth_token_set'> & { auth_token?: string }>
  allowed_domains?: string[]
  captcha_provider?: CaptchaProvider
  captcha_site_key?: string | null
  captcha_secret?: string // en clair à l'entrée, chiffré au stockage
}
