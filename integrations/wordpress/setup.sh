#!/usr/bin/env bash
# Installe WordPress et active le plugin Chapote (back-office), sans écran d'install.
# Idempotent : relançable à volonté.
#
#   bash integrations/wordpress/setup.sh
#
# Variables surchargeables :
#   CHAPOTE_API_BASE  API Chapote, server-to-server (défaut : http://host.docker.internal:8001)
#   CHAPOTE_APP_BASE  Dashboard Chapote, consentement OAuth ouvert dans le navigateur
#                     (défaut : http://host.docker.internal:3001)
set -euo pipefail

cd "$(dirname "$0")"

SITE_URL="http://localhost:8080"
API_BASE="${CHAPOTE_API_BASE:-http://host.docker.internal:8001}"
APP_BASE="${CHAPOTE_APP_BASE:-http://host.docker.internal:3001}"

dc() { docker compose "$@"; }
wp() { dc run --rm wpcli wp "$@"; }

echo "→ Démarrage des conteneurs (db + wordpress)…"
dc up -d db wordpress

echo "→ Attente de WordPress sur ${SITE_URL} …"
for i in $(seq 1 60); do
  if curl -sS -o /dev/null "${SITE_URL}/wp-login.php"; then break; fi
  sleep 2
done

echo "→ Attente de la base (WP-CLI) …"
for i in $(seq 1 30); do
  if wp db check >/dev/null 2>&1; then break; fi
  sleep 2
done

if wp core is-installed >/dev/null 2>&1; then
  echo "→ WordPress déjà installé."
else
  echo "→ Installation de WordPress…"
  wp core install \
    --url="${SITE_URL}" \
    --title="Test Chapote" \
    --admin_user="admin" \
    --admin_password="admin" \
    --admin_email="admin@example.com" \
    --skip-email
fi

echo "→ Activation du plugin Chapote (back-office)…"
wp plugin activate chapote-bot-manager

echo "→ Configuration du plugin (api=${API_BASE}, app=${APP_BASE})…"
wp option update chapote_bo_settings \
  --format=json \
  "{\"api_base\":\"${API_BASE}\",\"app_base\":\"${APP_BASE}\"}"

echo
echo "✓ Prêt."
echo "  Site  : ${SITE_URL}"
echo "  Admin : ${SITE_URL}/wp-admin  (admin / admin)"
echo "  Plugin Chapote : ${SITE_URL}/wp-admin/admin.php?page=chapote-chatbot"
echo "  → Connectez-vous avec Chapote (OAuth), puis gérez vos bots."
