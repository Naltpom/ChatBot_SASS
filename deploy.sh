#!/usr/bin/env bash
# Déploiement / mise à jour de ChatBot SaaS (chapote.fr).
# Récupère le dernier code, rebuild les images et redémarre la stack prod.
# Les migrations Alembic tournent automatiquement au démarrage de l'API (lifespan).
# Usage : ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> git pull"
git pull --ff-only

echo "==> build images (api + app)"
docker compose -f docker-compose.prod.yml build

echo "==> up -d (recréation des conteneurs modifiés)"
docker compose -f docker-compose.prod.yml up -d

echo "==> attente santé API"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:10080/health >/dev/null 2>&1; then
    echo "✅ API en ligne : $(curl -fsS http://127.0.0.1:10080/health)"
    break
  fi
  sleep 2
done

echo "==> état de la stack"
docker compose -f docker-compose.prod.yml ps
echo "✅ Déploiement terminé — https://chapote.fr"
