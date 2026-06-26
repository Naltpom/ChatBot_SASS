<?php
/**
 * Plugin Name:       Chapote Chatbot
 * Plugin URI:        https://chapote.fr
 * Description:       Ajoute votre chatbot Chapote sur votre site WordPress. Collez la clé publique de votre bot (pk_…), activez, et le chat est en ligne.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Chapote
 * Author URI:        https://chapote.fr
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       chapote-chatbot
 * Domain Path:       /languages
 *
 * Le plugin se contente d'injecter la balise officielle du widget Chapote :
 *   <script src="{API}/widget.js" data-bot-key="pk_…" defer></script>
 * La clé pk_ est PUBLIQUE (cf. widget/widget.js) : elle ne sert qu'à initier
 * une session, vérifiée côté serveur (domaine whitelisté + captcha + rate limit).
 * Aucune clé secrète ne transite par WordPress.
 */

if (!defined('ABSPATH')) {
    exit; // Pas d'accès direct.
}

define('CHAPOTE_CHATBOT_VERSION', '1.0.0');
define('CHAPOTE_CHATBOT_OPTION', 'chapote_chatbot_settings');
define('CHAPOTE_CHATBOT_DEFAULT_API', 'https://chapote.fr');

/**
 * Réglages par défaut.
 *
 * @return array{enabled:int,bot_key:string,api_base:string}
 */
function chapote_chatbot_defaults() {
    return array(
        'enabled'  => 0,
        'bot_key'  => '',
        'api_base' => CHAPOTE_CHATBOT_DEFAULT_API,
    );
}

/**
 * Réglages courants, fusionnés avec les défauts (jamais de clé manquante).
 *
 * @return array{enabled:int,bot_key:string,api_base:string}
 */
function chapote_chatbot_get_settings() {
    $saved = get_option(CHAPOTE_CHATBOT_OPTION, array());
    if (!is_array($saved)) {
        $saved = array();
    }
    return wp_parse_args($saved, chapote_chatbot_defaults());
}

/* -------------------------------------------------------------------------- */
/* i18n                                                                       */
/* -------------------------------------------------------------------------- */

add_action('init', 'chapote_chatbot_load_textdomain');
function chapote_chatbot_load_textdomain() {
    load_plugin_textdomain('chapote-chatbot', false, dirname(plugin_basename(__FILE__)) . '/languages');
}

/* -------------------------------------------------------------------------- */
/* Réglages (Settings API)                                                    */
/* -------------------------------------------------------------------------- */

add_action('admin_init', 'chapote_chatbot_register_settings');
function chapote_chatbot_register_settings() {
    register_setting(
        'chapote_chatbot',
        CHAPOTE_CHATBOT_OPTION,
        array(
            'type'              => 'array',
            'sanitize_callback' => 'chapote_chatbot_sanitize',
            'default'           => chapote_chatbot_defaults(),
        )
    );

    add_settings_section(
        'chapote_chatbot_main',
        __('Configuration du chatbot', 'chapote-chatbot'),
        '__return_false',
        'chapote-chatbot'
    );

    add_settings_field('enabled', __('Activer le chatbot', 'chapote-chatbot'), 'chapote_chatbot_field_enabled', 'chapote-chatbot', 'chapote_chatbot_main');
    add_settings_field('bot_key', __('Clé du bot', 'chapote-chatbot'), 'chapote_chatbot_field_bot_key', 'chapote-chatbot', 'chapote_chatbot_main');
    add_settings_field('api_base', __('Adresse Chapote', 'chapote-chatbot'), 'chapote_chatbot_field_api_base', 'chapote-chatbot', 'chapote_chatbot_main');
}

/**
 * Nettoie et valide les réglages soumis.
 *
 * @param array $input Données brutes du formulaire.
 * @return array Réglages assainis.
 */
function chapote_chatbot_sanitize($input) {
    $out = chapote_chatbot_defaults();

    $out['enabled'] = (isset($input['enabled']) && $input['enabled']) ? 1 : 0;

    $key = isset($input['bot_key']) ? sanitize_text_field(trim((string) $input['bot_key'])) : '';
    if ($key !== '' && !preg_match('/^pk_[A-Za-z0-9_-]+$/', $key)) {
        add_settings_error(
            'chapote_chatbot',
            'chapote_bad_key',
            __('La clé du bot doit ressembler à « pk_xxxxxxxx ». Vérifiez l\'onglet Intégration de votre tableau de bord Chapote.', 'chapote-chatbot')
        );
    }
    $out['bot_key'] = $key;

    $api = isset($input['api_base']) ? trim((string) $input['api_base']) : CHAPOTE_CHATBOT_DEFAULT_API;
    $api = esc_url_raw($api, array('http', 'https'));
    if ($api === '') {
        $api = CHAPOTE_CHATBOT_DEFAULT_API;
    }
    $out['api_base'] = untrailingslashit($api);

    return $out;
}

function chapote_chatbot_field_enabled() {
    $s = chapote_chatbot_get_settings();
    printf(
        '<label><input type="checkbox" name="%1$s[enabled]" value="1" %2$s /> %3$s</label>',
        esc_attr(CHAPOTE_CHATBOT_OPTION),
        checked(1, $s['enabled'], false),
        esc_html__('Afficher le chatbot sur le site public', 'chapote-chatbot')
    );
}

function chapote_chatbot_field_bot_key() {
    $s = chapote_chatbot_get_settings();
    printf(
        '<input type="text" class="regular-text" name="%1$s[bot_key]" value="%2$s" placeholder="pk_…" autocomplete="off" spellcheck="false" />',
        esc_attr(CHAPOTE_CHATBOT_OPTION),
        esc_attr($s['bot_key'])
    );
    echo '<p class="description">' . esc_html__('Tableau de bord Chapote → onglet Intégration → copiez la clé publique pk_…', 'chapote-chatbot') . '</p>';
}

function chapote_chatbot_field_api_base() {
    $s = chapote_chatbot_get_settings();
    printf(
        '<input type="url" class="regular-text" name="%1$s[api_base]" value="%2$s" placeholder="%3$s" />',
        esc_attr(CHAPOTE_CHATBOT_OPTION),
        esc_attr($s['api_base']),
        esc_attr(CHAPOTE_CHATBOT_DEFAULT_API)
    );
    echo '<p class="description">' . esc_html__('Laissez la valeur par défaut en production. Environnement de test local : http://localhost:8001', 'chapote-chatbot') . '</p>';
}

/* -------------------------------------------------------------------------- */
/* Page d'administration                                                      */
/* -------------------------------------------------------------------------- */

add_action('admin_menu', 'chapote_chatbot_admin_menu');
function chapote_chatbot_admin_menu() {
    add_options_page(
        __('Chapote Chatbot', 'chapote-chatbot'),
        __('Chapote Chatbot', 'chapote-chatbot'),
        'manage_options',
        'chapote-chatbot',
        'chapote_chatbot_render_page'
    );
}

function chapote_chatbot_render_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $s    = chapote_chatbot_get_settings();
    $host = wp_parse_url(home_url(), PHP_URL_HOST);
    if (wp_parse_url(home_url(), PHP_URL_PORT)) {
        $host .= ':' . wp_parse_url(home_url(), PHP_URL_PORT);
    }
    ?>
    <div class="wrap">
        <h1><?php esc_html_e('Chapote Chatbot', 'chapote-chatbot'); ?></h1>
        <p><?php esc_html_e('Collez la clé publique de votre bot, activez, et le chat apparaît sur votre site.', 'chapote-chatbot'); ?></p>

        <form action="options.php" method="post">
            <?php
            settings_fields('chapote_chatbot');
            do_settings_sections('chapote-chatbot');
            submit_button();
            ?>
        </form>

        <hr />
        <h2><?php esc_html_e('À ne pas oublier : autoriser ce domaine', 'chapote-chatbot'); ?></h2>
        <p>
            <?php
            printf(
                /* translators: %s: domaine du site WordPress courant. */
                wp_kses(
                    __('Ajoutez le domaine <code>%s</code> à la liste des domaines autorisés de votre bot (onglet Sécurité dans Chapote), sinon le chat ne répondra pas aux visiteurs.', 'chapote-chatbot'),
                    array('code' => array())
                ),
                esc_html($host)
            );
            ?>
        </p>

        <?php if ($s['enabled'] && $s['bot_key'] !== '') : ?>
            <p style="color:#2F9E79;font-weight:600;">
                <?php esc_html_e('✓ Le chatbot est actif : la balise est injectée sur les pages publiques du site.', 'chapote-chatbot'); ?>
            </p>
        <?php endif; ?>
    </div>
    <?php
}

/** Lien « Réglages » direct depuis la liste des extensions. */
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'chapote_chatbot_action_links');
function chapote_chatbot_action_links($links) {
    $settings = '<a href="' . esc_url(admin_url('options-general.php?page=chapote-chatbot')) . '">'
        . esc_html__('Réglages', 'chapote-chatbot') . '</a>';
    array_unshift($links, $settings);
    return $links;
}

/** Avertissement si activé sans clé. */
add_action('admin_notices', 'chapote_chatbot_admin_notice');
function chapote_chatbot_admin_notice() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $s = chapote_chatbot_get_settings();
    if ($s['enabled'] && $s['bot_key'] === '') {
        echo '<div class="notice notice-warning is-dismissible"><p>'
            . esc_html__('Chapote Chatbot est activé mais aucune clé de bot n\'est renseignée.', 'chapote-chatbot')
            . ' <a href="' . esc_url(admin_url('options-general.php?page=chapote-chatbot')) . '">'
            . esc_html__('Configurer maintenant', 'chapote-chatbot') . '</a></p></div>';
    }
}

/* -------------------------------------------------------------------------- */
/* Injection du widget côté public                                            */
/* -------------------------------------------------------------------------- */

add_action('wp_footer', 'chapote_chatbot_render_widget');
function chapote_chatbot_render_widget() {
    if (is_admin()) {
        return;
    }
    $s = chapote_chatbot_get_settings();
    if (!$s['enabled'] || $s['bot_key'] === '' || $s['api_base'] === '') {
        return;
    }
    printf(
        '<script src="%1$s" data-bot-key="%2$s" defer></script>' . "\n",
        esc_url($s['api_base'] . '/widget.js'),
        esc_attr($s['bot_key'])
    );
}
