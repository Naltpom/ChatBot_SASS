// Constantes d'intégration externe (plugin WordPress « Chapote Back-office »).
// Module neutre, sans React ni effet de bord : importable côté dashboard
// (pages/Integrations) ET côté landing prérendue (components/landing/Install)
// sans tirer de code applicatif dans le bundle SSR.

// Lien de TÉLÉCHARGEMENT du plugin (variante SELF-HOSTED, avec auto-update depuis
// chapote.fr). Le zip est BÂTI à chaque déploiement par deploy.sh (build_wp_plugin)
// dans app/public/downloads/ et servi par nginx sous /downloads/. C'est CE zip que
// le client installe sur son WordPress (la variante .org « -wporg.zip », sans
// updater, ne sert qu'à la soumission au répertoire WordPress.org, pas au public).
export const WP_PLUGIN_URL = '/downloads/chapote-backoffice.zip'

// Fiche WordPress.org du plugin — PLACEHOLDER tant que le plugin n'est pas
// publié sur le répertoire officiel. À remplacer par l'URL réelle.
export const WP_PLUGIN_WPORG_URL = 'https://wordpress.org/plugins/'
