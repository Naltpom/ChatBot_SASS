<?php
/**
 * Chiffrement des tokens OAuth (AES-256-GCM).
 *
 * Sécurité : les access/refresh tokens ne sont JAMAIS stockés en clair et ne
 * sont JAMAIS exposés au JavaScript. La clé de chiffrement est dérivée des
 * constantes secrètes de wp-config (AUTH_KEY/SECURE_AUTH_KEY) MÉLANGÉES à un
 * secret aléatoire propre à l'installation (option non autoloadée). Ainsi, un
 * simple dump de la table options ne suffit pas à déchiffrer sans wp-config.
 *
 * Compromis documenté (spec §6 / risque 7) : si la base ET wp-config sont
 * exfiltrés, le chiffrement local ne protège plus. La rotation du refresh à
 * chaque appel limite la fenêtre d'exposition.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Chapote_BO_Crypto {

    const CIPHER     = 'aes-256-gcm';
    const KEY_OPTION = 'chapote_bo_enc_secret';

    /** Indique si le chiffrement est disponible sur cet hébergement. */
    public static function available() {
        return function_exists('openssl_encrypt')
            && function_exists('openssl_decrypt')
            && in_array(self::CIPHER, openssl_get_cipher_methods(), true);
    }

    /** Clé brute 32 octets dérivée (constantes wp-config + secret d'install). */
    private static function key() {
        $material = '';
        if (defined('AUTH_KEY') && AUTH_KEY && defined('SECURE_AUTH_KEY') && SECURE_AUTH_KEY) {
            $material = AUTH_KEY . '|' . SECURE_AUTH_KEY;
        }

        $secret = get_option(self::KEY_OPTION);
        if (!is_string($secret) || $secret === '') {
            // Secret aléatoire propre à l'installation (hors clair côté JS, non autoloadé).
            $secret = base64_encode(self::random(32));
            update_option(self::KEY_OPTION, $secret, false);
        }

        return hash('sha256', $material . '|' . $secret, true); // 32 octets bruts
    }

    /** @return string|false blob base64 (iv|tag|ciphertext) ou false en échec. */
    public static function encrypt($plaintext) {
        if (!self::available()) {
            return false;
        }
        $iv  = self::random(12);
        $tag = '';
        $ct  = openssl_encrypt($plaintext, self::CIPHER, self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($ct === false) {
            return false;
        }
        return base64_encode($iv . $tag . $ct);
    }

    /** @return string|false texte clair ou false en échec. */
    public static function decrypt($blob) {
        if (!self::available() || !is_string($blob) || $blob === '') {
            return false;
        }
        $raw = base64_decode($blob, true);
        if ($raw === false || strlen($raw) < 28) { // 12 (iv) + 16 (tag) minimum
            return false;
        }
        $iv  = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $ct  = substr($raw, 28);
        $pt  = openssl_decrypt($ct, self::CIPHER, self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        return $pt === false ? false : $pt;
    }

    /** Octets aléatoires cryptographiques (random_bytes, repli openssl). */
    private static function random($len) {
        try {
            return random_bytes($len);
        } catch (Exception $e) {
            return openssl_random_pseudo_bytes($len);
        }
    }
}
