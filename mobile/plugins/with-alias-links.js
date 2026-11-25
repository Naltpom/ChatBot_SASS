// Icônes au choix (expo-alternate-app-icons) : la bibliothèque recopie les liens de l'app (retours de
// connexion, invitations) sur chaque icône. Ici on les retire des icônes : ces liens restent seulement sur
// l'écran principal, exactement comme avant. Les icônes ne gardent que « ouvrir l'app » (MAIN / LAUNCHER).
const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withAliasLinks(config) {
  return withAndroidManifest(config, cfg => {
    const app = cfg.modResults.manifest.application?.[0]
    for (const alias of app?.['activity-alias'] || []) {
      alias['intent-filter'] = (alias['intent-filter'] || []).filter(f =>
        f.action?.some(a => a.$['android:name'] === 'android.intent.action.MAIN')
        && f.category?.some(c => c.$['android:name'] === 'android.intent.category.LAUNCHER'))
    }
    return cfg
  })
}
