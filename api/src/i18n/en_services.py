"""Messages des services cm, TikTok, YouTube, Instagram et Google Drive (src/services/*), en anglais.

Clé = texte français exact produit par le code ; ``{}`` = une valeur (f-string), dans l'ordre du français
(``{0}``, ``{1}``… quand l'anglais change l'ordre). Les valeurs sont elles-mêmes traduites si elles sont connues
(libellés de comptes, rôles…).
"""
EN = {
    # ---- cm_access.py : rôles, libellés et comptes déjà connectés
    "administrateur": "admin",
    "éditeur": "editor",
    "lecteur": "viewer",
    "modifier le planning": "edit the schedule",
    "gérer les comptes de l'équipe": "manage the team's accounts",
    "Ce compte TikTok": "This TikTok account",
    "Cette chaîne YouTube": "This YouTube channel",
    "Ce compte Instagram": "This Instagram account",
    "votre espace perso": "your personal space",
    "l'équipe « {} »": "the “{}” team",
    "Votre rôle dans l'équipe ({}) ne permet pas de {}. Demandez à un administrateur de l'équipe.":
        "Your team role ({}) doesn't allow you to {}. Ask a team admin.",
    "Votre rôle sur ce compte ({}) ne permet pas de {}.": "Your role on this account ({}) doesn't allow you to {}.",
    "{} est déjà connecté dans {} : transférez-le depuis cet espace (Comptes → Transférer).":
        "{} is already connected in {}: transfer it from that space (Accounts → Transfer).",
    "{} est déjà connecté à Chapote par une autre personne. Rapprochez-vous de la personne en charge (ou de "
    "l'administrateur de votre équipe) pour qu'elle vous le transfère.":
        "{} is already connected to Chapote by someone else. Contact the person in charge (or your team admin) "
        "so they can transfer it to you.",
    "Lien de reprise invalide ou expiré : reconnectez le compte.": "Invalid or expired takeover link. Reconnect the account.",
    "Lien de reprise déjà utilisé : reconnectez le compte.": "Takeover link already used. Reconnect the account.",
    "Périmètre invalide : « {} ».": "Invalid scope: “{}”.",
    "Périmètre introuvable : « {} ».": "Scope not found: “{}”.",
    "Groupe introuvable : « {} ».": "Group not found: “{}”.",
    "Compte introuvable : « {} ».": "Account not found: “{}”.",

    # ---- cm_service.py : validation des publications
    "Compte TikTok": "TikTok account",
    "Chaîne YouTube": "YouTube channel",
    "Compte Instagram": "Instagram account",
    "{} introuvable.": "{} not found.",
    "Plateforme inconnue.": "Unknown platform.",
    "hashtags : une liste est attendue.": "hashtags: a list is expected.",
    "{} : position de la miniature invalide.": "{}: invalid thumbnail position.",
    "TikTok : mode de publication inconnu.": "TikTok: unknown posting mode.",
    "TikTok : choisissez qui peut voir cette vidéo.": "TikTok: choose who can see this video.",
    "TikTok : la visibilité d'un contenu de marque ne peut pas être privée.":
        "TikTok: branded content can't be private.",
    "TikTok : légende trop longue ({} caractères maximum).": "TikTok: caption too long ({} characters max).",
    "YouTube : visibilité inconnue.": "YouTube: unknown visibility.",
    "YouTube : indiquez si la vidéo est conçue pour les enfants.": "YouTube: say whether the video is made for kids.",
    "YouTube : langue invalide (code comme « fr », « en » ou « pt-BR »).":
        "YouTube: invalid language (use a code like “fr”, “en” or “pt-BR”).",
    "Instagram : légende trop longue ({} caractères maximum).": "Instagram: caption too long ({} characters max).",
    "Instagram : 30 hashtags au plus.": "Instagram: 30 hashtags max.",
    "Instagram : 3 collaborateurs au plus, nom d'utilisateur Instagram sans espace.":
        "Instagram: 3 collaborators max, Instagram usernames without spaces.",
    "L'heure de publication est déjà passée.": "The post time has already passed.",
    "La publication ne peut pas être programmée plus de 6 mois à l'avance.":
        "Posts can't be scheduled more than 6 months ahead.",
    "TikTok : format non pris en charge (MP4, MOV ou WebM).": "TikTok: unsupported format (MP4, MOV or WebM).",
    "TikTok : vidéo trop longue ({} s pour {} s maximum).": "TikTok: video too long ({} s, {} s max).",
    "TikTok : vidéo trop volumineuse.": "TikTok: video file too large.",
    "YouTube : format non pris en charge (MP4, MOV ou WebM).": "YouTube: unsupported format (MP4, MOV or WebM).",
    "YouTube : vidéo trop longue pour un Short ({} s pour {} s maximum).":
        "YouTube: video too long for a Short ({} s, {} s max).",
    "YouTube : vidéo trop volumineuse.": "YouTube: video file too large.",
    "Instagram : format non pris en charge (MP4 ou MOV).": "Instagram: unsupported format (MP4 or MOV).",
    "Instagram : un Reel dure de {} s à {} min.": "Instagram: a Reel must be {} s to {} min long.",
    "Instagram : vidéo trop volumineuse (300 Mo maximum).": "Instagram: video file too large (300 MB max).",
    "L'espace réservé aux vidéos programmées est plein : attendez que des publications partent ou annulez-en.":
        "Storage for scheduled videos is full. Wait for some posts to go out, or cancel some.",
    "Envoi impossible pour le moment (capacité temporairement atteinte). Réessayez plus tard.":
        "Can't upload right now (temporarily at capacity). Try again later.",
    "Compte à reconnecter.": "Account needs to be reconnected.",
    "Statistiques TikTok pas encore autorisées : elles arriveront quand TikTok aura validé l'accès aux chiffres et "
    "que le compte aura été reconnecté.":
        "TikTok stats aren't authorized yet. They'll show up once TikTok approves access to stats and the account "
        "is reconnected.",
    "En attente des chiffres de la routine.": "Waiting for stats from the routine.",

    # ---- cm_jobs.py : envoi des cibles
    "TikTok n'a pas accepté la publication directe (application pas encore validée) : la vidéo est partie en "
    "brouillon dans l'app TikTok, à publier depuis le téléphone.":
        "TikTok didn't accept direct posting (app not approved yet). The video was sent as a draft to the TikTok "
        "app; post it from your phone.",
    "Le module TikTok n'est pas disponible pour le moment.": "TikTok isn't available right now.",
    "Ce compte TikTok a été déconnecté.": "This TikTok account was disconnected.",
    "Vidéo trop longue : {} s pour {} s maximum sur ce compte.": "Video too long: {} s, {} s max on this account.",
    "Limite quotidienne de publications TikTok atteinte pour votre espace.":
        "Daily TikTok post limit reached for your space.",
    "Le module YouTube n'est pas disponible pour le moment.": "YouTube isn't available right now.",
    "Cette chaîne YouTube a été déconnectée.": "This YouTube channel was disconnected.",
    "Limite de {} vidéos YouTube par 24 h atteinte pour votre espace : réessayez plus tard.":
        "Limit of {} YouTube videos per 24 h reached for your space. Try again later.",
    "Ce compte Instagram a été déconnecté.": "This Instagram account was disconnected.",
    "La connexion Instagram n'est pas disponible pour le moment.": "Instagram isn't available right now.",
    "La vidéo n'est plus disponible : recréez la publication.": "The video is no longer available. Create the post again.",
    "Erreur interne pendant la préparation de l'envoi. Réessayez.": "Internal error while preparing the upload. Try again.",
    "Publication TikTok introuvable.": "TikTok post not found.",
    "Vidéo envoyée dans la boîte de réception TikTok : terminez la publication dans l'app.":
        "Video sent to your TikTok inbox. Finish posting it in the app.",
    "Publication refusée par TikTok.": "Post rejected by TikTok.",
    "Publication YouTube introuvable.": "YouTube post not found.",
    "Vidéo refusée par YouTube.": "Video rejected by YouTube.",
    "L'envoi à Instagram a été interrompu. Réessayez.": "Upload to Instagram was interrupted. Try again.",
    "L'envoi a été interrompu plusieurs fois. Réessayez.": "The upload was interrupted several times. Try again.",
    "La routine n'a pas confirmé la publication.": "The routine didn't confirm the post.",

    # ---- cm_library.py : bibliothèque Drive
    "Ce dossier est déjà relié à un autre espace Chapote. Retirez-le de cet espace d'abord.":
        "This folder is already linked to another Chapote space. Remove it from that space first.",
    "Le dossier Drive de cette vidéo a été retiré de Chapote.": "This video's Drive folder was removed from Chapote.",
    "La vidéo n'est plus dans le dossier Drive.": "The video is no longer in the Drive folder.",
    "Le robot n'a plus accès à cette vidéo : vérifiez le partage du dossier Drive.":
        "The bot no longer has access to this video. Check the Drive folder's sharing settings.",
    "Vidéo trop volumineuse ({} Mo maximum).": "Video file too large ({} MB max).",
    "Vidéo refusée : {}.": "Video rejected: {}.",
    "Rangement dans « {} » impossible : {}": "Couldn't move it to “{}”: {}",
    # Messages de services/video_probe.py (valeur de « Vidéo refusée : {}. »)
    "Format non reconnu (MP4, MOV ou WebM attendu)": "unrecognized format (MP4, MOV or WebM expected)",
    "Fichier vidéo corrompu (boîte invalide)": "corrupted video file (invalid box)",
    "Durée de la vidéo illisible (en-tête moov/mvhd absent)": "unreadable video duration (missing moov/mvhd header)",
    "En-tête mvhd tronqué": "truncated mvhd header",
    "Durée de la vidéo illisible (timescale nul)": "unreadable video duration (zero timescale)",
    "Fichier WebM tronqué": "truncated WebM file",
    "Fichier WebM corrompu": "corrupted WebM file",
    "Durée de la vidéo illisible (WebM sans durée)": "unreadable video duration (WebM without duration)",

    # ---- cm_archive.py : archivage Drive
    "Dossier d'archives": "Archive folder",
    "Google a retiré l'accès au Drive : reconnectez-le.": "Google revoked Drive access. Reconnect it.",
    "Connexion Google Drive refusée ({}).": "Google Drive connection refused ({}).",
    "Google Drive déconnecté : reconnectez-le.": "Google Drive disconnected. Reconnect it.",
    "Google n'a pas fourni d'accès durable : réessayez.": "Google didn't grant lasting access. Try again.",
    "L'accès au Drive n'a pas été accordé : cochez la case de Google Drive.":
        "Drive access wasn't granted. Check the Google Drive box.",
    "Aucun Drive d'archivage : connectez Google Drive dans la Bibliothèque.":
        "No archive Drive. Connect Google Drive in the Library.",
    "La vidéo n'est plus sur le serveur : renvoyez-la (PUT /posts/{id}/video) pour l'archiver.":
        "The video is no longer on the server. Upload it again (PUT /posts/{id}/video) to archive it.",
    "Google Drive injoignable pendant l'archivage : nouvel essai dans 30 min.":
        "Google Drive unreachable during archiving. Retrying in 30 min.",
    "envoi trop long": "upload took too long",
    "Erreur pendant l'archivage ({}) : nouvel essai dans 30 min.": "Error during archiving ({}). Retrying in 30 min.",

    # ---- cm_storage.py : stockage Drive
    "{}, propriétaire de ce compte, n'a pas encore relié de Google Drive : les vidéos sont rangées dans son Drive. "
    "Demandez-lui de le connecter (Bibliothèque → Stockage).":
        "{}, the owner of this account, hasn't linked a Google Drive yet; videos are stored in their Drive. "
        "Ask them to connect it (Library → Storage).",
    "Connectez d'abord un Google Drive à cet espace (Bibliothèque → Stockage) : vos vidéos y sont rangées. Sans "
    "Drive, impossible de créer une publication.":
        "First connect a Google Drive to this space (Library → Storage); your videos are stored there. "
        "You can't create a post without a Drive.",
    "Stockage plein : cette vidéo fait {}, il reste {}. Libérez de la place dans votre Drive, augmentez le quota "
    "réservé à Chapote, ajoutez un stockage ou choisissez de supprimer les vidéos après publication (Bibliothèque → "
    "Stockage).":
        "Storage full: this video is {}, only {} left. Free up space in your Drive, raise the quota reserved for "
        "Chapote, add storage, or choose to delete videos after posting (Library → Storage).",
    "Conservation inconnue.": "Unknown retention setting.",
    "Indiquez un nombre de jours entre 1 et 365.": "Enter a number of days between 1 and 365.",
    "Quota : 1 Go au moins (ou vide = tout l'espace libre).": "Quota: at least 1 GB (or empty = all free space).",
    "Votre Drive n'a que {} Go disponibles pour Chapote.": "Your Drive only has {} GB available for Chapote.",

    # ---- cm_inbox.py : commentaires et messages
    "Permission en attente de validation par Meta (gérer les commentaires Instagram). Les commentaires de ce compte "
    "s'afficheront dès qu'elle sera accordée et le compte reconnecté.":
        "Permission pending Meta review (manage Instagram comments). This account's comments will show up once "
        "it's granted and the account is reconnected.",
    "Permission en attente de validation par Meta (messages Instagram). Les messages s'afficheront dès qu'elle sera "
    "accordée et le compte reconnecté.":
        "Permission pending Meta review (Instagram messages). Messages will show up once it's granted and the "
        "account is reconnected.",
    "Permission en attente de validation par Google (répondre et modérer sur YouTube). Vous pouvez répondre depuis "
    "YouTube Studio en attendant.":
        "Permission pending Google review (reply and moderate on YouTube). Meanwhile, you can reply from YouTube Studio.",
    "Commentaires YouTube : activés après la vérification Google en cours. Répondez depuis YouTube Studio en attendant.":
        "YouTube comments: enabled once Google's ongoing review is done. Meanwhile, reply from YouTube Studio.",
    "TikTok ne donne pas accès aux commentaires aux applications comme Chapote : répondez dans l'appli TikTok.":
        "TikTok doesn't give apps like Chapote access to comments. Reply in the TikTok app.",
    "Les messages de ce compte (géré par la routine) se lisent dans Instagram.":
        "Messages for this account (managed by the routine) are read in Instagram.",
    "Réponse privée : Instagram seulement.": "Private reply: Instagram only.",
    "Instagram n'autorise la réponse privée que 7 jours après le commentaire : écrivez-lui depuis Instagram.":
        "Instagram only allows a private reply within 7 days of the comment. Message them from Instagram.",
    "Une réponse privée a déjà été envoyée pour ce commentaire.": "A private reply was already sent for this comment.",

    # ---- cm_assistant.py / cm_mcp.py : assistant IA (erreurs renvoyées)
    "Jeton assistant absent.": "Missing assistant token.",
    "Jeton assistant invalide.": "Invalid assistant token.",
    "Jeton assistant invalide ou expiré.": "Invalid or expired assistant token.",
    "Compte introuvable.": "Account not found.",
    "Accord IA absent ou à revoir : activez l'assistant dans Réglages → Assistant IA.":
        "AI consent missing or needs review. Turn on the assistant in Settings → AI assistant.",
    "Votre accord IA a changé : la page va redemander un jeton.": "Your AI consent changed. The page will request a new token.",
    "Aucun compte de ce nom dans votre périmètre autorisé. Appelez my_accounts pour connaître les alias.":
        "No account with that name in your allowed scope. Call my_accounts to get the aliases.",
    "Aucun groupe de ce nom dans votre périmètre autorisé. Appelez my_accounts pour connaître les alias.":
        "No group with that name in your allowed scope. Call my_accounts to get the aliases.",
    "Période inconnue : 7d, 30d, 90d ou 365d.": "Unknown period: 7d, 30d, 90d or 365d.",
    "Aucun compte avec les statistiques autorisées.": "No account with stats allowed.",
    "`day` : today, yesterday, tomorrow ou une date AAAA-MM-JJ.": "`day`: today, yesterday, tomorrow or a YYYY-MM-DD date.",
    "`when` : upcoming, published ou failed.": "`when`: upcoming, published or failed.",
    "Aucun compte avec le planning autorisé.": "No account with the schedule allowed.",
    "`metric` : views, engagement ou shares.": "`metric`: views, engagement or shares.",
    "Outil inconnu.": "Unknown tool.",
    "Trop de questions sur vos données pour le moment. Réessayez un peu plus tard.":
        "Too many questions about your data right now. Try again a bit later.",
    "Erreur interne de l'assistant. Réessayez plus tard.": "Internal assistant error. Try again later.",
    "Non authentifié.": "Not authenticated.",

    # ---- cm_paging.py
    "Curseur de pagination invalide.": "Invalid pagination cursor.",

    # ---- cm_push.py : notifications de l'app (traduites selon la langue du destinataire)
    "Déconnecté de Chapote CM": "Signed out of Chapote CM",
    "7 jours sans ouvrir l’app : reconnectez-vous pour recevoir à nouveau les notifications.":
        "7 days without opening the app. Sign in again to get notifications.",
    "Ouvrez Chapote CM": "Open Chapote CM",
    "Sans ouverture d’ici demain, cet appareil sera déconnecté et ne recevra plus de notifications.":
        "If you don't open it by tomorrow, this device will be signed out and stop getting notifications.",
    "⚠️ Œuvre protégée publiée": "⚠️ Copyrighted work posted",
    "{} · {} : surveillez les réclamations de droits d'auteur (son coupé, vidéo bloquée).":
        "{} · {}: watch for copyright claims (muted audio, blocked video).",
    "Vidéo publiée": "Video posted",
    "Échec sur {}": "Failed on {}",
    "voir le planning": "see the schedule",
    "Brouillon TikTok à publier": "TikTok draft to post",
    "{} : copiez la légende et publiez dans TikTok.": "{}: copy the caption and post it in TikTok.",
    "Stockage Drive plein": "Drive storage full",
    "{} à reconnecter": "Reconnect {}",
    "les publications sur ce compte sont en pause": "posts on this account are on hold",
    "Les nouvelles publications sont bloquées : libérez de la place ou changez la conservation.":
        "New posts are blocked. Free up space or change the retention setting.",
    "Stockage Drive presque plein": "Drive storage almost full",
    "Plus de 90 % utilisés : pensez à libérer de la place ou à changer la conservation.":
        "Over 90% used. Consider freeing up space or changing the retention setting.",
    "Nouveau commentaire": "New comment",
    "{} nouveaux commentaires": "{} new comments",
    "Quelqu’un": "Someone",
    "(et {} autre)": "(and {} more)",
    "(et {} autres)": "(and {} more)",

    # ---- tiktok_service.py (messages internes) et tiktok_jobs.py
    "Lien d'envoi TikTok expiré": "TikTok upload link expired",
    "Échec de l'envoi d'un segment vidéo": "Failed to upload a video chunk",
    "Taille de vidéo invalide": "Invalid video size",
    "Index de chunk hors limites": "Chunk index out of range",
    "Réponse non JSON (HTTP {})": "Non-JSON response (HTTP {})",
    "Erreur interne pendant l'envoi de la vidéo à TikTok. Réessayez.":
        "Internal error while uploading the video to TikTok. Try again.",
    "Publication refusée par TikTok ({}).": "Post rejected by TikTok ({}).",
    "TikTok n'a pas terminé le traitement de la vidéo dans les 24 h.": "TikTok didn't finish processing the video within 24 h.",
    "Envoi de la vidéo vers Chapote interrompu.": "Video upload to Chapote was interrupted.",
    "Envoi de la vidéo vers TikTok interrompu. Relancez la publication.":
        "Video upload to TikTok was interrupted. Start the post again.",

    # ---- youtube_service.py (ERROR_MESSAGES, describe) et youtube_jobs.py
    "L'autorisation Google a expiré ou a été révoquée : reconnectez la chaîne.":
        "Google authorization expired or was revoked. Reconnect the channel.",
    "Vous avez refusé l'accès : aucune chaîne n'a été connectée.": "You denied access. No channel was connected.",
    "Chapote n'a pas reçu l'autorisation d'envoyer des vidéos : reconnectez la chaîne en cochant toutes les autorisations.":
        "Chapote wasn't allowed to upload videos. Reconnect the channel and check all permissions.",
    "Ce compte Google n'a pas de chaîne YouTube. Créez-en une sur youtube.com, puis reconnectez-vous.":
        "This Google account has no YouTube channel. Create one on youtube.com, then reconnect.",
    "Le quota quotidien de l'API YouTube est épuisé. Réessayez demain, après 9 h (minuit, heure du Pacifique).":
        "The daily YouTube API quota is used up. Try again tomorrow after midnight Pacific Time.",
    "Cette chaîne a atteint sa limite d'envois YouTube pour aujourd'hui. Réessayez demain.":
        "This channel has reached today's YouTube upload limit. Try again tomorrow.",
    "Trop de requêtes vers YouTube. Patientez une minute puis réessayez.":
        "Too many requests to YouTube. Wait a minute, then try again.",
    "YouTube a refusé l'envoi pour cette chaîne.": "YouTube refused the upload for this channel.",
    "Chapote n'a pas reçu l'autorisation d'envoyer des vidéos : reconnectez la chaîne.":
        "Chapote wasn't allowed to upload videos. Reconnect the channel.",
    "Titre refusé par YouTube (100 caractères au plus, sans < ni >).":
        "Title rejected by YouTube (100 characters max, no < or >).",
    "Description refusée par YouTube (5 000 octets au plus, sans < ni >).":
        "Description rejected by YouTube (5,000 bytes max, no < or >).",
    "Mots-clés refusés par YouTube (500 caractères au plus en tout).": "Tags rejected by YouTube (500 characters max in total).",
    "Catégorie YouTube invalide.": "Invalid YouTube category.",
    "Date de mise en ligne programmée refusée par YouTube.": "Scheduled publish date rejected by YouTube.",
    "Métadonnées de la vidéo refusées par YouTube.": "Video metadata rejected by YouTube.",
    "Erreur temporaire chez YouTube. Réessayez plus tard.": "Temporary YouTube error. Try again later.",
    "Le serveur d'envoi YouTube est momentanément indisponible. Réessayez dans quelques minutes.":
        "YouTube's upload server is temporarily unavailable. Try again in a few minutes.",
    "Connexion au serveur d'envoi YouTube interrompue. Réessayez dans quelques minutes.":
        "Connection to YouTube's upload server was interrupted. Try again in a few minutes.",
    "Connexion au serveur d'envoi YouTube interrompue": "Connection to YouTube's upload server was interrupted",
    "La session d'envoi YouTube a expiré. Relancez la publication.": "The YouTube upload session expired. Start the post again.",
    "Codec vidéo refusé par YouTube.": "Video codec rejected by YouTube.",
    "YouTube n'a pas pu convertir la vidéo.": "YouTube couldn't convert the video.",
    "Fichier vidéo vide.": "Empty video file.",
    "Fichier vidéo illisible par YouTube.": "YouTube couldn't read the video file.",
    "Fichier vidéo trop petit.": "Video file too small.",
    "L'envoi à YouTube a été interrompu.": "Upload to YouTube was interrupted.",
    "Vidéo refusée : revendication de droits d'auteur.": "Video rejected: copyright claim.",
    "Vidéo refusée pour atteinte aux droits d'auteur.": "Video rejected for copyright infringement.",
    "Vidéo refusée par YouTube : doublon d'une vidéo déjà envoyée.": "Video rejected by YouTube: duplicate of an uploaded video.",
    "Vidéo refusée : contenu jugé inapproprié par YouTube.": "Video rejected: YouTube found the content inappropriate.",
    "Vidéo refusée par YouTube pour raison juridique.": "Video rejected by YouTube for legal reasons.",
    "Vidéo refusée par YouTube : trop longue.": "Video rejected by YouTube: too long.",
    "Vidéo refusée : non conforme aux conditions d'utilisation de YouTube.":
        "Video rejected: violates YouTube's Terms of Service.",
    "Vidéo refusée : atteinte à une marque.": "Video rejected: trademark infringement.",
    "La chaîne YouTube a été fermée.": "The YouTube channel was closed.",
    "La chaîne YouTube est suspendue.": "The YouTube channel is suspended.",
    "La vidéo a été supprimée de YouTube.": "The video was deleted from YouTube.",
    "YouTube a gardé la vidéo privée : tant que le projet Google n'a pas passé l'audit de conformité de l'API "
    "YouTube, toute vidéo envoyée par l'API reste privée. Passez-la en public depuis YouTube Studio.":
        "YouTube kept the video private: until the Google project passes the YouTube API compliance audit, every "
        "video uploaded through the API stays private. Make it public in YouTube Studio.",
    "Erreur YouTube « {} »": "YouTube error “{}”",
    "Erreur YouTube « {} » : {}": "YouTube error “{}”: {}",
    "Aucune chaîne pour ce compte Google": "No channel for this Google account",
    "URL de session d'envoi absente": "Missing upload session URL",
    "Identifiant de vidéo absent": "Missing video ID",
    "Erreur interne pendant l'envoi de la vidéo à YouTube. Réessayez.":
        "Internal error while uploading the video to YouTube. Try again.",
    "Traitement refusé par YouTube ({}).": "Processing rejected by YouTube ({}).",
    "Vidéo refusée par YouTube ({}).": "Video rejected by YouTube ({}).",
    "YouTube n'a pas terminé le traitement de la vidéo dans les 24 h.":
        "YouTube didn't finish processing the video within 24 h.",
    "Envoi de la vidéo vers YouTube interrompu. Relancez la publication.":
        "Video upload to YouTube was interrupted. Start the post again.",

    # ---- instagram_service.py (ERROR_MESSAGES, describe)
    "L'autorisation Instagram a expiré ou a été retirée : reconnectez le compte.":
        "Instagram authorization expired or was revoked. Reconnect the account.",
    "Trop de requêtes vers Instagram. Réessayez dans quelques minutes.":
        "Too many requests to Instagram. Try again in a few minutes.",
    "Ce compte Instagram n'est pas un compte professionnel (Créateur ou Entreprise). Passez-le en compte "
    "professionnel dans l'app Instagram, puis reconnectez-le.":
        "This Instagram account isn't a professional account (Creator or Business). Switch it to a professional "
        "account in the Instagram app, then reconnect it.",
    "Ce compte a atteint la limite de 100 publications par 24 h.": "This account has reached the limit of 100 posts per 24 h.",
    "Instagram n'a pas pu traiter la vidéo (format, durée ou dimensions refusés).":
        "Instagram couldn't process the video (format, length or dimensions rejected).",
    "Instagram a abandonné le traitement de la vidéo. Relancez la publication.":
        "Instagram gave up processing the video. Start the post again.",
    "Instagram n'a pas fini de traiter la vidéo dans l'heure. Relancez la publication.":
        "Instagram didn't finish processing the video within an hour. Start the post again.",
    "Chapote n'a pas reçu l'autorisation de publier sur ce compte : reconnectez-le en acceptant toutes les autorisations.":
        "Chapote wasn't allowed to post to this account. Reconnect it and accept all permissions.",
    "Vous avez refusé l'accès : aucun compte n'a été connecté.": "You denied access. No account was connected.",
    "Erreur Instagram": "Instagram error",
    "Erreur Instagram : {}": "Instagram error: {}",
    "Identifiant de publication absent": "Missing post ID",
    "Identifiant de conteneur absent": "Missing container ID",

    # ---- gdrive_service.py (DriveError.describe)
    "Le robot n'a pas accès à ce dossier : partagez-le avec son adresse (Lecteur suffit), puis réessayez.":
        "The bot can't access this folder. Share it with the bot's address (Viewer is enough), then try again.",
    "Ce lien n'est pas celui d'un dossier Google Drive.": "This link isn't a Google Drive folder.",
    "Ce lien est celui d'un « projet » Google Drive, qui ne peut pas contenir de fichiers. Créez plutôt un dossier "
    "(Nouveau → Nouveau dossier), mettez-y les vidéos, partagez-le avec le robot, puis copiez l'adresse du dossier "
    "ouvert (…/drive/folders/…).":
        "This link is a Google Drive “project”, which can't hold files. Create a folder instead (New → New folder), "
        "put the videos in it, share it with the bot, then copy the address of the open folder (…/drive/folders/…).",
    "Lien de dossier Google Drive non reconnu : copiez l'adresse du dossier ouvert dans Google Drive.":
        "Google Drive folder link not recognized. Copy the address of the folder open in Google Drive.",
    "Ce dossier est dans la corbeille de Google Drive.": "This folder is in the Google Drive trash.",
    "Google Drive limite les requêtes pour le moment : réessayez dans quelques minutes.":
        "Google Drive is rate-limiting requests right now. Try again in a few minutes.",
    "La bibliothèque Google Drive n'est pas encore configurée sur Chapote.":
        "The Google Drive library isn't set up on Chapote yet.",
    "Le robot ne peut pas créer de fichier dans un dossier de « Mon Drive » (pas d'espace de stockage).":
        "The bot can't create files in a “My Drive” folder (no storage space).",
    "Erreur Google Drive ({})": "Google Drive error ({})",
    "Erreur Google Drive ({}) : {}": "Google Drive error ({}): {}",
    "fichier trop volumineux": "file too large",
    "pas d'adresse d'envoi": "no upload address",
}

# ---- tiktok_service.py : ERROR_MESSAGES et describe(), qui ajoute « (réf. <log_id>) » quand TikTok en donne un.
# Les variantes « … (réf. {}) » passent avant les modèles plus courts (« Erreur TikTok « {} » : {} »).
_TIKTOK = {
    "L'autorisation TikTok a expiré ou a été révoquée : reconnectez le compte.":
        "TikTok authorization expired or was revoked. Reconnect the account.",
    "Ce compte n'a pas accordé les autorisations de publication : reconnectez-le en acceptant toutes les autorisations.":
        "This account didn't grant posting permissions. Reconnect it and accept all permissions.",
    "Ce compte a atteint le nombre maximal de publications autorisées pour aujourd'hui. Réessayez plus tard.":
        "This account has reached today's post limit. Try again later.",
    "Trop de vidéos en attente dans la boîte de réception TikTok de ce compte (5 par 24 h). Publiez ou supprimez-les "
    "depuis l'app TikTok, puis réessayez.":
        "Too many pending videos in this account's TikTok inbox (5 per 24 h). Post or delete them in the TikTok app, "
        "then try again.",
    "Ce compte n'est pas autorisé à publier pour le moment.": "This account isn't allowed to post right now.",
    "La limite quotidienne d'utilisateurs de l'application est atteinte. Réessayez plus tard.":
        "The app's daily user limit has been reached. Try again later.",
    "Tant que l'application n'est pas validée par TikTok, la publication n'est possible que sur un compte privé.":
        "Until TikTok approves the app, you can only post to a private account.",
    "Ce niveau de confidentialité n'est pas proposé par TikTok pour ce compte.":
        "TikTok doesn't offer this privacy level for this account.",
    "Trop de requêtes vers TikTok. Patientez une minute puis réessayez.":
        "Too many requests to TikTok. Wait a minute, then try again.",
    "TikTok a refusé la demande (paramètre invalide).": "TikTok rejected the request (invalid parameter).",
    "Source vidéo refusée par TikTok.": "Video source rejected by TikTok.",
    "Publication introuvable chez TikTok.": "Post not found on TikTok.",
    "Cette publication n'appartient pas à ce compte TikTok.": "This post doesn't belong to this TikTok account.",
    "Erreur temporaire chez TikTok. Réessayez plus tard.": "Temporary TikTok error. Try again later.",
    "Format vidéo refusé par TikTok.": "Video format rejected by TikTok.",
    "Durée de la vidéo refusée par TikTok.": "Video length rejected by TikTok.",
    "Fréquence d'images refusée par TikTok.": "Frame rate rejected by TikTok.",
    "Dimensions de la vidéo refusées par TikTok.": "Video dimensions rejected by TikTok.",
    "Erreur temporaire chez TikTok. Réessayez la publication.": "Temporary TikTok error. Try posting again.",
    "TikTok n'a pas pu récupérer la vidéo.": "TikTok couldn't fetch the video.",
    "La publication a été annulée.": "The post was canceled.",
    "L'autorisation a été retirée pendant le traitement : reconnectez le compte.":
        "Authorization was revoked during processing. Reconnect the account.",
    "La légende a été jugée indésirable par TikTok.": "TikTok flagged the caption as spam.",
    "La publication a été jugée à risque par TikTok.": "TikTok flagged the post as risky.",
    "Le serveur d'envoi TikTok est momentanément indisponible. Réessayez dans quelques minutes.":
        "TikTok's upload server is temporarily unavailable. Try again in a few minutes.",
    "Connexion au serveur d'envoi TikTok interrompue. Réessayez dans quelques minutes.":
        "Connection to TikTok's upload server was interrupted. Try again in a few minutes.",
    "Connexion au serveur d'envoi TikTok interrompue": "Connection to TikTok's upload server was interrupted",
    "Erreur TikTok « {} »": "TikTok error “{}”",
    "Erreur TikTok « {} » : {}": "TikTok error “{}”: {}",
}
EN.update({k + " (réf. {})": v + " (ref. {})" for k, v in _TIKTOK.items()})
EN.update(_TIKTOK)
