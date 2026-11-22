# Politique de confidentialité – Module de publication YouTube (Chapote Publisher)

Dernière mise à jour : 22 novembre 2026.

La présente politique décrit comment le module de publication YouTube de Chapote (**Chapote Publisher**) traite les données obtenues auprès de Google et de YouTube, conformément au **RGPD** (Règlement (UE) 2016/679) et à la loi Informatique et Libertés. Elle complète la [Politique de confidentialité de Chapote](/legal/confidentialite).

**Chapote Publisher utilise les services d'API de YouTube (YouTube API Services).** En connectant une chaîne, vous acceptez aussi les [Conditions d'utilisation de YouTube](https://www.youtube.com/t/terms), et les données sont également traitées selon les [Règles de confidentialité de Google](https://policies.google.com/privacy).

## 1. Responsable de traitement

- Éditeur : **Nathan Provost**, personne physique, éditeur du service Chapote ([chapote.fr](https://chapote.fr)).
- Contact : [hello@chapote.fr](mailto:hello@chapote.fr).

## 2. Objet du module

Chapote Publisher est un module de l'Espace client de Chapote. Il permet aux clients de Chapote de connecter leurs propres chaînes YouTube et d'y publier leurs propres vidéos courtes (Shorts). Il utilise la connexion Google (OAuth 2.0) et l'**API YouTube Data v3**, avec les autorisations suivantes :

- `https://www.googleapis.com/auth/youtube.upload` : envoyer des vidéos sur la chaîne ;
- `https://www.googleapis.com/auth/youtube.readonly` : lire le nom, l'identifiant et l'image de la chaîne connectée, et l'état de traitement des vidéos envoyées par Chapote.

## 3. Données traitées

- **Informations de la chaîne** : identifiant de chaîne, nom, pseudo (@), image de la chaîne.
- **Jetons d'accès et d'actualisation OAuth** délivrés par Google, **stockés chiffrés** dans notre base de données. Ils ne sont jamais affichés dans l'interface ni transmis au navigateur.
- **Vidéos** que le client choisit de publier : conservées **uniquement le temps de leur envoi à YouTube**, puis supprimées.
- **Métadonnées et historique des publications** : chaîne utilisée, membre de l'équipe à l'origine de la publication, titre, description, mots-clés, catégorie, langue, réglages choisis (visibilité, date de mise en ligne, contenu « conçu pour les enfants », contenu modifié ou synthétique), nom et taille du fichier, identifiant et état de traitement de la vidéo renvoyés par YouTube, dates.

Aucune autre donnée n'est collectée : pas de lecture des autres vidéos de la chaîne, des abonnés, des statistiques, des messages ni des commentaires, ni d'accès à d'autres services Google (Gmail, Drive…).

## 4. Utilisation limitée (Google API Services User Data Policy)

L'utilisation et le transfert à toute autre application des informations reçues des API Google respectent la [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), y compris les exigences d'utilisation limitée (*Limited Use requirements*). En particulier :

- ces données servent **uniquement** aux fonctions du module décrites ci-dessous, visibles par le client ;
- elles ne sont **ni vendues, ni louées, ni utilisées à des fins publicitaires, de profilage ou d'entraînement de modèles d'intelligence artificielle** ;
- aucune personne n'y a accès, sauf avec l'accord exprès du client, pour la sécurité (enquête sur un abus), ou pour respecter la loi.

## 5. Finalités et base légale

Ces données servent **uniquement** à :

- connecter la chaîne YouTube du client à son espace Chapote et maintenir cette connexion (rafraîchissement des jetons) ;
- envoyer à YouTube les vidéos que le client a choisi de publier, avec les réglages qu'il a choisis ;
- afficher au client le statut et l'historique de ses publications.

La base légale est **l'exécution du contrat** conclu entre Chapote et son client (article 6.1.b du RGPD), le module faisant partie du service fourni, ainsi que l'autorisation donnée par le titulaire de la chaîne via Google. Les données ne sont partagées qu'avec **Google / YouTube**, destinataire nécessaire des publications.

## 6. Hébergement et sécurité

- Les données sont hébergées sur des **serveurs situés en France**.
- Les jetons OAuth sont chiffrés au repos ; ils ne sortent jamais du serveur et ne figurent pas dans les journaux.
- Les chaînes connectées par un client ne sont accessibles qu'aux membres de son espace (espace personnel ou équipe).
- Les vidéos sont stockées dans un espace temporaire non accessible publiquement.

## 7. Durées de conservation

- **Jetons OAuth** : tant que la chaîne est connectée ; supprimés **immédiatement** à la déconnexion.
- **Vidéos** : supprimées dès la fin de l'envoi à YouTube (réussi ou non) ; un envoi abandonné est supprimé sous 2 heures.
- **Historique des publications** et informations de la chaîne : **12 mois** après la publication, puis supprimés.
- **Informations de la chaîne** : actualisées au moins tous les 30 jours tant que la chaîne est connectée.
- La suppression du compte Chapote ou de l'équipe entraîne la suppression des chaînes connectées et de l'historique associé.

## 8. Révocation de l'accès

L'accès de Chapote Publisher à une chaîne peut être retiré à tout moment :

- **depuis Chapote** : Espace client → YouTube → « Déconnecter ». L'autorisation est révoquée auprès de Google et les jetons sont supprimés de Chapote ;
- **depuis votre compte Google** : page [Applications tierces ayant accès à votre compte](https://security.google.com/settings/security/permissions) → Chapote Publisher → Supprimer l'accès. Chapote cesse alors de pouvoir publier et la chaîne apparaît « À reconnecter ».

## 9. Suppression des données sur demande

Vous pouvez demander la suppression de toutes les données liées à vos chaînes YouTube (y compris l'historique des publications) en écrivant à [hello@chapote.fr](mailto:hello@chapote.fr). La suppression est effectuée **sous 7 jours**.

## 10. Vos droits

Conformément au RGPD, vous disposez d'un droit d'**accès**, de **rectification**, d'**effacement**, de **limitation**, de **portabilité** et d'**opposition** sur les données vous concernant. Pour les exercer, écrivez à [hello@chapote.fr](mailto:hello@chapote.fr). Vous pouvez également introduire une réclamation auprès de la **CNIL** ([www.cnil.fr](https://www.cnil.fr)).

Voir aussi les [Conditions d'utilisation du module YouTube](/legal/youtube-cgu).
