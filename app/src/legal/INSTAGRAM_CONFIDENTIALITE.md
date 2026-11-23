# Politique de confidentialité – Publication Instagram (Chapote CM)

Dernière mise à jour : 23 novembre 2026.

La présente politique décrit comment **Chapote CM** ([cm.chapote.fr](https://cm.chapote.fr)), l'outil de gestion des réseaux sociaux de Chapote, traite les données obtenues auprès d'Instagram (Meta), conformément au **RGPD** (Règlement (UE) 2016/679) et à la loi Informatique et Libertés. Elle complète la [Politique de confidentialité de Chapote](/legal/confidentialite).

La connexion à Instagram passe par l'application Meta **« Kiwi Signal Publisher »**, éditée par l'éditeur de Chapote pour ce service. En connectant un compte, vous acceptez aussi les [Conditions d'utilisation d'Instagram](https://help.instagram.com/581066165581870), et les données sont également traitées selon la [Politique de confidentialité de Meta](https://privacycenter.instagram.com/policy).

## 1. Responsable de traitement

- Éditeur : **Nathan Provost**, personne physique, éditeur du service Chapote ([chapote.fr](https://chapote.fr)).
- Contact : [hello@chapote.fr](mailto:hello@chapote.fr).

## 2. Objet

Chapote CM permet aux clients de Chapote de connecter leurs propres comptes Instagram **professionnels** (Créateur ou Entreprise), d'y publier leurs propres vidéos (Reels), immédiatement ou à une heure programmée, et de suivre les chiffres de leurs comptes et de leurs vidéos. Il utilise la connexion Instagram (Instagram Login) et l'**API Instagram**, avec les autorisations suivantes :

- `instagram_business_basic` : lire l'identifiant, le nom d'utilisateur, le nom, l'image de profil, le type de compte, le nombre d'abonnés et de publications, et la liste des publications récentes avec leurs j'aime et commentaires ;
- `instagram_business_content_publish` : publier les Reels que le client a choisi de publier ;
- `instagram_business_manage_insights` : lire les statistiques des publications (vues, partages, enregistrements, portée).

## 3. Données traitées

- **Informations du compte** : identifiant Instagram, nom d'utilisateur, nom, image de profil, type de compte.
- **Jeton d'accès** délivré par Instagram, **stocké chiffré** dans notre base de données. Il n'est jamais affiché dans l'interface ni transmis au navigateur.
- **Vidéos** que le client choisit de publier : conservées **uniquement jusqu'à leur publication**. Pour publier un Reel, Instagram télécharge la vidéo depuis Chapote par un **lien privé, signé et valable 2 heures**, utilisable seulement pendant la publication.
- **Métadonnées et historique des publications** : compte utilisé, membre de l'équipe à l'origine de la publication, légende, heure programmée, réglages choisis, identifiant et lien de la publication renvoyés par Instagram, dates.
- **Chiffres** : nombre d'abonnés et de publications du compte ; pour les publications récentes, vues, j'aime, commentaires, partages et enregistrements. Un relevé est fait au plus toutes les quelques heures.

Aucune autre donnée n'est collectée : pas de données des abonnés, ni d'accès à Facebook ou à d'autres services Meta. Les commentaires et messages privés ne sont traités que dans le cadre de la boîte de réception décrite ci-dessous, **seulement si le titulaire du compte accorde les autorisations correspondantes**.

## 3 bis. Boîte de réception (commentaires et messages) — fonction facultative

Quand le client l'active en accordant les autorisations `instagram_business_manage_comments` et/ou `instagram_business_manage_messages` (ou en transmettant lui-même les commentaires de ses comptes depuis son propre outil de publication), Chapote CM permet de répondre aux commentaires de ses propres publications et aux messages reçus par son compte, depuis un seul écran :

- **Commentaires** de ses publications récentes (30 jours) : identifiant, texte, nom d'utilisateur et identifiant de l'auteur, date, nombre de j'aime, réponses ; et les actions du client (réponse publique, masquage, réponse privée à un commentaire).
- **Messages privés** : lus à la demande dans Instagram pour être affichés au client, **non conservés** par Chapote ; un message n'est envoyé qu'à l'initiative du client, dans la fenêtre de 24 heures prévue par Instagram.
- Chapote ne lit pas la liste des personnes qui aiment un commentaire (Instagram ne la fournit pas) et n'envoie **aucun message automatique** à des personnes qui n'ont pas écrit au compte.

Ces données servent uniquement à afficher et traiter ces échanges pour le client ; elles sont supprimées à la déconnexion du compte et au plus tard **12 mois** après leur relevé.

## 4. Finalités et base légale

Ces données servent **uniquement** à :

- connecter le compte Instagram du client à son espace Chapote et maintenir cette connexion (renouvellement du jeton) ;
- publier les vidéos que le client a choisi de publier, avec la légende et les réglages qu'il a choisis, à l'heure qu'il a choisie ;
- afficher au client le planning, le statut et l'historique de ses publications, et les chiffres de ses comptes et de ses vidéos.

La base légale est **l'exécution du contrat** conclu entre Chapote et son client (article 6.1.b du RGPD), ainsi que l'autorisation donnée par le titulaire du compte via Instagram. Les données ne sont **ni vendues, ni louées, ni utilisées à des fins publicitaires, de profilage ou d'entraînement de modèles d'intelligence artificielle**. Elles ne sont partagées qu'avec **Meta / Instagram**, destinataire nécessaire des publications.

## 5. Hébergement et sécurité

- Les données sont hébergées sur des **serveurs situés en France**.
- Le jeton est chiffré au repos ; il ne sort jamais du serveur et ne figure pas dans les journaux.
- Les comptes connectés par un client ne sont accessibles qu'aux membres de son espace (espace personnel ou équipe).
- Les vidéos sont stockées dans un espace privé, jamais accessible publiquement en dehors du lien signé décrit plus haut.

## 6. Durées de conservation

- **Jeton** : tant que le compte est connecté ; supprimé **immédiatement** à la déconnexion.
- **Vidéos** : supprimées dès que leurs publications sont terminées ; après un échec, gardées au plus **48 heures** pour permettre un nouvel essai ; un envoi abandonné est supprimé sous 2 heures.
- **Chiffres et liste des vidéos** : supprimés dès que le compte est déconnecté.
- **Commentaires** (boîte de réception) : supprimés dès que le compte est déconnecté, et au plus tard 12 mois après leur relevé ; **messages privés** : non conservés.
- **Historique des publications** : **12 mois**, puis supprimé.
- La suppression du compte Chapote ou de l'équipe entraîne la suppression des comptes connectés et des données associées.

## 7. Retrait de l'accès

L'accès de Chapote à un compte peut être retiré à tout moment :

- **depuis Chapote CM** : Comptes → Instagram → « Retirer ». Le jeton est supprimé de Chapote et les publications à venir sur ce compte sont annulées ;
- **depuis Instagram** : Paramètres → Applications et sites web → « Kiwi Signal Publisher » → Supprimer. Meta prévient Chapote, qui supprime le jeton du compte.

## 8. Suppression des données

Vous pouvez demander la suppression de toutes les données liées à vos comptes Instagram (jeton, chiffres, liste des vidéos, historique des publications) :

- **depuis Instagram** : en retirant l'accès (Paramètres → Applications et sites web) puis en demandant la suppression de vos données ; Chapote reçoit la demande de Meta, supprime le jeton immédiatement et les autres données sous 24 heures ;
- **par e-mail** à [hello@chapote.fr](mailto:hello@chapote.fr), en indiquant le nom d'utilisateur Instagram concerné : suppression effectuée **sous 7 jours**, avec confirmation par e-mail.

## 9. Vos droits

Conformément au RGPD, vous disposez d'un droit d'**accès**, de **rectification**, d'**effacement**, de **limitation**, de **portabilité** et d'**opposition** sur les données vous concernant. Pour les exercer, écrivez à [hello@chapote.fr](mailto:hello@chapote.fr). Vous pouvez également introduire une réclamation auprès de la **CNIL** ([www.cnil.fr](https://www.cnil.fr)).

Voir aussi les [Conditions d'utilisation de la publication Instagram](/legal/instagram-cgu).
