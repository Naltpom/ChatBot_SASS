"""Messages des routeurs cm, auth, 2FA, TikTok et YouTube (src/routers/*), en anglais.

Clé = texte français exact produit par le code ; ``{}`` = une valeur (f-string), dans l'ordre du français.
"""
EN = {
    # ---- Libellés de comptes (services/cm_service.ACCOUNT_LABEL), utilisés dans les modèles ci-dessous
    "Compte TikTok": "TikTok account",
    "Chaîne YouTube": "YouTube channel",
    "Compte Instagram": "Instagram account",

    # ---- routers/cm.py
    "Compte invalide.": "Invalid account.",
    "Compte introuvable": "Account not found",
    "Jeton de service cm non configuré": "cm service token not configured",
    "Jeton invalide": "Invalid token",
    "Jeton de service cm mal configuré": "cm service token misconfigured",
    "Jeton de service requis": "Service token required",
    "Curseur de pagination invalide.": "Invalid pagination cursor.",
    "Espace perso": "Personal space",
    "Chiffres déjà actualisés récemment : réessayez plus tard.": "Stats were refreshed recently. Try again later.",
    "Groupe introuvable": "Group not found",
    "Vidéo introuvable": "Video not found",
    "{} introuvable.": "{} not found.",
    "Donnez un nom au groupe.": "Give the group a name.",
    "{} groupes au plus par espace.": "Up to {} groups per space.",
    "Période invalide.": "Invalid period.",
    "Période de {} jours au plus.": "Period of {} days max.",
    "La connexion Instagram n'est pas encore disponible (validation Meta en cours).":
        "Instagram connection isn't available yet (Meta review in progress).",
    "Trop de tentatives de connexion Instagram. Réessayez dans une heure.":
        "Too many Instagram connection attempts. Try again in an hour.",
    "Lien de connexion Instagram invalide ou expiré : relancez « Connecter Instagram ».":
        "Instagram connection link is invalid or expired. Start “Connect Instagram” again.",
    "Réponse Instagram incomplète : réessayez.": "Incomplete response from Instagram. Please try again.",
    "Nom d'utilisateur Instagram invalide.": "Invalid Instagram username.",
    "Seul le membre qui a connecté ce compte ou un administrateur de l'équipe peut le retirer.":
        "Only the member who connected this account or a team admin can remove it.",
    "Jetons supprimés de Chapote. Pour retirer aussi l'accès côté Instagram : Paramètres > Applications et sites web, dans l'app Instagram.":
        "Tokens deleted from Chapote. To also remove access on Instagram: Settings > Apps and websites, in the Instagram app.",
    "signed_request invalide": "Invalid signed_request",
    "⚠️ Œuvre protégée : risque de réclamation de droits d'auteur (Content ID, son coupé, vidéo bloquée).":
        "⚠️ Protected work: risk of a copyright claim (Content ID, muted audio, blocked video).",
    "La chaîne YouTube « {} » n'accepte que des œuvres du domaine public : cette publication est protégée ou ses droits sont inconnus.":
        "The YouTube channel “{}” only accepts public domain works: this post is protected or its rights are unknown.",
    "Publication introuvable": "Post not found",
    "Vidéo introuvable dans la bibliothèque.": "Video not found in the library.",
    "Limite de {} publications créées par 24 h atteinte pour cet espace. Réessayez plus tard.":
        "Limit of {} posts created per 24 h reached for this space. Try again later.",
    "Cible sans compte : donnez « account » (ex. tiktok:@pseudo) ou « account_id ».":
        "Target without an account: provide “account” (e.g. tiktok:@handle) or “account_id”.",
    "Compte « {} » introuvable dans cet espace (voir GET /api/cm/accounts → slug).":
        "Account “{}” not found in this space (see GET /api/cm/accounts → slug).",
    "Un même compte est choisi deux fois.": "The same account is selected twice.",
    "{} « {} » : publication impossible pour le moment (compte à reconnecter ou module indisponible).":
        "{} “{}”: can't post right now (account needs reconnecting or module unavailable).",
    "Cette vidéo n'est plus dans le dossier Drive.": "This video is no longer in the Drive folder.",
    "Choisissez une vidéo.": "Choose a video.",
    "Vidéo trop volumineuse ({} Mo maximum).": "Video too large ({} MB max).",
    "Donnez un titre à la publication.": "Give the post a title.",
    "Des vidéos sont déjà en cours d'envoi : attendez qu'elles se terminent.":
        "Videos are already uploading. Wait for them to finish.",
    "Cette publication n'attend plus de vidéo.": "This post is no longer waiting for a video.",
    "Morceau hors limites.": "Chunk out of range.",
    "Taille du morceau {} incorrecte ({} octets, {} attendus).": "Wrong size for chunk {} ({} bytes, {} expected).",
    "Morceaux reçus dans le désordre : relancez la publication.": "Chunks received out of order. Restart the post.",
    "Une publication active porte déjà la référence « {} ».": "An active post already has the reference “{}”.",
    "Rien à modifier : donnez « ref », « archive » ou « rights ».": "Nothing to change: provide “ref”, “archive” or “rights”.",
    "Référence attendue sous la forme « compte/id ».": "Reference expected as “account/id”.",
    "Publication sans référence : posez-la d'abord (PATCH /posts/{}).": "Post has no reference: set it first (PATCH /posts/{}).",
    "Cette publication n'est pas prête : envoyez la vidéo par la création.":
        "This post isn't ready: upload the video when creating it.",
    "La vidéo est encore sur le serveur : rien à renvoyer.": "The video is still on the server: nothing to re-upload.",
    "Aucun renvoi de vidéo en cours : commencez par PUT /posts/{}/video.":
        "No video re-upload in progress: start with PUT /posts/{}/video.",
    "Morceaux reçus dans le désordre : recommencez le renvoi.": "Chunks received out of order. Restart the re-upload.",
    "La vidéo n'a pas été entièrement reçue.": "The video wasn't fully received.",
    "Vidéo refusée : {}.": "Video rejected: {}.",
    "Publication annulée.": "Post canceled.",
    "Couverture : image JPEG ou PNG de 8 Mo au plus.": "Cover: JPEG or PNG image, 8 MB max.",
    "Couverture : seules les images JPEG ou PNG sont acceptées.": "Cover: only JPEG or PNG images are accepted.",
    "Cette publication a déjà été validée.": "This post has already been confirmed.",
    "Taille de la vidéo reçue incorrecte : relancez la publication.": "Wrong size for the received video. Restart the post.",
    "Cette publication est annulée : recréez-la.": "This post was canceled. Create it again.",
    "La vidéo n'est plus disponible : recréez la publication.": "The video is no longer available. Create the post again.",
    "{} comptes au plus par publication.": "Up to {} accounts per post.",
    "Vidéo indisponible": "Video unavailable",
    "Pas de couverture": "No cover",
    "Cette publication est déjà partie : elle ne peut plus être modifiée.": "This post has already gone out: it can no longer be edited.",
    "Cette publication n'est pas en attente.": "This post isn't pending.",
    "Cette publication est déjà partie : elle ne peut plus être annulée.": "This post has already gone out: it can no longer be canceled.",
    "Seule une publication en échec peut être relancée.": "Only a failed post can be retried.",
    "Ce compte doit d'abord être reconnecté.": "This account must be reconnected first.",
    "Seul un brouillon envoyé dans l'app TikTok peut être marqué publié.":
        "Only a draft sent to the TikTok app can be marked as posted.",
    "Lien TikTok non reconnu (https://www.tiktok.com/@compte/video/…).":
        "TikTok link not recognized (https://www.tiktok.com/@account/video/…).",
    "Seul un brouillon envoyé dans l'app TikTok peut être renvoyé.": "Only a draft sent to the TikTok app can be resent.",
    "Introuvable": "Not found",
    "Publication déjà prise en charge.": "Post already being handled.",
    "Cette publication n'est pas à faire maintenant.": "This post isn't due now.",
    "Cette publication n'est pas en cours.": "This post isn't in progress.",
    "Lien de la publication invalide.": "Invalid post link.",
    "Routine : {}": "Routine: {}",
    "Ce compte est connecté à l'API Instagram : ses chiffres sont relevés directement.":
        "This account is connected to the Instagram API: its stats are fetched directly.",

    # ---- routers/cm_library.py
    "Dossier introuvable": "Folder not found",
    "Trop d'essais : réessayez dans une heure.": "Too many attempts. Try again in an hour.",
    "Connexion Google refusée : {}": "Google sign-in refused: {}",
    "Cette adresse Google est déjà associée à un autre compte Chapote.":
        "This Google address is already linked to another Chapote account.",
    "Adresse introuvable": "Address not found",
    "Pour ranger les vidéos publiées, partagez le dossier avec le robot en Éditeur.":
        "To file posted videos, share the folder with the bot as Editor.",
    "Dossier relu il y a peu : réessayez dans quelques minutes.": "Folder was scanned recently. Try again in a few minutes.",
    "Vous pouvez aussi retirer le robot du partage du dossier dans Google Drive.":
        "You can also remove the bot from the folder's sharing in Google Drive.",
    "Pas de miniature": "No thumbnail",
    "Miniature indisponible": "Thumbnail unavailable",
    "Trop d'analyses : réessayez dans une heure.": "Too many analyses. Try again in an hour.",
    "Brouillon introuvable": "Draft not found",
    "Lien de connexion Google Drive invalide ou expiré : relancez « Connecter Google Drive ».":
        "Google Drive connection link is invalid or expired. Start “Connect Google Drive” again.",
    "La connexion Google Drive n'est pas encore configurée sur Chapote.":
        "Google Drive connection isn't set up on Chapote yet.",
    "Trop de tentatives : réessayez dans une heure.": "Too many attempts. Try again in an hour.",
    "Connectez d'abord un Google Drive à cet espace.": "Connect a Google Drive to this space first.",
    "Stockage introuvable": "Storage not found",

    # ---- routers/cm_team.py
    "Équipe introuvable": "Team not found",
    "Seul un administrateur de l'équipe peut gérer ses membres.": "Only a team admin can manage its members.",
    "Groupe inconnu dans cette équipe.": "Unknown group in this team.",
    "Donnez un nom à l'équipe.": "Give the team a name.",
    "10 équipes au plus par compte.": "Up to 10 teams per account.",
    "Trop d'invitations : réessayez dans une heure.": "Too many invitations. Try again in an hour.",
    "Cette personne fait déjà partie de l'équipe.": "This person is already on the team.",
    "Une invitation est déjà en attente pour cette adresse.": "An invitation is already pending for this address.",
    "Membre introuvable": "Member not found",
    "Un administrateur de l'équipe est toujours administrateur dans cm : changez son rôle d'équipe d'abord.":
        "A team admin is always an admin in cm: change their team role first.",
    "Vous ne pouvez pas changer votre propre rôle.": "You can't change your own role.",
    "Impossible de retirer le dernier administrateur de l'équipe.": "Can't remove the team's last admin.",
    "Invitation introuvable": "Invitation not found",
    "Trop de transferts : réessayez dans une heure.": "Too many transfers. Try again in an hour.",
    "Pour l'envoyer vers un de vos espaces, choisissez-le dans la liste.":
        "To send it to one of your spaces, pick it from the list.",
    "Transfert proposé à {} : il sera fait quand cette personne l'acceptera dans cm.":
        "Transfer offered to {}: it will happen when they accept it in cm.",
    "Choisissez la destination du compte.": "Choose where the account goes.",
    "Le compte est déjà dans cet espace.": "The account is already in this space.",
    "Transfert introuvable": "Transfer not found",
    "Ce transfert n'est plus en attente.": "This transfer is no longer pending.",
    "Ce compte n'est plus dans l'espace qui l'a proposé : transfert annulé.":
        "This account is no longer in the space that offered it: transfer canceled.",
    "Ce compte n'est plus connecté ailleurs : connectez-le simplement.":
        "This account is no longer connected elsewhere: just connect it.",
    "Espace de {}": "{}'s space",
    "Mon espace": "My space",
    "Trop de partages : réessayez dans une heure.": "Too many shares. Try again in an hour.",
    "C'est votre propre adresse.": "That's your own address.",
    "Choisissez ce que vous partagez.": "Choose what you're sharing.",
    "{} a déjà accès à tout (administrateur).": "{} already has full access (admin).",
    "Personne introuvable": "Person not found",
    "Le rôle du propriétaire et le vôtre ne se changent pas ici.": "The owner's role and yours can't be changed here.",
    "Il faut au moins un administrateur.": "There must be at least one admin.",
    "Le propriétaire de l'espace ne peut pas être retiré.": "The space owner can't be removed.",
    "Peut publier": "Can post",
    "Lecture seule": "Read-only",
    "Seul un administrateur du groupe peut le partager.": "Only a group admin can share it.",
    "Partage introuvable": "Share not found",

    # ---- routers/cm_mobile.py
    "Appareil déconnecté : reconnectez-vous.": "Device signed out. Please sign in again.",
    "Déconnecté après 7 jours sans ouvrir l'app : reconnectez-vous.":
        "Signed out after 7 days without opening the app. Please sign in again.",
    "Lien de connexion invalide : relancez la connexion depuis l'app.": "Invalid sign-in link. Start signing in again from the app.",
    "Trop de tentatives : réessayez plus tard.": "Too many attempts. Try again later.",
    "Code de connexion invalide ou expiré : recommencez.": "Sign-in code is invalid or expired. Start over.",
    "Pas encore autorisé.": "Not authorized yet.",
    "Compte désactivé.": "Account disabled.",
    "Appareil introuvable": "Device not found",
    "Jeton de notifications invalide": "Invalid notification token",
    "Adresse d'autorisation non acceptée": "Authorization address not accepted",
    "Acceptez les conditions pour continuer.": "Accept the terms to continue.",
    "Prénom et nom obligatoires.": "First and last name are required.",
    "Date de naissance invalide.": "Invalid date of birth.",
    "La date de naissance ne se modifie pas ici : contactez-nous en cas d'erreur.":
        "Date of birth can't be changed here. Contact us if it's wrong.",
    "Réservé à l'administration.": "Admins only.",
    "Réponse non reconnue": "Unrecognized response",
    "Réponse vide": "Empty response",
    "Formulaire indisponible": "Form unavailable",
    "Trop d’envois. Réessayez dans une heure.": "Too many submissions. Try again in an hour.",
    "Adresse e-mail incomplète (ex. vous@exemple.fr).": "Incomplete email address (e.g. you@example.com).",
    "Écrivez votre message.": "Write your message.",
    "Vérification anti-robot échouée. Réessayez.": "Bot check failed. Please try again.",

    # ---- routers/cm_account_requests.py
    "Demande introuvable": "Request not found",
    "Cette demande n'est plus en attente.": "This request is no longer pending.",
    "Trop de demandes : réessayez dans une heure.": "Too many requests. Try again in an hour.",
    "Demande envoyée : l'espace actuel du compte a 7 jours pour répondre. Vous serez prévenu ici.":
        "Request sent: the account's current space has 7 days to respond. You'll be notified here.",
    "La personne n'a plus accès à l'espace d'arrivée : demande annulée.":
        "That person no longer has access to the destination space: request canceled.",
    "Réclamation déjà envoyée : le support vous répond par e-mail.": "Claim already sent: support will reply by email.",
    "Réclamation possible après un refus, ou sans réponse au bout de 3 jours.":
        "You can file a claim after a refusal, or if there's no response after 3 days.",
    "Réclamation envoyée au support de Chapote : réponse par e-mail sous 5 jours ouvrés.":
        "Claim sent to Chapote support: you'll get an email reply within 5 business days.",

    # ---- routers/cm_inbox.py
    "Relecture déjà demandée récemment : réessayez dans quelques minutes.":
        "A refresh was requested recently. Try again in a few minutes.",
    "Commentaire introuvable": "Comment not found",
    "Écrivez la réponse.": "Write the reply.",
    "Beaucoup de réponses d'un coup : réessayez dans un moment.": "Lots of replies at once. Try again in a moment.",
    "Beaucoup de messages d'un coup : réessayez dans un moment.": "Lots of messages at once. Try again in a moment.",
    "Instagram n'autorise une réponse que dans les 24 h qui suivent le dernier message de la personne.":
        "Instagram only allows a reply within 24 h of the person's last message.",
    "Compte Instagram inconnu dans cet espace.": "Unknown Instagram account in this space.",
    "Échec côté routine": "Failed on the routine side",

    # ---- routers/cm_invite_links.py
    "Trop de liens créés : réessayez dans une heure.": "Too many links created. Try again in an hour.",
    "Lien d'invitation invalide ou expiré : demandez-en un nouveau.": "Invitation link is invalid or expired. Ask for a new one.",

    # ---- routers/cm_passkey.py, cm_biometric.py
    "origine de l'app non reconnue ({})": "app origin not recognized ({})",
    "Délai dépassé : recommencez l'activation.": "Timed out. Start the setup again.",
    "Empreinte non vérifiée : {}.": "Fingerprint not verified: {}.",
    "Cette clé est déjà enregistrée.": "This key is already registered.",
    "Téléphone": "Phone",
    "Aucune empreinte enregistrée pour ce compte.": "No fingerprint registered for this account.",
    "Délai dépassé : réessayez.": "Timed out. Please try again.",
    "Clé inconnue pour ce compte.": "Unknown key for this account.",
    "Trop de téléphones : retirez-en un dans Réglages → Sécurité.": "Too many phones. Remove one in Settings → Security.",
    "Empreinte introuvable.": "Fingerprint not found.",
    "Empreinte non reconnue pour ce compte : réactivez-la dans Réglages.":
        "Fingerprint not recognized for this account. Turn it on again in Settings.",

    # ---- routers/cm_assistant.py
    "Assistant IA indisponible": "AI assistant unavailable",
    "L'assistant IA sur vos données est réservé aux personnes de {} ans et plus.":
        "The AI assistant on your data is only for people aged {} and over.",
    "Assistant IA indisponible pour le moment.": "AI assistant unavailable right now.",
    "Seul le possesseur du compte (administrateur de l'espace) règle ce qui peut être envoyé à l'IA.":
        "Only the account owner (space admin) controls what can be sent to the AI.",

    # ---- routers/auth.py
    "Trop de tentatives, réessayez dans quelques minutes": "Too many attempts, try again in a few minutes",
    "Un compte existe déjà avec cet email": "An account already exists with this email",
    "Mot de passe trop court ({} caractères minimum)": "Password too short ({} characters minimum)",
    "Nom d'entreprise requis": "Company name required",
    "Compte désactivé": "Account disabled",
    "Admin dev non initialisé": "Dev admin not initialized",
    "Nom requis": "Name required",
    "Compte géré par Google : la connexion passe par Google, sans mot de passe local":
        "Account managed by Google: sign in with Google, there's no local password",
    "Mot de passe actuel incorrect": "Current password is incorrect",
    "Lien de confirmation invalide ou expiré": "Confirmation link is invalid or expired",
    "Si un compte existe pour cette adresse, un e-mail vient d'être envoyé.":
        "If an account exists for this address, an email has just been sent.",
    "Lien de réinitialisation invalide ou expiré": "Reset link is invalid or expired",

    # ---- routers/twofa.py
    "Utilisateur introuvable": "User not found",
    "Challenge 2FA déjà utilisé ou expiré.": "2FA challenge already used or expired.",
    "TOTP déjà activé — désactivez-le d'abord pour le régénérer.": "TOTP already enabled. Turn it off first to regenerate it.",
    "Aucun enrôlement TOTP en cours — relancez la configuration.": "No TOTP setup in progress. Start the setup again.",
    "Code invalide. Réessayez.": "Invalid code. Please try again.",
    "TOTP non activé.": "TOTP not enabled.",
    "Code invalide.": "Invalid code.",
    "Code TOTP invalide.": "Invalid TOTP code.",
    "Cérémonie expirée — relancez l'ajout de la passkey.": "Request expired. Start adding the passkey again.",
    "Passkey invalide ou non vérifiable.": "Passkey invalid or can't be verified.",
    "Cette passkey est déjà enregistrée.": "This passkey is already registered.",
    "Passkey introuvable.": "Passkey not found.",
    "Code de secours invalide.": "Invalid backup code.",
    "Aucune passkey enregistrée.": "No passkey registered.",
    "Cérémonie expirée — réessayez.": "Request expired. Please try again.",
    "Passkey inconnue.": "Unknown passkey.",
    "Vérification de la passkey échouée.": "Passkey verification failed.",

    # ---- routers/tiktok.py
    "Jeton de service TikTok non configuré": "TikTok service token not configured",
    "Jeton de service TikTok mal configuré": "TikTok service token misconfigured",
    "Organisation introuvable": "Organization not found",
    "Compte TikTok introuvable": "TikTok account not found",
    "Le module TikTok n'est pas disponible pour le moment.": "The TikTok module isn't available right now.",
    "L'autorisation TikTok de ce compte a expiré ou a été révoquée : reconnectez-le.":
        "This account's TikTok authorization expired or was revoked. Reconnect it.",
    "Trop de tentatives de connexion TikTok. Réessayez dans une heure.": "Too many TikTok connection attempts. Try again in an hour.",
    "Lien de connexion TikTok invalide ou expiré : relancez « Se connecter avec TikTok » depuis l'Espace client.":
        "TikTok connection link is invalid or expired. Start “Continue with TikTok” again from the Client area.",
    "Réponse TikTok incomplète : réessayez.": "Incomplete response from TikTok. Please try again.",
    "Seul le membre qui a connecté ce compte ou un administrateur de l'équipe peut le déconnecter.":
        "Only the member who connected this account or a team admin can disconnect it.",
    "L'autorisation avait déjà expiré côté TikTok : jetons supprimés de Chapote.":
        "The authorization had already expired on TikTok: tokens deleted from Chapote.",
    "La révocation chez TikTok a échoué : jetons supprimés de Chapote. Vous pouvez aussi retirer l'accès depuis l'app TikTok (Paramètres > Sécurité > Applications).":
        "Revoking on TikTok failed: tokens deleted from Chapote. You can also remove access in the TikTok app (Settings > Security > Apps).",
    "Ce compte TikTok doit être reconnecté.": "This TikTok account must be reconnected.",
    "Choisissez qui peut voir cette vidéo.": "Choose who can see this video.",
    "La visibilité d'un contenu de marque ne peut pas être privée.": "Branded content can't be private.",
    "Titre trop long ({} caractères maximum).": "Title too long ({} characters max).",
    "Des publications sont déjà en cours d'envoi : attendez qu'elles se terminent.":
        "Posts are already uploading. Wait for them to finish.",
    "Limite quotidienne de publications atteinte pour votre espace. Réessayez demain.":
        "Daily post limit reached for your space. Try again tomorrow.",
    "Envoi impossible pour le moment (capacité temporairement atteinte). Réessayez plus tard.":
        "Can't upload right now (capacity temporarily reached). Try again later.",
    "Cette publication a déjà été envoyée.": "This post has already been sent.",
    "Format non pris en charge (MP4, MOV ou WebM).": "Unsupported format (MP4, MOV or WebM).",
    "Ce compte TikTok a été déconnecté.": "This TikTok account was disconnected.",
    "Vidéo trop longue : {} s pour {} s maximum sur ce compte.": "Video too long: {} s, {} s max on this account.",
    "Cette publication ne peut plus être annulée.": "This post can no longer be canceled.",

    # ---- routers/youtube.py
    "Jeton de service YouTube non configuré": "YouTube service token not configured",
    "Jeton de service YouTube mal configuré": "YouTube service token misconfigured",
    "Chaîne YouTube introuvable": "YouTube channel not found",
    "Le module YouTube n'est pas disponible pour le moment.": "The YouTube module isn't available right now.",
    "Trop de tentatives de connexion YouTube. Réessayez dans une heure.": "Too many YouTube connection attempts. Try again in an hour.",
    "Lien de connexion YouTube invalide ou expiré : relancez « Se connecter avec Google » depuis l'Espace client.":
        "YouTube connection link is invalid or expired. Start “Sign in with Google” again from the Client area.",
    "Réponse Google incomplète : réessayez.": "Incomplete response from Google. Please try again.",
    "Google n'a pas fourni d'accès durable : réessayez.": "Google didn't grant lasting access. Please try again.",
    "Seul le membre qui a connecté cette chaîne ou un administrateur de l'équipe peut la déconnecter.":
        "Only the member who connected this channel or a team admin can disconnect it.",
    "La révocation chez Google a échoué : jetons supprimés de Chapote. Vous pouvez aussi retirer l'accès sur myaccount.google.com/connections.":
        "Revoking on Google failed: tokens deleted from Chapote. You can also remove access at myaccount.google.com/connections.",
    "Cette chaîne YouTube doit être reconnectée.": "This YouTube channel must be reconnected.",
    "La mise en ligne programmée doit être entre 5 minutes et 6 mois à l'avance.":
        "Scheduled publishing must be between 5 minutes and 6 months ahead.",
    "Limite quotidienne de vidéos YouTube atteinte pour votre espace. Réessayez demain.":
        "Daily YouTube video limit reached for your space. Try again tomorrow.",
    "Vidéo trop longue pour un Short : {} s pour {} s maximum.": "Video too long for a Short: {} s, {} s max.",
    "Cette chaîne YouTube a été déconnectée.": "This YouTube channel was disconnected.",
}
