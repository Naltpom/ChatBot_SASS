# 05 — Sous-titres et texte à l'écran qui retiennent l'attention

Recherche pour les vidéos de promo de Chapote CM (cm.chapote.fr), rendues en Remotion à partir de mots horodatés (TTS).
Toile de référence : **1080 × 1920, 30 i/s**. Date : 27/11/2026.

> **Convention de ce document.** Ce qui est marqué **[source]** vient d'une source citée en fin de document (numéro entre crochets).
> Ce qui est marqué **[réglage proposé]** est une valeur de départ de ma part, à valider en A/B. Elle ne vient d'aucune étude.
> Je n'ai trouvé aucune étude publiée et contrôlée sur l'effet d'un *style* de sous-titres (Hormozi, karaoké, etc.) sur la rétention.
> Les seuls chiffres publiés portent sur la présence ou l'absence de sous-titres, et ils viennent presque tous de vendeurs de sous-titrage.

---

## 0. En bref (ce qu'il faut changer d'abord)

1. **Vérifier la place de la pastille actuelle.** Les trois plateformes masquent le bas de l'image sur 660 à 672 px
   (TikTok 660, Reels 672, Shorts 672) [2][4][5]. Tout sous-titre dont le bas descend sous **y = 1248** risque d'être caché
   par la légende, le pseudo et la barre de son. Le gabarit officiel Remotion TikTok pose ses sous-titres à `bottom: 350`
   (y ≈ 1420–1570) [9] : c'est **dans** la zone masquée. Il ne faut pas le copier tel quel.
2. **Passer de 4 mots à 2–3 mots par page**, en majuscules grasses, avec un **contour** plutôt qu'une pastille, et faire
   **« pop »** le mot dit (échelle 1 → ~1,1 en 3–4 images). C'est le style dominant des vidéos courtes (Hormozi, Submagic,
   modèles Remotion) [6][7][10][11]. Ce n'est pas prouvé par une étude : il faut le tester en A/B contre le style actuel.
3. **Mettre en couleur seulement les mots-clés** (1 par phrase : « gratuit », « TikTok », « 3 clics »…), pas chaque mot dit.
   Une étude sur les sous-titres d'apprentissage trouve que les surlignages répétés distraient, et que la plupart des
   utilisateurs préfèrent alors des sous-titres standards, sauf s'ils veulent apprendre [15]. Une autre étude, auprès de
   spectateurs sourds ou malentendants, trouve que surligner les mots-clés rend la vidéo plus facile à suivre [14].
4. **Texte d'accroche dès l'image 0**, dans le tiers haut-milieu (y ≈ 288–840), 7 mots au plus, tenu au moins 1,5–2 s.
   Pendant ce temps, les sous-titres ne doublent pas l'accroche.
5. **Zone commune aux 3 plateformes** (la plus stricte de chacune) : **x 120 → 888, y 288 → 1248** (768 × 960 px).
   Pour un texte centré à l'œil, garder 192 px de chaque côté : **colonne x 192 → 888 (696 px), centrée sur x = 540**.
   Voir §2.4.

---

## 1. Ce que disent les données (et leurs limites)

| Constat | Chiffre | Qualité de la source |
|---|---|---|
| Sous-titres et durée de visionnage (pubs vidéo Facebook) | **+12 %** de temps de vue en moyenne (étude interne Facebook) | Chiffre très repris, **source primaire introuvable** ; cité par Kapwing [12] et 3Play [13] |
| Sous-titres et vues YouTube (Discovery Digital Networks × 3Play, 2016) | **+7,32 %** de vues sur la durée de vie, **+13,48 %** les 14 premiers jours ; 125 vidéos sous-titrées contre 209 sans, sur 8 chaînes ; pas d'effet significatif sur les partages | Étude contrôlée, mais publiée par un vendeur de sous-titres [13][16] |
| Visionnage sans le son (Verizon Media × Publicis Media, avril 2019) | **92 %** regardent sans le son sur mobile, **83 %** tous écrans ; 50 % jugent les sous-titres importants car ils regardent sans le son ; **jusqu'à 80 %** plus enclins à finir une vidéo sous-titrée | Sondage de 5 616 adultes américains de 18 à 54 ans [12][13][17] |
| Test indépendant (Instapage) | **+5 %** de temps de vue total, **+3 %** de spectateurs avec sous-titres | Petit test d'un seul annonceur [18] |
| Jeunes et sous-titres | **80 %** des 18–25 ans regardent la télé avec sous-titres « parfois ou la plupart du temps » (étude BBC/Stagetext) | Cité par Kapwing [12] |
| TikTok (conseils aux annonceurs) | Afficher **5 à 10 mots par seconde** quand on utilise du texte ; présenter la proposition dans les **3 premières secondes** ; l'accroche dans les **6 premières** | Guide officiel TikTok Ads [3] |
| Mot par mot à la même place | Compréhension **comparable** aux sous-titres classiques (18 participants, oculométrie) | Étude académique, petit échantillon [19] |

**À retenir :** l'effet « sous-titres oui/non » est de l'ordre de +5 à +12 % sur le temps de vue ou les vues, d'après des
sources fragiles. **Aucune étude publiée ne compare les styles entre eux.** La seule façon de savoir quel style marche pour
Chapote CM, c'est de le tester (le dépôt a déjà `scripts/ab.py`).

Le chiffre TikTok de « 5 à 10 mots par seconde » est étonnant : une voix française parle à environ 2,5–3,5 mots/s.
Je le lis comme « le texte ne doit jamais être plus lent que la voix », pas comme une cadence à viser.

Repère de lecture professionnel (Netflix, sous-titres anglais) : **20 caractères par seconde** au plus pour les adultes,
**42 caractères par ligne**, 2 lignes au plus, coupure avant une conjonction ou une préposition, jamais entre un article et
son nom ni entre un pronom sujet et son verbe [20]. Ces règles visent le cinéma, mais les règles de coupure valent pour
les pages de 2–3 mots.

---

## 2. Zones de sécurité (1080 × 1920)

Toutes les plateformes publient leurs zones **pour la publicité**. Aucune ne publie de zone officielle pour les posts
organiques [4][5]. L'interface organique est proche, mais elle change (YouTube a ajouté un mode « écran dégagé » en 2026 [5]).

### 2.1 Par plateforme

| Plateforme | Haut | Bas | Gauche | Droite | Particularités | Origine |
|---|---|---|---|---|---|---|
| **TikTok** (In-Feed) | **240 px** | **660 px** | **120 px** | **120 px** | Colonne des boutons (avatar, j'aime, commentaires, favoris, partage) : **180 px de large** sur le bord droit, sur **1 080 px** de haut depuis le bas (donc de y = 840 à 1920) | Gabarit officiel TikTok, mesuré à 720 × 1280 (160 / 440 / 80 / 80 px) puis × 1,5 [1][2] |
| TikTok avec « anchor » (lien) | 252 px | 812 px (1 ligne de légende) → 878 → 946 → **1 014 px** (4 lignes) | 120 px | colonne de 240 px dès y = 360 | — | Gabarit officiel, mesuré [1] |
| **Instagram Reels** | **14 % ≈ 269 px** | **35 % ≈ 672 px** | **6 % ≈ 65 px** | **6 % ≈ 65 px** | Boutons à droite, pseudo + légende + son en bas, libellés en haut. Certaines sources donnent un bas de 20 à 35 %, ou 40 % avec mentions légales | Guide des pubs Meta (pourcentages), conversion en px par Socialync [4][21] |
| **YouTube Shorts** | **288 px** | **672 px** | **48 px** | **192 px** | Zone sûre = rectangle x 48 → 888, y 288 → 1248 (840 × 960) | **PDF officiel Google « Universal Video Ad Safe Zones », lu directement** (cotes 288 / 48 / 192 / 672 sur l'écran 1080 × 1920) [5] |

### 2.2 Zone commune (le plus strict de chaque côté)

| Bord | Valeur retenue | Plateforme qui l'impose |
|---|---|---|
| Haut | **288 px** | Shorts |
| Bas | **672 px** (donc rien d'important sous **y = 1248**) | Reels et Shorts |
| Gauche | **120 px** | TikTok |
| Droite | **192 px** (couvre aussi la colonne de 180 px de TikTok) | Shorts |
| **Rectangle sûr** | **x 120 → 888, y 288 → 1248 = 768 × 960 px** | — |

### 2.3 Bandes utiles à l'intérieur de la zone sûre [réglage proposé]

| Bande | y | Usage |
|---|---|---|
| Titre / accroche | 288 → 700 | Texte d'accroche, titre d'étape, compteur « 2/5 » |
| Contenu | 700 → 1000 | Capture de l'app, visage |
| Sous-titres | **1000 → 1240** | Bloc de sous-titres, **bas du bloc ≤ 1240** |
| Barre de progression | 288 → 300 (haut de la zone) | Fine barre, voir §5 |

ManyPixels recommande la bande **240 → 840 px** pour les titres et logos [1], ce qui concorde.

### 2.4 Centrage

La zone commune n'est pas symétrique (120 px à gauche, 192 px à droite). Deux options :

- **Colonne symétrique** x 192 → 888 (**696 px**, centrée sur x = 540) : le plus simple, le texte reste centré à l'œil.
  C'est mon choix pour les sous-titres. [réglage proposé]
- Colonne complète x 120 → 888 (768 px, centrée sur x = 504) : 72 px de plus, mais le texte paraît décalé à gauche.

Le gabarit Remotion utilise `width * 0.9` = 972 px [9] : c'est **trop large** pour la colonne des boutons.

---

## 3. Huit styles de sous-titres, paramètres précis

Les **paramètres d'origine** de chaque style viennent des sources citées. Les tailles en px pour 1080 × 1920 et les durées
sont des **[réglages proposés]** quand rien n'est cité. Toutes les pages doivent tenir dans **696 px** de large (§2.4) :
utiliser `fitText` (`@remotion/layout-utils`) et prendre `min(taille voulue, taille qui tient)`.

Rappels communs [réglage proposé] :
- contour avec `WebkitTextStroke` + `paintOrder: "stroke"` (le contour passe derrière le remplissage : le gabarit Remotion fait ainsi [9]) ;
- une page apparaît **50 ms avant** son premier mot et reste jusqu'à la page suivante (sinon clignotement) ;
- jamais une page de plus de 2 lignes ;
- accents en majuscules : charger les glyphes latins étendus (`É`, `À`, `Ç`), vérifier que la police les a (Anton et Montserrat les ont) ;
- ponctuation française : `!`, `?`, `:` restent collés au mot (espace insécable U+202F), pour ne jamais finir seuls sur une ligne.

### Style 1 — « Hormozi » (majuscules massives, mot-clé en couleur)

| Paramètre | Valeur | Origine |
|---|---|---|
| Police | **Montserrat Black (900)** ou **Anton** (version récente) ; « TheBoldFont » à l'origine | [6][7][10] |
| Casse | MAJUSCULES, italique parfois | [7][10] |
| Taille | 96–110 px [réglage proposé] (85 dans Premiere selon un guide, unité non comparable [7]) | — |
| Couleurs | Blanc `#FFFFFF` ; mot-clé **jaune `#F7C204`**, **vert `#02FB23`** ou rouge, **1 mot-clé par phrase** | [7] (valeurs d'un vendeur de préréglages) |
| Contour / ombre | Contour noir épais (≈ taille / 7, soit 14–16 px) + ombre portée légère ; l'ancienne version avait une ombre sans contour | [6][7] |
| Mots | 3 à 5 mots par ligne au plus ; 2–3 mots par page conseillés [réglage proposé] | [7] |
| Animation | Mot par mot ; « pop-in » qui monte du bas (version récente) ; mot-clé un peu plus gros | [6][7] |
| Durée | page ≈ 600–900 ms (`combineTokensWithinMilliseconds: 800`) [réglage proposé] | — |

### Style 2 — Karaoké (mot dit qui change de couleur)

| Paramètre | Valeur | Origine |
|---|---|---|
| Police | TheBoldFont (gabarit Remotion) ; Montserrat 800 en remplacement libre | [9] |
| Taille | **120 px voulus**, réduits par `fitText` | [9] |
| Couleurs | Blanc, mot dit en **vert `#39E508`** (gabarit) → pour Chapote : **orange de la marque** | [9] |
| Contour | `WebkitTextStroke: "20px black"`, `paintOrder: "stroke"` | [9] |
| Mots | page de **1 200 ms** (`SWITCH_CAPTIONS_EVERY_MS = 1200`) ; 200 ms = 1 mot ; 1 500 ms = beaucoup de mots | [9] |
| Animation d'entrée de page | `spring({damping: 200, durationInFrames: 5})`, échelle **0,8 → 1** et translation **50 → 0 px** | [9] |
| Remarque | C'est le **style actuel** de Chapote (mot courant en orange), mais en pastille et à 4 mots | — |

### Style 3 — Mot unique « punch »

| Paramètre | Valeur | Origine |
|---|---|---|
| Police | Anton ou Montserrat Black | [6][10] |
| Taille | **150–180 px** (un seul mot tient toujours) [réglage proposé] | — |
| Couleurs | Blanc + contour noir ; mot-clé en orange | — |
| Mots | **1 mot par page** : `combineTokensWithinMilliseconds: 0` (ou `breakOnSilenceAfterMilliseconds: 0`) | [8] |
| Animation | échelle **1,25 → 1** en 4 images (`spring` damping 12–15, petite oscillation) [réglage proposé] | — |
| Usage | Très énergique ; fatigue vite. À réserver aux phrases-chocs (accroche, chiffres, CTA), pas à toute la vidéo | — |

### Style 4 — Pilule qui glisse (fond coloré sous le mot dit)

| Paramètre | Valeur | Origine |
|---|---|---|
| Police | **Montserrat 700** | Remotion Elements « Moving Pill Captions » [11] |
| Taille | **80 px** au plus, réduits pour tenir | [11] |
| Texte | Blanc `#FFFFFF`, contour noir de **taille / 7**, `paintOrder: 'stroke fill'`, interligne 1,5 | [11] |
| Pilule | **`#2563eb`** (bleu) → orange Chapote ; **rayon 10 px**, **marge 12 px**, hauteur = taille + 24 px | [11] |
| Animation | La pilule **glisse** d'un mot au suivant en **5 images**, `spring({damping: 100})` (sans rebond), départ **2,5 images avant** le mot | [11] |
| Pages | `combineTokensWithinMilliseconds: 800` par défaut | [11] |
| Pour 1080 × 1920 | 80 px est un peu petit pour un usage plein écran : viser **92–100 px** [réglage proposé] | — |

### Style 5 — Pop discret (mot dit à peine agrandi, en couleur)

| Paramètre | Valeur | Origine |
|---|---|---|
| Police | **Montserrat 700** | Remotion Elements « Popping Word Captions » [11b] |
| Taille | **80 px** au plus, réduits pour tenir (mesurés à largeur / échelle active, pour que le pop ne déborde pas) | [11b] |
| Couleurs | Blanc, mot dit **`#2563eb`** → orange Chapote | [11b] |
| Contour | Noir, **taille / 7** | [11b] |
| Animation | Mot actif à **× 1,03** : entrée `spring({damping: 200})` sur `min(4 images, durée du mot / 2)`, sortie symétrique avant la fin du mot ; pivot `center bottom` | [11b] |
| Pages | 800 ms | [11b] |
| Remarque | Plus sobre que Hormozi, proche de la « charte » actuelle du dépôt ; × 1,03 est presque invisible sur téléphone : × 1,08–1,12 est plus net [réglage proposé] | — |

### Style 6 — Boîte par ligne (texte natif TikTok)

| Paramètre | Valeur | Origine |
|---|---|---|
| Principe | Texte posé sur un **fond plein** (le « text in a solid box » de TikTok/Instagram) | Kapwing [22] |
| Police | Police de l'interface (TikTok Sans depuis mai 2023 [23]) ; Montserrat 700 ou Inter 700 en libre | [23] |
| Taille | 64–76 px [réglage proposé] | — |
| Couleurs | Blanc sur noir à **70–80 %** d'opacité, ou noir sur blanc ; contraste **≥ 4,5:1** (WCAG AA), 7:1 visé | Opus [24] (vendeur) |
| Forme | Une boîte par ligne (`box-decoration-break: clone`), rayon 12–16 px, marge 10 × 20 px [réglage proposé] | — |
| Animation | Aucune ou fondu de 0,3 s | [24] |
| Remarque | C'est la **pastille actuelle** de Chapote. Lisible partout, mais elle fait « natif » et attire moins l'œil. Bon choix pour le **texte d'accroche** et les titres d'étape, moins pour les sous-titres | — |

### Style 7 — « MrBeast » / bande dessinée

| Paramètre | Valeur | Origine |
|---|---|---|
| Police | **Komika Axis** (comique) selon la plupart des sources ; CCSignLanguage ou Anton selon d'autres : **non confirmé** | [25][26] |
| Casse | MAJUSCULES | [25] |
| Couleurs | Blanc ou **jaune** ; un vendeur donne `#FFD700` (non confirmé) | [26] |
| Contour | Noir, **très épais** ; mots-clés avec ombre | [25][26] (6–10 px selon un vendeur, non confirmé) |
| Taille | 100–120 px [réglage proposé] | — |
| Animation | Rebond (scale 0,6 → 1,1 → 1) + légère rotation ±3° [réglage proposé] | — |
| Remarque | Ton divertissement ; risque de faire « pas sérieux » pour un outil SaaS | — |

### Style 8 — Mot-clé + emoji (Submagic)

| Paramètre | Valeur | Origine |
|---|---|---|
| Principe | Sous-titres 2–3 mots ; sur les **mots-clés**, un **emoji** apparaît au-dessus et le mot passe en couleur et grossit | Submagic (couleur, animation, emoji, police réglables) [6] ; CapCut : « mot-clé plus gros » [6] |
| Police | Montserrat 800–900, MAJUSCULES | [6][10] |
| Taille | 96 px ; mot-clé **× 1,2** ; emoji **120–140 px** au-dessus [réglage proposé] | — |
| Couleurs | Blanc + contour noir ; mot-clé orange Chapote | — |
| Animation emoji | entrée `spring` échelle 0 → 1 en 6 images + rotation −15° → 0°, reste le temps de la page [réglage proposé] | — |
| Emojis | Police **Noto Color Emoji** chargée (le rendu Chromium serveur n'a souvent pas d'emojis couleur) ; liste mot → emoji écrite à la main ou par le script (📅 programmer, 🎵 TikTok, ▶️ YouTube, 📸 Instagram, 🆓 gratuit, ⏱️ temps) | — |
| Remarque | 1 emoji par phrase au plus, sinon cela devient du bruit | — |

---

## 4. Le texte d'accroche (0 → 2 s)

Ce que disent les sources :
- TikTok : présenter la proposition **dans les 3 premières secondes** (mémorisation) et l'accroche **dans les 6 premières** [3] ;
  « moins de texte, et plus tôt » (*think fewer and sooner*) [27] ; légendes, CTA ou accroches en gras dans les 2–3 premières secondes [27].
- Meta / guides Reels : un texte en gras **dès la première image** renforce l'accroche et garde ceux qui regardent sans le son ;
  le *hook rate* (vues de 3 s / impressions) est l'indicateur suivi [28].
- Kapwing : sur X, un titre très contrasté **seulement les premières secondes**, puis fondu [22].

Règles [réglage proposé, déduites des sources ci-dessus] :

1. **Présent dès l'image 0.** Pas d'animation qui commence à vide : l'image 0 sert de miniature dans le fil et sur certaines grilles.
   L'animation est un « settle » (échelle 1,06 → 1 en 8 images), pas une apparition.
2. **7 mots au plus**, une idée, idéalement une question ou une promesse chiffrée
   (« 3 réseaux. 1 clic. 0 € », « Tu postes encore à la main ? »).
3. **Place :** y = 300 → 700, centré sur la colonne de 696 px. Jamais en bas (zone masquée), jamais derrière la capture de l'app.
4. **Taille :** 96–130 px, 2 lignes au plus, Montserrat 900 ou Anton, style 6 (boîte) ou contour noir épais.
5. **Durée :** au moins le temps de lecture : `nb_caractères / 15 + 0,5 s` (≈ 15 car/s sur téléphone, plus prudent que les
   20 car/s de Netflix [20]), donc **1,5 à 2,5 s** pour 20–30 caractères ; puis il **remonte et rétrécit** en titre permanent
   (y ≈ 320, 56–64 px) au lieu de disparaître.
6. **Pas de doublon avec les sous-titres :** si la voix dit l'accroche, cacher les sous-titres pendant qu'elle est à l'écran,
   ou faire dire à la voix autre chose que le texte (texte = promesse, voix = contexte).
7. **Un mot en couleur** (orange) : le bénéfice (« gratuit », « 1 clic »).

---

## 5. Titres d'étape, barre de progression, compteurs

Je n'ai trouvé **aucune mesure publiée** de l'effet d'une barre de progression ou d'un compteur sur la rétention en vidéo courte.
Le seul argument trouvé est un avis de créateur, pour la vidéo longue (chapitres) [29]. Tout ce qui suit est à tester en A/B.

| Élément | Réglage proposé | Pourquoi |
|---|---|---|
| **Titre d'étape** (« ① Connecte tes comptes ») | Pastille orange (style 6) en haut de la zone, y ≈ 300–380, 56–64 px, entrée glissée depuis la gauche en 8 images, reste toute l'étape | Donne la structure sans le son ; ne gêne pas les sous-titres en bas |
| **Compteur** (« 2/3 ») | Coin haut gauche de la zone sûre (x 120, y 300), 48 px, chiffre qui « tourne » (translateY −100 % → 0) au changement d'étape | Crée une attente (« encore 1 étape ») ; utile si la vidéo a 3–5 étapes |
| **Barre de progression** | Barre de 8–10 px à **y = 288** (haut de la zone sûre), x 120 → 888, fond blanc 25 %, remplissage orange ; option : segments, un par étape | Les plateformes ont leur propre barre en bas ; la nôtre doit être en haut. Elle annonce une fin proche, ce qui peut aussi **faire partir** : à tester |
| **Chiffres qui comptent** (« 0 → 3 plateformes ») | `interpolate` sur 15–20 images, `Easing.out(Easing.cubic)`, police à chasse fixe des chiffres (`fontVariantNumeric: "tabular-nums"`) | Évite que le texte « tremble » pendant le comptage |

---

## 6. Remotion : du mot horodaté au sous-titre animé

### 6.1 L'API `@remotion/captions` [8]

- `createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds, breakOnSilenceAfterMilliseconds? })` → `{ pages }`.
- `combineTokensWithinMilliseconds` : durée **maximale** d'une page ; plus haut = plus de mots ; bas = mot par mot.
- `breakOnSilenceAfterMilliseconds` (depuis 4.0.514) : nouvelle page si le silence entre deux mots dépasse cette valeur
  (`0` = un mot par page). Ne fait que couper plus tôt, ne rallonge jamais.
- Chaque `TikTokPage` : `text`, `startMs`, `durationMs` (depuis 4.0.261), `tokens: {text, fromMs, toMs, pageBreakAfter?}[]`.
- Un `Caption` avec `pageBreakAfter: true` force la fin de page après lui (depuis 4.0.517) : **idéal pour couper sur la ponctuation**.
- **Chaque mot sauf le premier doit commencer par une espace** : l'espace est le séparateur. Sans elle, tout tient sur une page.
- Rendre avec `whiteSpace: "pre"` pour garder les espaces.

Attention au gabarit `template-tiktok` [9] : sa ligne
`Math.min(nextPage ? ... : Infinity, subtitleStartFrame + SWITCH_CAPTIONS_EVERY_MS)` additionne des **images** et des
**millisecondes**. Avec 1 200 ms ça passe (1 200 images = 40 s), mais il vaut mieux utiliser `page.durationMs`.

### 6.2 Conversion des mots du TTS → `Caption[]`

Le dépôt horodate ses mots en secondes (`{ word, start, end }`, cf. `src/lib/Captions.tsx`).

```ts
// captions-from-words.ts
import type { Caption } from "@remotion/captions";

export type Word = { word: string; start: number; end: number };

const NBSP_FINE = " ";
const PONCT_FIN = /[.!?…]$/;      // fin de phrase -> page suivante
const PONCT_FR = /^[!?:;»]$/;      // signe isolé par le TTS -> collé au mot précédent

export const wordsToCaptions = (words: Word[]): Caption[] => {
  // 1) recoller « ! » « ? » « : » au mot précédent (pas d'orphelin en fin de ligne)
  const w: Word[] = [];
  for (const x of words) {
    if (PONCT_FR.test(x.word) && w.length) {
      const prev = w[w.length - 1];
      w[w.length - 1] = { ...prev, word: prev.word + NBSP_FINE + x.word, end: x.end };
    } else w.push(x);
  }
  // 2) Caption[] avec espace en tête (sauf le 1er) et coupure forcée en fin de phrase
  return w.map((x, i) => ({
    text: (i === 0 ? "" : " ") + x.word,
    startMs: Math.round(x.start * 1000),
    endMs: Math.round(x.end * 1000),
    timestampMs: Math.round(((x.start + x.end) / 2) * 1000),
    confidence: null,
    pageBreakAfter: PONCT_FIN.test(x.word) || undefined, // Remotion >= 4.0.517
  }));
};
```

### 6.3 Composant de sous-titres (Hormozi / karaoké / pop, réglable)

```tsx
// SousTitres.tsx
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions";
import { fitText } from "@remotion/layout-utils";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import React, { useMemo } from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const { fontFamily } = loadFont("normal", { weights: ["900"], subsets: ["latin", "latin-ext"] });

// Zone sûre commune TikTok/Reels/Shorts sur 1080x1920 (cf. §2)
export const ZONE = { gauche: 192, droite: 888, haut: 288, bas: 1248 };
const LARGEUR = ZONE.droite - ZONE.gauche; // 696 px

export type StyleST = {
  taille: number;          // px voulus (réduits par fitText)
  couleur: string;         // texte
  actif: string;           // mot dit
  cle: string;             // mot-clé
  contour: number;         // px (≈ taille / 7)
  majuscules: boolean;
  popActif: number;        // échelle du mot dit (1 = pas de pop)
  pageMs: number;          // combineTokensWithinMilliseconds
};

export const HORMOZI: StyleST = {
  taille: 104, couleur: "#FFFFFF", actif: "#FFFFFF", cle: "#FF7A1A", // orange Chapote (à remplacer par le vrai)
  contour: 15, majuscules: true, popActif: 1.1, pageMs: 800,
};
export const KARAOKE: StyleST = { ...HORMOZI, actif: "#FF7A1A", popActif: 1.0, pageMs: 1200 };

const Page: React.FC<{ page: TikTokPage; s: StyleST; motsCles: Set<string> }> = ({ page, s, motsCles }) => {
  const frame = useCurrentFrame();             // relatif au début de la page (Sequence)
  const { fps } = useVideoConfig();
  const tMs = page.startMs + (frame / fps) * 1000;

  const entree = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 5 });
  const { fontSize } = fitText({
    text: page.text, withinWidth: LARGEUR / s.popActif, fontFamily, fontWeight: "900",
    textTransform: s.majuscules ? "uppercase" : "none",
  });
  const taille = Math.min(s.taille, fontSize);

  return (
    <AbsoluteFill style={{ top: undefined, bottom: 1920 - ZONE.bas, height: 260, // bloc collé au bas de la zone sûre
                           left: ZONE.gauche, width: LARGEUR, justifyContent: "flex-end", alignItems: "center" }}>
      <div style={{
        fontFamily, fontWeight: 900, fontSize: taille, lineHeight: 1.1, textAlign: "center",
        textTransform: s.majuscules ? "uppercase" : "none", color: s.couleur,
        WebkitTextStroke: `${s.contour}px #000`, paintOrder: "stroke",
        textShadow: "0 6px 12px rgba(0,0,0,0.45)",
        transform: `translateY(${interpolate(entree, [0, 1], [40, 0])}px) scale(${interpolate(entree, [0, 1], [0.85, 1])})`,
      }}>
        {page.tokens.map((t, i) => {
          const actif = t.fromMs <= tMs && tMs < t.toMs;
          const cle = motsCles.has(t.text.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
          // pop du mot dit : spring qui part au début du mot
          const debut = Math.round(((t.fromMs - page.startMs) / 1000) * fps);
          const pop = spring({ frame: frame - debut, fps, config: { damping: 12, mass: 0.5 }, durationInFrames: 6 });
          const echelle = actif ? interpolate(pop, [0, 1], [1, s.popActif]) : 1;
          return (
            <span key={`${t.fromMs}-${i}`} style={{
              display: "inline-block", whiteSpace: "pre", transformOrigin: "center bottom",
              transform: `scale(${echelle * (cle ? 1.12 : 1)})`,
              color: cle ? s.cle : actif ? s.actif : s.couleur,
            }}>{t.text}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const SousTitres: React.FC<{ captions: Caption[]; s?: StyleST; motsCles?: string[]; masquerAvantMs?: number }> =
  ({ captions, s = HORMOZI, motsCles = [], masquerAvantMs = 0 }) => {
  const { fps } = useVideoConfig();
  const { pages } = useMemo(() => createTikTokStyleCaptions({
    captions, combineTokensWithinMilliseconds: s.pageMs, breakOnSilenceAfterMilliseconds: 350,
  }), [captions, s.pageMs]);
  const cles = useMemo(() => new Set(motsCles.map((m) => m.toLowerCase())), [motsCles]);

  return (
    <AbsoluteFill>
      {pages.map((p, i) => {
        if (p.startMs + p.durationMs <= masquerAvantMs) return null; // pendant l'accroche
        const from = Math.max(0, Math.round(((p.startMs - 50) / 1000) * fps)); // 50 ms d'avance
        const fin = pages[i + 1] ? Math.round((pages[i + 1].startMs / 1000) * fps) : from + Math.round((p.durationMs / 1000) * fps) + 6;
        const duree = fin - from;
        return duree > 0 ? (
          <Sequence key={i} from={from} durationInFrames={duree} layout="none">
            <Page page={p} s={s} motsCles={cles} />
          </Sequence>
        ) : null;
      })}
    </AbsoluteFill>
  );
};
```

Note : dans `Page`, `frame` est relatif au `Sequence`, qui démarre 50 ms avant `page.startMs` ; à 30 i/s c'est 1–2 images,
négligeable pour la mise en couleur. Pour un calage exact, calculer `tMs` à partir du `frame` absolu passé en prop.

### 6.4 Accroche, titre d'étape, barre de progression

```tsx
// Accroche.tsx : présente dès l'image 0, puis remonte en titre
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const Accroche: React.FC<{ texte: string; motCle?: string; tenirS?: number }> = ({ texte, motCle, tenirS }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tenir = Math.round((tenirS ?? texte.length / 15 + 0.5) * fps);   // règle §4.5
  const settle = interpolate(f, [0, 8], [1.06, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const monte = interpolate(f, [tenir, tenir + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp",
                                                           easing: Easing.inOut(Easing.cubic) });
  const y = interpolate(monte, [0, 1], [420, 320]);
  const taille = interpolate(monte, [0, 1], [112, 60]);
  return (
    <div style={{ position: "absolute", left: 192, width: 696, top: y, textAlign: "center",
                  transform: `scale(${settle})`, fontFamily: "Montserrat", fontWeight: 900, fontSize: taille,
                  lineHeight: 1.05, textTransform: "uppercase", color: "#fff",
                  WebkitTextStroke: `${taille / 7}px #000`, paintOrder: "stroke" }}>
      {texte.split(" ").map((m, i) => (
        <span key={i} style={{ whiteSpace: "pre", color: m.toLowerCase() === motCle?.toLowerCase() ? "#FF7A1A" : undefined }}>
          {(i ? " " : "") + m}
        </span>
      ))}
    </div>
  );
};

// BarreProgression.tsx : en haut de la zone sûre (les plateformes ont la leur en bas)
export const BarreProgression: React.FC<{ etapes?: number }> = ({ etapes }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = f / (durationInFrames - 1);
  return (
    <div style={{ position: "absolute", left: 120, top: 288, width: 768, height: 10, borderRadius: 5,
                  background: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
      <div style={{ width: `${p * 100}%`, height: "100%", background: "#FF7A1A" }} />
      {etapes && Array.from({ length: etapes - 1 }, (_, i) => (
        <div key={i} style={{ position: "absolute", top: 0, left: `${((i + 1) / etapes) * 100}%`, width: 4, height: "100%",
                              background: "rgba(0,0,0,0.6)" }} />
      ))}
    </div>
  );
};
```

### 6.5 Calque de contrôle des zones (à garder en mode `verif`)

```tsx
// ZonesSures.tsx : à afficher dans le Studio, jamais au rendu final
export const ZonesSures: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {/* bandes masquées (le plus strict des 3 plateformes) */}
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 288, background: "rgba(255,0,0,.25)" }} />
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 672, background: "rgba(255,0,0,.25)" }} />
    <div style={{ position: "absolute", left: 0, top: 288, bottom: 672, width: 120, background: "rgba(255,0,0,.25)" }} />
    <div style={{ position: "absolute", right: 0, top: 288, bottom: 672, width: 192, background: "rgba(255,0,0,.25)" }} />
    {/* colonne des boutons TikTok : 180 px de large, de y=840 au bas */}
    <div style={{ position: "absolute", right: 0, top: 840, bottom: 0, width: 180, outline: "3px dashed yellow" }} />
  </AbsoluteFill>
);
```

Un test automatique simple : après le rendu d'une image, lire `getBoundingClientRect()` du bloc de sous-titres et faire
échouer si `bottom > 1248` ou `right > 888`.

### 6.6 Polices et rendu

- `@remotion/google-fonts/Montserrat` ou `/Anton` (chargement attendu par Remotion avant le rendu).
- Emojis : charger **Noto Color Emoji** (`@remotion/google-fonts/NotoColorEmoji`), sinon carrés vides sur un serveur Linux.
- `WebkitTextStroke` dessine le contour **à cheval** sur le tracé : avec `paintOrder: "stroke"`, seule la moitié extérieure se voit.
  Un contour de 15 px donne donc ≈ 7,5 px visibles.

---

## 7. Grille de notation sur 10 (pour juger un style ou une vidéo)

| Critère | Points | Comment noter |
|---|---|---|
| **Lisibilité sur téléphone** | 2 | Lu en < 1 s à bout de bras sur un téléphone réel ; contraste ≥ 4,5:1 sur **toutes** les images (contour ou fond) ; taille ≥ 80 px sur 1080 × 1920 |
| **Zones de sécurité** | 1,5 | Aucun sous-titre ni texte clé hors de x 120 → 888, y 288 → 1248 (calque §6.5) |
| **Synchronisation** | 1,5 | Mot dit = mot surligné à ± 1 image ; page affichée ≤ 50 ms avant le 1er mot ; pas de clignotement entre pages |
| **Rythme de lecture** | 1 | Pages de 1–3 mots ; ≤ 15–20 car/s [20] ; coupures sur la ponctuation ; aucun article ou « ! » orphelin |
| **Hiérarchie / mots-clés** | 1 | 1 mot-clé coloré par phrase au plus, et c'est le bon (le bénéfice) |
| **Accroche** | 1 | Texte présent dès l'image 0, ≤ 7 mots, lisible en ≤ 2 s, pas doublé par les sous-titres |
| **Mouvement maîtrisé** | 1 | Animation qui attire l'œil sur le mot dit sans masquer l'app ; pas de rebond sur chaque mot pendant 60 s |
| **Cohérence de marque** | 1 | Couleurs et police de Chapote, même style dans toutes les vidéos d'une série |

### Notes proposées des 8 styles pour une promo SaaS (jugement personnel, à confirmer en A/B)

| Style | Lisib. /2 | Zones /1,5 | Sync /1,5 | Rythme /1 | Clés /1 | Accroche /1 | Mouv. /1 | Marque /1 | **Total /10** |
|---|---|---|---|---|---|---|---|---|---|
| 1 Hormozi | 2 | 1,5 | 1,5 | 1 | 1 | 0,5 | 0,5 | 0,5 | **8,5** |
| 2 Karaoké | 2 | 1,5 | 1,5 | 0,5 | 0,5 | 0,5 | 1 | 1 | **8,5** |
| 3 Mot unique | 2 | 1,5 | 1,5 | 0,5 | 0,5 | 1 | 0 | 0,5 | **7,5** |
| 4 Pilule qui glisse | 1,5 | 1,5 | 1,5 | 1 | 0,5 | 0,5 | 1 | 1 | **8,5** |
| 5 Pop discret | 1,5 | 1,5 | 1,5 | 1 | 0,5 | 0,5 | 1 | 1 | **8,5** |
| 6 Boîte par ligne (actuel) | 2 | 1,5 | 1 | 0,5 | 0 | 1 | 0,5 | 1 | **7,5** |
| 7 MrBeast / BD | 2 | 1,5 | 1,5 | 1 | 1 | 0,5 | 0,5 | 0 | **8** |
| 8 Mot-clé + emoji | 1,5 | 1 | 1,5 | 1 | 1 | 0,5 | 0,5 | 0,5 | **7,5** |

(Les notes « Zones » et « Sync » supposent le code du §6 ; le style 8 perd 0,5 car l'emoji au-dessus grandit le bloc.)

**Proposition de test A/B** [réglage proposé] : A = style actuel (boîte, 4 mots, orange) remonté dans la zone sûre ;
B = Hormozi 2–3 mots avec mots-clés orange ; C = pilule orange qui glisse. Même vidéo, même voix, même accroche ;
comparer la rétention à 3 s et la durée moyenne de vue sur 5–10 vidéos par branche.

---

## Sources

1. ManyPixels — *TikTok ad sizes and specs (with measured safe zones)* : https://www.manypixels.co/blog/social-media-design/tiktok-ad-specs
2. Socialync — *TikTok safe zone* : https://www.socialync.io/tools/safe-zones/tiktok
3. TikTok Ads — *Creative best practices for performance ads* : https://ads.tiktok.com/help/article/creative-best-practices
4. Socialync — *Instagram Reels safe zone* (d'après le guide des pubs Meta) : https://www.socialync.io/tools/safe-zones/instagram-reels
5. Google — *Universal Video Ad Safe Zones* (PDF officiel, lu directement) : https://services.google.com/fh/files/helpcenter/ytadsafezones.pdf ; aide Google Ads : https://support.google.com/google-ads/answer/9128498?hl=en ; Socialync Shorts : https://www.socialync.io/tools/safe-zones/youtube-shorts ; Reap (zones = pubs, pas organique ; mode « écran dégagé » 2026) : https://reap.video/blog/short-form-video-safe-zones
6. Submagic — *How to make Alex Hormozi captions* : https://www.submagic.co/blog/how-to-make-alex-hormozi-captions
7. BlitzCut — *Best caption fonts TikTok* / *Hormozi caption app* (valeurs hex et préréglage, vendeur) : https://blitzcutai.com/blog/best-caption-fonts-tiktok , https://blitzcutai.com/hormozi-caption-app ; SendShort : https://sendshort.ai/guides/hormozi-captions/
8. Remotion — *createTikTokStyleCaptions()* : https://www.remotion.dev/docs/captions/create-tiktok-style-captions ; *Displaying captions* : https://www.remotion.dev/docs/captions/displaying
9. Remotion — gabarit `template-tiktok` (code lu : `Page.tsx`, `SubtitlePage.tsx`, `index.tsx`) : https://github.com/remotion-dev/template-tiktok
10. Choppity — *Recreate Alex Hormozi editing style* : https://www.choppity.com/tools/recreate-video-editing-style/alex-hormozi/ ; Fluxnote : https://fluxnote.io/guides/how-to-make-alex-hormozi-style-captions
11. Remotion Elements — *Moving Pill Captions* : https://www.remotion.dev/elements/captions/moving-pill-captions.md
11b. Remotion Elements — *Popping Word Captions* : https://www.remotion.dev/elements/captions/popping-word-captions.md ; *Word Highlight Captions* : https://www.remotion.dev/elements/captions/word-highlight-captions/
12. Kapwing — *Subtitle statistics* (6 févr. 2024) : https://kapwing.com/resources/subtitle-statistics
13. 3Play Media — *Studies find captions improve engagement* : https://3playmedia.com/blog/studies-find-captions-improve-engagement ; *Verizon Media and Publicis Media find viewers want captions* : https://www.3playmedia.com/blog/verizon-media-and-publicis-media-find-viewers-want-captions/
14. Étude sur le surlignage des mots-clés pour spectateurs sourds ou malentendants (30 participants) : https://par.nsf.gov/servlets/purl/10170034
15. *Useful but Distracting: Keyword Highlights and Time-Synchronization in Captions for Language Learning* (arXiv 2307.05870) : https://ar5iv.labs.arxiv.org/html/2307.05870
16. 3Play Media — étude de cas Discovery Digital Networks : https://www.3playmedia.com/case-studies/discovery-digital-networks/
17. NextTV — *Mobile videos often watched without audio, study finds* : https://nexttv.com/news/mobile-videos-often-watched-without-audio-study-finds
18. Instapage — *Closed captioning and mute videos* : https://instapage.com/blog/closed-captioning-mute-videos
19. MDPI, *Multimodal Technologies and Interaction* 8(6):51 (affichage mot par mot, 18 participants) : https://mdpi.com/2414-4088/8/6/51
20. Netflix — *English (USA) Timed Text Style Guide* : https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide
21. Billo — *Meta Ads safe zones* : https://billo.app/blog/meta-ads-safe-zones ; AdNabu : https://blog.adnabu.com/meta-ads/meta-safe-zones/
22. Kapwing — *Social media captions styles, a complete guide* : https://www.kapwing.com/resources/social-media-captions-styles-a-complete-guide/
23. PostNitro — *TikTok caption font* (TikTok Sans depuis mai 2023) : https://postnitro.ai/blog/post/tiktok-caption-font
24. Opus Clip — *Video caption design and placement* (vendeur, chiffres non sourcés : contraste, opacité, débit) : https://www.opus.pro/blog/video-caption-design-placement
25. Submagic — *How to make captions like MrBeast* : https://www.submagic.co/blog/how-to-make-captions-like-mrbeast
26. VideoCaptions.ai — *MrBeast font* : https://www.videocaptions.ai/mrbeast-font
27. TikTok Business — *Creative best practices for top performing ads* : https://ads.tiktok.com/business/en/blog/creative-best-practices-top-performing-ads/
28. Guides Reels (tiers, pas Meta) : https://www.gethookd.ai/learn/facebook-reels-ads-specs-examples-best-practices/ ; https://metricool.com/facebook-reels-ads-guide/
29. Adam Connell — *Improve video retention* (barre de progression par chapitres, avis) : https://adamconnell.me/improve-video-retention-social-media/
