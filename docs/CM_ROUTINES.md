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
Annuler : `POST /targets/{id}/cancel` ; relancer un échec : `POST /targets/{id}/retry`.

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

## 7. Mode validation
Si une vidéo ne doit plus partir (validation, retour en réserve), annuler ses cibles : `POST /targets/{id}/cancel`.
cm publie tout ce qui est programmé.

Limites : `CM_MAX_UPLOAD_MB` par vidéo, nombre de publications par jour et par espace (`post_limiter`), quota
YouTube (~6 envois/jour pour tout chapote).
