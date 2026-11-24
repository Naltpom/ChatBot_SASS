// Version du code natif : Expo Go (EXPO_GO=1, mises à jour de test) ou build de l'app (connexion Google
// native, notifications Android, partage). Une mise à jour ne va qu'aux apps de même version native.
// google-services.json (Firebase « chapote-cm-push », notifications Android) n'est pas versionné : sans lui,
// on construit sans notifications Android.
const fs = require('fs')
module.exports = ({ config }) => {
  const android = { ...config.android }
  if (!fs.existsSync(__dirname + '/google-services.json')) delete android.googleServicesFile
  return { ...config, android, runtimeVersion: process.env.EXPO_GO === '1' ? 'exposdk:58.0.0' : { policy: 'appVersion' } }
}
