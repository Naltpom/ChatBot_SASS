# Assets WordPress.org — Chapote Back-Office

Ces fichiers vont dans le dossier **`/assets`** du dépôt SVN WordPress.org (PAS dans
le zip du plugin — voir `docs/PLUGIN_DISTRIBUTION.md`). Ils ne sont jamais chargés
par WordPress sur le site du client : ils servent uniquement à la **fiche** du
répertoire wordpress.org/plugins/chapote-backoffice/.

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

## À CAPTURER avant soumission (screenshots)
Captures à faire **sur une install propre** (données neutres, pas de bots de test),
puis à déposer ici. Décrits dans `readme.txt` (section `== Screenshots ==`) :

1. `screenshot-1.png` — « Mes bots » : liste, badge de facturation, **interrupteur
   « Sur le site »** par bot.
2. `screenshot-2.png` — Gestion d'un bot : en-tête avec l'**interrupteur d'affichage**
   + onglet « Ciblage des pages ».
3. `screenshot-3.png` — « Mon offre » : catalogue/abonnement (Stripe Checkout).
4. `screenshot-4.png` — Onglet **SEO** : lien « Powered by » opt-in + éditeur de FAQ
   (données structurées schema.org).

Format conseillé : largeur ~1200 px, PNG, cadré sur la zone du plugin.
