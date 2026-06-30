<?php
/**
 * Bootstrap du harness PHPUnit du plugin WordPress Chapote.
 *
 * Strategie : aucun WordPress reel. On definit ABSPATH + les constantes du plugin,
 * on charge des STUBS maison des fonctions WP (tests/wp-stubs.php), puis on inclut
 * directement les classes du plugin a tester. Ces classes n'executent du code WP
 * QUE dans leurs corps de methode (le seul code de premier niveau est le garde
 * `if (!defined('ABSPATH')) exit;` + la definition de classe), donc les charger
 * ne declenche aucun appel WP : seules les methodes reellement testees en font.
 */

error_reporting(E_ALL);

// Garde anti-acces-direct des fichiers du plugin : on simule un contexte WP charge.
if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}

// Materiel de cle de wp-config (chemin nominal de Chapote_BO_Crypto::key()). Des
// valeurs fixes rendent la derivation de cle deterministe pour les tests crypto.
if (!defined('AUTH_KEY')) {
    define('AUTH_KEY', 'test-auth-key-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ');
}
if (!defined('SECURE_AUTH_KEY')) {
    define('SECURE_AUTH_KEY', 'test-secure-auth-key-9876543210-ZYXWVUTSRQPONMLKJIHGFEDCBA');
}

// Constantes definies par chapote-chatbot.php (on ne charge PAS le fichier
// principal : il enregistre des hooks au premier niveau). On reprend a l'identique.
if (!defined('CHAPOTE_BO_REST_NS')) {
    define('CHAPOTE_BO_REST_NS', 'chapote-bo/v1');
}
if (!defined('CHAPOTE_BO_DEFAULT_API')) {
    define('CHAPOTE_BO_DEFAULT_API', 'https://chapote.fr');
}
if (!defined('CHAPOTE_BO_OAUTH_CLIENT_ID')) {
    define('CHAPOTE_BO_OAUTH_CLIENT_ID', 'chapote_wp');
}

// 1) Stubs WP (doit preceder le chargement des classes du plugin).
require_once __DIR__ . '/wp-stubs.php';

// 2) Classes du plugin sous test (frontiere de securite). On ne charge PAS
//    pages/admin/frontend/seo/updater : non requis par les methodes testees
//    (referencees seulement dans des corps de methode non invoques).
$inc = __DIR__ . '/../chapote-chatbot/includes/';
require_once $inc . 'class-chapote-bo-crypto.php';
require_once $inc . 'class-chapote-bo-options.php';
require_once $inc . 'class-chapote-bo-tokens.php';
require_once $inc . 'class-chapote-bo-api.php';
require_once $inc . 'class-chapote-bo-rest.php';
