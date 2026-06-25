# Fonctionnalités d'un bot — inventaire complet

> Inventaire dérivé d'un audit du code (modèle `Bot`, routers, services, onglets dashboard,
> widget runtime). Les **valeurs/bornes** sont indiquées entre parenthèses ; les **défauts** en gras.
> Généré le 2026-06-20.

## Sommaire des catégories

1. [Mode de conversation & moteur IA](#1-mode-de-conversation--moteur-ia)
2. [Éditeur d'arbre de décision (TreeFlow) & A/B test](#2-éditeur-darbre-de-décision-treeflow--ab-test)
3. [Apparence / design du widget](#3-apparence--design-du-widget)
4. [Actions IA (tool-use)](#4-actions-ia-tool-use)
5. [Base de connaissances (RAG)](#5-base-de-connaissances-rag)
6. [Live chat / handoff conseiller & Inbox](#6-live-chat--handoff-conseiller--inbox)
7. [Triggers proactifs](#7-triggers-proactifs-ouverture-auto)
8. [Intégration (embed) & connecteur MCP](#8-intégration-embed--connecteur-mcp)
9. [Sécurité & anti-abus](#9-sécurité--anti-abus)
10. [Analytics, stats, insights & leads](#10-analytics-stats-insights--leads)
11. [Comportements runtime du widget](#11-comportements-runtime-du-widget-visiteur)
12. [Cycle de vie, gestion & permissions](#12-cycle-de-vie-gestion--permissions)

---

## 1. Mode de conversation & moteur IA

**Mode de conversation** (`mode`)
- `tree` — clics sur l'arbre uniquement, **zéro appel IA / zéro coût** ; texte libre renvoie vers l'arbre ; onglets IA & Actions masqués
- `ai` — texte libre direct, pas d'arbre, premier message = `welcomeMessage`
- **`hybrid`** (défaut) — arbre d'abord, bascule IA via l'option `__ai__` ou texte libre
- Pseudo-nœud **`__ai__`** = pont arbre→IA

**Moteur IA**
- **Provider** (`ai_provider`) : `anthropic` (défaut) | `openai` | `gemini`
- **Modèle** (`ai_model`), 4 cartes proposées : **Claude Haiku** (`claude-haiku-4-5`, défaut) | Claude Sonnet (`claude-sonnet-4-6`, *recommandé*) | GPT-4o mini (`gpt-4o-mini`) | Gemini Flash (`gemini-2.5-flash`)
- **Prompt système** (`system_prompt`) — textarea, verrouillé serveur (anti prompt-injection), enrichi au call-time (page_url, journey, consigne KB, consigne langue, consigne anti-markdown/anti-emoji)
- **Température** (`temperature`) — slider 0–100 (stocké ×100, **défaut 70 = 0.7**)
- **Mode de clé** (`api_key_mode`) : **`managed`** (clés du SaaS via env) | `byok` (clé client chiffrée Fernet, write-only, flag `byok_key_set`)
- **Limitations Gemini** : actions, `search_docs` (RAG) et MCP non branchés ; `thinkingBudget=0` forcé
- Paramètres fixes serveur : `max_tokens=1024`, timeout httpx 60 s, boucle tool-use bornée à 2 tours
- **Mode simulé `MOCK_AI`** : réponses déterministes + commandes `!action` / `!mcp` / `!search`
- Modèle config-time fixe (génération d'arbre & insights) = `claude-sonnet-4-6` (non exposé)

## 2. Éditeur d'arbre de décision (TreeFlow) & A/B test

**Structure & types** (`tree_json` = `start` + `nodes{message, options[{label, next}]}`)
- **5 types d'option/nœud** : **Question** (vert, extensible) | **IA** (`__ai__`, violet, feuille) | **Conseiller/handoff** (rouge) | **Action** (bleu : `lead` ou `appointment`) | **Lien** (gris, pointe vers un nœud existant)
- **Nœud lead** : champs `email`(*obligatoire*) / `phone` / `name` / `message` (défaut `[email, message]`)
- **Nœud appointment** : URL calendrier `https://` (≤500 chars)
- Détection auto du type, sélecteur de destination des liens, sécurité cycles/possession DFS

**Édition**
- Ajout branche racine (`+ Branche`), sous-réponse récursive (profondeur illimitée), changement de type, intitulé du bouton (`label`), message affiché (markdown léger), suppression + garbage-collect
- **Canvas** : orientation vertical/horizontal, pan (souris+tactile), zoom molette/boutons (**40 %–200 %**), légende, réinitialisation de vue

**Génération IA de l'arbre**
- Source : texte collé (min 50 chars) ou URL d'une page (source ≤20 000 chars)
- Modèle fixe `gemini-2.5-flash`, 4096 tokens, JSON forcé, prévisualisation sans sauvegarde
- Rate-limit **10 / 24 h** par propriétaire

**Export / import config JSON** (`CONFIG_FIELDS`) — exclut secrets, domaines, triggers, A/B, MCP

**A/B test d'arbre**
- Activer/désactiver la variante B, bascule de vue A/B
- `ab_split_pct` (slider **0–100 %**, sticky par conversation, 0 = pause)
- Validation structurelle de B (mêmes contraintes que l'arbre principal)
- Comparatif stats A vs B (conversations + CSAT)

**Validation arbre** : `nodes` non vide, `start` existant, message non vide, type connu, `next` valide, départ ≥1 option

## 3. Apparence / design du widget (`design_json`)

| Réglage | Valeurs / bornes |
|---|---|
| **Titre** (`title`) | texte ≤100, vide = nom du bot |
| **Couleur de marque** (`primaryColor`) | hex (palette 6 + libre), **#0d9488** |
| **Dégradé** (`secondaryColor`) | null (uni) ou 2e couleur (135°) |
| **Position** | **right** \| left |
| **Taille bulle** (`size`) | sm 48px \| **md 58px** \| lg 68px |
| **Arrondi** (`borderRadius`) | UI 4–24px, serveur 0–40px, **16** |
| **Icône** | **chat** \| spark \| help \| image |
| **Avatar** (`avatarImage`) | upload (PNG/JPEG/GIF/WebP, pas de SVG), restreint à `{API}/uploads/` |
| **Liseré** (`bordered`) | **false** \| true |
| **Texte lanceur** (`launcherText`) | ≤40 chars → pilule |
| **Marges** (`offsetX`/`offsetY`) | 0–120px, **18** |
| **Style en-tête** (`headerStyle`) | **solid** \| soft |
| **Mode sombre** (`darkMode`) | **false** \| true |
| **Style bulles** (`bubbleStyle`) | **rounded** \| square |
| **Densité** (`density`) | **cozy** \| compact |
| **Police** (`font`) | **system** (Public Sans) \| serif (Georgia) \| mono — *aucune police externe* |
| **Langue** (`locale`) | auto \| **fr** \| en |
| **Message d'accueil IA** (`welcomeMessage`) | ≤500 |
| **Placeholder** | ≤100 |
| **Animation chargement** | **dots** \| wave \| pulse |
| **« Propulsé par Chapote »** (`poweredBy`) | **true** \| false |
| **Thèmes/presets** | Menthe, Crépuscule, Nuit, Corail, Encre, Améthyste |

## 4. Actions IA (tool-use)

**5 types d'action** (max **5** par bot) :
- **`webhook`** — POST HTTPS signé HMAC-SHA256 (`X-Chapote-Signature`)
- **`capture_lead`** — enregistre un Lead + notifie les admins (schéma `email*`/name/phone/message)
- **`handoff`** — passe la main à un conseiller (idempotent)
- **`create_ticket`** — ticket par email (réf `TK-XXXXXXXX`, schéma `subject*`/`summary*`/email/name/phone)
- **`calendar_slots`** — créneaux Cal.com (7 jours, 40 max, hôte fixe `api.cal.com`)

**Champs d'une action** : `name` (`^[a-z][a-z0-9_]{0,63}$`, unique ; `search_docs` et préfixe `mcp_` interdits) · `description` (1–500) · `url` (https, ≤500) · `secret` HMAC (chiffré, write-only) · `fields[]` (max 8 : name/type `string|number|boolean`/description/required) · `to_email` · `event_type_id` · `timezone` (IANA, **Europe/Paris**) · `api_key` Cal.com (chiffré)

**Exécution & sécurité** : exposition des tools (format Anthropic/OpenAI), boucle bornée 2 tours, dispatch `search_docs`→`mcp_*`→actions, args ≤4000 / résultat ≤2000 chars, **anti-SSRF** (DNS unique, rejet IP privées, pinning anti DNS-rebinding, pas de redirect, timeout 10 s), héritage des secrets par nom, masquage en sortie (`secret_set`/`api_key_set`)

**4 modèles pré-remplis** : Suivi de commande, Magasin le plus proche, Demande de devis, Statut d'incident

## 5. Base de connaissances (RAG)

- **4 types de source** : Page web (url, ≤2 Mo) · Sitemap (≤30 pages, même host, anti-XXE) · Texte libre (≤200 k chars) · PDF (≤10 Mo / 100 pages, magic `%PDF-`, jamais persisté disque)
- **Plafonds** : 20 sources / 1000 extraits par bot
- **Chunking** : fenêtre glissante 800 chars, overlap 150, min 40
- **Embeddings** : fastembed/ONNX **100 % local**, modèle MiniLM multilingue 384 dims (pgvector)
- **Recherche hybride RRF** (k=60) : top 10 vectoriel (cosine/HNSW) + top 10 FTS (`french_unaccent`) → top 5 ; dégradation FTS seul si embeddings indispo
- **Injection IA** : outil `search_docs` exposé si `has_kb` (top 5, content ≤600, payload ≤2000)
- Ingestion asynchrone (statuts `pending`/`ready`/`error`, polling 4 s, zombie 30 min→error)
- CRUD sources, test de recherche sans crédit IA, suivi `page_count`/`chunk_count`, préparation même IA inactive

## 6. Live chat / handoff conseiller & Inbox

**Statuts de conversation** : `ai` → `human_requested` (À prendre) → `human` (En cours) → `closed` (Clôturée) ; horodatages `human_requested_at`/`human_taken_at`/`closed_at`

**Handoff** : `handoff_webhook_url` (payload Slack-compatible, non bloquant, masqué selon perm `context`) · notification email admins · 2 déclencheurs (nœud d'arbre / action IA) · idempotent + gardé SQL · rate-limit **3/h** · **timeout 15 min** → retour IA · re-demande après clôture

**Côté visiteur** : `POST /handoff`, messages d'attente/timeout/clôture, mode conseiller (jamais d'IA, label « Conseiller » anonyme), polling 2,5 s (backoff 429→10 s)

**Inbox staff** : liste paginée (max 200) avec compteur unread, dernier message, filtre par statut (Toutes/À prendre/En cours/Bot/Clôturées), refetch 5 s · transcript complet + CSAT · **prendre** / **répondre** (take implicite) / **clôturer** (gardés SQL) · resync sur 409 · alerte 15 min · **page Inbox transverse** (tous mes bots) avec pastilles « à prendre » · permission `inbox`

## 7. Triggers proactifs (ouverture auto)

- Max **5** triggers, **4 types** : `time_on_page` (1–600 s) · `scroll_depth` (1–100 %) · `exit_intent` (désactivé mobile) · `url_pattern` (sous-chaîne ou wildcard `*`, ≤200 chars)
- **Message proactif** (1–300 chars, bulle locale, **aucun appel serveur**)
- `once_per_session` (**défaut true**, dédup via sessionStorage `kc_triggers`)
- Évaluation 100 % côté client, 1 seul tir/page, désarmé si panneau ouvert/interagi, jamais en mode iframe
- CRUD UI ; non simulés dans l'aperçu

## 8. Intégration (embed) & connecteur MCP

**5 snippets d'embed** (perm `copy`) : HTML `<script>` · WordPress · Google Tag Manager · composant React (npm) · iframe (`/widget-frame`)
- `public_key` (`pk_…`, public, non secret) · route `widget.js` (cache 5 min) · mode inline · garde anti double-init · avertissements bot inactif / CSP Calendly

**Connecteur MCP** (max **2** serveurs)
- Champs : `name` (`^[a-z][a-z0-9_]{0,30}$`) · `url` (https) · `auth_token` Bearer (chiffré, write-only, hérité si name+url inchangés)
- Transport JSON-RPC 2.0 / HTTP POST (protocole `2025-03-26`, fallback SSE), découverte parallèle non bloquante, caches positif (300 s) / négatif (90 s)
- Outils exposés `mcp_<serveur>_<outil>` (cap **20**, desc ≤300, schema ≤2000), routage exact anti-fuite, sécurité `safe_post_json_read` ; ignoré sous Gemini

## 9. Sécurité & anti-abus

- **Domaines autorisés** (`allowed_domains`) — vérif Origin serveur, wildcard `*.exemple.fr`, vide = widget inutilisable, exception localhost en dev, vérif domaine parent en iframe
- **Captcha** (`captcha_provider`) : **turnstile** (clés SaaS) | recaptcha_v3 (clés client, score min 0.5) | disabled — vérifié 1× au handshake, fail-closed
- **Chiffrement Fernet** de tous les secrets (BYOK, captcha, MCP, actions, webhook)
- **JWT widget** éphémère (30 min, lié domaine+conversation, refresh < 10 min), revalidation du bot/org à chaque requête
- **Rate limiting** (Redis ZSET, fail-open) : messages 20/10 min/session · IP 100/min · auth 10/15 min · treegen 10/24 h · insights 3/24 h · lead 5/h · handoff 3/h · feedback 30/h · poll 60/min + 600/min/IP · conseiller 60/10 min
- Bornes : message ≤4000 chars, historique IA ≤20 messages · toggle `is_active` · CSP/nosniff sur /uploads · CORS widget ouvert vs dashboard strict · permission `security`

## 10. Analytics, stats, insights & leads

**Fenêtre** : 7/30/90 jours (borné 1–365)
- **KPI** : Conversations · Visiteurs uniques · Messages visiteurs · Réponses IA (+% sur messages) · Réponses arbre · Réponses IA aujourd'hui
- **Graphe journalier** (barres empilées IA/Arbre)
- **CSAT** : 👍 / 👎 / total / % positifs + jauge
- **Test A/B** : conversations + CSAT par variante, chip « % vers B » / « test arrêté »
- **Funnel d'arbre** : passages/nœud, sorties/abandons, taux de sortie, surlignage hot (>50 % & ≥5), split A/B, top 12 nœuds
- **Top 10 pages** d'ouverture
- **Conversations récentes** (Page / Mode TREE-IA-TREE→IA / nb messages / temps relatif / transcript dépliable)
- **Insights IA** (« questions sans réponse ») : clusters thème/count/exemples/bulle suggérée + CTA « pré-remplir dans l'arbre » (3/24 h)
- **Leads** : liste + total, champs date/email/nom/téléphone/message/source (Arbre/IA), **export CSV** anti-injection
- Growth : affectation A/B sticky, capture d'événements d'arbre

## 11. Comportements runtime du widget (visiteur)

- **Persistance de session** localStorage `kc_sess_<key>` (fenêtre **2 h**, 50 derniers messages), restauration du fil, réouverture auto, **reset** (↻)
- `visitor_id` persistant (`kc_vid`), parcours `journey` (10 pathnames max)
- Live chat (messages conseiller/attente/timeout/clôture, polling visibilité, arrêt silencieux 401/404)
- Formulaire de lead (validation email, confirmation), overlay rendez-vous (iframe Calendly/Cal.com whitelistés)
- Animation typing (dots/wave/pulse), **rendu markdown sûr** (gras/italique/lien http(s), anti-XSS), badge non-lu
- Lanceur bulle/pilule, ouverture/fermeture, mode INLINE plein écran
- Multilingue (auto/fr/en), session glissante (rotation JWT), retry 401 (1×), garde-fous anti-injection design

## 12. Cycle de vie, gestion & permissions

- **Création** : perso (`owner_user_id`) **XOR** équipe (`organization_id`), wizard 7 étapes + brouillon persistant
- **Activation** (`is_active`) : toggle, raccourcis, pastille de statut
- **Déplacement** perso → équipe (sens unique)
- **Config** : PATCH générique (perm par champ), export/import JSON, renommage inline
- **Suppression** définitive (purge conversations/messages, double confirmation)
- **Listes** : tous mes bots / par org / bot unique, page « Mes chatbots », badge d'appartenance, sélecteur en pilules
- **Permissions par bot** (`BOT_PERMS`, 6) : `copy` · `test` · `appearance` · `context` · `security` · `inbox` — mappées par champ (`FIELD_PERMS`), enforcement membre/admin/owner/superadmin, masquage des secrets en lecture, save bar avec dirty-tracking, vue admin, `GET /api/meta/permissions`
