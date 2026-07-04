<?php
/**
 * Plugin Name:       Chapote Bot Manager
 * Description:       The Chapote chatbot inside WordPress: sign in, manage your bots, edit the appearance, pay (Stripe), enable the widget on your site and target pages. A thin UI on top of the Chapote API; the token stays server-side (never exposed to JavaScript).
 * Version:           2.3.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Chapote
 * Author URI:        https://chapote.fr
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       chapote-bot-manager
 * Domain Path:       /languages
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
    exit;
}

define('CHAPOTE_BO_VERSION', '2.3.0');
define('CHAPOTE_BO_FILE', __FILE__);
define('CHAPOTE_BO_DIR', plugin_dir_path(__FILE__));
define('CHAPOTE_BO_URL', plugin_dir_url(__FILE__));
define('CHAPOTE_BO_REST_NS', 'chapote-bo/v1');
define('CHAPOTE_BO_DEFAULT_API', 'https://chapote.fr');
define('CHAPOTE_BO_OAUTH_CLIENT_ID', 'chapote_wp');

require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-crypto.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-options.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-tokens.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-api.php';
require_once CHAPOTE_BO_DIR . 'includes/class-chapote-bo-pages.php';
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

/** i18n : charge les traductions du plugin depuis /languages (fichiers .mo). */
add_action('init', 'chapote_bo_load_textdomain');
function chapote_bo_load_textdomain() {
    load_plugin_textdomain('chapote-bot-manager', false, dirname(plugin_basename(__FILE__)) . '/languages');
}

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
        '<a href="' . esc_url($url) . '">' . esc_html__('Open Chapote Bot Manager', 'chapote-bot-manager') . '</a>'
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
        '<p>' . __('The Chapote Bot Manager plugin connects to the Chapote API (OAuth Authorization Code + PKCE) to manage your bots and redirects to Stripe Checkout for payment. The public widget loads a script from the configured Chapote domain.', 'chapote-bot-manager') . '</p>'
    );
    wp_add_privacy_policy_content('Chapote Bot Manager', $content);
}
