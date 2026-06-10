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
de bots ; tree illimité), clés managées ou BYOK.

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
│   ├── config.py      # Settings env (intranet, auto-login admin, caps widget)
│   ├── database.py    # SQLAlchemy async
│   └── security.py    # JWT scope=dashboard|widget, require_superadmin, require_org_access
├── models/            # SQLAlchemy + Pydantic dans le même fichier
│   ├── user.py        # User / Organization / Membership (many-to-many) + PLANS
│   ├── bot.py         # Bot (organization_id) : tree_json, design_json étendu, captcha, BYOK
│   └── conversation.py  # Conversation (+ colonne journey JSON nullable) / Message
├── routers/
│   ├── auth.py        # register (crée l'org), login (intranet→local), dev-login, me (avec orgs)
│   ├── orgs.py        # usage du plan, POST /{id}/plan (changement self-serve), membres
│   ├── bots.py        # /orgs/{id}/bots (liste/create, limite plan) + /bots/{id} (accès org)
│   │                  # + config.json export/import + embed (html/iframe/gtm/wordpress)
│   ├── admin.py       # superadmin : orgs+compteurs, patch plan/suspension, bots/membres par org
│   ├── uploads.py     # images (avatar, lanceur) -> volume /app/uploads
│   ├── widget.py      # PUBLIC : bootstrap → session (captcha+origin→JWT, _sanitize_journey) → message
│   └── stats.py       # stats par bot (accès via require_org_access)
└── services/
    ├── auth_service.py  # intranet Kertios (POST mail/mdp, flux ao_scrapping) → superadmin
    ├── tree_engine.py   # "__ai__" = bascule IA
    ├── ai_service.py    # anthropic/openai/gemini via httpx, MOCK_AI en dev,
    │                    # journey injecté dans le system prompt (build_system_prompt)
    ├── captcha.py       # turnstile / recaptcha_v3 / disabled
    ├── rate_limit.py    # Redis (ZSET, REDIS_URL) fail-open → repli mémoire process
    ├── usage_service.py # caps quotidien bot + quota mensuel org + limite bots du plan
    └── crypto.py        # Fernet (BYOK, secret reCAPTCHA)

app/src/
├── AuthContext.tsx    # user + organizations + activeOrg (localStorage) + auto dev-login
├── Layout.tsx         # switcher d'org, nav Facturation, lien Admin (superadmin), pill usage
├── botConstants.ts    # MODELS par provider, CAPTCHA_INFO (encarts RGPD),
│                      # PLANS_INFO (miroir manuel de PLANS côté API)
├── components/
│   ├── AppearanceForm.tsx  # design complet + aperçu live (gradient, tailles, images, anim)
│   └── StatsPanel.tsx
└── pages/
    ├── Login.tsx      # login (intranet ou local) / register avec nom d'organisation
    ├── BotList.tsx    # cards par org active, copier l'intégration, CTA → wizard
    ├── BotWizard.tsx  # étapes dynamiques selon mode : Nom&type → [IA] → [Arbre] →
    │                  # Apparence → Sécurité → création réelle → Intégration → page bot
    ├── BotPage.tsx    # onglets : Stats | Mode & IA | Arbre | Apparence | Sécurité | Intégration
    ├── Billing.tsx    # plan actuel, conso du mois, changement de plan (POST /orgs/{id}/plan)
    └── Admin.tsx      # clients dépliables (plan, suspension, bots cliquables, membres)

widget/widget.js       # vanilla JS : flottant ou data-inline (iframe), gradient/size/radius/
                       # images/animations, journey (sessionStorage kc_journey), servi par l'API

e2e/                   # Playwright : global-setup API (compte+org+bot → .state.json gitignoré),
                       # opt-out auto-login via clé localStorage kc_no_autologin
```

## Concepts clés

### Multi-tenant, rôles & permissions
- `User` ←(Membership: admin|member)→ `Organization` (type perso|entreprise) :
  une personne peut appartenir à plusieurs clients. Perso = même architecture,
  une seule personne, convertible en entreprise (PATCH /orgs/{id} type, jamais l'inverse).
- Bots, quotas et plans portés par l'**organisation**. `PLANS` dans models/user.py :
  free = mode ARBRE uniquement (`tree_only`) + 10 bulles max (`max_tree_nodes`) + 0 IA ·
  starter 500 IA/1 bot/19€ · pro 2000/3/39€ · agence 10000/10/119€ (alignés sur la landing).
  Contraintes appliquées par `_check_plan_constraints` (routers/bots.py), superadmin bypass.
- **Génération d'arbre par IA** : POST /api/bots/{id}/tree/generate {source_text|url}
  (services/tree_generator.py, claude-sonnet-4-6, clé managée, plans payants, perm context).
  Retourne le tree_json sans le sauvegarder — le client prévisualise puis enregistre.
- TreeBuilder : la cible d'un bouton est retargetable vers un nœud EXISTANT (boucles/retours)
  via le select « Cible du bouton » ; suppression de bot = bouton zone danger (admins d'org).
- **Permissions par bot** des members : `Membership.permissions = {"<bot_id>": ["copy","test","appearance","context","security"]}`.
  Appliquées par l'API : `FIELD_PERMS` dans routers/bots.py mappe chaque champ
  PATCHable sur une permission ; embed→copy, config.json→context, delete/create→admin d'org.
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

### Routes frontend
- `/` landing publique (Bricolage Grotesque + Instrument Serif, blobs, démo
  widget interactive, tarifs) · `/login` · `/register` (wizard Personnel/Entreprise + invitations)
- `/app` liste des bots · `/app/bots/new` wizard · `/app/bots/:id` page bot ·
  `/app/team` Équipe & permissions (matrice par bot) · `/app/billing` Facturation
- `/admin` + `/admin/clients/:orgId` back-office superadmin

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
  (liseré), loadingAnimation (dots|wave|pulse), size, borderRadius, position.
- Onglet Arbre = builder VISUEL (components/TreeBuilder.tsx) mappé sur notre
  format tree_json (une option = un nœud cible ou "__ai__") + export/import JSON.
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
- `PLANS_INFO` (app/src/botConstants.ts) = miroir manuel de `PLANS`
  (models/user.py) : resynchroniser à chaque changement de plan.
- CORS `/api/widget/*` + `/uploads` volontairement ouvert (middleware main.py) :
  le vrai contrôle est la whitelist par bot.
- Pas de SRI sur les scripts (widget + captchas) : mutables par design.
- Schéma géré par Alembic (api/alembic/, baseline 0242068a8d9d) : le lifespan
  exécute `alembic upgrade head` au démarrage (advisory lock Postgres = safe en
  multi-worker). Changement de schéma = modifier models/ PUIS
  `docker compose exec api alembic revision --autogenerate -m "..."` (le fichier
  atterrit dans api/alembic/versions/ via le bind mount) et relire la révision.
  Plus jamais de create_all. ATTENTION en dev : --reload surveille /app/alembic
  → toute révision écrite/sauvegardée est APPLIQUÉE immédiatement au reload ;
  supprimer une révision déjà appliquée casse `alembic current` (re-stamper via
  UPDATE alembic_version en psql).
- `.env` : ne pas utiliser USER/PASSWORD comme noms (collision $USER sous Linux
  dans compose) → ADMIN_EMAIL/ADMIN_PASSWORD sont les noms canoniques.
