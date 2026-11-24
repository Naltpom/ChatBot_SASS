# Publier depuis une routine (claude-cloud) par cm.chapote.fr

Une seule API pour Instagram, TikTok et YouTube : `https://cm.chapote.fr/api/cm`, en-tête
`Authorization: Bearer <CM_SERVICE_TOKEN>` (agit au nom de `CM_SERVICE_USER_EMAIL`). Le jeton ne s'écrit
jamais dans un fichier commité, un log ou un message.

## 1. Comptes : des noms lisibles, pas des numéros
`GET /accounts?org_id=<espace>` → `[{platform, id, slug, name, can_publish, mode, …}]`. `slug` est le nom lisible
et stable du compte : `instagram:@ghosthands.music`, `tiktok:@ghosthands.music`, `youtube:@ghosthandsmusic`
(pseudo de la plateforme ; TikTok : lu auprès de TikTok au premier affichage). C'est lui qu'on écrit dans
`compte.json` (`diffusion.comptes_cm`), jamais l'`id`. Espaces : `GET /spaces`.

## 2. Programmer une vidéo (au dépôt, pas à l'heure)
1. `POST /posts` `{org_id, title, caption, file_name, video_size, ref, targets: [...]}` → `{post_id, part_count, part_size}`
   - `ref` (recommandé) : « compte/id » de la vidéo (le même que `infos.json` → `compte` + `id`). Relie la publication à
     sa vidéo du Drive (bibliothèque : « Programmée », fiche vidéo : lien Drive) et **refuse un doublon** : tant qu'une
     publication non annulée porte cette référence, `409 {"code": "duplicate_ref", "post_id": …}` (réutiliser ce post).
   - `archive` (contes seulement) : `{dossier: "KHM-040 — Le Voleur", partie: "2"|"longue", id: "khm-040", titre: "Le Voleur"}`
     → rangé dans `contes/<dossier>/` (voir section 8). Pour les autres comptes, rien à donner.
   - `rights` : droits d'auteur de l'œuvre jouée, `"public_domain"` | `"protected"` | `"unknown"` (absent = non précisés),
     et `rights_note` (texte libre, 300 car., ex. « reprise — Wicked, Stephen Schwartz »). Modifiables ensuite par
     `PATCH /posts/{id} {rights, rights_note}`, quel que soit le statut. Une chaîne YouTube réglée « domaine public
     seulement » (page Comptes, ou `PATCH /accounts/youtube/{id} {public_domain_only}`) refuse toute cible sur un post
     qui n'est pas `public_domain` (non précisé compris) : `422 {"code": "rights_protected", "message": …}` — à la
     création, à l'ajout d'une cible (`POST /posts/{id}/targets`) et au passage d'un post visant cette chaîne en
     `protected`/`unknown` (`PATCH`). Un post `protected`/`unknown` porte `rights_warning` (bandeau dans cm) ; sa
     publication déclenche une notification « ⚠️ Œuvre protégée publiée » (app mobile). `infos.json` reprend `droits`
     et `droits_note`.
   - cible : `{platform, account: "tiktok:@pseudo", scheduled_at: "2026-12-24T17:30:00Z", options}` (UTC ; `null` =
     tout de suite). `account_id` reste accepté.
   - options TikTok : `{mode: "direct"|"draft", privacy_level: "PUBLIC_TO_EVERYONE"|…, allow_comment, allow_duet,
     allow_stitch, brand_organic, brand_content, caption? (= title), hashtags?: [], fallback_draft?}` — `fallback_draft: true` = le repli de
     `tiktok.py` : si TikTok refuse la visibilité (application pas encore auditée), la vidéo repart en brouillon
     dans l'app TikTok (`notice` de la cible l'indique) au lieu d'échouer.
   - options YouTube : `{title?, description?, tags: [], privacy_status: "public"|"unlisted"|"private",
     made_for_kids: false, synthetic_media: false, category_id: "10", notify_subscribers: true, default_language?: "fr"}`
   - options Instagram : `{caption?, hashtags?: [], collaborators?: ["pseudo"], share_to_feed: true}`
   - Champs propres à chaque plateforme, limites et replis (champ absent = repli) :

     | Plateforme | Champ | Limite | Si absent |
     |---|---|---|---|
     | TikTok | `caption` (ou `title`) | 2 200 caractères (UTF-16), hashtags compris | `caption` commune du post, sinon `title` du post |
     | TikTok | `hashtags` | ajoutés à la fin s'ils manquent | aucun |
     | YouTube | `title` | 100 caractères, sans `<` `>` | `title` du post |
     | YouTube | `description` | 5 000 octets, sans `<` `>` | `caption` commune |
     | YouTube | `tags` | 500 caractères au total, sans `,` | aucun |
     | YouTube | `category_id` | nombre (`"10"` = Musique) | `"22"` |
     | YouTube | `default_language` | code langue (`fr`, `en`, `pt-BR`) | non précisée |
     | YouTube | `made_for_kids` | obligatoire (règle YouTube) | — refusé (400) |
     | YouTube | `synthetic_media`, `notify_subscribers` | booléens | `false`, `true` |
     | Instagram | `caption` | 2 200 caractères, 30 hashtags au plus | `caption` commune |
     | Instagram | `hashtags` | ajoutés à la fin s'ils manquent (compte dans les 30) | aucun |
     | Instagram | `collaborators` | 3 pseudos au plus (invitation de collaboration) | aucun |
     | Instagram | `share_to_feed` | booléen | `true` |
2. `PUT /posts/{id}/parts/{n}` (octets bruts, morceaux de `part_size`, dans l'ordre ; renvoyer un morceau déjà reçu est sans effet)
3. `PUT /posts/{id}/cover` (facultatif ; JPEG/PNG ≤ 8 Mo) → couverture Instagram (`cover_url`)
4. `POST /posts/{id}/submit` → vérifie la vidéo pour chaque compte, puis programme.

## 3. Suivre
`GET /posts/{id}` → `targets[]` : `status` (`SCHEDULED`, `DISPATCHING`, `PUBLISHING`, `AWAITING_ROUTINE`,
`PUBLISHED`, `INBOX`, `FAILED`, `CANCELLED`), `url`, `external_id`, `error_message`. Après une erreur Instagram,
cm vérifie lui-même si le Reel est en ligne quand même (même légende) avant de conclure à l'échec.
Annuler : `POST /targets/{id}/cancel` (cible pas encore partie, en échec `FAILED` ou brouillon TikTok `INBOX` ; sinon 409 ;
la cible passe `CANCELLED`, sort du planning, et la même plateforme peut être rajoutée par `POST /posts/{id}/targets`) ; relancer un échec : `POST /targets/{id}/retry` (la vidéo est relue depuis
l'archive Drive si elle n'est plus sur le serveur).

### Brouillon TikTok (`INBOX`)
Tant que l'application TikTok n'est pas validée, une vidéo peut arriver en **brouillon** dans l'app TikTok (`mode: "draft"`,
ou repli `fallback_draft`) : la cible passe `INBOX` et **y reste**, TikTok ne signale pas la publication faite depuis l'app.
Le brouillon arrive **sans légende** : `targets[].options.title` contient la légende complète (texte + hashtags) à coller.
- `POST /targets/{id}/published {url?, published_at?}` : publiée à la main dans l'app → `PUBLISHED` (`url` facultatif,
  `https://www.tiktok.com/@compte/video/<id>`, ou lien court de partage `https://vm.tiktok.com/…`, résolu par cm : `external_id`
  en est tiré ; `published_at` = maintenant par défaut).
  Cible `INBOX` seulement (sinon 409) ; lien qui n'est pas un lien TikTok → 400.
- `POST /targets/{id}/resend-draft` : brouillon supprimé dans l'app → renvoyé tout de suite, même vidéo, même légende
  (relue depuis l'archive Drive si elle n'est plus sur le serveur). Cible `INBOX` seulement (sinon 409).
- Dans cm (Planning → la vidéo → carte TikTok) : légende avec « Copier la légende », « Publié dans l'app » (lien facultatif),
  « Renvoyer le brouillon », « Retirer ».
- `POST /targets/{id}/cancel` sur une cible `INBOX` : elle passe `CANCELLED` et sort du planning. Le brouillon déjà dans
  l'app TikTok **n'est pas supprimé** (l'API ne le permet pas) : le supprimer à la main.

### Retrouver ses publications : `GET /posts?ref_prefix=<compte>/`
- Avec le jeton de service et sans `org_id` : recherche dans tous les espaces du jeton (perso + équipes) ;
  avec `org_id` : cet espace seulement.
- `ref_prefix=kiwi/` : toutes les publications du compte kiwi ; `ref=kiwi/k12` : une seule. Sans `start`/`end`, **pas de
  fenêtre de dates** (avec : filtre sur l'heure des cibles).
- `status=upcoming|published|failed` (cibles pas encore parties / publiées / en échec), `q`, `order=asc|desc`,
  `limit` (≤ 500) et pages par curseur (en-tête `X-Next-Cursor`, paramètre `cursor`), comme le planning.
- Chaque post : `ref`, `org_id`, `rights`, `rights_note`, `rights_warning`, `status`, `archive {state: pending|ok|error, folder_url, error}`, `targets[]` avec `status`, `url`
  (lien de la publication), `external_id`, `published_at`, `error_message`.

### Poser une référence sur un post déjà créé : `PATCH /posts/{id}`
`{ref: "<compte>/<id>", archive?: {dossier, partie, id, titre}}` : pour un post créé sans `ref` (ou pour poser le bloc
`archive` d'un conte), **quel que soit son statut**, même déjà publié.
- `ref` déjà portée par une autre publication active → `409 {"code": "duplicate_ref", "post_id": …}` ; format sans `/` → 400.
- Le post est ensuite rangé dans le Drive comme les autres (section 8), `infos.json` compris (statut et liens actuels).
- Si sa vidéo n'est plus sur le serveur, l'archivage s'arrête en erreur (`archive.error` le dit) : renvoyer la vidéo.

### Renvoyer la vidéo d'un post : `PUT /posts/{id}/video`
Pour un post prêt dont la vidéo n'est plus sur le serveur (l'archiver, relancer un brouillon TikTok…). Même découpage
que la création :
1. `PUT /posts/{id}/video {video_size}` → `{part_size, part_count}` (409 si la vidéo est encore sur le serveur) ;
2. `PUT /posts/{id}/video/parts/{n}` (octets bruts, dans l'ordre ; renvoyer un morceau déjà reçu est sans effet) ;
3. `POST /posts/{id}/video/complete` → vidéo vérifiée et remise au post ; avec une `ref`, archivée au passage suivant
   (moins d'une minute), et gardée sur le serveur 7 jours au plus en attendant. Ensuite `POST /targets/{id}/resend-draft`
   ou `/retry` peuvent s'en servir.

### Fichiers d'un post
`GET /posts/{id}/video` et `GET /posts/{id}/cover` : la vidéo et la couverture envoyées. Elles restent sur le serveur
**au moins jusqu'à ce que toutes les cibles soient terminées** (et, en cas d'échec, 48 h de plus) et tant que la vidéo
n'est pas archivée dans le Drive (7 jours au plus). Ensuite, la vidéo est relue depuis l'archive Drive quand on la
demande ou qu'on relance une cible.

### Compléter un post déjà soumis : `POST /posts/{id}/targets`
Ajoute des plateformes à une publication existante, sans la recréer (une 2ᵉ `POST /posts` avec la même `ref` serait
refusée en 409 `duplicate_ref`). Exemple : le Reel est programmé, le jeton TikTok ou YouTube arrive ensuite.
```json
POST /api/cm/posts/412/targets
{"targets": [
  {"platform": "tiktok",  "account": "tiktok:@ghosthands.music",  "scheduled_at": "2026-11-24T19:10:00+01:00",
   "options": {"mode": "direct", "privacy_level": "PUBLIC_TO_EVERYONE", "hashtags": ["piano"]}},
  {"platform": "youtube", "account": "youtube:@ghosthandsmusic", "scheduled_at": "2026-11-24T19:10:00+01:00",
   "options": {"title": "Clair de lune — Beginner to Expert", "privacy_status": "public", "made_for_kids": false}}
]}
→ {"added": [{"id": 981, "platform": "tiktok", "status": "SCHEDULED", …}, …],
   "skipped": [{"platform": "instagram", "target_id": 977, "status": "SCHEDULED"}],
   "post": {…, "targets": [toutes les cibles]}}
```
- Mêmes règles que les cibles de `POST /posts` : compte par `account` (slug) ou `account_id`, options et limites du
  tableau de la section 2, textes par défaut tirés du titre et de la légende commune du post, vidéo vérifiée pour le
  compte, heure vide = tout de suite. Une seule cible invalide → erreur (400 / 404 / 409) et rien n'est ajouté.
- Une plateforme déjà présente sur le post (cible non annulée) est **ignorée** et listée dans `skipped`, sans erreur :
  l'appel peut être rejoué. Une plateforme annulée peut être rajoutée.
- Post encore en envoi (avant `submit`) : les cibles ajoutées attendent le `submit` (`DRAFT`), comme les autres.
- Post annulé, ou vidéo plus disponible : 409, recréer la publication.

### Modifier une cible pas encore partie : `PATCH /targets/{id}`
`{scheduled_at?, options?}` sur une cible `DRAFT` ou `SCHEDULED` (sinon 409 : déjà partie, ou prise par la routine).
L'id de la cible se lit dans `GET /posts/{id}` → `targets[].id`.
- `scheduled_at` : nouvelle heure.
- `options` : **partielles**, fusionnées avec celles de la cible, puis revérifiées (mêmes limites que la section 2) ;
  une clé à `null` revient au texte commun du post ; les `hashtags` ne sont ajoutés que s'ils manquent (renvoyer la
  même liste ne les double pas).

  | plateforme | clés de texte | autres |
  |---|---|---|
  | Instagram | `caption`, `hashtags`, `collaborators` | `share_to_feed` |
  | TikTok | `title` (ou `caption`), `hashtags` | `privacy_level`, `allow_comment`, `allow_duet`, `allow_stitch`… |
  | YouTube | `title`, `description`, `tags` | `category_id`, `privacy_status`, `made_for_kids`… |

  Exemple : `PATCH /api/cm/targets/981 {"options": {"title": "Clair de lune #piano", "hashtags": ["debussy"]}}`.

## 4. Instagram sans connexion officielle (mode « routine »)
Tant que le compte Instagram n'est pas connecté officiellement dans cm, sa cible passe en `AWAITING_ROUTINE` à
l'heure : la routine la publie elle-même (`GET /routine/due`, `GET /routine/targets/{id}/video` et `/cover`,
`POST /routine/targets/{id}/claim`, puis `/done {url, external_id, published_at}` ou `/failed {message}`).

## 5. Commentaires (comptes Instagram)
- Remonter : `POST /routine/comments` `{org_id, username, items: [{id, media_id, parent_id?, username, user_id?, text,
  like_count, timestamp, video_title?, video_url?}]}` (n'importe quel compte Instagram de l'espace ; sans doublon).
- Actions demandées dans cm (répondre, masquer, réponse privée) : `GET /routine/actions?org_id=` →
  `[{id, account: "instagram:@…", username, comment_id, media_id, author, type: reply|hide|private_reply, text}]`,
  puis `POST /routine/actions/{id}/done?org_id=` `{ok: true}` ou `{ok: false, error}`.
- Tant que la permission « commentaires » n'est pas accordée à cm par Meta, les actions sur les commentaires
  remontés par la routine lui reviennent, même pour un compte connecté officiellement (mode api).

## 6. Vidéos rangées dans le Drive (`infos.json`)
Un dossier de vidéo peut contenir `infos.json` (`compte`, `id`, `titre`, `heure`, `statut`, `reserve`, `publie_le`,
`plateformes: {instagram|tiktok|youtube: {lien|permalink|url|media_id|video_id, …}}`). À chaque relecture du dossier :
À chaque relecture du dossier (toutes les 5 min, ou « Relire maintenant »), chaque vidéo est classée :

| `statut` (de la vidéo ou de sa partie) | dans cm | « à valider » ? |
|---|---|---|
| `publiee`, ou un lien / id de publication présent | **Publiée** (archive, avec ses liens) | jamais |
| `prete` (ou `programmee`), avec ou sans `heure` | **Programmée par l'outil** : rien n'est créé, la publication arrive par l'API (`ref` = `compte/id`, pour une partie l'`id` de la partie, ex. `contes/khm-040-p2`) et est rattachée à la vidéo ; une 2ᵉ publication avec la même `ref` → 409 `duplicate_ref` | jamais |
| `null`, absent ou inconnu, avec `compte` + `id` | **En attente** de planification par l'outil (bibliothèque, ex. partie pas encore planifiée, version longue jamais publiée) | jamais |
| dossier `réserves/` ou `reserve: true` | **Réserve** (bibliothèque, « À publier ») | jamais |
| pas d'`infos.json` | vidéo ordinaire | oui, si les brouillons automatiques sont activés |

Ordre quand plusieurs règles jouent : Publiée > Programmée > Réserve > En attente.

Un conte (plusieurs vidéos dans un dossier `contes/<KHM-NNN — Titre>/`) : `infos.json` décrit chaque vidéo dans
`parties: {"1": {statut, heure, publie_le, plateformes, id}, "2": {…}, "longue": {…}}`. La vidéo est reliée à sa partie
par son nom de fichier (« partie N » → `"N"`, « version longue » → `"longue"`) ; les champs de la partie remplacent ceux
du conte. Quand l'outil met à jour `infos.json`, cm relit le fichier et reclasse la vidéo.

Brouillons « à valider » déjà créés pour une vidéo qui passe Publiée, Programmée, Réserve ou En attente : rangés en
archive automatiquement à la relecture, rien n'est publié. Sinon `POST /proposals/archive {source_id?}` (avec
`?group_id=` / `?account=` pour la sélection) range tout en archive, sans rien publier.

## 9. Stockage Drive (obligatoire pour publier)
Chaque espace (perso ou équipe) range ses vidéos dans **son** Google Drive, par la même connexion que l'archivage
(« Connecter Google Drive », droit `drive.file` : Chapote ne voit et ne supprime que ce qu'il a créé).
- Sans Drive relié : `POST /posts` → `409 {"code": "storage_required", "message"}`.
- Vidéo qui ne tient pas (quota réservé ou espace libre du Drive) : `POST /posts` et `PUT /posts/{id}/video` →
  `409 {"code": "storage_full", "message", "needed_bytes", "free_bytes"}`.
- `GET /spaces` → chaque espace porte `storage: {connected, email, quota_gb, used_bytes, drive_free_bytes, retention,
  delete_after_days, state}` (valeurs connues, sans appel à Google) ; `state` : `ok` | `almost_full` (≥ 90 %) | `full`
  | `missing` (pas de Drive).
- `GET /drive/storage?org_id=` → même objet, relu chez Google (≤ 10 min), plus `max_quota_gb`.
- `PUT /drive/storage?org_id= {quota_gb, retention, delete_after_days}` (administrateur) : `quota_gb` = Go réservés à
  Chapote (null = tout l'espace libre ; au plus `max_quota_gb`, sinon 400) ; `retention` : `keep` |
  `delete_after_publish` | `delete_after_days` (avec `delete_after_days` 1 à 365).
- Conservation : quand toutes les cibles d'une publication sont terminées (au moins une publiée), selon `retention`,
  la vidéo, la couverture et la légende **créées par Chapote** vont à la corbeille du Drive (tout de suite, ou N jours
  après la dernière publication) ; `infos.json` reste et continue d'être mis à jour (`archive.purged_at`).
- `used_bytes` : octets des fichiers rangés par Chapote et pas encore supprimés.
- Notification de l'app mobile : type `storage` (préférence `storage`), `data: {type: "storage", state, org_id}`,
  une fois à chaque passage de 90 % (`almost_full`) puis de 100 % (`full`).
- Sur le site : carte « Stockage » (Bibliothèque), bandeau presque plein / plein, écran « Connecter votre Google
  Drive » à la 1re ouverture d'un espace sans Drive. Réglage serveur : `CM_STORAGE_REQUIRED` (true par défaut).

## 7. Mode validation
Si une vidéo ne doit plus partir (validation, retour en réserve), annuler ses cibles : `POST /targets/{id}/cancel`.
cm publie tout ce qui est programmé.

## 8. Archivage dans le Drive par cm
Chaque publication créée par l'API avec une `ref` est rangée par cm dans le Drive de l'espace, avec l'arborescence
qu'utilisait le PC :

```
<compte>/<AAAA-MM>/<AAAA-MM-JJ HHhMM — Titre>/   Titre.mp4, Titre.txt (légende), couverture.jpg, infos.json
contes/<KHM-NNN — Titre>/                        Titre — partie N.mp4 (et .txt, couverture — partie N.jpg), infos.json
```
(heure de Paris de la 1ʳᵉ cible ; caractères `/ \ : * ? " < > |` retirés des noms.)

`infos.json` (réécrit à chaque changement de statut d'une cible, liens compris, en moins d'une minute) :
```json
{"compte": "kiwi", "id": "k12", "titre": "…", "heure": "2026-12-02T18:30:00+01:00", "statut": "prete",
 "publie_le": null, "plateformes": {"instagram": {"statut": "publiee", "url": "https://www.instagram.com/reel/…", "publie_le": "…"},
                                   "tiktok": {"statut": "prete", "url": null, "publie_le": null}}}
```
`statut` : `prete` (au moins une cible à venir), `en_cours` (par plateforme), `publiee` (toutes publiées), `ratee`
(échec, plus rien à venir), `annulee`. Contes : un seul `infos.json` par conte, `{"compte": "contes", "id": "khm-040",
"titre": …, "parties": {"2": {statut, heure, publie_le, plateformes, id: "khm-040-p2", titre}}}`.

Où cm écrit :
1. dans le dossier du compte déjà relié à la bibliothèque (son nom = `<compte>`, partagé par l'espace lui-même), **si Google laisse le robot y déposer
   des fichiers** : cm l'essaie une fois par dossier Éditeur (carte du dossier : « archivage direct » ou « dépôt de
   fichiers refusé par Google ») ; un compte de service n'a pas d'espace de stockage hors Drive partagé ;
2. sinon dans le Drive connecté dans la Bibliothèque (« Connecter Google Drive », droit `drive.file` : cm ne voit que les
   fichiers qu'il crée), sous « cm.chapote.fr (archives) » / `<compte>` / … Ce dossier est partagé en lecture avec le
   robot et relié à la bibliothèque.

Quand : **dès la création** du post (la vidéo est envoyée tout de suite, sans attendre la publication), puis
`infos.json` à chaque changement de statut. Un post en erreur est repris tout seul **30 min** après son dernier essai
(`archive.last_try`) ; toute erreur est écrite dans `archive.error`. Relancer tout de suite :
- `POST /posts/{id}/archive/retry` : une publication (avec une `ref`) ;
- `POST /archive/retry {org_id?}` → `{relaunched: n}` : toutes celles en erreur de l'espace (reprises par lots de 5
  par minute ; un envoi qui dépasse 25 min est repris au passage suivant).

Ces dossiers ne donnent **jamais** de brouillon « à valider » (infos.json avec `compte` + `id`, section 6). Sans Drive
d'archivage, le post l'indique (`archive.error`) et cm réessaie toutes les 30 min ; rien n'empêche la publication.

Limites : `CM_MAX_UPLOAD_MB` par vidéo, nombre de publications par jour et par espace (`post_limiter`), quota
YouTube : `YOUTUBE_DAILY_POSTS` envois par 24 h et par espace (50 par défaut), et 100 envois par jour pour tout le projet Google.
Création de publications : `CM_DAILY_POSTS` par espace et par 24 h glissantes (150 par défaut ; seules les publications
réellement créées comptent, pas les tentatives refusées) → au-delà, `429`.
