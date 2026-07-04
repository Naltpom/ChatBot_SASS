# ChatBot SaaS 🤖

Plateforme SaaS **multi-tenant** de chatbots embarquables, **hybrides arbre de
décision + IA**.

- **Clients (organisations)** : wizard de création, page bot complète (stats,
  mode tree/IA/mixte, modèle, apparence avancée avec aperçu live, sécurité),
  intégration HTML / iframe / GTM / WordPress, config exportable en JSON.
- **Multi-appartenance** : une personne peut être membre de plusieurs
  organisations (switcher en haut du dashboard).
- **Admin (staff, comptes superadmin)** : vue sur tous les clients
  (membres, bots, conso), changement de plan, suspension, et configuration
  des bots clients via les mêmes pages.

## Démarrage rapide

```bash
cp .env.example .env   # puis renseigner ENCRYPTION_KEY + JWT_SECRET_KEY
docker compose up -d --build
```

| Service   | URL                          |
|-----------|------------------------------|
| Dashboard | http://localhost:3001        |
| API docs  | http://localhost:8001/docs   |
| Widget    | http://localhost:8001/widget.js |

En dev, `MOCK_AI=true` : les réponses IA sont simulées, aucune clé requise.

### Migrations (hors boot de l'app)

L'app **ne joue plus** `alembic upgrade head` à son démarrage : en multi-worker /
multi-réplica, migrer au boot bloque le démarrage de tous les réplicas et crée des
courses. Les migrations sont une **étape dédiée**, jouée **une seule fois, AVANT de
(re)démarrer l'app**. L'app suppose une base déjà migrée.

- **Dev** : `docker compose up` lance d'abord le service one-shot `migrate`
  (`alembic upgrade head`) dont l'api dépend (`service_completed_successfully`) ;
  rien à faire de plus. Rejouer à la demande : `make migrate`.
- **Prod** : `deploy.sh` joue `docker compose run --rm api alembic upgrade head`
  **entre** le build et le `up -d` (un seul process de migration).

L'acquisition du verrou de migration (`pg_advisory_lock`) est **bornée** (~30 s,
`statement_timeout`) : en cas de contention, la migration échoue avec une erreur
claire au lieu de figer le déploiement indéfiniment.

**Tester le widget** : créer un compte + un bot dans le dashboard, copier la clé
`pk_...` (onglet Installation), la coller dans `demo/index.html`, puis :

```bash
python -m http.server 8080 -d demo
```

En dev avec `AUTO_LOGIN_ADMIN_DEV=true`, le dashboard se connecte tout seul en
superadmin (`ADMIN_EMAIL`).

## Modèle économique

- **Plans par organisation** : quota de réponses IA mensuelles **et** nombre max
  de bots (free : arbre seul, 10 bulles max, 0 IA, 1 bot · starter 500 IA / 1 bot / 19 € ·
  pro 2000 / 3 / 39 € · agence 10000 / 10 / 119 €) — les réponses de l'arbre
  sont **illimitées** (coût quasi nul).
- **Clés managées** (nos clés, marge sur la conso) ou **BYOK** (le client apporte
  sa clé, chiffrée en base, plan réduit).
- **Cap quotidien** de réponses IA par bot : au-delà, le widget passe en mode
  dégradé arbre-seul (protection cash-flow).

## Sécurité du widget

```
widget JS → API (origin whitelist + captcha + JWT 30min + rate limits + caps) → provider IA (clé serveur)
```

1. La clé embarquée `pk_...` est **publique** — elle n'ouvre qu'une session de chat
2. Vérification de l'**Origin** contre les domaines déclarés du bot
3. **Captcha invisible** au handshake (Turnstile par défaut — RGPD-friendly,
   reCAPTCHA v3 avec les clés du client, ou désactivé)
4. **JWT de session 30 min**, re-handshake transparent à l'expiration
5. **Rate limits** par session (20 msg/10 min) et par IP (anti-flood)
6. **Caps budget** quotidien + mensuel → mode dégradé tree-only
7. System prompt verrouillé côté serveur (anti prompt-injection)

Les clés IA (managées ou BYOK) ne quittent jamais le serveur.

## RGPD

- Visiteurs identifiés par **UUID anonyme en localStorage** (strictement
  nécessaire au chat → exempté de consentement), jamais par IP.
- L'IP ne sert qu'au rate limiting en mémoire, **jamais stockée**.
- Chaque option captcha documente son flux de données dans l'UI (sous-traitants
  à déclarer) — positionnement « compliance-ready ».

## Stack

- **API** : FastAPI + SQLAlchemy async + PostgreSQL 15 (architecture calquée sur `ao_scrapping`)
- **Dashboard** : React + Vite + TypeScript (Bun)
- **Widget** : JS vanilla, zéro dépendance, servi par l'API
- **IA** : Anthropic / OpenAI / Gemini via httpx (pas de SDK), mock en dev

## Roadmap v2

- Tracking de parcours comme **contexte pour le bot** (pas comme analytics)
- Builder d'arbre visuel (drag & drop)
- Facturation Stripe + paliers d'usage
- Rate limiting Redis (prérequis multi-worker)
- Alembic pour les migrations
- Web vitals en bonus gratuit
