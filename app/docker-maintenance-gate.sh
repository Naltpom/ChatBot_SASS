#!/bin/sh
# Génère la porte de maintenance nginx au démarrage du conteneur app (prod).
# Lu par l'entrypoint officiel nginx:alpine (/docker-entrypoint.d/*.sh).
# Variables (docker-compose.prod.yml -> .env) :
#   MAINTENANCE_MODE        on|off  (défaut on)  — redirige tout le monde vers
#                                                  la page de maintenance...
#   ALLOW_MAINTENANCE_IPS   liste d'IP séparées par des virgules ...sauf celles-ci.
set -e

OUT=/etc/nginx/maintenance_gate.conf
MODE="${MAINTENANCE_MODE:-on}"
IPS="${ALLOW_MAINTENANCE_IPS:-}"

{
  echo "# Généré au démarrage — ne pas éditer à la main."
  echo "geo \$remote_addr \$maint_ip_allowed {"
  echo "    default 0;"
  if [ -n "$IPS" ]; then
    echo "$IPS" | tr ',' '\n' | while IFS= read -r ip; do
      ip=$(printf '%s' "$ip" | tr -d ' \t\r')
      [ -n "$ip" ] && echo "    $ip 1;"
    done
  fi
  echo "}"
  case "$MODE" in
    on|ON|true|TRUE|1)
      # Maintenance active : bloqué sauf si l'IP est autorisée.
      echo "map \$maint_ip_allowed \$under_maintenance { default 1; 1 0; }"
      ;;
    *)
      # Maintenance désactivée : personne n'est bloqué.
      echo "map \$maint_ip_allowed \$under_maintenance { default 0; }"
      ;;
  esac
} > "$OUT"

echo "[maintenance-gate] MODE=$MODE ALLOW_MAINTENANCE_IPS=${IPS:-<aucune>}"
