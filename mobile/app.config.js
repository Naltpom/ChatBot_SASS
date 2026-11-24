// Version du code natif : Expo Go (EXPO_GO=1, mises à jour de test) ou build de l'app (connexion Google
// native, notifications Android, partage). Une mise à jour ne va qu'aux apps de même version native.
module.exports = ({ config }) => ({
  ...config,
  runtimeVersion: process.env.EXPO_GO === '1' ? 'exposdk:58.0.0' : { policy: 'appVersion' },
})
