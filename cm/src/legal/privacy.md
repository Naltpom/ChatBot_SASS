# Politique de confidentialité – Chapote CM (cm.chapote.fr)

Dernière mise à jour : 24 novembre 2026.

Chapote CM ([cm.chapote.fr](https://cm.chapote.fr)) est l'outil de gestion des réseaux sociaux de Chapote : programmer et publier ses vidéos sur TikTok, YouTube et Instagram, suivre leurs statistiques et leurs commentaires, et archiver ses contenus dans son propre Google Drive. Il partage le compte et l'infrastructure de [chapote.fr](https://chapote.fr). Cette politique décrit les données traitées par Chapote CM, conformément au **RGPD** (Règlement (UE) 2016/679) et à la loi Informatique et Libertés.

## 1. Responsable du traitement

- **Nathan Provost**, personne physique, éditeur du service sous la marque Chapote (pas encore de société).
- Contact : [nathan.provost78990@gmail.com](mailto:nathan.provost78990@gmail.com).

## 2. Données collectées

- **Compte** : nom, adresse e-mail, mot de passe (stocké haché), espace et équipe, rôle des membres.
- **Comptes de réseaux sociaux connectés** (TikTok, YouTube, Instagram) : identifiant, nom, pseudo, image ; **jetons OAuth** délivrés par chaque plateforme.
- **Connexion Google Drive** (nécessaire pour publier) : adresse e-mail du compte Google connecté, **jeton OAuth** d'actualisation, identifiants des dossiers et fichiers créés par Chapote CM.
- **Contenus publiés** : vidéos, couvertures, titres, légendes, hashtags, réglages de publication, dates prévues, liens et identifiants des publications renvoyés par les plateformes, historique.
- **Statistiques et commentaires** des publications des comptes connectés, lorsque la plateforme le permet.
- **Données techniques** : journaux de connexion et d'erreurs (sans jeton ni mot de passe).

## 3. Finalités et base légale

Ces données servent **uniquement** à fournir le service demandé par l'utilisateur : se connecter, relier ses comptes, programmer et publier ses contenus, afficher leur suivi (statut, statistiques, commentaires) et archiver ses contenus dans son Drive.

Base légale : **exécution du contrat** (article 6.1.b du RGPD) conclu avec l'utilisateur, et l'autorisation qu'il donne lui-même à chaque plateforme (TikTok, Google, Meta) lors de la connexion. Les journaux techniques reposent sur l'**intérêt légitime** (sécurité du service, article 6.1.f).

## 4. Google Drive

La connexion Google Drive est **nécessaire pour publier** : les vidéos sont stockées dans le Drive du propriétaire des comptes, pas chez nous. Elle utilise uniquement l'autorisation `https://www.googleapis.com/auth/drive.file`.

- **Accès limité** : Chapote CM n'accède **qu'aux fichiers et dossiers qu'il a lui-même créés ou que vous avez ouverts avec lui**. Il ne voit pas le reste de votre Drive.
- **Usage** : **archiver vos propres contenus dans votre propre Drive**. Chapote CM crée le dossier « cm.chapote.fr » à la racine de votre Drive et y range, pour chaque publication, la vidéo, la légende, la couverture et un fichier `infos.json` (titre, date, statut et liens de la publication). Ces fichiers peuvent être relus par Chapote CM pour retenter une publication qui a échoué.
- **Aucune revente, aucun partage avec des tiers**, aucun usage publicitaire ou de profilage, et **aucun usage pour entraîner des modèles d'intelligence artificielle**.
- Aucune personne n'accède à ces données, sauf avec votre accord exprès, pour la sécurité (enquête sur un abus) ou pour respecter la loi.

L'utilisation et le transfert vers toute autre application des informations reçues des API Google par cm.chapote.fr respecteront le [Règlement sur les données utilisateur des services d'API Google](https://developers.google.com/terms/api-services-user-data-policy), y compris les exigences d'utilisation limitée.

## 5. Destinataires

Les données ne sont transmises qu'aux plateformes nécessaires à ce que l'utilisateur demande : **TikTok**, **Google / YouTube** et **Meta / Instagram** pour les publications, et **Google Drive** pour l'archivage. Aucune donnée n'est vendue ni louée.

## 6. Hébergement et protection des données

- **Hébergement** : **OVH SAS** (2 rue Kellermann, 59100 Roubaix), serveurs situés **en France**.

Ces mesures protègent toutes vos données, y compris celles obtenues via les API Google (jeton OAuth Google Drive, adresse e-mail du compte Google connecté, identifiants des dossiers et fichiers Drive créés par Chapote CM) :

- **Chiffrement en transit** : le site et l'application mobile n'échangent avec nos serveurs qu'en HTTPS (TLS) ; le navigateur est tenu de toujours utiliser HTTPS (HSTS) et le cookie de session n'est envoyé qu'en HTTPS. Nos serveurs appellent les API de Google, TikTok et Meta uniquement en HTTPS.
- **Chiffrement au repos** : les jetons OAuth (Google Drive, TikTok, YouTube, Instagram) sont chiffrés en base de données (chiffrement symétrique authentifié). La clé de chiffrement est conservée hors de la base et hors du code. Les jetons ne sont jamais affichés, jamais transmis au navigateur ni à l'application mobile, et jamais écrits dans les journaux.
- **Mots de passe** : stockés uniquement sous forme hachée et salée (bcrypt), jamais en clair.
- **Contrôle d'accès** : chaque demande est vérifiée par le serveur. Un utilisateur n'accède qu'à ses propres comptes et aux groupes de comptes qu'on lui a partagés, selon le rôle donné (Admin, Peut publier, Lecture seule). L'administration du service par l'éditeur exige une double authentification (application d'authentification ou clé d'accès).
- **Cloisonnement** : les vidéos et couvertures envoyées sont stockées dans un dossier privé du serveur, jamais publié sur Internet. Elles ne sont lues que par les utilisateurs autorisés, ou par la plateforme qui publie la vidéo, grâce à un lien signé valable 2 heures. La base de données n'est pas exposée sur Internet : seule l'application y accède.
- **Journaux** : les journaux techniques ne contiennent ni jeton, ni mot de passe, ni contenu de vos fichiers. Les paramètres d'adresse (codes OAuth, liens signés) sont retirés ou masqués avant l'écriture.
- **Minimisation** : Chapote CM ne demande que les autorisations nécessaires au service. Pour Google Drive, uniquement `https://www.googleapis.com/auth/drive.file`. Les données ne sont conservées que pendant les durées de la section 7.
- **Incident** : en cas de violation de données à caractère personnel, l'éditeur notifie la CNIL dans les 72 heures et informe les personnes concernées lorsque la loi l'exige (articles 33 et 34 du RGPD).

Les données obtenues via les API Google ne sont **jamais vendues**, ni utilisées pour la publicité ou le profilage, ni pour **entraîner des modèles d'intelligence artificielle ou d'apprentissage automatique**. Elles sont utilisées conformément au [Règlement sur les données utilisateur des services d'API Google](https://developers.google.com/terms/api-services-user-data-policy), y compris les exigences d'utilisation limitée.

## 7. Durées de conservation

- **Jetons OAuth** (réseaux sociaux et Google Drive) : tant que le compte ou le Drive est connecté ; supprimés **immédiatement** à la déconnexion depuis Chapote CM, et dès que l'accès retiré depuis la plateforme est constaté.
- **Vidéos et couvertures** sur nos serveurs : jusqu'à la fin de toutes leurs publications (48 heures de plus en cas d'échec, pour pouvoir réessayer), et 7 jours au plus en attendant leur archivage dans votre Drive. Les fichiers archivés dans votre Drive vous appartiennent et y restent : vous les gérez vous-même.
- **Historique des publications** : 12 mois.
- **Commentaires relevés** : 12 mois au plus ; supprimés dès la déconnexion du compte concerné.
- **Compte** : jusqu'à sa suppression ; l'ensemble des données associées est alors supprimé.

## 8. Révoquer l'accès et supprimer ses données

- **Google Drive** : dans Chapote CM, Bibliothèque → « Stockage » → **« Retirer »** : le jeton est supprimé, et l'autorisation est révoquée auprès de Google dès qu'aucun autre stockage de votre espace n'utilise ce compte Google. Vous pouvez aussi retirer l'accès depuis votre compte Google : [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Les fichiers déjà archivés restent dans votre Drive.
- **Réseaux sociaux** : page Comptes → « Déconnecter », ou depuis les réglages de la plateforme.
- **Suppression de toutes vos données** : écrivez à [nathan.provost78990@gmail.com](mailto:nathan.provost78990@gmail.com). La suppression est faite **sous 7 jours**.

## 9. Vos droits

Vous disposez d'un droit d'**accès**, de **rectification**, d'**effacement**, de **limitation**, de **portabilité** et d'**opposition** sur vos données. Pour les exercer : [nathan.provost78990@gmail.com](mailto:nathan.provost78990@gmail.com). Vous pouvez aussi adresser une réclamation à la **CNIL** ([www.cnil.fr](https://www.cnil.fr)).

Voir aussi les [Conditions d'utilisation](/terms).
