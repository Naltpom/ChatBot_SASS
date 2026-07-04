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

    /** Verrou (mutex par installation) sérialisant le refresh OAuth. */
    const LOCK_OPTION = 'chapote_bo_refresh_lock';

    /** Durée max de détention du verrou (verrou orphelin cassé au-delà). */
    const LOCK_TTL = 30;

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

    /**
     * Relit les tokens en cassant le cache objet de la requête courante,
     * pour voir un couple sauvé ENTRE-TEMPS par une requête concurrente.
     *
     * @return array|null
     */
    public static function get_fresh() {
        wp_cache_delete(self::OPTION, 'options');
        return self::get();
    }

    /**
     * Tente de prendre le verrou de refresh. add_option est atomique (clé
     * unique en base) : un seul process gagne. Un verrou orphelin (crash
     * pendant le refresh) est cassé après LOCK_TTL secondes.
     *
     * @return bool true si le verrou est acquis par CE process.
     */
    public static function acquire_refresh_lock() {
        wp_cache_delete(self::LOCK_OPTION, 'options');
        wp_cache_delete('notoptions', 'options');
        if (add_option(self::LOCK_OPTION, time(), '', 'no')) {
            return true;
        }
        $held = (int) get_option(self::LOCK_OPTION);
        if ($held && (time() - $held) > self::LOCK_TTL) {
            delete_option(self::LOCK_OPTION);
            return (bool) add_option(self::LOCK_OPTION, time(), '', 'no');
        }
        return false;
    }

    /** Le verrou de refresh est-il détenu (par un autre process) ? */
    public static function refresh_lock_held() {
        wp_cache_delete(self::LOCK_OPTION, 'options');
        return (bool) get_option(self::LOCK_OPTION);
    }

    /** Relâche le verrou de refresh. */
    public static function release_refresh_lock() {
        delete_option(self::LOCK_OPTION);
    }
}
