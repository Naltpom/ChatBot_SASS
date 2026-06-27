<?php
/**
 * Client HTTP server-to-server vers l'API Chapote.
 *
 * Toute la mécanique OAuth (Authorization Code + PKCE, refresh par rotation,
 * revoke) et tous les appels « account » passent par ici, DEPUIS LE PHP. Le
 * navigateur ne voit jamais le token : il parle au proxy REST
 * (class-chapote-bo-rest.php), qui appelle ces méthodes.
 *
 * Toutes les méthodes renvoient un tableau uniforme :
 *   array( 'status' => int, 'data' => array )
 * status 0 = erreur réseau locale (wp_remote_*).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Chapote_BO_API {

    /** Adresse de l'API courante. */
    public static function base() {
        return Chapote_BO_Options::api_base();
    }

    /* ---------------------------------------------------------------------- */
    /* Transport brut                                                         */
    /* ---------------------------------------------------------------------- */

    /**
     * @param string     $method  GET|POST|PATCH|...
     * @param string     $path    chemin commençant par /api/...
     * @param array|null $body    corps JSON (ou null)
     * @param array      $headers en-têtes supplémentaires
     * @return array{status:int,data:array}
     */
    private static function request($method, $path, $body = null, $headers = array()) {
        $args = array(
            'method'  => $method,
            'timeout' => 20,
            'headers' => array_merge(array('Accept' => 'application/json'), $headers),
        );
        if ($body !== null) {
            $args['headers']['Content-Type'] = 'application/json';
            $args['body'] = wp_json_encode($body);
        }

        $res = wp_remote_request(self::base() . $path, $args);
        if (is_wp_error($res)) {
            return array(
                'status' => 0,
                'data'   => array('error' => 'network_error', 'message' => $res->get_error_message()),
            );
        }

        $code = (int) wp_remote_retrieve_response_code($res);
        $raw  = wp_remote_retrieve_body($res);
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            $data = array('raw' => is_string($raw) ? $raw : '');
        }
        return array('status' => $code, 'data' => $data);
    }

    /* ---------------------------------------------------------------------- */
    /* OAuth Authorization Code + PKCE (S256, RFC 7636)                        */
    /* ---------------------------------------------------------------------- */

    /**
     * redirect_uri = page admin du plugin. Constante et IDENTIQUE entre la
     * construction de l'URL d'autorisation et l'échange du code (le serveur
     * d'autorisation exige une correspondance stricte). Sans code/state.
     */
    public static function redirect_uri() {
        return admin_url('admin.php?page=chapote-backoffice');
    }

    /** Clé du transient PKCE (un en-cours par utilisateur WP). */
    private static function pkce_key() {
        return 'chapote_bo_pkce_' . get_current_user_id();
    }

    /** base64url SANS padding : '+/' → '-_' et '=' retiré (RFC 7636 §A). */
    public static function b64url($bin) {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    /** Octets aléatoires cryptographiques (random_bytes, repli openssl). */
    private static function random_bytes_safe($len) {
        try {
            return random_bytes($len);
        } catch (Exception $e) {
            return openssl_random_pseudo_bytes($len);
        }
    }

    /**
     * Construit l'URL d'autorisation (Authorization Code + PKCE/S256).
     *
     * Génère un state (anti-CSRF), un code_verifier (86 car. base64url, dans la
     * borne 43-128) et le code_challenge = base64url(sha256(verifier)). Le state
     * ET le verifier sont conservés CÔTÉ SERVEUR (transient par utilisateur),
     * jamais exposés au navigateur. Renvoie l'URL ABSOLUE à ouvrir, pointant vers
     * l'écran de consentement du DASHBOARD (app_base), pas l'API.
     *
     * @return string
     */
    public static function build_authorize_url() {
        $state     = self::b64url(self::random_bytes_safe(32));
        $verifier  = self::b64url(self::random_bytes_safe(64));
        $challenge = self::b64url(hash('sha256', $verifier, true));

        set_transient(self::pkce_key(), array(
            'state'    => $state,
            'verifier' => $verifier,
        ), 10 * MINUTE_IN_SECONDS);

        $args = array(
            'response_type'         => 'code',
            'client_id'             => CHAPOTE_BO_OAUTH_CLIENT_ID,
            'redirect_uri'          => self::redirect_uri(),
            'state'                 => $state,
            'code_challenge'        => $challenge,
            'code_challenge_method' => 'S256',
            'scope'                 => 'plugin',
        );
        return Chapote_BO_Options::app_base()
            . '/authorize?' . http_build_query($args, '', '&', PHP_QUERY_RFC3986);
    }

    /** PKCE en attente { state, verifier } pour l'utilisateur courant, ou null. */
    public static function pkce_pending() {
        $p = get_transient(self::pkce_key());
        if (is_array($p) && !empty($p['verifier']) && isset($p['state'])) {
            return $p;
        }
        return null;
    }

    /** Purge le PKCE en attente (code one-time : on nettoie après échange). */
    public static function clear_pkce_pending() {
        delete_transient(self::pkce_key());
    }

    /**
     * Échange le code d'autorisation contre une paire de tokens
     * (grant authorization_code, server-to-server) puis stocke les tokens
     * chiffrés. Le redirect_uri envoyé est IDENTIQUE à celui de l'autorisation.
     *
     * @return array{status:int,data:array}
     */
    public static function exchange_code($code, $code_verifier) {
        $res = self::request('POST', '/api/oauth/token', array(
            'grant_type'    => 'authorization_code',
            'code'          => (string) $code,
            'redirect_uri'  => self::redirect_uri(),
            'code_verifier' => (string) $code_verifier,
            'client_id'     => CHAPOTE_BO_OAUTH_CLIENT_ID,
        ));

        if ($res['status'] === 200 && !empty($res['data']['access_token'])) {
            $d  = $res['data'];
            $ok = Chapote_BO_Tokens::save(
                $d['access_token'],
                isset($d['refresh_token']) ? $d['refresh_token'] : '',
                isset($d['expires_in']) ? $d['expires_in'] : 0,
                isset($d['scope']) ? $d['scope'] : '',
                isset($d['token_type']) ? $d['token_type'] : 'Bearer'
            );
            if (!$ok) {
                return array('status' => 500, 'data' => array('error' => 'storage_failed'));
            }
        }
        return $res;
    }

    /** POST /api/oauth/token (grant refresh_token) → rotation. */
    public static function refresh($refresh_token) {
        return self::request('POST', '/api/oauth/token', array(
            'grant_type'    => 'refresh_token',
            'refresh_token' => $refresh_token,
        ));
    }

    /** POST /api/oauth/revoke → déconnexion. */
    public static function revoke($refresh_token) {
        return self::request('POST', '/api/oauth/revoke', array(
            'refresh_token' => $refresh_token,
        ));
    }

    /* ---------------------------------------------------------------------- */
    /* Appels « account » authentifiés (Bearer) avec refresh + rejeu UNE fois */
    /* ---------------------------------------------------------------------- */

    /**
     * Appel authentifié. Si 401 → tente un refresh (rotation) puis rejoue UNE
     * fois. Si le refresh échoue, la session est purgée et on renvoie 401.
     *
     * @return array{status:int,data:array}
     */
    public static function account($method, $path, $body = null) {
        $tokens = Chapote_BO_Tokens::get();
        if (!$tokens || empty($tokens['access_token'])) {
            return array('status' => 401, 'data' => array('error' => 'not_connected'));
        }

        $res = self::request($method, $path, $body, array(
            'Authorization' => 'Bearer ' . $tokens['access_token'],
        ));
        if ($res['status'] !== 401) {
            return $res;
        }

        // 401 → refresh (rotation : nouveau couple) puis rejeu unique.
        if (empty($tokens['refresh_token'])) {
            Chapote_BO_Tokens::clear();
            return $res;
        }
        $r = self::refresh($tokens['refresh_token']);
        if ($r['status'] === 200 && !empty($r['data']['access_token'])) {
            Chapote_BO_Tokens::save(
                $r['data']['access_token'],
                isset($r['data']['refresh_token']) ? $r['data']['refresh_token'] : $tokens['refresh_token'],
                isset($r['data']['expires_in']) ? $r['data']['expires_in'] : 0,
                isset($r['data']['scope']) ? $r['data']['scope'] : '',
                isset($r['data']['token_type']) ? $r['data']['token_type'] : 'Bearer'
            );
            $new = Chapote_BO_Tokens::get();
            return self::request($method, $path, $body, array(
                'Authorization' => 'Bearer ' . $new['access_token'],
            ));
        }

        // Refresh refusé → session morte (rejeu détecté, refresh expiré…).
        Chapote_BO_Tokens::clear();
        return array('status' => 401, 'data' => array('error' => 'session_expired'));
    }
}
