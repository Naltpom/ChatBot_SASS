# Assets WordPress.org — Chapote Bot Manager

Ces fichiers vont dans le dossier **`/assets`** du dépôt SVN WordPress.org (PAS dans
le zip du plugin — voir `docs/PLUGIN_DISTRIBUTION.md`). Ils ne sont jamais chargés
par WordPress sur le site du client : ils servent uniquement à la **fiche** du
répertoire wordpress.org/plugins/chapote-bot-manager/.

Le workflow `.github/workflows/deploy-wp-plugin.yml` pousse tout ce dossier dans
`/assets` (`ASSETS_DIR`). N'y mettre QUE des assets de fiche (pas d'outillage).

## Icône & bannière
| Fichier | Dimensions | Usage |
|---|---|---|
| `icon-256x256.png` | 256×256 | icône haute résolution de la fiche |
| `icon-128x128.png` | 128×128 | icône standard |
| `banner-772x250.png` | 772×250 | bannière de la fiche |
| `banner-1544x500.png` | 1544×500 | bannière retina (2×) |

Marque : chapeau Chapote blanc sur fond navy `#1C3F5C`, accent menthe `#2F9E79`
(source : `app/public/brand/icon.svg`). La bannière est régénérable (cf. plus bas).

## Screenshots — le parcours de création guidé
Décrits dans `readme.txt` (`== Screenshots ==`) :

1. `screenshot-1.png` — **Accueil** de l'assistant guidé (« Créons votre chatbot »).
2. `screenshot-2.png` — **Analyse du site** : choix des pages WordPress publiées.
3. `screenshot-3.png` — **Arbre de conversation** généré par l'IA (badges Accueil/Question/Conseiller/Lead, « → IA »).
4. `screenshot-4.png` — **Offre conseillée** : modules + palier IA + estimation mensuelle.
5. `screenshot-5.png` — **« Mes bots »** : gestion + interrupteur « Sur le site » par bot.

### Comment régénérer (screenshots + bannières)
Rendus **fidèles** : la VRAIE SPA du plugin (`admin/js/*.js` + `admin/css/*.css`) est
exécutée dans Chromium avec l'unique point réseau (`window.fetch`) stubé sur des
**données fake neutres** (aucune marque ou client réel, aucun « test »). La bannière
est un HTML statique aux couleurs de marque. Générateur versionné dans
`integrations/wordpress/wporg-screenshots/` (`harness.html`, `banner.html`, `shoot.mjs`) :

```
cd e2e   # Playwright + Chromium y sont installés
node ../integrations/wordpress/wporg-screenshots/shoot.mjs
```

Le script pilote l'UI (scènes du wizard via `?scene=`) et réécrit `screenshot-1..5.png`
+ `banner-772x250.png` + `banner-1544x500.png` ici. Après un changement d'UI du plugin
ou de nom, relancer cette commande. (Les icônes ne sont pas régénérées par ce script.)
