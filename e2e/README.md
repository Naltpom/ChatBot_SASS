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

- **1 worker obligatoire** (`workers: 1` dans la config) : rate limits API en
  mémoire + données partagées entre specs.
- **Rate-limit auth** : 10 login+register / 15 min / IP côté API. La suite en
  consomme au plus 2 par run (1 register API du global-setup, 1 inscription UI
  dans `register-perso.spec.ts`). En cas de 429 : `docker compose restart api`,
  attendre que http://localhost:8001/docs réponde, relancer.
- Le global-setup (`global-setup.ts`) crée via l'API un compte entreprise
  (plan agence) + un bot mode arbre (captcha désactivé) et écrit
  `e2e/.state.json` (gitignoré). Un état encore valide est réutilisé au run
  suivant — aucune inscription supplémentaire.
- **Aucun chemin IA** n'est emprunté (MOCK_AI=false, vraies clés facturées) :
  bots en mode arbre uniquement, pas de nœud `__ai__`.
- L'auto-login superadmin dev est neutralisé dans les tests par la clé
  localStorage `kc_no_autologin` (posée via `addInitScript`, voir
  `app/src/AuthContext.tsx`).
