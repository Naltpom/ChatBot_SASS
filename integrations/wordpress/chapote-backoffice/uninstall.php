<?php
/**
 * Désinstallation : nettoyage complet (options + tokens chiffrés + transients).
 * Exécuté uniquement lors d'une suppression du plugin (pas à la désactivation).
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

// Options du plugin.
delete_option('chapote_bo_settings');
delete_option('chapote_bo_bots_local');

// Secrets : tokens chiffrés + secret de chiffrement d'install.
delete_option('chapote_bo_tokens');
delete_option('chapote_bo_enc_secret');

// Transients de device flow éventuellement laissés (par utilisateur).
global $wpdb;
$like = $wpdb->esc_like('_transient_chapote_bo_device_') . '%';
$wpdb->query(
    $wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $like)
);
$like_to = $wpdb->esc_like('_transient_timeout_chapote_bo_device_') . '%';
$wpdb->query(
    $wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $like_to)
);
