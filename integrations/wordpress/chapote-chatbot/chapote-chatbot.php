<?php
/**
 * Plugin Name:       Chapote Chatbot
 * Plugin URI:        https://chapote.fr
 * Description:       Le chatbot Chapote dans WordPress : connectez-vous, gérez vos bots, éditez l'apparence, payez (Stripe), activez le widget sur le site et ciblez les pages. UI mince au-dessus de l'API Chapote ; le token reste côté serveur (jamais exposé au JavaScript).
 * Version:           2.1.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Chapote
 * Author URI:        https://chapote.fr
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       chapote-chatbot
 *
 * Architecture (cf. PLUGIN_V2_BACKOFFICE_SPEC.md) :
 *   Admin SPA (vanilla JS)  --proxy /wp-json/chapote-bo/v1/*-->  API Chapote (/api/oauth/*, /api/account/*)
 *   Le JS du navigateur n'appelle JAMAIS Chapote directement (CORS + secret) :
 *   il parle au proxy REST WordPress, qui détient le token CHIFFRÉ et le relaie.
 *
 *   Connexion = OAuth Authorization Code + PKCE (S256) « Se connecter avec Chapote »
 *               (redirection vers l'écran de consentement du dashboard, retour /wp-admin).
 *   Paiement  = Stripe Checkout hébergé (redirection), retour /wp-admin, activation par webhook Chapote.
 *   Le ciblage des pages et l'activation du widget sont 100 % WordPress (options locales).
 */

if (!defined('ABSPATH')) {
    exit; // Pas d'accès direct.
}

define('CHAPOTE_BO_VERSION', '2.1.0');
define('CHAPOTE_BO_FILE', __FILE__);
define('CHAPOTE_BO_DIR', plugin_dir_path(__FILE__));
define('CHAPOTE_BO_URL', plugin_dir_url(__FILE__));
define('CHAPOTE_BO_REST_NS', 'chapote-bo/v1');
define('CHAPOTE_BO_DEFAULT_API', 'https://chapote.fr');
define('CHAPOTE_BO_OAUTH_CLIENT_ID', 'chapote_wp');

/* -------------------------------------------------------------------------- */
/* Chargement des classes                                                     */
/* -------------------------------------------------------------------------- */

require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-crypto.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-options.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-tokens.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-api.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-rest.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-admin.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-frontend.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-seo.php';

// Mise à jour automatique SELF-HOSTED (depuis chapote.fr). EXCLU du paquet
// WordPress.org : un plugin hébergé sur le dépôt .org ne DOIT PAS embarquer son
// propre updater (il court-circuiterait les MAJ du dépôt). Le build .org retire
// ce fichier ; le `file_exists` évite alors tout fatal et laisse WordPress.org
// gérer les mises à jour (cf. docs/PLUGIN_DISTRIBUTION.md).
if (file_exists(CHAPOTE_BO_DIR . 'includes/class-chapote-bo-updater.php')) {
    require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-updater.php';
}

/* -------------------------------------------------------------------------- */
/* Bootstrap des modules                                                      */
/* -------------------------------------------------------------------------- */
/* i18n : WordPress charge automatiquement les traductions par slug (depuis 4.6),
   pas d'appel load_plugin_textdomain requis (Plugin Check le déconseille). */

add_action('rest_api_init', array('Chapote_BO_REST', 'register_routes'));
add_action('admin_menu', array('Chapote_BO_Admin', 'register_menu'));
add_action('admin_enqueue_scripts', array('Chapote_BO_Admin', 'enqueue_assets'));
Chapote_BO_Frontend::init();

// SEO (rendu serveur, crawlable) : FAQ JSON-LD + backlink opt-in.
Chapote_BO_SEO::init();
// Auto-update self-hosted (présent hors paquet WordPress.org, cf. ci-dessus).
if (class_exists('Chapote_BO_Updater')) {
    Chapote_BO_Updater::init();
}

/** Lien « Réglages » direct depuis la liste des extensions. */
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'chapote_bo_action_links');
function chapote_bo_action_links($links) {
    $url = admin_url('admin.php?page=chapote-chatbot');
    array_unshift(
        $links,
        '<a href="' . esc_url($url) . '">' . esc_html__('Ouvrir Chapote Chatbot', 'chapote-chatbot') . '</a>'
    );
    return $links;
}

/* -------------------------------------------------------------------------- */
/* RGPD : déclaration du contenu de confidentialité                           */
/* -------------------------------------------------------------------------- */

add_action('admin_init', 'chapote_bo_register_privacy_content');
function chapote_bo_register_privacy_content() {
    if (!function_exists('wp_add_privacy_policy_content')) {
        return;
    }
    $content = wp_kses_post(
        '<p>' . __('Le plugin Chapote Chatbot se connecte à l\'API Chapote (OAuth Authorization Code + PKCE) pour gérer vos bots et déclenche une redirection vers Stripe Checkout pour le paiement. Le widget public charge un script depuis le domaine Chapote configuré.', 'chapote-chatbot') . '</p>'
    );
    wp_add_privacy_policy_content('Chapote Chatbot', $content);
}
