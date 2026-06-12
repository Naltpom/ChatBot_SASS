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
  action manuelle. Budget par run : setup frais = 2 registers API (compte
  principal + member), run reuse = 0 ; register-perso.spec = 1 register UI ;
  profile.spec ≤ 4 POST /password après son propre flush.
- Le global-setup (`global-setup.ts`) crée via l'API un compte entreprise
  (plan agence — exige `applied:true` : vider les STRIPE_* du .env), un bot
  partagé mode arbre (captcha désactivé) et un compte member « Membre E2E »
  (permissions remises à `{}`), puis écrit `e2e/.state.json` (gitignoré).
  Un état encore valide est réutilisé au run suivant (bots dédiés purgés,
  bot partagé remis à plat) — aucune inscription supplémentaire.
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
