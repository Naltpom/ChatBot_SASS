# Assistant Chapote CM : le chatbot de chapote.fr sur cm.chapote.fr

Un seul bot, « Assistant Chapote CM », hébergé par chapote.fr et affiché sur cm.chapote.fr.
Ce document couvre le **mode public** (étape 2) : le bot répond avec les seules informations
publiques de cm. Le mode « mes données » (lecture des données cm de l'utilisateur, avec son
accord) est décrit à part, dans `docs/CM_MCP.md` (étape 3).

**État (25 novembre 2026)** :
- le bot est créé en production (id 8) et actif, avec la clé publique `pk_fladg1AxA074Nd79-nsB2l6zuK88RW2P` ;
- l'assistant est sur la **page d'accueil** de cm.chapote.fr (bulle secondaire, chargée après l'affichage) ;
- il n'est pas encore dans l'app web cm, et l'app mobile n'est pas modifiée.

**Pour le couper** : ajouter `VITE_CM_ASSISTANT=off` dans le `.env` du serveur, puis redéployer
(`cm` est reconstruit sans l'assistant). Ou désactiver le bot depuis chapote.fr : le widget répond 404
et la bulle disparaît d'elle-même.

## 1. Le bot

### Création (script, à lancer sur le serveur)

```bash
docker compose -f docker-compose.prod.yml exec api python -m scripts.create_cm_assistant --owner-email <adresse du compte admin> --dry-run
```

```bash
docker compose -f docker-compose.prod.yml exec api python -m scripts.create_cm_assistant --owner-email <adresse du compte admin>
```

`--activate` active le bot (il est créé **inactif**). Relancer le script met à jour le même bot :
pas de doublon. Il affiche l'id et la **clé publique** (`pk_…`, publique par nature : elle ne
fait qu'ouvrir une session, vérifiée par le domaine, le captcha et les limites de débit).

Ce que le script règle :

| Réglage | Valeur |
|---|---|
| Propriétaire | le compte passé en `--owner-email` (refusé s'il n'est pas administrateur) |
| Mode | IA (texte libre), réponses courtes (température 0,3) |
| Consignes | `api/scripts/cm_assistant/system_prompt.md` |
| Base de connaissances | `api/scripts/cm_assistant/kb/*.md` (4 textes, remplacés à chaque lancement) |
| Domaines autorisés | `cm.chapote.fr`, `localhost` (développement) |
| Captcha | Turnstile, clés déjà en place sur le serveur (`TURNSTILE_*`) |
| Facturation | override « offert » (étape 1) : actif, modules IA + connaissances + MCP, **3000 réponses IA / mois**, dépassement bloqué. Visible dans Admin → Facturation, tracé dans l'historique du bot |
| Apparence | petite bulle (48 px) « ? », sans pastille rouge, orange clair par défaut, sombre neutre (`surfaceTone: neutral`) ; la page transmet la couleur et le thème choisis |
| Connecteur MCP | **aucun** (étape 4) |

### Base de connaissances : d'où vient chaque texte

| Fichier | Source dans le dépôt |
|---|---|
| `01_accueil_et_faq.md` | `cm/src/pages/Landing.tsx` : textes repris mot pour mot, FAQ comprise |
| `02_utiliser_chapote_cm.md` | `docs/CM.md`, réécrit en mots simples, fonctions proposées aux utilisateurs seulement |
| `03_confidentialite.md` | `cm/src/legal/privacy.md` |
| `04_conditions.md` | `cm/src/legal/terms.md` |

Retirés exprès : tout ce qui touche aux commentaires (fonction désactivée), les adresses e-mail
(remplacées par un renvoi vers la page en ligne), les détails techniques (variables, routine,
noms de services internes).
Le test `api/tests/test_cm_assistant_kb.py` vérifie que chaque réponse de la FAQ de la page
d'accueil figure mot pour mot dans la base, qu'aucune adresse e-mail ni le mot « commentaire »
n'y figure, et que les faits clés sont présents. **Si la page d'accueil ou les pages légales
changent, mettre à jour ces fichiers puis relancer le script.**

## 2. Code d'intégration

### Page d'accueil et app web cm (React)

Le composant est prêt : `cm/src/components/ChapoteAssistant.tsx`.

```tsx
import ChapoteAssistant from '../components/ChapoteAssistant'

// Page d'accueil (cm/src/pages/Landing.tsx), juste avant la fermeture de <div className="lp">
<ChapoteAssistant />

// App web (cm/src/components/Layout.tsx) : rien n'est chargé avant le clic
<ChapoteAssistant loadOn="click" />
```

Il ne fait rien tant que ces variables ne sont pas fournies **au build** de `cm` :

| Variable | Valeur |
|---|---|
| `VITE_CM_ASSISTANT` | `on` (tout autre valeur = désactivé) |
| `VITE_CM_ASSISTANT_KEY` | clé publique du bot (`pk_…`) |
| `VITE_CM_ASSISTANT_SRC` | facultatif, défaut `https://chapote.fr/widget.js` |

Passées au build Docker (en place depuis l'activation sur la page d'accueil ; défauts dans
`docker-compose.prod.yml`, modifiables par `.env`) :

```dockerfile
# cm/Dockerfile, étape build, avant « RUN npm run build »
ARG VITE_CM_ASSISTANT=""
ARG VITE_CM_ASSISTANT_KEY=""
ENV VITE_CM_ASSISTANT=$VITE_CM_ASSISTANT VITE_CM_ASSISTANT_KEY=$VITE_CM_ASSISTANT_KEY
```

```yaml
# docker-compose.prod.yml, service cm
    build:
      context: ./cm
      dockerfile: Dockerfile
      args:
        VITE_CM_ASSISTANT: ${VITE_CM_ASSISTANT:-on}
        VITE_CM_ASSISTANT_KEY: ${VITE_CM_ASSISTANT_KEY:-pk_fladg1AxA074Nd79-nsB2l6zuK88RW2P}
```

À l'intégration dans l'app web : vérifier que la bulle ne recouvre pas la barre de navigation du
bas sur mobile (sinon, monter la bulle : `offsetY` du design du bot + `bottom` de
`.cm-assistant-bubble` dans `cm/src/styles.css`).

### Version HTML (référence, pour toute autre page)

```html
<script src="https://chapote.fr/widget.js" async
        data-bot-key="pk_…"
        data-color="#C93F17" data-color-text="#ffffff" data-theme="light"
        data-url-mode="path"></script>
```

## 3. Chargement différé

La page d'accueil doit rester sous 3 s sur mobile et garder **un seul bouton principal** (« Planifier
mes vidéos gratuitement ») : la bulle est secondaire (48 px, sans libellé, sans pastille, en bas à
droite).

- Au premier affichage, **aucun octet du widget** : React dessine une bulle légère (même place,
  même taille, même icône que celle du widget).
- `loadOn="idle"` (page d'accueil) : `widget.js` est demandé après l'événement `load`, quand le
  navigateur est au repos (`requestIdleCallback`, 5 s maximum ; 2,5 s sans cette fonction).
  Le widget dessine alors sa propre bulle à la même place et la bulle React disparaît.
- `loadOn="click"` (app web) : rien n'est chargé avant le clic ; le clic charge le widget et
  l'ouvre directement (`data-open="true"`).
- Clic avant la fin du chargement : le panneau s'ouvre dès que le widget est prêt.

Mesuré en local (build de production, profil Pixel 7, réseau 1,6 Mbit/s et 150 ms, processeur
ralenti ×4, 3 essais chacun) :

| | Premier affichage (FCP) | Plus grand élément (LCP) | `widget.js` demandé à |
|---|---|---|---|
| Sans l'assistant | 1,89 – 1,92 s | 2,37 – 2,38 s | — |
| Avec l'assistant | 1,88 – 1,90 s | 2,37 – 2,38 s | 2,39 – 2,40 s (après le LCP) |

## 4. Couleurs et thème

cm.chapote.fr propose trois couleurs, chacune en clair et en sombre (`styles.css`, `--primary` et
`--on-primary`) :

| Couleur | Clair | Texte sur la couleur | Sombre | Texte sur la couleur |
|---|---|---|---|---|
| Orange (défaut, `warm`) | `#C93F17` | `#ffffff` | `#FF6A3D` | `#1a0e08` |
| Bleu océan (`ocean`) | `#0066cc` | `#ffffff` | `#2997ff` | `#00101f` |
| Vert forêt (`forest`) | `#1f6b4a` | `#ffffff` | `#5cc495` | `#062014` |

Le composant lit la couleur choisie (`<html data-palette>`, mémorisée sous `cm.palette` dans le
navigateur) et le mode clair ou sombre de l'appareil. Il les transmet au widget au chargement, puis
à chaque changement (choix d'une autre couleur dans le menu, passage clair/sombre), sans recharger
ni couper la conversation.

Ajouts **facultatifs** dans `widget/widget.js` (rien ne change pour les autres sites clients :
rendu comparé au pixel près avec la version de `master`, en clair et en sombre) :

| Attribut du `<script>` | Effet |
|---|---|
| `data-color` | couleur de marque (bulle, en-tête, bouton d'envoi, bulles de l'utilisateur) |
| `data-color-text` | texte posé sur cette couleur |
| `data-theme` | `light` ou `dark` (le ton des surfaces sombres vient du design du bot : `surfaceTone`) |
| `data-open="true"` | ouvre le panneau dès qu'il est prêt (chargement au clic) |
| `data-url-mode="path"` | n'envoie que l'origine + le chemin de la page, jamais les paramètres ni le fragment |

API JavaScript pour la page hôte, une entrée par clé :
`window.ChapoteWidget["pk_…"].open()`, `.close()`, `.setAppearance({ color, colorText, theme })`
(sans effet si rien ne change).
Événement `chapote-widget-ready` (`detail.key`) quand le widget est prêt.

Captures (page d'accueil, mobile 390 px, trois couleurs en clair et en sombre, bulle fermée,
`/widget-frame` en sombre) : `docs/captures/widget-cm/`.

Nouvelles options d'apparence du bot (validées par `sanitize_design`, défauts = rendu actuel) :

| Clé | Défaut | Effet |
|---|---|---|
| `launcherBadge` | `true` | pastille « 1 » sur la bulle fermée ; `false` = sans pastille |
| `onPrimary` | `null` (blanc) | texte posé sur la couleur de marque ; `data-color-text` le remplace |
| `surfaceTone` | `classic` | `neutral` : sombre neutre, réponses rapides sur le fond du panneau, lien « Chapote » à la couleur de marque |

## 5. CSP de cm.chapote.fr (`cm/nginx.conf`)

En place (ajoutées sans rien enlever). Deux directives ont changé :

| Directive | Ajout | Pourquoi |
|---|---|---|
| `script-src` | `https://chapote.fr` | `widget.js` |
| `connect-src` | `https://chapote.fr` | appels du widget (`/api/widget/bootstrap`, `/session`, `/message`, `/poll`, `/feedback`) |
| `frame-src` | rien | le captcha Turnstile (`https://challenges.cloudflare.com`) y est déjà |
| `img-src` | rien | `https:` y est déjà |
| `style-src` | rien | `'unsafe-inline'` y est déjà (le widget injecte sa feuille de style) |

Les deux directives :

```nginx
script-src 'self' https://accounts.google.com/gsi/client https://challenges.cloudflare.com https://chapote.fr;
connect-src 'self' https://accounts.google.com/gsi/ https://chapote.fr;
```

Le captcha utilise la même clé Turnstile que le formulaire « Donner mon avis » de cm : le domaine
cm.chapote.fr y est donc déjà autorisé chez Cloudflare.

## 6. Ce qu'on transmet au bot, et ce qui ne part jamais

Transmis (mode public) :

- le **chemin** de la page courante (`/`, `/stats`… : `data-url-mode="path"`) ;
- le parcours sur le site dans l'onglet (10 derniers chemins, sans paramètres) ;
- un identifiant de visiteur aléatoire, créé par le widget dans le navigateur ;
- les messages que la personne écrit dans le chat.

« Connecté ou non » n'est **pas** transmis à cette étape : le bot répond pareil à tout le monde.
L'état connecté arrivera avec le jeton court de l'étape 3 (`docs/CM_MCP.md`), seulement si
l'utilisateur a donné son accord IA.

Ne part jamais vers le bot ni vers l'IA :

- nom, prénom, e-mail, téléphone, date de naissance de l'utilisateur ;
- jetons et identifiants techniques des comptes TikTok, Google et Meta (y compris les
  identifiants internes dans les adresses, comme `?account=tiktok:12`, et les codes de connexion
  des pages `/…/callback`) ;
- les commentaires des vidéos ;
- les noms des comptes (@pseudo).

Le composant ne lit ni la session ni le compte de l'utilisateur.
Les consignes demandent au bot de ne jamais demander ni répéter une donnée personnelle.

## 7. App mobile (à copier dans l'autre conversation, aucune modification ici)

Principe : une WebView affiche une petite page HTML dont l'adresse de base est
`https://cm.chapote.fr/assistant`. Cette page contient une `iframe` vers
`https://chapote.fr/widget-frame`. Le serveur vérifie le domaine de la page parente
(`document.referrer` de l'iframe = `https://cm.chapote.fr/`), qui est autorisé.
Charger `/widget-frame` directement dans la WebView serait refusé : pas de page parente, donc pas de
domaine à vérifier.

`/widget-frame` accepte maintenant `color`, `color_text` (hex `#rrggbb`) et `theme`
(`light` / `dark`), et sa CSP autorise Turnstile (sans quoi le captcha échouait en iframe).

```tsx
// ChapoteAssistant.tsx (app mobile) — dépendance : react-native-webview
import { Linking, useColorScheme } from 'react-native'
import { WebView } from 'react-native-webview'

const BOT_KEY = 'pk_…'   // clé PUBLIQUE du bot (pas un secret)
const FRAME = 'https://chapote.fr/widget-frame'
const BASE = 'https://cm.chapote.fr/assistant'
const PALETTES = {
  warm: { light: ['#C93F17', '#ffffff'], dark: ['#FF6A3D', '#1a0e08'] },
  ocean: { light: ['#0066cc', '#ffffff'], dark: ['#2997ff', '#00101f'] },
  forest: { light: ['#1f6b4a', '#ffffff'], dark: ['#5cc495', '#062014'] },
} as const
type Palette = keyof typeof PALETTES

// Seules ces adresses s'ouvrent dans la WebView ; tout autre lien part dans le navigateur.
const INSIDE = [BASE, 'https://chapote.fr/widget-frame', 'https://challenges.cloudflare.com/', 'about:blank']

export default function ChapoteAssistant({ palette }: { palette: Palette }) {
  const theme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const [color, text] = PALETTES[palette][theme]
  const src = `${FRAME}?key=${BOT_KEY}&color=${encodeURIComponent(color)}`
    + `&color_text=${encodeURIComponent(text)}&theme=${theme}`
  const bg = theme === 'dark' ? '#161514' : '#f8fafc'
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body,iframe{margin:0;border:0;width:100%;height:100%;background:${bg}}</style>
</head><body><iframe src="${src}" title="Assistant Chapote CM"></iframe></body></html>`

  return (
    <WebView
      key={`${palette}-${theme}`}                // nouvelle couleur ou thème : on recharge
      source={{ html, baseUrl: BASE }}
      originWhitelist={['https://*', 'about:*']}
      javaScriptEnabled
      domStorageEnabled                          // la conversation reste 2 h (localStorage)
      onShouldStartLoadWithRequest={(req) => {
        if (INSIDE.some((p) => req.url.startsWith(p))) return true
        Linking.openURL(req.url)                 // liens externes : navigateur du téléphone
        return false
      }}
      setSupportMultipleWindows
      onOpenWindow={(e) => Linking.openURL(e.nativeEvent.targetUrl)}  // liens target=_blank du chat
      // Permissions minimales : ni caméra, ni micro, ni position, ni fichiers.
      geolocationEnabled={false}
      mediaCapturePermissionGrantType="deny"
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      allowsBackForwardNavigationGestures={false}
      style={{ flex: 1, backgroundColor: bg }}
    />
  )
}
```

Permissions Android : seulement `INTERNET` (déjà présente). Aucune permission ajoutée.

À tester sur un vrai téléphone : si le bot répond « Domaine parent non autorisé », la WebView
n'envoie pas l'adresse de la page parente. Me le signaler : on passera alors par une page dédiée
sur cm.chapote.fr (une nouvelle route, sans toucher aux routes existantes).

### Prompt pour la conversation de l'app mobile

> Prépare, sans l'activer, un écran « Assistant » dans l'app Android de cm.chapote.fr. Copie le
> composant React Native de la section 7 de `docs/WIDGET_CM.md` (dépôt Naltpom/ChatBot_SASS) :
> une WebView avec `react-native-webview`, qui affiche `https://chapote.fr/widget-frame` dans une
> iframe, avec la clé publique du bot, la couleur choisie dans l'app (orange, bleu océan, vert
> forêt) et le thème clair/sombre de l'appareil. Liens externes ouverts dans le navigateur,
> aucune permission en plus d'Internet. Mets l'écran derrière un drapeau désactivé par défaut,
> sans l'ajouter au menu. N'envoie aucune donnée de compte (nom, e-mail, téléphone, jetons) à la
> WebView. Teste sur un téléphone que le bot répond, en clair et en sombre, dans les trois
> couleurs, puis montre-moi des captures avant toute publication.

## 8. Avant d'activer (liste de contrôle)

1. Lancer le script de création, puis `--activate`.
2. Vérifier dans Admin → Facturation : bot actif, quota 3000, source « staff ».
3. Ajouter les deux sources à la CSP de `cm/nginx.conf` (section 5).
4. Passer `VITE_CM_ASSISTANT=on` et la clé au build de `cm` (section 2), placer
   `<ChapoteAssistant />` sur la page d'accueil.
5. Tester sur cm.chapote.fr : clair et sombre, trois couleurs, questions de la FAQ, question hors
   sujet, « bilan de mes vidéos » (le bot doit dire qu'il ne voit pas les données du compte).

Pour tout couper : retirer `VITE_CM_ASSISTANT` et reconstruire `cm`, ou désactiver le bot depuis
chapote.fr (le widget répond alors 404 et n'affiche rien).
