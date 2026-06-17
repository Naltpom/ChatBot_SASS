# Bilan complet d'audit — ChatBot SaaS (branche `feat/suppression-plans`)

> Audit en lecture seule de la plateforme « Chapote » (ex-Kertios). Toutes les références sont en `fichier:ligne`. Le rapport synthétise les constats vérifiés de façon adversariale (cartographie + 15 tranches + duplication transverse).

---

## 1. Objectif & périmètre

Plateforme **SaaS multi-tenant** de chatbots **embarquables**, hybrides **arbre-de-décision + IA**. Cible : entreprises/agences (espaces « équipe ») **et** comptes solo (« perso »), qui veulent poser un widget de chat sur leur(s) site(s).

Valeur produit :
- **Widget vanilla zéro-dépendance** (`widget/widget.js`, 1189 l.) servi par l'API, embarquable en HTML/iframe/GTM/WordPress via une clé publique `pk_...`.
- **Config 100% pilotée par le dashboard**, exportable/importable en JSON versionnable (tree + design + IA).
- **Hybridation** : arbre (clics, illimité, coût ~nul) → bascule IA (texte libre) avec **RAG** (pgvector + FTS), **tool-use** (webhooks signés, capture_lead, MCP), **live-chat handoff**, A/B test d'arbre, triggers proactifs, parcours visiteur comme contexte IA, CSAT.
- **Sécurité widget** : origin whitelist par bot + captcha (Turnstile/reCAPTCHA) + JWT 30 min + rate limits + system prompt verrouillé. Positionnement **RGPD-friendly** (visiteur = UUID localStorage, IP jamais stockée).

**Point de bascule majeur de la branche** : le produit est désormais **100% gratuit**. Plans payants, quotas, cap quotidien et Stripe ont été retirés du runtime. Seul subsiste un **compteur d'affichage informatif** (`ai_replies_today`).

---

## 2. Architecture & stack

### Couches

| Couche | Détail |
|---|---|
| **Backend** | FastAPI + SQLAlchemy async + asyncpg, Pydantic v2. Lifespan lance `alembic upgrade head` au boot (`api/src/main.py:40-58`), advisory-lock Postgres pour le multi-worker. 9 routers montés en dur dans `main.py`. |
| **DB** | PostgreSQL 15 (`pgvector/pgvector:pg15`), extension `vector` pour le RAG (`kb_chunks vector(384)` + tsvector `french_unaccent`), port hôte 5433. |
| **Redis** | 7-alpine, backend des rate-limiters (repli mémoire fail-open → 1 worker si absent). |
| **Embeddings** | fastembed ONNX CPU (MiniLM multilingue 384 dims). |
| **Frontend** | React 18 + TypeScript + Vite (Bun), react-router-dom v6, lucide-react, port hôte 3001. |
| **Widget** | JS vanilla pur, servi sur `/widget.js` + page hôte `/widget-frame`. |
| **Providers IA** | Anthropic / OpenAI / Gemini en REST via httpx (pas de SDK), `MOCK_AI=true` en dev. |
| **Stripe** | httpx REST sans SDK, **service DORMANT/non câblé** (dead code). |
| **E2E** | Playwright (`e2e/`, 20 specs). |

### Double CORS (force de conception)
- CORS strict dashboard (`main.py:64-75`, origines = `APP_URL` + localhost en dev).
- Middleware `widget_cors` séparé (`main.py:78-103`) ouvrant le CORS **uniquement** pour `/api/widget` | `/widget.js` | `/uploads` — la vraie autorisation reste la **whitelist domaines par bot** + captcha + JWT.

### Modèle de données (points clés)
- **Appartenance polymorphe du Bot** : `owner_user_id` (perso) **XOR** `organization_id` (équipe), garanti en base par `CheckConstraint ck_bots_owner_xor_org` (`bot.py:90-95`). `BotOut.scope` dérivé `personal|team` (`bot.py:251-274`).
- **Permissions** : `Membership.permissions` = JSON `{bot_id: [perms]}`, `BOT_PERMS = [copy, test, appearance, context, security, inbox]` (`user.py:32`).
- Colonnes droppées par migration : `organizations.plan`, `bots.daily_ai_message_cap`.
- Secrets clients (BYOK, MCP, actions, reCAPTCHA, handoff) chiffrés **Fernet**, masqués en sortie via flags `*_set`.

### Parcours principaux
Inscription perso/entreprise → liste bots `GET /api/bots` (union perso + équipes, masquage par permission) → wizard + `BotPage` (onglets) → conversation widget (bootstrap → session → message tree gratuit / IA RAG+tool-use → feedback/lead) → live-chat handoff (Inbox) → analytics + insights → back-office superadmin.

---

## 3. État général & qualité du code

**Verdict synthétique : code sain, bien structuré et récemment refactorisé, avec une dette concentrée et identifiable.** La suppression des plans a été menée proprement côté runtime (aucun gating résiduel) ; il reste essentiellement du **code mort isolé** (Stripe, TreeBuilder), des **commentaires/wording trompeurs**, et de la **duplication back↔front faute de couche de contrat partagée**.

### Points forts vérifiés
- **Sécurité widget** : défense anti-XSS soignée (`textContent`/`img.src`/innerHTML limité à des constantes), whitelists et bornes (`safeColor`/`safeInt`) sur tout le design serveur, secrets chiffrés Fernet et masqués, CSP+nosniff sur `/uploads`, regex `pk_` stricte sur `/widget-frame` (`main.py:119`).
- **Appartenance polymorphe** bien modélisée (CheckConstraint en base, fusion propre dans `GET /api/bots`).
- **Découpages récents réussis** : `bots.py`/`bots_helpers.py`, `widget.py`/`widget_helpers.py` (cycle d'import cassé proprement, documenté), onglets `bot-tabs/`, `widget-preview/`.
- **`tree_engine.py` pur** (sans IO) séparé de `tree_generator.py` ; `mcp_client.py` au contrat « jamais d'exception sortante ».
- **Widget vanilla** : IIFE + `'use strict'`, zéro dépendance, sliding token bien géré.

---

## 4. Code mort

> **Résidus de plans/quotas/Stripe = bloc le plus important.** Tout est cohérent : aucun gating actif, mais ~280 l. de service Stripe orphelin + config dormante + colonnes jamais écrites.

### 4.1 Code mort à fort signal (confiance haute)

| Emplacement | Quoi | Confiance | Action |
|---|---|---|---|
| `api/src/services/stripe_service.py:1-219` | **Module Stripe entier orphelin** : aucun import nulle part (grep repo = 0). `price_id_for`/`plan_for_price` référencent encore les plans `starter/pro/agence` supprimés. | Haute | Supprimer le module **ou** l'acter formellement « parking lot » isolé. |
| `api/src/core/config.py:80-84` | 5 settings `STRIPE_*` consommés uniquement par le service mort (+ `.env.example`/docker-compose). | Haute | Supprimer avec le service. |
| `api/src/core/config.py:108-124` | Bloc Stripe « tout-ou-rien » dans `validate_production()` — garde-fou qui ne protège rien d'actif. | Haute | Supprimer (garder seulement la vérif JWT/ENCRYPTION). |
| `api/src/models/user.py:56` | `Organization.stripe_customer_id` (+ index) : aucun reader/writer applicatif. | Haute | Colonne morte ; conserver si Stripe « dormant » assumé, sinon migration de drop. |
| `api/src/routers/admin.py:43-46,92` | Agrégat `stripe_subscriptions` calculé et exposé : **zéro consommateur** (absent de `AdminStats` `AdminDashboard.tsx:9-17`). | Haute | Retirer le calcul + la clé JSON (la colonne `user.py:57` reste, non écrite → compteur toujours 0). |
| `app/src/components/TreeBuilder.tsx` (599 l.) | **Composant entier mort** : 0 import dans tout le repo (l'app monte `TreeFlow`). Embarque un texte 429 stale « par organisation ». | Haute | **Supprimer le fichier** + nettoyer commentaires renvoyant dessus (`StatsPanel.tsx:103`, `styles.css:256`). |
| `app/src/botConstants.ts:142-360` | `TREE_TEMPLATES` + interface `TreeTemplate` (~218 l., ~60% du fichier) : 0 consommateur. Commentaire `:140-141` « ≤10 bulles (plan free) ». | Haute | Supprimer la constante + l'interface + le commentaire « plan free ». |
| `api/src/services/crypto.py:39-43` | `mask_secret()` jamais appelée ; docstring `:40` annonce `sk-a***f3` jamais produit (retourne `"•••• configurée"`). | Haute | Supprimer la fonction (le front utilise des placeholders + flags `*_set`). |
| `app/src/styles.css:603-678` + `app/index.html:33` | **Bloc landing CSS mort** (`.landing`, `.l-*`, `.auth-*`, `.save-bar`, `.wiz-step*`, `.mode-card*`, `.tab-sep`, `@keyframes pulseDot`/`fadeUp`) + **2 polices Google inutiles** (Bricolage Grotesque, Instrument Serif). Login/Register/BotWizard = 100% inline. | Haute | Purger le CSS mort + retirer les 2 familles du `<link>` (2 requêtes police en moins au boot). |
| `app/src/styles.css:287-288` | Variantes `.meter.danger` / `.meter.h5` jamais invoquées (API de primitive). | Basse | Conserver (option d'API défendable). |

### 4.2 Code mort mineur / vocabulaire (regroupé)

- **Wording « cap/cape/quotas » trompeur** (comportement réel inchangé, mécanisme supprimé) : `widget.py:3,9,76`, `widget_helpers.py:47`, `usage_service.py:1-2` (commentaire « cap IA quotidien — protection cash-flow »), `conversation.py:80`, `action_executor.py:183`, `README.md:42-67`. → **Actualiser les commentaires/README.**
- **Vocabulaire plan/budget dans l'UI** : `AiTab.tsx:53-54` (« les plafonds protègent votre budget »), `IntegrationTab.tsx:88` (« IA décomptée »), `Landing.tsx:226` (« IA plafonnée par design »), commentaires `BotPage.tsx:238-239,253-254` (« 403 plan »). → **Reformuler en cohérence « 100% gratuit ».**
- **Exports/champs inutilisés** : `stats.py:6` (import `case` non utilisé, severity medium), `stats.py:115-116` (clés `tokens_in`/`tokens_out` renvoyées jamais lues), `widget-preview/shared.ts:17` (`LEAD_FIELD_KEYS` export superflu), `ui.tsx:41` (`export type Tone` jamais importé), `StatsPanel.tsx:71` (prop `orgId` jamais déstructurée mais calculée par `Analytics.tsx:162`), `AppearanceForm.tsx` (prop `compact` jamais passée — toutes ses branches mortes), `widget.js:98` (`state.unread` jamais lu), `widget.js:834` (valeurs de `LEAD_LABELS` jamais lues, seules les clés servent).

---

## 5. Duplication

### 5.1 Duplication transverse back↔front (cause racine commune : aucune couche de contrat partagée)

| Emplacements | Quoi | Factorisation proposée | Impact |
|---|---|---|---|
| `bots_helpers.py:60-68`, `security.py:147-166`, `utils/permissions.ts:21-45` | **Règle de permissions bot** réimplémentée en 2 langages (le commentaire `permissions.ts:6-8` reconnaît « À L'IDENTIQUE »). | Piloter l'UI par `membership.permissions` que l'API renvoie déjà ; test e2e anti-divergence. | **High** |
| `bots_helpers.py:26-48` (`FIELD_PERMS`), `BotPage.tsx:46-56` (`TAB_FIELDS`) | **Mapping champ→permission** aligné à la main, 2 sources de vérité. | Exposer `FIELD_PERMS` via l'API (ou `/api/meta`) ; à défaut test `keys(FIELD_PERMS) == fields(TAB_FIELDS)`. | **High** |
| `bot.py:209-256` (`BotOut`), `BotList.tsx:10-26`, `Analytics.tsx:19`, `BotPage.tsx` (`bot: any`) | **Contrat type Bot** retypé partiellement et **incohérent** (deux `BotSummary` divergents, reste en `any`). | Générer les types TS depuis l'OpenAPI (openapi-typescript) **ou** `src/types/bot.ts` unique. | **High** |
| `widget.js:834-835`, `shared.ts:17-20`, `TreeFlow.tsx:143`, `botConstants.ts:192-349`, `bots_helpers.py:108` | **Référentiel champs lead** (email/name/phone/message) triplé + défaut `['email','message']` répété ~10×. | Source unique exposée par l'API, consommée front+widget. | Medium |
| `ai_service.py:46/261-263`, `tree_generator.py:99-106`, `insights_service.py:100-107` | **Client Anthropic** dupliqué 3× (URL, headers `anthropic-version 2023-06-01`, gestion d'erreur, modèle). | `core/anthropic.py` : `call_messages(system, user, model, max_tokens)` partagé. | Medium |
| `botConstants.ts:12-15`, `tree_generator.py:19`, `insights_service.py:20`, `ai_service.py:46` | **Modèles IA en dur** front↔back **avec divergence** : `claude-sonnet-4-6` câblé en dur pour tree/insights (ignorent le choix utilisateur). | Centraliser les ids côté backend (settings), exposer `MODEL_OPTIONS` via l'API ; documenter que tree/insights utilisent un modèle fixe. | Medium |
| `Login.tsx:5-19`, `Register.tsx:15-29`, `BotPage.tsx:67-81`, `BotWizard.tsx:243-261` | **Hook responsive** `matchMedia` réimplémenté 4× (breakpoints 760 vs 860, query avec/sans espace). | `app/src/hooks/useMediaQuery(query)` (base = version BotWizard) + `useIsMobile(maxWidth=860)`. | Medium |
| `BotList.tsx:185-210`, `AdminDashboard.tsx:28-40`, `AdminUsers.tsx:28-47`, `Analytics.tsx:53-117`, `Inbox.tsx:23-71`, `BotPage.tsx:505` | **Boilerplate loading/error/retry** dupliqué sur 5-6 pages (pas de `hooks/`). | `useApiResource<T>(path, deps)` + `<ErrorRetry>`. | Medium |
| `InboxPanel.tsx:49-54`, `StatsPanel.tsx:63-64`, `Analytics.tsx:215`, `AdminUsers.tsx:21`, `Profile.tsx:11` | **Parsing UTC incohérent** : `new Date(iso+'Z')` (UTC) vs `new Date(iso)` (local) selon le composant → **bug de fuseau latent**. `timeAgo()` dupliqué identique. | `app/src/utils/time.ts` (`parseUtc`, `formatFr`, `minutesSince`, `timeAgo`, `pathnameOf`). | Medium |
| `bots.py:88-89`, `bots.py:151-152`, `admin.py:176-177` | Enrichissement `BotOut` stats hebdo (`msgs_7d`/`visitors_7d`) recopié 3×. | `attach_week_stats(bots, week)` partagé. | Low |
| `widget.py:556-558,596-598`, `inbox.py:215-217` | Validation longueur message (`MAX_MESSAGE_CHARS` → 413) dupliquée 3×. | Helper `_assert_message_len(text)`. | Low |
| `stats.py:47`, `admin.py:55-56`, `usage_service.py:56-57` | Whitelist sources visiteur (`role=='user'`, `source in ('ai','tree')`) dupliquée. | Constante `VISITOR_SOURCES` + helper filtre 7j. | Low |
| `Landing.tsx:224` vs `bots.py:428`/`main.py:126`/`widget.js:5` | **Snippet d'install incohérent** : la landing affiche `data-bot-id` (inexistant) + `chapote.com`, le réel = `data-bot-key` + `{API_URL}`. **Copier-coller non fonctionnel.** | Corriger la landing (`data-bot-key`) ; idéalement réutiliser le snippet de `GET /api/bots/{id}/embed`. | Low |
| `api.ts:22-23,52,67` | En-tête Bearer construit 3× (`postFile`/`uploadImage` hors logique 401→/login). | `authHeaders()` unique ou `uploadImage` délègue à `postFile`. | Low |

### 5.2 Duplication interne notable (par tranche)

- **Boucle tool-use IA dupliquée** `_call_anthropic` (`ai_service.py:227-327`) vs `_call_openai` (`330-420`) : ~190 l. quasi identiques (assemblage tools, boucle `MAX_TOOL_TURNS`, dispatch `search_docs`/`mcp_`/`_run_action`, comptage tokens). → Boucle générique + adaptateur par provider. **Réduit ~190 l. → ~90 + 2 adaptateurs.**
- **Revalidation bot+org par session** copiée-collée 5× dans `widget.py` (`331-338`, `385-392`, `422-429`, `483-490`, `526-529`) — avec une **5e variante incohérente** (cf. §6). → Helper `_session_active_bot(db, request, session)`.
- **Transition de statut gardée** (UPDATE conditionnel + rollback + re-check idempotent) répétée 3× dans `inbox.py` (`181-193`, `224-234`, `263-274`). → `_guarded_transition(...)`.
- **CRUD listes JSON** (actions/mcp/triggers) recopié dans `BotPage.tsx:402-494` + ré-indexation des secrets dupliquée (`410-420`/`457-468`). → `listUpdate/listRemove/listAdd` + `reindexAfterRemove`.
- **Interface `Integration`** triplée à l'identique (`BotPage.tsx:58`, `BotList.tsx:28`, `IntegrationTab.tsx:6`).
- **`_bad()` / `_trunc()` / `require_*`** : helpers internes redéfinis (bots_helpers `110/243/275`, action_executor `99-101`/`175-177`, security `123/134/147/166`).
- **Pinning SSRF + montage SNI/Host** réécrit 3× dans `safe_fetch.py` (`74/106/142`).
- **`newNodeId`/`gc`/`setNodeType`** dupliqués TreeBuilder↔TreeFlow (résorbés par la suppression de TreeBuilder).
- **Rotation JWT widget** (`if resp.refresh_token`) répétée 5× dans `widget.js` (698/751/846/855/932) ; retry-401 dupliqué 3× (762/859/936).

---

## 6. Refacto prioritaire (trié par impact)

| Emplacement | Problème | Suggestion | Impact |
|---|---|---|---|
| `widget.py:526-529` vs `331-489` | **INCOHÉRENCE DE SÉCURITÉ** : `post_message` revalide `bot.is_active` mais **PAS la suspension d'org** (contrairement à lead/feedback/handoff/poll). Un bot d'équipe dont l'org est suspendue **continue d'accepter `/message` et de consommer de l'IA réelle**. Message d'erreur divergent (`Widget désactivé` vs `Widget inconnu ou désactivé`). | Aligner `post_message` sur les autres via `_session_active_bot`. **Correctif de comportement, pas qu'un nettoyage.** | **High** |
| `ai_service.py:227-420` | `_call_anthropic`/`_call_openai` mélangent 6 responsabilités (tools, transport, décodage, boucle, dispatch, tokens). | Boucle tool-use générique + adaptateurs provider (cf. §5.2). | **High** |
| `BotPage.tsx:83-935` (935 l.) | Composant géant : Apparence (`:601`) et Arbre (`:721`) restent **inline** alors que les autres onglets sont extraits. | Extraire `AppearanceTab`/`TreeTab` + hook `useBotEditor(botId)` (dirty-tracking + `save()`). | **High** |
| `Landing.tsx:269-527` (528 l.) | Une seule fonction : header/hero/piliers/comparatif/install/pricing/témoignages/CTA/footer + data + styles inline. | Sous-composants `components/landing/*` + module data. | Medium |
| `admin.py:29-97` (`admin_stats`) | ~70 l. mêlant comptages, agrégat Stripe **mort**, messages 7j, calendrier 6 mois. | Extraire `_last_n_months`/`_signups_by_month`, **supprimer le bloc Stripe**. | Medium |
| `bots.py:300-322` (`import_config`) | `config: dict[str,Any]` brut → contraintes Pydantic de `BotUpdate` (mode/temperature/ai_provider) **non appliquées** ; seul `tree_json` validé. Un import peut écrire des valeurs hors bornes. | Valider les scalaires via `BotUpdate(**{...}).model_dump(exclude_unset=True)` avant `setattr`. | Medium |
| `bots.py:181-253` (`update_bot`) | ~72 l. : nettoyage null NOT NULL, perms par champ, validation tree/triggers, normalisation handoff, chiffrement secrets, merge actions/mcp. | Décomposer en helpers (`_strip_notnull_nulls`, `_enforce_field_perms`, `_normalize_handoff_url`, `_apply_secrets`). | Medium |
| `action_executor.py:118,197` | `asyncio.create_task(send_email(...))` **fire-and-forget non référencé** : GC peut collecter la task, exceptions avalées silencieusement. | Garder une référence + `add_done_callback` de log, ou `BackgroundTasks`. | Medium |
| `widget.py:517-663` (`post_message`, ~147 l.) | 4 responsabilités (live-chat, closed→ai, arbre, IA + historique + KB) + validation message dupliquée. | `_handle_human_message`/`_handle_tree_node`/`_handle_ai_message` + `_build_ai_history`. | Medium |
| `uploads.py:29-32` | `file.read()` charge tout en mémoire **avant** le contrôle de taille (413 après lecture). | Vérifier `UploadFile.size` ou lire par chunks avec coupe-circuit. | Low |
| `auth_service.py:55-56` | `except Exception: pass` silencieux sur le parsing `response.json()`. | Restreindre à `ValueError`/`JSONDecodeError` + log debug. | Medium (norm) |
| `kb_service.py:218-298` / `153-213` | `ingest_source` (~80 l.) et `_extract` (cascade + sitemap récursif) mêlent extraction/chunking/cap/embeddings/SQL. | Extraire `_build_rows`/`_extract_sitemap`. | Medium |
| `StatsPanel.tsx:134-399` (~400 l.) | JSX monolithique (3 fetch + KPIs + graphe + CSAT + A/B + funnel + top pages + table conv). | Sous-composants `SatisfactionCard`/`AbTestCard`/`FunnelCard`/`RecentConversationsTable`. | Medium |
| `Analytics.tsx:47-240` | 3 responsabilités (liste/sélecteur + détail + leads/CSV) + `as any` sur l'export CSV (`:104`). | Extraire `LeadsSection` ; indexer via `keyof LeadRow`. | Medium |

---

## 7. Structure & organisation

**Backend** — découpage routers/services/helpers globalement net. Points à corriger :
- **Frontière router/service hétérogène** : agrégations stats moitié dans `stats.py` (`bot_stats`/`funnel`), moitié dans `usage_service.py` ; logique métier org (« dernier admin » 3× dans `orgs.py`, consommation d'invitations dans `auth.py`) reste dans les routers. → Envisager `services/stats_service.py` + `services/org_service.py`.
- `stats.py` n'utilise **pas** `_get_accessible_bot`/`_check_bot_perm` (réimplémente l'accès `:27-30,143-146,199-202`, sans permission fine) — divergence **délibérée et documentée** (`inbox.py:3-6` : « stats.py reste INTOUCHÉ »), à documenter aussi dans `stats.py`.
- Schémas Pydantic dispersés (certains dans `models/`, d'autres inline dans les routers ; **doublon de nom `OrgPatch`** `admin.py:24` vs `orgs.py:31` aux sémantiques divergentes).
- Imports locaux redondants (`admin.py:105` re-importe `Message` déjà importé `:18` ; `bots.py:260` re-importe `Message` déjà importé `:25`).

**Frontend** — **deux dossiers transverses manquants**, cause racine de la duplication :
- **`app/src/hooks/` absent** → `useMediaQuery` ×4, boilerplate loading/error/retry ×5.
- **`app/src/types/` absent** → `BotSummary` défini dans une **page** (`BotList.tsx:10`) puis importé par Admin/Team/Inbox et redéfini par Analytics ; `Integration` triplé ; `Tree`/`TreeNode` redéfinis ; `bot: any` partout.
- `utils/` existe (`csv.ts`, `permissions.ts`) mais n'accueille ni `time.ts` ni `date.ts` alors que helpers date/initiales/URL sont éparpillés.
- **Deux régimes de styling non documentés** : classes `styles.css` (BotPage, panels) vs 100% inline avec charte locale (Login/Register/BotWizard/Landing) — ce qui rend mortes les classes auth/wizard/landing **et** duplique tokens de charte + icônes (`HatIcon`/`BrandMark`/`Check`).

**Cause racine transverse** : **monorepo 4 surfaces sans couche de contrat partagée** (pas de génération de types depuis l'OpenAPI, pas de package de schémas commun). Chaque contrat back↔front (BotOut, réponses auth, permissions, champs lead, modèles IA, snippet) est retapé à la main et **dérive en silence**.

**Triple implémentation du rendu widget** (assumée mais fragile) : widget réel (`widget.js`, source de vérité) ↔ aperçu React (`widget-preview/*` + `PREVIEW_I18N`, dont `WidgetPreview.tsx:20-23` dit « toute divergence avec widget.js est un bug de parité ») ↔ copy démo. Parité maintenue à la main.

---

## 8. Normes par langage

### Python
| Règle | Constats | Attendu |
|---|---|---|
| `datetime.utcnow()` déprécié (3.12) | **~16 occurrences** : `inbox.py:185,228,238,262` ; `widget.py:234,242,278,562,656` ; `auth_service.py:87,100,109` ; `email_service.py:118,125` ; `bots.py:384` ; `kb.py` ; `models/*` (`user.py:46,58,71,83`, `bot.py:168-169`, `conversation.py:59,60,89`, `kb.py:44,60`, `lead.py:27`, `analytics.py:34,44`). Incohérent : `usage_service.py:7,17` et `admin.py:36,121` utilisent déjà `now(timezone.utc)`. | `datetime.now(timezone.utc)` partout (ou helper `utcnow()` / mixin `TimestampMixin`). **À traiter globalement.** |
| `except` trop large | `auth_service.py:55-56` (`pass` muet, **medium**), `bots_helpers.py:156-159`, `action_executor.py:213`, `widget_helpers.py:301`, `kb_service.py:148,290`. | Restreindre au type attendu + log. `mcp_client.py:327` justifié (contrat). |
| Import inutilisé | `stats.py:6` (`case`, **medium**). | Retirer. |
| Type hints manquants | `bots_helpers.py:51,60,64,73` (`membership` non typé), `ai_service.py:227,330,423` (helpers provider non annotés, **medium**), `action_executor.py:65,85,122,149,247,295`, `email_service.py`, `kb_service.py:319`, `uploads.py:24`. | Annoter (`Membership | None`, `Bot`, `AsyncSession`). |
| Pydantic v2 | `class Config: from_attributes` (style v1) dans 8 schémas Out (`bot.py:248`, `analytics.py:56`, `conversation.py:106,118`, `kb.py:76`, `lead.py:43`, `user.py:113,127`) + `config.py:126`. | `model_config = ConfigDict(from_attributes=True)` + base `ORMModel`. |
| `config.py:128` | `extra = "allow"` sur `Settings` → variables d'env inconnues **silencieusement absorbées** (typos masqués). | `extra = "ignore"` ou `"forbid"` (**medium**). |
| Default mutable Pydantic | `user.py:99,111,125` (`= []`/`= {}`). | `Field(default_factory=...)`. |
| `Optional[...]` vs `X | None` | Style mixte (`Optional` côté config/models, `dict[...]`/`list[...]` modernes ailleurs). | Uniformiser sur `X | None`. |

### TypeScript / TSX
| Règle | Constats | Attendu |
|---|---|---|
| `any` explicite/implicite (**high** sur BotPage) | `bot: any` sur les 5 onglets (`AiTab:10`, `HumanTab:7`, `ActionsTab:27`, `IntegrationTab:12`, `SecurityTab:12`) + `useState<any>` BotPage ; `(a:any)`/`(s:any)` dans les `.map` ; `tree:any`/`design: Record<string,any>` (TreeFlow `36-37`, WidgetPreview `88-90`, AppearanceForm) ; `api<T=any>` (`api.ts:20`) propage `any` dans les réponses auth (`AuthContext.tsx:73-99`, **medium**) ; `catch (err: any)` répété (Login `69`, Register `153`, Profile `50,67`, AdminDashboard `32`, AdminUsers `32`, Analytics `73,85,96`, Inbox `47`). | Interfaces partagées `Bot`/`Tree`/`TreeNode`/`DesignJson`/`AuthResponse` ; `catch (err: unknown)` + narrowing. |
| `key={i}` instable | Listes éditables/réordonnables : `BotPage:637`, `ActionsTab:98,160,286`, `BotWizard:512`, `TreeFlow:413-522`, `WidgetPreview:374,387-388` (**medium**). | Clé stable (id/`opt.next`). Append-only toléré. |
| Hook deps (exhaustive-deps) | `Admin.tsx:116` / `Team.tsx:75` (`useEffect(reload, [...])` avec `reload` recréé, **medium**). | `useCallback` ou définir dans l'effet. |
| `as` / non-null évitables | Footer Landing `510-513` (`as string`/`as string[][]`), `Analytics.tsx:104` (`as any`), `Register.tsx:123` (clé string libre), `m.items!` (`Landing.tsx:199`). | Types explicites / union discriminée. |
| Accessibilité | `SecurityTab.tsx:137` (`<div onClick>` captcha sans `role=radio`/clavier), `<a href="#">` non navigables (Login `215`, Landing `292,506-508`). | `<button>`/`role=radio` + `aria-checked` ; `<Link>` ou `<button>`. |

> **Note ES6 (TS) :** côté **frontend React/TS**, `const`/`let` sont déjà la norme — pas de `var`. Le sujet `var` concerne **uniquement le widget vanilla** (cf. ci-dessous).

### CSS
- **Tokens contournés** (severity low, sauf indiqué) : `#1C3F5C` en dur (`styles.css:92,413`) au lieu de `var(--acc)` ; `#F4F6F8` répété 3× (`:91,120,170`) → token `--hover-bg` ; mint `rgba(47,158,121,...)` en littéral à opacités multiples (`:21,22,55,360,374`) avec écriture incohérente (espaces ou non).
- **Doublons de valeurs** : `--go-soft`/`--go-bd` (`:24,25`) identiques à `--acc-soft`/`--acc-bd` (`:21,22`).
- `.infobox.info` (`:293`) utilise `rgba(14,116,144,.2)` (cyan) alors que `--info=#2563EB` (bleu) — **medium**, incohérence de teinte.
- `!important` sur classes **mortes** (`.shadow-lg`/`.shadow-md` `:662-663`) — disparaît avec la purge landing.
- Nommage hétérogène (`.bot-card-head` vs `.nm`/`.ck`/`.dm`) nuisant à la grepabilité.

### HTML
- **Propre dans l'ensemble.** Incohérences mineures de casse entre `index.html` et `maintenance.html` : `charset` (`UTF-8` vs `utf-8`), `viewport` (`initial-scale=1.0` vs `1`).
- `demo/index.html:8-10` : palette Tailwind slate/amber sans rapport avec la charte (acceptable pour une page de démo jetable).
- `maintenance.html` : accessibilité de base correcte (`lang=fr`, `<h1>` unique, SVG `aria-hidden`, `prefers-reduced-motion`).

### JS widget (`widget/widget.js`)
| Règle | Constat | Attendu |
|---|---|---|
| **`var` → `const`/`let` (ES6)** | **100% du fichier en `var`** (grep `const|let` = 0) : `state` `:98`, `BOT_KEY`, `SVG`/`SIZES`/`FONTS`/`I18N`/`LEAD_*`, tous les compteurs de boucle. | `const` pour les non-réassignés, `let` pour le reste (block-scope, intention). **Medium.** |
| Callbacks `function` vs arrow | `then`/`catch`/`forEach` tous en `function(e){...}` (ex. `:696,699,872`). | Arrow functions pour les callbacks courts (cohérent avec le passage ES6). Low. |
| Catch muet | Seul `.catch(function(){})` non commenté = `sendNodeSilent` `:977` (les autres sont justifiés). | Ajouter un commentaire « best-effort ». Low. |
| **Sécurité** | **Conforme** : `innerHTML` uniquement avec constantes SVG/i18n ; données serveur via `textContent`/`img.src` ; pas de `postMessage`; valeurs CSS toutes bornées (`safeColor`/`safeInt`/whitelist anim `:658`). **Aucun XSS détecté.** | RAS. |

---

## 9. Plan d'action priorisé

### Quick wins (gain rapide, faible risque)

| # | Action | Effort | Ce que ça rapporte |
|---|---|---|---|
| 1 | **Supprimer `TreeBuilder.tsx`** + commentaires renvoyant dessus | S | −599 l. de dette, lève ~5 duplications avec TreeFlow |
| 2 | **Supprimer `TREE_TEMPLATES`/`TreeTemplate`** (`botConstants.ts:142-360`) + commentaire « plan free » | S | −218 l. (~60% du fichier) |
| 3 | **Purger le CSS landing mort + 2 polices Google** (`styles.css:603-678`, `index.html:33`) | S | −55 l. CSS, **2 requêtes police en moins au boot** |
| 4 | **Retirer l'agrégat Stripe** d'`admin_stats` (`admin.py:43-46,92`) + `import case` inutilisé (`stats.py:6`) + `mask_secret()` (`crypto.py`) | S | Code mort visible supprimé |
| 5 | **Corriger le snippet d'install Landing** (`data-bot-id` → `data-bot-key`) | S | **Copier-coller prospect fonctionnel** |
| 6 | **Actualiser le wording** plan/quota/cap/budget (commentaires + `AiTab`/`IntegrationTab`/`Landing` + README) | S | Cohérence « 100% gratuit », ne trompe plus un nouvel arrivant |
| 7 | **`config.py:128` `extra="allow"` → `"ignore"`** | S | Détecte les typos de settings |
| 8 | Créer `app/src/utils/time.ts` (`parseUtc`/`timeAgo`/`pathnameOf`) et brancher les composants | M | **Élimine le bug de fuseau latent** + dédup `timeAgo` |

### Chantiers (plus lourds)

| # | Action | Effort | Ce que ça rapporte |
|---|---|---|---|
| A | **Corriger l'incohérence sécurité `/message`** (`widget.py:526-529`) : revalider la suspension d'org via `_session_active_bot` (résorbe aussi la duplication ×5) | M | **Ferme une faille** : un bot d'org suspendue consomme de l'IA réelle |
| B | **Décision produit Stripe** : supprimer `stripe_service.py` + 5 settings `STRIPE_*` + bloc `validate_production` + colonnes `stripe_*` (migration) **ou** acter « parking lot » | M | ~280 l. mortes + config dormante levées |
| C | **Couche de contrat front** : `app/src/types/` (génération openapi-typescript ou `bot.ts` unique) + `app/src/hooks/` (`useMediaQuery`, `useApiResource`) | L | **Tue la cause racine** des duplications back↔front + `any` |
| D | **Factoriser la boucle tool-use IA** (`ai_service.py:227-420`) : adaptateur par provider + boucle générique | M | −~190 l., corrige le risque de dérive single-path |
| E | **Extraire `AppearanceTab`/`TreeTab` + `useBotEditor`** de `BotPage.tsx` (935 l.) | L | Ramène BotPage à un orchestrateur, testabilité |
| F | **Mutualiser les permissions/FIELD_PERMS** : exposer via l'API + tests e2e anti-divergence | M | Élimine 2 sources de vérité high-impact |
| G | **`core/anthropic.py`** partagé (URL/headers/modèle) + centraliser `MODEL_OPTIONS` côté backend | M | Dédup ×3 + clarifie le modèle fixe tree/insights |
| H | **`services/stats_service.py` + `services/org_service.py`** : sortir agrégations stats et règles « dernier admin »/invitations des routers | M | Frontière router/service nette, source unique |
| I | **`fire-and-forget` emails** (`action_executor.py:118,197`) : référence + `done_callback` | S→M | Plus de tasks GC-collectées ni d'exceptions avalées |
| J | **Validation `import_config`** via `BotUpdate` (`bots.py:300-322`) | S→M | Aligne les deux chemins d'écriture, bloque les valeurs hors bornes |

---

## Verdict

Le code est **mûr et propre pour un SaaS de cette taille** : sécurité widget solide, modèle de données cohérent (appartenance polymorphe en base), et plusieurs refactos récentes réussies. La suppression des plans a été exécutée **proprement côté runtime** — il n'y a **aucun gating résiduel**, seulement du **code mort isolé** (Stripe ~280 l., TreeBuilder 599 l., TREE_TEMPLATES 218 l., CSS landing) et du **vocabulaire/commentaires trompeurs** faciles à nettoyer en quick wins. Deux items méritent une attention immédiate : l'**incohérence de sécurité sur `/message`** (un bot d'org suspendue continue de consommer de l'IA — chantier A) et la **décision produit Stripe** (chantier B). La dette de fond est structurelle et unique : **l'absence de couche de contrat partagée back↔front** (types, permissions, modèles IA, champs lead, snippet), qui génère la quasi-totalité des duplications transverses et du `any` côté front — c'est le chantier C qui offre le meilleur retour à moyen terme. Aucun bug bloquant, aucune faille XSS dans le widget ; le reste est de la qualité de vie (normes `datetime`/Pydantic v2 côté Python, `any`/`key` côté TS, `var`→`const/let` dans le widget).