# Intégration continue (CI)

`.github/workflows/ci.yml` — déclenché sur **push** et **pull request** vers
`master`. Objectif de PR-15 : **supprimer le faux-vert**. Avant, seul
`deploy.yml` existait (déploiement manuel) ; aucun job ne lançait pytest ni les
e2e, donc les ~320 tests pytest et les e2e billing ne protégeaient **rien**
automatiquement.

## Matrice des jobs

| Job | Runner | Sert à | Skip toléré ? |
|-----|--------|--------|---------------|
| `pytest` | ubuntu-latest + service Postgres `pgvector/pgvector:pg16` | Suite backend complète, **dont les real_db** (harness PR-10) exécutés pour de vrai | Non — `REQUIRE_REAL_DB=1` transforme « DB absente » en échec dur |
| `e2e-billing` | ubuntu-latest + stack `docker compose` | Specs `billing-*.spec.ts` avec le billing **armé** ; un garde casse le build si une spec skippe | Non — garde anti-skip explicite |

## Job `pytest`

- **Service Postgres : `pgvector/pgvector:pg16`** (et NON `postgres:16` nu).
  `api/tests/real_db.py` pose `CREATE EXTENSION vector` (colonne
  `kb_chunks.embedding`) et `unaccent` (colonne générée `kb_chunks.tsv`) ; sans
  l'extension `vector`, le bootstrap du schéma échouerait (rouge légitime).
- **Base de maintenance `chatbot_saas`** : `real_db._create_database_if_absent()`
  s'y connecte pour `CREATE DATABASE chatbot_saas_test`. L'utilisateur
  `POSTGRES_USER` de l'image pgvector est superuser ⇒ droit `CREATE DATABASE`.
- **Env clés :**
  - `DATABASE_URL=postgresql+asyncpg://chatbot:chatbot_secret@localhost:5432/chatbot_saas`
  - `REQUIRE_REAL_DB=1` → indisponibilité DB = `pytest.fail` (les 161 real_db
    **s'exécutent**, sinon rouge — fin du skip gracieux silencieux).
  - `MOCK_AI=true`, `MOCK_BILLING=true` → aucun appel sortant.
  - `JWT_SECRET_KEY` (≥ 32 car.) et `ENCRYPTION_KEY` (clé Fernet valide) factices.
- **Commande :** `python -m pytest` lancé depuis `api/` (le `-m` ajoute `api/` à
  `sys.path` pour `import src.main`).
- **Parité incluse :** `api/tests/test_billing_catalog_parity.py` (volet backend
  interne) tourne dans ce job. Le volet cross-surface front/PHP est couvert côté
  e2e (`billing-catalog-parity.spec.ts`, voir job suivant).

### Les 2 rouges billing déselectionnés

Deux tests sont retirés via `--deselect` :

- `tests/test_billing_grouping.py::test_subscription_update_prorata_via_items`
- `tests/test_billing_grouping.py::test_subscription_update_downgrade_supprime_item`

**Pourquoi.** Ces deux-là forcent volontairement `MOCK_BILLING=False` + une clé
`rk_test` (`monkeypatch`) pour exercer le **vrai** chemin Stripe
(`update_subscription_items` au prorata / suppression d'item). Ils émettent donc
de **vrais appels HTTP Stripe** qui ne peuvent pas aboutir en CN (pas de clé
réelle, réseau Stripe non sollicité). Ce sont des **rouges pré-existants liés à
Stripe-réel**, hors périmètre d'une CI hermétique.

**Choix : `--deselect` ciblé** (plutôt qu'« tolérer N échecs »). Ainsi la CI est
**verte** et **tout NOUVEL échec casse le build** — une tolérance globale
masquerait les régressions futures. Si un jour la CI dispose d'une clé Stripe de
test fonctionnelle, retirer les deux `--deselect` réintègre ces tests.

## Job `e2e-billing`

- **Stack complète via `docker compose up -d --build --wait`** : `db` (pgvector
  pg15, déjà fournie par le compose dev), `redis`, `api` (8001), `app` (3001).
  `--wait` attend les services *healthy* ; `app` n'ayant pas de healthcheck, une
  attente manuelle sonde `http://localhost:3001`.
- **Billing ARMÉ** (c'est ce qui retire le faux-vert) via le `.env` généré :
  - `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` **factices** ⇒
    `billing_enabled()` = `bool(SECRET && WEBHOOK)` = **True** ⇒ les specs
    s'exécutent au lieu de `test.skip`.
  - `MOCK_BILLING=true` ⇒ **aucun appel Stripe sortant** (checkout / portail /
    abonnement mockés, entitlement projeté directement).
  - `BILLING_ENFORCE=True` ⇒ le gating renvoie vraiment `402`
    (`billing-degradation.spec.ts` exerce son invariant d'enforcement).
- **Seed catalogue** : `docker compose exec -T api python -m scripts.seed_billing_catalog`.
- **Playwright** : `npm install` + `npx playwright install --with-deps chromium`,
  puis `npx playwright test billing-` (filtre = tous les `billing-*.spec.ts`,
  catalog-parity compris).

### Suppression du faux-vert : le garde anti-skip

Les specs billing skippent quand `me.billing_enabled` est faux
(`test.skip(!(await billingEnabled(...)))`). C'était silencieux et la CI restait
verte sans rien prouver. **Aucune modification des specs n'est nécessaire** : le
skip lit l'état réel de l'API, donc avec le billing armé en CI il **ne skippe
pas** (et reste correct en dev local, où billing OFF = skip légitime). Le `.env`
de dev n'est pas touché ; `docker-compose.yml` garde ses défauts (billing OFF).

L'enforcement est dans la CI : la suite tourne avec `--reporter=json`, puis un
garde lit `stats.skipped` / `stats.expected` du rapport et **échoue le build si
au moins une spec billing a été skippée** (ou si zéro test n'a tourné). Un
armement raté (clés non vues) ne peut donc plus passer pour un vert.

## Honnêteté sur ce qui reste à prouver

- **`pytest`** : structure et env validés ; le **vert réel** dépend du 1er run
  GitHub (la suite n'a pas été exécutée localement contre un Postgres pgvector
  pendant l'implémentation). Risque résiduel : d'éventuels rouges pré-existants
  *autres* que les 2 déselectionnés (à traiter au 1er run le cas échéant).
- **`e2e-billing`** : le plus **lourd/fragile**. Build bun du front, build de
  l'image api, `docker compose --wait`, install Playwright, et le démarrage de la
  stack ne sont **prouvés qu'au 1er run GitHub Actions**. Points de fragilité
  connus : temps de build, premier téléchargement du modèle fastembed côté api
  (lazy), disponibilité de Chromium. Le job est structuré correctement mais peut
  demander une stabilisation au premier passage réel.

## Validation locale effectuée

- Parse YAML OK (`yaml.safe_load`).
- `act` : graphe de jobs / dry-run (voir le rapport de la PR).
