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

        // --- Connexion (device flow) ----------------------------------------
        register_rest_route($ns, '/connect/start', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'connect_start'),
        ));
        register_rest_route($ns, '/connect/poll', array(
            'methods'             => 'POST',
            'permission_callback' => $perm,
            'callback'            => array(__CLASS__, 'connect_poll'),
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
        return new WP_REST_Response(array('api_base' => Chapote_BO_Options::api_base()), 200);
    }

    public static function settings_set($request) {
        $api = $request->get_param('api_base');
        $saved = Chapote_BO_Options::set_api_base($api);
        return new WP_REST_Response(array('api_base' => $saved), 200);
    }

    /* ---------------------------------------------------------------------- */
    /* Connexion device flow                                                  */
    /* ---------------------------------------------------------------------- */

    private static function device_transient_key() {
        return 'chapote_bo_device_' . get_current_user_id();
    }

    public static function connect_start($request) {
        if (!Chapote_BO_Crypto::available()) {
            return new WP_REST_Response(array('error' => 'crypto_unavailable'), 500);
        }
        $res = Chapote_BO_API::device_start(home_url());
        if ($res['status'] !== 200 || empty($res['data']['device_code'])) {
            return self::forward($res);
        }
        $d        = $res['data'];
        $interval = isset($d['interval']) ? max(1, (int) $d['interval']) : 5;
        $expires  = isset($d['expires_in']) ? max(60, (int) $d['expires_in']) : 600;

        // device_code conservé CÔTÉ SERVEUR (transient par utilisateur), jamais exposé au JS.
        set_transient(self::device_transient_key(), array(
            'device_code' => $d['device_code'],
            'interval'    => $interval,
        ), $expires);

        // On ne renvoie au navigateur que les éléments publics du flow.
        return new WP_REST_Response(array(
            'user_code'                 => isset($d['user_code']) ? $d['user_code'] : '',
            'verification_uri'          => isset($d['verification_uri']) ? $d['verification_uri'] : '',
            'verification_uri_complete' => isset($d['verification_uri_complete']) ? $d['verification_uri_complete'] : (isset($d['verification_uri']) ? $d['verification_uri'] : ''),
            'expires_in'                => $expires,
            'interval'                  => $interval,
        ), 200);
    }

    public static function connect_poll($request) {
        $key     = self::device_transient_key();
        $pending = get_transient($key);
        if (!$pending || empty($pending['device_code'])) {
            return new WP_REST_Response(array('status' => 'expired'), 200);
        }

        $res = Chapote_BO_API::device_poll($pending['device_code']);

        if ($res['status'] === 200 && !empty($res['data']['access_token'])) {
            $d  = $res['data'];
            $ok = Chapote_BO_Tokens::save(
                $d['access_token'],
                isset($d['refresh_token']) ? $d['refresh_token'] : '',
                isset($d['expires_in']) ? $d['expires_in'] : 0,
                isset($d['scope']) ? $d['scope'] : '',
                isset($d['token_type']) ? $d['token_type'] : 'Bearer'
            );
            delete_transient($key);
            if (!$ok) {
                return new WP_REST_Response(array('status' => 'error', 'error' => 'storage_failed'), 200);
            }
            return new WP_REST_Response(array('status' => 'connected'), 200);
        }

        $err = isset($res['data']['error']) ? $res['data']['error'] : 'unknown';
        if (in_array($err, array('authorization_pending', 'slow_down'), true)) {
            if ($err === 'slow_down') {
                $pending['interval'] = (isset($pending['interval']) ? (int) $pending['interval'] : 5) + 5;
                set_transient($key, $pending, 600);
            }
            return new WP_REST_Response(array(
                'status'   => 'pending',
                'interval' => isset($pending['interval']) ? (int) $pending['interval'] : 5,
            ), 200);
        }

        // Terminal : expired_token / access_denied / autre.
        delete_transient($key);
        return new WP_REST_Response(array('status' => 'error', 'error' => $err), 200);
    }

    public static function disconnect($request) {
        $t = Chapote_BO_Tokens::get();
        if ($t && !empty($t['refresh_token'])) {
            Chapote_BO_API::revoke($t['refresh_token']);
        }
        Chapote_BO_Tokens::clear();
        delete_transient(self::device_transient_key());
        return new WP_REST_Response(array('status' => 'disconnected'), 200);
    }

    /* ---------------------------------------------------------------------- */
    /* Bots (relais account)                                                  */
    /* ---------------------------------------------------------------------- */

    public static function bots_list($request) {
        return self::forward(Chapote_BO_API::account('GET', '/api/account/bots'));
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
        $success = add_query_arg(array('page' => 'chapote-backoffice', 'cbo_status' => 'success', 'cbo_bot' => $id), $admin);
        $cancel  = add_query_arg(array('page' => 'chapote-backoffice', 'cbo_status' => 'cancel',  'cbo_bot' => $id), $admin);

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
        $allowed_modules = array('ai', 'inbox', 'rag', 'actions', 'mcp', 'ab', 'white_label');
        $modules = array();
        if (isset($config['modules']) && is_array($config['modules'])) {
            foreach ($config['modules'] as $m) {
                $m = sanitize_text_field((string) $m);
                if (in_array($m, $allowed_modules, true)) {
                    $modules[] = $m;
                }
            }
        }
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
        $id        = (string) $request->get_param('id');
        $enabled   = (bool) $request->get_param('enabled');
        $targeting = self::sanitize_targeting($request->get_param('targeting'));

        // VERROU PRODUIT : on n'active sur le site QUE si le bot est payé (active).
        // On revalide TOUJOURS côté serveur (jamais sur la foi du client).
        if ($enabled) {
            $detail = Chapote_BO_API::account('GET', '/api/account/bots/' . rawurlencode($id));
            if ($detail['status'] !== 200) {
                return self::forward($detail);
            }
            $billing = isset($detail['data']['billing_status']) ? (string) $detail['data']['billing_status'] : '';
            if ($billing !== 'active') {
                return new WP_REST_Response(array(
                    'error'          => 'not_active',
                    'billing_status' => $billing,
                ), 403);
            }
            $public_key = isset($detail['data']['public_key']) ? (string) $detail['data']['public_key'] : '';
            $name       = isset($detail['data']['name']) ? sanitize_text_field((string) $detail['data']['name']) : '';

            // Best-effort : enregistre le lien site↔bot côté Chapote (ignoré si échec).
            Chapote_BO_API::account('POST', '/api/account/bots/' . rawurlencode($id) . '/link', array(
                'wordpress_site_url' => home_url(),
            ));

            Chapote_BO_Options::save_bot_local($id, array(
                'enabled'        => true,
                'public_key'     => $public_key,
                'billing_status' => $billing,
                'name'           => $name,
                'targeting'      => $targeting,
            ));
        } else {
            // Désactivation : on conserve la clé mais on coupe l'injection.
            Chapote_BO_Options::save_bot_local($id, array(
                'enabled'   => false,
                'targeting' => $targeting,
            ));
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
}
