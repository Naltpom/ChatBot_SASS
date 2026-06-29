<?php
/**
 * Proxy REST WordPress (namespace chapote-bo/v1).
 *
 * Toutes les routes exigent `manage_options` ET un nonce `wp_rest` valide.
 * Le JS admin ne parle qu'à ce proxy ; c'est lui qui détient le token (chiffré)
 * et relaie vers Chapote. Aucun appel JS direct vers Chapote (CORS + secret).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Chapote_BO_REST {

    const ID_PATTERN = '[A-Za-z0-9_\-]+';

    /** Modules de facturation connus (borne les relais config/prune). */
    const ALLOWED_MODULES = array('ai', 'inbox', 'rag', 'actions', 'mcp', 'ab', 'white_label');

    /** Vérifie capacité + nonce sur chaque route. */
    public static function can($request) {
        if (!current_user_can('manage_options')) {
            return false;
        }
        $nonce = $request->get_header('X-WP-Nonce');
        return (bool) wp_verify_nonce($nonce, 'wp_rest');
    }

    public static function register_routes() {
        $ns   = CHAPOTE_BO_REST_NS;
        $perm = array(__CLASS__, 'can');

        // --- État + réglages -------------------------------------------------
        register_rest_route($ns, '/status', array(
            'methods'             => 'GET',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'status'),
        ));
        register_rest_route($ns, '/settings', array(
            array('methods' => 'GET',  'permission_callback' => $perm, 'callback' => array(__CLASS__, 'settings_get')),
            array('methods' => 'POST', 'permission_callback' => $perm, 'callback' => array(__CLASS__, 'settings_set')),
        ));
        // Catalogue de facturation LIVE (proxy de GET /api/account/catalog).
        register_rest_route($ns, '/catalog', array(
            'methods'             => 'GET',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'catalog'),
        ));

        // --- Connexion (OAuth Authorization Code + PKCE) --------------------
        // connect/url    : renvoie l'URL d'autorisation à ouvrir dans le navigateur.
        // connect/callback : échange le code (au retour ?code=&state=) contre des tokens.
        register_rest_route($ns, '/connect/url', array(
            array('methods' => 'GET',  'permission_callback' => $perm, 'callback' => array(__CLASS__, 'connect_url')),
            array('methods' => 'POST', 'permission_callback' => $perm, 'callback' => array(__CLASS__, 'connect_url')),
        ));
        register_rest_route($ns, '/connect/callback', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'connect_callback'),
        ));
        register_rest_route($ns, '/disconnect', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'disconnect'),
        ));

        // --- Bots (relais account) ------------------------------------------
        register_rest_route($ns, '/bots', array(
            array('methods' => 'GET',  'permission_callback' => $perm, 'callback' => array(__CLASS__, 'bots_list')),
            array('methods' => 'POST', 'permission_callback' => $perm, 'callback' => array(__CLASS__, 'bots_create')),
        ));
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')', array(
            'methods'             => 'GET',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'bot_get'),
        ));
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')/appearance', array(
            'methods'             => array('POST', 'PATCH'),
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'bot_appearance'),
        ));
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')/checkout', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'bot_checkout'),
        ));
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')/link', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'bot_link'),
        ));
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')/subscription/(?P<action>update|cancel)', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'bot_subscription'),
        ));

        // --- Activation + ciblage (options locales WP) ----------------------
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')/local', array(
            array('methods' => 'GET',  'permission_callback' => $perm, 'callback' => array(__CLASS__, 'local_get')),
            array('methods' => 'POST', 'permission_callback' => $perm, 'callback' => array(__CLASS__, 'local_set')),
        ));

        // --- SEO (rendu serveur : backlink opt-in + FAQ JSON-LD) ------------
        register_rest_route($ns, '/seo', array(
            array('methods' => 'GET',  'permission_callback' => $perm, 'callback' => array(__CLASS__, 'seo_get')),
            array('methods' => 'POST', 'permission_callback' => $perm, 'callback' => array(__CLASS__, 'seo_set')),
        ));

        /* ------------------------------------------------------------------ */
        /* Onboarding guidé                                                   */
        /* ------------------------------------------------------------------ */

        // Énumération des contenus publics WP (100 % local, AUCUN appel Chapote).
        register_rest_route($ns, '/site/pages', array(
            'methods'             => 'GET',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'site_pages'),
        ));
        // Lance la génération IA depuis des URLs (crée le bot d'abord si besoin).
        register_rest_route($ns, '/site/generate', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'site_generate'),
        ));
        // Suivi du job de génération (POLLING : pas de SSE via proxy, peu fiable).
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')/tree-job/(?P<job>[A-Za-z0-9_\-]+)', array(
            'methods'             => 'GET',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'bot_tree_job'),
        ));
        // Jetons éphémères pour les fenêtres embed (éditeur/apparence) et l'aperçu.
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')/preview-token', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'bot_preview_token'),
        ));
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')/embed-token', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'bot_embed_token'),
        ));
        // Recommandation d'offre (GET pour les cas simples, POST pour porter le
        // tree_json/description sans dépendre d'un corps sur GET).
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')/recommendation', array(
            array('methods' => 'GET',  'permission_callback' => $perm, 'callback' => array(__CLASS__, 'bot_recommendation')),
            array('methods' => 'POST', 'permission_callback' => $perm, 'callback' => array(__CLASS__, 'bot_recommendation')),
        ));
        // Élague l'arbre aux modules conservés (sections retirées à la baisse d'offre).
        register_rest_route($ns, '/bots/(?P<id>' . self::ID_PATTERN . ')/tree-prune', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'bot_tree_prune'),
        ));
        // État d'onboarding (option locale WP : done / bot_id / step de reprise).
        register_rest_route($ns, '/onboarding', array(
            array('methods' => 'GET',  'permission_callback' => $perm, 'callback' => array(__CLASS__, 'onboarding_get')),
            array('methods' => 'POST', 'permission_callback' => $perm, 'callback' => array(__CLASS__, 'onboarding_set')),
        ));
    }

    /* ---------------------------------------------------------------------- */
    /* Helpers                                                                */
    /* ---------------------------------------------------------------------- */

    /** Relaie une réponse {status,data} de l'API en réponse REST. */
    private static function forward($res) {
        $status = !empty($res['status']) ? (int) $res['status'] : 502;
        if ($status === 0) {
            $status = 502;
        }
        return new WP_REST_Response($res['data'], $status);
    }

    /* ---------------------------------------------------------------------- */
    /* État + réglages                                                        */
    /* ---------------------------------------------------------------------- */

    public static function status($request) {
        $connected = Chapote_BO_Tokens::is_connected();
        $out = array(
            'connected'        => $connected,
            'crypto_available' => Chapote_BO_Crypto::available(),
            'api_base'         => Chapote_BO_Options::api_base(),
            'app_base'         => Chapote_BO_Options::app_base(),
        );

        // Compte connecté : on récupère email/nom pour l'afficher dans l'en-tête.
        // L'appel passe par account() (refresh auto + purge si session morte) ;
        // on reflète l'état RÉEL de la session après l'appel.
        if ($connected) {
            $me = Chapote_BO_API::account('GET', '/api/account/me');
            if ($me['status'] === 200 && is_array($me['data'])) {
                $out['account'] = array(
                    'email' => isset($me['data']['email']) ? sanitize_text_field((string) $me['data']['email']) : '',
                    'name'  => isset($me['data']['name']) ? sanitize_text_field((string) $me['data']['name']) : '',
                );
            } elseif ($me['status'] === 401) {
                // Session expirée/purgée pendant l'appel : on dit la vérité au JS.
                $out['connected'] = Chapote_BO_Tokens::is_connected();
            }
        }

        return new WP_REST_Response($out, 200);
    }

    /** Catalogue de facturation LIVE relayé depuis Chapote. */
    public static function catalog($request) {
        return self::forward(Chapote_BO_API::account('GET', '/api/account/catalog'));
    }

    public static function settings_get($request) {
        return new WP_REST_Response(array(
            'api_base' => Chapote_BO_Options::api_base(),
            'app_base' => Chapote_BO_Options::app_base(),
        ), 200);
    }

    public static function settings_set($request) {
        $saved_api = Chapote_BO_Options::set_api_base($request->get_param('api_base'));
        // app_base optionnel : si absent du corps, on ne touche pas au réglage.
        if ($request->get_param('app_base') !== null) {
            Chapote_BO_Options::set_app_base($request->get_param('app_base'));
        }
        return new WP_REST_Response(array(
            'api_base' => $saved_api,
            'app_base' => Chapote_BO_Options::app_base(),
        ), 200);
    }

    /* ---------------------------------------------------------------------- */
    /* Connexion OAuth (Authorization Code + PKCE)                            */
    /* ---------------------------------------------------------------------- */

    /**
     * Renvoie l'URL d'autorisation à ouvrir dans le navigateur. Le state et le
     * code_verifier sont générés et stockés CÔTÉ SERVEUR par build_authorize_url().
     */
    public static function connect_url($request) {
        if (!Chapote_BO_Crypto::available()) {
            return new WP_REST_Response(array('error' => 'crypto_unavailable'), 500);
        }
        $url = Chapote_BO_API::build_authorize_url();
        return new WP_REST_Response(array('url' => $url), 200);
    }

    /**
     * Retour d'autorisation : reçoit {code, state} (lus par le JS sur l'URL admin).
     * Vérifie le state (anti-CSRF, comparaison stricte/constant-time) contre le
     * PKCE stocké, échange le code server-to-server, stocke les tokens chiffrés.
     * Le code est one-time : on purge le PKCE quoi qu'il advienne.
     */
    public static function connect_callback($request) {
        if (!Chapote_BO_Crypto::available()) {
            return new WP_REST_Response(array('error' => 'crypto_unavailable'), 500);
        }
        $code  = trim((string) $request->get_param('code'));
        $state = (string) $request->get_param('state');
        if ($code === '' || $state === '') {
            return new WP_REST_Response(array('error' => 'invalid_request'), 400);
        }

        $pending = Chapote_BO_API::pkce_pending();
        if (!$pending) {
            return new WP_REST_Response(array('error' => 'no_pending_authorization'), 400);
        }
        // State comparé en STRICT (constant-time). Toute divergence = abandon.
        if (!hash_equals((string) $pending['state'], $state)) {
            Chapote_BO_API::clear_pkce_pending();
            return new WP_REST_Response(array('error' => 'state_mismatch'), 400);
        }

        $res = Chapote_BO_API::exchange_code($code, $pending['verifier']);
        Chapote_BO_API::clear_pkce_pending();

        if ($res['status'] === 200 && Chapote_BO_Tokens::is_connected()) {
            return new WP_REST_Response(array('status' => 'connected'), 200);
        }
        // Remonte l'erreur du serveur d'autorisation (invalid_grant / invalid_request…).
        return self::forward($res);
    }

    public static function disconnect($request) {
        $t = Chapote_BO_Tokens::get();
        if ($t && !empty($t['refresh_token'])) {
            Chapote_BO_API::revoke($t['refresh_token']);
        }
        Chapote_BO_Tokens::clear();
        Chapote_BO_API::clear_pkce_pending();
        return new WP_REST_Response(array('status' => 'disconnected'), 200);
    }

    /* ---------------------------------------------------------------------- */
    /* Bots (relais account)                                                  */
    /* ---------------------------------------------------------------------- */

    public static function bots_list($request) {
        $res = Chapote_BO_API::account('GET', '/api/account/bots');
        // Annote chaque bot avec son état d'AFFICHAGE local (WP) pour le toggle
        // on/off direct dans « Mes bots » et l'en-tête (évite un appel /local par bot).
        if (!empty($res['status']) && (int) $res['status'] === 200 && is_array($res['data'])) {
            $res['data'] = self::annotate_local_enabled($res['data']);
        }
        return self::forward($res);
    }

    /** Ajoute `enabled` (état d'affichage local WP) à chaque bot d'une liste, que
     *  la réponse soit un tableau de bots ou une enveloppe { bots: [...] }. */
    private static function annotate_local_enabled($data) {
        $annotate = function (&$b) {
            if (is_array($b) && isset($b['id'])) {
                $local = Chapote_BO_Options::bot_local((string) $b['id']);
                $b['enabled'] = !empty($local['enabled']);
            }
        };
        if (isset($data['bots']) && is_array($data['bots'])) {
            foreach ($data['bots'] as &$b) { $annotate($b); }
            unset($b);
        } elseif (is_array($data)) {
            foreach ($data as &$b) { $annotate($b); }
            unset($b);
        }
        return $data;
    }

    public static function bots_create($request) {
        $name = sanitize_text_field((string) $request->get_param('name'));
        $mode = (string) $request->get_param('mode');
        if (!in_array($mode, array('tree', 'ai', 'hybrid'), true)) {
            $mode = 'hybrid';
        }
        if ($name === '') {
            return new WP_REST_Response(array('error' => 'name_required'), 400);
        }
        return self::forward(Chapote_BO_API::account('POST', '/api/account/bots', array(
            'name' => $name,
            'mode' => $mode,
        )));
    }

    public static function bot_get($request) {
        $id = (string) $request->get_param('id');
        return self::forward(Chapote_BO_API::account('GET', '/api/account/bots/' . rawurlencode($id)));
    }

    public static function bot_appearance($request) {
        $id     = (string) $request->get_param('id');
        $design = $request->get_param('design_json');
        if (!is_array($design)) {
            return new WP_REST_Response(array('error' => 'design_json_required'), 400);
        }
        // On NE sanitise PAS les valeurs métier ici (le backend _sanitize_design
        // est la source de vérité, whitelist/bornes) ; on relaie tel quel.
        return self::forward(Chapote_BO_API::account(
            'PATCH',
            '/api/account/bots/' . rawurlencode($id) . '/appearance',
            array('design_json' => $design)
        ));
    }

    public static function bot_checkout($request) {
        $id      = (string) $request->get_param('id');
        $config  = $request->get_param('config');
        $consent = (bool) $request->get_param('consent');

        $clean = self::sanitize_billing_config(is_array($config) ? $config : array());

        // success_url / cancel_url DOIVENT pointer vers l'admin WP (même host).
        $admin   = admin_url('admin.php');
        $success = add_query_arg(array('page' => 'chapote-chatbot', 'cbo_status' => 'success', 'cbo_bot' => $id), $admin);
        $cancel  = add_query_arg(array('page' => 'chapote-chatbot', 'cbo_status' => 'cancel',  'cbo_bot' => $id), $admin);

        return self::forward(Chapote_BO_API::account(
            'POST',
            '/api/account/bots/' . rawurlencode($id) . '/checkout',
            array(
                'config'      => $clean,
                'grouping'    => 'per_bot',
                'consent'     => $consent,
                'success_url' => $success,
                'cancel_url'  => $cancel,
            )
        ));
    }

    public static function bot_link($request) {
        $id      = (string) $request->get_param('id');
        $post_id = $request->get_param('wordpress_post_id');
        $body    = array('wordpress_site_url' => home_url());
        if ($post_id !== null && $post_id !== '') {
            $body['wordpress_post_id'] = (int) $post_id;
        }
        return self::forward(Chapote_BO_API::account(
            'POST',
            '/api/account/bots/' . rawurlencode($id) . '/link',
            $body
        ));
    }

    public static function bot_subscription($request) {
        $id     = (string) $request->get_param('id');
        $action = (string) $request->get_param('action'); // update | cancel
        $body   = null;
        if ($action === 'update') {
            $config = $request->get_param('config');
            $body   = array('config' => self::sanitize_billing_config(is_array($config) ? $config : array()));
        }
        return self::forward(Chapote_BO_API::account(
            'POST',
            '/api/account/bots/' . rawurlencode($id) . '/subscription/' . $action,
            $body
        ));
    }

    /** Borne la config de facturation aux clés/modules connus avant relais. */
    private static function sanitize_billing_config(array $config) {
        $modules = self::sanitize_module_list(isset($config['modules']) ? $config['modules'] : array());
        $out = array(
            'modules' => array_values(array_unique($modules)),
            'ai_byok' => !empty($config['ai_byok']),
        );
        if (!empty($config['ai_tier_id'])) {
            $out['ai_tier_id'] = sanitize_text_field((string) $config['ai_tier_id']);
        } else {
            $out['ai_tier_id'] = null;
        }
        return $out;
    }

    /* ---------------------------------------------------------------------- */
    /* Activation + ciblage (100 % WordPress)                                 */
    /* ---------------------------------------------------------------------- */

    public static function local_get($request) {
        $id    = (string) $request->get_param('id');
        $local = Chapote_BO_Options::bot_local($id);
        $targeting = isset($local['targeting']) && is_array($local['targeting'])
            ? wp_parse_args($local['targeting'], Chapote_BO_Options::default_targeting())
            : Chapote_BO_Options::default_targeting();

        return new WP_REST_Response(array(
            'enabled'        => !empty($local['enabled']),
            'public_key'     => isset($local['public_key']) ? $local['public_key'] : '',
            'billing_status' => isset($local['billing_status']) ? $local['billing_status'] : '',
            'targeting'      => $targeting,
        ), 200);
    }

    public static function local_set($request) {
        $id = (string) $request->get_param('id');

        // `enabled` ET `targeting` sont INDÉPENDAMMENT optionnels : un paramètre
        // ABSENT est PRÉSERVÉ (save_bot_local fusionne). Ainsi le toggle on/off
        // direct (« Mes bots » / en-tête, n'envoie que `enabled`) ne réinitialise
        // PAS le ciblage, et l'enregistrement du ciblage (onglet, n'envoie que
        // `targeting`) ne change PAS l'état d'affichage.
        $existing    = Chapote_BO_Options::bot_local($id);
        $raw_enabled = $request->get_param('enabled');
        $enabled = ($raw_enabled !== null) ? (bool) $raw_enabled : !empty($existing['enabled']);

        $raw_targeting = $request->get_param('targeting');
        $has_targeting = ($raw_targeting !== null);
        $targeting = $has_targeting ? self::sanitize_targeting($raw_targeting) : null;

        // Le widget Chapote sert TOUS les bots servables : l'activation sur le site
        // n'exige PAS d'abonnement payant (un bot gratuit/essai fonctionne, l'IA étant
        // simplement bornée au quota gratuit). On récupère le détail pour la clé
        // publique + le nom + le statut de facturation (affichage), sans bloquer.
        if ($enabled) {
            $detail = Chapote_BO_API::account('GET', '/api/account/bots/' . rawurlencode($id));
            if ($detail['status'] !== 200) {
                return self::forward($detail);
            }
            $billing    = isset($detail['data']['billing_status']) ? (string) $detail['data']['billing_status'] : '';
            $public_key = isset($detail['data']['public_key']) ? (string) $detail['data']['public_key'] : '';
            $name       = isset($detail['data']['name']) ? sanitize_text_field((string) $detail['data']['name']) : '';

            // Best-effort : enregistre le lien site↔bot côté Chapote (ignoré si échec).
            Chapote_BO_API::account('POST', '/api/account/bots/' . rawurlencode($id) . '/link', array(
                'wordpress_site_url' => home_url(),
            ));

            $save = array(
                'enabled'        => true,
                'public_key'     => $public_key,
                'billing_status' => $billing,
                'name'           => $name,
            );
            if ($has_targeting) {
                $save['targeting'] = $targeting;  // sinon ciblage existant préservé (merge)
            }
            Chapote_BO_Options::save_bot_local($id, $save);
        } else {
            // Désactivation : on conserve la clé/le ciblage mais on coupe l'injection.
            $save = array('enabled' => false);
            if ($has_targeting) {
                $save['targeting'] = $targeting;
            }
            Chapote_BO_Options::save_bot_local($id, $save);
        }

        return self::local_get($request);
    }

    /** Assainit la structure de ciblage envoyée par le JS. */
    private static function sanitize_targeting($raw) {
        $defaults = Chapote_BO_Options::default_targeting();
        if (!is_array($raw)) {
            return $defaults;
        }
        $mode = (isset($raw['mode']) && $raw['mode'] === 'custom') ? 'custom' : 'everywhere';

        $to_int_list = function ($v) {
            $out = array();
            if (is_array($v)) {
                foreach ($v as $x) {
                    $n = (int) $x;
                    if ($n > 0) {
                        $out[] = $n;
                    }
                }
            }
            return array_values(array_unique($out));
        };

        // Filtre une liste de slugs sur les types de contenu publics réels.
        $public_types = get_post_types(array('public' => true), 'names');
        $valid_types = function ($v) use ($public_types) {
            $out = array();
            if (is_array($v)) {
                foreach ($v as $t) {
                    $t = sanitize_key((string) $t);
                    if (isset($public_types[$t])) {
                        $out[] = $t;
                    }
                }
            }
            return array_values(array_unique($out));
        };

        return array(
            'mode'          => $mode,
            'include_front' => !empty($raw['include_front']),
            'include_types' => $valid_types(isset($raw['include_types']) ? $raw['include_types'] : array()),
            'include_ids'   => $to_int_list(isset($raw['include_ids']) ? $raw['include_ids'] : array()),
            'exclude_types' => $valid_types(isset($raw['exclude_types']) ? $raw['exclude_types'] : array()),
            'exclude_ids'   => $to_int_list(isset($raw['exclude_ids']) ? $raw['exclude_ids'] : array()),
        );
    }

    /* ---------------------------------------------------------------------- */
    /* SEO (option locale chapote_bo_seo, rendue côté serveur)                */
    /* ---------------------------------------------------------------------- */

    public static function seo_get($request) {
        // Source unique (lecture défensive + défauts) = Chapote_BO_SEO::get_settings().
        return new WP_REST_Response(Chapote_BO_SEO::get_settings(), 200);
    }

    public static function seo_set($request) {
        // powered_by : booléen strict (backlink opt-in).
        $powered_by = (bool) $request->get_param('powered_by');

        // faq : liste de paires { q, a } nettoyées et BORNÉES côté serveur (les
        // maxlength du JS sont cosmétiques/contournables). q = texte simple,
        // a = wp_kses_post (un peu de HTML toléré). Cap : 50 paires, q<=300, a<=2000.
        $raw_faq = $request->get_param('faq');
        $faq = array();
        if (is_array($raw_faq)) {
            foreach ($raw_faq as $item) {
                if (count($faq) >= 50) {
                    break; // cap dur : évite une option démesurée
                }
                if (!is_array($item)) {
                    continue;
                }
                $q = isset($item['q']) ? sanitize_text_field((string) $item['q']) : '';
                $a = isset($item['a']) ? trim(wp_kses_post((string) $item['a'])) : '';
                if ($q === '' || $a === '') {
                    continue;
                }
                $faq[] = array(
                    'q' => Chapote_BO_Options::str_cap($q, 300),
                    'a' => Chapote_BO_Options::str_cap($a, 2000),
                );
            }
        }

        update_option('chapote_bo_seo', array(
            'powered_by' => $powered_by,
            'faq'        => array_values($faq),
        ));

        // État re-normalisé (forme garantie côté JS).
        return new WP_REST_Response(Chapote_BO_SEO::get_settings(), 200);
    }

    /* ---------------------------------------------------------------------- */
    /* Onboarding guidé                                                       */
    /* ---------------------------------------------------------------------- */

    /** Liste des contenus publics WP (local) pour l'écran de sélection. */
    public static function site_pages($request) {
        $out = Chapote_BO_Pages::list_published(array(
            's'        => (string) $request->get_param('s'),
            'page'     => (int) $request->get_param('page'),
            'per_page' => (int) $request->get_param('per_page'),
        ));
        return new WP_REST_Response($out, 200);
    }

    /**
     * Lance la génération IA depuis une liste d'URLs. Crée le bot AVANT (POST
     * /api/account/bots) s'il n'existe pas encore, puis relaie generate-from-urls.
     * Réponse augmentée du `bot_id` pour que le JS suive le job sur le bon bot.
     * Sécurité : URLs bornées au MÊME HOST que le site (anti-SSRF) et cap 15.
     */
    public static function site_generate($request) {
        $bot_id = trim((string) $request->get_param('bot_id'));

        if ($bot_id === '') {
            $name = sanitize_text_field((string) $request->get_param('name'));
            if ($name === '') {
                $name = self::default_bot_name();
            }
            $created = Chapote_BO_API::account('POST', '/api/account/bots', array(
                'name' => Chapote_BO_Options::str_cap($name, 80),
                'mode' => 'hybrid',
            ));
            $cstatus = (int) $created['status'];
            if ($cstatus !== 200 && $cstatus !== 201) {
                return self::forward($created);
            }
            $bot_id = isset($created['data']['id']) ? (string) $created['data']['id'] : '';
            if ($bot_id === '') {
                return new WP_REST_Response(array('error' => 'bot_create_failed'), 502);
            }
        }

        $urls = self::sanitize_url_list($request->get_param('urls'), 15);
        if (empty($urls)) {
            return new WP_REST_Response(array('error' => 'urls_required'), 400);
        }

        $body = array('urls' => $urls);
        $desc = $request->get_param('description');
        if ($desc !== null && trim((string) $desc) !== '') {
            $body['description'] = Chapote_BO_Options::str_cap(sanitize_textarea_field((string) $desc), 2000);
        }
        $vpm = $request->get_param('visitors_per_month');
        if ($vpm !== null && $vpm !== '') {
            $body['visitors_per_month'] = max(0, (int) $vpm);
        }
        $excl = $request->get_param('exclude_modules');
        if (is_array($excl)) {
            $body['exclude_modules'] = self::sanitize_module_list($excl);
        }

        $res = Chapote_BO_API::account(
            'POST',
            '/api/account/bots/' . rawurlencode($bot_id) . '/generate-from-urls',
            $body
        );
        if (is_array($res['data'])) {
            $res['data']['bot_id'] = $bot_id; // le JS en a besoin pour suivre le job
        }
        return self::forward($res);
    }

    /** Suivi du job de génération (relais generate-status). */
    public static function bot_tree_job($request) {
        $id  = (string) $request->get_param('id');
        $job = (string) $request->get_param('job');
        return self::forward(Chapote_BO_API::account(
            'GET',
            '/api/account/bots/' . rawurlencode($id) . '/generate-status?job_id=' . rawurlencode($job)
        ));
    }

    /** Mint d'un jeton d'aperçu (iframe widget-frame). */
    public static function bot_preview_token($request) {
        $id = (string) $request->get_param('id');
        return self::forward(Chapote_BO_API::account('POST', '/api/account/bots/' . rawurlencode($id) . '/preview-token'));
    }

    /** Mint d'un jeton embed (fenêtres éditeur d'arbre / apparence du dashboard). */
    public static function bot_embed_token($request) {
        $id = (string) $request->get_param('id');
        return self::forward(Chapote_BO_API::account('POST', '/api/account/bots/' . rawurlencode($id) . '/embed-token'));
    }

    /** Recommandation d'offre (modules requis/conseillés, palier IA, volume). */
    public static function bot_recommendation($request) {
        $id   = (string) $request->get_param('id');
        $body = array();

        $desc = $request->get_param('description');
        if ($desc !== null && trim((string) $desc) !== '') {
            $body['description'] = Chapote_BO_Options::str_cap(sanitize_textarea_field((string) $desc), 2000);
        }
        $vpm = $request->get_param('visitors_per_month');
        if ($vpm !== null && $vpm !== '') {
            $body['visitors_per_month'] = max(0, (int) $vpm);
        }
        // tree_json relayé tel quel : le backend est la source de vérité (validation).
        $tree = $request->get_param('tree_json');
        if (is_array($tree)) {
            $body['tree_json'] = $tree;
        }

        return self::forward(Chapote_BO_API::account(
            'POST',
            '/api/account/bots/' . rawurlencode($id) . '/recommendation',
            $body
        ));
    }

    /** Élague l'arbre aux seuls modules conservés (relais tree/prune). */
    public static function bot_tree_prune($request) {
        $id   = (string) $request->get_param('id');
        $kept = self::sanitize_module_list($request->get_param('kept_modules'));
        return self::forward(Chapote_BO_API::account(
            'POST',
            '/api/account/bots/' . rawurlencode($id) . '/tree/prune',
            array('kept_modules' => $kept)
        ));
    }

    /** État d'onboarding (option locale). */
    public static function onboarding_get($request) {
        return new WP_REST_Response(Chapote_BO_Options::onboarding(), 200);
    }

    /** Met à jour l'état d'onboarding (champs présents seulement). */
    public static function onboarding_set($request) {
        $data = array();
        if ($request->get_param('done') !== null) {
            $data['done'] = (bool) $request->get_param('done');
        }
        if ($request->get_param('bot_id') !== null) {
            $data['bot_id'] = sanitize_text_field((string) $request->get_param('bot_id'));
        }
        if ($request->get_param('step') !== null) {
            $data['step'] = sanitize_key((string) $request->get_param('step'));
        }
        return new WP_REST_Response(Chapote_BO_Options::save_onboarding($data), 200);
    }

    /* ---------------------------------------------------------------------- */
    /* Helpers onboarding                                                     */
    /* ---------------------------------------------------------------------- */

    /** Borne une liste de clés de modules aux modules connus (dédupliquée). */
    private static function sanitize_module_list($raw) {
        $out = array();
        if (is_array($raw)) {
            foreach ($raw as $m) {
                $m = sanitize_text_field((string) $m);
                if (in_array($m, self::ALLOWED_MODULES, true) && !in_array($m, $out, true)) {
                    $out[] = $m;
                }
            }
        }
        return array_values($out);
    }

    /**
     * Assainit une liste d'URLs : http(s), MÊME HOST que le site (anti-SSRF),
     * dédupliquée, plafonnée à $cap. Les URLs proviennent des pages WP et des
     * ajouts manuels même-host ; on revérifie côté serveur (cap 15 du wizard).
     */
    private static function sanitize_url_list($raw, $cap) {
        if (!is_array($raw)) {
            return array();
        }
        $site_host = self::site_host_normalized();
        $out = array();
        foreach ($raw as $u) {
            if (count($out) >= $cap) {
                break;
            }
            $u = esc_url_raw(trim((string) $u), array('http', 'https'));
            if ($u === '') {
                continue;
            }
            $host = wp_parse_url($u, PHP_URL_HOST);
            if (!$host || self::normalize_host($host) !== $site_host) {
                continue; // host étranger rejeté
            }
            if (!in_array($u, $out, true)) {
                $out[] = $u;
            }
        }
        return $out;
    }

    /** Host du site, normalisé (minuscule, sans préfixe www). */
    private static function site_host_normalized() {
        return self::normalize_host((string) wp_parse_url(home_url(), PHP_URL_HOST));
    }

    /** Normalise un host pour comparaison (minuscule, www. retiré). */
    private static function normalize_host($h) {
        return preg_replace('/^www\./', '', strtolower((string) $h));
    }

    /** Nom de bot par défaut (titre du site, repli host). */
    private static function default_bot_name() {
        $name = sanitize_text_field((string) get_bloginfo('name'));
        if ($name === '') {
            $name = (string) wp_parse_url(home_url(), PHP_URL_HOST);
        }
        if ($name === '') {
            $name = 'Mon assistant';
        }
        return $name;
    }
}
