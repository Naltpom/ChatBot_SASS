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

## Dev

`cd cm && npm install && npm run dev` (port 3003, proxy `/api` vers `localhost:8001`). Tests : `api/tests/test_cm.py`.
