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

    const PAGE_SLUG = 'chapote-backoffice';

    public static function register_menu() {
        add_menu_page(
            __('Chapote Back-Office', 'chapote-backoffice'),
            __('Chapote', 'chapote-backoffice'),
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
        $return_status = isset($_GET['cbo_status']) ? sanitize_key(wp_unslash($_GET['cbo_status'])) : '';
        $return_bot    = isset($_GET['cbo_bot']) ? sanitize_text_field(wp_unslash($_GET['cbo_bot'])) : '';

        wp_localize_script('chapote-bo-admin', 'CHAPOTE_BO', array(
            'restBase'      => esc_url_raw(rest_url(CHAPOTE_BO_REST_NS)),
            'nonce'         => wp_create_nonce('wp_rest'),
            'apiBase'       => Chapote_BO_Options::api_base(),
            'adminUrl'      => admin_url('admin.php?page=' . self::PAGE_SLUG),
            'siteHost'      => $host,
            'homeUrl'       => home_url(),
            'returnStatus'  => $return_status,
            'returnBot'     => $return_bot,
            'cryptoOk'      => Chapote_BO_Crypto::available(),
            'postTypes'     => self::public_post_types(),
            'catalog'       => self::catalog(),
            'dashboardBase' => Chapote_BO_Options::api_base(),
        ));
    }

    public static function render_page() {
        if (!current_user_can('manage_options')) {
            return;
        }
        echo '<div class="wrap chapote-bo-wrap">';
        echo '<h1>' . esc_html__('Chapote Back-Office', 'chapote-backoffice') . '</h1>';
        if (!Chapote_BO_Crypto::available()) {
            echo '<div class="notice notice-error"><p>'
                . esc_html__('Le module PHP OpenSSL (AES-256-GCM) est requis pour stocker vos identifiants de façon chiffrée. Contactez votre hébergeur.', 'chapote-backoffice')
                . '</p></div>';
        }
        // Conteneur monté par la SPA vanilla. Fallback no-JS pour l'accessibilité.
        echo '<div id="chapote-bo-app"><noscript>'
            . esc_html__('Ce back-office nécessite JavaScript.', 'chapote-backoffice')
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

    /**
     * Miroir front du catalogue de facturation (modules + paliers IA).
     *
     * Source de vérité = backend (GET /api/account/catalog, MÊME forme que
     * /api/billing/catalog). Ici un repli STATIQUE pour l'affichage sans
     * round-trip ; la SPA récupère le catalogue LIVE via /catalog et ne retombe
     * sur ce repli qu'en cas d'échec. Les PRIX restent indicatifs : Stripe
     * applique le tarif réel au checkout.
     *
     * Forme RÉELLE respectée : le module IA est DANS `modules` (key === 'ai') et
     * porte `byok_price_cents` ; il n'y a PAS de `ai_byok_price_cents` ni de
     * `tax_note` au niveau racine. Aligné sur app/src/utils/billing.ts.
     */
    private static function catalog() {
        return array(
            'currency' => 'eur',
            'modules'  => array(
                array('key' => 'ai',          'label' => __('Intelligence artificielle', 'chapote-backoffice'), 'price_cents' => 0,    'requires' => array(), 'byok_price_cents' => 2900),
                array('key' => 'rag',         'label' => __('Connaissances (RAG)', 'chapote-backoffice'),  'price_cents' => 900,  'requires' => array('ai')),
                array('key' => 'inbox',       'label' => __('Live chat / Inbox', 'chapote-backoffice'),    'price_cents' => 1500, 'requires' => array()),
                array('key' => 'actions',     'label' => __('Actions', 'chapote-backoffice'),              'price_cents' => 1200, 'requires' => array()),
                array('key' => 'mcp',         'label' => __('MCP (outils IA)', 'chapote-backoffice'),      'price_cents' => 900,  'requires' => array('ai')),
                array('key' => 'ab',          'label' => __('A/B testing', 'chapote-backoffice'),          'price_cents' => 700,  'requires' => array()),
                array('key' => 'white_label', 'label' => __('White-label', 'chapote-backoffice'),          'price_cents' => 900,  'requires' => array()),
            ),
            'ai_tiers' => array(
                array('id' => 'ai_starter', 'included_replies' => 1000,  'price_cents' => 1900),
                array('id' => 'ai_growth',  'included_replies' => 3000,  'price_cents' => 3900),
                array('id' => 'ai_scale',   'included_replies' => 10000, 'price_cents' => 8900),
            ),
        );
    }
}
