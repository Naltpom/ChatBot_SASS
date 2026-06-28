<?php
/**
 * Page d'administration : menu, conteneur de la SPA, enqueue + localisation.
 *
 * Les assets (vanilla JS + CSS) ne sont chargés QUE sur la page du plugin.
 * Aucune étape de build : le JS est servi tel quel et appelle le proxy REST.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Chapote_BO_Admin {

    const PAGE_SLUG = 'chapote-chatbot';

    public static function register_menu() {
        add_menu_page(
            __('Chapote Chatbot', 'chapote-chatbot'),
            __('Chapote', 'chapote-chatbot'),
            'manage_options',
            self::PAGE_SLUG,
            array(__CLASS__, 'render_page'),
            'dashicons-format-chat',
            58
        );
    }

    public static function enqueue_assets($hook) {
        // toplevel_page_{slug} : on ne charge que sur notre écran.
        if ($hook !== 'toplevel_page_' . self::PAGE_SLUG) {
            return;
        }

        wp_enqueue_style(
            'chapote-bo-admin',
            CHAPOTE_BO_URL . 'admin/css/admin.css',
            array(),
            CHAPOTE_BO_VERSION
        );

        wp_enqueue_script(
            'chapote-bo-admin',
            CHAPOTE_BO_URL . 'admin/js/admin.js',
            array(),
            CHAPOTE_BO_VERSION,
            true
        );

        $host = wp_parse_url(home_url(), PHP_URL_HOST);
        if (wp_parse_url(home_url(), PHP_URL_PORT)) {
            $host .= ':' . wp_parse_url(home_url(), PHP_URL_PORT);
        }

        // Statut de retour Stripe (success/cancel) lu côté serveur, transmis au JS.
        // Pas de nonce possible (paramètres d'une redirection externe Stripe) ; la
        // valeur est seulement assainie puis affichée, aucune action mutative.
        // phpcs:disable WordPress.Security.NonceVerification.Recommended
        $return_status = isset($_GET['cbo_status']) ? sanitize_key(wp_unslash($_GET['cbo_status'])) : '';
        $return_bot    = isset($_GET['cbo_bot']) ? sanitize_text_field(wp_unslash($_GET['cbo_bot'])) : '';
        // phpcs:enable WordPress.Security.NonceVerification.Recommended

        wp_localize_script('chapote-bo-admin', 'CHAPOTE_BO', array(
            'restBase'      => esc_url_raw(rest_url(CHAPOTE_BO_REST_NS)),
            'nonce'         => wp_create_nonce('wp_rest'),
            'apiBase'       => Chapote_BO_Options::api_base(),
            'appBase'       => Chapote_BO_Options::app_base(),
            'adminUrl'      => admin_url('admin.php?page=' . self::PAGE_SLUG),
            'siteHost'      => $host,
            'homeUrl'       => home_url(),
            'returnStatus'  => $return_status,
            'returnBot'     => $return_bot,
            'cryptoOk'      => Chapote_BO_Crypto::available(),
            'postTypes'     => self::public_post_types(),
            // Le catalogue de facturation (prix, paliers IA, modules) n'est PLUS
            // dupliqué ici : la SPA admin le récupère en LIVE via le proxy REST
            // /catalog (-> GET /api/account/catalog, source unique backend).
            'dashboardBase' => Chapote_BO_Options::app_base(),
        ));
    }

    public static function render_page() {
        if (!current_user_can('manage_options')) {
            return;
        }
        echo '<div class="wrap chapote-bo-wrap">';
        echo '<h1>' . esc_html__('Chapote Chatbot', 'chapote-chatbot') . '</h1>';
        if (!Chapote_BO_Crypto::available()) {
            echo '<div class="notice notice-error"><p>'
                . esc_html__('Le module PHP OpenSSL (AES-256-GCM) est requis pour stocker vos identifiants de façon chiffrée. Contactez votre hébergeur.', 'chapote-chatbot')
                . '</p></div>';
        }
        // Conteneur monté par la SPA vanilla. Fallback no-JS pour l'accessibilité.
        echo '<div id="chapote-bo-app"><noscript>'
            . esc_html__('Ce back-office nécessite JavaScript.', 'chapote-chatbot')
            . '</noscript></div>';
        echo '</div>';
    }

    /** Types de contenu publics pour le ciblage des pages. */
    private static function public_post_types() {
        $out = array();
        $types = get_post_types(array('public' => true), 'objects');
        foreach ($types as $slug => $obj) {
            if ($slug === 'attachment') {
                continue;
            }
            $out[] = array(
                'slug'  => $slug,
                'label' => $obj->labels->name ? $obj->labels->name : $slug,
            );
        }
        return $out;
    }

}
