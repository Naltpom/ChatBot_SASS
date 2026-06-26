<?php
/**
 * Désinstallation : on retire les réglages stockés.
 * Exécuté uniquement lors d'une suppression complète du plugin (pas à la désactivation).
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('chapote_chatbot_settings');
