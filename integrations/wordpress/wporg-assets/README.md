# Assets WordPress.org — Chapote Back-Office

Ces fichiers vont dans le dossier **`/assets`** du dépôt SVN WordPress.org (PAS dans
le zip du plugin — voir `docs/PLUGIN_DISTRIBUTION.md`). Ils ne sont jamais chargés
par WordPress sur le site du client : ils servent uniquement à la **fiche** du
répertoire wordpress.org/plugins/chapote-bot-manager/.

## Prêts (générés depuis le logo de marque Chapote)
| Fichier | Dimensions | Usage |
|---|---|---|
| `icon-256x256.png` | 256×256 | icône haute résolution de la fiche |
| `icon-128x128.png` | 128×128 | icône standard |
| `banner-772x250.png` | 772×250 | bannière de la fiche |
| `banner-1544x500.png` | 1544×500 | bannière retina (2×) |

Marque : chapeau Chapote blanc sur fond navy `#1C3F5C`, accent menthe `#2F9E79`
(source : `app/public/brand/icon.svg`). Rendus en PNG via un navigateur headless
(Playwright) à partir du SVG de marque.

## Screenshots (fournis)
Rendus **fidèles** de l'interface réelle (CSS et balisage réels du plugin, données
de démo neutres). Tu peux les garder tels quels ou les remplacer par des captures
brutes prises sur ton install. Décrits dans `readme.txt` (`== Screenshots ==`) :

1. `screenshot-1.png` — « Mes bots » : liste + **interrupteur « Sur le site »** par bot.
2. `screenshot-2.png` — Gestion d'un bot : en-tête avec l'**interrupteur d'affichage**
   + onglet « Ciblage des pages ».
3. `screenshot-3.png` — Onglet **SEO** : lien « Powered by » opt-in + éditeur de FAQ
   (données structurées schema.org).

*(Optionnel : `screenshot-4.png` — « Mon offre » / catalogue Stripe, à capturer si tu
veux montrer le paiement.)* Format : ~1120 px de large, PNG.
