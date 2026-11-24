# Chapote CM — application mobile (Expo)

App Android / iOS (téléphones et tablettes) de cm.chapote.fr. Elle appelle la même API que le site
(`/api/cm/…`, `/api/tiktok/…`, `/api/youtube/…`, `/api/auth/…`) ; le site (`cm/`) n'est pas modifié.

## Connexion
- **Navigateur intégré** : page `https://cm.chapote.fr/api/cm/mobile/connect` (« Autoriser »), retour dans l'app
  avec un code à usage unique lié à un challenge PKCE (`src/lib/auth.ts`).
- **E-mail / mot de passe** (+ code de double authentification) : `/api/auth/login`, puis `/api/cm/mobile/devices`.
- L'appareil garde un jeton longue durée dans le coffre du téléphone (expo-secure-store) ; il obtient des sessions
  d'une heure (`/api/cm/mobile/refresh`) envoyées dans l'en-tête `Cookie` (`src/lib/http.ts`). Déconnexion et liste
  des appareils dans Réglages. Côté serveur : `api/src/routers/cm_mobile.py`.
- Comptes TikTok / Google / Instagram : connexions du site, ouvertes dans le navigateur (aucun changement sur les
  portails des plateformes).

## Notifications
Vidéo publiée, échec, brouillon TikTok, nouveaux commentaires (`api/src/services/cm_push.py`, Expo Push).
Réglables par téléphone dans Réglages. Android dans Expo Go : pas de notifications distantes (build nécessaire).

## Développer
```bash
cd mobile
npm install
npx expo start          # Expo Go
npm run typecheck       # TypeScript
npm test                # logique pure (node --test)
```

## Publier une version de test (Expo Go)
```bash
EXPO_TOKEN=… eas update --branch preview --environment preview --message "…" --non-interactive
```
`runtimeVersion` vaut `exposdk:58.0.0` pour qu'Expo Go (SDK 58) ouvre les mises à jour. Pour une build
(notifications Android, partage depuis la galerie, stores), passer à `{ "policy": "appVersion" }` et `eas build`.

## Structure
- `src/app/` : écrans (expo-router). Onglets : Planning, Commentaires, + Publier, Stats, Bibliothèque.
- `src/lib/` : API (copie des appels du site), session, connexion, envoi en morceaux, notifications.
- `src/ui/` : thème clair / sombre (couleurs du site, réglage dans l'app), composants communs.
- `src/features/` : composants et logique propres à chaque partie, avec leurs tests.
