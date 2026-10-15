# Politique de confidentialité – Chapote Publisher

Dernière mise à jour : 15 octobre 2026.

La présente politique décrit comment l'application **Chapote Publisher** traite les données obtenues auprès de TikTok, conformément au **RGPD** (Règlement (UE) 2016/679) et à la loi Informatique et Libertés.

## 1. Éditeur et responsable de traitement

- Éditeur : **Nathan Provost**, personne physique.
- Contact : [hello@chapote.fr](mailto:hello@chapote.fr).

L'éditeur est le responsable du traitement décrit ci-dessous.

## 2. Objet de l'application

Chapote Publisher est un **outil privé**, utilisé **uniquement par son éditeur** pour publier ses propres vidéos sur ses propres comptes TikTok (**kiwi.signal** et **easy.neuron**). Les publications sont déclenchées depuis un script lancé par l'éditeur ou par des routines automatisées qu'il a lui-même configurées.

L'application **n'est pas ouverte au public** : aucun tiers ne peut s'y connecter ni l'utiliser.

## 3. Données TikTok traitées

L'application utilise **TikTok Login Kit** et la **Content Posting API**, avec les autorisations (scopes) `user.info.basic`, `video.upload` et `video.publish`. Les données traitées sont :

- les **informations de profil de base** des comptes de l'éditeur : identifiant `open_id`, nom d'affichage, avatar ;
- les **jetons d'accès et d'actualisation OAuth** délivrés par TikTok ;
- les **vidéos et légendes** que l'éditeur choisit de publier, ainsi que le **statut de publication** renvoyé par TikTok.

## 4. Finalité

Ces données servent **uniquement** à téléverser et publier les vidéos de l'éditeur sur ses propres comptes TikTok.

- Aucune lecture des vidéos, abonnés, messages ou commentaires d'autres utilisateurs.
- Aucune publicité, aucun profilage.
- Aucune vente, location ni partage des données avec des tiers.

La base légale du traitement est l'intérêt légitime de l'éditeur à gérer ses propres comptes, ainsi que l'autorisation donnée via TikTok.

## 5. Stockage et sécurité

- Les jetons OAuth sont conservés comme **secrets chiffrés** dans l'environnement d'exécution de l'éditeur.
- L'application ne dispose **d'aucune base de données d'utilisateurs**.
- Les fichiers vidéo ne transitent par l'application que **le temps de la publication**.

## 6. Durée de conservation

- Les jetons sont conservés **tant que l'autorisation est active** et supprimés **dès sa révocation**.
- Aucune autre donnée TikTok n'est conservée.

## 7. Révocation de l'accès et suppression des données

L'accès de Chapote Publisher peut être retiré à tout moment :

- **depuis l'application TikTok** : Paramètres et confidentialité → Sécurité → Apps et services autorisés → Chapote Publisher → Supprimer l'accès ;
- **par e-mail** à [hello@chapote.fr](mailto:hello@chapote.fr), en demandant la suppression des données : elle est effectuée **sous 30 jours**.

## 8. Vos droits

Conformément au RGPD, vous disposez d'un droit d'**accès**, de **rectification**, d'**effacement** et d'**opposition** sur les données vous concernant. Pour les exercer, écrivez à [hello@chapote.fr](mailto:hello@chapote.fr).

Vous pouvez également introduire une réclamation auprès de la **CNIL** ([www.cnil.fr](https://www.cnil.fr)).

## 9. Conditions et politique de TikTok

L'utilisation de TikTok reste soumise aux conditions et à la politique de confidentialité de TikTok :

- [Conditions d'utilisation de TikTok](https://www.tiktok.com/legal/terms-of-service) ;
- [Politique de confidentialité de TikTok](https://www.tiktok.com/legal/privacy-policy).

Voir aussi les [Conditions d'utilisation de Chapote Publisher](/legal/tiktok-cgu).
