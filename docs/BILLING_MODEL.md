# Modèle de facturation « à la carte » — design

> Statut : **proposition de design** (branche `feat/billing-modulaire`, worktree isolé).
> Stripe est aujourd'hui **dormant** (parking-lot, tout-ou-rien sur 5 vars `STRIPE_*`,
> plans starter/pro/agence = placeholders inertes). Ce document fige le modèle cible
> avant l'implémentation. Spec d'implémentation détaillée → `BILLING_IMPLEMENTATION_SPEC.md`.
> Rédigé le 2026-06-20.

## 1. Principe directeur

Modèle **modulaire type « configurateur VPS »** : le client compose ce qu'il veut
(capacités + quotas), la facture se recompose en direct comme un panier. Mais on
distingue **deux natures de coût** — c'est le cœur du modèle :

| Axe | Nature | Facturation |
|---|---|---|
| **Capacités** (modules) | feature flag logiciel, coût marginal ~0 | **add-on forfaitaire** (on/off) |
| **Ressources** (quotas) | coût réel variable (surtout l'IA) | **quota inclus + dépassement métré** |
| **Socle gratuit** | arbre, apparence, triggers, intégration, analytics | **jamais facturé** (argument de vente) |

> On ne facture jamais le fait de *cocher* une case qui ne coûte rien ; on facture
> l'usage réel (l'IA) et le déblocage des modules à valeur (Inbox, RAG, MCP…).

## 2. Entité facturable : le **User** (décision actée)

- Le **client Stripe** (`cus_...`) est attaché à un **User**, **pas** à une Organization.
- `stripe_customer_id` / `stripe_subscription_id` migrent (ou se dédoublent) de
  `Organization` vers `User`. *(Aujourd'hui ces colonnes vivent sur `Organization` —
  voir `api/src/models/user.py:57-58`.)*
- **Gestion réservée au owner de l'org** : pour les bots d'**équipe**, seul le
  **propriétaire (owner)** de l'organisation accède aux écrans de facturation et au
  portail Stripe. Les autres admins/membres ne voient pas la facturation.
  - ⚠️ Pré-requis modèle : introduire/confirmer une notion d'**owner d'org**
    (`Organization.owner_user_id` ou rôle `owner` dans `Membership`). À trancher dans
    la spec d'implémentation — aujourd'hui il n'y a que `admin`/`member`.
- Pour les bots **perso** (`owner_user_id`), le payeur = le User propriétaire lui-même.

### Conséquence : qui paie quoi ?

```
User (= Customer Stripe unique)
├── Bots perso (owner_user_id)        → payés par le User
└── Orgs dont il est OWNER            → il paie les bots de ces orgs
    └── (admin non-owner)             → ne gère PAS la facturation
```

Un User qui n'est owner d'aucune org ne paie que ses bots perso. Un User owner de
plusieurs orgs paie pour toutes — d'où le besoin de **regrouper les factures** (§4).

## 3. Composition d'un prix par bot

```
Facture mensuelle du bot « SAV Acme »
─────────────────────────────────────
Socle (arbre + apparence + triggers + analytics)      gratuit
Plan IA Growth — 3 000 réponses IA/mois                  39 €   ← moteur (quota)
+ Connaissances (RAG)                                     9 €   ← add-on
+ Live chat / Inbox                                      15 €   ← add-on
+ Actions & MCP                                          19 €   ← add-on
─────────────────────────────────────
Total bot (profil « Service client »)                    82 € net
(TVA non applicable, art. 293 B · quota atteint = blocage en v1, 0 surfacturation)
```

### Catalogue (figé 2026-06-20 — détail + centimes dans `BILLING_IMPLEMENTATION_SPEC.md` §2.2)

Prix **nets (TVA non applicable, art. 293 B)**, **par bot/mois**. Annuel −17 % (2 mois offerts). Modèle managé borné Haiku/GPT-4o-mini (Sonnet dès Growth ; gros volumes Sonnet → BYOK).

**Socle gratuit** : bot `is_active`, arbre illimité, apparence, triggers, analytics de base, intégration/embed → **0 €**.

**Plans IA** (quota de réponses, porte le prix du moteur) : Gratuit 50 rép **0 €** · Starter 1 000 **19 €** · Growth 3 000 **39 €** ★ · Scale 10 000 **89 €** · **BYOK** illimité **29 €**.

**Add-ons** (forfait/mois) : Connaissances (RAG) **9 €** · Live chat / Inbox **15 €** · Actions & MCP **19 €** · A/B testing **7 €** · White-label **9 €**.

**Ressource métrée** : réponses IA/mois (seule au vrai coût provider) — v1 = **blocage au quota**, v2 = dépassement **0,015 €/réponse**. *(optionnels v2 : volume KB, conversations, sièges Inbox.)*

**Profils** : Vitrine/FAQ (Starter+RAG) **28 €** · Service client (Growth+RAG+Inbox+Actions) **82 €** ★ · Sur-mesure/Volume (Scale+tout) **148 €** *(ou BYOK+tout = 88 € illimité)*.

## 4. Format de facture au choix du User (décision actée)

Le User choisit comment ses factures sont **regroupées** (préférence stockée sur le
User, ex. `User.billing_grouping`). Trois formats :

| Format | Regroupement | Mapping Stripe |
|---|---|---|
| **Par bot** | 1 facture par bot | **1 subscription Stripe par bot** (chacune émet sa facture) |
| **Totale** | 1 facture unique tous bots | **1 subscription**, 1 line-item par bot/module |
| **Par org** | 1 facture par org (+ 1 perso) | **1 subscription par org-group** (+ 1 pour les bots perso) |

Points communs aux 3 formats :
- **Un seul `Customer` Stripe** = le User. Un customer peut porter **plusieurs
  subscriptions** : c'est ce qui permet de scinder les factures (par bot / par org)
  sans multiplier les clients ni les moyens de paiement.
- Le détail par bot apparaît toujours en **line items**, donc même la facture
  « totale » reste lisible bot par bot.
- Changer de format = **re-grouper les subscriptions** (résilier/recréer les abos
  côté Stripe en conservant les entitlements). Opération à encadrer (proration).

> Recommandation produit : défaut = **Totale** (le plus simple, 1 prélèvement),
> « Par bot » et « Par org » en options avancées pour agences / refacturation client.

## 5. Levier BYOK (clé IA du client)

Si `api_key_mode = byok` sur un bot, **le coût IA est porté par le client** → on
**ne métre plus** les réponses IA de ce bot. On facture alors uniquement un **forfait
plateforme** (module IA en mode BYOK, prix fixe). Excellent argument « gros comptes /
souveraineté ». À refléter dans le catalogue (le module IA a 2 variantes : *managé
métré* vs *BYOK forfait*).

## 6. Architecture technique (vue d'ensemble)

### 6.1 Couche entitlements / quotas (à créer)

Aujourd'hui **rien ne gate** : `usage_service.count_ai_messages_today` est un simple
**compteur d'affichage** (cf. son docstring), aucune logique ne bloque dessus. Il faut :

1. **Stocker les entitlements** (modules débloqués + quota IA) — au niveau **bot**
   (cohérent avec le modèle « config par bot »), synchronisés depuis Stripe par le
   webhook `customer.subscription.updated`.
2. **Enforcer** aux points de passage (déjà identifiés dans l'inventaire) :
   - endpoint message IA (`POST /api/widget/message`) → module IA actif + quota
   - ingestion KB (`POST /kb/sources*`) → module RAG actif
   - exécution actions / MCP → module Actions & MCP actif
   - handoff / inbox → module Live chat actif
   - A/B (PATCH `tree_variant_json`) → module A/B actif
3. **Réutiliser l'infra rate-limit** (`services/rate_limit.py`, Redis ZSET, fail-open) :
   les compteurs de quota mensuel sont la même mécanique que les limiteurs existants
   (`treegen 10/24h`, `insights 3/24h`…) — pas à réinventer.

### 6.2 Intégration Stripe (recâblage du module dormant)

- Customer sur **User** (création paresseuse à la 1re souscription).
- **Build-your-own subscription** : 1 subscription = N items (1 par module) +
  1 item **metered** (meter « réponses IA ») pour le dépassement.
- Webhooks (signature déjà vérifiée maison) → synchro entitlements bot.
- Portail Stripe épinglé (déjà câblé pour update/cancel) → réservé au owner.
- Détail meters vs graduated/volume tiers, restricted keys, Checkout vs Elements :
  **tranché dans la spec via le skill `stripe-best-practices`**.

### 6.3 Ce qui existe déjà (réutilisable)

- Module `services/stripe_service.py` complet (REST httpx, customer, checkout, portal,
  invoices, webhook sig) — **dormant**, à recâbler sur le modèle modulaire.
- Settings `STRIPE_*` tout-ou-rien + `billing_enabled()`.
- Données de métrage : `count_ai_messages_today`, `bots_week_stats`, table `tree_events`.

## 7. Risques & garde-fous produit

- **Paralysie de choix** : ne pas exposer 30 cases. Configurateur **guidé** : 2-3
  presets (Vitrine gratuit / Pro IA+RAG / Service client +Inbox) + mode avancé.
- **Cohérence multi-format** : changer de regroupement de factures touche aux
  subscriptions Stripe (proration) — encadrer, tester.
- **Owner d'org manquant dans le modèle** : pré-requis bloquant à trancher tôt.
- **Migration douce** : app actuellement 100 % gratuite → rollout en mode **observe**
  (log-only) avant d'activer l'enforcement ; invariant **billing OFF ⇒ tout gratuit**.
  *(Grandfathering supprimé — amendement 2026-06-20 : app non lancée, rien à protéger.)*

## 8. Décisions actées (résumé)

1. ✅ Client Stripe = **User** (pas org).
2. ✅ Facturation des bots d'équipe gérée **uniquement par le owner de l'org** (nouvelle colonne `Organization.owner_user_id`).
3. ✅ User choisit le **format de facture** : par bot / totale / par org.
4. ✅ Modèle = **socle gratuit + modules forfaitaires + IA métrée** (pas de « tout coché »).
5. ✅ **BYOK** = bot non métré, forfait plateforme.
6. ✅ **Axe métré IA phasé** : v1 = blocage au quota / v2 = Stripe Billing Meters / v3 = Metronome si multi-dimensionnel *(amendement 2026-06-20)*.
7. ✅ **Grandfathering supprimé** (app non lancée) ; seul invariant : billing OFF ⇒ tout gratuit *(amendement 2026-06-20)*.
8. ✅ **Aucune TVA** (franchise en base, art. 293 B du CGI ; `automatic_tax` désactivé) *(amendement 2026-06-20)*.
9. ✅ **Montants du catalogue figés** (2026-06-20) — voir §3 et `BILLING_IMPLEMENTATION_SPEC.md` §2.2. Plus aucun arbitrage produit ouvert.
