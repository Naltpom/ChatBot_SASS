=== Chapote Back-Office ===
Contributors: chapote
Tags: chatbot, chat, support, assistant, ia
Requires at least: 5.8
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 2.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Le back-office Chapote dans WordPress : connectez-vous, gérez vos bots, l'apparence, le paiement, et activez le widget sur votre site.

== Description ==

Chapote Back-Office transforme l'administration WordPress en tableau de bord léger de votre compte Chapote. Depuis le menu « Chapote » de wp-admin, vous pouvez :

* Vous connecter à Chapote (« Se connecter avec Chapote », OAuth Authorization Code + PKCE — redirection vers l'écran de consentement de Chapote, aucun mot de passe Chapote n'est saisi ni stocké dans WordPress).
* Voir et créer vos chatbots.
* Éditer l'apparence du widget (couleurs, position, taille, textes, mode sombre, mention « Powered by »…) avec un aperçu en direct, fidèle au widget réel.
* Souscrire ou faire évoluer un abonnement (modules + niveau d'IA) : le paiement se fait sur la page sécurisée hébergée par Stripe (redirection), jamais dans WordPress.
* Activer le widget sur votre site (interrupteur on/off par bot) et cibler les pages où il s'affiche (tout le site, ou inclusions/exclusions par type de contenu et par identifiant).

L'arbre de conversation, la base de connaissances et la sécurité (domaines autorisés) restent gérés dans le dashboard Chapote.

= Service externe requis (divulgation) =

**Ce plugin nécessite un compte Chapote, un service tiers payant hébergé sur https://chapote.fr.** Sans compte Chapote actif, le plugin ne peut pas fonctionner : il sert d'interface au-dessus de l'API de compte Chapote et n'effectue aucun traitement de chatbot localement.

**Communication avec Chapote.** Le plugin communique avec chapote.fr (adresse configurable dans les réglages) pour :

* la **connexion** : un échange OAuth (Authorization Code + PKCE, S256) ouvre l'écran de consentement de Chapote dans votre navigateur, puis WordPress échange le code d'autorisation contre un jeton d'accès, de serveur à serveur ;
* la **gestion des bots** via l'API de compte Chapote (`/api/account/*`) : lister/créer des bots, lire et enregistrer l'apparence, créer une session de paiement, mettre à jour ou résilier un abonnement.

**Données transmises à Chapote.**

* À la connexion : l'autorisation OAuth (aucun identifiant Chapote n'est saisi dans WordPress) ; l'adresse e-mail et le nom du compte connecté sont ensuite lus, uniquement pour affichage dans l'interface.
* À la gestion des bots : le nom et le mode d'un bot créé, la configuration d'apparence (`design_json`), la configuration d'abonnement (modules choisis, palier d'IA), le consentement horodaté à l'exécution immédiate, l'URL de votre site WordPress et, le cas échéant, l'identifiant du contenu lié.
* Côté public : sur les pages où vous activez le widget, le navigateur **du visiteur** charge le script `/widget.js` depuis le domaine Chapote configuré et envoie à Chapote les messages de conversation ainsi que les données techniques associées (par ex. adresse IP, user-agent) afin d'obtenir les réponses du chatbot.

**Données qui ne quittent pas WordPress.** L'état d'activation du widget et le ciblage des pages sont stockés localement dans WordPress et ne sont jamais envoyés à Chapote pour lecture.

**Paiement.** Le paiement est délégué à Stripe Checkout en mode **hébergé** (redirection vers la page de paiement Stripe). Aucune donnée de carte bancaire ne transite par WordPress. L'activation après paiement est confirmée côté Chapote par un webhook.

En utilisant ce plugin, vous acceptez les conditions et la politique de confidentialité du service Chapote :

* Conditions générales d'utilisation : https://chapote.fr/legal/cgu
* Politique de confidentialité : https://chapote.fr/legal/confidentialite

= Sécurité =

Le jeton d'accès à votre compte Chapote ne transite **jamais** par le navigateur. Le JavaScript de l'administration appelle un proxy REST WordPress (côté serveur PHP) qui détient le jeton chiffré (AES-256-GCM, clé hors base de données) et le relaie vers Chapote. Capacité requise : `manage_options`. Toutes les routes du proxy sont protégées par un nonce WordPress.

== Installation ==

1. Téléversez le dossier `chapote-backoffice` dans `wp-content/plugins/`, ou installez le fichier zip depuis Extensions → Ajouter une extension → Téléverser une extension, puis activez l'extension.
2. Ouvrez le menu « Chapote » dans l'administration, puis cliquez sur « Se connecter avec Chapote » (vous êtes redirigé vers l'écran de consentement Chapote, puis ramené dans wp-admin).
3. Créez ou sélectionnez un bot, réglez son apparence, souscrivez si nécessaire, puis activez le widget et ciblez les pages d'affichage.
4. Dans le dashboard Chapote (onglet Sécurité), ajoutez le domaine de votre site à la liste des domaines autorisés du bot.

Prérequis : PHP 7.4 ou supérieur avec l'extension OpenSSL (AES-256-GCM) pour le stockage chiffré du jeton ; un compte sur https://chapote.fr.

== Frequently Asked Questions ==

= Le plugin est-il utilisable sans compte Chapote ? =
Non. Le plugin est l'interface WordPress d'un service tiers payant (Chapote, https://chapote.fr). Un compte Chapote est nécessaire ; voir la sous-section « Service externe requis » de la description.

= Mes identifiants Chapote sont-ils stockés dans WordPress ? =
Non. La connexion utilise OAuth Authorization Code + PKCE : vous êtes redirigé vers Chapote pour autoriser ce site (écran de consentement affichant le domaine), puis ramené dans l'administration. WordPress ne conserve qu'un jeton d'accès, chiffré côté serveur, jamais exposé au navigateur.

= Quelles données sont envoyées à Chapote ? =
La configuration des bots (nom, apparence, abonnement), l'URL de votre site, et — sur les pages où le widget est activé — les messages des visiteurs et les données techniques associées, traités par Chapote pour générer les réponses. Détail complet dans la sous-section « Service externe requis » et dans la politique de confidentialité : https://chapote.fr/legal/confidentialite

= Comment se passe le paiement ? =
Le paiement est délégué à Stripe Checkout en mode hébergé : vous êtes redirigé vers la page de paiement de Stripe, puis ramené dans l'administration. Aucune donnée de carte ne transite par WordPress.

= Pourquoi le widget ne s'affiche-t-il pas sur le site ? =
Vérifiez que l'interrupteur d'affichage du bot est activé (en haut de la page du bot, ou dans « Mes bots ») et que le ciblage des pages inclut bien la page consultée.

= Le chat ne répond pas aux visiteurs =
Assurez-vous que le domaine de votre site figure dans les domaines autorisés du bot (onglet Sécurité du dashboard Chapote).

= Le plugin fonctionne-t-il avec mon propre serveur Chapote ? =
Oui. L'adresse de l'API et celle du dashboard sont configurables ; par défaut elles pointent vers https://chapote.fr.

== Screenshots ==

1. Écran de connexion « Se connecter avec Chapote » (OAuth Authorization Code + PKCE) : un seul bouton, redirection vers l'écran de consentement Chapote, aucun mot de passe saisi dans WordPress.
2. Liste « Mes bots » : tableau des chatbots avec l'interrupteur d'affichage sur le site, le statut de facturation et le plan/modules, plus la création d'un bot.
3. Onglet « Apparence » : éditeur des couleurs, position, taille et textes du widget, avec un aperçu en direct fidèle au widget public.
4. Onglet « Ciblage des pages » : choix « tout le site » ou pages personnalisées (inclusions/exclusions par type de contenu et par identifiant), et rappel du domaine à autoriser dans Chapote.

== Changelog ==

= 2.1.0 =
* Référencement (SEO) : nouvel onglet « SEO ». Lien « Powered by Chapote » optionnel (désactivé par défaut) et FAQ en données structurées schema.org (FAQPage, JSON-LD) rendues côté serveur, éligibles aux résultats enrichis.
* Mises à jour automatiques pour les installations hors WordPress.org (vérification de version et installation depuis l'administration WordPress).

= 2.0.0 =
* Back-office complet dans WordPress, interface mince au-dessus de l'API de compte Chapote.
* Connexion « Se connecter avec Chapote » via OAuth Authorization Code + PKCE (S256) ; jeton chiffré côté serveur (AES-256-GCM), jamais exposé au navigateur.
* Gestion des bots : liste, création, édition de l'apparence avec aperçu en direct.
* Paiement et abonnement via Stripe Checkout hébergé (redirection), avec consentement à l'exécution immédiate ; mise à jour de plan et résiliation.
* Activation du widget par bot et ciblage des pages (100 % WordPress, options locales).
* Proxy REST (namespace `chapote-bo/v1`) protégé par `manage_options` + nonce ; déclaration des services externes et contenu de confidentialité RGPD ; nettoyage complet à la désinstallation.

== Upgrade Notice ==

= 2.1.0 =
Ajoute l'onglet SEO (lien optionnel + FAQ schema.org) et les mises à jour automatiques hors WordPress.org.

= 2.0.0 =
Refonte en back-office complet : connexion OAuth « Se connecter avec Chapote », gestion des bots, apparence, paiement Stripe hébergé et activation/ciblage du widget. Nécessite un compte Chapote et PHP 7.4+ avec OpenSSL.
