<?php
/**
 * Injection du widget côté public (wp_footer).
 *
 * Pour chaque bot ACTIVÉ (toggle ON, état local WP) dont le ciblage matche la
 * page courante, on injecte la balise officielle du widget :
 *   <script src="{api_base}/widget.js" data-bot-key="{public_key}" defer></script>
 *
 * Aucune dépendance à un token ici : tout repose sur les options locales
 * (public_key mémorisée à l'activation, qui n'a lieu que si le bot est payé).
 * Réutilise le pattern d'injection du plugin v1.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Chapote_BO_Frontend {

    public static function inject_widgets() {
        if (is_admin()) {
            return;
        }

        $bots = Chapote_BO_Options::bots_local();
        if (empty($bots)) {
            return;
        }

        $api_base = Chapote_BO_Options::api_base();
        if ($api_base === '') {
            return;
        }

        // Le ciblage s'évalue sur la requête principale (réinitialisée).
        wp_reset_query();

        $seen = array();
        foreach ($bots as $bot) {
            if (empty($bot['enabled']) || empty($bot['public_key'])) {
                continue;
            }
            $pk = (string) $bot['public_key'];
            if (isset($seen[$pk])) {
                continue; // évite une double balise pour la même clé
            }

            $targeting = isset($bot['targeting']) && is_array($bot['targeting'])
                ? wp_parse_args($bot['targeting'], Chapote_BO_Options::default_targeting())
                : Chapote_BO_Options::default_targeting();

            if (!self::matches($targeting)) {
                continue;
            }

            $seen[$pk] = true;
            printf(
                '<script src="%1$s" data-bot-key="%2$s" defer></script>' . "\n",
                esc_url($api_base . '/widget.js'),
                esc_attr($pk)
            );
        }
    }

    /**
     * Décide si la page courante doit afficher le widget.
     * Exclusions PRIORITAIRES sur toute inclusion.
     */
    private static function matches(array $t) {
        $current_id = (int) get_queried_object_id();

        // 1) Exclusions prioritaires.
        if ($current_id && in_array($current_id, self::ids($t, 'exclude_ids'), true)) {
            return false;
        }

        // 2) Tout le site.
        if (($t['mode'] ?? 'everywhere') !== 'custom') {
            return true;
        }

        // 3) Personnalisé : page d'accueil.
        if (!empty($t['include_front']) && (is_front_page() || is_home())) {
            return true;
        }

        // 4) Personnalisé : contenu précis par ID.
        if ($current_id && in_array($current_id, self::ids($t, 'include_ids'), true)) {
            return true;
        }

        // 5) Personnalisé : par type de contenu.
        $types = isset($t['include_types']) && is_array($t['include_types']) ? $t['include_types'] : array();
        if (!empty($types) && is_singular($types)) {
            return true;
        }

        return false;
    }

    private static function ids(array $t, $key) {
        $out = array();
        if (isset($t[$key]) && is_array($t[$key])) {
            foreach ($t[$key] as $n) {
                $n = (int) $n;
                if ($n > 0) {
                    $out[] = $n;
                }
            }
        }
        return $out;
    }
}
