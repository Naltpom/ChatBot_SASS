# Boutique de partitions — music.chapote.fr

Vente des partitions des vidéos Instagram @ghosthands.music (une vidéo = un morceau sur un instrument).

## Parcours

1. La chaîne de production (dépôt claude-cloud, `scripts/music_sync.py`) envoie chaque partition :
   `POST /api/music/ingest` (Bearer `MUSIC_INGEST_TOKEN`), multipart `meta` (JSON) + `pdf` + `cover`.
   Domaine public (`rights == "domaine public"`) = **en vente d'office** ; sinon **privée** (non diffusée).
   Une mise à jour garde la décision de diffusion prise dans l'admin.
2. Le serveur rend les aperçus (`pdftoppm` + Pillow) : page 1 nette (bas flouté si la partition n'a qu'une page),
   pages suivantes réduites et floutées. Le PDF complet n'est servi qu'après paiement.
3. L'acheteur (mobile d'abord : il arrive du lien Instagram) choisit un ou plusieurs instruments, voit le prix
   **calculé par le back** (`POST /api/music/quote`), coche le consentement (exécution immédiate, perte du droit
   de rétractation, art. L221-28 13° C. conso.), paie sur Stripe Checkout (`mode=payment`, `price_data`).
4. Webhook **dédié** `POST /api/music/stripe/webhook` (secret `STRIPE_MUSIC_WEBHOOK_SECRET`, événements
   `checkout.session.*`) → commande payée → e-mail avec les liens. La page `/thanks` relit aussi la session
   Stripe si le webhook tarde.
5. Liens de téléchargement : clé HMAC de la commande (rien à stocker), valables `MUSIC_DOWNLOAD_DAYS` (365 j).

## Prix

- `music_settings` (ligne unique) : prix d'une partition (199) et du lot d'un morceau (299, NULL = pas de lot).
- Prix propre par partition (`music_sheets.price_cents`).
- Codes promo (`music_promo_codes`) : pourcentage ou montant, plafond d'utilisations, date de fin. Total 0 =
  commande gratuite livrée sans Stripe. Minimum Stripe : 0,50 €.

## Admin

`/admin/music` (superadmin) : vue d'ensemble, toutes les partitions avec diffusion on/off et prix propre,
prix généraux, codes promo, commandes (renvoi de l'e-mail).

## Déploiement

- Service `music` (`music/`, nginx) sur `127.0.0.1:${MUSIC_PORT:-3002}` ; son nginx relaie `/api/music/` vers
  `api` (même origine, pas de CORS). Le reverse proxy de l'hôte envoie `music.chapote.fr` vers ce port.
- Volume `music_files` (`/app/music_files`, privé). L'image API embarque `poppler-utils`.
- Variables : `MUSIC_URL`, `MUSIC_INGEST_TOKEN`, `STRIPE_MUSIC_WEBHOOK_SECRET` (+ `STRIPE_SECRET_KEY`, SMTP).
- Dev : `cd music && npm run dev` (port 3002, proxy `/api/music` vers `localhost:8001`).

## V2 (20/11/2026)

- **Langues** : EN, FR, ES, RU (langue du navigateur par défaut, menu avec drapeaux) ; textes légaux traduits
  (le français fait foi). Thème clair/sombre selon l'appareil ; les partitions restent sur fond blanc.
- **Comptes partagés** : le cookie de session vaut pour `chapote.fr` et ses sous-domaines (domaine parent commun
  d'`APP_URL` et `MUSIC_URL` en production, ou `AUTH_COOKIE_DOMAIN`). Le site music expose seulement
  `/api/auth/(login|register|google|logout|me)` et envoie `X-Chapote-App: music` ; `users.signup_app` garde le
  service d'inscription, `user_apps` les services utilisés. Connexion Google : ajouter `https://music.chapote.fr`
  aux origines JavaScript autorisées du client OAuth.
- **Avis** : 1 à 5 étoiles, seulement par un compte qui a payé la partition (`music_reviews`) ; l'admin peut masquer.
- **Chiffres** : j'aime et commentaires du Reel (`POST /api/music/ingest/stats`, envoyés par la production),
  téléchargements réels.
- **Lecteur** : notes de la vidéo (`notes.json` envoyé à l'ingestion), aperçu de 25 s ; complet et pages nettes
  (`/sheets/{id}/clear/{n}.png`) pour l'acheteur (clé de commande ou compte).
- **Pseudo Instagram** facultatif à la commande : `GET /api/music/ingest/instagram-pending` +
  `POST /api/music/ingest/instagram-done`, traités par la production (message privé si la fenêtre de 24 h est ouverte).
- **IP réelle** : le nginx de music transmet la vraie IP (`X-Music-Client-IP`) signée par la clé partagée `X-Music-Proxy-Key` (= `MUSIC_INGEST_TOKEN`), utilisée par les limiteurs de connexion.
- **E-mails** : expéditeur `MUSIC_EMAIL_FROM` (« Ghost Hands Sheets <music@chapote.fr> »), réponses `MUSIC_REPLY_TO`.
