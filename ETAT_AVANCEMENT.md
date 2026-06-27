# État d'avancement — Chapote.fr (ChatBot SaaS)

> **Audit du 2026-06-27** — état des lieux du code, lecture seule, destiné à quelqu'un qui découvre le projet.
> Méthode : 12 auditeurs lecture-seule (un par sous-système), chaque affirmation adossée à un `fichier:ligne`.
> Légende statut : ✅ fait (vrai code fonctionnel) · 🟡 partiel · 🧪 stub/mock · ⛔ absent.
>
> ⚠️ **L'inventaire §1–§7 décrit le CODE. Les §1–§7 ont d'abord été écrits à partir de `.env.example` (défauts dev).** La **§8bis** ci-dessous confronte les bloquants à la **PROD RÉELLE** (VPS `51.75.28.98`, vérifié par SSH le 2026-06-27) : plusieurs « bloquants » sont en fait **déjà résolus en prod**. Lire §8bis avant de conclure.

---

## 1. Ce qu'est le projet

Plateforme **SaaS multi-tenant** de chatbots **embarquables**, **hybrides arbre-de-décision + IA**. Un client crée un ou plusieurs bots, les personnalise (arbre à clics, apparence, IA, connaissances, actions), récupère une clé publique `pk_…` et colle une balise `<script>` (ou installe le plugin WordPress). Le visiteur discute avec un widget qui mêle menus à clics et réponses IA, avec relais humain possible. Facturation Stripe **modulaire** self-serve (palier IA + add-ons à la carte). Selon l'historique projet, **Stripe est en LIVE sur chapote.fr depuis le 2026-06-25**.

Ordre de grandeur : **~18 200 LOC Python** (backend) · **~19 600 LOC TS/React** (dashboard) · **1 584 LOC** widget vanilla · **~30 tables** · **32 migrations** · **13 suites pytest** + **28 specs Playwright**.

---

## 2. Stack réelle (vérifiée, pas supposée)

| Couche | Techno réelle | Preuve |
|---|---|---|
| **API** | FastAPI + SQLAlchemy 2.0 **async** + asyncpg, Pydantic v2 | `api/requirements.txt`, `api/src/main.py` |
| **Base** | PostgreSQL 15 + **pgvector** (`vector(384)`) + **unaccent**/FTS french | `api/alembic/versions/2026_06_12_e2c624608aa0_*`, `..._f4a91c27d3b8_*` |
| **Cache/rate-limit/jobs** | Redis (ZSET sliding-window, store jobs, compteurs quota) | `api/src/services/rate_limit.py`, `tree_jobs.py` |
| **Embeddings** | **fastembed** (ONNX CPU, 100 % local, modèle MiniLM multilingue ~240 Mo) | `api/src/services/embeddings.py`, `.env.example:118` |
| **Auth** | JWT HS256 (python-jose), bcrypt (passlib), 2FA TOTP (pyotp) + WebAuthn (py_webauthn) | `api/src/core/security.py`, `twofa_service.py` |
| **Dashboard** | React 18 + Vite 5 + TypeScript 5, **runtime Bun**, React Router 6 | `app/package.json` |
| **Éditeur d'arbre** | **@xyflow/react** (React Flow) + dagre, type n8n, chargé en `lazy()` | `app/src/components/tree-editor/*` |
| **Widget** | JavaScript **vanilla, zéro dépendance** | `widget/widget.js` |
| **Plugin WP** | PHP (9 classes), proxy REST chiffré AES-256-GCM | `integrations/wordpress/chapote-chatbot/**` |
| **Paiement** | Stripe via **REST httpx maison** (jamais le SDK), webhooks HMAC vérifiés à la main | `api/src/services/stripe_service.py` |
| **Providers IA** | Anthropic (`claude`), OpenAI, Gemini (`gemini-2.5-flash`) — voir nuances §4 | `api/src/services/ai_service.py`, `api/src/core/anthropic.py` |
| **E2E** | Playwright | `e2e/` |
| **Conteneurs/CI** | Docker Compose (dev + prod), GitHub Actions = **déploiement manuel SSH uniquement** | `docker-compose*.yml`, `.github/workflows/deploy.yml` |

---

## 3. Architecture (schéma texte)

```
                          NAVIGATEUR VISITEUR                      NAVIGATEUR CLIENT/ADMIN
                                  │                                        │
                  <script src=widget.js data-bot-key=pk_…>      Dashboard React (Bun/Vite)
                                  │                              app/src : 24 pages, TreeFlow,
                       widget.js (vanilla, 1584 LOC)            AppearanceForm, Inbox, Billing…
            bulle/iframe · handshake captcha→JWT 30min ·                  │
            chat tree+IA · live-chat (poll 2,5s) · triggers              │  JWT dashboard 24h
                                  │                                        │
   ┌──────────────────────────────┴───────────────┬────────────────────────┴───────────────┐
   │              /api/widget/*                    │            /api/* (auth, bots, kb,       │
   │   (public, scope JWT widget, origin+captcha   │   inbox, billing, stats, orgs, tree…)    │
   │    +rate-limit)                               │                                          │
   └──────────────────────────────┬───────────────┴──────────┬───────────────────────────────┘
                                  ▼                          ▼
                         FastAPI (api/src)                Plugin WordPress  ──OAuth PKCE──▶ /api/oauth/*
   routers/ (21) · services/ (28) · core/ (security, triggers, anthropic, config) · models/ (11)
                                  │
        ┌─────────────┬───────────┼─────────────┬───────────────┬──────────────────┐
        ▼             ▼           ▼             ▼               ▼                  ▼
   PostgreSQL 15   Redis      fastembed     Providers IA      Stripe          SMTP / Webhooks
   +pgvector      (cache,     (embeddings   (Anthropic/        (REST httpx,    (leads, tickets,
   +FTS unaccent  ratelimit,  RAG local)    OpenAI/Gemini)     Billing Meters) handoff Slack/Teams)
   ~30 tables     jobs)                      + Cal.com (slots) + Brave/SIRENE (prospection)
```

**Flux clé (réponse widget)** : `widget.js` → `POST /api/widget/session` (captcha→JWT) → `POST /api/widget/message` → si nœud `__ai__` : précheck quota → `generate_reply()` (provider + tools `search_docs`/actions/MCP) → consume quota / overage métré → persiste `Message` → renvoie au widget (mode dégradé tree-only si panne/quota).

---

## 4. Inventaire des features (statut + preuve)

### 4.1 Socle « bot en arbre »
| Feature | Statut | Preuve |
|---|---|---|
| Moteur d'arbre serveur (validation + sanitisation défensive multi-couches) | ✅ | `api/src/services/tree_engine.py:37-117`, `models/bot.py:30-48` |
| Éditeur visuel React Flow (type n8n, positions/courbures persistées, undo/redo, copier-coller) | ✅ | `app/src/components/tree-editor/TreeFlowCanvas.tsx`, `treeGraph.ts` |
| Génération d'arbre par IA (Gemini réel via httpx + jobs SSE) | ✅ | `api/src/services/tree_generator.py:132-204`, `tree_jobs.py`, `routers/tree.py` |
| Personnalisation apparence (~50 clés) + aperçu live fidèle au widget | ✅ | `models/bot.py:53-105`, `AppearanceForm.tsx`, `WidgetPreview.tsx` |
| Déclencheurs proactifs (délai / scroll / exit-intent / url, max 5) | ✅ | `api/src/core/triggers.py`, `widget/widget.js:1474-1543` |

⚠️ **Nuance** : la génération d'arbre par IA est câblée **en dur à Gemini**, indépendamment de `bot.ai_provider` → exige `GEMINI_API_KEY` côté serveur même pour un bot Anthropic.

### 4.2 Paliers IA, métrage, BYOK
| Feature | Statut | Preuve |
|---|---|---|
| Paliers IA Starter/Growth/Scale (19€/1000, 39€/3000, 89€/10000) + quota mensuel | ✅ | `api/scripts/seed_billing_catalog.py:59-69`, `entitlement_service.py:326` |
| Métrage des réponses IA (compteur Redis fail-closed, repli COUNT SQL sur `Message`) | ✅ | `quota_service.py:129-165`, `usage_service.py:56` |
| Overage facturé via **Stripe Billing Meters** (0,015 €/réponse, plafond, pré-check) | ✅ | `stripe_service.py:613-685`, `quota_service.py:291` |
| BYOK (clé client chiffrée Fernet, illimité, **jamais métré**) | ✅ | `ai_service.py:73`, `entitlement_service.py:150` |
| Multi-provider Anthropic / OpenAI / **Gemini** | 🟡 | `ai_service.py:162/373/439` |

⚠️ **Gemini = chat texte seulement** : `_call_gemini` fait un vrai appel HTTP mais **le function-calling n'est pas branché** → `actions_json`, `search_docs` (RAG) et MCP sont silencieusement ignorés (`ai_service.py:445`, juste un `logger.info`). Un bot Gemini qui paie Actions/RAG/MCP ne les exécute **jamais**. Anthropic et OpenAI sont, eux, complets (boucle tool-use).

### 4.3 Connaissances / RAG
| Feature | Statut | Preuve |
|---|---|---|
| Indexation pages web (fetch httpx anti-SSRF + parse) | ✅ | `kb_service.py:225`, `safe_fetch.py:113` |
| Sitemap (gère l'index WordPress/Yoast, cap 30 pages) | ✅ | `kb_service.py:96-211` |
| Ingestion PDF (pypdf, magic-byte, cap 10 Mo/100 p.) | ✅ | `kb_service.py:142-156`, `routers/kb.py:98-128` |
| FAQ / saisie manuelle | 🟡 | `routers/kb.py:81` — implémenté comme **« texte libre »** chunké, pas un éditeur Q/R structuré |
| Embeddings locaux fastembed (384 dim, dégrade en FTS-seul si modèle KO) | ✅ | `embeddings.py:30-80` |
| Recherche **hybride** (cosine HNSW + FTS, fusion RRF) | ✅ | `kb_service.py:352-384` |
| Retrieval **branché au chat** (tool `search_docs` réinjecté dans la boucle) | ✅ | `ai_actions.py:138`, `ai_service.py:266` — **sauf Gemini** (inerte) |

### 4.4 Live chat / Inbox
| Feature | Statut | Preuve |
|---|---|---|
| Liste des conversations (filtre statut, unread, dernier message) | ✅ | `routers/inbox.py:83-168`, `InboxPanel.tsx` |
| Prise de relais humaine (IA mise en pause, transitions SQL gardées multi-worker) | ✅ | `inbox.py:193-221`, `widget.py:569-592` |
| Messages conseiller→visiteur (anonymat staff « Conseiller ») | ✅ | `inbox.py:224-262`, `widget/widget.js:1052-1080` |
| Transport temps réel | ✅ | **Polling DB** assumé (widget 2,5 s / dashboard 5 s) — **pas de WebSocket/SSE** (`widget.py:13`) |
| Notification visiteur en attente (email + webhook Slack/Teams + badge) | ✅ | `widget.py:376-389`, `Inbox.tsx:45-56` |

⚠️ Retour auto à l'IA après 15 min évalué **paresseusement** (pas de cron) → conversations « zombies » nettoyées par le staff. Notif out-of-band 100 % dépendante d'email/webhook (fallback log silencieux si SMTP absent).

### 4.5 Module Actions + Module MCP
| Feature | Statut | Preuve |
|---|---|---|
| Webhooks sortants (httpx réel, HMAC, anti-SSRF, no-redirect) | ✅ | `action_executor.py:342-406` |
| Capture de leads (IA + formulaire arbre → table `leads`) | ✅ | `action_executor.py:118-133`, `widget.py:412`, `models/lead.py` |
| Création de tickets | 🟡 | `action_executor.py:195` — **email + trace transcript seulement, pas de table tickets** |
| Prise de créneaux (Cal.com) | 🟡 | `action_executor.py:294` — **LECTURE des dispos seulement, aucune réservation/booking** |
| Function-calling IA (Anthropic + OpenAI, boucle bornée `MAX_TOOL_TURNS=2`) | ✅ | `ai_actions.py:80`, `ai_service.py:254-434` |
| MCP (client JSON-RPC maison, découverte + appel, cache, anti-SSRF) | ✅ | `mcp_client.py:178-330`, `ai_service.py:307` |
| Handoff conseiller (action IA → inbox) | ✅ | `action_executor.py:152-188` |

⚠️ SSRF solide et factorisée (`safe_fetch`) sur webhooks/MCP/Cal.com. Mais **Gemini ne déclenche aucune action/MCP** (cf. §4.2).

### 4.6 Facturation / abonnements Stripe
| Feature | Statut | Preuve |
|---|---|---|
| Catalogue Products/Prices **piloté en base** + seedé chez Stripe | ✅ | `seed_billing_catalog.py`, `models/billing.py:149`, `admin_billing.py:366` |
| Stripe Checkout hébergé | ✅ | `stripe_service.py:126-218`, `billing.py:829` |
| Webhooks (signature HMAC vérifiée maison, idempotence, anti-régression d'ordre) | ✅ | `stripe_service.py:688-719`, `billing.py:1749-1958` |
| Upgrade/downgrade (proration immédiate / retrait différé via Subscription Schedules) | ✅ | `billing.py:938-1183`, `stripe_service.py:250-410` |
| Coupons / remise intro 1er mois (duration:once) | ✅ | `stripe_service.py:591`, `billing.py:793-895` |
| Entitlements + enforcement (`gate()` → 402, `BILLING_ENFORCE`) | ✅ | `entitlement_service.py:134-242`, branché bots/kb/inbox/widget |
| Statut bot unifié (writer unique `set_bot_status` + journal + suspended collant) | ✅ | `entitlement_service.py:155-474`, `models/billing.py:75-118` |
| Overage IA métré | ✅ | `stripe_service.py:613-685` |

⚠️ **Dépendance webhook** : l'activation passe par `customer.subscription.created/updated/deleted` — `checkout.session.completed` n'est qu'un ACK loggé. Mal configurer l'abonnement d'events côté Stripe ⇒ bots payés non activés (rattrapage via `reconcile` manuel). Remboursement prorata 14 j (B2C) **non implémenté**. Dérive doc Stripe (cf. §7).

### 4.7 Widget, embed, WordPress, OAuth
| Feature | Statut | Preuve |
|---|---|---|
| `widget.js` (snippet `<script>`+`data-bot-key`, handshake, chat tree+IA+live, persistance 2 h, anti-XSS, mode dégradé) | ✅ | `widget/widget.js`, `routers/widget.py:203-295` |
| Clés publiques `pk_` (origin whitelist + captcha + rate-limit) | ✅ | `widget_helpers.py:50-109` |
| Plugin WP v1 « embed simple » | ⛔ | **dossier `chapote-chatbot/` absent du repo** — capacité d'embed reprise par le plugin v2 (`class-chapote-bo-frontend.php`) ; README v1 périmé |
| Plugin WP v2 « back-office dans WP » (proxy REST chiffré, ciblage pages, SPA 1081 LOC) | ✅ | `chapote-chatbot/**`, `class-chapote-bo-rest.php`, `-crypto.php` |
| OAuth « Se connecter avec Chapote » | ✅ | `oauth_service.py`, `routers/external/oauth.py` |
| API compte externe `/api/account/*` | ✅ | `routers/external/account.py:131-336` |
| Auto-update plugin + readiness WordPress.org (zips bâtis par `deploy.sh`) | ✅ | `class-chapote-bo-updater.php`, `deploy.sh:24-135` |

🛑 **Correction factuelle importante** : l'OAuth **n'est PAS un device flow RFC 8628**. C'est un **Authorization Code + PKCE/S256 (RFC 7636)** par redirection navigateur vers un écran de consentement (`app/src/pages/Authorize.tsx`). Aucun `device_code`/`user_code` nulle part. Le label « device flow RFC 8628 » est un vestige (`core/security.py:265` + mémoire projet). Sécurité réelle solide (codes/refresh hachés SHA-256, `redirect_uri` borné à la page admin du plugin, rotation refresh + révocation de lignée, state CSRF).

### 4.8 Auth, sécurité, multi-tenant
| Feature | Statut | Preuve |
|---|---|---|
| Auth email/mdp + JWT (bcrypt, scopes distincts, intranet-first) | ✅ | `auth.py:158`, `security.py:35-136` |
| Google SSO (JWKS RS256 réel, audience/iss/email_verified) | ✅ | `google_oauth.py:32-79` |
| 2FA TOTP (pyotp, secret Fernet) + WebAuthn/passkeys (anti-rejeu sign_count) | ✅ | `twofa_service.py`, `twofa.py` |
| Session widget JWT 30 min glissante (re-handshake transparent) | ✅ | `security.py:91-110`, `widget_helpers.py:447` |
| Captcha handshake (Turnstile/reCAPTCHA/off) | 🟡 | `captcha.py:23-45` — **fail-open** si `TURNSTILE_SECRET_KEY` absente |
| Whitelist Origin par bot (fail-closed, wildcard, mode iframe) | ✅ | `widget_helpers.py:50-156` |
| Rate-limits session/IP (Redis ZSET, repli mémoire) | ✅ | `rate_limit.py:114-209` |
| Isolation multi-tenant | ✅ | `security.py:163-262` — **100 % applicative**, gardes `require_*_access`, 404 anti-énumération |

⚠️ **Faiblesses sécu réelles** : (a) captcha widget **fail-open** sans clé Turnstile (or non posée en prod d'après la mémoire) ; (b) **aucun rate-limit sur les endpoints de 2nd facteur 2FA** + challenge token rejouable → brute-force TOTP possible une fois le mot de passe connu ; (c) isolation tenant **sans RLS Postgres** → sûreté dépendante de l'appel manuel des gardes sur chaque future route ; (d) JWT dashboard stateless **sans révocation** (changement mdp / 2FA n'invalide pas les tokens émis).

### 4.9 Analytics, A/B, white-label, multi-bot, démo, prospection
| Feature | Statut | Preuve |
|---|---|---|
| Analytics CNIL (UUID anonyme localStorage, **pas d'IP stockée**, agrégations SQL) | ✅ | `widget.js:56-72`, `stats_service.py:24-122` |
| Insights IA (questions sans réponse, clusters, bulles suggérées) | ✅ | `insights_service.py:88-121` |
| A/B testing d'arbre (split sticky + funnel/CSAT par variante) | ✅ | `widget.py:248-267`, `stats_service.py:161-218`, `AbTestCard.tsx` |
| White-label | 🟡 | retrait du badge « Propulsé par » ✅ (`MODULE_WHITELABEL`) — **domaine custom ⛔** (doc Palier futur) |
| Multi-bot par compte (perso XOR équipe, illimité) | ✅ | `models/bot.py:112-126` (CheckConstraint XOR) |
| Démo publique `/demo` (1 URL → bot, cache DB, anti-abus en couches, chat IA borné) | ✅ | `demo_service.py:44-242`, `public.py:75-227` — **dormante (404)** sans Turnstile en prod |
| Prospection autonome (SIRENE + Brave + crawl BS4 + scoring/rédaction Claude few-shot) | ✅ | `prospecting_service.py`, `admin_prospecting.py` |

⚠️ Conformité CNIL = revendication juridique (visitor_id « strictement nécessaire ») non matérialisée par du code (pas de bannière). « White-label » est la seule **sur-promesse** potentielle (≠ marque blanche complète).

---

## 5. État de la base de données

- **32 fichiers de migration** (30 DDL + 2 merges), chaîne **linéaire à HEAD unique** = `d3e4f5a6b7c8` (bot_status_history). Test CI garde-fou `test_alembic_single_head.py`.
- **~30 tables**, schéma sain : auth/multi-tenant (`users`, `organizations`, `memberships`, `webauthn_credentials`), `bots` (ownership polymorphe XOR), `conversations`/`messages` (cycle live-chat + CSAT + variante A/B), RAG (`kb_sources`, `kb_chunks` avec `vector(384)` HNSW + `tsv` GIN), billing complet (`bot_entitlements`, `billing_subscriptions`, `billing_products`, `billing_webhook_events`, `bot_usage_counters`, `bot_status_history`), OAuth plugin (`oauth_authorization_codes`, `oauth_tokens`, `billing_wordpress_links`), prospection (`prospects`, `prospecting_profiles`), `leads`, `tree_events`, `insights_reports`, `demo_generations`.
- Les **2 épisodes « 2 heads »** (prospection+2FA, démo+prospecting) ont été **résolus** par migrations de merge réelles.
- **pgvector utilisé en vraie base** (pas applicatif). Migration auto au démarrage sous `pg_advisory_lock` (multi-worker safe).

🟡 **Angle mort** : `api/alembic/env.py:26-33` **n'importe pas** les modèles `prospect` ni `oauth` → un futur `alembic revision --autogenerate` proposerait de **DROP** ces tables. Plus : `embedding`/`tsv` mal compris d'Alembic (bruit autogenerate à relire). Timestamps tous **naïfs** (convention `utcnow()`).

---

## 6. Tests & CI

**Backend (13 suites pytest)** — solide sur la **facturation** (8 fichiers : enforcement, entitlements, grouping, metering, **webhook HMAC réel**, sécurité owner-matrix, statut), l'**arbre** (sources, sanitizer, jobs SSE) et la **démo publique** (cache, quotas, captcha, chat V2). Plus `quota_period_utc` et `alembic_single_head`.

**E2E (28 specs Playwright)** — large : auth/register, orgs/permissions (parité), widget (nav, typewriter, lead/RDV), **inbox live** (handoff→take/reply/close→CSAT), A/B, actions/triggers (UI), appearance, savebar, billing (catalog-parity, checkout-return, degradation, grouping, owner-gating, suspend).

🛑 **Trous critiques** :
- **La CI ne lance AUCUN test.** Le seul workflow GitHub (`deploy.yml`) est un bouton manuel `workflow_dispatch` → SSH → `deploy.sh` (git pull + build + up). Pas de gate pré-merge (ni pytest, ni Playwright, ni lint backend). Seul `tsc` mord, et seulement au build de l'image prod. — **HIGH**
- **Tous les tests backend tournent sur `FakeSession`** (fausse `AsyncSession` en mémoire) → **zéro test sur vraie DB / migrations appliquées / pgvector / contraintes FK**. — **HIGH**
- **`MOCK_AI` partout** → le **chemin de réponse IA réel (Gemini/Anthropic) n'a aucune couverture**. — **HIGH**
- **Auth & 2FA non testées** (`get_current_user` toujours overridé). Prospection non testée. RAG : seul le gating est testé, l'ingestion réelle est neutralisée. — **HIGH/MEDIUM**
- **`pytest`/`pytest-asyncio` absents de `requirements.txt`**, aucun `pytest.ini`/`pyproject` (`asyncio_mode`) → suite non rejouable dans une image propre. — **HIGH**

> Note : la mémoire projet mentionne « 146 pytest verts / e2e device flow OAuth » (PR #29) ; ces tests OAuth/account/widget **ne sont pas présents** sur la branche courante.

---

## 7. Dette technique

**Bonne nouvelle** : code **remarquablement propre** des marqueurs classiques — **0 TODO/FIXME/HACK/NotImplementedError** dans `api/src` et `app/src`, **0 `print(`** debug, **0 `console.log`**, **aucun secret en dur** committé (seul `.env.example` suivi), gardes `validate_production()` sur JWT/ENCRYPTION_KEY/Stripe. Les `MOCK_*` sont des chemins de simulation **intentionnels et gatés**, pas des stubs morts. ~16 `as any`/`eslint-disable` front, tous bénins.

**Dettes notables (par sévérité)** :

| Sév. | Dette | Fichier |
|---|---|---|
| 🔴 HIGH | **`MOCK_AI=True` par défaut SANS garde prod** (contrairement à `MOCK_BILLING`) → un déploiement qui oublie `MOCK_AI=false` sert `[MOCK_AI] Réponse simulée` aux clients payants, sans alerte | `config.py:26` + `validate_production` |
| 🔴 HIGH | **SSRF résiduelle** : `fetch_page_text()` (chemin URL de `POST /tree/generate`) fait un GET brut **sans `safe_fetch`** (suit les redirections, pas de rejet d'IP privée) | `tree_generator.py:111-129` |
| 🔴 HIGH | **CI sans tests** (cf. §6) | `.github/workflows/deploy.yml` |
| 🟠 MED | **Gemini : function-calling absent** → Actions/RAG/MCP inopérants sur ce provider (facturés mais inertes) | `ai_service.py:445` |
| 🟠 MED | **Pas de rate-limit sur le 2nd facteur 2FA** + challenge rejouable → brute-force TOTP | `twofa.py:264-326` |
| 🟠 MED | **Isolation tenant sans RLS** (filet DB absent) | `security.py:163-262` |
| 🟠 MED | `env.py` oublie `prospect`/`oauth` → autogenerate destructeur | `alembic/env.py:26-33` |
| 🟠 MED | `crypto.py` génère une clé Fernet **éphémère** si `ENCRYPTION_KEY` absente → secrets BYOK/2FA perdus au restart (gardé en prod seulement) | `crypto.py:18` |
| 🟠 MED | **Dérive documentaire** : `docs/STRIPE_SETUP.md` (ancien catalogue ai_free / mod_actions 19€), `docs/PLUGIN_DISTRIBUTION.md` (v2.0.0 vs 2.1.0 réel), `integrations/wordpress/README.md` (décrit un plugin v1 absent) | docs/ |
| 🟢 LOW | Polling DB inbox (pas de WS), `MAX_TOOL_TURNS=2` (pas de chaînage agentique), garde d'ordre webhook O(n), état `MOCK_AI` exposé sur `/health` | divers |

> **Working tree** : propre au moment de l'audit (branche `feat/wp-plugin-check`, dernier commit `2ce7e44` « plugin passe le Plugin Check officiel »). Le résidu `.orgtest`/fichier updater supprimé vu en début d'audit a été **résolu** par le merge PR #30.

---

## 8. Ce qui bloque une mise en prod / un premier client payant (priorité)

> Contexte : la prod **tourne déjà** (Stripe LIVE). Ces points sont les **risques d'exploitation** d'un premier client payant qui passe le parcours complet.

1. **🔴 `MOCK_AI=false` non garanti** — pas de garde-fou de démarrage. Si oublié, **tous les bots répondent du faux texte** sans erreur. → ajouter une garde symétrique dans `validate_production()`.
2. **🔴 Turnstile non posé en prod** — captcha widget **fail-open** (no-op anti-bot/anti-coût) et **démo `/demo` dormante (404)**. → poser `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.
3. **🔴 SMTP non configuré** — leads, tickets et handoffs tombent en **simple log** (valeur métier « lead reçu par email » perdue). → poser `SMTP_*` ou garantir un `handoff_webhook_url`.
4. **🔴 Aucune gate de tests en CI** — une régression atteint chapote.fr sans qu'aucun test ne tourne, et les chemins critiques (IA réelle, auth/2FA, DB réelle) ne sont pas couverts. → CI minimale `pytest` (après avoir déclaré `pytest` + config asyncio).
5. **🟠 Sécurité ciblée** — SSRF `fetch_page_text` → aligner sur `safe_fetch` ; rate-limit + single-use sur le 2nd facteur 2FA ; test de parité « toute route `/bots|/orgs` appelle une garde » (filet anti-fuite multi-tenant).
6. **🟠 Cohérence offre ↔ Gemini** — ne pas vendre Actions/RAG/MCP sur un bot Gemini tant que le function-calling n'est pas branché (ou le brancher).
7. **🟠 Stripe** — vérifier que les events `customer.subscription.*` sont abonnés (sinon activation muette) ; remboursement prorata 14 j B2C non implémenté ; corriger la dérive doc avant tout seed/rotation de prix.
8. **🟠 Ops Postgres/embeddings** — extensions `vector`/`unaccent` créables ; volume `fastembed` **persistant** ; `env.py` à compléter avant tout `--autogenerate`.

---

## 8bis. Vérification sur la PROD RÉELLE (SSH `ubuntu@51.75.28.98`, 2026-06-27)

> Confrontation des bloquants §8 à l'état **réellement déployé** (`ENV=production`, branche `master` à `f6e6e23`).
> Source : `.env` prod (secrets masqués), `/health`, `docker ps`, requêtes DB lecture seule.

**Conteneurs** : `chatbot-api` (Up, **healthy**, 2 workers), `chatbot-app` (nginx), `chatbot-db` (Postgres, up 9 j), `chatbot-redis` (up 12 j). `MAINTENANCE_MODE=off`. `/health` → `{"status":"ok","mock_ai":false}`.

| Bloquant §8 | Hypothèse audit (depuis `.env.example`) | **Réalité prod vérifiée** | Verdict |
|---|---|---|---|
| **MOCK_AI** | `True` par défaut, pas de garde → risque de réponses bidon | `MOCK_AI=false` + `/health` le confirme | ✅ **OK en prod** (risque latent : toujours pas de garde-fou de démarrage) |
| **Turnstile** | non posé → captcha fail-open + démo 404 | `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` **posés** ; site-key `0x4AAAAAADrlw…` **bakée dans le bundle** front (fallback compose) | ✅ **RÉSOLU** — captcha actif, **démo `/demo` LIVE (200) et fonctionnelle** |
| **SMTP** | non posé → leads/tickets/handoff en log | **aucune ligne `SMTP_*`** dans le `.env` prod | 🔴 **CONFIRMÉ** — emails (leads/tickets/handoff/prospection) **non envoyés**, log seulement |
| **Stripe** | LIVE (mémoire) | `STRIPE_SECRET_KEY=rk_live_…` (restricted ✅), webhook posé, `MOCK_BILLING=false` | ✅ **LIVE** |
| **BILLING_ENFORCE** | ambigu (doc dit `false`, code dit `True`) | absent du `.env` → défaut code **`True`** + billing actif → gating 402 réel | ✅ **ENFORCEMENT ACTIF** |
| **Overage IA métré** | « done » | `BILLING_METERING_ENABLED=false` (posé explicitement) | 🟡 **DÉSACTIVÉ en prod** — pipeline bâti mais **dormant**, les bots bloquent au quota (pas d'overage facturé) |
| **Migrations** | head unique `d3e4f5a6b7c8` (code) | `alembic_version` prod = **`d3e4f5a6b7c8`** | ✅ **À JOUR**, identique au code |
| **Providers IA** | 3 déclarés | Anthropic ✅ + Gemini ✅ posés ; **OpenAI vide** | ⚠️ pas de bot provider OpenAI possible en prod |
| **Rate-limit/proxy** | caveat `TRUSTED_PROXY_IPS` | `TRUSTED_PROXY_IPS=127.0.0.1`, Redis healthy, 2 workers | ⚠️ à vérifier que l'IP du reverse-proxy = loopback (sinon rate-limit IP effondré) |

**État métier de la base (prod)** : `bots=2` · `users=3` · `organizations=1` · `conversations=29` · `prospects=16` · `leads=0` · `bot_entitlements=2` · **`billing_subscriptions=0`**.
→ L'infra est **LIVE et correctement configurée**, mais **aucun abonnement payant n'existe encore** (`subs=0`) : le « premier client payant » est toujours devant.

**Conséquence sur les priorités §8** : les bloquants **#1 (MOCK_AI)** et **#2 (Turnstile/démo)** sont **déjà réglés en prod** (restent des risques *latents* de config). Le seul bloquant produit **réel et actif** est **#3 SMTP** (un lead capté n'est pas notifié par email). Les bloquants **#4 (CI sans tests), #5 (SSRF), #6 (2FA/RLS)** sont de niveau **code** et donc **inchangés** par la config prod. À ajouter : **réactiver `BILLING_METERING_ENABLED`** si l'on veut facturer l'overage IA (sinon offre « au quota » seulement).

---

## RÉSUMÉ EXÉCUTIF

Chapote est un SaaS **réellement construit, pas un scaffold** : ~85 % global. Le **cœur produit est à ~90 %** (arbre+éditeur n8n, IA multi-provider, RAG hybride pgvector branché au chat, live-chat, actions/MCP, facturation Stripe modulaire LIVE, analytics CNIL, démo 1-URL, prospection autonome) — du vrai code, des appels réseau réels, une sécurité widget et une base de données soignées. Le retard est concentré sur le **durcissement d'exploitation (~55 %)** : `MOCK_AI` sans garde-fou, Turnstile/SMTP non posés, **CI sans aucun test** et couverture aveugle sur l'IA réelle / l'auth / la vraie DB, plus quelques failles sécu ciblées (SSRF, brute-force 2FA, pas de RLS). Trois sur-promesses à cadrer : **Gemini n'exécute ni actions/RAG/MCP**, le **« white-label » se limite au retrait du badge**, l'**OAuth plugin est PKCE et non device-flow** (libellé à corriger).
**3 prochaines étapes logiques** : ① poser les 3 interrupteurs d'exploitation (garde `MOCK_AI=false`, Turnstile, SMTP) ; ② brancher une CI qui lance `pytest` (après l'avoir déclaré) + premiers tests réels sur DB/auth/IA ; ③ durcissements sécu ciblés (SSRF `fetch_page_text`, rate-limit 2FA, test de parité des gardes tenant) et décision produit sur Gemini.

---

## CONTEXTE POUR CLAUDE

```
PROJET : Chapote.fr — SaaS multi-tenant de chatbots embarquables hybrides ARBRE-DE-DÉCISION + IA.
Repo : C:\www\kertios\ChatBot_SASS. Prod LIVE sur chapote.fr (Stripe LIVE depuis 2026-06-25).

STACK RÉELLE :
- Backend api/ : FastAPI + SQLAlchemy 2.0 async + asyncpg + PostgreSQL 15 (+pgvector vector(384) +FTS unaccent).
  Redis (rate-limit ZSET, jobs, quota). ~18,2k LOC. 21 routers, 28 services, 11 models, 32 migrations alembic.
- Frontend app/ : React 18 + Vite 5 + TS, runtime BUN. ~19,6k LOC, 24 pages. Éditeur d'arbre @xyflow/react (n8n).
- widget/widget.js : 1584 LOC vanilla zéro-dep (embed <script data-bot-key=pk_…>, handshake captcha→JWT 30min).
- integrations/wordpress/chapote-chatbot : plugin WP v2 PHP (proxy REST chiffré AES-256-GCM, OAuth PKCE).
- Embeddings : fastembed local (ONNX CPU, MiniLM 384). IA : Anthropic + OpenAI (complets) + Gemini-2.5-flash.
- Stripe via REST httpx maison (pas de SDK), webhooks HMAC vérifiés à la main, catalogue piloté en base.
- CI = .github/workflows/deploy.yml : bouton manuel SSH → deploy.sh (git pull+build+up). AUCUN test en CI.

FEATURES FAITES (✅ vrai code) : arbre+éditeur visuel+génération IA(Gemini)+apparence+triggers ; paliers IA
Starter/Growth/Scale + métrage Redis + overage Billing Meters + BYOK chiffré illimité ; RAG hybride
(web/sitemap/pdf/texte → pgvector+FTS, retrieval branché au chat via tool search_docs) ; inbox live-chat
(polling DB, transitions SQL gardées, anonymat staff) ; actions (webhook httpx/HMAC, capture lead, handoff)
+ MCP (client JSON-RPC maison) + function-calling Anthropic/OpenAI ; Stripe complet (checkout hébergé,
webhooks idempotents, upgrade/downgrade proration+schedules, coupons intro, entitlements+gate 402,
statut bot unifié+journal) ; auth JWT+Google SSO+2FA TOTP/WebAuthn ; widget origin-whitelist+ratelimit ;
plugin WP v2 back-office complet + OAuth Authorization-Code+PKCE + /api/account/* ; analytics CNIL (UUID
anonyme, pas d'IP) + insights IA + A/B testing + multi-bot ; démo /demo 1-URL ; prospection autonome
(SIRENE+Brave+scoring Claude). DB : 32 migrations head unique, pgvector réel, migration auto au boot sous lock.

PARTIEL/ABSENT (🟡/⛔) : Gemini = chat texte SEUL (function-calling NON branché → Actions/RAG/MCP inertes
sur Gemini) ; tickets = email seul (pas de table) ; Cal.com = lecture créneaux SEULE (pas de booking) ;
white-label = retrait badge seul (domaine custom ABSENT) ; FAQ = texte libre (pas Q/R structuré) ;
captcha widget FAIL-OPEN sans clé Turnstile ; plugin WP v1 standalone ABSENT (README périmé).

CORRECTIONS DE CROYANCES : l'OAuth plugin est Authorization Code + PKCE (RFC 7636), PAS device flow RFC 8628
(libellé erroné security.py:265 + mémoire). Working tree propre branche feat/wp-plugin-check (résidu .orgtest résolu).

BLOQUANTS PROD / 1er client payant (priorité) :
1. MOCK_AI=True par défaut SANS garde validate_production() → réponses bidon si oubli (config.py:26). HIGH.
2. Turnstile non posé → captcha widget fail-open + démo 404. HIGH.
3. SMTP non posé → leads/tickets/handoff perdus (simple log). HIGH.
4. CI sans tests + tests backend sur FakeSession (pas de vraie DB) + IA/auth/2FA non couvertes +
   pytest absent de requirements (pas rejouable). HIGH.
5. SSRF fetch_page_text (tree/generate URL) sans safe_fetch (tree_generator.py:111). HIGH.
6. Pas de rate-limit sur 2nd facteur 2FA (brute-force TOTP). Isolation tenant sans RLS. MEDIUM.
7. Stripe : events customer.subscription.* doivent être abonnés ; remboursement prorata 14j B2C absent. MEDIUM.
8. env.py oublie models prospect/oauth → autogenerate DROP destructeur. MEDIUM.

NIVEAU GLOBAL : ~85% (cœur produit ~90%, durcissement exploitation/tests ~55%). Code très propre
(0 TODO/FIXME, 0 secret en dur). Prochaines étapes : (1) garde MOCK_AI + Turnstile + SMTP ;
(2) CI pytest + tests réels DB/auth/IA ; (3) sécu ciblée (SSRF, 2FA ratelimit, parité gardes tenant) + Gemini.
```
