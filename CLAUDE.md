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

## Commands

```bash
docker compose up -d --build     # db + redis + api + app (lifespan = alembic upgrade head)
docker compose logs -f api
docker compose down -v           # reset DB + redis (migrations rejouées au démarrage, .state.json e2e invalidé)
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
│   ├── bot.py         # Bot (organization_id) : tree_json, design_json étendu, actions_json
│   │                  # (secrets Fernet, sortie API = secret_set), captcha, BYOK
│   ├── conversation.py  # Conversation (+ colonne journey JSON nullable) / Message
│   └── lead.py        # Lead (table leads : FK bot CASCADE, conversation SET NULL, source tree|ai)
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
│   ├── admin.py       # superadmin : GET /admin/stats (agrégats GROUP BY dashboard opérateur :
│   │                  # MRR sur orgs actives, répartition par plan, conso IA managed du mois,
│   │                  # inscriptions 6 mois via date_trunc), orgs+compteurs, patch
│   │                  # plan/suspension (mêmes garde-fous que le self-serve),
│   │                  # GET /admin/invoices, GET /admin/users, bots/membres par org
│   ├── billing.py     # webhook Stripe (auth = signature HMAC) : applique le plan payé
│   │                  # + _enforce_plan_limits (mise en conformité forcée des bots)
│   ├── uploads.py     # images (avatar, lanceur) -> volume /app/uploads
│   ├── widget.py      # PUBLIC : bootstrap → session (captcha+origin→JWT, _sanitize_journey)
│   │                  # → message · POST /lead (formulaire contact, lead_limiter)
│   └── stats.py       # stats par bot (accès via require_org_access)
└── services/
    ├── auth_service.py  # intranet Kertios (POST mail/mdp, flux ao_scrapping) → superadmin
    ├── tree_engine.py   # "__ai__" = bascule IA ; nœuds typés NODE_TYPES
    │                    # (message | appointment | lead), re-sanitisés au service
    ├── ai_service.py    # anthropic/openai/gemini via httpx, MOCK_AI en dev, journey dans le
    │                    # system prompt, actions IA en tools (boucle bornée MAX_TOOL_TURNS=2)
    ├── action_executor.py # exécution actions IA : webhook signé HMAC X-Kertios-Signature
    │                    # (anti-SSRF strict), capture_lead (persiste un Lead source=ai)
    ├── email_service.py # notification leads : smtplib via to_thread, fallback log sans SMTP_HOST
    ├── stripe_service.py # API REST Stripe via httpx (PAS de SDK) : customer, checkout,
    │                    # portail, vérif signature webhook, invoices, billing_enabled()
    ├── captcha.py       # turnstile / recaptcha_v3 / disabled
    ├── rate_limit.py    # Redis (ZSET, REDIS_URL) fail-open → repli mémoire process ;
    │                    # treegen_limiter 10/24h/org, lead_limiter 5/h/session
    ├── usage_service.py # caps quotidien bot + quota mensuel org + limite bots du plan
    │                    # + plan_change_problems (garde-fous partagés self-serve/admin)
    └── crypto.py        # Fernet (BYOK, secrets d'actions, secret reCAPTCHA)

app/src/
├── AuthContext.tsx    # user (+ auth_source/created_at/last_login) + organizations + activeOrg
│                      # (localStorage) + auto dev-login
├── Layout.tsx         # DEUX shells dans le MÊME composant : mode admin (opérateur) si
│                      # pathname.startsWith('/admin'), sinon mode user ; superadmin = liens de
│                      # bascule entre les deux ; à 0 organisation seuls Mes organisations et
│                      # Profil sont affichés
├── botConstants.ts    # MODEL_OPTIONS par provider, CAPTCHA (encarts RGPD), APPEARANCE_PRESETS
│                      # (presets design en merge partiel), PLAN_LABELS / PublicPlan /
│                      # planFeatures — PLANS_INFO n'existe plus (pricing = GET /api/public/plans)
├── billingUtils.tsx   # partagé Billing/AdminInvoices : invoiceStatusChip, montants Stripe
│                      # en CENTIMES, dates en epoch SECONDES
├── components/
│   ├── AppearanceForm.tsx  # design complet + presets + clés étendues (police, sombre, densité…)
│   ├── TreeBuilder.tsx     # builder visuel + nœuds typés (Seg « Type de réponse »)
│   ├── WidgetPreview.tsx   # réplique React du widget (RDV/lead simulés, mêmes clés que widget.js)
│   └── StatsPanel.tsx
└── pages/
    ├── Login.tsx      # login (intranet ou local) / register avec nom d'organisation
    ├── BotList.tsx    # « Mes chatbots » : BotCard exportée ({bot,onOpen,canCopy}, importée par
    │                  # Admin.tsx ; canCopy=false = footer omis), statut/usage, états vides, CTA wizard
    ├── BotWizard.tsx  # étapes dynamiques selon mode : Nom&type → [IA] → [Arbre] →
    │                  # Apparence → Sécurité → création réelle → Intégration → page bot
    ├── BotPage.tsx    # onglets Stats|Arbre|Bot & IA|Actions|Leads|Apparence|Sécurité|Intégration
    │                  # + save bar sticky (pattern savedBot, dirty PAR ONGLET, Ctrl+S)
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
                       # kc_journey), overlay RDV (Calendly/Cal.com) + formulaire lead, servi par l'API

e2e/                   # Playwright, 28 tests, workers:1 — stack docker UP requise
├── global-setup.ts    # FLUSHALL Redis EN TÊTE (rejouabilité) puis via API : compte
│                      # entreprise plan agence + bot partagé tree (captcha disabled,
│                      # localhost) + member local « Membre E2E » (permissions remises
│                      # à {} à chaque run) → .state.json (gitignoré, réutilisé :
│                      # tryReuse purge les bots dédiés des runs précédents et remet
│                      # bot partagé / arbre / design à plat)
├── helpers.ts         # loadState, blockAutoLogin (kc_no_autologin), authenticateWithToken
│                      # (token posé en localStorage AVANT le 1er chargement),
│                      # devLoginToken (dev-login superadmin, non rate-limité),
│                      # createOrg/createBot jetables (endpoints NON rate-limités,
│                      # noms préfixés « E2E », jamais mode ai)
├── widget-helpers.ts  # NODES_TREE (nœuds appointment+lead), interceptCalendly (stub
│                      # total calendly.com + sous-domaines AVANT navigation : zéro
│                      # réseau réel), openFrame (/widget-frame)
└── tests/             # 6 specs historiques : landing, register-perso (SEUL register
                       # UI), wizard-tree, botpage, widget, team (invitation) ;
                       # 9 specs v3 : profile (renommage, mdp happy+revert sur le
                       # member, 403 sans déconnexion), orgs (création/renommage/
                       # conversion/422 dernier admin), admin-split (4 pages back-
                       # office + redirect non-superadmin), billing (grille public/
                       # plans, applied:true, 422 downgrade, ?checkout=cancelled),
                       # widget-nodes (overlay RDV intercepté, lead → onglet Leads +
                       # CSV), actions (hints + secret_set sans fuite), appearance
                       # (preset + launcherText → bootstrap sanitisé), team-permissions
                       # (matrice : état vide + toggle persisté), savebar (sticky,
                       # pastille d'onglet, Annuler, Ctrl+S)
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
- **Permissions par bot** des members : `Membership.permissions = {"<bot_id>": ["copy","test","appearance","context","security"]}`.
  Appliquées par l'API : `FIELD_PERMS` dans routers/bots.py mappe chaque champ
  PATCHable sur une permission (actions_json→context) ; embed→copy, export
  config.json→context, IMPORT config.json = perm de CHAQUE champ effectivement
  importé (même mapping que le PATCH), delete/create→admin d'org.
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
  classique (rétro-compat des arbres existants) · `appointment` porte une
  `url` https (Calendly/Cal.com) rendue en overlay au-dessus du chat (hôte non
  embarquable → lien seul) · `lead` porte `fields` (email obligatoire, choix
  email/phone/name/message) → formulaire dans le widget. Triple validation :
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
  webhook|capture_lead ; secret HMAC chiffré Fernet — sortie API = flag
  secret_set, secret omis au PATCH = conservé ; EXCLU de config.json
  export/import). Exposées en tools au modèle (formats Anthropic et OpenAI ;
  gemini non branché, loggé). Boucle tool-use bornée MAX_TOOL_TURNS=2
  (ai_service : échanges intermédiaires non persistés, seul le texte final
  l'est ; au dernier tour les tool_use ne sont PAS exécutés). Exécution
  webhook (action_executor) : httpx POST signé HMAC-SHA256 header
  X-Kertios-Signature, timeout 10 s, anti-SSRF strict (https uniquement,
  résolution DNS unique → rejet IP non publiques, connexion épinglée sur l'IP
  validée, aucun redirect), réponse tronquée à 2000 chars avant retour au
  modèle. MOCK_AI : `!action nom {json}` simule un appel déterministe.
- **Côté front** : TreeBuilder = Seg « Type de réponse »
  (message/appointment/lead) — le retour à message SUPPRIME les clés
  type/url/fields (ne JAMAIS écrire type:'message'). WidgetPreview simule
  appointment (overlay SANS iframe tierce dans le dashboard) et lead
  (soumission factice) avec les MÊMES clés que widget.js (type/url/fields) —
  la parité réelle (iframe Calendly/Cal.com, POST /api/widget/lead) vit dans
  widget/widget.js. Onglet Leads (perm context) visible dans TOUS les modes ;
  hint admin si SMTP absent (notification = log seul) ; hint provider gemini
  (actions ignorées) ; CSP frame-src Calendly/Cal.com documentée dans
  l'onglet Intégration.
- **Éditeur d'actions** (onglet Actions, BotPage) : secrets tapés dans
  `actionSecrets` keyed par INDEX ; serializeActions() omet secret_set et
  n'envoie `secret` que si saisi (omis = conservé côté serveur). Le secret
  étant rattaché au NOM côté serveur, renommer une action webhook sans
  ressaisir le secret le SUPPRIME.

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
  PARTIEL sur le design courant.
- BotPage = pattern « savedBot » : photo du dernier état serveur, dirty dérivé
  PAR ONGLET (TAB_FIELDS aligné sur FIELD_PERMS + secrets byok/captcha/actions),
  save bar STICKY en dernier enfant du flux (.save-bar, bottom:14px) avec UN
  SEUL bouton au nom accessible exact « Enregistrer » (contrat e2e strict mode
  — ne JAMAIS réintroduire celui du header), Annuler = deep-clone de savedBot,
  Ctrl+S global via refs. Le body du PATCH est limité aux champs des onglets
  dirty croisés avec les permissions.
- Onglets ai ET actions masqués quand mode=tree ou plan tree_only ; Leads
  visible dans tous les modes (perm context). Import config.json masqué aux
  members sans appearance+context (l'API exige la perm de CHAQUE champ importé).
- Onglet Arbre = builder VISUEL (components/TreeBuilder.tsx) mappé sur notre
  format tree_json (une option = un nœud cible ou "__ai__") + export/import
  JSON + nœuds typés (Seg « Type de réponse », champ URL, cases fields).
  Libellés e2e intouchables : « Arbre de décision », « Ajouter un choix
  racine », « Nouveau choix », « Message d'accueil ».
- Team : matrice perm-matrix dans une section « Permissions par bot » TOUJOURS
  rendue (sélecteur de membre Seg/select, dès 1 membre), plus de dépli inline
  par ligne ; invitations en attente listées.
- BotCard (BotList.tsx) : export conservé, signature {bot,onOpen,canCopy}
  (importée par Admin.tsx) ; canCopy=false = footer entièrement omis.
- Aperçu live du widget : components/WidgetPreview.tsx (réplique React du
  widget, navigue le vrai tree_json en local, IA simulée) dans PreviewFrame
  (faux site client). Le widget réel (widget/widget.js) suit les mêmes specs.
- Wizard 5 étapes : Les bases → Intelligence → Apparence → Sécurité (Turnstile
  imposé, affinable ensuite) → Intégration. Création réelle au passage 4→5.
- 5 intégrations servies par /api/bots/{id}/embed : html, wordpress, gtm,
  react (injection useEffect), iframe.

## Pièges connus

- Multi-worker uvicorn OK avec REDIS_URL (limiteurs partagés via Redis) ; sans
  Redis (ou panne), repli mémoire fail-open PAR PROCESS → 1 seul worker dans ce cas.
- Rate-limit auth (10 login+register / 15 min / IP) PERSISTANT dans Redis : un
  restart api ne le purge plus → `docker compose exec redis redis-cli FLUSHALL`.
  En dev l'IP vue est la gateway Docker, partagée par tout le trafic hôte.
- `docker compose down -v` efface DB ET volume redis ET invalide e2e/.state.json
  (le global-setup Playwright le recrée au run suivant).
- `PLANS_INFO` n'existe plus : le pricing front (Billing + Landing) consomme
  GET /api/public/plans (source unique). La landing garde un `FALLBACK_PLANS`
  local (Landing.tsx) = miroir utilisé en secours RÉSEAU uniquement → à
  resynchroniser si les plans serveur changent.
- POST /api/auth/password partage l'auth_limiter (10/15min/IP) avec
  login/register. Le global-setup e2e fait le FLUSHALL automatiquement
  (helper `flushRedis`, ré-appelé en beforeAll de profile.spec en assurance
  budget) — plus besoin de purge manuelle avant un run.
- Budget auth e2e PAR RUN : setup frais = 2 registers API (compte principal +
  member) ; run reuse (.state.json valide) = 0 ; register-perso.spec = 1
  register UI ; profile.spec ≤ 4 POST /password après son propre FLUSHALL.
  Tout nouveau spec doit RÉUTILISER state/dev-login/orgs jetables (createOrg /
  createBot : non rate-limités) plutôt que register. Les orgs jetables ne sont
  jamais supprimées (pas de DELETE /orgs) : accumulation dev acceptée, purge
  via `docker compose down -v`.
- e2e + MOCK_AI=false (vraies clés) : AUCUN spec n'exerce l'IA — bots tree
  (ou hybrid pour rendre l'onglet Actions, widget jamais ouvert), pas de
  "__ai__", pas de tree/generate. Webhooks d'action de test →
  https://e2e.invalid (TLD réservé RFC 2606, jamais résolu) ; Calendly 100 %
  stubé (interceptCalendly posé AVANT toute navigation) ; 1 SEUL POST
  /api/widget/lead réel par run (lead_limiter 5/h/session).
- e2e + Stripe : le global-setup exige `applied:true` au POST plan agence et
  `tryReuse` vérifie plan=agence dans l'usage — avec STRIPE_* configurés le
  200 renvoie checkout_url et la suite échoue avec un message explicite →
  vider les STRIPE_* du .env pour les runs e2e.
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
  table leads) = head. Le lifespan
  exécute `alembic upgrade head` au démarrage (advisory lock Postgres = safe en
  multi-worker). Changement de schéma = modifier models/ PUIS
  `docker compose exec api alembic revision --autogenerate -m "..."` (le fichier
  atterrit dans api/alembic/versions/ via le bind mount) et relire la révision.
  Plus jamais de create_all. ATTENTION en dev : --reload surveille /app/alembic
  → toute révision écrite/sauvegardée est APPLIQUÉE immédiatement au reload ;
  supprimer une révision déjà appliquée casse `alembic current` (re-stamper via
  UPDATE alembic_version en psql).
- `.env` : ne pas utiliser USER/PASSWORD comme noms (collision $USER sous Linux
  dans compose) → ADMIN_EMAIL/ADMIN_PASSWORD et SMTP_USER/SMTP_PASSWORD
  (préfixés) sont les noms canoniques.
- Nouvelles env (compose + .env.example) : SMTP_HOST/PORT/USER/PASSWORD/FROM
  (HOST vide = fallback log, jamais bloquant) et STRIPE_SECRET_KEY /
  STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_STARTER|PRO|AGENCE (les 5 vides en dev
  = billing désactivé).
