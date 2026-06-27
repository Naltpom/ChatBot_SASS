<?php
/**
 * Mise à jour automatique du plugin depuis le serveur de distribution Chapote
 * (hors WordPress.org). Le plugin « ping » un manifeste JSON statique servi par
 * nginx et propose la mise à jour dans l'écran « Extensions » de WordPress.
 *
 * Deux greffons WordPress :
 *   - pre_set_site_transient_update_plugins : compare la version installée à
 *     celle du manifeste et, si une version supérieure existe, injecte un objet
 *     « update » (slug, basename, new_version, package, url) dans le transient
 *     `update_plugins` → bandeau « Une nouvelle version est disponible ».
 *   - plugins_api (plugin_information) : alimente l'écran « Voir les détails »
 *     (description, changelog, versions compatibles) depuis le manifeste.
 *
 * Le manifeste est mis en cache 12 h (transient de site) pour ne pas appeler le
 * réseau à chaque rafraîchissement ; un échec réseau est silencieux (pas de
 * mise à jour proposée, jamais de fatal). Transport : wp_remote_get UNIQUEMENT.
 *
 * Manifeste attendu (https://chapote.fr/downloads/chapote-backoffice.json) :
 *   {
 *     "version":      "2.1.0",
 *     "download_url": "https://chapote.fr/downloads/chapote-backoffice.zip",
 *     "homepage":     "https://chapote.fr",
 *     "requires":     "5.8",
 *     "tested":       "6.5",
 *     "requires_php": "7.4",
 *     "last_updated": "2026-06-27 10:00:00",
 *     "sections": { "description": "<p>…</p>", "changelog": "<h4>2.1.0</h4>…" }
 *   }
 */

if (!defined('ABSPATH')) {
    exit;
}

class Chapote_BO_Updater {

    /** Slug du plugin (dossier) = Text Domain. */
    const SLUG = 'chapote-backoffice';

    /** URL du manifeste d'auto-update (servi par nginx app). */
    const MANIFEST_URL = 'https://chapote.fr/downloads/chapote-backoffice.json';

    /** Transient de cache du manifeste. */
    const TRANSIENT = 'chapote_bo_updater_manifest';

    /** Durée de cache en cas de succès (12 h, conforme au rythme WP). */
    const CACHE_OK = 12 * HOUR_IN_SECONDS;

    /** Backoff court en cas d'échec réseau : on évite de marteler le serveur. */
    const CACHE_ERR = HOUR_IN_SECONDS;

    /* ---------------------------------------------------------------------- */
    /* Branchement                                                            */
    /* ---------------------------------------------------------------------- */

    /** Branche les greffons. Appelé une fois au chargement du plugin. */
    public static function init() {
        add_filter('pre_set_site_transient_update_plugins', array(__CLASS__, 'check_update'));
        add_filter('plugins_api', array(__CLASS__, 'plugin_info'), 10, 3);
        // Après une installation/mise à jour, on purge le cache pour refléter
        // immédiatement la nouvelle version (évite un faux « à jour disponible »).
        add_action('upgrader_process_complete', array(__CLASS__, 'flush_cache'));
    }

    /* ---------------------------------------------------------------------- */
    /* Greffon 1 : injection de la mise à jour dans le transient              */
    /* ---------------------------------------------------------------------- */

    /**
     * @param mixed $transient objet update_plugins (peut être faux/incomplet).
     * @return mixed le transient, éventuellement enrichi d'une réponse update.
     */
    public static function check_update($transient) {
        if (!is_object($transient)) {
            $transient = new stdClass();
        }

        $manifest = self::get_manifest();
        if ($manifest === null) {
            return $transient; // réseau indisponible / manifeste invalide → rien.
        }

        $basename = self::basename();
        $remote   = (string) $manifest['version'];
        $update   = self::build_update_object($manifest, $basename);

        // Sans paquet téléchargeable, on ne peut rien proposer.
        if ($update->package === '') {
            return $transient;
        }

        if (version_compare($remote, self::installed_version(), '>')) {
            if (!isset($transient->response) || !is_array($transient->response)) {
                $transient->response = array();
            }
            $transient->response[$basename] = $update;
        } else {
            // À jour : on renseigne `no_update` pour que le lien « Activer les
            // mises à jour automatiques » apparaisse dans la liste des extensions.
            if (!isset($transient->no_update) || !is_array($transient->no_update)) {
                $transient->no_update = array();
            }
            $transient->no_update[$basename] = $update;
        }

        return $transient;
    }

    /** Construit l'objet attendu par WordPress dans response/no_update. */
    private static function build_update_object($manifest, $basename) {
        $o = new stdClass();
        $o->slug        = self::SLUG;
        $o->plugin      = $basename;
        $o->new_version = (string) $manifest['version'];
        $o->url         = !empty($manifest['homepage']) ? esc_url_raw((string) $manifest['homepage']) : 'https://chapote.fr';
        $o->package     = !empty($manifest['download_url']) ? esc_url_raw((string) $manifest['download_url']) : '';
        if (!empty($manifest['requires'])) {
            $o->requires = (string) $manifest['requires'];
        }
        if (!empty($manifest['tested'])) {
            $o->tested = (string) $manifest['tested'];
        }
        if (!empty($manifest['requires_php'])) {
            $o->requires_php = (string) $manifest['requires_php'];
        }
        return $o;
    }

    /* ---------------------------------------------------------------------- */
    /* Greffon 2 : écran « Voir les détails »                                 */
    /* ---------------------------------------------------------------------- */

    /**
     * @param mixed  $result false|object  réponse par défaut de l'API.
     * @param string $action action plugins_api en cours.
     * @param object $args   arguments (notamment ->slug).
     * @return mixed objet d'information du plugin, ou $result inchangé.
     */
    public static function plugin_info($result, $action, $args) {
        if ($action !== 'plugin_information') {
            return $result;
        }
        if (!is_object($args) || !isset($args->slug) || $args->slug !== self::SLUG) {
            return $result;
        }

        $manifest = self::get_manifest();
        if ($manifest === null) {
            return $result;
        }

        $info = new stdClass();
        $info->name          = !empty($manifest['name']) ? (string) $manifest['name'] : 'Chapote Back-Office';
        $info->slug          = self::SLUG;
        $info->version       = (string) $manifest['version'];
        $info->author        = !empty($manifest['author']) ? (string) $manifest['author'] : '<a href="https://chapote.fr">Chapote</a>';
        $info->homepage      = !empty($manifest['homepage']) ? esc_url_raw((string) $manifest['homepage']) : 'https://chapote.fr';
        $info->download_link = !empty($manifest['download_url']) ? esc_url_raw((string) $manifest['download_url']) : '';

        if (!empty($manifest['requires'])) {
            $info->requires = (string) $manifest['requires'];
        }
        if (!empty($manifest['tested'])) {
            $info->tested = (string) $manifest['tested'];
        }
        if (!empty($manifest['requires_php'])) {
            $info->requires_php = (string) $manifest['requires_php'];
        }
        if (!empty($manifest['last_updated'])) {
            $info->last_updated = (string) $manifest['last_updated'];
        }

        // Sections (HTML) : on échappe via wp_kses_post, jamais de HTML brut.
        $sections = array();
        if (isset($manifest['sections']) && is_array($manifest['sections'])) {
            foreach ($manifest['sections'] as $key => $html) {
                $sections[sanitize_key((string) $key)] = wp_kses_post((string) $html);
            }
        }
        if (empty($sections['description'])) {
            $sections['description'] = esc_html__('Le back-office Chapote dans WordPress.', 'chapote-backoffice');
        }
        $info->sections = $sections;

        return $info;
    }

    /* ---------------------------------------------------------------------- */
    /* Manifeste : récupération + cache 12 h                                  */
    /* ---------------------------------------------------------------------- */

    /**
     * Renvoie le manifeste (tableau) ou null. Sert d'abord le cache transient ;
     * sinon interroge le réseau et mémorise le résultat (succès 12 h, échec 1 h).
     *
     * @return array|null
     */
    private static function get_manifest() {
        $cached = get_site_transient(self::TRANSIENT);
        if (is_array($cached)) {
            // Sentinelle d'échec mémorisée : { manifest: null } → pas de réseau.
            return (isset($cached['manifest']) && is_array($cached['manifest'])) ? $cached['manifest'] : null;
        }

        $manifest = self::fetch_remote();
        if ($manifest === null) {
            set_site_transient(self::TRANSIENT, array('manifest' => null), self::CACHE_ERR);
            return null;
        }
        set_site_transient(self::TRANSIENT, array('manifest' => $manifest), self::CACHE_OK);
        return $manifest;
    }

    /**
     * Télécharge et valide le manifeste. Erreurs silencieuses → null.
     *
     * @return array|null
     */
    private static function fetch_remote() {
        $res = wp_remote_get(self::manifest_url(), array(
            'timeout' => 10,
            'headers' => array('Accept' => 'application/json'),
        ));
        if (is_wp_error($res)) {
            return null;
        }
        if ((int) wp_remote_retrieve_response_code($res) !== 200) {
            return null;
        }
        $data = json_decode(wp_remote_retrieve_body($res), true);
        if (!is_array($data) || empty($data['version'])) {
            return null;
        }
        return $data;
    }

    /** URL du manifeste (filtrable pour les environnements de test). */
    private static function manifest_url() {
        return apply_filters('chapote_bo_manifest_url', self::MANIFEST_URL);
    }

    /** Vide le cache du manifeste (post-mise à jour). */
    public static function flush_cache() {
        delete_site_transient(self::TRANSIENT);
    }

    /* ---------------------------------------------------------------------- */
    /* Identité du plugin installé                                            */
    /* ---------------------------------------------------------------------- */

    /** Chemin relatif « dossier/fichier.php » du plugin. */
    private static function basename() {
        return plugin_basename(CHAPOTE_BO_FILE);
    }

    /** Version installée, lue dans l'en-tête du plugin (repli sur la constante). */
    private static function installed_version() {
        if (defined('CHAPOTE_BO_FILE') && function_exists('get_file_data')) {
            $data = get_file_data(CHAPOTE_BO_FILE, array('Version' => 'Version'));
            if (!empty($data['Version'])) {
                return (string) $data['Version'];
            }
        }
        return defined('CHAPOTE_BO_VERSION') ? CHAPOTE_BO_VERSION : '0';
    }
}
