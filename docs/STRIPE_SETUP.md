# Mise en service Stripe — runbook

> Comment créer les éléments côté **Stripe**, puis les **renseigner dans l'app**.
> Basé sur l'implémentation réelle (`feat/billing-modulaire`). Rédigé le 2026-06-20.

---

## 0. TL;DR (le strict minimum)

Tu ne saisis **que 2 secrets** dans l'app. Tout le catalogue (Products/Prices) est
**créé automatiquement** par un script.

1. **Stripe** (en *test mode* d'abord) : crée 1 **clé API restreinte** (`rk_…`), 1 **webhook**, configure le **portail client**.
2. **App** : mets `STRIPE_SECRET_KEY` (= la clé restreinte) + `STRIPE_WEBHOOK_SECRET` (= secret du webhook) dans `.env`, `MOCK_BILLING=false`.
3. **App** : lance `python -m scripts.seed_billing_catalog` → il crée les Products/Prices chez Stripe et **stocke leurs IDs en base** (`billing_products`).
4. Active progressivement : `BILLING_ENFORCE=false` (mode observe) → puis `true`.

👉 **Tu ne copies AUCUN Price ID à la main** dans l'app (contrairement à l'ancien
système `STRIPE_PRICE_*`, supprimé). Le seed s'en charge.

---

## 1. Ce que tu crées sur Stripe vs ce que l'app fait seule

| Élément Stripe | Qui le crée | Où il atterrit |
|---|---|---|
| **Clé API restreinte** (`rk_`) | Toi (Dashboard) | `.env` → `STRIPE_SECRET_KEY` |
| **Webhook endpoint** + secret (`whsec_`) | Toi (Dashboard) | `.env` → `STRIPE_WEBHOOK_SECRET` |
| **Portail client** (config) | Toi (Dashboard, 1 fois) | rien à saisir (utilisé à la volée) |
| **Products + Prices** du catalogue | **Le script de seed** (auto) | DB `billing_products.stripe_product_id` / `stripe_price_id` |
| **Customers / Subscriptions / Invoices** | L'app à l'exécution (par client) | DB `users.stripe_customer_id`, `billing_subscriptions` |
| **TVA** | — (aucune, franchise en base) | mention légale facture |

---

## 2. Étapes côté Stripe — **commence en TEST MODE**

> Fais d'abord tout ça avec le **toggle « Test mode » activé** dans le Dashboard
> (clés `rk_test_…`, `whsec_…` de test). Tu rejoueras la même séquence en live à la fin.

### 2.A — Clé API restreinte (`rk_`)  *(Developers → API keys → Create restricted key)*

⚠️ **Pas de clé secrète `sk_`** : l'app **refuse** une `sk_live` en production
(`validate_production`). Utilise une **Restricted key**.

Permissions à accorder (principe du moindre privilège) :

| Ressource | Niveau |
|---|---|
| Customers | **Write** |
| Checkout Sessions | **Write** |
| Subscriptions | **Write** |
| Customer portal | **Write** |
| Products | **Write** *(pour le seed)* |
| Prices | **Write** *(pour le seed)* |
| Invoices | **Read** |
| **Billing Meters** | **Write** *(v2 dépassement IA — Meters)* |
| **Meter events** | **Write** *(v2 dépassement IA — report d'usage)* |

> Tout le reste : *None*. (Optionnel mais recommandé en prod : restreindre la clé par
> **IP allowlist** sur l'IP de ton serveur.)
>
> ⚠️ **Permission restreinte « Billing Meters »** : Stripe regroupe les *Meters* et
> *Meter events* dans une catégorie à part. Si tu n'actives pas le **dépassement IA
> métré** (mtr_ai, §3.5), tu peux laisser ces 2 lignes à *None* — le seed ne créera ni
> Meter ni Price métré tant que la fonctionnalité n'est pas voulue. Active-les dès que tu
> comptes proposer le toggle « Dépassement facturé ».

→ Copie la valeur `rk_test_…` (puis `rk_live_…` en live).

### 2.B — Portail client  *(Settings → Billing → Customer portal)*

L'app ouvre le portail pour la gestion en self-service. Active au minimum :
- **Cancel subscriptions** (résiliation) ✅
- **Update payment methods** (moyen de paiement) ✅
- Mises à jour d'abonnement : laisse l'app piloter les changements de plan (les flux
  `update`/`cancel` sont épinglés côté serveur) ; tu peux laisser le reste par défaut.
- **Invoice history** ✅

→ Clique **Save**. Rien à recopier dans l'app.

### 2.C — Webhook  *(Developers → Webhooks → Add endpoint)*

- **Endpoint URL** : `https://VOTRE_DOMAINE/api/billing/webhook`
  *(en prod : `https://chapote.fr/api/billing/webhook`)*
- **Events à écouter** (ceux que l'app gère) :
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `checkout.session.completed`
  - *(optionnel, dunning futur : `invoice.payment_failed`, `invoice.paid` — non traités en v1, sans effet si abonnés)*
- Après création → **Reveal signing secret** → copie le `whsec_…`.

> La signature est vérifiée à la main (HMAC) côté app : ce `whsec_` est indispensable.
> En prod, pense aussi à autoriser les **IPs de Stripe** sur cet endpoint (défense en profondeur).

### 2.D — TVA : **aucune**  *(franchise en base, art. 293 B du CGI)*

- **N'active PAS Stripe Tax.** L'app n'envoie pas `automatic_tax`.
- *(Settings → Invoice / Branding)* : ajoute la mention légale en **pied de facture** :
  `TVA non applicable, art. 293 B du CGI`.
- *(optionnel)* Logo + couleur de marque pour Checkout/factures.

### 2.E — Products / Prices : **NE PAS créer à la main**

Le catalogue est créé par le script de seed (§3.3). Si tu les crées manuellement, tu
auras des doublons. Laisse le seed faire — il pose un `metadata[code]` sur chaque
Product/Price et stocke les IDs en base.

Pour référence, voici ce que le seed va créer (prix **nets**, **par bot/mois**) :

| code | Produit | Prix |
|---|---|---|
| `base` | Socle | 0 € *(non poussé si gratuit)* |
| `ai_free` | IA Gratuit (50 réponses) | 0 € |
| `ai_starter` | IA Starter (1 000) | 19 € |
| `ai_growth` | IA Growth (3 000) | 39 € |
| `ai_scale` | IA Scale (10 000) | 89 € |
| `mod_ai_byok` | IA — clé client (BYOK, illimité) | 29 € |
| `mod_rag` | Connaissances (RAG) | 9 € |
| `mod_inbox` | Live chat / Inbox | 15 € |
| `mod_actions` | Actions & MCP | 19 € |
| `mod_ab` | A/B testing | 7 € |
| `mod_whitelabel` | White-label | 9 € |
| `mtr_ai` | Dépassement IA (métré) | **0,015 €/réponse** (`unit_amount_decimal=1.5`, créé si billing actif) |

> **`mtr_ai` (v2 dépassement IA)** : le seed crée désormais le **Meter** Stripe
> (`event_name = ai_reply_overage`) **et** le **Price métré** (`recurring[usage_type]=metered`,
> `unit_amount_decimal=1.5` = 0,015 €/réponse) **quand `billing_enabled()`**. Le Price reste
> **inerte** tant qu'aucun owner n'active le toggle « Dépassement facturé » sur son bot (§3.5) :
> par défaut `overage_mode='block'` ⇒ aucun item métré attaché, donc rien facturé. Voir §3.5.

> **Annuel −17 %** : pas encore dans le seed (seules les prices **mensuelles** sont
> créées). À ajouter plus tard si tu veux l'option annuelle.

---

## 3. Renseigner dans l'app

### 3.1 — Variables d'environnement (`.env` / compose)

```dotenv
# Les 2 seuls secrets à saisir :
STRIPE_SECRET_KEY=rk_test_xxxxxxxx        # la clé restreinte (§2.A)  — rk_live_… en prod
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx      # le secret du webhook (§2.C)

# Flags de facturation :
MOCK_BILLING=false                # true = aucun appel Stripe (dev/CI). DOIT être false dès qu'on parle au vrai Stripe.
BILLING_METERING_ENABLED=true     # v2 (Stripe Billing Meters / dépassement IA mtr_ai). Défaut true ; le toggle owner reste OFF par bot.
BILLING_ENFORCE=false             # false = mode "observe" (logge, ne bloque pas) ; true = gating actif.
```

Règles vérifiées au démarrage (`validate_production`) :
- `billing_enabled()` = **true dès que `STRIPE_SECRET_KEY` ET `STRIPE_WEBHOOK_SECRET` sont posés**.
- En prod : `MOCK_BILLING=true` est **refusé** ; une `sk_live` est **refusée** (mets une `rk_live`).
- `STRIPE_SECRET_KEY` sans `STRIPE_WEBHOOK_SECRET` → erreur (tout-ou-rien à 2 clés).

> Tant que ces 2 clés sont **absentes**, l'app reste **100 % gratuite** (aucun gating) —
> c'est l'invariant de sécurité. Tu peux donc déployer le code sans rien activer.

### 3.2 — Migrations (une fois)

```bash
docker compose exec api alembic upgrade head     # applique M1→M4 (tête a7b8c9d0e1f2)
```

### 3.3 — Seed du catalogue (crée + lie les Prices)

```bash
docker compose exec api python -m scripts.seed_billing_catalog
```

Ce que ça fait :
- upsert les lignes `billing_products` (idempotent par `code`) ;
- **si `billing_enabled()`** : crée chaque Product + Price chez Stripe et **stocke
  `stripe_product_id` / `stripe_price_id` en base**.
- **Idempotent** : relancer ne recrée rien (saute toute ligne déjà liée).
- Sans clés Stripe : seed la base seulement (colonnes `stripe_*` à NULL) — utile pour
  le catalogue front / les tests de parité.

> Changement de prix plus tard : on **ne modifie jamais** un Price Stripe (immuable) →
> on crée un nouveau Price et on bascule `is_active`. (Procédure à part, hors seed initial.)

### 3.4 — Vérifications

- `GET /api/billing/catalog` (connecté, owner) renvoie le catalogue avec les montants
  (dont `overage_cents_per_reply` = 1.5 et `overage_cap_default` = 1000).
- Le Dashboard Stripe (test) montre 10 Products + 10 Prices avec `metadata.code`,
  plus — si billing actif — le **Meter** `ai_reply_overage` et le **Price métré** `mtr_ai`.
- Le webhook test reçoit bien les events (voir §4).

### 3.5 — Activer le dépassement IA (`mtr_ai`, v2)

Quand un bot atteint son quota IA mensuel, le comportement par défaut est le **blocage**
(`overage_mode='block'`) : l'IA est mise en pause jusqu'au cycle suivant, **rien n'est
facturé**. La v2 ajoute une **option activable** : au-delà du quota, on **sert quand même
la réponse et on la facture** à l'usage, avec un **plafond de sécurité**.

**Pré-requis (une fois, côté Stripe)** :
- La clé restreinte doit avoir **Billing Meters : Write** et **Meter events : Write** (§2.A).
- `BILLING_METERING_ENABLED=true` (défaut) ET billing actif (`STRIPE_SECRET_KEY` +
  `STRIPE_WEBHOOK_SECRET`). Le seed (§3.3) crée alors le **Meter** (`event_name = ai_reply_overage`)
  et le **Price métré** `mtr_ai` (`unit_amount_decimal=1.5` = **0,015 €/réponse**).

**Activation par bot (owner)** : ce n'est **pas** un flag dev global, c'est un **toggle
owner** dans l'app, page **Facturation** (« votre plan », colonne de droite) :
- Toggle **« Dépassement facturé »** → `POST /api/bots/{id}/overage` `{ "enabled": true, "cap": <int|null> }`.
- `cap` = **plafond de sécurité** (nombre max de réponses facturées au-delà du quota ; `null`
  ⇒ défaut **1000**). Le plafond est vérifié **AVANT** génération, comme le quota : on ne
  sert jamais une réponse au-delà du plafond.
- Activer attache l'**item métré** `mtr_ai` (price `recurring[usage_type]=metered`, **sans
  quantity**) à la subscription active du bot ; désactiver le retire (best-effort).
- Le toggle n'apparaît **que** si le dépassement est applicable : billing actif,
  `BILLING_METERING_ENABLED=true`, **plan IA managé** (quota défini) et **bot non BYOK**.

**Ce qui n'est jamais facturé** :
- **BYOK** (clé du client) : illimité, **jamais métré** — pas de toggle.
- Tant qu'aucun owner n'a activé le toggle, `overage_mode` reste `block` ⇒ **zéro
  facturation de dépassement** (on ne facture jamais un dépassement non demandé).

**Report d'usage** : la consommation au-delà du quota est reportée à Stripe par
**meter event** (`event_name = ai_reply_overage`) au niveau du **customer** (le payeur).
⚠️ Limite connue : le report est **par customer**, pas finement **par bot / par org** ;
le détail par bot vit en base (`bot_usage_counters.reported_overage`, exposé via
`GET /api/bots/{id}/entitlement` → `reported_overage`).

---

## 4. Rodage en test mode (Stripe CLI) avant le live

```bash
# 1. Relayer les webhooks Stripe test → ton API locale
stripe listen --forward-to http://localhost:8001/api/billing/webhook
#    (utilise le whsec_ affiché par 'stripe listen' comme STRIPE_WEBHOOK_SECRET en local)

# 2. Simuler des events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted

# 3. Tester un vrai paiement : depuis l'app, configure un bot payant → Checkout
#    → carte de test 4242 4242 4242 4242, date future, CVC quelconque.

# 4. Vérifier l'idempotence : rejouer un event
stripe events resend evt_xxx
```

Attendu : l'entitlement du bot s'active après `customer.subscription.created/updated`,
se dégrade sur `deleted`, et un event rejoué ne double rien (idempotence par `event.id`).

---

## 5. Passage en production (live mode)

1. Bascule le Dashboard en **live**, refais **§2.A** (clé `rk_live_`) et **§2.C**
   (webhook live → `whsec_` live).
2. Mets `STRIPE_SECRET_KEY=rk_live_…`, `STRIPE_WEBHOOK_SECRET=whsec_…` (live),
   `MOCK_BILLING=false` dans l'env de prod.
3. `alembic upgrade head` puis `python -m scripts.seed_billing_catalog` **en prod**
   (crée les Products/Prices live).
4. Vérifie un parcours réel (petit montant), puis :
5. **Phase observe** : `BILLING_ENFORCE=false` → l'app logge `billing.observe` sans
   bloquer. Surveille quelques jours.
6. **Phase enforce** : `BILLING_ENFORCE=true` → le gating devient actif (nouveaux bots
   `free` gatés, bots existants sans entitlement restent gratuits).

**Réversibilité** : retirer `STRIPE_SECRET_KEY` ⇒ `billing_enabled()=false` ⇒ app de
nouveau 100 % gratuite, nav facturation masquée.

---

## 6. Récap « élément Stripe → app »

| Tu crées sur Stripe… | Tu le mets dans… | Sert à… |
|---|---|---|
| Clé restreinte `rk_…` | `STRIPE_SECRET_KEY` | tous les appels API |
| Secret webhook `whsec_…` | `STRIPE_WEBHOOK_SECRET` | vérifier la signature des events |
| Webhook endpoint | *(URL pointant vers l'app)* | activer/dégrader les entitlements |
| Portail client (config) | *(rien)* | self-service résiliation/paiement |
| Products + Prices | *(rien → `seed_billing_catalog`)* | Checkout / abonnements |

---

## 7. Checklist

**Stripe (test puis live)**
- [ ] Clé restreinte `rk_` créée avec les permissions (§2.A ; + Billing Meters/Meter events Write si dépassement IA)
- [ ] Portail client configuré (cancel + payment method) (§2.B)
- [ ] Webhook créé sur `…/api/billing/webhook` + 4 events + `whsec_` copié (§2.C)
- [ ] Pied de facture « TVA non applicable, art. 293 B du CGI » (§2.D)
- [ ] (Products/Prices : **ne pas** créer à la main — laissés au seed)

**App**
- [ ] `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` dans l'env ; `MOCK_BILLING=false`
- [ ] `alembic upgrade head`
- [ ] `python -m scripts.seed_billing_catalog` (vérifier `stripe_price_id` remplis ; Meter + Price `mtr_ai` créés si billing actif)
- [ ] `GET /api/billing/catalog` OK ; webhook reçoit les events ; Checkout test OK
- [ ] `BILLING_ENFORCE=false` (observe) → puis `true`
- [ ] (Dépassement IA) `BILLING_METERING_ENABLED=true` ; toggle « Dépassement facturé » par bot dans Facturation (owner), plafond de sécurité posé (§3.5)

> ⚠️ Pré-requis non-Stripe : valider d'abord la branche en Docker (migrations + pytest +
> tsc + e2e), cf. discussion en cours sur le WIP TreeFlow du dossier principal.
