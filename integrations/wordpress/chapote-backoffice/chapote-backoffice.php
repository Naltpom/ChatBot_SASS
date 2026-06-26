<?php
/**
 * Plugin Name:       Chapote Back-Office
 * Plugin URI:        https://chapote.fr
 * Description:       Le back-office Chapote dans WordPress : connectez-vous, gérez vos bots, éditez l'apparence, payez (Stripe), activez le widget sur le site et ciblez les pages. UI mince au-dessus de l'API Chapote ; le token reste côté serveur (jamais exposé au JavaScript).
 * Version:           2.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Chapote
 * Author URI:        https://chapote.fr
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       chapote-backoffice
 * Domain Path:       /languages
 *
 * Architecture (cf. PLUGIN_V2_BACKOFFICE_SPEC.md) :
 *   Admin SPA (vanilla JS)  --proxy /wp-json/chapote-bo/v1/*-->  API Chapote (/api/oauth/*, /api/account/*)
 *   Le JS du navigateur n'appelle JAMAIS Chapote directement (CORS + secret) :
 *   il parle au proxy REST WordPress, qui détient le token CHIFFRÉ et le relaie.
 *
 *   Connexion = device flow OAuth (RFC 8628) « Se connecter avec Chapote ».
 *   Paiement  = Stripe Checkout hébergé (redirection), retour /wp-admin, activation par webhook Chapote.
 *   Le ciblage des pages et l'activation du widget sont 100 % WordPress (options locales).
 */

if (!defined('ABSPATH')) {
    exit; // Pas d'accès direct.
}

define('CHAPOTE_BO_VERSION', '2.0.0');
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

/* -------------------------------------------------------------------------- */
/* i18n                                                                       */
/* -------------------------------------------------------------------------- */

add_action('init', 'chapote_bo_load_textdomain');
function chapote_bo_load_textdomain() {
    load_plugin_textdomain('chapote-backoffice', false, dirname(plugin_basename(__FILE__)) . '/languages');
}

/* -------------------------------------------------------------------------- */
/* Bootstrap des modules                                                      */
/* -------------------------------------------------------------------------- */

add_action('rest_api_init', array('Chapote_BO_REST', 'register_routes'));
add_action('admin_menu', array('Chapote_BO_Admin', 'register_menu'));
add_action('admin_enqueue_scripts', array('Chapote_BO_Admin', 'enqueue_assets'));
add_action('wp_footer', array('Chapote_BO_Frontend', 'inject_widgets'));

/** Lien « Réglages » direct depuis la liste des extensions. */
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'chapote_bo_action_links');
function chapote_bo_action_links($links) {
    $url = admin_url('admin.php?page=chapote-backoffice');
    array_unshift(
        $links,
        '<a href="' . esc_url($url) . '">' . esc_html__('Ouvrir le back-office', 'chapote-backoffice') . '</a>'
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
        '<p>' . __('Le plugin Chapote Back-Office se connecte à l\'API Chapote (OAuth device flow) pour gérer vos bots et déclenche une redirection vers Stripe Checkout pour le paiement. Le widget public charge un script depuis le domaine Chapote configuré.', 'chapote-backoffice') . '</p>'
    );
    wp_add_privacy_policy_content('Chapote Back-Office', $content);
}
