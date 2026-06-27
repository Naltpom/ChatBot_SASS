<?php
/**
 * Leviers SEO rendus CÔTÉ SERVEUR (crawlables) — impossibles avec la seule balise
 * JavaScript du widget, qui n'est pas vue des moteurs.
 *
 * Pilotés par une unique option WordPress `chapote_bo_seo`, de la forme :
 *   {
 *     "powered_by": false,                       // backlink opt-in (défaut OFF)
 *     "faq": [ { "q": "...", "a": "..." }, ... ]  // paires Question / Réponse
 *   }
 *
 * 1) BACKLINK OPT-IN (wp_footer) : si powered_by vaut true, un petit lien
 *    crawlable « Chatbot par Chapote » vers https://chapote.fr est rendu en pied
 *    de page. DÉFAUT false (conformité WordPress.org : aucun lien forcé). Sortie
 *    intégralement échappée (esc_url / esc_html).
 *
 * 2) FAQ JSON-LD (wp_head) : si faq est non vide, un bloc
 *    <script type="application/ld+json"> décrivant un schema.org FAQPage
 *    (mainEntity = Question / acceptedAnswer Answer) est rendu UNE SEULE FOIS par
 *    page, encodé via wp_json_encode (slashes échappés -> pas d'évasion de
 *    </script>).
 *
 * Lecture DÉFENSIVE de l'option : absente ou malformée -> valeurs par défaut.
 */

if (!defined('ABSPATH')) {
    exit; // Pas d'accès direct.
}

class Chapote_BO_SEO {

    const OPTION = 'chapote_bo_seo';

    /** Garde-fou : empêche une double sortie JSON-LD si wp_head est rejoué. */
    private static $faq_emitted = false;

    /**
     * Branche les hooks SEO (rendu serveur).
     * Appelé une fois au chargement du plugin.
     */
    public static function init() {
        add_action('wp_head', array(__CLASS__, 'render_faq_jsonld'), 20);
        add_action('wp_footer', array(__CLASS__, 'render_backlink'), 99);
    }

    /**
     * Lit l'option et la normalise vers la forme attendue. Source unique de
     * vérité partagée par le rendu front ET le proxy REST (lecture/écriture).
     *
     * @return array{powered_by:bool,faq:array<int,array{q:string,a:string}>}
     */
    public static function get_settings() {
        $defaults = array('powered_by' => false, 'faq' => array());
        $raw = get_option(self::OPTION, $defaults);
        if (!is_array($raw)) {
            return $defaults;
        }
        return array(
            'powered_by' => !empty($raw['powered_by']),
            'faq'        => self::normalize_faq(isset($raw['faq']) ? $raw['faq'] : array()),
        );
    }

    /** Réduit une valeur brute à une liste de paires { q, a } non vides. */
    private static function normalize_faq($raw) {
        $out = array();
        if (!is_array($raw)) {
            return $out;
        }
        foreach ($raw as $item) {
            if (!is_array($item)) {
                continue;
            }
            $q = isset($item['q']) ? trim((string) $item['q']) : '';
            $a = isset($item['a']) ? trim((string) $item['a']) : '';
            if ($q === '' || $a === '') {
                continue; // une paire incomplète n'aurait aucun sens en JSON-LD
            }
            $out[] = array('q' => $q, 'a' => $a);
        }
        return array_values($out);
    }

    /* ---------------------------------------------------------------------- */
    /* 1) Backlink opt-in (wp_footer)                                          */
    /* ---------------------------------------------------------------------- */

    public static function render_backlink() {
        if (is_admin()) {
            return;
        }
        $s = self::get_settings();
        if (empty($s['powered_by'])) {
            return; // opt-in strict : rien tant que le réglage n'est pas activé
        }
        printf(
            '<div class="chapote-powered-by"><a href="%1$s">%2$s</a></div>' . "\n",
            esc_url('https://chapote.fr'),
            esc_html__('Chatbot par Chapote', 'chapote-backoffice')
        );
    }

    /* ---------------------------------------------------------------------- */
    /* 2) FAQ JSON-LD (wp_head)                                                */
    /* ---------------------------------------------------------------------- */

    public static function render_faq_jsonld() {
        if (is_admin() || self::$faq_emitted) {
            return;
        }
        $s = self::get_settings();
        if (empty($s['faq'])) {
            return;
        }

        $main_entity = array();
        foreach ($s['faq'] as $pair) {
            $main_entity[] = array(
                '@type'          => 'Question',
                'name'           => $pair['q'],
                'acceptedAnswer' => array(
                    '@type' => 'Answer',
                    'text'  => $pair['a'],
                ),
            );
        }

        $doc = array(
            '@context'   => 'https://schema.org',
            '@type'      => 'FAQPage',
            'mainEntity' => $main_entity,
        );

        // wp_json_encode SANS JSON_UNESCAPED_SLASHES : « / » devient « \/ », ce qui
        // neutralise toute séquence </script> qui se glisserait dans une réponse.
        // JSON_UNESCAPED_UNICODE garde les accents lisibles (contenu FR).
        $json = wp_json_encode($doc, JSON_UNESCAPED_UNICODE);
        if (!$json) {
            return;
        }

        self::$faq_emitted = true;
        // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON-LD via wp_json_encode (slashes échappés -> neutralise </script>) ; q/a déjà nettoyés (sanitize_text_field/wp_kses_post) à l'écriture.
        echo '<script type="application/ld+json">' . $json . '</script>' . "\n";
    }
}
