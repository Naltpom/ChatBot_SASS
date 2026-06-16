# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChatBot SaaS : plateforme multi-tenant de chatbots embarquables (tree + IA).
Les CLIENTS (organisations) configurent leurs bots via un wizard puis une page
de paramétrage (mode, modèle IA, arbre, apparence, sécurité), collent une
balise `<script>` (ou iframe/GTM/WordPress) sur leur site, et suivent leurs
stats. Le STAFF Kertios (superadmins, auth intranet) a une vue d'administration
sur tous les clients et peut configurer leurs bots.

Modèle éco : plans par organisation (quota mensuel de réponses IA + nombre max
de bots ; tree illimité), clés managées ou BYOK (réservé au plan agence).
Facturation self-serve Stripe optionnelle (sans clés : changement immédiat).
v4 backend : base de connaissances RAG 100 % locale (pgvector + fastembed),
live chat (handoff vers un conseiller humain, polling sans WebSocket), actions
élargies (tickets, créneaux Cal.com, connecteur MCP générique) et analytics &
growth (funnel d'arbre, CSAT, A/B test d'arbre, insights IA, triggers
proactifs, widget multi-langue) — API + widget + UI dashboard livrés
(onglets Connaissances/Inbox/Insights, éditeurs actions/MCP/A-B/triggers,
stats enrichies, templates d'arbres et d'actions).

## Commands

```bash
docker compose up -d --build     # db + redis + api + app (lifespan = alembic upgrade head)
docker compose build api         # rebuild OBLIGATOIRE après modif api/requirements.txt (le bind-mount ne couvre pas les deps)
docker compose logs -f api
docker compose down -v           # reset DB + redis + cache fastembed (migrations rejouées au démarrage, .state.json e2e invalidé)
docker compose exec app bunx tsc --noEmit   # typecheck du dashboard
docker compose exec api alembic revision --autogenerate -m "..."  # nouvelle migration (après modif models/)
docker compose exec redis redis-cli FLUSHALL   # purge les rate-limits (429 login persistants)
cd e2e ; npx playwright test     # suite E2E Playwright (stack docker up requise)
```

- Dashboard : http://localhost:3001 (auto-login admin si AUTO_LOGIN_ADMIN_DEV=true)
- API + docs : http://localhost:8001/docs
- Widget : http://localhost:8001/widget.js · iframe : /widget-frame?key=pk_…
- Démo : `python -m http.server 8080 -d demo`

## Architecture

```
api/alembic/           # migrations (env.py async + advisory lock PG, baseline 0242068a8d9d),
                       # appliquées par le lifespan ; bind-mounté en dev (autogenerate écrit sur l'hôte)
api/src/
├── main.py            # CORS double (dashboard strict / widget ouvert), /widget.js,
│                      # /widget-frame (iframe), /uploads (StaticFiles),
│                      # lifespan : alembic upgrade head puis seed admin dev
├── core/
│   ├── config.py      # Settings env (intranet, auto-login admin, caps widget, SMTP, Stripe ;
│   │                  # validate_production refuse une config Stripe PARTIELLE en prod)
│   ├── database.py    # SQLAlchemy async
│   └── security.py    # JWT scope=dashboard|widget, require_superadmin, require_org_access
├── models/            # SQLAlchemy + Pydantic dans le même fichier
│   ├── user.py        # User / Organization (stripe_customer_id indexé + stripe_subscription_id)
│   │                  # / Membership (many-to-many) + PLANS (flag byok) + PLANS_META (labels)
│   ├── bot.py         # Bot (organization_id) : tree_json, design_json étendu (dont locale),
│   │                  # actions_json (secrets Fernet, sortie API = secret_set), captcha, BYOK,
│   │                  # handoff_webhook_url (credential : masqué sans perm context),
│   │                  # mcp_servers_json (≤2, jeton Fernet write-only), tree_variant_json
│   │                  # + ab_split_pct (A/B), triggers_json (≤5 déclencheurs proactifs)
│   ├── conversation.py  # Conversation (journey JSON, variant A/B 'a'|'b' sticky jamais
│   │                  # renvoyé au widget, status live chat ai|human_requested|human|closed
│   │                  # + horodatages) / Message (source tree|ai|system|human,
│   │                  # rating CSAT -1|+1 nullable)
│   ├── lead.py        # Lead (table leads : FK bot CASCADE, conversation SET NULL, source tree|ai)
│   ├── analytics.py   # TreeEvent (funnel : 1 événement par nœud SERVI, best-effort jamais
│   │                  # bloquant, porte variant) / InsightsReport (rapports « questions
│   │                  # sans réponse », report_json + message_count)
│   └── kb.py          # KbSource / KbChunk (embedding vector(384) via type Vector custom
│                      # UserDefinedType — paquet Python pgvector INTERDIT —, tsv tsvector
│                      # french_unaccent GÉNÉRÉE + GIN, index HNSW cosine)
├── routers/
│   ├── auth.py        # register (crée l'org), login (intranet→local), dev-login, me (avec orgs)
│   │                  # + profil : PATCH /me (nom), POST /password (comptes locaux UNIQUEMENT —
│   │                  # le hash des comptes intranet est réécrit à chaque login intranet, d'où
│   │                  # le 403) ; UserOut expose auth_source/created_at/last_login
│   ├── public.py      # SANS auth : GET /api/public/plans (PLANS+PLANS_META+billing_enabled)
│   ├── orgs.py        # POST "" (création d'org self-serve, plan free), usage du plan,
│   │                  # POST /{id}/plan (self-serve → Stripe ou immédiat), billing/portal,
│   │                  # GET /{id}/invoices, membres, POST /{id}/leave (garde-fou dernier
│   │                  # admin, 404 anti-énumération)
│   ├── bots.py        # /orgs/{id}/bots (liste/create, limite plan) + /bots/{id} (accès org)
│   │                  # + config.json export/import + embed + GET /bots/{id}/leads + tree/generate
│   │                  # + insights (POST /insights/generate, GET /insights = dernier rapport)
│   │                  # ; valide handoff_webhook_url (https + ≤500), réserve search_docs ET
│   │                  # le préfixe mcp_ (_check_actions), valide mcp_servers_json
│   │                  # (_check_mcp_servers + _merge_mcp_secrets : jeton hérité par nom
│   │                  # UNIQUEMENT à URL inchangée) et triggers_json (_check_triggers) ;
│   │                  # _check_plan_constraints appliqué AUSSI à tree_variant_json
│   ├── kb.py          # base de connaissances (perm context) : sources url|sitemap|text,
│   │                  # upload PDF multipart, liste+statuts (rattrapage pending orphelins),
│   │                  # DELETE, POST /kb/search (test de recherche = smoke sans IA)
│   ├── inbox.py       # live chat staff (perm inbox) : GET conversations?status= (extraits
│   │                  # + non-lus), transcript, take / reply (= take implicite) / close —
│   │                  # transitions gardées en SQL, identité staff JAMAIS exposée
│   ├── admin.py       # superadmin : GET /admin/stats (agrégats GROUP BY dashboard opérateur :
│   │                  # MRR sur orgs actives, répartition par plan, conso IA managed du mois,
│   │                  # inscriptions 6 mois via date_trunc), orgs+compteurs, patch
│   │                  # plan/suspension (mêmes garde-fous que le self-serve),
│   │                  # GET /admin/invoices, GET /admin/users, bots/membres par org
│   ├── billing.py     # webhook Stripe (auth = signature HMAC) : applique le plan payé
│   │                  # + _enforce_plan_limits (mise en conformité forcée des bots)
│   ├── uploads.py     # images (avatar, lanceur) -> volume /app/uploads
│   ├── widget.py      # PUBLIC : bootstrap (+ triggers sanitisés, locale) → session
│   │                  # (captcha+origin→JWT, _sanitize_journey, affectation A/B sticky)
│   │                  # → message · POST /lead · POST /feedback (CSAT, idempotent) ·
│   │                  # POST /handoff + GET /poll (live chat, trigger_handoff = source
│   │                  # unique transition+notifications, _lazy_timeout 15 min) ;
│   │                  # _record_tree_event best-effort à chaque nœud servi ;
│   │                  # réponses /session+/message portent `status`
│   └── stats.py       # stats par bot (accès via require_org_access) : clés ADDITIVES
│                      # satisfaction (CSAT) + split par variant, shape historique intacte ;
│                      # + GET /bots/{id}/funnel?days= (counts/abandons par nœud, split A/B)
│                      # — whitelist source ai|tree inchangée (comme usage_service)
└── services/
    ├── auth_service.py  # intranet Kertios (POST mail/mdp, flux ao_scrapping) → superadmin
    ├── tree_engine.py   # "__ai__" = bascule IA ; nœuds typés NODE_TYPES
    │                    # (message | appointment | lead | handoff), re-sanitisés au service
    ├── ai_service.py    # anthropic/openai/gemini via httpx, MOCK_AI en dev, journey + locale
    │                    # dans le system prompt, actions IA en tools (boucle bornée
    │                    # MAX_TOOL_TURNS=2) + tool interne search_docs si has_kb + tools MCP
    │                    # mcp_<server>_<tool> court-circuités (anthropic/openai ; gemini
    │                    # ignoré+loggé) ; _eligible_actions écarte les actions héritées aux
    │                    # noms réservés (search_docs, préfixe mcp_) ; MOCK_AI : "!search q"
    │                    # = vraie recherche locale, "!mcp tool {json}" simulé sans réseau
    ├── action_executor.py # exécution actions IA : webhook signé HMAC X-Kertios-Signature
    │                    # (anti-SSRF strict), capture_lead (Lead source=ai), handoff
    │                    # (_handoff → widget.trigger_handoff, import paresseux),
    │                    # create_ticket (email structuré aux admins ou to_email, sujet
    │                    # normalisé anti-CRLF, trace [ticket] source=system),
    │                    # calendar_slots (Cal.com hôte FIXE https://api.cal.com, clé Fernet,
    │                    # _compact_slots pur)
    ├── mcp_client.py    # client MCP maison : JSON-RPC 2.0 sur HTTP POST via safe_fetch
    │                    # (initialize → tools/list → tools/call, Bearer optionnel, 10 s) ;
    │                    # tools exposés mcp_<server>_<tool> (cap 20, descriptions ET schémas
    │                    # bornés), cache court par conversation + cache NÉGATIF par serveur,
    │                    # découverte en parallèle, routage tools/call par serveur
    │                    # propriétaire (repli longest-prefix) — jamais bloquant
    ├── insights_service.py # « questions sans réponse » : UN appel au modèle managé
    │                    # (pattern tree_generator, claude-sonnet-4-6), clusterisation
    │                    # ≤200 messages visiteurs 30 j → report_json ; MOCK_AI déterministe
    ├── embeddings.py    # fastembed local (ONNX CPU, 384 dims) : init paresseuse
    │                    # to_thread+lock, échec → _failed jusqu'au restart (FTS seul),
    │                    # to_pgvector (str + CAST, aucun codec asyncpg)
    ├── kb_service.py    # chunking 800/150, ingestion tâche de fond (session DB DÉDIÉE,
    │                    # refs fortes anti-GC), recherche hybride RRF cosine+FTS
    │                    # french_unaccent, dégradation FTS seul
    ├── safe_fetch.py    # SSRF strict PARTAGÉ (pattern action_executor) :
    │                    # resolve_public_ip / safe_get (KB) / safe_post_json (webhook
    │                    # handoff, réponse IGNORÉE) / safe_post_json_read (MCP :
    │                    # réponse lue BORNÉE + headers retournés)
    ├── email_service.py # notification leads + demandes de conseiller (build_handoff_email)
    │                    # + tickets IA (build_ticket_email) : smtplib via to_thread,
    │                    # fallback log sans SMTP_HOST
    ├── stripe_service.py # API REST Stripe via httpx (PAS de SDK) : customer, checkout,
    │                    # portail, vérif signature webhook, invoices, billing_enabled()
    ├── captcha.py       # turnstile / recaptcha_v3 / disabled
    ├── rate_limit.py    # Redis (ZSET, REDIS_URL) fail-open → repli mémoire process ;
    │                    # treegen 10/24h/org, lead 5/h/session, handoff 3/h/session,
    │                    # poll 60/min/session + poll_ip 600/min/IP, human_msg 60/10min,
    │                    # feedback 30/h/session, insights 3/jour/org (vérifié AVANT l'appel IA)
    ├── usage_service.py # caps quotidien bot + quota mensuel org + limite bots du plan
    │                    # + plan_change_problems (garde-fous partagés self-serve/admin)
    └── crypto.py        # Fernet (BYOK, secrets d'actions, secret reCAPTCHA)

app/src/
├── api.ts             # fetch JSON Bearer + postFile (multipart, upload PDF KB)
├── AuthContext.tsx    # user (+ auth_source/created_at/last_login) + organizations + activeOrg
│                      # (localStorage) + auto dev-login
├── Layout.tsx         # DEUX shells dans le MÊME composant : mode admin (opérateur) si
│                      # pathname.startsWith('/admin'), sinon mode user ; superadmin = liens de
│                      # bascule entre les deux ; à 0 organisation seuls Mes organisations et
│                      # Profil sont affichés
├── botConstants.ts    # MODEL_OPTIONS par provider, CAPTCHA (encarts RGPD), APPEARANCE_PRESETS
│                      # (presets design en merge partiel), PLAN_LABELS / PublicPlan /
│                      # planFeatures — PLANS_INFO n'existe plus (pricing = GET /api/public/plans)
│                      # + ACTION_TEMPLATES (galerie d'actions, données frontend pures)
│                      # + TREE_TEMPLATES (4 arbres sectoriels FR ≤10 nœuds, wizard)
├── billingUtils.tsx   # partagé Billing/AdminInvoices : invoiceStatusChip, montants Stripe
│                      # en CENTIMES, dates en epoch SECONDES
├── components/
│   ├── AppearanceForm.tsx  # design complet + presets + clés étendues (police, sombre, densité…)
│   │                       # + Seg « Langue du widget » (locale auto|fr|en, hors presets)
│   ├── TreeBuilder.tsx     # builder visuel + nœuds typés (Seg « Type de réponse » à 4 options
│   │                       # dont handoff « Conseiller »)
│   ├── WidgetPreview.tsx   # réplique React du widget : RDV/lead/CSAT/LIVE simulés,
│   │                       # PREVIEW_I18N (miroir I18N widget.js), triggers NON simulés
│   ├── KbPanel.tsx         # onglet Connaissances : CRUD sources + test de recherche,
│   │                       # HORS save bar, polling 4 s tant que pending
│   ├── InboxPanel.tsx      # onglet Inbox : live chat staff (liste+transcript, refetch 5 s,
│   │                       # take/reply/close), HORS save bar
│   ├── InsightsPanel.tsx   # onglet Insights : génération + clusters + pré-remplissage arbre
│   └── StatsPanel.tsx      # stats historiques + satisfaction CSAT + comparatif A/B
│                           # + funnel (GET /funnel, mapping node_key→labels)
└── pages/
    ├── Login.tsx      # login (intranet ou local) / register avec nom d'organisation
    ├── BotList.tsx    # « Mes chatbots » : BotCard exportée ({bot,onOpen,canCopy}, importée par
    │                  # Admin.tsx ; canCopy=false = footer omis), statut/usage, états vides, CTA wizard
    ├── BotWizard.tsx  # étapes dynamiques selon mode : Nom&type → [IA] → [Arbre] →
    │                  # Apparence → Sécurité → création réelle → Intégration → page bot ;
    │                  # étape Arbre (mode tree SEUL) : galerie « Partir d'un modèle »
    │                  # (TREE_TEMPLATES) au-dessus du builder, avec aperçu
    ├── BotPage.tsx    # 11 onglets en 3 groupes (cf. Design) + save bar sticky
    │                  # (pattern savedBot, dirty PAR ONGLET, Ctrl+S) + éditeurs
    │                  # actions/MCP/A-B/triggers + pastille Inbox (poll 30 s)
    ├── Billing.tsx    # branché Stripe : checkout/portail, retours ?checkout=, polling usage,
    │                  # card Factures, bandeau billing_enabled=false
    ├── Profile.tsx    # nom, infos compte, mot de passe (comptes locaux ; intranet = lecture seule)
    ├── MyOrgs.tsx     # orgs de l'utilisateur (rôle/plan/type), org active, création, renommage,
    │                  # conversion perso→entreprise, quitter (garde-fou dernier admin côté API)
    ├── Team.tsx       # membres + invitations en attente + section « Permissions par bot »
    │                  # TOUJOURS rendue (sélecteur de membre), dès 1 membre
    ├── Admin.tsx      # AdminHome (/admin/clients, table clients) + AdminClient (détail org)
    ├── AdminDashboard.tsx # /admin : stats opérateur (GET /api/admin/stats) + projection
    │                  # LINÉAIRE indicative calculée côté front
    ├── AdminInvoices.tsx  # /admin/invoices : factures Stripe agrégées (staff)
    ├── AdminUsers.tsx     # /admin/users : tous les comptes, lecture seule
    └── Landing.tsx    # pricing via GET /api/public/plans (FALLBACK_PLANS local = secours
                       # réseau uniquement), carte Free incluse

widget/widget.js       # vanilla JS : flottant ou data-inline (iframe), gradient/size/radius/
                       # images/animations + clés design étendues (font/darkMode/density/
                       # launcherText/offsets… whitelist locale css(d)), journey (sessionStorage
                       # kc_journey), overlay RDV (Calendly/Cal.com) + formulaire lead,
                       # live chat (state.chatStatus serveur autoritaire, polling 2,5 s,
                       # badge LIVE, tag « Conseiller »), CSAT (icônes up/down sous les bulles
                       # ai|tree → POST /feedback), triggers proactifs côté client (dédup
                       # sessionStorage kc_triggers, exit_intent désactivé mobile, bulle
                       # locale SANS appel API), dictionnaire UI FR/EN (design_json.locale,
                       # 'auto' = navigator.language), servi par l'API

e2e/                   # Playwright, 30 tests, workers:1 — stack docker UP requise
│                      # (2 runs consécutifs verts = contrat rejouabilité)
├── global-setup.ts    # FLUSHALL Redis EN TÊTE (rejouabilité) puis via API : compte
│                      # entreprise (plus aucune notion de plan : org « tout ouvert »)
│                      # + bot partagé tree (captcha disabled, localhost) + member local
│                      # « Membre E2E » (permissions remises à {} à chaque run) →
│                      # .state.json (gitignoré). tryReuse remet le bot partagé à plat
│                      # et purge les bots dédiés — MAIS le global-teardown efface
│                      # .state.json, donc en pratique chaque run repart d'un setup frais
├── global-teardown.ts # purge en base TOUTES les données e2e à la fin du run (orgs
│                      # « E2E » + comptes @e2e-chapote.fr → bots/memberships/invitations
│                      # /conversations… ; ordre FK NO ACTION : bots→memberships→
│                      # invitations→orgs→users) via `docker compose exec db psql`
│                      # (échec NON bloquant), puis supprime .state.json. Préserve le
│                      # staff superadmin (autre domaine d'email)
├── helpers.ts         # loadState, blockAutoLogin (kc_no_autologin), authenticateWithToken
│                      # (token posé en localStorage AVANT le 1er chargement),
│                      # devLoginToken (dev-login superadmin, non rate-limité),
│                      # createOrg/createBot jetables (endpoints NON rate-limités,
│                      # noms préfixés « E2E », jamais mode ai) + deleteBot best-effort
│                      # (afterAll des specs v4 à bot dédié)
├── widget-helpers.ts  # NODES_TREE (nœuds appointment+lead), HANDOFF_TREE (arbre
│                      # 2 nœuds root→handoff opt-in : live chat, pas d'IA),
│                      # interceptCalendly (stub total calendly.com + sous-domaines
│                      # AVANT navigation : zéro réseau réel), openFrame (/widget-frame)
└── tests/             # 6 specs historiques : landing, register-perso (SEUL register
                       # UI), wizard-tree, botpage, widget, team (invitation) ;
                       # 8 specs v3 : profile (renommage, mdp happy+revert sur le
                       # member, 403 sans déconnexion), orgs (création/renommage/
                       # conversion/422 dernier admin — lignes d'org = type seul,
                       # « Personnel »/« Entreprise », plus de plan), admin-split
                       # (back-office + redirect non-superadmin ; plus de page Factures),
                       # widget-nodes (overlay RDV intercepté, lead → onglet Leads +
                       # CSV), actions (hints + secret_set sans fuite), appearance
                       # (preset + launcherText → bootstrap sanitisé), team-permissions
                       # (matrice : état vide + toggle persisté), savebar (sticky,
                       # pastille d'onglet, Annuler, Ctrl+S) ;
                       # 5 specs v4 (bot DÉDIÉ jetable créé/supprimé via l'API, sauf
                       # wizard-templates) : kb (onglet Connaissances, perm context :
                       # source TEXTE → pending→Prête via polling KbPanel [timeout
                       # 180 s, modèle fastembed en cache] → « Tester la recherche »
                       # badge hybride|dégradée + ≥1 résultat → suppression ; 100 %
                       # local, widget jamais ouvert), inbox-live (parcours B+C en UN
                       # test : HANDOFF_TREE → /widget-frame → option handoff →
                       # badge LIVE + saisie active ; staff onglet Inbox → « Prendre
                       # en main »→human, reply Entrée → bulle « Conseiller » via poll
                       # widget, « Clôturer »→closed + retour TREE ; take après close
                       # = 409 ; CSAT pouce sur bulle d'accueil tree → /feedback 200,
                       # rating remonté dans le transcript Inbox), triggers (onglet
                       # Apparence, perm appearance : ajout trigger, hints FR message
                       # vide / value requise, type scroll_depth→% / exit_intent→
                       # mention mobile, save → GET /widget/bootstrap triggers
                       # sanitisés [assert API] ; PAS de déclenchement temporisé
                       # navigateur = anti-flaky), ab (onglet Arbre, perm context :
                       # activer variante B [retry toPass anti-race re-render] + slider
                       # ab_split_pct → assert API non-null → désactiver → assert API
                       # null/0 ; 1 seul TreeBuilder monté), wizard-templates (étape
                       # Arbre mode tree : galerie 4 TREE_TEMPLATES → Aperçu
                       # WidgetPreview local → « Utiliser ce modèle » → builder peuplé,
                       # sortie SANS création réelle → 0 register, rien à nettoyer)
```

## Concepts clés

### Multi-tenant, rôles & permissions
- `User` ←(Membership: admin|member)→ `Organization` (type perso|entreprise) :
  une personne peut appartenir à plusieurs clients. Perso = même architecture,
  une seule personne, convertible en entreprise (PATCH /orgs/{id} type, jamais l'inverse).
- **Mes organisations** (/app/orgs, MyOrgs.tsx) : switch d'org active, création
  self-serve (POST /api/orgs, plan free), renommage/conversion (admins),
  quitter (POST /api/orgs/{id}/leave, garde-fou dernier admin, 404
  anti-énumération). Orgs suspendues ABSENTES du /me → état « 0 organisation »
  géré par Layout (seuls Mes organisations/Profil affichés).
- **Profil** (/app/profile) : PATCH /api/auth/me (nom) ; POST /api/auth/password
  réservé aux comptes locaux — les comptes intranet voient leur hash réécrit à
  chaque login intranet, d'où le 403 (UI en lecture seule avec explication).
- Bots, quotas et plans portés par l'**organisation**. `PLANS` dans models/user.py :
  free = mode ARBRE uniquement (`tree_only`) + 10 bulles max (`max_tree_nodes`) + 0 IA ·
  starter 500 IA/1 bot/19€ · pro 2000/3/39€ · agence 10000/10/119€ + `byok: true`
  (alignés sur la landing). BYOK réservé au flag `byok` : 403 au PATCH
  api_key_mode=byok hors plan (superadmin bypass) et coupure IA au RUNTIME par
  `ai_allowed` (tree_only ou BYOK hors plan, même après downgrade webhook).
  `PLANS_META` (même fichier) = labels/descriptions marketing, servis avec PLANS
  par GET /api/public/plans (routers/public.py) = source unique du pricing front.
  Contraintes appliquées par `_check_plan_constraints` (routers/bots.py),
  superadmin bypass — au PATCH/import, vérifiées SEULEMENT si mode ou tree_json
  changent (pas d'over-blocking d'un patch design seul).
- **Changement de plan** : garde-fous factorisés `usage_service.plan_change_problems`
  (4 vérifs : max_bots, tree_only, max_tree_nodes, byok), PARTAGÉS entre
  POST /orgs/{id}/plan (self-serve) et PATCH /api/admin/organizations/{id}
  (plan validé dynamiquement contre PLANS, plus de regex en dur). Anti-race :
  Organization lue en SELECT FOR UPDATE dans change_plan, patch_organization
  (admin) et create_bot.
- **Génération d'arbre par IA** : POST /api/bots/{id}/tree/generate {source_text|url}
  (services/tree_generator.py, claude-sonnet-4-6, clé managée, perm context).
  Réservée aux plans payants (price>0) + treegen_limiter Redis 10/24h/org
  vérifié AVANT tout appel IA (superadmin non exempté).
  Retourne le tree_json sans le sauvegarder — le client prévisualise puis enregistre.
- TreeBuilder : la cible d'un bouton est retargetable vers un nœud EXISTANT (boucles/retours)
  via le select « Cible du bouton » ; suppression de bot = bouton zone danger (admins d'org).
- **Permissions par bot** des members : `Membership.permissions = {"<bot_id>": ["copy","test","appearance","context","security","inbox"]}`.
  `inbox` (live chat) volontairement EN FIN de `BOT_PERMS` (models/user.py) :
  la matrice de la page Équipe suit cet ordre (contrainte e2e sur la 1re colonne).
  Appliquées par l'API : `FIELD_PERMS` dans routers/bots.py mappe chaque champ
  PATCHable sur une permission (actions_json/mcp_servers_json/
  tree_variant_json/ab_split_pct→context, triggers_json→appearance,
  handoff_webhook_url→context — URL aussi MASQUÉE en lecture sans cette perm,
  flag handoff_webhook_set conservé) ; embed→copy, export
  config.json→context (CONFIG_FIELDS = champs « contenu » seulement :
  actions_json, mcp_servers_json, tree_variant_json, ab_split_pct,
  triggers_json et handoff_webhook_url EXCLUS de l'export/import), endpoints
  /kb/*→context, /conversations/*→inbox, IMPORT config.json = perm de CHAQUE
  champ effectivement importé (même mapping que le PATCH), delete/create→admin d'org.
  Le frontend filtre les onglets de BotPage et les boutons de copie en conséquence.
- **Invitations** : email sans compte → table `invitations`, consommée à
  l'inscription (`_consume_invitations`) ; email avec compte → membership direct.
- Inscription : `account_type` perso (org "Espace de X") ou entreprise
  (nom + invitations avec rôle), créateur = admin.
- Superadmin : `require_org_access` le laisse passer partout → l'admin configure
  les bots clients via les MÊMES endpoints/pages que les clients.
- Staff = auth intranet Kertios (POST mail/mdp sur INTRANET_AUTH_URL, succès si
  redirect /main ou {"retour":"Ok"}) → user créé `is_superadmin=True`.
- Org `is_active=False` (suspension par l'admin) → tous ses widgets coupés.

### Facturation Stripe
API REST via httpx (services/stripe_service.py, PAS de SDK). Billing
TOUT-OU-RIEN sur 5 env : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
STRIPE_PRICE_STARTER|PRO|AGENCE (vides en dev = billing désactivé → changement
de plan immédiat historique, garde-fous conservés ; en prod une config
PARTIELLE refuse de démarrer via validate_production). Quand actif,
POST /orgs/{id}/plan renvoie `checkout_url` (upgrade payant sans abonnement)
ou `portal_url` (abonnement existant, portail ÉPINGLÉ sur le plan validé par
les garde-fous ; cible free = flow de résiliation) — le plan payé n'est
APPLIQUÉ que par le webhook POST /api/billing/webhook (routers/billing.py,
auth = signature Stripe-Signature HMAC-SHA256 vérifiée à la main sur le corps
BRUT, handlers idempotents, org introuvable → ack 200). Le webhook applique
SANS garde-fous (la réalité du paiement prime) PUIS `_enforce_plan_limits` :
bots excédentaires désactivés, byok→managed, mode→tree si tree_only.
Factures lues à la demande via l'API Stripe (pas de table locale) :
GET /orgs/{id}/invoices (admins d'org) · GET /api/admin/invoices (staff,
agrégé + org_id/org_name). `billing_enabled` exposé par /api/public/plans,
/orgs/{id}/usage (qui renvoie aussi `byok`) et les réponses de change_plan
(bandeau front « paiement non configuré »). Free reste hors Stripe.
Test local : `stripe listen --forward-to localhost:8001/api/billing/webhook`.

Côté front (Billing.tsx) : retours Stripe `/app/billing?checkout=success|cancelled`
(param nettoyé) ; sur success le plan est appliqué PAR LE WEBHOOK (asynchrone)
→ polling usage 2s×10 avant de conclure — en dev sans `stripe listen` le
TIMEOUT est le chemin normal. `checkout_url` → window.location.href ;
`portal_url` → redirection portail (downgrade d'un abonné passe par le
portail, pas par un checkout) ; bouton « Gérer mon abonnement » =
POST /orgs/{id}/billing/portal. Card Factures via billingUtils.tsx
(centimes, epoch secondes). Les 422 « Changement de plan impossible : … »
sont affichés tels quels.

### Intégrations : rendez-vous, leads, actions IA
- **Nœuds d'arbre typés** (tree_engine, NODE_TYPES) : sans `type` = message
  classique (rétro-compat des arbres existants — les réponses tree sans type
  sont INCHANGÉES, contrat e2e) · `appointment` porte une
  `url` https (Calendly/Cal.com) rendue en overlay au-dessus du chat (hôte non
  embarquable → lien seul) · `lead` porte `fields` (email obligatoire, choix
  email/phone/name/message) → formulaire dans le widget · `handoff` (aucun
  champ en plus : le `message` du nœud = intro, le widget enchaîne
  POST /widget/handoff). Triple validation :
  validate_tree (sauvegarde) / format_node_response (service) / widget.
- **Leads** : table `leads` (models/lead.py). POST /api/widget/lead : JWT
  session + lead_limiter 5/h/session + garde « le bot collecte des leads »
  (nœud lead OU action capture_lead) ; trace transcript `[lead]` role=user
  source=system, EXCLUE de l'historique IA et des compteurs stats (whitelist
  source in ai|tree). GET /api/bots/{id}/leads (perm context). Notification
  email aux admins de l'org : email_service (smtplib stdlib via to_thread,
  non bloquant, destinataires récupérés AVANT create_task, fallback log si
  SMTP_HOST absent).
- **Actions IA tool-use** : `Bot.actions_json` (perm context, max 5, types
  webhook|capture_lead|handoff|create_ticket|calendar_slots ; secrets chiffrés
  Fernet PAR TYPE via `_ACTION_SECRET_KEYS` (webhook: secret/secret_encrypted,
  calendar_slots: api_key/api_key_encrypted) — sortie API = flags
  secret_set/api_key_set, secret omis au PATCH = conservé (fusion par NOM) ;
  EXCLU de config.json export/import). Noms RÉSERVÉS (_check_actions) :
  `search_docs` (tool interne KB injecté par ai_service) et préfixe `mcp_`
  (tools MCP) — les actions héritées d'avant ces réservations sont écartées
  des tools par `_eligible_actions` (loggé). Exposées en tools au modèle
  (formats Anthropic et OpenAI ; gemini non branché, loggé). Boucle tool-use
  bornée MAX_TOOL_TURNS=2 (ai_service : échanges intermédiaires non persistés,
  seul le texte final l'est ; au dernier tour les tool_use ne sont PAS
  exécutés). Exécution webhook (action_executor) : httpx POST signé
  HMAC-SHA256 header X-Kertios-Signature, timeout 10 s, anti-SSRF strict
  (https uniquement, résolution DNS unique → rejet IP non publiques, connexion
  épinglée sur l'IP validée, aucun redirect), réponse tronquée à 2000 chars
  avant retour au modèle. MOCK_AI : `!action nom {json}` simule un appel
  déterministe (mêmes noms réservés filtrés que les vrais builders).
- **create_ticket** (v1 email, pas d'intégration Zendesk) : l'IA ouvre un
  ticket → email structuré (build_ticket_email, fallback log sans SMTP) aux admins
  de l'org OU à `to_email` validé sur l'action ; champs subject/summary/
  coordonnées fournis par le modèle (schéma imposé CREATE_TICKET_PROPS, sujet
  normalisé anti-CRLF — un saut de ligne dans un en-tête ferait perdre l'email
  en silence), référence TK-XXXXXXXX, trace transcript `[ticket]`
  source=system, ack {ok, ticket_ref} au modèle.
- **calendar_slots** : l'action porte la config Cal.com (api_key SECRET Fernet
  write-only pattern secret_set, event_type_id, timezone défaut Europe/Paris) ;
  l'executor appelle l'API Cal.com sur l'hôte FIXE https://api.cal.com (pas de
  SSRF dynamique, timeout 10 s, clé jamais dans l'URL ni les logs) pour les
  disponibilités des ~7 prochains jours → liste compacte (_compact_slots,
  cap 40 créneaux) ; erreurs → tool_result is_error FR. AUCUN appel réel en
  smoke (clé factice → erreur propre).
- **Connecteur MCP générique** : `Bot.mcp_servers_json` (max 2 serveurs
  {name ^[a-z][a-z0-9_]{0,30}$ unique, url https ≤500, auth_token SECRET
  Fernet write-only}), PATCH perm context, validation 422 FR, EXCLU de
  config.json. Fusion des secrets à l'omission par NOM et UNIQUEMENT à URL
  inchangée (_merge_mcp_secrets) : un Bearer est un credential brut ENVOYÉ au
  serveur — changer l'URL (ou renommer) invalide le jeton, à ressaisir
  (divergence voulue avec le secret HMAC webhook, jamais transmis, lui hérité
  au renommage près). Client maison (services/mcp_client.py) : JSON-RPC 2.0
  sur HTTP POST via safe_fetch.safe_post_json_read (https, IP publiques only,
  no redirect, lecture bornée), initialize → notifications/initialized
  (best-effort) → tools/list → tools/call, Mcp-Session-Id rejoué si le serveur
  en fournit un, Authorization: Bearer si configuré, fallback parsing SSE
  minimal (dernière ligne `data:`, jamais de session SSE entrante), timeout
  10 s/requête + 15 s/serveur à la découverte. Tools exposés au modèle
  `mcp_<server>_<tool>` (sanitisés, cap 20,
  descriptions tronquées 300, inputSchema borné 2000 chars + description/title
  internes tronqués — anti injection/amplification) aux côtés des actions ;
  découverte par conversation en PARALLÈLE avec cache court (TTL 5 min) +
  cache négatif par serveur (~90 s : un serveur mort ne coûte le timeout
  qu'une fois par fenêtre) ; routage tools/call par serveur PROPRIÉTAIRE
  mémorisé à la découverte, repli longest-prefix (noms en relation de préfixe
  type crm/crm_v2) ; échec serveur → tools absents + log, jamais bloquant ;
  résultat tronqué 2000 chars. MOCK_AI : `!mcp mcp_<server>_<tool> {json}`
  simule sans réseau.
- **Templates d'actions** (suivi de commande, magasin le plus proche, devis,
  statut d'incident) : données FRONTEND uniquement — `ACTION_TEMPLATES`
  (botConstants.ts), galerie `.tpl-card` en tête de l'onglet Actions qui
  pré-remplit l'éditeur (l'utilisateur ajuste url/to_email avant Enregistrer).
  RIEN côté backend.
- **Côté front** : TreeBuilder = Seg « Type de réponse »
  (message/appointment/lead/handoff « Conseiller ») — le retour à message
  SUPPRIME les clés type/url/fields (ne JAMAIS écrire type:'message').
  WidgetPreview simule appointment (overlay SANS iframe tierce dans le
  dashboard), lead (soumission factice) et handoff (flux LIVE léger) avec les
  MÊMES clés que widget.js (type/url/fields) —
  la parité réelle (iframe Calendly/Cal.com, POST /api/widget/lead) vit dans
  widget/widget.js. Onglet Leads (perm context) visible dans TOUS les modes ;
  hint admin si SMTP absent (notification = log seul) ; hint provider gemini
  (actions ET tools MCP ignorés) ; CSP frame-src Calendly/Cal.com documentée
  dans l'onglet Intégration.
- **Éditeur d'actions** (onglet Actions, BotPage) = 3 blocs : galerie
  ACTION_TEMPLATES, éditeur 5 types, section « Serveurs MCP ». Secrets tapés
  dans `actionSecrets` keyed par INDEX ; serializeActions() omet les flags
  secret_set/api_key_set et ROUTE le secret saisi selon le type (`api_key`
  pour calendar_slots, `secret` sinon), omis = conservé côté serveur.
  Changement de type = RECONSTRUCTION de l'action (updateActionType, jamais
  de mutation partielle). Le secret étant rattaché au NOM côté serveur,
  renommer une action webhook sans ressaisir le secret le SUPPRIME.
  Serveurs MCP : `mcpTokens` par INDEX (même pattern), warning « jeton à
  ressaisir » si name OU url divergent de savedBot (miroir de
  _merge_mcp_secrets) ; hints/placeholders volontairement DISTINCTS des
  chaînes webhook assertées par actions.spec.

### Base de connaissances (RAG hybride 100 % local)
Aucun appel IA externe pour l'indexation/recherche : embeddings fastembed
(ONNX CPU, EMBEDDINGS_MODEL 384 dims, cache FASTEMBED_CACHE_PATH) + pgvector.
- **Sources** (kb_sources, perm context) : url | sitemap (index WordPress/Yoast
  suivi sur UN niveau) | pdf (multipart, magic %PDF-, jamais écrit sur disque)
  | text. Ingestion = tâche de fond asyncio (réponse immédiate status=pending,
  le front poll GET /kb/sources ; session DB dédiée, refs fortes anti-GC) :
  extraction (safe_fetch SSRF strict, html_to_text, pypdf en to_thread) →
  chunking ~800 chars/overlap 150 → embed_passages par lots → INSERT SQL
  textuel `CAST(:e AS vector)`. Échec → status=error + message FR ; pending
  > 30 min (tâche tuée par un restart/--reload) → basculé error au GET.
- **Recherche** (kb_service.search_chunks) : HYBRIDE = cosine pgvector top 10
  + FTS websearch_to_tsquery('french_unaccent') top 10, fusion RRF
  (1/(60+rang)), top k=5. Modèle d'embeddings indisponible (download raté,
  _failed) → dégradation propre en FTS seul (mode renvoyé : hybrid|fts).
  POST /api/bots/{id}/kb/search = test dashboard ET smoke sans IA.
- **Côté IA** : tool interne `search_docs` exposé au modèle UNIQUEMENT si le
  bot a ≥1 chunk indexé (has_kb, calculé dans widget.py) ; court-circuité dans
  la boucle tool-use (JAMAIS résolu via actions_json), résultat = top 5
  extraits {content ≤600, ref} JSON borné 2000 chars. Anthropic/openai
  exécutés, gemini ignoré+loggé (comme les actions). MOCK_AI : `!search
  question` = VRAIE recherche locale déterministe, aucun provider appelé.
  Free/tree-only n'atteint jamais la branche IA (ai_allowed) → aucun gating
  de plan supplémentaire.
- **Caps** : 20 sources/bot · ~1000 chunks/bot (troncature loggée) ·
  30 pages/sitemap · 100 pages et 10 Mo/PDF · 2 Mo lus par page.

### Live chat (handoff conseiller)
Pas de WebSocket : polling DB, robuste multi-worker. `Conversation.status` =
ai → human_requested (demande visiteur) → human (staff a pris) → closed
(clôture staff) + horodatages (human_requested_at/human_taken_at/closed_at).
- **Déclencheurs** : nœud d'arbre `handoff` (opt-in, rétro-compat totale) OU
  action IA type `handoff` (action_executor._handoff → widget.trigger_handoff
  par import paresseux). `trigger_handoff` (routers/widget.py) = source UNIQUE
  de la transition : statut+horodatages, trace `[handoff]` (pattern [lead]),
  message d'attente, notifications. Transitions GARDÉES en SQL
  (UPDATE … WHERE status=…) : double POST/course timeout-vs-take sans doublon.
- **Notifications** à chaque passage en human_requested : email aux admins de
  l'org (build_handoff_email, fallback log sans SMTP) + `bot.handoff_webhook_url`
  optionnel (payload `{"text": ...}` compatible Slack, safe_post_json SSRF
  strict, échec loggé jamais bloquant, hostname seul dans les logs).
  Validation PATCH : https:// + ≤500, perm context, PAS dans CONFIG_FIELDS.
- **Côté visiteur** : POST /api/widget/handoff (JWT session, garde
  _bot_has_handoff, 3/h/session, idempotent — last_message_id null = le widget
  garde son curseur) ; GET /api/widget/poll?after=<message_id> (60/min/session
  + budget IP DÉDIÉ 600/min — jamais ip_limiter partagé : 4 visiteurs en
  attente derrière un NAT le videraient) renvoie messages role=assistant
  source human|system + status. En mode humain, /message persiste
  source='human' (human_msg_limiter 60/10min, message null = simple accusé,
  réponse via /poll) ; message texte sur closed → bascule paresseuse en ai.
- **Timeout paresseux** : human_requested sans staff depuis 15 min → retour ai
  + message d'excuse, évalué en tête de /poll ET /message (jamais de cron).
- **Côté staff** (routers/inbox.py, perm inbox ; admins d'org/superadmins
  passent) : liste filtrée par statut (extraits, non-lus simples), transcript,
  take (human_requested→human), reply (= take implicite, Message
  role=assistant source=human SANS auteur — le widget affiche le label
  constant « Conseiller », jamais le nom/email du staff), close (→ closed +
  message de clôture livré au /poll ; purge aussi les human_requested zombies).
- **widget.js** : state.chatStatus AUTORITAIRE serveur (applyStatus sur toute
  réponse portant `status` — /session et /message la portent toujours) ;
  chaîne setTimeout 2,5 s uniquement panneau ouvert + onglet visible
  (visibilitychange), arrêt propre à la fermeture ; 401/404 au poll = retour
  normal SILENCIEUX (jamais de re-handshake → nouvelle conversation),
  429 → backoff 10 s ; badge LIVE, tag .kc-human-tag, saisie active en mode
  humain même sur un bot tree (rangée cachée au bootstrap = contrat e2e
  intact) ; retour automatique au mode normal sur closed/timeout.
- **Convention sources** : Message source='human' (visiteur en mode conseiller
  OU réponse staff selon role) et source='system' (attente/clôture/excuse/
  trace [handoff]) → exclus AUTOMATIQUEMENT de l'historique IA (widget.py
  source.in_(['ai','tree'])), des quotas (usage_service compte source='ai')
  et des stats (whitelists) — stats.py et usage_service.py n'ont PAS été
  modifiés et ne doivent pas l'être.
- Pas de gating par plan : free reste tree-only (pas d'IA donc ni search_docs
  ni action handoff), mais le NŒUD d'arbre handoff reste utilisable
  (cohérent avec lead).

### Analytics & growth (v4 chantier B)
- **Funnel d'arbre** : table `tree_events` (models/analytics.py — bot_id FK
  CASCADE ix, conversation_id FK SET NULL, node_key ≤80, variant, created_at
  ix), 1 ligne par nœud SERVI (premier nœud de session + message/clic),
  best-effort `_record_tree_event` (jamais bloquant, partage le commit du
  flux). GET /api/stats/bots/{id}/funnel?days=30 (require_org_access) :
  counts par node_key, taux d'abandon (exit = DERNIER nœud servi de chaque
  conversation, max(id) par conversation sur la fenêtre ; événements
  ORPHELINS — conversation purgée, FK SET NULL — comptés dans counts mais
  exclus des exits), split par variant.
- **CSAT** : `Message.rating` (-1=down, +1=up, nullable). POST
  /api/widget/feedback {message_id, rating up|down} (JWT session, message de
  LA conversation du JWT, role=assistant source ai|tree, idempotent/écrasable,
  feedback_limiter 30/h/session, 404 UNIQUE anti-énumération quel que soit
  l'échec). `message_id` = clé ADDITIVE des réponses widget : accueil de
  session, clic d'option, réponse IA — jamais le texte libre tree ni les
  dégradés (pas de message_id = pas de CSAT). widget.js : deux icônes SVG
  discrètes sous chaque bulle assistant ai|tree (jamais human/system),
  `.kc-rate` appendée HORS de .kc-msg (toHaveText e2e intacts), postFeedback
  SANS retry-401 (un re-handshake = nouvelle conversation → 404 garanti,
  même philosophie que le poll), textes FR/EN. stats.py expose satisfaction
  (up/down/total) en clé ADDITIVE — shape historique intacte.
- **A/B test d'arbre** : `Bot.tree_variant_json` nullable (null explicite au
  PATCH = désactivation) + `ab_split_pct` 0-100 (perm context,
  _check_plan_constraints appliqué AUSSI à la variante). Affectation à la
  création de session si variante ET split>0 → `Conversation.variant` 'a'|'b'
  sticky (random pondéré) ; `_active_tree` (widget.py) passe la variante à
  tree_engine pour les conversations 'b', repli SILENCIEUX sur l'arbre
  principal si la variante a été retirée ; réponses widget INCHANGÉES (jamais
  de fuite du variant au visiteur) ; funnel et stats splittés. variant null = comportement
  historique strict. Les gardes _bot_collects_leads/_bot_has_handoff scannent
  les DEUX arbres (un nœud lead/handoff seulement dans la variante B doit
  rester servi au bras B).
- **Insights « questions sans réponse »** : POST /api/bots/{id}/insights/
  generate (perm context, plans payants price>0, insights_limiter Redis
  3/jour/org vérifié AVANT tout appel IA, superadmin inclus — un 422
  « aucune question » consomme donc un crédit, voulu) : échantillon ≤200 messages
  visiteurs source='ai' des 30 derniers jours → UN appel au modèle managé
  (insights_service, pattern tree_generator) → {clusters:[{theme, count,
  examples≤3, suggested_bubble}]} persisté dans `insights_reports`.
  GET /api/bots/{id}/insights = dernier rapport (null si aucun). MOCK_AI =
  rapport déterministe. Smoke : gating 403 free / 429 limiteur / GET vide —
  JAMAIS de génération réelle.
- **Triggers proactifs** : `Bot.triggers_json` (max 5 : {type time_on_page|
  scroll_depth|exit_intent|url_pattern, value selon type, message ≤300,
  once_per_session défaut true}), PATCH perm appearance, validation 422 FR
  (_check_triggers), re-sanitisés SILENCIEUSEMENT au bootstrap
  (_sanitize_triggers). Évaluation 100 % côté widget (timer, scroll %,
  mouseleave haut de page, match pathname), dédup sessionStorage kc_triggers,
  UN tir max par chargement de page, jamais en mode INLINE, déclenchement =
  ouverture du panneau + bulle LOCALE (aucun message serveur, aucun appel
  API) ; jamais si panneau déjà ouvert/déjà interagi ; exit_intent désactivé
  sur mobile (pointer: coarse).
- **Multi-langue** : clé design_json `locale` ('auto'|'fr'|'en', défaut 'fr',
  sanitisée _sanitize_design + whitelist widget). widget.js : dictionnaire
  I18N FR/EN de TOUS les textes UI (placeholders, lanceur, attente conseiller,
  formulaire lead, erreurs, tooltips CSAT), 'auto' = navigator.language —
  les chaînes FR sont GELÉES À L'OCTET dans I18N.fr (contrat e2e). Côté IA :
  locale='auto' → build_system_prompt ajoute « Réponds dans la langue du
  visiteur » (kwarg locale, défaut None = comportement historique). Le contenu
  d'ARBRE reste tel qu'écrit par le client (non traduit, documenté).
- Gating par plan : insights seulement (payants). free reste tree-only de
  fait (pas d'actions/MCP/insights) mais CSAT/triggers/locale/funnel
  fonctionnent en mode arbre.

### Routes frontend (split admin / user)
- `/` landing publique (Bricolage Grotesque + Instrument Serif, blobs, démo
  widget interactive ; tarifs servis par GET /api/public/plans, carte Free,
  features reformulées sur ce qui est réellement appliqué) · `/login` ·
  `/register` (wizard Personnel/Entreprise + invitations)
- Mode user : `/app` Mes chatbots · `/app/bots/new` wizard · `/app/bots/:id`
  page bot · `/app/team` Équipe & permissions · `/app/billing` Facturation ·
  `/app/orgs` Mes organisations · `/app/profile` Profil
- Mode admin (superadmin) : `/admin` dashboard opérateur (AdminDashboard) ·
  `/admin/clients` table clients (AdminHome) + `/admin/clients/:orgId` ·
  `/admin/invoices` factures Stripe · `/admin/users` comptes (lecture seule)
- Layout.tsx = deux shells dans le même composant, mode déduit de
  `pathname.startsWith('/admin')`. Un superadmin bascule entre les deux et
  utilise les MÊMES pages client que les clients.

### Sécurité du widget (empilée)
1. `pk_...` publique → 2. vérif Origin vs `allowed_domains` (wildcards ; localhost si ENV=dev)
→ 3. captcha au handshake → JWT 30 min → 4. rate limits Redis (session 20/10min, IP 100/min)
→ 5. payload max 4000 chars, historique 20 msg → 6. cap quotidien bot + quota mensuel org
→ mode dégradé tree-only → 7. prompt/modèle verrouillés serveur.

**Cas iframe** (`/widget-frame`) : l'Origin devient celui de l'API → la whitelist est
vérifiée sur le domaine de la PAGE PARENTE (`parent_url` = document.referrer envoyé
par le widget en mode `data-inline`). Bootstrap GET toléré sans parent (design public).

### Parcours visiteur (journey)
Pur contexte IA, aucune UI : widget.js enregistre les pathnames à chaque chargement
(sessionStorage `kc_journey`, {p, t}, dédup, cap 10) et les envoie au handshake
(champ `journey` du POST session, `Optional[Any]` → jamais de 422) →
`_sanitize_journey` (widget.py : validation stricte mais silencieuse, sinon None) →
`Conversation.journey` (JSON, NULL si absent) → bloc « Parcours du visiteur » dans le
system prompt (ai_service), branche IA uniquement, jamais en mode arbre.
Cas iframe : pathname tiré de document.referrer (même mécanisme que parent_url) ;
Referrer-Policy stricte → journey null (dégradation propre).

### Auto-login admin dev
`AUTO_LOGIN_ADMIN_DEV=true` + ENV=dev : seed de ADMIN_EMAIL/ADMIN_PASSWORD au
démarrage, endpoint POST /api/auth/dev-login sans credentials, le frontend
l'appelle automatiquement si aucun token. Inopérant en prod (404).

## Design

L'UI implémente le prototype « Kertios Chat » exporté de claude.ai/design
(handoff lu dans C:\tmp\kertios-design\pkg, jetable). Décisions actées :
- Thème « Fresh Mint » (#0d9488) en variables CSS dans app/src/styles.css,
  Public Sans + JetBrains Mono, logo dans app/public/brand/.
- AUCUN emoji dans l'UI : icônes lucide-react uniquement (même librairie
  qu'ao_scrapping), imports nommés, tailles 11-17px. Le widget vanilla utilise
  des constantes SVG inline (mêmes tracés). Les badges du menu intégrations
  sont du texte mono ("</>", "W", "GTM", "npm", "ifr").
- Shell sidebar 222px (Layout.tsx) : logo, org switcher (initiales colorées),
  nav, bloc plan/crédits ; vue admin avec MRR.
- Primitives dans app/src/ui.tsx : Card, Chip, Btn, Seg, Toggle, Stat, Bars,
  Meter, InfoBox, BubbleIcon (icônes SVG chat/spark/help), statusChip/modeChip.
- design_json (models/bot.py) suit les tokens du prototype : icon
  (chat|spark|help|image), avatarImage, secondaryColor (dégradé), bordered
  (liseré), loadingAnimation (dots|wave|pulse), size, borderRadius, position
  — PLUS 8 clés de personnalisation étendue : font (system|serif|mono, stacks
  système, AUCUNE police externe chargée), headerStyle (solid|soft), darkMode
  (bool strict), bubbleStyle (rounded|square), density (cozy|compact),
  launcherText (≤40 chars → pilule du lanceur), offsetX/offsetY (0-120,
  défaut 18). Rétro-compat garantie : un design SANS ces clés rend
  pixel-identique (défauts = rendu historique, vérifié au runtime). Aucune
  migration (colonne JSON).
- **Règle de parité design** : toute nouvelle clé design_json doit être
  ajoutée aux QUATRE endroits — DEFAULT_DESIGN (models/bot.py),
  _sanitize_design (routers/widget.py : SEULE sanitisation, au bootstrap
  uniquement — le PATCH stocke tel quel), widget/widget.js css(d) (whitelist
  locale), WidgetPreview.tsx (mêmes hex/défauts) — plus AppearanceForm si
  éditable. APPEARANCE_PRESETS (botConstants.ts) = presets de thèmes en merge
  PARTIEL sur le design courant ; `locale` est HORS presets (presetMatches
  l'ignore) — Seg « Langue du widget » (auto|fr|en, défaut fr) dans la
  section Messages d'AppearanceForm, !compact. Parité v4 COMBLÉE :
  WidgetPreview embarque PREVIEW_I18N (miroir manuel des clés RENDUES de
  I18N widget.js — fr À L'OCTET = contrat e2e), simule le CSAT (pouces
  locaux, jamais sur les bulles système/« Conseiller ») et le flux LIVE des
  nœuds handoff (badge LIVE, étiquette « Conseiller », saisie active) mais
  PAS les triggers (trop intrusif, panneau toujours ouvert — hint dans la
  Card de l'éditeur, décision commentée dans le fichier).
- BotPage = pattern « savedBot » : photo du dernier état serveur, dirty dérivé
  PAR ONGLET (TAB_FIELDS aligné sur FIELD_PERMS + secrets byok/captcha/actions/mcp),
  save bar STICKY en dernier enfant du flux (.save-bar, bottom:14px) avec UN
  SEUL bouton au nom accessible exact « Enregistrer » (contrat e2e strict mode
  — ne JAMAIS réintroduire celui du header), Annuler = deep-clone de savedBot,
  Ctrl+S global via refs. Le body du PATCH est limité aux champs des onglets
  dirty croisés avec les permissions.
- BotPage = 11 onglets en 3 groupes séparés par `.tab-sep` (calculé sur
  visibleTabs : jamais de séparateur orphelin) — mesure : Stats · Insights ·
  Leads · Inbox / construire : Arbre · Bot & IA · Actions · Connaissances /
  diffuser : Apparence · Sécurité · Intégration. Libellés historiques
  inchangés À L'OCTET ; tout NOUVEL onglet doit éviter une sous-chaîne des
  libellés existants (getByRole name = match sous-chaîne insensible à la
  casse) — d'où « Connaissances », « Inbox », « Insights ».
  « Connaissances » (perm context) et « Insights » (perm context) NON gatés
  par aiTabRelevant (le CTA upgrade Insights doit rester visible sur free) ;
  « Inbox » = perm inbox, pastille « à prendre » (compteur human_requested,
  poll 30 s gaté hasPerm('inbox')) — pastilles/compteurs dans les boutons
  d'onglet TOUJOURS aria-hidden.
- KbPanel / InboxPanel / InsightsPanel vivent HORS save bar : CRUD/actions
  immédiats, erreurs dans des divs LOCALES — le canal setError reste réservé
  au save (contrat savebar.spec). Pollings avec cleanup obligatoire : KB 4 s
  (chaîne setTimeout tant que pending), Inbox 5 s (liste + transcript, monté
  seulement onglet ouvert), pastille onglet 30 s (BotPage).
- handoff_webhook_url : champ UI dans l'onglet SÉCURITÉ mais perm serveur
  context → carte rendue si hasPerm('context') + garde dédiée dans save() ;
  rangé dans TAB_FIELDS.security (pas de faux dirty : l'API masque à null
  sans la perm, dans bot ET savedBot).
- A/B test (onglet Arbre) : TAB_FIELDS.tree =
  tree_json + tree_variant_json + ab_split_pct ; le save du groupe tree
  envoie TOUJOURS tree_variant_json (null EXPLICITE = désactivation — SEUL
  champ où null n'est pas ignoré au PATCH) ; UN SEUL TreeBuilder monté à la
  fois (state treeView + effet de garde + key="a"/"b"), la vue B sans
  onExport/onImport/botId/canGenerate. 422/403 plan (variante soumise à
  max_tree_nodes) affichés tels quels par la save bar.
- Triggers proactifs : éditeur dans l'onglet APPARENCE
  (TAB_FIELDS.appearance = name/design_json/mode/triggers_json, perm
  appearance) ; value envoyée en Number STRICT (int serveur), exit_intent
  SANS clé value, once_per_session ?? true en lecture, changement de type =
  reconstruction avec value au défaut du type.
- InsightsPanel : groupe mesure juste après Stats ; « Pré-remplir dans
  l'arbre » remonte à prefillFromInsight (BotPage) qui ajoute un nœud + une
  option racine au tree_json LOCAL (arbre A, jamais la variante) puis
  switchTab('tree') — la save bar qui apparaît est contractuelle.
- StatsPanel exige les props tree/variantTree/abSplit (depuis BotPage) ;
  exits/exit_rate du funnel affichés TELS QUELS (jamais recalculés —
  événements orphelins comptés dans count mais exclus des exits) ; mapping
  node_key→label = logique nodeLabel de TreeBuilder (arbre A puis variante B
  suffixée « (variante B) », clé brute mono si nœud supprimé).
- Onglets ai ET actions masqués quand mode=tree ou plan tree_only ; Leads
  visible dans tous les modes (perm context). Import config.json masqué aux
  members sans appearance+context (l'API exige la perm de CHAQUE champ importé).
- Onglet Arbre = builder VISUEL (components/TreeBuilder.tsx) mappé sur notre
  format tree_json (une option = un nœud cible ou "__ai__") + export/import
  JSON + nœuds typés (Seg « Type de réponse » à 4 options dont handoff
  « Conseiller », champ URL, cases fields) — le retour à « message » SUPPRIME
  toujours la clé type (contrat inchangé).
  Libellés e2e intouchables : « Arbre de décision », « Ajouter un choix
  racine », « Nouveau choix », « Message d'accueil ».
  `.seg` est désormais flex-wrap : un Seg étroit (inspecteur TreeBuilder
  320px, 4 types) replie ses boutons au lieu de déborder.
- Team : matrice perm-matrix dans une section « Permissions par bot » TOUJOURS
  rendue (sélecteur de membre Seg/select, dès 1 membre), plus de dépli inline
  par ligne ; invitations en attente listées. PERMS = 6 colonnes, « Boîte de
  réception (chat humain) » (inbox) EN FIN — ordre aligné sur BOT_PERMS,
  les 5 premières colonnes et la légende existante NON reformulées (e2e).
- BotCard (BotList.tsx) : export conservé, signature {bot,onOpen,canCopy}
  (importée par Admin.tsx) ; canCopy=false = footer entièrement omis.
  Décision actée v4 : PAS de badge « live » (human_requested) sur les cards —
  la liste des bots ne porte pas l'info et l'ajouter exigerait un endpoint
  dédié ou un N+1 ; la pastille de l'onglet Inbox (BotPage) couvre le besoin.
  Ne pas l'attendre en e2e/docs.
- Aperçu live du widget : components/WidgetPreview.tsx (réplique React du
  widget, navigue le vrai tree_json en local, IA simulée) dans PreviewFrame
  (faux site client). Le widget réel (widget/widget.js) suit les mêmes specs.
- Wizard 5 étapes : Les bases → Intelligence → Apparence → Sécurité (Turnstile
  imposé, affinable ensuite) → Intégration. Création réelle au passage 4→5.
  Étape Arbre (mode tree UNIQUEMENT — hybrid/ai gardent STARTER_TREE sans
  étape, limitation actée) : galerie « Partir d'un modèle » (TREE_TEMPLATES,
  botConstants.ts : 4 arbres sectoriels e-commerce/services/restaurant/SaaS,
  ≤10 nœuds, sans __ai__, nœuds typés lead/appointment) avec aperçu avant
  application (deep clone + confirm si l'arbre courant a été édité) —
  galerie TOUJOURS AU-DESSUS du builder, jamais à sa place (contrat
  wizard-tree.spec).
- 5 intégrations servies par /api/bots/{id}/embed : html, wordpress, gtm,
  react (injection useEffect), iframe.

## Pièges connus

- Multi-worker uvicorn OK avec REDIS_URL (limiteurs partagés via Redis) ; sans
  Redis (ou panne), repli mémoire fail-open PAR PROCESS → 1 seul worker dans ce cas.
- Rate-limit auth (10 login+register / 15 min / IP) PERSISTANT dans Redis : un
  restart api ne le purge plus → `docker compose exec redis redis-cli FLUSHALL`.
  En dev l'IP vue est la gateway Docker, partagée par tout le trafic hôte.
- `docker compose down -v` efface DB ET volume redis ET cache fastembed ET
  invalide e2e/.state.json (le global-setup Playwright le recrée au run suivant).
- POST /api/auth/password partage l'auth_limiter (10/15min/IP) avec
  login/register. Le global-setup e2e fait le FLUSHALL automatiquement
  (helper `flushRedis`, ré-appelé en beforeAll de profile.spec en assurance
  budget) — plus besoin de purge manuelle avant un run.
- Budget auth e2e PAR RUN : le global-teardown efface .state.json → chaque run
  est un setup FRAIS = 2 registers API (compte principal + member) ;
  register-perso.spec = 1 register UI ; profile.spec ≤ 4 POST /password après
  son propre FLUSHALL. Budget TOTAL/run ≤ 3 registers, couvert par le FLUSHALL
  du setup. Les specs v4 = 0 register (state + createBot jetable). Tout nouveau
  spec doit RÉUTILISER state/dev-login/orgs jetables (createOrg / createBot :
  non rate-limités) plutôt que register. NETTOYAGE : le global-teardown purge en
  base toutes les données e2e à la fin du run (orgs « E2E » + comptes
  @e2e-chapote.fr, cf. global-teardown.ts) — plus d'accumulation, plus besoin de
  `docker compose down -v` pour la propreté (down -v reste pour un reset total).
- e2e + MOCK_AI=false (vraies clés) : AUCUN spec n'exerce l'IA — bots tree
  (ou hybrid pour rendre l'onglet Actions, widget jamais ouvert), pas de
  "__ai__", pas de tree/generate. Webhooks d'action de test →
  https://e2e.invalid (TLD réservé RFC 2606, jamais résolu) ; Calendly 100 %
  stubé (interceptCalendly posé AVANT toute navigation) ; 1 SEUL POST
  /api/widget/lead réel par run (lead_limiter 5/h/session). Specs v4 idem :
  kb.spec = ingestion/recherche 100 % LOCALES (fastembed ONNX CPU, modèle déjà
  en cache fastembed_cache, AUCUN provider) ; inbox-live = handoff par NŒUD
  d'arbre (opt-in, pas d'IA) + reply staff source='human' (hors quotas) ;
  triggers/ab/wizard-templates = édition pure, pas de chemin IA. Limiteurs par
  session widget respectés : inbox-live = 1 handoff (cap 3/h) + 1 feedback
  (cap 30/h) + poll natif 2,5 s (cap 60/min) — très en deçà des plafonds.
- e2e specs v4 — pièges de sélecteurs/timing : kb.spec setTimeout 220 s
  (1er embed = chargement ONNX depuis le cache, attente « Prête » ≤ 180 s) et
  `td.mono` cible BIEN la seule cellule chunk_count (les autres .mono sont des
  span/div) ; libellés à isoler exact:true / scope card sinon collision
  getByRole/getByLabel (sous-chaîne) : « Texte libre », « Message » du trigger
  vs « Message d'accueil (mode IA) » d'AppearanceForm (scoper la card
  « Déclencheurs proactifs »), « Arbre de décision » (exact:true, count 1 par
  vue), extraits liste Inbox `.inbox-row` préfixés « Visiteur : »/
  « Conseiller : » (distincts des headers transcript). ab.spec ET kb.spec :
  BotPage ne fetch plus /usage (supprimé avec les plans) → l'attente anti-flake
  porte désormais sur `GET /api/bots/{id}` (fetch du bot au chargement) ;
  ab.spec enveloppe en plus activer/désactiver de la variante B dans un
  `expect(...).toPass()` (le clic peut tomber pendant le re-render et être avalé).
- Accessibilité : un Seg dans `<Field>` donne le texte du label comme nom
  accessible à son PREMIER bouton (label → labelable) → utiliser `exact:true`
  dans les sélecteurs Playwright.
- Contrats e2e côté UI : libellés « Mes chatbots » / bouton unique
  « Enregistrer » (BotPage) / libellés TreeBuilder (cf. Design), OrgSwitcher,
  clés localStorage cbsaas_token / cbsaas_org / kc_no_autologin ; save bar =
  `role="status"` (sélecteur des specs savebar/actions) ; messages assertés
  VERBATIM : « Mot de passe actuel incorrect », préfixe « Changement de plan
  impossible : », « Paiement en ligne non configuré », « Paiement annulé —
  aucun changement effectué. », « Facturation en ligne non configurée ».
- Stripe : le plan payé n'est appliqué QUE par le webhook — sans
  `stripe listen` (ou endpoint joignable), un checkout réussi ne change
  jamais le plan. Une config STRIPE_* partielle refuse de démarrer en prod.
- Overlay RDV (nœud appointment) en mode script : si le site client a une
  CSP, il lui faut frame-src https://calendly.com https://*.calendly.com
  https://cal.com https://*.cal.com ; le mode /widget-frame n'est pas affecté.
- Webhooks sortants (action_executor) : ne JAMAIS copier le pattern laxiste de
  fetch_page_text — résolution DNS unique + connexion épinglée sur l'IP
  validée (anti SSRF/DNS-rebinding), aucun redirect ; le risque résiduel de
  rebinding est accepté et documenté dans le module.
- CORS `/api/widget/*` + `/uploads` volontairement ouvert (middleware main.py) :
  le vrai contrôle est la whitelist par bot.
- Pas de SRI sur les scripts (widget + captchas) : mutables par design.
- Schéma géré par Alembic (api/alembic/). Chaîne : baseline 0242068a8d9d ←
  b3c04b0ad8f6 (stripe sur organizations) ← e5e1b937aba6 (actions_json +
  table leads) ← e2c624608aa0 (kb pgvector) ← 00b96197eb23 (live chat) ←
  f4a91c27d3b8 (FTS unaccent) ← 0a25919f448f (connecteur MCP) ←
  960e241f162a (analytics et growth) = head. Les révisions v4 sont ÉCRITES À
  LA MAIN (Vector custom, colonne GÉNÉRÉE, index HNSW/GIN : non générables) ;
  kb_chunks.embedding/tsv sont mal compris d'Alembic → tout futur
  --autogenerate peut produire du BRUIT sur ces colonnes, relire la révision
  avant de sauvegarder. Le lifespan
  exécute `alembic upgrade head` au démarrage (advisory lock Postgres = safe en
  multi-worker). Changement de schéma = modifier models/ PUIS
  `docker compose exec api alembic revision --autogenerate -m "..."` (le fichier
  atterrit dans api/alembic/versions/ via le bind mount) et relire la révision.
  Tout NOUVEAU module models/ doit être importé dans models/__init__.py ET
  api/alembic/env.py (sinon metadata aveugle, cf. kb.py/analytics.py).
  Plus jamais de create_all. ATTENTION en dev : --reload surveille /app/alembic
  → toute révision écrite/sauvegardée est APPLIQUÉE immédiatement au reload ;
  supprimer une révision déjà appliquée casse `alembic current` (re-stamper via
  UPDATE alembic_version en psql).
- `.env` : ne pas utiliser USER/PASSWORD comme noms (collision $USER sous Linux
  dans compose) → ADMIN_EMAIL/ADMIN_PASSWORD et SMTP_USER/SMTP_PASSWORD
  (préfixés) sont les noms canoniques.
- Nouvelles env (compose + .env.example) : SMTP_HOST/PORT/USER/PASSWORD/FROM
  (HOST vide = fallback log, jamais bloquant), STRIPE_SECRET_KEY /
  STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_STARTER|PRO|AGENCE (les 5 vides en dev
  = billing désactivé), FASTEMBED_CACHE_PATH / EMBEDDINGS_MODEL (RAG, défauts
  sains — ne toucher qu'en connaissance de cause, cf. piège embeddings).
- db = image `pgvector/pgvector:pg15` (bascule depuis postgres:15, MÊME PG 15,
  volume de données conservé). Piège vécu : mismatch de collation glibc
  (2.41 → 2.36) au changement d'image — corrigé en dev par `REINDEX DATABASE`
  + `ALTER DATABASE ... REFRESH COLLATION VERSION` ; À REFAIRE EN PROD après
  la bascule. L'extension vector est créée par la migration, pas par l'image.
- Embeddings : EMBEDDINGS_MODEL = sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
  (fallback : intfloat/multilingual-e5-small, choix initial, est ABSENT du
  registre fastembed 0.8). Préfixes `query:`/`passage:` appliqués SEULEMENT si
  « e5 » dans le nom du modèle. Changer de modèle = dimension potentiellement
  ≠ 384 → vérifier vector(384) ET ré-ingérer toutes les sources.
- Cache modèle : volume `fastembed_cache:/var/cache/fastembed` (hors /app :
  zéro interaction avec le watcher --reload). Download ~241 Mo au PREMIER
  embed → première source pending plusieurs minutes, c'est normal ;
  `docker compose down -v` efface aussi ce volume (re-download au prochain
  usage, non bloquant). Échec de chargement → _failed jusqu'au restart du
  process, recherche en FTS seul (embedding NULL sur les chunks ingérés
  pendant la panne : re-créer la source pour les vectoriser).
- Nouvelles deps Python (fastembed, pypdf) : `docker compose build api`
  obligatoire, le bind-mount ne couvre pas les dépendances.
- Prompt injection par le contenu ingéré : les chunks KB (site/PDF du client)
  reviennent au modèle en tool_result — contenu NON fiable par construction.
  Mitigation : texte brut re-nettoyé, extraits bornés (600 chars × 5, payload
  2000), system prompt verrouillé serveur ; risque résiduel accepté (même
  posture que les réponses de webhooks d'actions).
- Live chat : le limiteur de /message passe APRÈS le fetch bot/conversation
  (choix human_msg_limiter vs session_limiter selon le statut — coût DB sur
  requête limitée, accepté). Le poll a son budget IP DÉDIÉ (poll_ip_limiter
  600/min) : ne JAMAIS le faire passer par _check_ip_flood (100/min partagé).
  Token widget en mémoire seule : reload de page = nouvelle conversation
  (couvert par timeout 15 min + close staff). 401/404 au poll = retour normal
  silencieux côté widget, jamais de re-handshake (sinon conversation fantôme).
- handoff_webhook_url EST un credential (token Slack/Teams dans le chemin de
  l'URL) : masqué en lecture API sans perm context (flag handoff_webhook_set),
  exclu de config.json, jamais loggé en entier (hostname seul).
- GET /api/bots/{id}/conversations : pour « toutes », le paramètre `status`
  doit être OMIS — `status=` vide renvoie 422 « Statut inconnu » (InboxPanel
  construit l'URL conditionnellement).
- Le 403 « réservé aux plans payants » de insights/generate ET tree/generate
  est BYPASSÉ pour les superadmins (bots.py `if not user.is_superadmin`),
  alors que les limiteurs (insights 3/jour/org, treegen 10/24h/org)
  s'appliquent à tous : un superadmin sur une org free obtient 422/429,
  jamais 403 — en MOCK_AI=false il peut donc déclencher une VRAIE analyse
  sur une org free si le bot a des messages ai (le gating UI treeOnly est la
  seule barrière dashboard).
- Bot 181 (org 36) = playground des vérifications visuelles v4 en dev : peut
  porter des triggers/données de test — toute vérification doit photographier
  PUIS restaurer son état (tree_json/triggers_json/design_json).
