# Politique de confidentialité – Module de publication TikTok (Chapote Publisher)

Dernière mise à jour : 21 octobre 2026.

La présente politique décrit comment le module de publication TikTok de Chapote (**Chapote Publisher**) traite les données obtenues auprès de TikTok, conformément au **RGPD** (Règlement (UE) 2016/679) et à la loi Informatique et Libertés. Elle complète la [Politique de confidentialité de Chapote](/legal/confidentialite).

## 1. Responsable de traitement

- Éditeur : **Nathan Provost**, personne physique, éditeur du service Chapote ([chapote.fr](https://chapote.fr)).
- Contact : [hello@chapote.fr](mailto:hello@chapote.fr).

## 2. Objet du module

Chapote Publisher est un module de l'Espace client de Chapote. Il permet aux clients de Chapote de connecter leurs propres comptes TikTok et d'y publier leurs propres vidéos, directement ou en brouillon. Il utilise **TikTok Login Kit** et la **Content Posting API**, avec les autorisations (scopes) `user.info.basic`, `video.upload` et `video.publish`.

## 3. Données traitées

- **Profil TikTok de base** du compte connecté : identifiant `open_id`, nom d'affichage, avatar ; ainsi que les informations de publication renvoyées par TikTok (pseudo, options de confidentialité et d'interactions disponibles, durée maximale des vidéos).
- **Jetons d'accès et d'actualisation OAuth** délivrés par TikTok, **stockés chiffrés** dans notre base de données. Ils ne sont jamais affichés dans l'interface ni transmis au navigateur.
- **Vidéos** que le client choisit de publier : conservées **uniquement le temps de leur envoi à TikTok**, puis supprimées.
- **Métadonnées et historique des publications** : compte utilisé, membre de l'équipe à l'origine de la publication, titre, réglages choisis (confidentialité, interactions, divulgation commerciale), nom et taille du fichier, identifiant et statut de publication renvoyés par TikTok, dates.

Aucune autre donnée TikTok n'est collectée : pas de lecture des vidéos existantes, des abonnés, des messages ni des commentaires.

## 4. Finalités et base légale

Ces données servent **uniquement** à :

- connecter le compte TikTok du client à son espace Chapote et maintenir cette connexion (rafraîchissement des jetons) ;
- envoyer à TikTok les vidéos que le client a choisi de publier, avec les réglages qu'il a choisis ;
- afficher au client le statut et l'historique de ses publications.

La base légale est **l'exécution du contrat** conclu entre Chapote et son client (article 6.1.b du RGPD), le module faisant partie du service fourni, ainsi que l'autorisation donnée par le titulaire du compte via TikTok.

Les données ne sont **ni vendues, ni louées, ni utilisées à des fins publicitaires ou de profilage**. Elles ne sont partagées qu'avec **TikTok**, destinataire nécessaire des publications.

## 5. Hébergement et sécurité

- Les données sont hébergées sur des **serveurs situés en France**.
- Les jetons OAuth sont chiffrés au repos ; ils ne sortent jamais du serveur et ne figurent pas dans les journaux.
- Les comptes TikTok d'un client ne sont accessibles qu'aux membres de son espace (espace personnel ou équipe).
- Les vidéos sont stockées dans un espace temporaire non accessible publiquement.

## 6. Durées de conservation

- **Jetons OAuth** : tant que le compte TikTok est connecté ; supprimés **immédiatement** à la déconnexion. Un jeton d'actualisation inutilisé expire au plus tard 365 jours après sa délivrance par TikTok.
- **Vidéos** : supprimées dès la fin de l'envoi à TikTok (réussi ou non) ; un envoi abandonné est supprimé sous 2 heures.
- **Historique des publications** et profil associé (nom d'affichage, avatar, `open_id`) : **12 mois** après la publication, puis supprimés.
- La suppression du compte Chapote ou de l'équipe entraîne la suppression des comptes TikTok connectés et de l'historique associé.

## 7. Révocation de l'accès

L'accès de Chapote Publisher à un compte TikTok peut être retiré à tout moment :

- **depuis Chapote** : Espace client → TikTok → « Déconnecter ». L'autorisation est révoquée auprès de TikTok et les jetons sont supprimés de Chapote ;
- **depuis l'application TikTok** : Paramètres et confidentialité → Sécurité → Apps et services autorisés → Chapote Publisher → Supprimer l'accès. Chapote cesse alors de pouvoir publier et le compte apparaît « À reconnecter ».

## 8. Suppression des données sur demande

Vous pouvez demander la suppression de toutes les données liées à vos comptes TikTok (y compris l'historique des publications) en écrivant à [hello@chapote.fr](mailto:hello@chapote.fr). La suppression est effectuée **sous 30 jours**.

## 9. Vos droits

Conformément au RGPD, vous disposez d'un droit d'**accès**, de **rectification**, d'**effacement**, de **limitation**, de **portabilité** et d'**opposition** sur les données vous concernant. Pour les exercer, écrivez à [hello@chapote.fr](mailto:hello@chapote.fr).

Vous pouvez également introduire une réclamation auprès de la **CNIL** ([www.cnil.fr](https://www.cnil.fr)).

## 10. Conditions et politique de TikTok

L'utilisation de TikTok reste soumise aux conditions et à la politique de confidentialité de TikTok :

- [Conditions d'utilisation de TikTok](https://www.tiktok.com/legal/terms-of-service) ;
- [Politique de confidentialité de TikTok](https://www.tiktok.com/legal/privacy-policy).

Voir aussi les [Conditions d'utilisation du module TikTok](/legal/tiktok-cgu).
