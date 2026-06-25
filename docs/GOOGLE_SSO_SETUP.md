# SSO Google (« Continuer avec Google ») — mise en place

> Le code est livré (flux **ID token**). Il ne reste qu'à créer un **Client ID
> OAuth** dans la Google Cloud Console et à le coller dans l'env. Rédigé 2026-06-24.

## 0. TL;DR

1. Cloud Console → crée un projet → **écran de consentement OAuth** (externe) → **Client ID OAuth « Application Web »**.
2. Renseigne les **origines JavaScript autorisées** (PAS de redirect URI nécessaire) :
   - dev : `http://localhost:3001`
   - prod : `https://chapote.fr` (+ `https://www.chapote.fr` si utilisé)
3. Copie le **Client ID** (`xxxx.apps.googleusercontent.com`) → mets-le dans `GOOGLE_CLIENT_ID` **et** `VITE_GOOGLE_CLIENT_ID`.
4. Recrée les conteneurs (le front bake la valeur au build). Le bouton apparaît tout seul.

Tant que les variables sont **vides**, le bouton reste masqué et l'endpoint
`/api/auth/google` répond 401 (« SSO non configuré »). Aucune régression.

---

## 1. Côté Google Cloud Console

### 1.A — Projet
`console.cloud.google.com` → sélecteur de projet (barre du haut) → **Nouveau projet**
→ nom p.ex. `Chapote SSO` → **Créer**, puis sélectionne-le.

### 1.B — Écran de consentement OAuth
*APIs & Services → OAuth consent screen*
- **User type : External** → Create.
- App name : `Chapote` ; e-mail support : ton e-mail ; logo (optionnel).
- **Scopes** : ajoute seulement `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`.
- **Test users** : tant que l'app est en mode *Testing*, AJOUTE les e-mails autorisés à
  se connecter (sinon Google bloque). Passe en **Production** (bouton *Publish app*)
  quand tu veux ouvrir à tous — pas de validation Google nécessaire pour ces 3 scopes
  « non sensibles ».

### 1.C — Client ID OAuth
*APIs & Services → Credentials → Create credentials → OAuth client ID*
- **Application type : Web application**
- Name : `Chapote Web`
- **Authorized JavaScript origins** (⚠️ c'est ICI que ça se joue, pas les redirect URIs) :
  - `http://localhost:3001`  *(dev)*
  - `https://chapote.fr`     *(prod)*
  - `https://www.chapote.fr` *(prod, si le www est servi)*
- **Authorized redirect URIs** : *laisse vide* — le flux ID token (One Tap / bouton GIS)
  n'en utilise pas.
- **Create** → copie le **Client ID** affiché (`…apps.googleusercontent.com`).
  *(Le client secret n'est pas utilisé par ce flux : tu peux l'ignorer.)*

> Un seul Client ID suffit pour dev **et** prod (les deux origines y sont déclarées).
> Si tu préfères isoler, crée-en deux et utilise des `.env` distincts.

---

## 2. Côté app

### Dev
Dans `.env` :
```dotenv
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com   # même valeur
```
Puis recrée les conteneurs (le front lit la var au démarrage de Vite) :
```bash
docker compose up -d --force-recreate app api
```
Va sur `http://localhost:3001/login` → le bouton Google apparaît sous « ou ».

### Prod
Le front prod **bake** la valeur au build → il faut la passer au build, pas juste au runtime.
Dans l'env de prod (`.env` du serveur) :
```dotenv
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
```
Puis **rebuild** l'image front (sinon la valeur n'est pas embarquée) :
```bash
docker compose -f docker-compose.prod.yml up -d --build app api
```

---

## 3. Comment ça marche (rappel implémentation)

- **Front** (`app/src/components/GoogleButton.tsx`) : charge Google Identity Services,
  affiche le bouton officiel, récupère un **ID token** signé et le POST à l'API.
- **API** (`api/src/services/google_oauth.py`) : vérifie la **signature** (JWKS Google),
  l'**audience** (`aud == GOOGLE_CLIENT_ID`), l'émetteur et `email_verified`.
- **Endpoint** `POST /api/auth/google` (`api/src/routers/auth.py`) : email connu → login ;
  inconnu → crée un **compte perso** (sans org, `auth_source="google"`), consomme les
  invitations en attente, renvoie le même `TokenOut` que login/register.

Un compte créé via Google n'a **pas de mot de passe** utilisable (le changement de mot de
passe lui est refusé : `auth_source != "local"`). S'il existait déjà un compte local avec
le même e-mail, la connexion Google le **réutilise** (rapprochement par e-mail).

---

## 4. Dépannage
- **Bouton absent** : `VITE_GOOGLE_CLIENT_ID` vide ou front pas rebuild/relancé.
- **`401 SSO Google non configuré`** : `GOOGLE_CLIENT_ID` absent côté API.
- **`The given origin is not allowed`** (console navigateur) : l'origine exacte n'est pas
  dans *Authorized JavaScript origins* (attention au port `:3001` et à http vs https).
- **`401 Token Google invalide (... audience ...)`** : le Client ID de l'API ≠ celui du front.
- **Rien ne se passe au clic / popup bloquée** : autoriser les pop-ups pour le domaine.
