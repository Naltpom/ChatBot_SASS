<?php
/**
 * Accès centralisé aux options du plugin.
 *
 * - chapote_bo_settings   : { api_base, app_base }
 * - chapote_bo_bots_local : { <bot_id> : { enabled, public_key, billing_status, name, targeting } }
 *
 * api_base = API Chapote (server-to-server, ex. https://chapote.fr ou, en local,
 *            http://host.docker.internal:8001).
 * app_base = Dashboard Chapote (écran de consentement OAuth /authorize, ouvert
 *            DANS LE NAVIGATEUR, ex. https://chapote.fr ou, en local,
 *            http://host.docker.internal:3001). Par défaut = api_base.
 *
 * Le ciblage des pages et l'activation du widget sont 100 % WordPress : ces
 * données ne quittent jamais le site (aucun appel Chapote pour les lire).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Chapote_BO_Options {

    const SETTINGS   = 'chapote_bo_settings';
    const BOTS_LOCAL = 'chapote_bo_bots_local';

    /** Adresse de l'API Chapote (héritée du plugin v1 si présent). */
    public static function api_base() {
        $s = get_option(self::SETTINGS, array());
        if (is_array($s) && !empty($s['api_base'])) {
            return untrailingslashit($s['api_base']);
        }
        // Héritage : si le plugin v1 (chapote-chatbot) est/était configuré.
        $v1 = get_option('chapote_chatbot_settings', array());
        if (is_array($v1) && !empty($v1['api_base'])) {
            return untrailingslashit($v1['api_base']);
        }
        return CHAPOTE_BO_DEFAULT_API;
    }

    /** Enregistre l'adresse de l'API après assainissement. */
    public static function set_api_base($url) {
        $url = esc_url_raw(trim((string) $url), array('http', 'https'));
        if ($url === '') {
            $url = CHAPOTE_BO_DEFAULT_API;
        }
        $s = get_option(self::SETTINGS, array());
        if (!is_array($s)) {
            $s = array();
        }
        $s['api_base'] = untrailingslashit($url);
        update_option(self::SETTINGS, $s);
        return $s['api_base'];
    }

    /**
     * Adresse du dashboard Chapote (écran de consentement OAuth ouvert dans le
     * navigateur). Par défaut = api_base : en production l'API et le dashboard
     * partagent le même domaine (https://chapote.fr) ; en local on les sépare
     * (app_base=:3001, api_base=:8001).
     */
    public static function app_base() {
        $s = get_option(self::SETTINGS, array());
        if (is_array($s) && !empty($s['app_base'])) {
            return untrailingslashit($s['app_base']);
        }
        return self::api_base();
    }

    /**
     * Enregistre l'adresse du dashboard après assainissement. Une valeur vide
     * supprime le réglage : app_base retombe alors sur api_base.
     */
    public static function set_app_base($url) {
        $url = esc_url_raw(trim((string) $url), array('http', 'https'));
        $s = get_option(self::SETTINGS, array());
        if (!is_array($s)) {
            $s = array();
        }
        if ($url === '') {
            unset($s['app_base']);
            update_option(self::SETTINGS, $s);
            return self::api_base();
        }
        $s['app_base'] = untrailingslashit($url);
        update_option(self::SETTINGS, $s);
        return $s['app_base'];
    }

    /** @return array tous les états locaux des bots. */
    public static function bots_local() {
        $v = get_option(self::BOTS_LOCAL, array());
        return is_array($v) ? $v : array();
    }

    /** @return array état local d'un bot (vide si inconnu). */
    public static function bot_local($bot_id) {
        $all = self::bots_local();
        $key = (string) $bot_id;
        return isset($all[$key]) && is_array($all[$key]) ? $all[$key] : array();
    }

    /** Fusionne puis enregistre l'état local d'un bot. */
    public static function save_bot_local($bot_id, array $data) {
        $all = self::bots_local();
        $key = (string) $bot_id;
        $existing = isset($all[$key]) && is_array($all[$key]) ? $all[$key] : array();
        $all[$key] = array_merge($existing, $data);
        update_option(self::BOTS_LOCAL, $all);
        return $all[$key];
    }

    /** Valeurs de ciblage par défaut (« tout le site »). */
    public static function default_targeting() {
        return array(
            'mode'          => 'everywhere', // everywhere | custom
            'include_front' => true,
            'include_types' => array(),      // slugs de types de contenu publics
            'include_ids'   => array(),      // IDs de contenus précis
            'exclude_types' => array(),      // types de contenu exclus (prioritaires)
            'exclude_ids'   => array(),      // IDs exclus (prioritaires)
        );
    }
}
