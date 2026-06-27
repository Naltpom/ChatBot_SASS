=== Chapote Back-Office ===
Contributors: chapote
Tags: chatbot, chat, support, assistant, ia
Requires at least: 5.8
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 2.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Le back-office Chapote dans WordPress : connectez-vous, gérez vos bots, l'apparence, le paiement, et activez le widget sur votre site.

== Description ==

Chapote Back-Office transforme WordPress en tableau de bord léger de votre compte Chapote. Depuis l'admin, vous pouvez :

* Vous connecter à Chapote (« Se connecter avec Chapote », OAuth Authorization Code + PKCE — redirection vers l'écran de consentement Chapote, aucun mot de passe saisi dans WordPress).
* Voir et créer vos bots.
* Éditer l'apparence du widget (couleurs, position, textes, mode sombre…) avec un aperçu.
* Souscrire un abonnement (modules + IA) : le paiement se fait sur la page sécurisée hébergée par Stripe (redirection), pas dans WordPress.
* Activer le widget sur le site (uniquement si l'abonnement est actif) et cibler les pages où il s'affiche.

L'arbre de conversation, la base de connaissances et la sécurité (domaines autorisés) restent dans le dashboard Chapote.

= Sécurité =

Le jeton d'accès à votre compte ne transite JAMAIS par le navigateur : le JavaScript de l'admin appelle un proxy REST WordPress (côté serveur PHP) qui détient le jeton chiffré (AES-256-GCM) et le relaie vers Chapote. Capacité requise : `manage_options`. Toutes les routes du proxy sont protégées par un nonce.

== Services tiers (déclaration) ==

Ce plugin communique avec des services externes :

1. **API Chapote** (par défaut https://chapote.fr, configurable) — connexion OAuth (Authorization Code + PKCE), gestion des bots, apparence, abonnement. L'écran de consentement s'affiche sur le dashboard Chapote (réglage « adresse du dashboard », par défaut identique à l'API). Le widget public charge le script `/widget.js` depuis ce domaine sur les pages où il est activé.
   * Conditions : https://chapote.fr/legal/cgu
   * Confidentialité : https://chapote.fr/legal/confidentialite
2. **Stripe** (https://stripe.com) — uniquement par **redirection** vers la page de paiement hébergée (Stripe Checkout). Aucune donnée de carte ne transite par WordPress. L'activation après paiement est confirmée par un webhook côté Chapote.
   * Conditions : https://stripe.com/legal
   * Confidentialité : https://stripe.com/privacy

== Installation ==

1. Copiez le dossier `chapote-backoffice` dans `wp-content/plugins/` (ou installez le zip), puis activez le plugin.
2. Menu « Chapote » dans l'admin → bouton « Se connecter avec Chapote ».
3. Créez/sélectionnez un bot, réglez l'apparence, souscrivez, puis activez le widget et ciblez les pages.
4. Dans le dashboard Chapote (onglet Sécurité), ajoutez le domaine de votre site aux domaines autorisés.

== Frequently Asked Questions ==

= Mes identifiants Chapote sont-ils stockés dans WordPress ? =
Non. La connexion utilise OAuth Authorization Code + PKCE : vous êtes redirigé vers Chapote pour autoriser ce site (écran de consentement affichant le domaine), puis ramené dans l'admin. WordPress ne stocke qu'un jeton d'accès, chiffré, jamais exposé au navigateur.

= Pourquoi le widget ne s'active-t-il pas ? =
L'activation sur le site n'est possible que si l'abonnement du bot est « actif » (payé). Vérifiez l'onglet Paiement.

= Le chat ne répond pas aux visiteurs =
Vérifiez que le domaine de votre site figure dans les domaines autorisés du bot (onglet Sécurité de Chapote).

== Changelog ==

= 2.0.0 =
* Back-office complet : connexion OAuth device flow, gestion des bots, apparence, paiement Stripe (redirection), activation + ciblage des pages. Proxy REST avec jeton chiffré côté serveur.
