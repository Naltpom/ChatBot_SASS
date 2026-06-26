=== Chapote Chatbot ===
Contributors: chapote
Tags: chatbot, chat, support, assistant, ia
Requires at least: 5.8
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Ajoutez votre chatbot Chapote sur votre site WordPress en une minute : une clé, un clic, c'est en ligne.

== Description ==

Chapote Chatbot installe le widget de chat Chapote sur votre site sans toucher à votre thème ni coller de code.

1. Créez votre bot sur Chapote et copiez sa clé publique (pk_…).
2. Collez la clé dans les réglages du plugin.
3. Activez : le chat apparaît sur toutes les pages publiques.

La clé pk_ est publique : elle ne sert qu'à ouvrir une session de chat, validée côté serveur (domaine autorisé, captcha, limites de débit). Aucune clé secrète ne transite par WordPress.

== Installation ==

1. Installez et activez le plugin.
2. Allez dans Réglages → Chapote Chatbot.
3. Renseignez votre clé de bot (pk_…) et cochez « Activer ».
4. Dans votre tableau de bord Chapote (onglet Sécurité), ajoutez le domaine de votre site à la liste des domaines autorisés.

== Frequently Asked Questions ==

= Où trouver ma clé de bot ? =
Dans votre tableau de bord Chapote, onglet Intégration : la clé commence par pk_.

= Le chat ne répond pas =
Vérifiez que le domaine de votre site figure bien dans les domaines autorisés de votre bot (onglet Sécurité de Chapote).

= Le plugin stocke-t-il des données sensibles ? =
Non. Seule la clé publique pk_ et l'adresse Chapote sont enregistrées. Aucune clé secrète.

== Changelog ==

= 1.0.0 =
* Version initiale : réglages (clé, adresse, activation) + injection du widget.
