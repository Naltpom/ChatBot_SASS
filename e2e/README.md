# Tests E2E (Playwright)

Suite end-to-end du dashboard (http://localhost:3001) et du widget
(http://localhost:8001), exécutée sur l'hôte contre la stack docker compose DEV.

## Prérequis

- Stack dev lancée : `docker compose up -d --build` (db + api + app)
- Node ≥ 18 sur l'hôte
- Première installation :

```bash
cd e2e
npm install
npx playwright install chromium
```

## Lancer

```bash
cd e2e
npm test                                  # toute la suite
npx playwright test tests/widget.spec.ts # une spec
```

## Contraintes à connaître

- **1 worker obligatoire** (`workers: 1` dans la config) : données partagées
  entre specs (compte/org/bot du state) + rate limits API par IP.
- **Rate-limit auth** : 10 login+register+password / 15 min / IP, PERSISTANT
  dans Redis (un restart api ne le purge pas). Le global-setup exécute
  `docker compose exec redis redis-cli FLUSHALL` en tête de run (helper
  `flushRedis`, ré-appelé par profile.spec) : la suite est rejouable sans
  action manuelle. Budget par run : setup frais = 3 registers API (compte
  principal + member + admin non-owner), run reuse = 0 ; register-perso.spec =
  1 register UI ; profile.spec ≤ 4 POST /password après son propre flush.
- Le global-setup (`global-setup.ts`) crée via l'API un compte entreprise
  (plus aucune notion de plan : toute org est « tout ouvert » par défaut), un
  bot partagé mode arbre (captcha désactivé), un compte member « Membre E2E »
  (permissions remises à `{}`) et un compte ADMIN NON-OWNER « Admin E2E »
  (rôle `admin` de l'org partagée mais qui n'en est PAS l'owner —
  `state.adminToken`/`adminUserId` ; sert au gating facturation des specs
  `billing-*`), puis écrit `e2e/.state.json` (gitignoré). Un état encore valide
  est réutilisé au run suivant (bots dédiés purgés, bot partagé remis à plat) —
  aucune inscription supplémentaire.
- **Specs facturation (`billing-*`)** : `billing-catalog-parity.spec.ts`
  (parité figée de `GET /api/meta/billing-catalog`, comme `permissions-parity`)
  tourne TOUJOURS. Les autres (`billing-owner-gating`, `billing-degradation`,
  `billing-checkout-return`, `billing-grouping`) assertent le contrôle d'accès
  payeur (403/404, indépendant des clés Stripe) et, pour les volets gating
  modules / UI / grouping, se `skip` automatiquement quand le billing est OFF
  (clés Stripe absentes ⇒ `billing_enabled()==False`, invariant D0 : tout
  gratuit, 32 e2e historiques verts) ou en mode observe (`BILLING_ENFORCE=false`).
  Pour les exercer réellement : poser des clés Stripe de TEST + `MOCK_BILLING=true`
  (aucun appel Stripe sortant) + `BILLING_ENFORCE=true` côté API (voir
  « Sandbox Stripe » plus bas). L'IA n'est JAMAIS exercée (bots mode `tree`,
  assertions via `GET /api/bots/{id}/entitlement`).
- **Aucun chemin IA** n'est emprunté (MOCK_AI=false, vraies clés facturées) :
  bots en mode tree (ou hybrid sans jamais ouvrir le widget), pas de nœud
  `__ai__`, pas de tree/generate. Webhooks d'action → `https://e2e.invalid`
  (jamais résolu) ; Calendly intégralement stubé (`interceptCalendly`) ;
  un seul POST /api/widget/lead réel par run (limiteur 5/h/session).
- Données jetables : `createOrg`/`createBot` (helpers.ts, endpoints non
  rate-limités, noms préfixés « E2E ») — jamais supprimées, purge via
  `docker compose down -v`.
- L'auto-login superadmin dev est neutralisé dans les tests par la clé
  localStorage `kc_no_autologin` (posée via `addInitScript`, voir
  `app/src/AuthContext.tsx`) ; `devLoginToken` fournit un token superadmin
  gratuit (POST /api/auth/dev-login, non rate-limité).

## Sandbox Stripe (validation manuelle pré-merge, hors CI)

La suite e2e tourne `MOCK_BILLING=true` : `stripe_service` n'émet **aucun appel
Stripe sortant** (Checkout/Portal simulés, entitlements projetés directement).
Cela couvre l'activation/dégradation et les formats de facture sans Stripe. Ce
que le mock NE couvre PAS — **signature de webhook réelle, proration, Customer
Portal, idempotence d'event** — se valide à la main avec la **Stripe CLI** sur
une clé **`rk_test_`** (restricted, jamais `sk_live`) — spec §7.5 / §9.

```bash
# 1. Clés de TEST côté API (api/.env ou docker-compose override) :
#    STRIPE_SECRET_KEY=rk_test_...        (restricted : Customers/Checkout/
#                                          Subscriptions write, Products/Prices
#                                          read+write, Portal write, Invoices read)
#    STRIPE_WEBHOOK_SECRET=whsec_...      (fourni par `stripe listen` ci-dessous)
#    MOCK_BILLING=false                   (on veut de VRAIS appels Stripe test)
#    BILLING_ENFORCE=true                 (pour observer le gating 402)
#    -> billing_enabled()==True ; valide en local, JAMAIS en prod (rk_live + IP).

# 2. Seed du catalogue (idempotent) : crée Products/Prices test, remplit
#    billing_products.stripe_price_id. mtr_ai reste is_active=false (v1).
docker compose exec api python -m scripts.seed_billing_catalog

# 3. Forward des webhooks vers l'API locale (laisser tourner ; copier le whsec_).
stripe listen --forward-to localhost:8001/api/billing/webhook

# 4. Déclencher des events et vérifier la projection des entitlements :
stripe trigger checkout.session.completed       # active la sub / les modules
stripe trigger customer.subscription.updated    # resync des modules
stripe trigger customer.subscription.deleted    # révocation (état NET, §4.2)

# 5. Idempotence (billing_webhook_events) : re-livrer le MÊME event ne doit
#    PAS dupliquer l'effet.
stripe events resend <evt_id>

# 6. Cartes de test (Checkout réel) : 4242 4242 4242 4242, date future, CVC libre.
#    Tableau de bord test : https://dashboard.stripe.com/test/ (mode Test activé).
```

Points à vérifier manuellement (non couverts par le mock) :
- la **signature HMAC** réelle est acceptée (corps en bytes bruts) ; une
  signature absente/invalide/expirée (> tolérance 300 s) → **400** ;
- le **Customer Portal** s'ouvre, gère moyens de paiement + résiliation ;
- la **proration** au changement de format (`PUT /api/billing/grouping`) ne
  perd aucun module (entitlements préservés) ;
- un `subscription.deleted` reçu pendant un re-grouping ne révoque pas à tort
  (état NET = union des subs actives, spec §4.2).

> En CI, ces clés sont **absentes** : `billing_enabled()==False`, les specs
> `billing-*` gating se `skip` et les 32 e2e historiques restent verts (D0).
