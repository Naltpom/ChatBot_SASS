#!/usr/bin/env bash
# Déploiement / mise à jour de ChatBot SaaS (chapote.fr).
# Récupère le dernier code, rebuild les images et redémarre la stack prod.
# Les migrations Alembic tournent automatiquement au démarrage de l'API (lifespan).
# Usage : ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> git pull"
git pull --ff-only

# -----------------------------------------------------------------------------
# Build du plugin WordPress « Chapote Back-Office » (AVANT le build de l'app)
# -----------------------------------------------------------------------------
# Produit, dans app/public/downloads/ (servi par nginx de l'app sous /downloads/) :
#   - chapote-backoffice-VERSION.zip  archive versionnée (dossier racine chapote-backoffice/)
#   - chapote-backoffice.zip          dernier stable (copie de l'archive ci-dessus)
#   - chapote-backoffice.json         manifeste d'auto-update WordPress
# Idempotent : régénère tout à chaque exécution ; ne conserve que les 5 archives
# versionnées les plus récentes. Robuste : n'interrompt jamais le déploiement de
# l'app (warnings non bloquants).
build_wp_plugin() {
  local plugin_parent="integrations/wordpress"
  local plugin_slug="chapote-backoffice"
  local plugin_dir="${plugin_parent}/${plugin_slug}"
  local plugin_main="${plugin_dir}/${plugin_slug}.php"
  local downloads_dir="app/public/downloads"

  # Le plugin peut être absent sur d'anciennes branches : on n'échoue pas le deploy.
  if [ ! -f "$plugin_main" ]; then
    echo "   ⚠ plugin introuvable ($plugin_main) — étape ignorée." >&2
    return 0
  fi

  # 1) Version lue dans l'en-tête du plugin (ligne « Version: X.Y.Z »).
  local version
  version="$(grep -m1 -E '^[[:space:]]*\*?[[:space:]]*Version:' "$plugin_main" 2>/dev/null \
    | sed -E 's/.*Version:[[:space:]]*//; s/[[:space:]]*$//' || true)"
  if [ -z "$version" ]; then
    echo "   ⚠ version introuvable dans $plugin_main — étape ignorée." >&2
    return 0
  fi
  echo "   version détectée : $version"

  mkdir -p "$downloads_dir"

  # Chemins absolus : l'archive est créée depuis le dossier parent du plugin
  # pour que le zip contienne un dossier racine « chapote-backoffice/ » (exigence WP).
  local downloads_abs zip_abs
  downloads_abs="$(cd "$downloads_dir" && pwd)"
  zip_abs="${downloads_abs}/${plugin_slug}-${version}.zip"

  # 2) Archive versionnée, en excluant .git, node_modules et fichiers .map.
  rm -f "$zip_abs"
  if command -v zip >/dev/null 2>&1; then
    ( cd "$plugin_parent" && zip -r -q -X "$zip_abs" "$plugin_slug" \
        -x "${plugin_slug}/.git/*" "${plugin_slug}/node_modules/*" "*.map" )
  elif command -v python3 >/dev/null 2>&1; then
    # Repli sans la commande `zip` : module zipfile de Python 3.
    python3 - "$plugin_dir" "$plugin_slug" "$zip_abs" <<'PY'
import os, sys, zipfile
src, slug, out = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        # Exclure .git et node_modules de la descente.
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules")]
        for name in files:
            if name.endswith(".map"):
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, src)
            # Préfixe « chapote-backoffice/ » = dossier racine dans l'archive.
            z.write(full, os.path.join(slug, rel))
PY
  else
    echo "   ✗ ni 'zip' ni 'python3' disponibles — archive non générée." >&2
    return 0
  fi
  if [ ! -f "$zip_abs" ]; then
    echo "   ✗ échec de création de l'archive ${zip_abs}." >&2
    return 0
  fi
  echo "   ✓ archive : ${zip_abs}"

  # 3) Copie « dernier stable ».
  cp -f "$zip_abs" "${downloads_abs}/${plugin_slug}.zip"
  echo "   ✓ dernier stable : ${downloads_abs}/${plugin_slug}.zip"

  # 3bis) Variante WordPress.org : MÊME plugin SANS l'updater auto-hébergé.
  #       Un plugin du dépôt .org ne DOIT PAS embarquer son propre updater
  #       (Plugin Check « Plugin Updater Detected » -> rejet ; il court-circuiterait
  #       les MAJ du dépôt). Le chargement est conditionnel (file_exists), donc
  #       l'absence de ce fichier est sans danger. C'est CE zip qu'on soumet à .org.
  local wporg_abs="${downloads_abs}/${plugin_slug}-wporg.zip"
  local updater_rel="${plugin_slug}/includes/class-chapote-bo-updater.php"
  rm -f "$wporg_abs"
  if command -v zip >/dev/null 2>&1; then
    ( cd "$plugin_parent" && zip -r -q -X "$wporg_abs" "$plugin_slug" \
        -x "${plugin_slug}/.git/*" "${plugin_slug}/node_modules/*" "*.map" "$updater_rel" )
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$plugin_dir" "$plugin_slug" "$wporg_abs" <<'PY'
import os, sys, zipfile
src, slug, out = sys.argv[1], sys.argv[2], sys.argv[3]
skip = "includes/class-chapote-bo-updater.php"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules")]
        for name in files:
            if name.endswith(".map"):
                continue
            rel = os.path.relpath(os.path.join(root, name), src).replace(os.sep, "/")
            if rel == skip:
                continue
            z.write(os.path.join(root, name), os.path.join(slug, rel))
PY
  fi
  [ -f "$wporg_abs" ] && echo "   ✓ variante WordPress.org (sans updater) : ${wporg_abs}"

  # 4) Manifeste d'auto-update (last_updated en ISO 8601 UTC).
  local now_iso
  now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cat > "${downloads_abs}/${plugin_slug}.json" <<JSON
{
  "name": "Chapote Back-Office",
  "slug": "chapote-backoffice",
  "version": "${version}",
  "download_url": "https://chapote.fr/downloads/chapote-backoffice.zip",
  "requires": "5.8",
  "tested": "6.6",
  "requires_php": "7.4",
  "last_updated": "${now_iso}",
  "homepage": "https://chapote.fr"
}
JSON
  echo "   ✓ manifeste : ${downloads_abs}/${plugin_slug}.json"

  # 5) Prune : ne garder que les 5 archives versionnées les plus récentes
  #    (chapote-backoffice-X.Y.Z.zip uniquement ; le « dernier stable » sans
  #    version et la variante « -wporg » ne commencent pas par un chiffre -> préservés).
  local old
  old="$(ls -1t "${downloads_abs}/${plugin_slug}"-[0-9]*.zip 2>/dev/null | tail -n +6 || true)"
  if [ -n "$old" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      rm -f "$f" && echo "   ↪ purge ancienne archive : $(basename "$f")"
    done <<< "$old"
  fi
}
echo "==> build plugin WordPress (chapote-backoffice)"
build_wp_plugin

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
