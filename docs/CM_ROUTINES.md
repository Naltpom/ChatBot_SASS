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
1. `POST /posts` `{org_id, title, caption, file_name, video_size, targets: [...]}` → `{post_id, part_count, part_size}`
   - cible : `{platform, account: "tiktok:@pseudo", scheduled_at: "2026-12-24T17:30:00Z", options}` (UTC ; `null` =
     tout de suite). `account_id` reste accepté.
   - options TikTok : `{mode: "direct"|"draft", privacy_level: "PUBLIC_TO_EVERYONE"|…, allow_comment, allow_duet,
     allow_stitch, brand_organic, brand_content, title?, fallback_draft?}` — `fallback_draft: true` = le repli de
     `tiktok.py` : si TikTok refuse la visibilité (application pas encore auditée), la vidéo repart en brouillon
     dans l'app TikTok (`notice` de la cible l'indique) au lieu d'échouer.
   - options YouTube : `{title?, description?, tags: [], privacy_status: "public"|"unlisted"|"private",
     made_for_kids: false, synthetic_media: false, category_id: "10", notify_subscribers: true}`
   - options Instagram : `{caption?, share_to_feed: true}`
2. `PUT /posts/{id}/parts/{n}` (octets bruts, morceaux de `part_size`, dans l'ordre ; renvoyer un morceau déjà reçu est sans effet)
3. `PUT /posts/{id}/cover` (facultatif ; JPEG/PNG ≤ 8 Mo) → couverture Instagram (`cover_url`)
4. `POST /posts/{id}/submit` → vérifie la vidéo pour chaque compte, puis programme.

## 3. Suivre
`GET /posts/{id}` → `targets[]` : `status` (`SCHEDULED`, `DISPATCHING`, `PUBLISHING`, `AWAITING_ROUTINE`,
`PUBLISHED`, `INBOX`, `FAILED`, `CANCELLED`), `url`, `external_id`, `error_message`. Après une erreur Instagram,
cm vérifie lui-même si le Reel est en ligne quand même (même légende) avant de conclure à l'échec.
Changer l'heure : `PATCH /targets/{id}` `{scheduled_at}` ; annuler : `POST /targets/{id}/cancel` ;
relancer un échec : `POST /targets/{id}/retry`.

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

## 6. Mode validation
Si une vidéo ne doit plus partir (validation, retour en réserve), annuler ses cibles : `POST /targets/{id}/cancel`.
cm publie tout ce qui est programmé.

Limites : `CM_MAX_UPLOAD_MB` par vidéo, nombre de publications par jour et par espace (`post_limiter`), quota
YouTube (~6 envois/jour pour tout chapote).
