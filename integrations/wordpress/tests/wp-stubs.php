<?php
/**
 * Stubs MINIMAUX des fonctions/classes WordPress utilisees par la frontiere de
 * securite du plugin (crypto, proxy REST, OAuth PKCE). Aucune dependance externe :
 * un magasin en memoire ($GLOBALS['_wpt']) tient lieu d'options/transients, et
 * deux drapeaux pilotent les decisions d'autorisation (capability + nonce).
 *
 * On NE stube QUE ce qui est reellement appele par les methodes testees. La
 * crypto repose sur l'openssl natif (aucun stub) ; ce fichier ne lui fournit que
 * get_option/update_option pour la derivation de cle (chemin AUTH_KEY/SECURE_AUTH_KEY
 * du bootstrap ; la branche de repli wp_salt() n'est pas exercee, donc pas stubee).
 */

if (defined('CHAPOTE_BO_TEST_STUBS')) {
    return;
}
define('CHAPOTE_BO_TEST_STUBS', true);

/** Reinitialise l'etat WP simule entre deux tests (appele par setUp). */
function wpt_reset(): void {
    $GLOBALS['_wpt'] = array(
        'options'         => array(),  // name => value
        'transients'      => array(),  // key  => value
        'user_can'        => true,     // defaut pilotant current_user_can()
        'caps'            => array(),  // map cap => bool (prioritaire sur user_can)
        'cap_calls'       => array(),  // [ cap, ... ] capture des capabilities exigees
        'nonce_ok'        => true,     // pilote wp_verify_nonce()
        'nonce_calls'     => array(),  // [ [nonce, action], ... ] capture
        'current_user_id' => 1,
        'remote'          => null,     // callable($url,$args): array|WP_Error
        'remote_calls'    => 0,        // espion : nb d'appels HTTP sortants (echange de code)
    );
}
wpt_reset();

/* -------------------------------------------------------------------------- */
/* Constantes WordPress minimales                                             */
/* -------------------------------------------------------------------------- */

if (!defined('MINUTE_IN_SECONDS')) {
    define('MINUTE_IN_SECONDS', 60);
}

/* -------------------------------------------------------------------------- */
/* Options (magasin en memoire)                                               */
/* -------------------------------------------------------------------------- */

function get_option($name, $default = false) {
    return array_key_exists($name, $GLOBALS['_wpt']['options'])
        ? $GLOBALS['_wpt']['options'][$name]
        : $default;
}

function update_option($name, $value, $autoload = null) {
    $GLOBALS['_wpt']['options'][$name] = $value;
    return true;
}

function add_option($name, $value = '', $deprecated = '', $autoload = 'yes') {
    if (array_key_exists($name, $GLOBALS['_wpt']['options'])) {
        return false;
    }
    $GLOBALS['_wpt']['options'][$name] = $value;
    return true;
}

function delete_option($name) {
    unset($GLOBALS['_wpt']['options'][$name]);
    return true;
}

/* -------------------------------------------------------------------------- */
/* Transients (PKCE en attente)                                               */
/* -------------------------------------------------------------------------- */

function set_transient($key, $value, $ttl = 0) {
    $GLOBALS['_wpt']['transients'][$key] = $value;
    return true;
}

function get_transient($key) {
    return array_key_exists($key, $GLOBALS['_wpt']['transients'])
        ? $GLOBALS['_wpt']['transients'][$key]
        : false;
}

function delete_transient($key) {
    unset($GLOBALS['_wpt']['transients'][$key]);
    return true;
}

/* -------------------------------------------------------------------------- */
/* Identite + autorisation                                                    */
/* -------------------------------------------------------------------------- */

function get_current_user_id() {
    return $GLOBALS['_wpt']['current_user_id'];
}

/**
 * Capture la capability EXIGEE (cap_calls) puis decide : map 'caps' par capability
 * si fournie, sinon le drapeau global 'user_can'. Capturer la capability permet
 * d'asserter que la garde REST exige bien 'manage_options' (un downgrade vers
 * 'read' casserait alors le test au lieu de passer silencieusement).
 */
function current_user_can($cap) {
    $GLOBALS['_wpt']['cap_calls'][] = $cap;
    if (array_key_exists($cap, $GLOBALS['_wpt']['caps'])) {
        return (bool) $GLOBALS['_wpt']['caps'][$cap];
    }
    return (bool) $GLOBALS['_wpt']['user_can'];
}

/**
 * Verifie un nonce. On CAPTURE (nonce, action) pour pouvoir asserter que la garde
 * REST exige bien l'action 'wp_rest'. Un nonce vide echoue toujours (comme WP) ;
 * sinon le drapeau 'nonce_ok' decide. Retour WP : 1|2 si valide, false sinon.
 */
function wp_verify_nonce($nonce, $action = -1) {
    $GLOBALS['_wpt']['nonce_calls'][] = array($nonce, $action);
    if ($nonce === '' || $nonce === null || $nonce === false) {
        return false;
    }
    return $GLOBALS['_wpt']['nonce_ok'] ? 1 : false;
}

/* -------------------------------------------------------------------------- */
/* URLs / chaines                                                             */
/* -------------------------------------------------------------------------- */

function admin_url($path = '') {
    return 'https://example.test/wp-admin/' . ltrim((string) $path, '/');
}

function home_url($path = '') {
    return 'https://example.test' . $path;
}

function untrailingslashit($s) {
    return rtrim((string) $s, '/');
}

function esc_url_raw($url, $protocols = null) {
    return trim((string) $url);
}

function sanitize_text_field($s) {
    if (!is_string($s)) {
        return '';
    }
    return trim(preg_replace('/[\r\n\t]+/', ' ', strip_tags($s)));
}

/* -------------------------------------------------------------------------- */
/* JSON + HTTP (encodage seul ; les appels sortants sont neutralises)         */
/* -------------------------------------------------------------------------- */

function wp_json_encode($data, $options = 0, $depth = 512) {
    return json_encode($data, $options, $depth);
}

function wp_remote_request($url, $args = array()) {
    // Espion : tout appel sortant est compte. Sur un rejet anti-CSRF (state
    // invalide / code absent / pas de PKCE), ce compteur DOIT rester a 0 :
    // aucun echange de code ne doit avoir lieu.
    $GLOBALS['_wpt']['remote_calls']++;
    $h = $GLOBALS['_wpt']['remote'];
    if (is_callable($h)) {
        return $h($url, $args);
    }
    return new WP_Error('no_handler', 'Aucun gestionnaire HTTP simule.');
}

function is_wp_error($thing) {
    return $thing instanceof WP_Error;
}

function wp_remote_retrieve_response_code($res) {
    return isset($res['response']['code']) ? $res['response']['code'] : 0;
}

function wp_remote_retrieve_body($res) {
    return isset($res['body']) ? $res['body'] : '';
}

/* -------------------------------------------------------------------------- */
/* Classes WordPress minimales                                                */
/* -------------------------------------------------------------------------- */

class WP_Error {
    private $code;
    private $message;
    private $data;
    public function __construct($code = '', $message = '', $data = '') {
        $this->code    = $code;
        $this->message = $message;
        $this->data    = $data;
    }
    public function get_error_message() {
        return $this->message;
    }
    public function get_error_code() {
        return $this->code;
    }
}

class WP_REST_Response {
    private $data;
    private $status;
    public function __construct($data = null, $status = 200) {
        $this->data   = $data;
        $this->status = $status;
    }
    public function get_data() {
        return $this->data;
    }
    public function get_status() {
        return $this->status;
    }
}

/**
 * Requete REST simulee : porte des en-tetes (X-WP-Nonce) et des parametres
 * (code/state...). Suffit aux gardes de permission et au callback OAuth.
 */
class Fake_REST_Request {
    private $headers = array();
    private $params  = array();
    public function set_header($name, $value) {
        $this->headers[strtolower($name)] = $value;
        return $this;
    }
    public function get_header($name) {
        $k = strtolower($name);
        return array_key_exists($k, $this->headers) ? $this->headers[$k] : null;
    }
    public function set_param($name, $value) {
        $this->params[$name] = $value;
        return $this;
    }
    public function get_param($name) {
        return array_key_exists($name, $this->params) ? $this->params[$name] : null;
    }
}
