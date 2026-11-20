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
