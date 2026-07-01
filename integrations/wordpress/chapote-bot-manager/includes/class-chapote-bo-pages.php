<?php
/**
 * Énumération des contenus publics WordPress pour l'onboarding guidé.
 *
 * Sert l'écran « Quelles pages décrivent votre activité ? » : on liste les
 * pages/articles/CPT PUBLIÉS du site (jamais d'appel Chapote ici — c'est 100 %
 * WordPress) et on les pré-trie par PERTINENCE heuristique (contact, à propos,
 * services, tarifs, FAQ…) pour que les bonnes pages soient pré-cochées.
 *
 * Les URLs réellement envoyées à Chapote pour la génération sont choisies par
 * l'utilisateur dans cette liste (cap 15, même host), puis relayées par le proxy
 * REST (POST /site/generate -> /api/account/bots/{id}/generate-from-urls).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Chapote_BO_Pages {

    /** Plafond dur de contenus listés (protège d'une WP_Query démesurée). */
    const CAP = 300;

    /**
     * Liste les contenus publics publiés, triés pertinents d'abord.
     *
     * @param array $args { s?:string, page?:int, per_page?:int }
     * @return array {
     *   pages: array<int, array{id,type,title,url,slug,date,menu_order,is_front,relevant,relevance_score}>,
     *   total:int, page:int, per_page:int, has_more:bool, home_url:string, site_host:string
     * }
     */
    public static function list_published($args = array()) {
        $args = wp_parse_args($args, array(
            's'        => '',
            'page'     => 1,
            'per_page' => 100,
        ));

        $search   = trim(sanitize_text_field((string) $args['s']));
        $page     = max(1, (int) $args['page']);
        $per_page = (int) $args['per_page'];
        if ($per_page < 1) {
            $per_page = 100;
        }
        if ($per_page > self::CAP) {
            $per_page = self::CAP;
        }

        // Types de contenu publics, hors pièces jointes (non pertinentes ici).
        $types = get_post_types(array('public' => true), 'names');
        unset($types['attachment']);
        $types = array_values($types);

        $front_id  = (int) get_option('page_on_front');
        $home_url  = home_url('/');
        $front_url = $front_id ? get_permalink($front_id) : $home_url;

        $q = new WP_Query(array(
            'post_type'           => $types,
            'post_status'         => 'publish',
            'posts_per_page'      => $per_page,
            'paged'               => $page,
            'orderby'             => 'menu_order date',
            'order'               => 'ASC',
            's'                   => $search,
            'ignore_sticky_posts' => true,
            'no_found_rows'       => false,
        ));

        $items = array();
        foreach ($q->posts as $post) {
            $url = get_permalink($post);
            if (!$url) {
                continue;
            }
            $id       = (int) $post->ID;
            $title    = get_the_title($post);
            $is_front = ($front_id && $id === $front_id);
            $rel      = self::relevance($post->post_name, $title, $is_front);

            $items[] = array(
                'id'              => $id,
                'type'            => $post->post_type,
                'title'           => Chapote_BO_Options::str_cap(wp_strip_all_tags($title !== '' ? $title : $url), 200),
                'url'             => $url,
                'slug'            => $post->post_name,
                'date'            => $post->post_date_gmt ? $post->post_date_gmt : $post->post_date,
                'menu_order'      => (int) $post->menu_order,
                'is_front'        => (bool) $is_front,
                'relevant'        => $rel['relevant'],
                'relevance_score' => $rel['relevance_score'],
            );
        }

        // Home TOUJOURS en tête : si la page d'accueil (front statique ou blog)
        // n'est pas déjà présente (1re page, hors recherche), on l'insère.
        if ($page === 1 && $search === '') {
            $has_home = false;
            foreach ($items as $it) {
                if (!empty($it['is_front']) || $it['url'] === $home_url) {
                    $has_home = true;
                    break;
                }
            }
            if (!$has_home) {
                $blog_name = get_bloginfo('name');
                array_unshift($items, array(
                    'id'              => $front_id,
                    'type'            => $front_id ? (string) get_post_type($front_id) : 'page',
                    'title'           => Chapote_BO_Options::str_cap($blog_name !== '' ? $blog_name : __('Page d’accueil', 'chapote-bot-manager'), 200),
                    'url'             => $front_url ? $front_url : $home_url,
                    'slug'            => '',
                    'date'            => '',
                    'menu_order'      => 0,
                    'is_front'        => true,
                    'relevant'        => true,
                    'relevance_score' => 1000,
                ));
            }
        }

        // Tri serveur : home d'abord, puis pertinents (score desc), puis
        // menu_order asc / date desc. Le front-end peut s'appuyer dessus tel quel.
        usort($items, function ($a, $b) {
            $fa = !empty($a['is_front']);
            $fb = !empty($b['is_front']);
            if ($fa !== $fb) {
                return $fa ? -1 : 1;
            }
            if ($a['relevant'] !== $b['relevant']) {
                return $a['relevant'] ? -1 : 1;
            }
            if ($a['relevance_score'] !== $b['relevance_score']) {
                return ($b['relevance_score'] < $a['relevance_score']) ? -1 : 1;
            }
            if ($a['menu_order'] !== $b['menu_order']) {
                return ($a['menu_order'] < $b['menu_order']) ? -1 : 1;
            }
            return strcmp((string) $b['date'], (string) $a['date']);
        });

        $total = (int) $q->found_posts;
        return array(
            'pages'     => array_values($items),
            'total'     => $total,
            'page'      => $page,
            'per_page'  => $per_page,
            'has_more'  => ($page * $per_page) < $total,
            'home_url'  => $home_url,
            'site_host' => (string) wp_parse_url($home_url, PHP_URL_HOST),
        );
    }

    /**
     * Pertinence heuristique d'un contenu pour un chatbot (regex sur slug+titre).
     * La page d'accueil est toujours pertinente. Les pages légales sont reconnues
     * mais NON pré-cochées (contenu boilerplate peu utile à la base de connaissance).
     *
     * @return array{relevant:bool, relevance_score:int}
     */
    public static function relevance($slug, $title, $is_front) {
        if ($is_front) {
            return array('relevant' => true, 'relevance_score' => 100);
        }
        $hay = strtolower((string) $slug . ' ' . (string) $title);

        // Ordre = priorité ; le 1er motif qui matche fixe le score.
        $rules = array(
            array('/(^|[^a-z])(home|accueil)([^a-z]|$)/u', 95, true),
            array('/contact/u',                            90, true),
            array('/(a-?propos|à-?propos|about|qui-?sommes|equipe|équipe|team)/u', 85, true),
            array('/(services|prestations|solutions)/u',   80, true),
            array('/(tarifs?|prix|pricing|offres?|abonnements?)/u', 78, true),
            array('/(faq|questions|aide|support)/u',       75, true),
            array('/(mentions|legal|légal|cgu|cgv|confidentialit|privacy)/u', 15, false),
        );
        foreach ($rules as $r) {
            if (preg_match($r[0], $hay)) {
                return array('relevant' => (bool) $r[2], 'relevance_score' => (int) $r[1]);
            }
        }
        return array('relevant' => false, 'relevance_score' => 0);
    }
}
