# Distribution du plugin WordPress « Chapote Bot Manager »

Ce document décrit les deux canaux de distribution du plugin
`integrations/wordpress/chapote-bot-manager/` :

1. **Auto-hébergé** (canal actuel) : un zip servi par le nginx de l'app, avec
   mise à jour automatique via un manifeste JSON.
2. **WordPress.org** (canal cible, optionnel) : publication sur le répertoire
   officiel via SVN, avec assets et passage de la revue `.org`.

La source de vérité du plugin est le dossier
`integrations/wordpress/chapote-bot-manager/`. La version est définie à **un seul
endroit logique** : l'en-tête `Version:` de `chapote-bot-manager.php`, la constante
`CHAPOTE_BO_VERSION`, et le `Stable tag:` de `readme.txt` doivent rester
**identiques** (actuellement `2.0.0`).

---

## 1. Distribution auto-hébergée (zip + auto-update)

### 1.1 Cibles servies

Le nginx de l'app (`app/nginx.conf`) sert un répertoire `/downloads` (à monter en
volume) exposé sous `https://chapote.fr/downloads/` :

| URL | Rôle |
|---|---|
| `https://chapote.fr/downloads/chapote-bot-manager.zip` | dernier zip (alias du courant) |
| `https://chapote.fr/downloads/chapote-bot-manager-2.0.0.zip` | zip versionné (immuable) |
| `https://chapote.fr/downloads/chapote-bot-manager.json` | manifeste d'auto-update |

> Le zip versionné ne doit **jamais** être réécrit une fois publié (immuable, cache
> long). Le `…-backoffice.zip` non versionné est un alias mis à jour à chaque
> release et doit rester en cache court.

### 1.2 Build du zip (étape à ajouter à `deploy.sh`)

Le build est volontairement trivial : on copie le dossier du plugin (sans fichiers
de dev) et on zippe. Exemple d'étape à intégrer au `deploy.sh` de la racine, ou à
exécuter à part :

```bash
PLUGIN_DIR=integrations/wordpress/chapote-bot-manager
VERSION=$(grep -m1 -oE "Stable tag: [0-9.]+" "$PLUGIN_DIR/readme.txt" | awk '{print $3}')
OUT=/srv/chapote/downloads          # volume monté et servi par nginx en /downloads
STAGE=$(mktemp -d)

# 1) Copie propre (le slug du dossier DOIT être chapote-bot-manager).
rsync -a --delete \
  --exclude '.git*' --exclude 'node_modules' --exclude '*.map' \
  "$PLUGIN_DIR/" "$STAGE/chapote-bot-manager/"

# 2) Zips (versionné + alias courant).
( cd "$STAGE" && zip -rq "chapote-bot-manager-$VERSION.zip" chapote-bot-manager )
cp "$STAGE/chapote-bot-manager-$VERSION.zip" "$STAGE/chapote-bot-manager.zip"

# 3) Manifeste d'auto-update.
LAST=$(date -u '+%Y-%m-%d %H:%M:%S')
cat > "$STAGE/chapote-bot-manager.json" <<JSON
{
  "name": "Chapote Bot Manager",
  "slug": "chapote-bot-manager",
  "version": "$VERSION",
  "requires": "5.8",
  "tested": "6.6",
  "requires_php": "7.4",
  "last_updated": "$LAST",
  "download_url": "https://chapote.fr/downloads/chapote-bot-manager-$VERSION.zip",
  "homepage": "https://chapote.fr",
  "sections": {
    "changelog": "Voir readme.txt"
  }
}
JSON

# 4) Publication atomique.
install -d "$OUT"
mv "$STAGE"/chapote-bot-manager-*.zip "$STAGE"/chapote-bot-manager.zip "$STAGE"/chapote-bot-manager.json "$OUT/"
rm -rf "$STAGE"
```

> ⚠️ Le **slug du dossier dans le zip** doit être `chapote-bot-manager` (il doit
> correspondre au dossier installé sous `wp-content/plugins/` et au `slug` du
> manifeste), sinon l'auto-update ne s'appliquera pas au bon plugin.

### 1.3 Mécanique d'auto-update côté plugin

L'auto-update auto-hébergé repose sur le manifeste ci-dessus et un brancheur PHP
(à câbler dans le plugin si non présent) qui :

* lit `https://chapote.fr/downloads/chapote-bot-manager.json` (via `wp_remote_get`,
  jamais `curl`/`file_get_contents`) avec un cache transient (~12 h) ;
* compare `version` à `CHAPOTE_BO_VERSION` ;
* si une version plus récente existe, injecte l'objet de mise à jour dans le filtre
  `pre_set_site_transient_update_plugins` (champs `slug`, `new_version`, `package`
  = `download_url`, `url`) et alimente `plugins_api` pour la fiche « Voir les
  détails ».

WordPress propose alors la mise à jour comme pour n'importe quel plugin
(notification + bouton « Mettre à jour »). Le `package` pointe vers le zip
versionné immuable.

> Note de portée : si le brancheur PHP n'est pas encore présent dans
> `includes/`, la distribution reste fonctionnelle en **installation manuelle**
> (téléverser le zip). L'auto-update n'est qu'une commodité ; le manifeste peut
> être publié dès maintenant pour préparer son arrivée.

### 1.4 Procédure de release (auto-hébergé)

1. Mettre à jour la version aux trois endroits (en-tête plugin, `CHAPOTE_BO_VERSION`,
   `Stable tag` du `readme.txt`) et compléter la section `== Changelog ==`.
2. Lancer le build (section 1.2) pour produire les zips + le manifeste dans
   `/downloads`.
3. Vérifier :
   `curl -fsSL https://chapote.fr/downloads/chapote-bot-manager.json` (version
   correcte) et que le zip versionné se télécharge.
4. Sur un WordPress de test, vérifier que la mise à jour est proposée et s'installe.

---

## 2. Soumission sur WordPress.org (canal optionnel)

### 2.1 Pré-requis

* Un compte WordPress.org (le pseudo doit figurer dans `Contributors:` du
  `readme.txt` ; remplacer le placeholder `chapote` par le vrai identifiant `.org`).
* Le plugin doit passer la revue (section 3) avant le premier import.
* Soumettre le plugin pour revue initiale sur
  https://wordpress.org/plugins/developers/add/ (upload du zip). Après validation
  humaine, un dépôt **SVN** est créé : `https://plugins.svn.wordpress.org/chapote-bot-manager/`.

### 2.2 Structure SVN

```
chapote-bot-manager/
├── trunk/            ← code en cours (miroir du dossier plugin)
│   ├── chapote-bot-manager.php
│   ├── readme.txt
│   ├── uninstall.php
│   ├── includes/ admin/ languages/ …
├── tags/
│   └── 2.0.0/        ← copie figée correspondant au Stable tag
└── assets/           ← visuels du répertoire (HORS du zip livré aux sites)
    ├── icon-128x128.png
    ├── icon-256x256.png
    ├── banner-772x250.png
    ├── banner-1544x500.png        (optionnel, haute densité)
    ├── screenshot-1.png
    ├── screenshot-2.png
    ├── screenshot-3.png
    └── screenshot-4.png
```

Règles clés :

* **`Stable tag: 2.0.0`** dans `readme.txt` doit pointer vers un dossier existant
  `tags/2.0.0/`. C'est ce tag (pas `trunk`) que `.org` sert aux utilisateurs.
* Les **screenshots** sont numérotés `screenshot-N.png` et **correspondent dans
  l'ordre** aux entrées de la section `== Screenshots ==` du `readme.txt`
  (1 = connexion, 2 = liste des bots, 3 = apparence/aperçu, 4 = ciblage des pages).
* Les assets (`icon-*`, `banner-*`, `screenshot-*`) vivent dans `assets/` du SVN et
  **ne sont pas** inclus dans le zip distribué aux sites.

### 2.3 Procédure de publication SVN

```bash
svn co https://plugins.svn.wordpress.org/chapote-bot-manager/ svn-chapote
# 1) Synchroniser le code dans trunk/ (depuis integrations/wordpress/chapote-bot-manager/)
rsync -a --delete --exclude '.git*' \
  integrations/wordpress/chapote-bot-manager/ svn-chapote/trunk/
# 2) Déposer les visuels
cp assets/icon-128x128.png assets/icon-256x256.png assets/banner-772x250.png \
   assets/screenshot-*.png svn-chapote/assets/
# 3) Figer la version
svn cp svn-chapote/trunk svn-chapote/tags/2.0.0
# 4) Marquer les ajouts/suppressions puis publier
cd svn-chapote && svn add --force . && svn ci -m "Release 2.0.0"
```

> Une nouvelle version = bump de la version aux 3 endroits + nouveau `tags/X.Y.Z`
> + `Stable tag` mis à jour. Ne jamais réécrire un tag déjà publié.

---

## 3. Checklist de revue WordPress.org

À vérifier **avant** toute soumission (la plupart sont déjà respectées dans le code
actuel ; cette liste sert de garde-fou à chaque release).

* **Licence GPL.** En-tête `License: GPL-2.0-or-later` + `License URI`, et
  `readme.txt` cohérent (`GPLv2 or later`). Aucun code sous licence incompatible.
* **Appels réseau via l'API HTTP de WordPress.** Toutes les requêtes sortantes
  passent par `wp_remote_*` (`class-chapote-bo-api.php`). **Aucun** `curl_*`,
  `file_get_contents()` distant, ni `fsockopen`.
* **Échappement de toute sortie.** `esc_html`/`esc_attr`/`esc_url`/`wp_kses_*` sur
  tout ce qui est affiché côté PHP ; côté SPA, le DOM est construit par
  `createElement` + textNode (pas d'`innerHTML`), couleurs validées avant style
  inline.
* **Assainissement des entrées + permissions.** Chaque route REST vérifie
  `current_user_can('manage_options')` **et** un nonce `wp_rest` ; les paramètres
  sont `sanitize_*` / bornés (modules, ciblage) avant usage.
* **Internationalisation (i18n).** Toutes les chaînes via `__()/esc_html__()` avec
  le text domain `chapote-bot-manager` ; `load_plugin_textdomain` chargé ;
  `Domain Path: /languages`.
* **Divulgation du service externe.** Le `readme.txt` déclare clairement la
  dépendance à Chapote (service tiers payant), les communications avec chapote.fr
  (OAuth + API de compte), les données transmises, et les liens CGU
  (https://chapote.fr/legal/cgu) + confidentialité
  (https://chapote.fr/legal/confidentialite). `wp_add_privacy_policy_content` est
  enregistré.
* **Pas de pistage non consenti.** Aucune télémétrie ni script tiers chargé dans
  wp-admin sans action de l'utilisateur. Les appels à Chapote ne se produisent
  qu'après une action explicite (connexion OAuth, gestion d'un bot) ; le script
  `widget.js` n'est injecté côté public que pour un bot **activé** par
  l'administrateur. Aucune donnée n'est envoyée à des fins de tracking.
* **Pas de code obfusqué / minifié sans source.** Le JS/CSS admin est livré lisible,
  sans étape de build opaque.
* **Préfixe & propreté.** Constantes/fonctions/classes préfixées `chapote_bo` /
  `Chapote_BO_` ; pas d'accès direct aux fichiers (`if (!defined('ABSPATH')) exit;`) ;
  désinstallation propre (`uninstall.php`).
* **En-têtes à jour.** `Requires at least`, `Tested up to: 6.6`, `Requires PHP: 7.4`,
  `Stable tag` alignés entre `readme.txt` et `chapote-bot-manager.php`.
* **Plugin Check.** Faire passer le plugin officiel **Plugin Check**
  (https://wordpress.org/plugins/plugin-check/) et corriger les erreurs bloquantes
  avant soumission.

---

## 4. Récapitulatif des emplacements

| Élément | Emplacement |
|---|---|
| Source du plugin | `integrations/wordpress/chapote-bot-manager/` |
| Version (3 endroits à garder alignés) | en-tête `Version:` + `CHAPOTE_BO_VERSION` + `Stable tag:` |
| Readme distribué/`.org` | `integrations/wordpress/chapote-bot-manager/readme.txt` |
| Zips + manifeste auto-update | `https://chapote.fr/downloads/` (volume nginx app) |
| Assets `.org` (hors zip) | `assets/` du SVN WordPress.org |
