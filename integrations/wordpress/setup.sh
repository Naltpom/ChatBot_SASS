#!/usr/bin/env bash
# Installe WordPress et active le plugin Chapote Chatbot, sans écran d'install.
# Idempotent : relançable à volonté.
#
#   bash integrations/wordpress/setup.sh
#
# Variables surchargeables :
#   CHAPOTE_BOT_KEY   clé pk_ de votre bot de test (défaut : pk_demo, non fonctionnel)
#   CHAPOTE_API_BASE  origine servant widget.js (défaut : http://localhost:8001 = API dev)
set -euo pipefail

cd "$(dirname "$0")"

SITE_URL="http://localhost:8080"
BOT_KEY="${CHAPOTE_BOT_KEY:-pk_demo}"
API_BASE="${CHAPOTE_API_BASE:-http://localhost:8001}"

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

echo "→ Activation du plugin Chapote Chatbot…"
wp plugin activate chapote-chatbot

echo "→ Configuration du plugin (clé=${BOT_KEY}, api=${API_BASE})…"
wp option update chapote_chatbot_settings \
  --format=json \
  "{\"enabled\":1,\"bot_key\":\"${BOT_KEY}\",\"api_base\":\"${API_BASE}\"}"

echo
echo "✓ Prêt."
echo "  Site  : ${SITE_URL}"
echo "  Admin : ${SITE_URL}/wp-admin  (admin / admin)"
echo "  Réglages plugin : ${SITE_URL}/wp-admin/options-general.php?page=chapote-chatbot"
echo
echo "  Remplacez la clé de test par la vôtre :"
echo "    CHAPOTE_BOT_KEY=pk_votrevraiecle bash integrations/wordpress/setup.sh"
