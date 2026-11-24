// Version du code natif : Expo Go (EXPO_GO=1, mises à jour de test) ou build de l'app (connexion Google
// native, notifications Android, partage). Une mise à jour ne va qu'aux apps de même version native.
// Firebase (« chapote-cm-push », notifications Android) : fichier google-services.json hors dépôt, donné par
// la variable GOOGLE_SERVICES_JSON (chemin) au moment de la build ; sans lui, pas de notifications Android.
const fs = require('fs')
module.exports = ({ config }) => {
  const android = { ...config.android }
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(__dirname + '/google-services.json') ? './google-services.json' : null)
  if (file) android.googleServicesFile = file
  else delete android.googleServicesFile
  return { ...config, android, runtimeVersion: process.env.EXPO_GO === '1' ? 'exposdk:58.0.0' : { policy: 'appVersion' } }
}
