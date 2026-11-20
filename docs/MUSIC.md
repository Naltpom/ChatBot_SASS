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

## Devises (20/11/2026)

- **Paiement** : Adaptive Pricing de Stripe sur chaque session (`adaptive_pricing[enabled]=true`, désactivable par
  `MUSIC_ADAPTIVE_PRICING=false`). L'acheteur voit et paie le montant dans sa devise (taux garanti 24 h, frais de
  conversion de 2 à 4 % à sa charge), on reçoit des euros ; la session et le webhook restent en euros
  (`presentment_details` donne la devise payée). Si Stripe refuse l'option, la session est recréée en euros.
  À activer aussi dans le tableau de bord Stripe (Settings → Adaptive Pricing), qui en fixe la valeur par défaut.
- **Site** : prix en euros + équivalent indicatif « ≈ 2,15 $ » dans la devise du pays du navigateur
  (`navigator.languages`), taux BCE du jour (`GET /api/music/rates`, cache 6 h côté API).

## Lecture sur la feuille (20/11/2026)

- La production envoie `curseur.json` avec la partition (`cursor` à l'ingestion) : pour chaque attaque, son temps et sa
  place sur la page du PDF (`[t, page, x, haut, bas du système]`, fractions de la page A4). Stocké en `cursor.json`,
  renvoyé par `GET /sheets/{id}/notes` (`cursor`, coupé à 25 s pour l'aperçu). Un nouveau PDF sans curseur efface l'ancien.
- Le site joue les notes et fait glisser un curseur sur la feuille même (galerie de la fiche, pages empilées pour
  l'acheteur), la galerie suit la page jouée. Plus de rouleau de notes ni de grosse note.

## Fiches privées et dons (20/11/2026)

- Toutes les partitions ont une fiche `/s/<morceau>`. Une partition **privée** (non diffusée) ne s'y voit que par
  qui l'a (achat ou don, compte ou e-mail de la commande) et par un administrateur, avec un bandeau « page privée » ;
  sinon `GET /pieces/{slug}` répond 404 `private` et le site renvoie au catalogue. Elle ne s'achète pas.
- Qui a la partition voit ses pages nettes (`pages_full`) et le lecteur complet sur la fiche.
- Admin, onglet Partitions, colonne « Propriétaires » : achats et dons de chaque partition, **donner** la partition
  à une adresse e-mail (commande à 0 € `granted_by_user_id`, liée au compte s'il existe, e-mail de livraison
  facultatif) et retirer un don. Les dons ne comptent ni dans les ventes ni dans le chiffre.
- `index.html` servi en `no-cache` (un déploiement se voit tout de suite) ; fichiers de `/assets/` gardés un an.

## Aperçu limité à l'extrait et sécurité (20/11/2026)

- Aperçu public de la page 1 : net seulement jusqu'au bas de la dernière ligne jouée par l'extrait audio de 25 s
  (curseur), flouté dessous (`preview_cut`, `render_page1_preview`, refait à chaque ingestion avec curseur).
- Achats faits sans compte : rattachés à un compte par l'adresse e-mail **seulement si elle est vérifiée**
  (lien de confirmation, ou connexion Google) ; « Mes partitions » propose d'envoyer le lien. Un don de l'admin
  n'est lié au compte que si son adresse est vérifiée.
- Codes promo : utilisation réservée à la commande de façon atomique (plus de course entre commandes simultanées),
  rendue si la session expire ou échoue ; réponse unique `promo_invalid` (ne révèle pas qu'un code existe) ;
  devis avec code et commandes limités par IP (30 / 10 min).
- Remboursement complet (`charge.refunded` avec `refunded` vrai) : commande `refunded`, accès coupé ; remboursement partiel : rien.
- Litige (`charge.dispute.created`) : commande `disputed`, accès suspendu ; `charge.dispute.closed` gagné -> `paid` (accès rendu), perdu -> `refunded`.
  **Cochés dans Stripe** pour le webhook de la boutique (live) : `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` en plus des `checkout.session.*`.
- Droits admin sur la boutique (pages privées, pages nettes) : superadmin avec 2nd facteur en production.

## Suivi des liens et INSTA20 (21/11/2026)

- Les liens envoyés après « SHEET » portent `?b=<8 caractères>` (un code par envoi, déclaré par la production avec
  `POST /api/music/ingest/links` : code -> pseudo Instagram) et `&code=INSTA20` (-20 %, créé par la migration).
- Le site garde le code (stockage local, retiré de l'adresse) ; une bannière demande l'accord. Avec l'accord seulement,
  les actions sont envoyées par lots à `POST /api/music/track` (arrivée, pages, lecture, panier, paiement, achat,
  clic vers le Reel, langue) ; la commande garde le code (`track_code`). Conservation 13 mois. Sans accord : rien.
- Admin, onglet « Suivi des liens » : liens envoyés, liens visités, et pour chacun le parcours et les achats.
