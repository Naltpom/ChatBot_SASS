# Politique de confidentialité – Module de publication YouTube (Chapote Publisher)

Dernière mise à jour : 24 novembre 2026.

La présente politique décrit comment le module de publication YouTube de Chapote (**Chapote Publisher**), utilisé depuis l'Espace client et depuis **Chapote CM** ([cm.chapote.fr](https://cm.chapote.fr), gestion des réseaux sociaux), traite les données obtenues auprès de Google et de YouTube, conformément au **RGPD** (Règlement (UE) 2016/679) et à la loi Informatique et Libertés. Elle complète la [Politique de confidentialité de Chapote](/legal/confidentialite).

**Chapote Publisher utilise les services d'API de YouTube (YouTube API Services).** En connectant une chaîne, vous acceptez aussi les [Conditions d'utilisation de YouTube](https://www.youtube.com/t/terms), et les données sont également traitées selon les [Règles de confidentialité de Google](https://policies.google.com/privacy).

## 1. Responsable de traitement

- Éditeur : **Nathan Provost**, personne physique, éditeur du service Chapote ([chapote.fr](https://chapote.fr)).
- Contact : [hello@chapote.fr](mailto:hello@chapote.fr).

## 2. Objet du module

Chapote Publisher est un module de l'Espace client de Chapote. Il permet aux clients de Chapote de connecter leurs propres chaînes YouTube et d'y publier leurs propres vidéos courtes (Shorts). Il utilise la connexion Google (OAuth 2.0) et l'**API YouTube Data v3**, avec les autorisations suivantes :

- `https://www.googleapis.com/auth/youtube.upload` : envoyer des vidéos sur la chaîne ;
- `https://www.googleapis.com/auth/youtube.readonly` : lire le nom, l'identifiant et l'image de la chaîne connectée, l'état de traitement des vidéos envoyées par Chapote et, dans Chapote CM, les **chiffres publics** de la chaîne (vues, abonnés, nombre de vidéos) et de ses vidéos récentes (titre, date, durée, miniature, vues, j'aime, commentaires).

## 3. Données traitées

- **Informations de la chaîne** : identifiant de chaîne, nom, pseudo (@), image de la chaîne.
- **Jetons d'accès et d'actualisation OAuth** délivrés par Google, **stockés chiffrés** dans notre base de données. Ils ne sont jamais affichés dans l'interface ni transmis au navigateur.
- **Vidéos** que le client choisit de publier : conservées **uniquement le temps de leur publication**, puis supprimées (durées à la section 7).
- **Métadonnées et historique des publications** : chaîne utilisée, membre de l'équipe à l'origine de la publication, titre, description, mots-clés, catégorie, langue, réglages choisis (visibilité, date de mise en ligne, contenu « conçu pour les enfants », contenu modifié ou synthétique), nom et taille du fichier, identifiant et état de traitement de la vidéo renvoyés par YouTube, dates.

- **Chiffres** (Chapote CM) : vues, abonnés et nombre de vidéos de la chaîne, relevés au plus toutes les quelques heures ; pour les 50 vidéos les plus récentes, titre, date, durée, miniature, vues, j'aime et nombre de commentaires.

Aucune autre donnée n'est collectée : pas de lecture de la liste des abonnés, des statistiques privées de YouTube Analytics ni des messages, ni d'accès à d'autres services Google (Gmail, Drive…). Le texte des commentaires n'est lu que dans le cadre de la boîte de réception décrite ci-dessous, **fonction facultative activée seulement après la vérification de Google**.

- **Boîte de réception (Chapote CM, facultative)** : commentaires des vidéos récentes de la chaîne (30 jours) — identifiant, texte, nom et identifiant de chaîne de l'auteur, date, nombre de j'aime — pour que le client les lise et y réponde depuis un seul écran. Répondre ou masquer un commentaire demande l'autorisation `https://www.googleapis.com/auth/youtube.force-ssl`, accordée par le titulaire de la chaîne. Ces données sont supprimées à la déconnexion de la chaîne et au plus tard 12 mois après leur relevé.

## 4. Utilisation limitée (Google API Services User Data Policy)

L'utilisation et le transfert à toute autre application des informations reçues des API Google respectent la [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), y compris les exigences d'utilisation limitée (*Limited Use requirements*). En particulier :

- ces données servent **uniquement** aux fonctions du module décrites ci-dessous, visibles par le client ;
- elles ne sont **ni vendues, ni louées, ni utilisées à des fins publicitaires, de profilage ou d'entraînement de modèles d'intelligence artificielle** ;
- aucune personne n'y a accès, sauf avec l'accord exprès du client, pour la sécurité (enquête sur un abus), ou pour respecter la loi.

## 5. Finalités et base légale

Ces données servent **uniquement** à :

- connecter la chaîne YouTube du client à son espace Chapote et maintenir cette connexion (rafraîchissement des jetons) ;
- envoyer à YouTube les vidéos que le client a choisi de publier, avec les réglages qu'il a choisis ;
- afficher au client le statut et l'historique de ses publications, son planning, et les chiffres de sa chaîne et de ses vidéos (Chapote CM).

La base légale est **l'exécution du contrat** conclu entre Chapote et son client (article 6.1.b du RGPD), le module faisant partie du service fourni, ainsi que l'autorisation donnée par le titulaire de la chaîne via Google. Les données ne sont partagées qu'avec **Google / YouTube**, destinataire nécessaire des publications.

## 6. Hébergement et protection des données

- **Hébergement** : **OVH SAS** (2 rue Kellermann, 59100 Roubaix), serveurs situés **en France**.

Ces mesures protègent les données obtenues via les API Google et YouTube (jetons OAuth, informations de la chaîne, vidéos, métadonnées, chiffres et commentaires) :

- **Chiffrement en transit** : chapote.fr, l'Espace client et Chapote CM ne fonctionnent qu'en HTTPS (TLS). Une adresse en HTTP est redirigée vers HTTPS, et le navigateur est tenu de toujours utiliser HTTPS (HSTS). Nos serveurs appellent l'API YouTube Data v3 et les serveurs OAuth de Google uniquement en HTTPS.
- **Chiffrement au repos** : les jetons OAuth (accès et actualisation) sont chiffrés en base de données (chiffrement symétrique authentifié). La clé de chiffrement est conservée hors de la base et hors du code. Les jetons ne sont jamais affichés, jamais envoyés au navigateur et jamais écrits dans les journaux.
- **Contrôle d'accès** : une chaîne connectée n'est accessible qu'aux membres de l'espace du client (espace personnel ou équipe), selon leur rôle ; chaque demande est vérifiée par le serveur. Seul un administrateur de l'espace peut connecter une chaîne, et seuls le membre qui l'a connectée ou un administrateur peuvent la déconnecter. Les comptes d'administration du service Chapote sont protégés par une double authentification obligatoire (application d'authentification ou clé d'accès).
- **Cloisonnement** : les vidéos sont stockées dans un espace temporaire du serveur, jamais publié sur Internet. La base de données n'est pas exposée sur Internet : seule l'application y accède.
- **Journaux** : les jetons OAuth et le contenu des vidéos ne sont jamais écrits dans les journaux. Les journaux d'accès de l'application et de ses serveurs web n'enregistrent aucun paramètre d'adresse (codes d'autorisation OAuth, liens signés). Seule exception : si l'application est momentanément injoignable (par exemple pendant une mise à jour), le journal d'erreurs du serveur web peut noter l'adresse complète d'une requête. Ces journaux sont conservés 14 jours au plus, et un code d'autorisation OAuth ne sert qu'une fois et expire rapidement.
- **Minimisation** : seules les autorisations nécessaires sont demandées : `https://www.googleapis.com/auth/youtube.upload` et `https://www.googleapis.com/auth/youtube.readonly`. L'autorisation `https://www.googleapis.com/auth/youtube.force-ssl` n'est demandée que pour la boîte de réception, une fois celle-ci activée (section 3). Les données ne sont conservées que pendant les durées de la section 7.
- **Violation de données** : en cas de violation de données à caractère personnel, l'éditeur notifie la CNIL dans les 72 heures et informe les personnes concernées lorsque la loi l'exige (articles 33 et 34 du RGPD).

## 7. Durées de conservation

- **Jetons OAuth** : tant que la chaîne est connectée ; supprimés **immédiatement** à la déconnexion depuis Chapote, et **sous 7 jours** si l'accès est retiré depuis le compte Google.
- **Vidéos** : depuis l'Espace client, supprimées dès la fin de l'envoi à YouTube (réussi ou non) ; un envoi vers Chapote abandonné est supprimé sous 2 heures, un envoi vers YouTube interrompu sous 3 heures. Depuis Chapote CM, où une même vidéo peut partir sur plusieurs réseaux, elle est supprimée dès la fin de toutes ses publications (48 heures de plus en cas d'échec, pour pouvoir réessayer), et gardée 7 jours au plus en attendant son rangement dans le Google Drive du client.
- **Historique des publications** et informations de la chaîne : **12 mois** après la publication, puis supprimés.
- **Informations de la chaîne** : actualisées au moins tous les 30 jours tant que la chaîne est connectée.
- **Chiffres** (Chapote CM) : actualisés au plus tard tous les 30 jours tant que la chaîne est connectée ; supprimés dès que la chaîne est déconnectée.
- La suppression du compte Chapote ou de l'équipe entraîne la suppression des chaînes connectées et de l'historique associé.

## 8. Révocation de l'accès

L'accès de Chapote à une chaîne peut être retiré à tout moment :

- **depuis Chapote** : Espace client → YouTube → « Déconnecter ». L'autorisation est révoquée auprès de Google et les jetons sont supprimés de Chapote ;
- **depuis votre compte Google** : page [Applications tierces ayant accès à votre compte](https://myaccount.google.com/permissions) → Chapote → Supprimer l'accès. Chapote cesse alors de pouvoir publier et la chaîne apparaît « À reconnecter » ; ses jetons sont supprimés de Chapote **sous 7 jours**.

## 9. Suppression des données sur demande

Vous pouvez demander la suppression de toutes les données liées à vos chaînes YouTube (y compris l'historique des publications) en écrivant à [hello@chapote.fr](mailto:hello@chapote.fr). La suppression est effectuée **sous 7 jours**.

## 10. Vos droits

Conformément au RGPD, vous disposez d'un droit d'**accès**, de **rectification**, d'**effacement**, de **limitation**, de **portabilité** et d'**opposition** sur les données vous concernant. Pour les exercer, écrivez à [hello@chapote.fr](mailto:hello@chapote.fr). Vous pouvez également introduire une réclamation auprès de la **CNIL** ([www.cnil.fr](https://www.cnil.fr)).

Voir aussi les [Conditions d'utilisation du module YouTube](/legal/youtube-cgu).
