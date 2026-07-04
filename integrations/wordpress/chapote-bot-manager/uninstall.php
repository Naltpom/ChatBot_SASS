<?php
/**
 * Désinstallation : nettoyage complet (options + tokens chiffrés + transients).
 * Exécuté uniquement lors d'une suppression du plugin (pas à la désactivation).
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('chapote_bo_settings');
delete_option('chapote_bo_bots_local');
delete_option('chapote_bo_seo');
delete_option('chapote_bo_onboarding');
delete_option('chapote_chatbot_settings'); // Option héritée v1 (migration).

// Secrets : tokens chiffrés + secret de chiffrement d'install.
delete_option('chapote_bo_tokens');
delete_option('chapote_bo_enc_secret');

// Transients PKCE (state + code_verifier) éventuellement laissés (par utilisateur).
// Suppression directe en base : nettoyage one-shot à la désinstallation (pas de
// cache pertinent ; aucune API WP pour purger un lot de transients par préfixe).
global $wpdb;
$chapote_bo_like = $wpdb->esc_like('_transient_chapote_bo_pkce_') . '%';
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
$wpdb->query(
    $wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $chapote_bo_like)
);
$chapote_bo_like_to = $wpdb->esc_like('_transient_timeout_chapote_bo_pkce_') . '%';
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
$wpdb->query(
    $wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $chapote_bo_like_to)
);
