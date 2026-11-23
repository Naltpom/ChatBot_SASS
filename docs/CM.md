# Gestion des réseaux sociaux — cm.chapote.fr

Planning et publication d'une vidéo sur plusieurs comptes TikTok, YouTube (Shorts) et Instagram (Reels),
maintenant ou à une heure précise, et chiffres de chaque compte (abonnés, vues, vidéos récentes).
Même compte que chapote.fr et music.chapote.fr (cookie de session sur `chapote.fr`, `X-Chapote-App: cm`).

## Architecture

- **Front** `cm/` (Vite + React), servi par le service compose `cm` (nginx) sur `127.0.0.1:${CM_PORT:-3003}`.
  Son nginx relaie `/api/cm/`, `/api/tiktok/`, `/api/youtube/` et les routes de connexion
  (`/api/auth/(login|register|google|logout|me|…|2fa/login/totp|2fa/login/recovery)`) vers `api` : même origine, pas de CORS.
  Clé partagée `CM_PROXY_KEY` : vraie IP du visiteur (`X-Cm-Client-IP`) pour les limiteurs.
- **API** `api/src/routers/cm.py`, `services/cm_service.py`, `services/cm_jobs.py`, `services/instagram_service.py`,
  `models/cm.py` (migration `f1a2b3c4d5e6`). Mêmes règles de tenant que TikTok / YouTube : `org_id` absent = espace perso.
- **Publication** : `CmPost` (la vidéo, gardée dans le volume privé `cm_media` jusqu'à la fin) + une `CmTarget` par compte
  (heure, options, statut). À l'heure dite, la tâche de fond (1 tick / min, un seul worker via Redis, prise en charge atomique) :
  - TikTok : relit les options du créateur (confidentialité proposée, durée max), copie la vidéo et crée une `tiktok_posts`
    que le module TikTok envoie (Direct Post ou brouillon) ;
  - YouTube : crée une `youtube_posts` que le module YouTube envoie (quota `YOUTUBE_DAILY_POSTS` respecté) ;
  - Instagram, connexion officielle : conteneur `REELS` avec un **lien signé valable 2 h** vers la vidéo
    (`/api/cm/media/{cible}/{exp}/{signature}.mp4`), suivi, puis `media_publish` ;
  - Instagram, compte géré par la routine : la cible passe « à publier par la routine ».
  Limite de 3 envois simultanés par tenant : au-delà, la cible attend le tick suivant. Échec : vidéo gardée 48 h pour « Réessayer ».
- **Statistiques** (toutes les `CM_STATS_EVERY_HOURS`) : YouTube (`youtube.readonly` : vues, abonnés, 50 dernières vidéos,
  ≈ 3 unités de quota), Instagram officiel (profil, médias récents, insights `views,shares,saved,reach`), TikTok seulement si
  `TIKTOK_EXTRA_SCOPES` contient `user.info.stats` / `video.list` (à poser **après** validation TikTok, puis reconnecter les
  comptes). Relevé quotidien par compte (`cm_account_stats`) + vidéos (`cm_videos`). Compte déconnecté : ses chiffres sont supprimés.

## Routine Claude (jeton `CM_SERVICE_TOKEN`, au nom de `CM_SERVICE_USER_EMAIL`)

Toutes les routes `/api/cm/*` de lecture et de publication acceptent `Authorization: Bearer <CM_SERVICE_TOKEN>`.
Instagram géré par la routine :

1. `GET /api/cm/routine/due?ahead_minutes=0` : Reels à publier (légende, heure, `video_url`).
2. `POST /api/cm/routine/targets/{id}/claim`, puis `GET /api/cm/routine/targets/{id}/video` (le fichier).
3. `POST /api/cm/routine/targets/{id}/done` `{url, external_id?, published_at?}` ou `/failed` `{message}`.
   Prise en charge non confirmée sous 6 h : remise en file (3 essais).
4. `POST /api/cm/routine/stats` `{username, followers, media_count, views?, likes?, videos: [{external_id, url, caption,
   published_at, views, likes, comments, shares, saves, thumbnail_url}]}` : crée le compte « routine » s'il n'existe pas.

Un compte « routine » connecté ensuite officiellement garde sa ligne (historique) et passe en mode `api`.

## Configuration

| Variable | Rôle |
|---|---|
| `CM_URL` | `https://cm.chapote.fr` (retours OAuth `…/tiktok/callback`, `…/youtube/callback`, `…/instagram/callback`, lien signé Instagram) |
| `CM_PORT`, `CM_PROXY_KEY` | port du conteneur, clé partagée nginx ↔ API |
| `CM_SERVICE_TOKEN`, `CM_SERVICE_USER_EMAIL` | routine Claude |
| `CM_MEDIA_MAX_GB`, `CM_MAX_UPLOAD_MB`, `CM_STATS_EVERY_HOURS` | plafonds et fréquence des relevés |
| `TIKTOK_EXTRA_SCOPES` | vide tant que TikTok n'a pas validé les statistiques |
| `TIKTOK_CM_REDIRECT_URI`, `YOUTUBE_CM_REDIRECT_URI` | vides par défaut (voir ci-dessous) |
| `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, `INSTAGRAM_REDIRECT_URI` | app Meta (vides = comptes « routine » seulement) |

**Retours OAuth TikTok et YouTube.** Par défaut, une connexion lancée depuis cm revient par l'URI déjà déclarée
(`https://chapote.fr/tiktok/callback`, `https://chapote.fr/youtube/callback`). Le `state` signé porte `app: "cm"` ;
la page de chapote.fr (`app/src/utils/cmBounce.ts`) renvoie alors code et state vers la même page de
cm.chapote.fr, qui fait l'échange. La destination est fixe (sous-domaine `cm.`), jamais lue dans le state.
Rien à modifier chez TikTok (une app publiée repasserait en validation). Si l'URI de cm est un jour déclarée
chez la plateforme, poser `TIKTOK_CM_REDIRECT_URI` / `YOUTUBE_CM_REDIRECT_URI` pour un retour direct.

Instagram : URI de retour `https://cm.chapote.fr/instagram/callback` (Meta) ; rappels
désautorisation `https://cm.chapote.fr/api/cm/instagram/deauthorize` et suppression des données
`https://cm.chapote.fr/api/cm/instagram/data-deletion`. Pages légales : `/legal/instagram-cgu`,
`/legal/instagram-confidentialite`. Connexion Google : origine JavaScript `https://cm.chapote.fr`.

## Bibliothèque Google Drive (robot)

Les vidéos restent dans le Drive des utilisateurs ; cm les lit grâce à un **compte de service Google**
(« robot », `GDRIVE_SA_KEY_B64` = base64 de sa clé JSON). Le robot n'a accès qu'aux dossiers qu'on lui partage.

- **Relier un dossier** (cm → Bibliothèque → « Ajouter un dossier Drive ») : partager le dossier avec l'adresse
  du robot (Lecteur, ou Éditeur pour ranger les vidéos publiées), puis coller son lien. Un dossier n'est relié
  qu'à un seul espace ; `verified` si celui qui a partagé (ou le propriétaire) est l'utilisateur ou un membre de
  son équipe. Groupe de comptes par défaut par dossier (pré-coché dans « Programmer »).
- **Détection automatique** (chaque minute) : le robot liste les dossiers qu'on lui a partagés
  (`sharedWithMe`) et relie tout seul chaque nouveau dossier à l'espace de la personne qui l'a partagé :
  adresse du compte Chapote, ou **adresse Google associée** (cm → Bibliothèque → « Associer un compte Google »,
  prouvée par une connexion Google : ID token vérifié, une adresse = un seul compte Chapote), avec l'espace
  choisi pour cette adresse (équipe quittée = espace perso). Un dossier déjà relié une fois (même retiré) n'est
  jamais relié de nouveau automatiquement. Partage depuis une autre adresse : coller le lien.
- **Relecture** toutes les `GDRIVE_SCAN_MINUTES` (et « Relire maintenant ») : vidéos du dossier et de ses
  sous-dossiers (3 niveaux). Un fichier `.txt` du même nom que la vidéo devient sa légende, tant qu'elle n'a pas
  été modifiée dans cm. Vidéo supprimée du Drive : retirée de la bibliothèque.
- **Publication** : `POST /api/cm/posts` avec `asset_id` (pas d'envoi). À l'heure de la 1re publication, la vidéo
  est téléchargée une fois pour tous les comptes, puis la copie locale est effacée quand tout est terminé.
  Option « Ranger dans Publié » (robot Éditeur) : vidéo déplacée dans un sous-dossier `Publié` du Drive.
- Un compte de service n'a pas d'espace de stockage : il peut lire et déplacer, mais pas créer de fichier dans
  « Mon Drive » (seulement dans un Drive partagé Workspace).
- Routes : `routers/cm_library.py` ; services `gdrive_service.py`, `cm_library.py` ; tests `test_cm_library.py`.

## Équipe, rôles et comptes uniques

- **Rôles cm** dans une équipe (`cm_member_roles`, par e-mail, vaut pour les invitations) : `admin` (comptes,
  dossiers, groupes, membres ; un admin de l'équipe chapote.fr l'est toujours), `editor` (programme, modifie,
  annule, édite la bibliothèque ; défaut d'un membre), `viewer` (consulte). Un editor / viewer peut être limité à
  des groupes de comptes : il ne voit que leurs comptes, leurs publications et les dossiers Drive de ces groupes.
  Contrôle central : `services/cm_access.py` (`enrich` sur chaque espace, `require`, `account_allowed`).
  Modules TikTok / YouTube de l'Espace client : rôles appliqués seulement aux membres ayant un rôle cm explicite.
- **Page Équipe** (`/equipe`, `routers/cm_team.py`) : créer une équipe, inviter (rôle + groupes), changer les
  rôles, retirer.
- **Un compte = un seul espace** : connecter un compte TikTok / YouTube / Instagram déjà relié ailleurs est
  refusé (409 `account_taken`, « rapprochez-vous de la personne en charge »).
- **Transfert** (Comptes → Transférer, admin) : vers un autre de ses espaces (immédiat) ou une autre personne
  (`cm_transfers`, à accepter sous 14 jours). Le compte part avec son planning à venir (publication commune à
  plusieurs comptes coupée en deux, fichier lié), ses chiffres et ses vidéos ; l'historique reste.
- **Reprise par preuve** (personne partie, compte resté dans son espace) : en reconnectant le compte, la personne
  qui vient de s'authentifier chez la plateforme reçoit un jeton signé (15 min, usage unique, nouveaux jetons
  chiffrés dedans) et peut reprendre le compte. Sans les identifiants du compte, impossible.

### Partage simple (par compte, par groupe ou tout l'espace)

- **Comptes → Partager** (sur un compte ou un groupe) ou **Personnes → Partager l'espace** : une adresse
  e-mail et un accès : *Admin* (tout l'espace), *Peut publier* (editor), *Lecture seule* (viewer).
  Compte Chapote existant : accès immédiat ; sinon invitation.
- Partager depuis l'espace perso le rend partageable une fois pour toutes : une équipe chapote.fr
  « Espace de … » est créée, l'utilisateur en est propriétaire et admin, et comptes, publications,
  groupes, dossiers Drive et adresses Google y passent tels quels (`ensure_shareable`).
- Portée : `cm_member_roles.group_ids` + `account_keys` (`"tiktok:12"`) ; les deux NULL = tous les
  comptes. Partages successifs = union. `POST /api/cm/shares`, `GET/PATCH /api/cm/people`,
  `POST /api/cm/people/remove`, `GET /api/cm/shares/{platform}/{id}` (qui a accès à ce compte).
- `/api/cm/spaces` renvoie `accounts`, `owner`, `owner_name` : l'interface n'affiche que les espaces
  qui ont des comptes (un seul la plupart du temps) et ouvre d'elle-même l'espace partagé quand le
  perso est vide.
- Filtre d'affichage : `?account=tiktok:12` sur toutes les routes `/api/cm` (un seul compte), en plus
  de `?group_id=`. Interface : barre de filtres (Tous · groupes · comptes, un geste) en haut des seules
  pages de suivi (Accueil, Planning, Stats, Vidéos) ; défile au pouce sur mobile, va à la ligne sur
  ordinateur ; absente des pages de gestion (Comptes, Bibliothèque, Personnes), qui portent sur tout
  l'espace. Le composeur reprend le filtre choisi. Choix de l'espace (rare) : menu du compte.

## Routines (claude-cloud) : voir docs/CM_ROUTINES.md

Couverture personnalisée : `PUT /posts/{id}/cover` (JPEG/PNG ≤ 8 Mo) ou image à côté de la vidéo dans le Drive ;
envoyée à Instagram en `cover_url` (lien signé `/api/cm/cover/…`), téléchargeable par la routine. Après une erreur
Instagram, cm cherche le Reel parmi les dernières publications (même légende) avant de conclure à l'échec.

## Commentaires et messages (page Commentaires)

- `cm_comments` : commentaires de toutes les vidéos (filtrés par la barre de comptes), statut new / replied / hidden /
  ignored / contacted ; recherche, tri, pages keyset. Onglets : À traiter, Mot-clé (ex. SHEET : une ligne par personne,
  réponse privée si possible, sinon message prêt à copier + lien profil / ig.me), Messages (Instagram, fenêtre 24 h).
- Sources : Instagram officiel (`instagram_business_manage_comments` / `_messages`, demandées seulement si
  `INSTAGRAM_EXTRA_SCOPES` les liste, après la revue Meta) ; Instagram « routine » : la routine remonte les commentaires
  (`POST /routine/comments`) et exécute les réponses demandées dans cm (`GET /routine/actions`, `POST …/done`) ;
  YouTube : lecture si `YOUTUBE_COMMENTS_ENABLED` (après la vérification Google), réponse/masquage avec
  `youtube.force-ssl` (`YOUTUBE_EXTRA_SCOPES`) ; TikTok : pas d'API de commentaires.
- Sans permission : message « permission en attente » (403 `permission_pending`), jamais d'échec silencieux.
- Qui a aimé un commentaire : aucune API ne le donne. Relecture auto toutes les 15 min ; commentaires supprimés à la
  déconnexion et après 12 mois ; messages privés jamais stockés.

## Brouillons automatiques (bibliothèque)

- Par dossier : **Bibliothèque → ☰ → Brouillons automatiques**. Analyse du rangement : Gemini 2.5 Flash
  (`GEMINI_API_KEY`) reçoit seulement les chemins et noms de fichiers (jamais les vidéos) + la liste des comptes et
  groupes, et choisit dans des listes fermées (`services/cm_recipe.py`, jamais de regex venue de l'IA) ; sans clé ou
  en erreur : règles déterministes. L'admin vérifie sur 4 vidéos réelles, corrige, active.
- Recette (`cm_sources.recipe`) : comptes (groupe par défaut du dossier, ou sous-dossier de niveau N → compte/groupe),
  date/heure lues dans les noms (formats `2026-11-24 18h30`, `2026-11-24`, `24-11-2026 18h30`, `24-11-2026`,
  `20261124_1830`, fuseau Europe/Paris, heure par défaut), titre (fichier, dossier ou 1re ligne du .txt), légende
  (.txt à côté), couverture (image à côté : même nom, `couverture.jpg`, ou seule image du dossier → `cm_assets.cover_file_id`).
- À chaque relecture du dossier, chaque nouvelle vidéo (pas encore programmée, jamais proposée) devient un
  `cm_proposals` « open » (une fois par vidéo ; « Aussi pour les vidéos déjà là » = arriéré). Date passée → heure à choisir.
- Page **À valider** (pastille dans le menu) : « Vérifier et programmer » ouvre le composeur pré-rempli
  (`/nouvelle?brouillon=<id>`) — mêmes règles qu'à la main, dont les choix TikTok ; programmer la vidéo marque le
  brouillon « used ». « Écarter » : plus jamais proposé. Rien ne part sans validation.

## Listes à grande échelle (recherche, tri, pages)

- Recherche et tri **toujours côté API** (jamais en mémoire dans le navigateur) : `q`, `sort`, `order=asc|desc`,
  `limit`, `cursor` sur `/videos`, `/assets`, `/posts` (+ `status`), `/accounts`, `/stats` (tableau par compte),
  `/people`. État dans l'URL de la page (`?q=&tri=&ordre=`).
- Pages « keyset » (`services/cm_paging.py`) : le curseur contient la dernière valeur triée + l'id ; pas d'OFFSET.
  NULL toujours en fin (COALESCE à constantes écrites en dur, mêmes expressions que les index de la migration
  `b5e1a7c9d0f2`). Ancien curseur `o:<offset>` encore lu.
- Index : pg_trgm (ILIKE « contient ») sur titres / noms / légendes / dossiers ; index d'expression par tri.
  Mesuré : 200 000 vidéos, chaque tri ~10 ms.
- Relevés des comptes en 3 requêtes (`_latest_stats_bulk`, DISTINCT ON) au lieu d'une par compte ;
  `/stats` additionné en SQL (GROUP BY).
- Interface : barre de filtres = Tous + épinglés + 3 derniers choix + « Choisir… » (sélecteur : recherche,
  onglets Groupes / Comptes, filtre par plateforme, étoiles ; popover sur ordinateur, feuille sur mobile,
  clavier). Le composeur utilise le même sélecteur en cases à cocher.

## Dev

`cd cm && npm install && npm run dev` (port 3003, proxy `/api` vers `localhost:8001`). Tests : `api/tests/test_cm.py`.
