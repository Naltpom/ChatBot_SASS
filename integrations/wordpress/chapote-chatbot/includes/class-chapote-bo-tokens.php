<?php
/**
 * Stockage chiffré des tokens OAuth (jamais en clair, jamais exposés au JS).
 *
 * Option `chapote_bo_tokens` = blob chiffré (AES-256-GCM) d'un JSON :
 *   { access_token, refresh_token, expires_at, scope, token_type }
 * Option NON autoloadée (add_option autoload = no).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Chapote_BO_Tokens {

    const OPTION = 'chapote_bo_tokens';

    /** Persiste un couple de tokens (chiffré). @return bool succès. */
    public static function save($access, $refresh, $expires_in = 0, $scope = '', $token_type = 'Bearer') {
        $payload = wp_json_encode(array(
            'access_token'  => (string) $access,
            'refresh_token' => (string) $refresh,
            'expires_at'    => time() + max(60, (int) $expires_in),
            'scope'         => (string) $scope,
            'token_type'    => $token_type ? (string) $token_type : 'Bearer',
        ));

        $blob = Chapote_BO_Crypto::encrypt($payload);
        if ($blob === false) {
            return false;
        }
        // update_option ne permet pas de fixer autoload sur une option existante ;
        // on garantit autoload=no en (re)créant proprement l'option.
        if (get_option(self::OPTION, null) === null) {
            add_option(self::OPTION, $blob, '', 'no');
        } else {
            update_option(self::OPTION, $blob);
        }
        return true;
    }

    /** @return array|null tokens déchiffrés, ou null si absent/illisible. */
    public static function get() {
        $blob = get_option(self::OPTION);
        if (!$blob) {
            return null;
        }
        $json = Chapote_BO_Crypto::decrypt($blob);
        if ($json === false) {
            return null;
        }
        $data = json_decode($json, true);
        return is_array($data) ? $data : null;
    }

    public static function clear() {
        delete_option(self::OPTION);
    }

    public static function is_connected() {
        $t = self::get();
        return is_array($t) && !empty($t['access_token']);
    }
}
