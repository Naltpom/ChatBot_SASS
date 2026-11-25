# Chapote CM — mise en ligne sur le Play Store

Fichiers prêts :
- `store/icon-512.png` : icône de l'application (512 × 512)
- `store/feature-1024x500.png` : image de présentation
- Le fichier de l'app (`.aab`) : le lien est donné dans la conversation.
- Captures d'écran : à faire sur le téléphone, de 2 à 8. Par exemple : Planning, une publication, Commentaires, Stats, Nouvelle publication.

## 1. Créer l'application
Play Console → Créer une application
- Nom : **Chapote CM**
- Langue par défaut : Français (France)
- Application ou jeu : Application
- Gratuite ou payante : Gratuite
- Cocher les deux déclarations

## 2. Fiche principale (Croissance → Fiche du Play Store)
**Description courte** (80 caractères au maximum) :
> Programmez et suivez vos vidéos TikTok, YouTube et Instagram, depuis votre poche.

**Description complète** :
> Chapote CM est l'application de cm.chapote.fr : le planning de vos vidéos courtes sur TikTok, YouTube (Shorts) et Instagram (Reels).
>
> • Planning : vos publications jour par jour, à déplacer d'un geste.
> • Publier : envoyez une vidéo depuis votre galerie, choisissez les comptes et l'heure.
> • Suivre : publiée, en échec, brouillon TikTok à valider. Une notification vous prévient.
> • Commentaires : lisez-les et répondez sans changer d'application.
> • Statistiques : abonnés, vues et j'aime de chaque compte.
> • Bibliothèque : vos vidéos rangées dans votre Google Drive.
> • En équipe : regroupez vos comptes et partagez-les, en lecture seule ou avec le droit de publier.
>
> Sécurité : déverrouillage par empreinte ou visage, double authentification.
> Il faut un compte Chapote (création gratuite dans l'application).

- Catégorie : **Productivité**
- E-mail de contact : contact@chapote.fr
- Site web : https://cm.chapote.fr

## 3. Contenu de l'application (Règles → Contenu de l'application)
- **Règles de confidentialité** : https://chapote.fr/legal/confidentialite
- **Accès à l'application** : « Tout ou partie de l'application est soumis à des restrictions ». Donner un **compte de test** : e-mail et mot de passe, **sans double authentification**, déjà inscrit (étape « Vos informations » faite), avec au moins un compte connecté si possible. Google se connecte avec.
- **Annonces** : Non, aucune publicité.
- **Classification du contenu** : catégorie « Utilitaires, productivité, communication ». Répondre Non partout, sauf « Les utilisateurs peuvent-ils interagir ou échanger du contenu ? » : **Oui** (commentaires des réseaux).
- **Public cible** : 16-17 ans et 18 ans et plus. L'app est réservée aux 15 ans et plus. N'attire pas les enfants.
- **Applications d'actualités** : Non.
- **Applications de santé / financières / gouvernementales** : Non.
- **Sécurité des données** :
  - Données collectées : **Oui**. Chiffrées en transit : **Oui**. Suppression possible : **Oui** (dans l'app : Mon compte → Supprimer mon compte ; ou par e-mail à rgpd@chapote.fr).
  - Informations personnelles : **Nom**, **Adresse e-mail**, **Autres informations** (date de naissance). Rôle : fonctionnement de l'application, gestion du compte. Obligatoire.
  - Photos et vidéos : **Vidéos**. Rôle : fonctionnement de l'application (publication). Obligatoire pour publier.
  - Activité dans l'application : **Autre contenu généré par l'utilisateur** (légendes, réponses aux commentaires). Rôle : fonctionnement de l'application.
  - Identifiants de l'appareil : **Oui** (jeton de notifications). Rôle : fonctionnement de l'application.
  - Partage avec des tiers : **Non**. L'envoi vers TikTok, YouTube et Instagram se fait à la demande de l'utilisateur, ce qui ne compte pas comme un partage pour Google.

## 4. Mise en test puis en production
- **Compte développeur personnel créé après novembre 2023** : Google demande d'abord un **test fermé avec au moins 12 testeurs**, inscrits pendant **14 jours d'affilée**, avant de pouvoir demander l'accès à la production.
  Tests et versions → Tests → Test fermé → Créer un canal. Ajouter une liste d'adresses Gmail des testeurs, envoyer le `.aab`, puis partager le lien d'inscription.
- **Compte d'organisation (entreprise)** : pas d'obligation, on peut aller directement en **Production**.
- Pour chaque version : Créer une release → téléverser le `.aab` → notes de version (par exemple « Première version ») → Vérifier → Lancer.
- Signature : accepter la **signature des applications par Google Play** (proposée par défaut).

## 5. Ensuite
- Mises à jour de l'app sans nouvelle version Play Store : canal `production` d'EAS Update.
- Nouvelle version native (nouveau module, nouvelle permission) : augmenter `android.versionCode` dans `app.json`, reconstruire le `.aab` et le téléverser.
