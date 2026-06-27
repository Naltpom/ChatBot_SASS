// Constantes d'intégration externe (plugin WordPress « Chapote Back-office »).
// Module neutre, sans React ni effet de bord : importable côté dashboard
// (pages/Integrations) ET côté landing prérendue (components/landing/Install)
// sans tirer de code applicatif dans le bundle SSR.

// Lien de TÉLÉCHARGEMENT du plugin. Sert pour l'instant un zip statique du
// front (app/public/downloads/…). À BRANCHER sur le vrai zip (release GitHub ou
// artefact de build du plugin) une fois publié.
export const WP_PLUGIN_URL = '/downloads/chapote-backoffice.zip'

// Fiche WordPress.org du plugin — PLACEHOLDER tant que le plugin n'est pas
// publié sur le répertoire officiel. À remplacer par l'URL réelle.
export const WP_PLUGIN_WPORG_URL = 'https://wordpress.org/plugins/'
