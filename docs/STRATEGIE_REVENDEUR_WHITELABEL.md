# Stratégie d'intégration revendeur / white-label

> Comment répondre à une demande de « fusion » avec un éditeur de sites (ou une agence) qui veut
> proposer une **option chatbot** à *ses propres* clients, en s'appuyant sur Chapote.
>
> Document de cadrage produit + technique. Ancré sur l'architecture réelle du repo
> (analyse de code du 2026-06-26). Effort indiqué en S / M / L / XL.

---

## 0. Le vrai choix n'est pas technique, il est commercial

Tout découle d'une seule question : **qui encaisse le client final ?**

1. **L'éditeur achète en gros chez toi et refacture ses clients lui-même** → toi = 1 facture à l'éditeur. *Cheap, livrable en jours.*
2. **Pareil, mais automatisé via une API** pour qu'il provisionne les bots depuis son propre produit. *Moyen.*
3. **Chaque client final paie en direct, l'éditeur prend sa marge, toi une commission** (Stripe Connect). *Lourd, vrai marketplace.*

> Tant qu'aucun partenaire n'exige que ses clients soient facturés en direct, **reste marchand
> (options 1 et 2)** : c'est plus simple, plus rentable par client, et déjà à portée.

---

## 1. Ce que le code permet DÉJÀ (≈ 90 % du Palier 1 est en place)

| Brique existante | Où | Ce que ça débloque |
|---|---|---|
| **Organizations** (multi-tenant, `owner_user_id` = payeur Stripe) | `api/src/models/user.py:68-79` | Une org = le « compte éditeur » qui contient N bots clients |
| **Bot polymorphe `owner_user_id` XOR `organization_id`** | `api/src/models/bot.py:112-196` | Chaque client final = 1 bot dans l'org de l'éditeur |
| **`billing_grouping = per_org`** | `api/src/models/user.py:52` | **1 seule facture Stripe consolidée** sur tout le parc |
| **`BotEntitlement`** (`ai_monthly_quota`, `modules`, `overage_mode/cap`) | `api/src/models/billing.py:35-73` | Quota IA + modules **par client**, posés par webhook |
| **`MODULE_WHITELABEL`** | `api/src/core/constants.py:50` + `api/src/routers/widget.py:225-227` | **Retire le « Propulsé par Chapote »** (déjà industrialisé) |
| **Widget `pk_` + `allowed_domains`** | `widget/widget.js` | Embed `<script data-bot-key=pk_…>` restreint au domaine du client |
| **Metering IA `mtr_ai`** (0,015 €/réponse) | `api/src/services/quota_service.py` | Facturation à l'usage du dépassement |
| **12 rate-limiters + Turnstile + JWT 30 min** | `api/src/services/rate_limit.py` | Anti-abus déjà durci |
| **Widget mode « WordPress »** (un des 5 modes) | `widget/widget.js` | Le terrain est déjà préparé pour un plugin WP |

### Ce qui MANQUE selon le palier visé

- **Clés API machine-to-machine** : aucune table `api_keys` aujourd'hui → bloquant pour le Palier 2.
- **Hiérarchie revendeur** : `Organization` n'a pas de `parent_org_id` (orgs plates) → bloquant pour le Palier 3.
- **Facturation `1 customer Stripe = 1 user`** : `User.stripe_customer_id` global → Stripe Connect (Palier 3) casse cette hypothèse.
- **Quota par bot, pas mutualisé par org** : un « pool de X messages partagé » demande un refactor de `quota_service` (clé Redis par org).
- **Pas de `max_bots`** : aucune limite du nombre de bots par compte aujourd'hui.
- **Pas de web component** : embed via vanilla JS + iframe seulement (pas de `<chapote-chat>`).
- **Pas de webhooks sortants** : seul l'inbound Stripe existe (pas de `lead.received`, `conversation.created`).

---

## 2. Le menu — 3 paliers

### 🟢 Palier 1 — « Plan Entreprise » : éditeur = 1 org, clients = bots — **effort : S (jours)**

C'est **exactement** la demande « allocation de X bots à X messages IA ». Zéro table neuve, zéro nouvelle auth.

- L'éditeur = 1 User payeur + 1 Organization, `grouping = per_org`.
- Chaque client = 1 bot (endpoint org existant), avec son `allowed_domains` et son design.
- `MODULE_WHITELABEL` activé → widget sans la marque Chapote.
- Tu vends un **pack** (ex. 20 bots + 50 000 réponses IA/mois) ; l'éditeur refacture ses clients avec sa marge.

**À ajouter (petit) :**
- `max_bots` sur l'entitlement (+ vérif à la création).
- *(Optionnel)* pool de quota IA par org (refactor `quota_service`, clé Redis par org au lieu de par bot) si tu veux une vraie mutualisation. Sinon : somme des quotas par bot, déjà fonctionnel.

**Modèle éco :** achat en gros (base + palier IA + white-label par bot, sur le `cus_` de l'éditeur via `per_org`), revente au prix de l'éditeur. Marge = prix éditeur − coût Chapote. Dépassement IA (`mtr_ai`) répercuté.

**Limite :** l'éditeur est l'unique payeur (il avance la trésorerie), pas de self-service client, refacturation manuelle.

---

### 🟡 Palier 2 — API Partenaire (clé `sk_` ou OAuth) — **effort : L**

Le Palier 1 rendu **programmatique**. Réponse directe à « API spéciale avec token secret / OAuth + exposer des routes pour que l'éditeur fasse sa propre page de personnalisation ».

L'éditeur intègre Chapote **dans son builder** : quand son client coche « activer le chatbot », son backend provisionne tout via l'API.

**À construire :**
- **Modèle `ApiKey`** `(organization_id, token_hashed, scopes JSON, expires_at, last_used_at, created_by_user_id)` + 1 migration. Clé en clair affichée **une seule fois** (comme les secrets Fernet actuels).
- **Dépendance `require_partner_key(scopes=[…])`** dans `core/security.py`, en parallèle de `get_current_user` (même rang que `require_org_access` / `require_bot_admin`).
- **Routeur `/api/partner/bots`** : `POST` (crée bot + renvoie `pk_`), `PATCH` (`allowed_domains`, `design`), `GET /usage` — **réutilise** `create_bot` existant.
- **Rate-limit par clé** (ZSET Redis, calqué sur les 12 limiteurs existants) + table `api_partner_usage`.
- **OpenAPI ségrégée** `/api/partner/docs`.

**Token secret VS OAuth :** commence par la **clé `sk_` statique** (90 % des éditeurs, DX simple). Ajoute **OAuth `client_credentials`** (`POST /api/oauth/token` → JWT court `scope=partner`) en **variante** pour les jetons rotatifs. Pas besoin des deux au départ.

**Reste sur « éditeur = unique payeur »** : aucune refonte facturation.

**Modèle éco :** tarif de gros + prix par bot actif + quota inclus, facturés sur l'unique customer de l'éditeur. Dépassement via `mtr_ai`. Possibilité d'un palier « partenaire » (remise volume).

---

### 🔴 Palier 3 — Marketplace : hiérarchie d'orgs + Stripe Connect — **effort : XL**

White-label profond : chaque client final facturé **en direct**, l'éditeur encaisse sa marge, toi une commission automatique.

**À construire :**
- `Organization.parent_reseller_org_id` (self-FK) + rôle `reseller_admin` + **filtrage par parent dans CHAQUE endpoint de liste** (risque de fuite inter-client si on en oublie un).
- Stripe **Connect** (Accounts v2, controller properties) → casse `1 customer = 1 user`, **double routage des webhooks** par `event.account`, KYC/onboarding.
- Branding revendeur **global** (logo / « Powered by [Éditeur] » au niveau org).
- Subscriptions sur compte connecté avec `application_fee_percent`.

**Modèle éco :** commission `application_fee_percent` (≈ 15-25 %) sur chaque abonnement revendeur→client, OU forfait plateforme + %. Encaissement direct sur le compte connecté du revendeur.

> ⚠️ À n'engager **que si** « chaque client paie en direct » devient un blocage commercial réel. Sinon, sur-ingénieré.

---

## 3. Les briques transverses (« api / mcp / bot par bot »)

**Surfaces d'intégration — non exclusives :**

| Surface | Pour qui | Palier |
|---|---|---|
| **Bot-par-bot (dashboard + widget)** | Client final ne code rien | 1 |
| **REST API partenaire (`sk_`/OAuth)** | Éditeur avec un backend | 2 |
| **Serveur MCP** (Chapote *comme* serveur MCP : `provision_bot`, `get_usage`) | Plateformes pilotées par agents IA / no-code | 2+ (après) |

**Embed sur le site du client :**
- Aujourd'hui : `<script data-bot-key=pk_…>` + iframe `/widget-frame`.
- **Web component `<chapote-chat>`** (wrapper du `widget.js` existant, ~1-2 semaines) → install « copier-coller » pour Webflow/Wix/no-code.

**Webhooks sortants signés** (`lead.received`, `conversation.created`, `quota.threshold`) :
- **Absents aujourd'hui** (seul l'inbound Stripe existe).
- C'est ce qui pousse les leads dans le CRM de l'éditeur → gros multiplicateur de valeur. À prévoir au Palier 2.

---

## 4. Le plugin WordPress

### Verdict : **OUI, mais c'est un canal de DISTRIBUTION, pas un modèle de revente.**

Un plugin WordPress ne répond **pas** à la question multi-tenant/facturation (ça reste le rôle des Paliers 1-3). C'est une **surface d'installation** qui se pose **par-dessus** le Palier 1 (et idéalement le Palier 2). Mais c'est un **excellent** canal, pour 3 raisons :

1. **Marché énorme + friction nulle.** WordPress ≈ 40 % du web. Beaucoup d'agences/éditeurs construisent les sites clients sur WP. Le plugin remplace le copier-coller de script par un réglage en 2 clics dans l'admin WP.
2. **Le terrain est déjà préparé.** Le `widget.js` a déjà un **mode « WordPress »** : le plugin se contente d'injecter le snippet existant + d'exposer une page de réglages. Lift technique faible pour une v1.
3. **Acquisition gratuite.** Être listé sur le **répertoire WordPress.org** = canal de découverte récurrent et gratuit (SEO, recherche interne WP). Funnel naturel : plugin gratuit (embed) → upsell vers les plans payants Chapote.

### Deux versions — choisir le bon niveau

**v1 — Plugin « embed + connect » (effort : S, ~jours)**
- Page de réglages dans l'admin WP : l'admin **connecte son compte Chapote** (idéalement OAuth, à défaut il colle son `pk_`), choisit **quel bot** afficher.
- Injection automatique du `widget.js` existant (mode WordPress déjà prêt).
- **Bloc Gutenberg** + **shortcode** `[chapote_chat]` pour un placement inline optionnel.
- Le domaine du site est ajouté à `allowed_domains` (manuellement ou via API au Palier 2).

**v2 — Plugin « intégré » (effort : M-L, le vrai différenciateur)**
- **Onboarding « 1 clic »** : le plugin appelle l'**API Partenaire (Palier 2)** pour **créer le bot automatiquement**, alimenté par le contenu du site (pages WP → base de connaissances/RAG). Se marie parfaitement avec la démo existante « 1 URL → chatbot ».
- **WooCommerce** : nourrir le bot avec le catalogue produit + statut de commande (« où est ma commande ? », Q&A produit) — cas d'usage chatbot e-commerce très fort.
- **Sync utilisateurs/contexte** WP pour personnaliser les réponses.
- Réception des leads directement dans WP/WooCommerce via les **webhooks sortants** (Palier 2).

### À garder en tête (les contreparties)

- **Sécurité de la clé** : préférer un **flux OAuth « connecter mon compte »** plutôt que coller une clé secrète dans les options WP (stockage en base WP peu sûr). Le `pk_` (non secret) est OK ; une clé `sk_` ne devrait **jamais** vivre côté WP en clair.
- **Coût de maintenance réel** : versions WP/PHP, compat Gutenberg, **process de revue WordPress.org** (guidelines strictes), tickets de support d'utilisateurs non techniques.
- **Ça ne dispense pas du Palier 2** : une agence qui gère 50 sites WP clients voudra provisionner 50 bots par API — le plugin seul oblige chaque propriétaire de site à coller une clé.

### Place dans la stratégie

> Le plugin WordPress = **accélérateur d'acquisition et d'installation**, à brancher sur le Palier 1
> (v1, tout de suite) puis sur le Palier 2 (v2, provisioning auto + WooCommerce + leads).
> Ce n'est ni un substitut à l'architecture revendeur, ni un prérequis pour elle.

---

## 5. Recommandation : une trajectoire, pas un choix unique

1. **Maintenant → offre « Entreprise / Revendeur » (Palier 1).** Pack « X bots + X réponses IA », white-label inclus, provisioning manuel. Ajouter `max_bots` (+ pool de quota par org si voulu). **Réponse directe à la demande.**
2. **En parallèle → plugin WordPress v1 (Palier 1 + WP).** Canal d'acquisition à faible coût, lift faible (mode WP déjà présent).
3. **Quand un éditeur sérieux signe → API Partenaire (Palier 2)** : clé `sk_` + `/api/partner/bots` + web component + webhooks leads. Débloque aussi le **plugin WordPress v2** (provisioning 1 clic, WooCommerce).
4. **Stripe Connect (Palier 3) seulement si** un partenaire exige la facturation directe de ses clients. Argument commercial, pas chantier immédiat.

**La seule décision qui t'appartient vraiment :** rester **marchand** (éditeur paie en gros, Paliers 1-2) ou devenir une **plateforme de paiement** (Connect, Palier 3). Tant qu'aucun partenaire ne le réclame → **reste marchand**.

---

## Annexe — tableau de synthèse

| Critère | Palier 1 | Palier 2 | Palier 3 | Plugin WP |
|---|---|---|---|---|
| Effort | S (jours) | L | XL | S (v1) / M-L (v2) |
| Code neuf | ~0 (+`max_bots`) | table `ApiKey` + routeur | hiérarchie + Connect | plugin PHP + réglages |
| Qui paie | Éditeur (gros) | Éditeur (gros) | Client final (direct) | n/a (canal) |
| Self-service client | Non | Non | Oui | Selon palier sous-jacent |
| White-label | Oui (`MODULE_WHITELABEL`) | Oui | Oui (global) | Oui |
| Provisioning | Manuel | API | API | 1 clic (v2) |
| Facturation directe | Non | Non | Oui (Connect) | n/a |
| Idéal pour | Démarrer vite | Passer à l'échelle | Marketplace | Acquisition / install |
