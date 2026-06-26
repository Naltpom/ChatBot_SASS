<?php
/**
 * Client HTTP server-to-server vers l'API Chapote.
 *
 * Toute la mécanique OAuth (device flow, refresh par rotation, revoke) et tous
 * les appels « account » passent par ici, DEPUIS LE PHP. Le navigateur ne voit
 * jamais le token : il parle au proxy REST (class-chapote-bo-rest.php), qui
 * appelle ces méthodes.
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
    /* OAuth device flow (RFC 8628)                                           */
    /* ---------------------------------------------------------------------- */

    /** POST /api/oauth/device → device_code + user_code + verification_uri… */
    public static function device_start($site_url) {
        return self::request('POST', '/api/oauth/device', array(
            'client_id' => CHAPOTE_BO_OAUTH_CLIENT_ID,
            'site_url'  => $site_url,
        ));
    }

    /** POST /api/oauth/token (grant device_code) → polling. */
    public static function device_poll($device_code) {
        return self::request('POST', '/api/oauth/token', array(
            'grant_type'  => 'urn:ietf:params:oauth:grant-type:device_code',
            'device_code' => $device_code,
        ));
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
