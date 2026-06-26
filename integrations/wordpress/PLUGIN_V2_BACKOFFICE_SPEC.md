# Plugin WordPress « Chapote Back‑Office » (v2) — Spécification

> Le plugin devient une **UI mince au‑dessus d'une nouvelle API de compte Chapote**,
> scopée à un **token OAuth de scope `plugin`** (jamais le JWT dashboard).
>
> **Décisions actées :**
> 1. Connexion = OAuth « Se connecter avec Chapote » (Authorization Code).
> 2. Paiement = client paie Chapote **en direct** via Stripe Checkout **hébergé** (redirection), retour `/wp-admin`, activation par le **webhook existant**.
> 3. Config dans WP = **intermédiaire** : apparence + activation + ciblage des pages. L'arbre, la base de connaissances et la sécurité restent dans le dashboard Chapote.
>
> Marchand = **Chapote/Kertios en direct** (pas de Stripe Connect). Customer Stripe = User.
> Spec issue de la cartographie du code (réf. `fichier:ligne` ci‑dessous). Le plugin v1 (embed simple) reste la base d'injection.

---

## 1. Principe & dépendances

```
Plugin WP (SPA admin)  ──proxy /wp-json/chapote/v1/*──►  API compte Chapote (/api/account/*, /api/oauth/*)
        │                                                          │
        │ injecte <script .../widget.js data-bot-key=pk_…>         │ réutilise bots / billing / entitlements / webhook
        ▼                                                          ▼
   site public du client                                   Stripe Checkout hébergé → webhook → bot_entitlements
```

- **Aucune logique métier dans WordPress** : il affiche des écrans et appelle l'API.
- Le **token reste côté serveur WP** (proxy) : jamais exposé au JavaScript du navigateur.
- Le **ciblage des pages est 100 % WordPress** (décision « config intermédiaire »).

---

## 2. API de compte à ajouter (côté Chapote)

Tout réutilise l'existant ; la surface neuve est mince.

| Endpoint | Rôle | Réutilise | Auth |
|---|---|---|---|
| `GET /api/oauth/authorize` | Écran de consentement + émet le code one‑time | `get_current_user` (scope dashboard) | session dashboard |
| `POST /api/oauth/token` | `authorization_code` → access(30j)+refresh(90j), code DELETE immédiat | `create_oauth_token` (nouveau, sur `_encode` `security.py:43‑50`) ; pattern `verify_google_id_token` `google_oauth.py:51‑79` | `client_id`+`client_secret` (bcrypt), 5/min/client |
| `POST /api/oauth/refresh` | Rotation : nouveau couple, ancien invalidé | `widget_token_needs_refresh` `security.py:103‑110` | refresh valide, 30/j/user |
| `POST /api/oauth/revoke` | Révoque (delete + blacklist ~5 min) | `decode_token` `security.py:113‑120` | Bearer plugin |
| `GET /api/account/bots` | Liste allégée (nom, status, plan, `public_key`) | `_billable_bots` `billing.py:259‑271` ; `BotOut.from_bot` `bot.py:284‑306` | `require_oauth_token('plugin')` |
| `POST /api/account/bots` | Crée un bot mince (name, mode) + entitlement `inactive` | `create_personal_bot` `bots.py:192‑203` ; `_seed_pending_entitlement` `bots.py:167‑189` | `require_oauth_token` |
| `GET /api/account/bots/{id}` | Détail + status/modules/quota (`resolve`) + `public_key` | `require_bot_access` `security.py:199‑215` | `require_oauth_token` + `require_bot_access` |
| `PATCH /api/account/bots/{id}/appearance` | Édite **uniquement** `design_json` | `_sanitize_design` `widget_helpers.py:172‑282` ; `_strip_notnull_nulls` `bots.py:364‑369` ; gate white‑label `bots.py:489‑491` | + perm `appearance` |
| `GET /api/public/bots/{public_key}/appearance` | Design lecture seule (preview), jamais de 4xx | bootstrap `widget.py:203‑235` | aucune (clé publique) |
| `POST /api/account/bots/{id}/checkout` | Session Checkout hébergée, `success_url`/`cancel_url` → `/wp-admin` | `_open_checkout` `billing.py:819‑877` ; `_line_items_for_codes` `224` ; `_intro_coupon_for` `797` ; `_user_has_subscription` `806` | + `require_billing_owner` `security.py:231‑262` |
| `POST /api/account/bots/{id}/subscription/update \| /cancel` | Changer de plan (prorata) / résilier | `subscription_update` `billing.py:920+` | + `require_billing_owner` |
| **`POST /api/billing/webhook` (inchangé)** | Active après paiement : sub → `bot_entitlements` | `apply_subscription_event` `entitlement_service.py:392` (idempotent par `event.id`) | signature HMAC Stripe |

**Une seule modif intrusive :** rendre `success_url`/`cancel_url` surchargeables dans `create_checkout_session` (`stripe_service.py:180‑182`, fallback = comportement actuel sur `APP_URL`).

**Nouveaux fichiers :** `models/oauth.py` (OAuthApp, OAuthAuthorizationCode, OAuthToken) · `routers/oauth.py` · `services/oauth_service.py` · `require_oauth_token` dans `security.py` · 1 migration Alembic (⚠ créer le revision sur le head courant — piège 2‑heads déjà rencontré).

---

## 3. Flux OAuth « Se connecter avec Chapote »

1. Admin WP clique → `POST /wp-json/chapote/v1/oauth/initiate` (nonce + `manage_options`). WP génère `state` (UUID), stocké en transient 10 min, construit l'URL d'autorisation.
2. Redirection → `GET /api/oauth/authorize?response_type=code&client_id=chapote_wp&redirect_uri=…/wp-admin…&scope=plugin&state=…`.
3. Chapote exige l'admin connecté au dashboard, affiche le **consentement** « Autoriser le plugin WordPress à gérer les bots de [Org] ? ».
4. **Validation stricte** : `client_id` connu, `redirect_uri == ` whitelist exacte (jamais `startswith`), `scope=plugin`. Sur accord → code one‑time (TTL 10 min) lié `(user_id, org_id)`.
5. Retour `redirect_uri?code=…&state=…` (sur `/wp-admin`).
6. La SPA détecte `code`+`state` → `POST /wp-json/chapote/v1/oauth/callback` (nonce).
7. WP vérifie `state` (**égalité exacte**), puis échange **server‑to‑server** `POST /api/oauth/token` (secret jamais exposé au navigateur).
8. Chapote valide le secret (bcrypt), **consomme le code** (DELETE), revérifie `redirect_uri`, émet access+refresh.
9. WP **chiffre** les tokens (AES‑256, clé en `wp-config`, hors DB) → options ; supprime le transient.
10. Appels métier via le **proxy** WP (déchiffre, rafraîchit si exp‑7j avec rotation, forward `Bearer` vers `/api/account/*`).
11. Déconnexion → `POST /api/oauth/revoke` + suppression des options chiffrées.

---

## 4. Flux Paiement (Checkout hébergé)

1. L'admin compose le bot (modules + palier IA via `BotConfigPayload` `billing.py:80`) et **coche le consentement** à l'exécution immédiate (renonciation 14 j, B2C).
2. SPA → `POST /wp-json/chapote/v1/bots/{id}/checkout {config, grouping:'per_bot', consent:true}`.
3. Proxy → `POST /api/account/bots/{id}/checkout` avec `success_url=…/wp-admin…&status=success` / `cancel_url=…&status=cancel`.
4. Chapote : `require_billing_owner` → `_config_to_codes` → `_line_items_for_codes` (**`base` retiré si plan IA**, point 6) → `_intro_coupon_for` (1er mois remisé, **seulement si pas déjà abonné**).
5. `create_checkout_session` (mode subscription, `payment_method_collection='if_required'`, métadonnée `bots`, consentement horodaté) → `{checkout_url}`.
6. La SPA **redirige le navigateur** vers `checkout.stripe.com` (page **hébergée**). TVA = 0 (franchise micro‑entreprise).
7. Paiement (carte demandée seulement si dû>0 après coupon) → retour `success_url` `/wp-admin` → « Paiement reçu, activation en cours ».
8. **Async** : Stripe → `POST /api/billing/webhook` → `apply_subscription_event` projette `status='active'`, modules, quota IA (idempotent).
9. La SPA **poll** `GET /api/account/bots/{id}` → `active` → propose le toggle d'activation + ciblage.

> ⚠️ **Pas d'état `pending_payment`** : la sub est active dès la réussite du Checkout. En cas d'abandon, le bot reste `inactive`, l'admin relance le même checkout. Décalage d'activation possible (webhook async) → **ne jamais activer sur la seule foi du retour client**, toujours poller le statut.

---

## 5. Écrans du plugin

| Écran | Fait | Appelle |
|---|---|---|
| **Connexion Chapote** | Bouton OAuth, état connecté, déconnexion ; gère le retour `code+state` | proxy `/oauth/initiate\|callback\|revoke` |
| **Liste des bots** | Tableau (nom, status, plan, `public_key`) + deep‑link dashboard pour arbre/KB/sécurité | `GET /api/account/bots` |
| **Création de bot** | Modal nom + mode ; renvoie vers Chapote pour la config avancée | `POST /api/account/bots` |
| **Apparence (intermédiaire)** | Éditeur des 39 champs `design_json` + preview live, **validation client miroir** de `_sanitize_design` | `PATCH …/appearance` ; `GET /api/public/bots/{pk}/appearance` |
| **Paiement / Abonnement** | Configurateur modules+IA, consentement, « Souscrire » (redirige Stripe), statut + changer/annuler | `POST …/checkout`, `…/subscription/update\|cancel` |
| **Activation (toggle WP)** | Switch on/off par bot = décide l'injection au `wp_footer` (**100 % WordPress**) | option WP, aucun appel Chapote |
| **Ciblage des pages** | « Tout le site » vs « personnalisé » (inclusions/exclusions pages, CPT, taxonomies) | option WP, aucun appel Chapote |
| **Rappel domaine** | Affiche le domaine WP à ajouter aux `allowed_domains` (sécurité reste côté Chapote) | lien externe |

**Ciblage** : option par bot `chapote_bot_targeting[{id}] = {mode, include_*, exclude_*}`, évalué au `wp_footer` après `is_admin()===false` et `wp_reset_query()` ; exclusions **prioritaires** ; multi‑bots = 0..n balises. Réutilise le pattern d'injection v1 (`chapote-chatbot.php:245‑259`).

---

## 6. Sécurité (checklist)

- **CSRF state** : égalité exacte, TTL 10 min, purge après usage.
- **Code one‑time** : DELETE immédiat ; réutilisation → 400 + alerte.
- **`redirect_uri`** : whitelist `==` strict (jamais préfixe).
- **`client_secret`** : bcrypt, transmis 1 fois, **server‑to‑server** uniquement.
- **Refresh rotation** : nouveau refresh à chaque appel, ancien invalidé (détection rejeu) ; access plafonné 30 j.
- **Scopes** : `plugin` ≠ `dashboard` ; chaque `/api/account/*` revérifie l'ownership (`require_bot_access`/`require_billing_owner`, anti‑énumération 404).
- **Rate‑limit** : 5/min/client (token), 30/j/user (refresh) — réutilise `rate_limit.py`.
- **Stockage WP** : tokens chiffrés AES‑256 (clé en `wp-config`, hors DB) ; jamais en clair ni en variable JS.
- **Proxy obligatoire** : aucun appel JS direct vers Chapote (CORS) ; tout via `/wp-json/chapote/v1/proxy/*` + nonce + `manage_options`.
- **Webhook** : traité par **Chapote**, signature HMAC ; le plugin **ne fait pas confiance au client** pour activer (lit le statut API).
- **Consentement B2C** : case obligatoire au 1er checkout → `consent_immediate_execution_at` (preuve serveur).
- **WordPress.org** : `esc_*`/`sanitize_*`/`wp_kses` partout, pas d'obfuscation, **déclaration des appels externes** (OAuth Chapote + Stripe) au `readme.txt`, `wp_add_privacy_policy_content`, exporter/eraser RGPD.

---

## 7. Plan de livraison phasé

**Backend (réutilisable au‑delà de WordPress) :**

| Phase | Périmètre | Effort | Dép. |
|---|---|---|---|
| **P0** | Socle OAuth : `models/oauth.py` + migration + config `OAUTH_*_EXPIRE_*` + seed client `chapote_wp` | M | — |
| **P1** | Router OAuth (authorize/token/refresh/revoke) + `require_oauth_token` + `oauth_service` + rate‑limit + tests + écran consentement | L | P0 |
| **P2** | API compte : `GET/POST /api/account/bots`, `GET {id}`, `PATCH …/appearance`, `GET /api/public/bots/{pk}/appearance` + tests parité 39 champs | M | P1 |
| **P3** | Checkout WP : `success/cancel_url` surchargeables + `POST …/checkout` + update/cancel + webhook LIVE (config manuelle Stripe) | S | P2 |

**Plugin (front) :**

| Phase | Périmètre | Effort | Dép. |
|---|---|---|---|
| **P4** | Scaffold plugin v2 (Core/Admin/REST/Security/Targeting/Frontend) + build `@wordpress/scripts` + proxy + chiffrement token + héritage settings v1 | L | P1 |
| **P5** | Écrans SPA : connexion, liste, création, apparence (validation miroir + preview) + gestion 401/403 | L | P2, P4 |
| **P6** | Paiement plugin : configurateur, consentement, redirect Stripe, retour, polling statut, changer/annuler | M | P3, P5 |
| **P7** | Activation + ciblage des pages (TargetingEngine `wp_footer`) | M | P4 |
| **P8** | Conformité WP.org + RGPD + i18n FR/EN + audit escaping/nonces + docs | M | P5, P6, P7 |
| **P9** | Durcissement v2 : monitoring abus, PKCE (si mobile), rotation des salts, capability `manage_chapote`, tests rejeu | M | P1, P4 |

**Chemin critique conseillé :** P0 → P1 → P2 → P3 (le backend d'abord — il débloque aussi l'API Partenaire/Palier 2 au sens large), puis P4 → P5 → P6 → P7, et P8/P9 en finition.

---

## 8. Risques & décisions ouvertes

1. **Apparence libre avant paiement** : `design_json` est gratuit pour tous (resolver `ALL_UNLOCKED`). Le plugin peut donc éditer l'apparence d'un bot `inactive`. Seul `poweredBy=false` est gaté → **à confirmer comme voulu**.
2. **White‑label incohérent** : `poweredBy=false` stocké mais le bootstrap **force `true`** sans le module (`widget.py:226‑227`). Le plugin doit afficher l'état **rendu**, pas l'état stocké.
3. **`allowed_domains` hors plugin** : si l'admin oublie d'autoriser le domaine WP, le widget ne répond pas. On n'affiche qu'un rappel (la sécurité reste perm `security` côté dashboard). À évaluer : PATCH optionnel du domaine.
4. **Pas d'état `pending_payment`** + **activation async** : UX à clarifier (polling, pas de confiance au retour client).
5. **`grouping=per_bot`** recommandé (1 sub = 1 bot) ; multi‑bots multiplie les subs et l'intro ne s'applique qu'au 1er.
6. **Mapping bot ↔ post WP** : post‑meta (simple, fragile) vs table de liaison `billing_wordpress_links` (robuste) — **à trancher**.
7. **Chiffrement du token WP** : si DB + `wp-config` exfiltrés, le chiffrement local ne protège plus (compromis documenté, rotation à chaque refresh).
8. **Parité des 39 champs** : tout nouveau champ de `_sanitize_design` doit être répliqué côté plugin → **test de parité en CI (P2)**.

---

> Ce document est la cible. Le plugin v1 (`chapote-chatbot/`) reste livré et fonctionnel ; la v2 le remplace progressivement (l'injection `wp_footer` + le ciblage en héritent).
