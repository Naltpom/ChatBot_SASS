# Spécification d'implémentation — Facturation modulaire

> Document build-ready unique. Cible : worktree `C:/www/kertios/ChatBot_SASS_billing`, branche `feat/billing-modulaire`. Toutes les références `fichier:ligne` pointent sur `master` (état vérifié). Révision Alembic en tête : **`c3d4e5f6a7b8`** (`api/alembic/versions/2026_06_16_c3d4e5f6a7b8_drop_bots_daily_ai_message_cap.py`).
>
> Ce document fusionne les 6 volets rédigés et **intègre dans le corps** les corrections du relecteur (A1→F7). Les contradictions inter-volets (axe métré, collisions de migrations, schémas divergents, vocabulaire modules, owner d'org) sont **tranchées une fois** ici et font foi.
>
> **Amendement 2026-06-20 (décisions produit) :** grandfathering **supprimé** (app non lancée, 0 client à protéger — seul l'invariant « billing OFF ⇒ tout gratuit » subsiste) ; **aucune TVA** (franchise en base, art. 293 B du CGI — `automatic_tax` désactivé) ; axe métré IA **phasage conservé** (v1 = blocage au quota, v2 = Stripe Meters plus tard). Ces choix sont reflétés dans le corps ci-dessous.

---

## 0. Résumé exécutif & décisions tranchées

### 0.1 Modèle produit (décisions actées, non rediscutées)

1. **Client Stripe = le User.** `stripe_customer_id` vit sur `users` (UNIQUE), plus sur `organizations`.
2. **Facturation des bots d'équipe = OWNER de l'org uniquement.** On introduit `Organization.owner_user_id` (pas de rôle `owner` dans `Membership.role`). Les autres admins ne voient pas la facturation.
3. **Le User choisit le format de facture** : `per_bot` | `total` | `per_org`, stocké sur `User.billing_grouping` (défaut `total`).
4. **Socle GRATUIT** (arbre, apparence, triggers, intégration, analytics) **+ modules forfaitaires** (IA, Live chat/Inbox, RAG, Actions&MCP, A/B, white-label) **+ axe IA métré** (quota inclus + dépassement). On ne facture jamais une capacité gratuite.
5. **BYOK** (`bot.api_key_mode='byok'`) ⇒ module IA en variante forfait plateforme, **bot non métré**.

### 0.2 Décisions d'architecture tranchées dans ce document

| # | Sujet | Décision | Justification |
|---|---|---|---|
| **D0** | Invariant directeur | `billing_enabled() == False` ⇒ comportement strictement identique à aujourd'hui (tout débloqué, aucun gating). Rollback fonctionnel = poser le flag à OFF. | Non-régression des 32 e2e ; livraison dé-risquée |
| **D1** | **Axe métré IA** | **v1 = BLOCAGE au quota** (zéro métré, zéro item metered vendu). **v2 = Stripe Billing Meters basiques**. **v3 = Metronome** si pricing devient multi-dimensionnel. | Corrige **B1** : aligne les 4 volets divergents. Intégration httpx-pur (`stripe_service.py`), 1 seule dimension « réponse IA » = cas pay-as-you-go simple que le skill `stripe-best-practices` assigne aux Basic Meters. Metronome = 2e SaaS/contrat, surdimensionné, contredit « scope serré ». |
| **D2** | **Chaîne de migrations** | **UNE seule chaîne linéaire** M1→M2→M3→M4, propriétaire = §1. Aucun autre volet ne crée de migration `down_revision=c3d4e5f6a7b8`. | Corrige **B2** : 4 volets définissaient chacun une fille directe de `c3d4e5f6a7b8` ⇒ 4 heads, `alembic upgrade head` impossible. (M5 grandfathering supprimé — amendement.) |
| **D3** | **Schémas canoniques** | `bot_entitlements`, `billing_subscriptions`, `billing_products`, `billing_webhook_events`, `bot_usage_counters` définis **une fois** (§1), tous dans `api/src/models/billing.py`. | Corrige **B3, B6** : schémas divergents entre volets. |
| **D4** | **Vocabulaire modules** | UN jeu de `MODULE_KEYS` dans `core/constants.py` : `ai`, `inbox`, `rag`, `actions`, `ab`, `white_label`. Mappé explicitement aux codes catalogue (`mod_*`) et labels front. | Corrige **B7** : front disait `live_chat/actions_mcp/ab_testing`, test parité encore autre chose. |
| **D5** | **Owner d'org** | Colonne `Organization.owner_user_id` (FK users, NOT NULL après backfill). **Mini-volet owner** (§1.2) possède register/create_org/transfert. | Corrige **C1, C3** : nom unique `owner_user_id` (pas `billing_owner_id`/`billing_owner_user_id`), et quelqu'un POSSÈDE la pose de la valeur (sinon `NOT NULL` casse la création d'org). |
| **D6** | **Mapping bot→subscription** | Cartographie complète dans `subscription_data[metadata]` (JSON sérialisé) au Checkout ; subs 2..n créées par **API `POST /subscriptions`** avec `items[n][metadata][bot_id]`. | Corrige **A1** : Checkout ne propage AUCUN metadata d'item vers les `subscription_items`. |
| **D7** | **Source durable du compteur IA** | `Message` (table existante, `tokens_in/out` déjà présents) = source de vérité ; Redis = accélérateur ; `bot_usage_counters` réduit à `(bot_id, period, reported_overage)` pour le report v2 uniquement. | Corrige **F6** : double comptabilité `bot_usage_counters.ai_replies` vs `count_ai_messages_month`. |
| **D8** | **Frontière de période quota** | **UTC** (`utcnow().strftime("%Y-%m")`), cohérent avec les datetimes naïfs UTC du repo. | Corrige **F1** : aucun volet ne fixait le fuseau. |
| **D9** | **Grandfathering** | **Supprimé** (amendement 2026-06-20). App non lancée, aucun client réel à protéger. Les bots de dev sont gratuits via l'invariant billing-OFF. Pas de migration M5, pas de flag `BILLING_GRANDFATHER_UNTIL`. | Inutile avant lancement ; un bot sans entitlement est traité gratuit par le resolver (RÈGLE 2). |
| **D10** | **Stripe MCP / planner** | À brancher (`.mcp.json`) au démarrage de l'implémentation Stripe. Non bloquant pour figer la spec. | Corrige **F7** : décision explicite actée. |

### 0.3 Phasage

```
Phase 0 (auj.)        Phase 1                     Phase 2
billing OFF      →    modules forfaitaires   →    + axe IA métré (Meters)
clés absentes        clés Stripe posées          BILLING_METERING_ENABLED=true
                     BILLING_METERING_ENABLED=F
```

---

## 1. Modèle de données & migrations

Propriétaire **unique** des migrations (D2). Conventions : `from src.core.time import utcnow` ; `default=utcnow` SANS parenthèses ; `DateTime` SANS `timezone=True` ; `server_default=sa.text(...)` pour les colonnes NOT NULL ajoutées sur tables non vides ; JSON pour les collections ; migrations écrites à la main, `upgrade`/`downgrade` symétriques.

**`api/alembic/env.py`** (après la ligne 31, à côté de `import src.models.kb`) :
```python
import src.models.billing  # noqa: F401   # BotEntitlement, BillingSubscription, BillingProduct, BillingWebhookEvent, BotUsageCounter
```

### 1.1 Décisions de modélisation

- **Owner d'org** = `Organization.owner_user_id` (FK `users.id`), pas un rôle `Membership.role='owner'`. `Membership.role` reste `admin|member` (vérifié `user.py:69`) ⇒ `InvitePayload.role`, `OrgOut.role`, `require_org_admin` (`security.py:145`) intacts. L'owner est **toujours** membre `admin` (invariant applicatif, posé par §1.2). Pas de FK croisée SQL owner↔membership (rigidifie les transferts) ; intégrité applicative.
- **Stripe = User** : `stripe_customer_id` migre de `organizations` (`user.py:57-58`) vers `users`, devient **UNIQUE** (1 customer ↔ 1 user, anti-doublon webhook). Pas de `stripe_subscription_id` singulier (multi-subscription ⇒ table `billing_subscriptions`).
- **Entitlements** : table `bot_entitlements` 1↔1 avec `bots`, projetée par webhook, **jamais éditable via `PATCH /api/bots`** (hors `BOT_PERMS`/`FIELD_PERMS` ⇒ `permissions-parity.spec.ts` intact). Absence de ligne = bot legacy/dev → traité gratuit (resolver RÈGLE 2).
- **Compteur IA** : source durable = `Message` (D7). `bot_usage_counters` réduit au strict report v2.

### 1.2 Mini-volet « owner d'org » (corrige C1 — BLOQUANT)

Sans ce volet, `owner_user_id NOT NULL` (M2) casse toute création d'org postérieure. À implémenter dans `api/src/routers/orgs.py` / `auth.py` :

- **(a) Register entreprise** (`account_type=entreprise`) : à la création de l'org, `org.owner_user_id = créateur.id` ET créer son `Membership(role='admin')`.
- **(b) `create_org`** (toute route de création d'org) : idem.
- **(c) Transfert d'owner** : endpoint `POST /api/orgs/{id}/transfer-owner` (réservé owner actuel ou superadmin) ⇒ pose `owner_user_id` + garantit que le nouvel owner est `Membership(role='admin')`. Implique la migration des subscriptions `scope_org_id` (cf. §4).
- **(d) Invariant** : à chaque transfert, l'owner ∈ `memberships(role='admin')`.

### 1.3 DDL — `api/src/models/user.py` (modifs)

```python
# --- User (après created_at) ---
stripe_customer_id = Column(String, unique=True, nullable=True, index=True)  # cus_...
billing_grouping   = Column(String, nullable=False, default="total",
                            server_default=text("'total'"))   # per_bot | total | per_org
billing_email      = Column(String, nullable=True)            # défaut applicatif = user.email
```
> `billing_email` est porté par M1 (corrige **B5** : il était orphelin entre volets).

```python
# --- Organization : RETRAIT stripe_customer_id + stripe_subscription_id ; AJOUT ---
owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
```

**Schémas Pydantic** (lecture seule, hors `BOT_PERMS`) :
- `UserOut` (`user.py:117-127`) gagne : `billing_grouping: str`, `billing_enabled: bool` (calculé serveur, pilote l'affichage front), `owned_org_ids: list[int]` (orgs où `owner_user_id == user.id`). `billing_grouping` validé `Field(pattern="^(per_bot|total|per_org)$")` sur le payload de mutation.
- `OrgOut` (`user.py:108-114`) gagne `is_owner: bool` (`org.owner_user_id == current_user.id`).
- **Corrige C2** : le front dérive `owned_org_ids` ET reçoit `is_owner` par org — les deux exposés de façon cohérente, propriété de `UserOut`/`OrgOut` (ce volet).

### 1.4 DDL — `api/src/models/billing.py` (NOUVEAU, tout y vit — D3)

```python
from src.core.time import utcnow
from sqlalchemy import (Column, Integer, String, Boolean, DateTime, JSON,
                        ForeignKey, UniqueConstraint, text)
from src.core.database import Base


class BotEntitlement(Base):
    """Droits d'un bot, projetés depuis Stripe (jamais édités via PATCH /api/bots).
    Absence de ligne = socle gratuit. Schéma CANONIQUE (corrige B3/B4)."""
    __tablename__ = "bot_entitlements"

    id = Column(Integer, primary_key=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"),
                    unique=True, nullable=False, index=True)

    modules = Column(JSON, default=list, nullable=False, server_default=text("'[]'"))  # sous-ensemble de MODULE_KEYS
    # Convention D4/B4 : NULL = illimité/non applicable ; 0 = module IA absent ; >=1 = quota mensuel
    ai_monthly_quota = Column(Integer, nullable=True)
    overage_mode = Column(String, nullable=False, default="block",
                          server_default=text("'block'"))  # block (v1) | meter (v2)
    status = Column(String, nullable=False, default="active",
                    server_default=text("'active'"))        # active | past_due | canceled | inactive
    # source : stripe (payé) | staff (override) | free (nouveau bot / dev billing-OFF)
    source = Column(String, nullable=False, default="free",
                    server_default=text("'free'"))

    # Caps dérivés (null = constante technique par défaut)
    max_kb_sources  = Column(Integer, nullable=True)  # def. kb_service.MAX_SOURCES_PER_BOT
    max_actions     = Column(Integer, nullable=True)  # def. bots_helpers._MAX_ACTIONS=5
    max_mcp_servers = Column(Integer, nullable=True)  # def. bots_helpers._MAX_MCP_SERVERS=2

    stripe_subscription_id = Column(String, nullable=True, index=True)  # sub_...
    stripe_item_id = Column(String, nullable=True)                      # si_... (item metered v2)
    synced_at  = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
```

> Corrige **B3/B4** : on **abandonne** `ai_quota_included`/`ai_overage_allowed`/`reported_overage` sur l'entitlement au profit de `ai_monthly_quota` (NULL=illimité) + `overage_mode` (`block|meter`). Le report v2 vit sur `bot_usage_counters.reported_overage`. `source` (manquant côté volet data) est intégré ici. *(Colonne `grandfathered` retirée — amendement 2026-06-20.)*

```python
class BillingSubscription(Base):
    """Miroir local des subscriptions Stripe (multi-sub sous 1 customer = le User).
    Index Stripe↔scope que le webhook traduit en entitlements. Schéma CANONIQUE."""
    __tablename__ = "billing_subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                     nullable=False, index=True)             # le payeur (= customer)
    stripe_subscription_id = Column(String, unique=True, nullable=False, index=True)

    # Découpage selon billing_grouping au moment de la création :
    grouping   = Column(String, nullable=False)   # total | per_bot | per_org
    scope_kind = Column(String, nullable=False)   # user_all | bot | org | user_personal
    scope_bot_id = Column(Integer, ForeignKey("bots.id", ondelete="SET NULL"),
                          nullable=True, index=True)
    scope_org_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"),
                          nullable=True, index=True)

    status = Column(String, nullable=False, default="active")  # active|trialing|past_due|canceled|...
    current_period_start = Column(DateTime, nullable=True)
    current_period_end   = Column(DateTime, nullable=True)
    cancel_at_period_end = Column(Boolean, nullable=False, default=False,
                                  server_default=text("false"))
    raw_items = Column(JSON, nullable=True)  # [{si_id, price_id, code, bot_id, qty}] (idempotence/resync)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
```

```python
class BillingProduct(Base):
    """Catalogue piloté en base (plus de STRIPE_PRICE_* en .env)."""
    __tablename__ = "billing_products"

    id = Column(Integer, primary_key=True)
    code  = Column(String, unique=True, nullable=False, index=True)  # base, ai_starter/growth/scale, mod_ai_byok, mod_rag, mod_inbox, mod_actions, mod_ab, mod_whitelabel, mtr_ai
    label = Column(String, nullable=False)
    kind  = Column(String, nullable=False)   # base | ai_tier | module | metered
    included_replies = Column(Integer, nullable=True)  # quota mensuel des lignes kind='ai_tier' (NULL sinon)
    stripe_product_id = Column(String, nullable=True)
    stripe_price_id   = Column(String, nullable=True, index=True)
    unit_amount = Column(Integer, nullable=False)            # centimes
    currency = Column(String, nullable=False, default="eur")
    interval = Column(String, nullable=False, default="month")
    is_active = Column(Boolean, nullable=False, default=True,
                       server_default=text("true"))
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class BillingWebhookEvent(Base):
    """Idempotence webhook (nom CANONIQUE, corrige B6 : ni billing_events ni processed_webhook_events)."""
    __tablename__ = "billing_webhook_events"

    id = Column(Integer, primary_key=True)
    stripe_event_id = Column(String, unique=True, nullable=False, index=True)  # evt_...
    type = Column(String, nullable=False)
    received_at = Column(DateTime, default=utcnow, nullable=False)
    payload = Column(JSON, nullable=True)


class BotUsageCounter(Base):
    """Report v2 UNIQUEMENT (D7). PAS de ai_replies ici : la conso vit dans Message."""
    __tablename__ = "bot_usage_counters"
    __table_args__ = (UniqueConstraint("bot_id", "period", name="uq_bot_usage_bot_period"),)

    id = Column(Integer, primary_key=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    period = Column(String(7), nullable=False)   # "YYYY-MM" UTC (D8)
    reported_overage = Column(Integer, nullable=False, default=0, server_default=text("'0'"))
    period_start = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
```

### 1.5 Chaîne de migrations (D2 — linéaire, sans tête multiple)

`c3d4e5f6a7b8` → **M1** → **M2** → **M3** → **M4**.

| Rév | Slug | Contenu |
|---|---|---|
| **M1** `d4e5f6a7b8c9` | `user_stripe_customer_billing` | `users`: + `stripe_customer_id` (index UNIQUE), `billing_grouping` (server_default `'total'`), `billing_email`. down_revision=`c3d4e5f6a7b8`. |
| **M2** `e5f6a7b8c9d0` | `org_owner_user_id_drop_org_stripe` | `organizations`: + `owner_user_id` (nullable → backfill → NOT NULL + index) ; **drop** `stripe_customer_id`/`stripe_subscription_id`. Backfill = admin le plus ancien par org. down_revision=`d4e5f6a7b8c9`. |
| **M3** `f6a7b8c9d0e1` | `bot_entitlements_usage_counters` | create `bot_entitlements` (index unique `bot_id`, index `stripe_subscription_id`) + `bot_usage_counters`. down_revision=`e5f6a7b8c9d0`. |
| **M4** `a7b8c9d0e1f2` | `billing_subscriptions_products_events` | create `billing_subscriptions`, `billing_products`, `billing_webhook_events`. down_revision=`f6a7b8c9d0e1`. **Tête finale.** |

**M2 — backfill owner** (base prod quasi-vide ⇒ trivial mais robuste) :
```python
op.add_column("organizations",
    sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
op.execute("""
    UPDATE organizations o SET owner_user_id = sub.user_id
    FROM (
        SELECT DISTINCT ON (organization_id) organization_id, user_id
        FROM memberships WHERE role = 'admin'
        ORDER BY organization_id, id ASC
    ) sub
    WHERE sub.organization_id = o.id
""")
# orgs orphelines (aucun admin) restent NULL → en base dev/quasi-vide il n'y en a pas.
op.alter_column("organizations", "owner_user_id", nullable=False)
op.create_index("ix_organizations_owner_user_id", "organizations", ["owner_user_id"])
op.drop_index("ix_organizations_stripe_customer_id", table_name="organizations")
op.drop_column("organizations", "stripe_subscription_id")
op.drop_column("organizations", "stripe_customer_id")
```
> Docstring M2 : facturation **dormante** aujourd'hui (toutes colonnes Stripe à NULL, `config.py:79-83`) ⇒ aucun `cus_`/`sub_` réel à migrer, le drop est sans perte.

> **M5 (grandfathering) supprimé — amendement 2026-06-20.** App non lancée ⇒ aucun bot existant à protéger. La chaîne s'arrête à **M4**. Un bot sans ligne `bot_entitlements` (legacy/dev) est traité gratuit par le resolver (RÈGLE 2, §3.2). Aucun backfill nécessaire.

---

## 2. Intégration Stripe (recâblage du module dormant)

Périmètre : catalogue, Customer sur User, Checkout `mode:subscription`, multi-subscription, webhook, recâblage `stripe_service.py`, endpoints `/api/billing/*`. Tout en httpx via `_stripe_request` (`stripe_service.py:72`) — **pas de SDK**.

### 2.1 Décisions Stripe (skill `stripe-best-practices`)

| Sujet | Décision |
|---|---|
| 1er paiement | **Checkout Session `mode:'subscription'`** (URL hébergée) |
| `payment_method_types` | **JAMAIS passé** (dynamic payment methods) — déjà conforme dans le code actuel |
| Objet tarifaire | **Products + Prices** récurrents (pas `plan` déprécié) |
| Self-service | **Customer Portal**, réservé owner |
| Clé API | **Restricted API Key `rk_`** (migration depuis `sk_`, §9) |
| Webhooks | signature HMAC maison conservée (`verify_webhook_signature` `stripe_service.py:203`) ; IP allowlist en **LOG-ONLY** (A4) |
| Taxes | **Aucune TVA** (franchise en base, art. 293 B du CGI — amendement 2026-06-20). `automatic_tax` **désactivé**, pas de Registration. Mention légale « TVA non applicable, art. 293 B du CGI » sur les factures (réglage Dashboard). |
| Scinder factures | plusieurs subscriptions sous UN customer ; facture totale = plusieurs items sur 1 sub |
| **Axe métré IA** | **v1 blocage / v2 Meters / v3 Metronome** (D1) |

### 2.2 Catalogue en base (`billing_products`)

Le mapping `starter/pro/agence → STRIPE_PRICE_*` (`stripe_service.py:46-69`, `config.py:81-83`) est **supprimé**. Catalogue seedé idempotent. Codes alignés sur `MODULE_KEYS` (D4) :

**Catalogue figé 2026-06-20** (prix **nets — TVA non applicable, art. 293 B du CGI**, **par bot / mois**). Socle gratuit ⇒ `base = 0 €`. Le **plan IA** (quota de réponses) porte le prix du moteur ; les autres capacités = **add-ons** forfaitaires.

**Plans IA** (`kind='ai_tier'` ; choisir un plan ≥ Starter active le module `ai` et pose `ai_monthly_quota = included_replies`) :

| code | réponses IA/mois | prix | centimes | modèles managés |
|---|---|---|---|---|
| `ai_free` | 50 | **0 €** | 0 | Haiku |
| `ai_starter` | 1 000 | **19 €** | 1900 | Haiku, GPT-4o-mini |
| `ai_growth` ★ | 3 000 | **39 €** | 3900 | + Sonnet |
| `ai_scale` | 10 000 | **89 €** | 8900 | + Sonnet |
| `mod_ai_byok` | **illimité** | **29 €** | 2900 | clé du client (`kind='module'`, non métré) |

**Add-ons** (`kind='module'`, forfait on/off) :

| code | module | prix | centimes |
|---|---|---|---|
| `mod_rag` | Connaissances (RAG) | **9 €** | 900 |
| `mod_inbox` | Live chat / Inbox | **15 €** | 1500 |
| `mod_actions` | Actions & MCP | **19 €** | 1900 |
| `mod_ab` | A/B testing | **7 €** | 700 |
| `mod_whitelabel` | White-label (sans « Powered by ») | **9 €** | 900 |

**Socle & métré** :

| code | kind | v1 | v2 |
|---|---|---|---|
| `base` | base | **0 €** (socle gratuit, jamais facturé) | — |
| `mtr_ai` | metered | **blocage au quota** (`is_active=false`, non vendu) | **0,015 €/réponse** (1.5 c) au-delà du quota |

> **Modèle managé borné Haiku / GPT-4o-mini** par défaut (marge). **Sonnet** réservé à `ai_growth`+ ; pour de gros volumes Sonnet, pousser le **BYOK** (sinon marge négative). v2 pourra pondérer (1 réponse Sonnet = N crédits).
> **BYOK exclusif** : un plan IA managé (`ai_*`) et `mod_ai_byok` sont **mutuellement exclusifs** sur un bot. Bot `byok` ⇒ `mod_ai_byok`, jamais `mtr_ai` ; les deux activent le module `ai` (`ai_monthly_quota = NULL` = illimité pour BYOK).

**Présélections** (`presets` — total = **somme transparente** des produits, pas de prix caché) :

| key | label | compo | total/mois |
|---|---|---|---|
| `vitrine` | Vitrine / FAQ | `ai_starter` + `mod_rag` | **28 €** |
| `pro_ia_rag` ★ | Service client (recommandé) | `ai_growth` + `mod_rag` + `mod_inbox` + `mod_actions` | **82 €** (+ `mod_ab` = 89 €) |
| `service_client` | Sur-mesure / Volume | `ai_scale` + tous les add-ons | **148 €** — *alt. `mod_ai_byok` + add-ons = 88 € illimité* |

**Leviers commerciaux** : **annuel = 2 mois offerts** (−17 %, Price `interval=year`) ; **essai 14 j** du plan Growth via `subscription_data[trial_period_days]=14` au Checkout.

**Seed** `api/scripts/seed_billing_catalog.py` (manuel, idempotent) : pour chaque `billing_products` sans `stripe_product_id` → `POST /v1/products` puis `POST /v1/prices` (Prices immuables ; un changement de montant = nouveau Price + bascule `is_active`). `mtr_ai` (`recurring[usage_type]=metered`) créé seulement en v2.

### 2.3 `MOCK_BILLING` (corrige F4 — contrat du service)

`config.py` : `MOCK_BILLING: bool = True`. Quand `True`, `stripe_service` **n'émet aucun `_stripe_request` sortant** :
- `create_checkout_session(...)` → URL locale `{APP_URL}/app/billing?checkout=success&mock_session=cs_test_<uuid>`.
- `create_portal_session(...)` → `{APP_URL}/app/billing?portal=mock`.
- Applique **directement** l'entitlement attendu (simule `checkout.session.completed`) pour que les e2e vérifient activation/dégradation sans Stripe.
- `verify_webhook_signature` **inchangé** (testé en vrai HMAC).
- `validate_production()` lève `RuntimeError` si `is_production and MOCK_BILLING`.

### 2.4 Recâblage `stripe_service.py`

| Actuel | Devient |
|---|---|
| `billing_enabled()` (l.39, 5 vars) | `bool(STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET)` |
| `price_id_for(plan)` (l.46) | **supprimé** → `price_id_for_code(code, db)` (lookup `billing_products`) |
| `plan_for_price(price_id)` (l.60) | **supprimé** → `code_for_price(price_id, db)` |
| `create_customer(org, email)` (l.91) | **`create_customer(user, email)`** : `metadata[user_id]`, `name=user.name` |
| `create_checkout_session(customer_id, plan, org_id)` (l.101) | réécrit (cf. ci-dessous) |
| URLs `{APP_URL}/app/billing` (l.110-111) | conservées (routes réelles créées §5) |
| `_stripe_request`, `verify_webhook_signature`, `create/update/cancel_portal_session`, `cancel_subscription`, `expire_open_checkout_sessions`, `list_invoices` | **conservés** |
| **NEW** | `create_subscription(customer_id, items, metadata)` — `POST /v1/subscriptions` |
| **NEW** | `update_subscription_items(subscription_id, target_items, proration_behavior)` |

**`create_checkout_session` réécrit** (corrige A1 ; A2/Stripe Tax retiré — pas de TVA) :
```
POST /v1/checkout/sessions
  mode=subscription
  customer=<cus_>
  line_items[0][price]=price_...   (base)        line_items[0][quantity]=1
  line_items[1][price]=price_...   (mod_ai)      line_items[1][quantity]=1
  ...
  # A1 : AUCUN metadata par line_item (Checkout ne le propage pas). Cartographie complète ici :
  subscription_data[metadata][bots]={"42":["mod_ai","mod_rag"],"43":["mod_inbox"]}   # JSON, ≤500 car/clé (découper si besoin)
  subscription_data[metadata][group_key]=<group_key>
  subscription_data[metadata][user_id]=<uid>
  # PAS de TVA (franchise en base) : pas d'automatic_tax / tax_id_collection / billing_address_collection
  customer_update[name]=auto
  success_url={APP_URL}/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}
  cancel_url={APP_URL}/app/billing?checkout=cancelled
  # PAS de payment_method_types
```
**Subs 2..n** (per_bot/per_org après attache CB) : `create_subscription` via API, où `items[n][metadata][bot_id]` **est** posable directement (privilégié dès la 2e sub).

**`update_subscription_items`** (corrige D4 garde) : si la liste cible = **0 item** → appeler `cancel_subscription` (Stripe refuse une sub sans item).

### 2.5 Clé canonique de scope

Déplacer `_bot_limiter_key` (`bots.py:52-55`, `org:{id}` | `user:{owner_user_id}`) vers **`api/src/core/billing_keys.py`** + `billing_owner_user_id(scope_key, db)`. `bots.py` importe depuis `core/`.

---

## 3. Entitlements & enforcement

### 3.1 Constantes (`api/src/core/constants.py` — D4)

```python
MODULE_AI         = "ai"
MODULE_INBOX      = "inbox"
MODULE_RAG        = "rag"
MODULE_ACTIONS    = "actions"
MODULE_AB         = "ab"
MODULE_WHITELABEL = "white_label"
MODULE_KEYS = (MODULE_AI, MODULE_INBOX, MODULE_RAG, MODULE_ACTIONS, MODULE_AB, MODULE_WHITELABEL)
# Mapping explicite vers le catalogue Stripe (code billing_products) :
CODE_TO_MODULE = {"mod_ai": MODULE_AI, "mod_ai_byok": MODULE_AI, "mod_inbox": MODULE_INBOX,
                  "mod_rag": MODULE_RAG, "mod_actions": MODULE_ACTIONS, "mod_ab": MODULE_AB,
                  "mod_whitelabel": MODULE_WHITELABEL}
```
> Ces clés sont des **clés d'entitlement**, PAS des permissions. Ne **jamais** les ajouter à `BOT_PERMS`/`FIELD_PERMS`.

### 3.2 Resolver + flag (corrige migration douce — `api/src/services/entitlement_service.py`)

```python
@dataclass
class Entitlement:
    bot_id: int
    modules: set[str]
    ai_monthly_quota: int | None   # None = illimité
    overage_mode: str              # block | meter
    status: str
    byok: bool

async def resolve(db, bot) -> Entitlement:
    # RÈGLE 1 — billing OFF : tout débloqué (= comportement actuel)
    if not billing_enabled():
        return Entitlement.ALL_UNLOCKED
    ent = await _load(db, bot.id)                       # SELECT bot_entitlements
    # RÈGLE 2 — pas d'entitlement (bot legacy / dev) : tout débloqué (gratuit)
    if ent is None:
        return Entitlement.ALL_UNLOCKED
    eff = ent.effective()
    # RÈGLE 3 — BYOK : module IA forfait, jamais métré
    if bot.api_key_mode == "byok":
        eff.byok = True
    return eff

def has_module(ent, module) -> bool:
    # status past_due/canceled => False pour TOUS les modules payants (dégradation §6)
    return ent.status == "active" and module in ent.modules

def ai_quota_for(ent) -> int | None:
    return None if ent.byok else ent.ai_monthly_quota   # None = illimité

def gate(ent, capability) -> None:
    if has_module(ent, capability):
        return
    if not settings.BILLING_ENFORCE:                    # mode observe : log-only, ne bloque pas
        logger.info("billing.observe: %s manquant (non bloqué)", capability); return
    raise HTTPException(402, detail={"error": "module_required", "module": capability})

async def apply_subscription_event(db, event) -> None:
    # idempotence par event.id (billing_webhook_events). Déclaratif (réécrit l'état cible).
    # D1 (anti-race regrouping) : sur subscription.deleted, recalculer l'état NET =
    # union des items de TOUTES les subs ACTIVES couvrant le bot (lire billing_subscriptions),
    # PAS révoquer aveuglément. Respecter users.billing_regrouping_at si posé (§4).
```

### 3.3 Points d'enforcement EXACTS

Pattern : check d'entitlement **AVANT** l'effet coûteux (calqué `treegen_limiter`/`insights_limiter`, `bots.py:392/426`). Gating config/staff = **402** (distinct du 403 perm et du 429 rate-limit). Gating runtime visiteur = **dégradation silencieuse**, jamais d'erreur technique au visiteur.

| Module | Point (`fichier:ligne`) | Type | Action si non-droit |
|---|---|---|---|
| **IA (runtime)** | `widget.py:594` — JUSTE AVANT `generate_reply` dans `_handle_ai_message` | runtime | message fallback dédié (cf. F2) ; **jamais** gater navigation arbre/conseiller |
| **IA (config)** | `bots.py:279` après `_enforce_field_perms` : si `data` touche `mode in (ai,hybrid)`/`system_prompt`/`ai_provider`/`ai_model` ⇒ `MODULE_AI` | config | 402 |
| **IA (quota)** | pré-check à `widget.py:594` ; incrément après persistance `widget.py:606-608` | runtime | message fallback (mode block) |
| **RAG (ingestion)** | `kb.py:67` (`create_source`) + `kb.py:103` (`create_pdf_source`), avant `_spawn_ingest` | config | 402 |
| **RAG (runtime)** | `widget.py:586` : forcer `has_kb=False` si `not has_module(ent, RAG)` | runtime | `search_docs` non exposé |
| **Actions&MCP (config)** | `bots.py:288` `_merge_rich_collections` : `actions_json`/`mcp_servers_json` non vide ⇒ `MODULE_ACTIONS` | config | 402 |
| **Actions&MCP (runtime)** | `ai_service.py:281-290` `_build_tools` : ne pas exposer actions/MCP sans `MODULE_ACTIONS` (passer l'entitlement depuis `widget.py:594`) | runtime | tools non exposés |
| **Live chat (déclenchement)** | check **booléen amont** de `trigger_handoff` (`widget.py:272`) aux 2 sites : `widget.py:412` + `action_executor.py:163` | runtime | handoff refusé proprement (jamais d'exception dans la transition SQL) |
| **Live chat (staff)** | `inbox.py:201` `take_conversation` + `inbox.py:230` `reply_conversation` | staff | 402 |
| **A/B (config)** | `bots.py:280` avant `_validate_trees` : `tree_variant_json` non null OU `ab_split_pct>0` ⇒ `MODULE_AB` | config | 402 |
| **A/B (runtime)** | `widget.py:187` : check `has_module(ent, AB)` à l'affectation variante | runtime | variante A pour tous |
| **White-label** | sérialisation design widget (`bot.py:66` `poweredBy`) : forcer `poweredBy=True` sans `MODULE_WHITELABEL` | runtime | mention conservée |

**Vigilances :**
- **IA** : ne **jamais** gater dans `generate_reply` (`ai_service.py:122`) — partagé treegen/insights (gratuits). Gater au call-site `widget.py:594`.
- **Actions** : gater config ET runtime (un bot configuré avant downgrade exécuterait encore ses actions).
- **A/B** : `ab_split_pct=null` retiré silencieusement (`_NOTNULL_NO_NULL_FIELDS` `bots.py:194`), `tree_variant_json=null` = désactivation explicite — traiter les deux ensemble.
- **`import_config`** (`bots.py:346`) n'applique que `CONFIG_FIELDS` ⇒ pas de contournement par l'import.

### 3.4 Compteur quota IA (D7/D8/F1)

- **Pré-check par MESSAGE** (les `tokens_in/out` ne sont connus qu'après l'appel `widget.py:604`).
- Clé Redis `quota:ai:{YYYY-MM}:bot:{bot_id}` avec `INCR` + `EXPIRE ~35j` (compteur calendaire, **pas** sliding-window). `period = utcnow().strftime("%Y-%m")` — **UTC** (D8), même calcul des deux côtés.
- **Source durable = `Message`** (D7) : généraliser `usage_service.count_ai_messages_today` → `count_ai_messages_month(db, bot_id, period)` (filtre `source='ai', role='assistant'`, `created_at >= 1er du mois UTC`). Zéro migration de comptage.
- **FAIL-CLOSED** (≠ rate_limit fail-open) : Redis indispo → COUNT SQL ; pas de bypass mémoire process. Reseed depuis SQL si clé absente (au tout début de mois : COUNT=0, cohérent).
- Incrément **après** persistance réussie (`widget.py:606-608`) ⇒ un échec IA ne consomme pas de crédit.
- BYOK ⇒ `ai_quota_for` = None ⇒ `ai_quota_consume` **non appelé**.

### 3.5 BYOK anti-contournement (corrige D5)

Au PATCH `api_key_mode=byok` (`bots.py:255` `_apply_secrets`) : exiger l'entitlement variante `mod_ai_byok`, sinon 402 — **SAUF** si `billing_enabled()==False` OU le bot n'a pas d'entitlement (legacy/dev, resolver RÈGLE 2) : un bot gratuit qui passe byok ne doit pas être bloqué (corrige **D5**).

### 3.6 Endpoints entitlement/usage

| Méthode | Path | Auth | Note |
|---|---|---|---|
| `GET` | `/api/bots/{id}/entitlement` | `get_current_user` + accès bot + **`require_billing_owner`** | **E2** : masquer/exiger owner pour les champs facturation (un member ne voit pas la facturation) |
| `GET` | `/api/billing/usage` | `require_billing_owner` | conso IA mensuelle vs quota (tous bots du payeur) |
| `POST` | `/api/billing/webhook` | signature Stripe (corps **bytes bruts**) | **E1** : `if not billing_enabled(): return {"received": True}` (no-op) après vérif signature |

---

## 4. Format de facture (per_bot / total / per_org)

### 4.1 Mapping `User.billing_grouping` → subscriptions

Soit `B(U)` = bots facturables de U = { bots perso `owner_user_id==U.id` } ∪ { bots d'orgs où `org.owner_user_id==U.id` }. Un admin **non-owner** ne paie pas les bots de l'org (c'est l'owner qui paie). **UN seul Customer** (le User) porte toutes les subs ; chaque item porte `metadata[bot_id]` ⇒ facture lisible bot par bot dans les 3 formats.

| Format | # subs | `scope_kind` | Composition |
|---|---|---|---|
| `total` (défaut) | 1 | `user_all` | tous bots de `B(U)`, 1 item/bot×module |
| `per_bot` | n = #B(U) | `bot` | 1 sub/bot |
| `per_org` | #orgs_owned + (1 si bots perso) | `org` / `user_personal` | 1 sub/org + 1 sub perso |

### 4.2 Changement de format — `PUT /api/billing/grouping`

```
PUT /api/billing/grouping  body:{grouping}  auth: require_billing_owner (scopée)
  per_org refusé (409) si 0 org owned ET 0 bot perso.
```

**Procédure « créer-puis-résilier »** (préserve les entitlements) :
1. Snapshot `B(U)` + entitlements (lecture locale, pas Stripe).
2. Construire la cible (subs souhaitées + items, prices résolus, jamais `price=None`).
3. **Créer** les nouvelles subs : `proration_behavior="create_prorations"`, **même `billing_cycle_anchor` gelé** sur TOUTES les subs du jeu (corrige **D3** : pas seulement la première) + `metadata[bot_id]`/`metadata[module]`.
4. Persister les lignes `billing_subscriptions` (status `active`).
5. **Résilier** les anciennes (`cancel_subscription(..., prorate=true)`) — **après** confirmation des nouvelles.
6. Marquer les anciennes `status=canceled`. Commiter `billing_grouping` **seulement maintenant**.

**Anti-race regrouping↔webhook (corrige D1 — contrat partagé)** : poser `users.billing_regrouping_at` au début ; `apply_subscription_event` **ignore les `subscription.deleted`** pendant la fenêtre OU recalcule l'état NET = union des subs actives (jamais révoquer sur un seul event). Idempotent/reprenable : un re-appel détecte les subs cibles déjà présentes (via `billing_subscriptions`/metadata) et termine la résiliation. Verrou : `pg_advisory_lock(user.id)`. `expire_open_checkout_sessions` avant toute création.

### 4.3 Edge cases d'appartenance

| Cas | Comportement |
|---|---|
| User sans bot facturable | `billing_grouping` modifiable, aucune sub créée. `per_org` 409 si 0 org owned & 0 perso. |
| Ajout d'un bot facturable | `total` ⇒ `update_subscription_items(+items)` ; `per_bot` ⇒ `create_subscription` ; `per_org` ⇒ add sur la sub org/perso. |
| Suppression/désactivation bot | `per_bot` ⇒ `cancel_subscription(prorate=true)` ; `total`/`per_org` ⇒ retire les items ; **si sub vidée → la résilier** (corrige **D4**). |
| **Move bot perso→équipe changeant de payeur** (U→org owned par V) | **Corrige D2** : ajouter un **hook billing au code de move existant** : si `billing_enabled()`, (a) retirer les items du bot de la/les sub(s) de U (proration crédit), (b) si V sans moyen de paiement → bot en **grâce** (`status=past_due`) jusqu'à régularisation, sinon ajouter chez V. Propriétaire du hook = §4 (volet grouping). |
| Org sans owner (legacy) | bots non facturables, exclus de `B(U)`, traités gratuits (resolver RÈGLE 2). |
| Transfert d'owner | subs `scope_org_id` migrent vers le nouvel owner (§1.2 (c)) ; lire `org.owner_user_id` **au moment** du calcul. |

---

## 5. Configurateur & écrans owner-only (front)

Le front ne code **aucun prix en dur** : il consomme `GET /api/billing/catalog`, recalcule le panier localement, fait confiance au backend pour le montant final (Stripe).

### 5.1 Contrats de données — `app/src/types/billing.ts` (NOUVEAU)

```ts
export type ModuleKey = 'ai' | 'inbox' | 'rag' | 'actions' | 'ab' | 'white_label'  // D4 : aligné backend
export type BillingGrouping = 'per_bot' | 'total' | 'per_org'

export interface CatalogModule { key: ModuleKey; label: string; short: string; desc: string;
  price_cents: number; byok_price_cents?: number; requires?: ModuleKey[] }
export interface AiTier { id: string; included_replies: number; price_cents: number }
export interface BillingCatalog { currency: 'eur'; base_price_cents: number;
  modules: CatalogModule[]; ai_tiers: AiTier[]; overage_cents_per_reply: number;
  tax_note: string; presets: CatalogPreset[]; version: string }
export interface CatalogPreset { key: 'vitrine'|'pro_ia_rag'|'service_client'; label: string;
  tagline: string; modules: ModuleKey[]; ai_tier_id: string|null; recommended?: boolean; est_price_cents: number }
export interface BotBilling { bot_id: number; active_modules: ModuleKey[]; ai_tier_id: string|null;
  ai_byok: boolean; usage_ai_replies: number; quota_ai_replies: number|null;
  period_start: string; period_end: string; subscription_status: 'active'|'past_due'|'canceled'|'none' }
export interface BotConfig { modules: ModuleKey[]; ai_tier_id: string|null; ai_byok: boolean }
export interface Invoice { id: string; created: number; amount_paid_cents: number; currency: string;
  status: 'paid'|'open'|'void'|'uncollectible'|'draft'; hosted_invoice_url: string|null;
  invoice_pdf: string|null; number: string|null; period_label?: string }
```

`app/src/types/auth.ts` `interface User` : `+ billing_grouping`, `+ is_billing_enabled: boolean`, `+ owned_org_ids: number[]` (corrige **C2** : dérivable aussi de `organizations[].is_owner`).

### 5.2 Gating UI — `app/src/utils/permissions.ts` (NE PAS toucher `canAccessBotPerm`)

```ts
export function canSeeBilling(u?: User|null): boolean {
  if (!u) return false
  return u.is_superadmin || hasPersonalBot(u) || (u.owned_org_ids?.length ?? 0) > 0  // E3
}
export function isBotBillingOwner(u: User|null|undefined, bot: BotLike): boolean {
  if (!u) return false
  if (u.is_superadmin) return true
  if (isPersonalBot(bot)) return bot.owner_user_id === u.id
  return (u.owned_org_ids || []).includes(bot.organization_id ?? -1)  // owner d'org SEULEMENT
}
```
> **Corrige E3** : `canSeeBilling` n'est plus `return true`. **Défense en profondeur** : le front masque, le backend **rejette** (403) tout `POST /api/billing/*` d'un non-owner. Fallback transitoire `role==='admin'` à retirer dès `owned_org_ids` exposé.

### 5.3 Composants & emplacements

- **`app/src/components/billing/BotConfigurator.tsx`** (NOUVEAU) : modes **Presets** (Vitrine / Pro IA+RAG / Service client) et **Avancé** (`Toggle` par module + variante IA `Managé|BYOK` + paliers quota). `Seg`/`Toggle`/`Card`/`Chip`/`InfoBox`/`Meter` réutilisés (`ui.tsx`). Auto-active les `requires`. Jamais de toggle sur une capacité gratuite.
- **`app/src/components/billing/PriceCart.tsx`** (NOUVEAU) : panier live façon facture, sticky desktop/drawer mobile, **mention légale « TVA non applicable, art. 293 B du CGI »** (pas de TVA collectée). `computeCart(catalog, config)` = fonction pure dans **`app/src/utils/billing.ts`** (NOUVEAU, testable + miroir front du catalogue pour la parité — cf. F5).
- **`app/src/pages/Billing.tsx`** (NOUVEAU, route `/app/billing`) : statut abonnement, **format de facture** (`Seg` 3 options + modale de confirmation re-grouping → `PUT /api/billing/grouping` → `refreshUser()`), bots facturables (filtrés `isBotBillingOwner`), factures (`GET /api/billing/invoices`, `created` epoch→ms), portail. Si `!user.is_billing_enabled` → `InfoBox` « bientôt disponible » et on masque le reste.
- **`app/src/pages/BotWizard.tsx`** : étape `plan` entre `preset` et `appearance` (`Step`/`STEP_DOTS`/`STEP_CAPTION`), charge le catalogue, `botConfig` en état + brouillon `DRAFT_KEY`. `createBot` : si total=0 € → bot gratuit ; sinon `POST /api/billing/checkout` → `window.location.href`. `api_key_mode = config.ai_byok ? 'byok' : 'managed'`. Org non-owner ⇒ modules payants en lecture seule + `InfoBox`.
- **`app/src/pages/BotPage.tsx`** : onglet `billing` (réutilise perm `security`, **PAS** de nouvelle `BOT_PERMS`) + clause `visibleTabs` owner-only `isBotBillingOwner`.
- **`app/src/App.tsx`** : `<Route path="/app/billing" element={<Protected><Billing/></Protected>}>`.
- **`app/src/Layout.tsx`** : entrée nav « Facturation » (icône `CreditCard`) gardée par `canSeeBilling`.

### 5.4 Endpoints client (`api/src/routers/billing.py`)

| Méthode | Path | Stripe (httpx) |
|---|---|---|
| `GET` | `/api/billing/catalog` | — (lit `billing_products`, valide contre `MODULE_KEYS`) |
| `GET` | `/api/billing/summary` | — |
| `POST` | `/api/billing/checkout` `{bot_id, config, grouping}` → `{checkout_url}` | `POST /v1/customers` (lazy) + `POST /v1/checkout/sessions` |
| `POST` | `/api/billing/subscription/update` `{bot_id, config}` → `{status, portal_url?}` | `POST /v1/subscriptions/{id}` |
| `POST` | `/api/billing/portal` / `/portal/cancel` | `POST /v1/billing_portal/sessions` |
| `PUT` | `/api/billing/grouping` | mut. subs (§4.2) |
| `GET` | `/api/billing/invoices` | `GET /v1/invoices?customer=` |
| `POST` | `/api/billing/webhook` (public, bytes bruts) | — |

`main.py` (bloc `include_router` après stats/tree) : `app.include_router(billing.router)`. Garde `require_billing_owner` **scopée** (corrige **C3** : prend l'org_id/scope de la ressource ; un owner de A ne touche pas la facturation de B). `is_superadmin` court-circuite.

**Retour Stripe** : `?checkout=success|cancelled`, `?portal=mock` (parsés `useSearchParams`). À `success` : `InfoBox` confirmation + `refreshUser()` + re-fetch `BotBilling` avec court polling (2-3 essais) si `subscription_status==='none'` (entitlement asynchrone via webhook). Nettoyer le query param (`replace:true`).

---

## 6. Migration & rollout par phases

### 6.1 Settings (`api/src/core/config.py`)

| Action | Variable | Défaut |
|---|---|---|
| Garder | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `None` |
| **Supprimer** | `STRIPE_PRICE_STARTER/PRO/AGENCE` | — |
| Ajouter | `MOCK_BILLING` | `True` |
| Ajouter | `BILLING_METERING_ENABLED` | `False` (Phase 1→2) |
| Ajouter | `BILLING_ENFORCE` | `False` (kill-switch enforcement / mode observe) |

**`billing_enabled()` / `metering_enabled()`** (`stripe_service.py`) :
```python
def billing_enabled() -> bool:
    return bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_WEBHOOK_SECRET)
def metering_enabled() -> bool:
    return billing_enabled() and settings.BILLING_METERING_ENABLED
```

**`validate_production()` réécrit** (`config.py:107-123`, sortie du tout-ou-rien 5 vars + corrige A3, F4) :
```python
if self.STRIPE_SECRET_KEY and not self.STRIPE_WEBHOOK_SECRET:
    raise RuntimeError("STRIPE_WEBHOOK_SECRET requis dès que STRIPE_SECRET_KEY est défini")
if self.BILLING_METERING_ENABLED and not self.STRIPE_SECRET_KEY:
    raise RuntimeError("BILLING_METERING_ENABLED=true sans billing actif")
if self.BILLING_ENFORCE and not self.STRIPE_SECRET_KEY:
    raise RuntimeError("BILLING_ENFORCE=true sans billing actif")
if self.is_production and self.MOCK_BILLING:
    raise RuntimeError("MOCK_BILLING interdit en production")
if self.is_production and (self.STRIPE_SECRET_KEY or "").startswith("sk_live"):
    raise RuntimeError("Utiliser une Restricted API Key rk_live en production (A3)")
```

### 6.2 Création de bot

`create_personal_bot` (`bots.py:106`) / `create_org_bot` : créer un entitlement `source='free'`, `modules=[]` **seulement si `billing_enabled()`** (sinon le resolver renvoie `ALL_UNLOCKED`, pas de pollution de la base). Un bot sans entitlement (legacy/dev) est traité gratuit par le resolver (RÈGLE 2).

### 6.3 Phases

- **Phase 0 (auj.)** : clés absentes ⇒ `billing_enabled()==False` ⇒ resolver `ALL_UNLOCKED`, gating no-op, routes `/api/billing/*` → `{billing:'disabled'}` (200), nav masquée, webhook no-op. **0 régression e2e** (clés absentes en CI).
- **Phase 1** : clés posées + `BILLING_METERING_ENABLED=false` + `BILLING_ENFORCE=false`. UI/checkout/portail actifs, entitlements créés via webhook, **rien bloqué** (mode observe : logs `billing.observe`). Module IA = **booléen** (pas de quota). Puis `BILLING_ENFORCE=true` : nouveaux bots `free` gatés (un bot sans entitlement reste gratuit).
- **Phase 2** : `ai_monthly_quota` posé sur les entitlements `mod_ai` payés ; compteur branché ; `BILLING_METERING_ENABLED=true` (d'abord observe, puis report Meters).

### 6.4 Réversibilité

| Niveau | Action | Effet |
|---|---|---|
| **R1** | `BILLING_ENFORCE=false` | aucun blocage, UI reste visible (observe) |
| **R2** | retirer `STRIPE_SECRET_KEY` | `billing_enabled()=False` ⇒ app 100% gratuite, nav masquée |

**Réconciliation au rallumage (corrige F3)** : quand `billing_enabled()` repasse `true` après un R2, lancer une réconciliation (`GET /v1/subscriptions?customer=`) pour resynchroniser `bot_entitlements` (un client résilié côté Stripe pendant R2 a un webhook `deleted` no-op ⇒ entitlement `active` périmé). À ajouter au script de rallumage.

### 6.5 Ce qui reste gratuit (jamais gaté)

Navigation arbre (`widget.py:657`), texte libre tree (`widget.py:563-575`), design/`_sanitize_design`, triggers (`bot.py:138`), embed/widget.js, analytics (`stats_service`), mode conseiller déjà actif (`widget.py:642-649`). Le gating IA s'insère **au call-site** `widget.py:594`, jamais dans `generate_reply`.

### 6.6 Message de dépassement visiteur (corrige F2)

Mode `block`, quota atteint : **message dédié distinct** (configurable client), **PAS** le `AIServiceError` « souci technique » (mensonger, brouille le monitoring). Flag interne `reason=quota_exhausted` pour logs/analytics, jamais confondu avec un incident technique. Structure de réponse identique à `widget.py:613` (200, `source:"ai"`, `options:[]`).

---

## 7. Plan de tests & e2e

Principe : **3 niveaux, 0 appel Stripe facturé**. La suite e2e tourne `MOCK_AI=false` (vraies clés IA) ⇒ **aucune spec billing n'exerce un chemin IA réel** (bots mode `tree` ; l'IA métrée se teste via assertions DB/API). `MOCK_BILLING=true` en CI (compose).

### 7.1 Code HTTP gating (acté)

**402 Payment Required** = « module/quota non souscrit » (distinct du **403** perm et du **429** rate-limit). Asserté partout.

### 7.2 Parité catalogue (calque `permissions-parity.spec.ts`)

**`GET /api/meta/billing-catalog`** (même routeur que `/api/meta/permissions` `bots.py:60-68`) :
```jsonc
{ "modules": ["ai","inbox","rag","actions","ab","white_label"],   // D4 : aligné backend/front
  "metered_axes": ["ai"], "byok_excludes_metering": true,
  "billing_grouping_options": ["per_bot","total","per_org"] }
```
`e2e/tests/billing-catalog-parity.spec.ts` compare `toEqual` strict (ordre). Source canonique = `core/constants.py MODULE_KEYS` + miroir `app/src/utils/billing.ts`. **Corrige F5/B7** : `core/constants.py` = clés figées (parité) ; `billing_products` = prix/labels (variable) ; `GET /api/billing/catalog` lit la DB **et valide contre la constante**.

### 7.3 Tests pytest

- **`api/tests/conftest.py`** (CRÉER, n'existe pas) : `client` ASGI, overrides `get_current_user`/`get_db`, fabrique d'entitlement en mémoire, helper `sign_stripe(payload, secret, ts)` (HMAC).
- **`test_billing_entitlements.py`** : socle gratuit par défaut, module actif après souscription, BYOK non métré, clé canonique perso/équipe (pas de fuite croisée), quota inclus puis dépassement.
- **`test_billing_enforcement.py`** : 1 test négatif/positif par point §3.3. `test_treegen_non_gate_par_module_ia` (génération arbre OK sans module IA). A/B : tester `ab_split_pct=0` ET `tree_variant_json=null`. Live chat : conversation NE bascule PAS en état partiel sur refus.
- **`test_billing_webhook.py`** : signature valide applique module / invalide 400 / expirée (t > tolérance 300, `stripe_service.py:226`) rejetée / corps brut non parsé (`await request.body()` AVANT JSON) / **idempotence `event.id`** (`billing_webhook_events`) / `subscription.deleted` révoque / `subscription.updated` resync. **D1** : tester qu'un `deleted` pendant regrouping ne révoque pas (état NET).
- **`test_billing_security.py`** (le plus important) : owner 200 ; admin **non-owner 403** ; member 403 ; perso self 200 ; perso autre user **404** (anti-énumération) ; webhook signé sans JWT accepté / non signé refusé.
- **`test_billing_grouping.py`** : calcul `B(U)`, transitions du tableau §4.2, idempotence (re-appel = no extra create), `stripe_service` monkeypatché.
- **`test_quota_period_utc.py`** : bascule de mois (mock `utcnow`), frontière **UTC** (D8/F1).

### 7.4 Tests e2e Playwright

`e2e/global-setup.ts` : étendre `ensureMember` pour un **3e acteur admin NON-owner** (`state.adminToken`/`adminUserId`, rôle `admin`, pas owner). `MOCK_BILLING=true` passé à l'API (compose).
- **`billing-owner-gating.spec.ts`** : owner 200 + UI visible ; admin non-owner 403 + `InfoBox` « réservé au propriétaire » ; member 403.
- **`billing-degradation.spec.ts`** : bot `tree` sans module → PATCH `actions_json`/`ab_split_pct=50` → 402, POST KB → 402 ; puis activation via `MOCK_BILLING` (checkout → entitlement appliqué) → mêmes PATCH 200. IA jamais exercée (assertions sur `GET /api/bots/{id}/entitlement`).
- **`billing-checkout-return.spec.ts`** : `?checkout=success` bandeau ; `?checkout=cancelled` annulation.
- **`billing-grouping.spec.ts`** : `billing_grouping` per_bot/total/per_org via `PUT /api/billing/grouping` ; `Seg` reflète après `refreshUser` ; sans bot facturable = pas d'appel Stripe.

`permissions-parity.spec.ts` **non impacté** (aucune nouvelle `BOT_PERMS`/`FIELD_PERMS`).

### 7.5 Validation manuelle pré-merge (hors CI — `e2e/README.md`)

`rk_test_` restricted + `stripe listen --forward-to localhost:8001/api/billing/webhook` + `stripe trigger checkout.session.completed`/`customer.subscription.deleted` + `stripe events resend` (idempotence). Valide signature réelle/Portal/proration que le mock ne couvre pas.

---

## 8. Fichiers à créer / modifier (consolidé)

### Backend — NOUVEAUX
- `api/src/models/billing.py` — `BotEntitlement`, `BillingSubscription`, `BillingProduct`, `BillingWebhookEvent`, `BotUsageCounter` + schémas Pydantic.
- `api/src/services/entitlement_service.py` — `resolve`, `has_module`, `ai_quota_for`, `gate`, `apply_subscription_event`.
- `api/src/services/quota_service.py` — `ai_quota_consume` (Redis INCR+EXPIRE, fail-CLOSED, UTC).
- `api/src/core/constants.py` — `MODULE_KEYS`, `CODE_TO_MODULE` (ou ajout si le fichier existe).
- `api/src/core/billing_keys.py` — `_bot_limiter_key` déplacé + `billing_owner_user_id`.
- `api/src/routers/billing.py` — endpoints §5.4 + §3.6 (catalog, summary, checkout, subscription/update, portal, grouping, invoices, usage, entitlement, webhook).
- `api/scripts/seed_billing_catalog.py` — seed idempotent Products/Prices.
- `api/alembic/versions/2026_06_20_d4e5f6a7b8c9_user_stripe_customer_billing.py` (M1).
- `..._e5f6a7b8c9d0_org_owner_user_id_drop_org_stripe.py` (M2).
- `..._f6a7b8c9d0e1_bot_entitlements_usage_counters.py` (M3).
- `..._a7b8c9d0e1f2_billing_subscriptions_products_events.py` (M4, tête finale).
- `api/tests/conftest.py`, `test_billing_entitlements.py`, `test_billing_enforcement.py`, `test_billing_webhook.py`, `test_billing_security.py`, `test_billing_grouping.py`, `test_quota_period_utc.py`.

### Backend — MODIFIÉS
- `api/src/models/user.py` — User: `stripe_customer_id`/`billing_grouping`/`billing_email` ; Organization: + `owner_user_id`, **retrait** `stripe_*` ; `UserOut`: `billing_grouping`/`billing_enabled`/`owned_org_ids` ; `OrgOut`: `is_owner`.
- `api/alembic/env.py` — `import src.models.billing` (après l.31).
- `api/src/core/config.py` — retirer `STRIPE_PRICE_*` ; ajouter `MOCK_BILLING`/`BILLING_METERING_ENABLED`/`BILLING_ENFORCE` ; réécrire section Stripe `validate_production`.
- `api/src/services/stripe_service.py` — `billing_enabled()`/`metering_enabled()` ; `create_customer(user, email)` ; `create_checkout_session` (items + `subscription_data[metadata][bots]`, **sans** `automatic_tax`) ; `create_subscription`/`update_subscription_items` ; `price_id_for_code`/`code_for_price` ; `cancel_subscription(prorate)` ; respect `MOCK_BILLING`.
- `api/src/services/usage_service.py` — `count_ai_messages_month` ; actualiser docstring `l.1-7`.
- `api/src/routers/widget.py` — enforcement IA (`l.594`), `has_kb` (`l.586`), A/B (`l.187`), live chat (`l.412`), incrément quota (`l.606-608`), `poweredBy`.
- `api/src/services/ai_service.py` — `_build_tools` (`l.281-290`) gating actions/MCP ; **ne pas** gater `generate_reply`.
- `api/src/routers/kb.py` — `MODULE_RAG` (`l.67`, `l.103`).
- `api/src/services/action_executor.py` — `MODULE_ACTIONS` avant `_handoff` (`l.163`).
- `api/src/routers/inbox.py` — `MODULE_INBOX` (`l.201`, `l.230`).
- `api/src/routers/bots.py` — checks config (`l.279/280/288`) ; garde BYOK (`l.255`, exempter si billing OFF) ; import `_bot_limiter_key` depuis `core/billing_keys` ; `create_personal_bot` entitlement `free`.
- `api/src/routers/orgs.py` / `auth.py` — **mini-volet owner** (§1.2 : register/create_org/transfert), hook billing au **move perso→équipe** (D2).
- `api/src/main.py` — `include_router(billing.router)`.
- `docker-compose.yml` — `MOCK_BILLING=${MOCK_BILLING:-true}` (service api) ; `.env.example` — documenter `MOCK_BILLING`.

### Frontend
- NOUVEAUX : `app/src/types/billing.ts`, `app/src/utils/billing.ts`, `app/src/components/billing/{BotConfigurator,PriceCart,BotSelector}.tsx`, `app/src/pages/Billing.tsx`.
- MODIFIÉS : `app/src/types/auth.ts`, `app/src/utils/permissions.ts` (`canSeeBilling`/`isBotBillingOwner`), `app/src/pages/{BotWizard,BotPage}.tsx`, `app/src/App.tsx`, `app/src/Layout.tsx`, `app/src/contexts/AuthContext.tsx` (propager `billing_enabled`).

### Tests e2e
- NOUVEAUX : `e2e/tests/billing-{catalog-parity,owner-gating,degradation,checkout-return,grouping}.spec.ts`.
- MODIFIÉS : `e2e/global-setup.ts` (3e acteur admin non-owner), `e2e/README.md` (section sandbox).

### Docs
- `docs/BILLING_MODEL.md` — appliquer l'amendement 2026-06-20 : grandfathering supprimé, aucune TVA, axe métré §6.2 tranché (v1 blocage / v2 Meters / v3 Metronome).

---

## 9. Checklist de mise en prod

1. [ ] **Stripe MCP** branché (`.mcp.json`) + `stripe_implementation_planner` appelé avant le code Stripe (D10).
2. [ ] **Migrations** : `alembic upgrade head` valide la chaîne M1→M4 sur une seule tête (`alembic heads` retourne 1 ligne).
3. [ ] **RAK** : créer `rk_test_` (least privilege : Customers/Checkout/Subscriptions write, Products/Prices read+write seed, Portal write, Invoices read) → `stripe logs tail` → corriger 403 → `rk_live_` + IP allowlist infra + rotation de l'ancienne `sk_`. `validate_production` refuse `sk_live`.
4. [ ] **Seed catalogue** : `python -m scripts.seed_billing_catalog` (idempotent) → `billing_products.stripe_price_id` remplis. `mtr_ai` reste `is_active=false`.
5. [ ] **TVA** : **aucune** (franchise en base, art. 293 B du CGI). `automatic_tax` désactivé ; configurer la mention légale « TVA non applicable, art. 293 B du CGI » en pied de facture (Dashboard Stripe).
6. [ ] **Webhook** : endpoint `/api/billing/webhook` enregistré ; `STRIPE_WEBHOOK_SECRET` posé ; corps **bytes bruts** ; idempotence `billing_webhook_events` ; IP allowlist Stripe en **LOG-ONLY** (A4, jamais rejet dur sans rafraîchissement de `ips_webhooks.json`).
7. [ ] **Phase 1** : poser clés Stripe, `BILLING_METERING_ENABLED=false`, `BILLING_ENFORCE=false`, `MOCK_BILLING=false`. Vérifier UI owner-only, checkout, entitlements via webhook, **rien bloqué** (logs `billing.observe`).
8. [ ] Lire la télémétrie observe N jours → passer `BILLING_ENFORCE=true`.
9. [ ] **Owner d'org** : vérifier register entreprise/create_org posent `owner_user_id` ; endpoint transfert opérationnel (sinon `NOT NULL` casse).
10. [ ] **Réversibilité** documentée : R1/R2 ; procédure de **réconciliation au rallumage** (F3) prête.
11. [ ] **CI** : `MOCK_BILLING=true`, clés Stripe absentes ⇒ 0 régression sur les 32 e2e ; `billing-catalog-parity.spec.ts` vert ; `permissions-parity.spec.ts` vert.
12. [ ] **Phase 2** (ultérieure) : `BILLING_METERING_ENABLED=true` (observe d'abord), report Stripe Billing Meters depuis `bot_usage_counters.reported_overage`.