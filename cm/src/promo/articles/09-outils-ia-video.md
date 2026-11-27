# 09 — Outillage : motion design de qualité avec un agent IA et du code

*Recherche du 27/11/2026 pour les vidéos de promo de Chapote CM (cm.chapote.fr). Périmètre : les outils seulement (moteurs de rendu, paquets, assets, workflow agent, astuces de rendu). Les faits viennent des pages citées en fin de document. Les passages marqués « Reco » sont nos recommandations, pas des faits sourcés.*

> Limite de la recherche : le quota de recherches web de la session a été épuisé en cours de route. Les workflows publiés sur X ou YouTube (« Claude + Remotion » viraux) n'ont donc pas pu être recensés en détail. Ce qui suit vient surtout des docs officielles (remotion.dev, hyperframes.heygen.com, GitHub) et d'un tutoriel (Tella).

---

## 0. En bref

- **HyperFrames**, c'est ce qu'a entendu le fondateur. C'est le framework open source de **HeyGen** (Apache 2.0, très actif : v0.9.102 sortie le 27/11/2026, environ 91 k étoiles). L'agent écrit des **pages HTML/CSS/JS**, en général avec **GSAP**. Le moteur **met chaque image en pause, la cherche** dans Chrome headless, puis encode avec FFmpeg. Il fournit des **skills pour Claude Code** et un **plugin Claude Code**, ainsi qu'un catalogue d'environ 450 blocs (transitions shader, sous-titres, CTA Instagram…). Il propose aussi des commandes de contrôle utiles à un agent : `lint`, `check` (mise en page, mouvement, contraste) et `snapshot --at`.
- **Remotion** reste le moteur le plus mûr. Il a beaucoup évolué en 2026 : **skills agents officielles** (`/remotion-best-practices`, `/remotion-markup`…), **91 effets** GPU (`@remotion/effects` : light leak, glow, chromatic aberration, noise, vignette…), **21 transitions** (dont `zoomBlur`, `crossZoom`, `filmBurn`, `cube`, `pushCut`), un **vrai flou de mouvement** (`HtmlInCanvasMotionBlur`, et l'option `motionBlur` sur les transitions depuis la 4.0.545), **`@remotion/gsap`** et une bibliothèque d'**Elements** (sous-titres, fins d'écran, zones sûres des réseaux sociaux…).
- Notre dépôt est en **Remotion 4.0.534**, sans aucun de ces paquets. C'est la cause la plus probable du rendu « statique » : il ne vient pas du moteur, mais du **manque de vocabulaire de mouvement** (transitions, flou de mouvement, effets, caméra, easing) et de **règles de mise en scène** données à l'agent.
- **Reco** : **garder Remotion**, le mettre à jour, installer ses skills, ajouter `@remotion/transitions`, `@remotion/motion-blur`, `@remotion/effects`, `@remotion/gsap`, `@remotion/lottie` et `@remotion/captions`, et partir du **template 3D (téléphone)** pour les captures de l'app. **Emprunter à HyperFrames** ses règles de mise en scène (page « Motion ») et son idée de contrôles automatiques. Faire un **essai HyperFrames** à part, sur une seule vidéo promo, pour comparer, sans migrer.

---

## 1. Comparatif des moteurs

| | **Remotion** | **HyperFrames** (HeyGen) | **Motion Canvas** | **Revideo** |
|---|---|---|---|---|
| Ce qu'on écrit | Composants React/TS ; chaque image = fonction pure de `useCurrentFrame()` | HTML/CSS/JS + attributs `data-start`, `data-duration`, `data-track-index` ; timeline en pause enregistrée dans `window.__timelines` (GSAP par défaut ; adaptateurs CSS, Lottie, Three.js, Anime.js, WAAPI) | TypeScript avec générateurs (`yield*`), scènes vectorielles sur canvas | Fork de Motion Canvas (mêmes générateurs) + audio, vidéo, rendu headless |
| Licence | Licence propre (source disponible). **Gratuite** pour les particuliers, les structures jusqu'à **3 personnes** (effectif total de l'entreprise, collaborateurs compris) et les associations. Au-delà : Creators 25 $/siège/mois, Automators 0,01 $/rendu avec 100 $/mois minimum | **Apache 2.0**, sans frais par rendu | MIT (le passage en GPL a été proposé en 2024, puis « reporté indéfiniment ») | MIT |
| Rendu headless / automatisable | Oui (CLI, SSR, Lambda, Cloud Run, Vercel) | Oui (CLI, Docker, cloud HeyGen, Lambda, Cloud Run) | Non par défaut : il faut cliquer dans l'éditeur (c'est la raison du fork Revideo) | Oui (`renderVideo()`) |
| Skills / agents | Skills officielles `remotion-dev/skills` (14 skills), plugin Claude Code, WebMCP (pilotage du Studio ; Codex seulement pour l'instant), docs en Markdown (`.md` à la fin de l'URL) | Skills officielles (6 de base + 3 à la demande, dont `remotion-to-hyperframes`), plugin Claude Code, CLI non interactive avec `--json` | Aucune officielle trouvée | Aucune officielle trouvée |
| Contrôle visuel intégré | `npx remotion still --frame=N` (image), Studio ; WebMCP renvoie le HTML et les contours d'une image, mais pas les pixels canvas/WebGL | `lint`, `check` (navigateur, mise en page, mouvement, contraste), `snapshot --at 0,2,5`, `compare v1/ v2/`, `timeline --json` | Éditeur | Lecteur React |
| Écosystème | Le plus mûr : templates (TikTok, 3D, Prompt to Video, Audiogram, Code Hike…), Elements, 91 effets, 21 transitions, Lottie, Rive, Three, Skia, GIF, GSAP | Catalogue d'environ 450 blocs, transitions shader WebGL, sous-titres animés, 4 gabarits de design (`frame.md`), import Figma | Orienté animations vectorielles « explicatives » | Plus petit ; derniers commits en juillet 2026, aucune release publiée |
| Activité | Très active (v4.0.547 le 24/11/2026) | Très active (v0.9.102 le 27/11/2026 ; 69 pages de releases) | Faible (un commit le 02/07/2026, le précédent en février 2025) | Moyenne (commits jusqu'au 15/07/2026) |
| Poids | Environ 950 Mo de `node_modules` dans le test de HeyGen | Rien d'ajouté au projet (CLI `npx`) ; Node 22+ et FFmpeg | — | — |

### Ce que dit HeyGen de HyperFrames contre Remotion (source : leur propre page, donc partiale)

- Sur une même consigne et un seul essai : 11 min 50 s contre 12 min 30 s, 822 lignes HTML contre 1 037 lignes TS. HyperFrames a ajouté une nappe et 5 bruitages, Remotion aucun son. HeyGen écrit lui-même qu'un seul essai « ne décide rien de la qualité ».
- Leur argument principal (article de recherche) : les LLM écrivent très bien du HTML. Le cadre React les « bridait » et rendait les sorties répétitives, alors qu'avec du HTML/CSS/JS simple, « la créativité est revenue ».
- **Choisir Remotion** quand l'équipe écrit déjà du React, qu'on veut un modèle mental simple (une image = une fonction pure), un écosystème mûr, et que la licence convient. **Choisir HyperFrames** quand la matière est déjà web (pages, maquettes HTML, animations GSAP/Lottie), qu'on ne veut ni React ni étape de build, ou qu'on veut éviter la question de licence.
- Limites reconnues par HeyGen : capture 100 % déterministe seulement sous **Linux** avec `chrome-headless-shell` (`HeadlessExperimental.beginFrame`) ; sous macOS et Windows, une capture « heuristique ». Les compositions chargées en vidéo doivent repasser à **un seul worker**. Les vidéos sont pré-extraites en JPEG par FFmpeg, si bien que `src` dynamiques, blob et flux passent mal.

### Verdict pour nous (Reco)

1. **Garder Remotion** comme moteur principal. Nous avons déjà tout le code (scènes, sous-titres, couvertures, Three/VRM, mains fantômes), la routine cloud et des agents de contrôle. Une migration coûterait cher pour un gain non démontré.
2. **Licence** : Chapote compte à notre connaissance moins de 4 personnes, ce qui le place dans la licence gratuite, automatisations comprises. **À revérifier** si l'équipe grandit, ou si un prestataire travaille sur le projet Remotion (les effectifs s'additionnent alors). Remotion 5.0 rendra la télémétrie obligatoire, mais seulement pour les clients Automators.
3. **HyperFrames en essai parallèle**, pour une ou deux vidéos promo de Chapote CM : capture d'un site (`hyperframes capture <url>`), blocs du catalogue (`instagram-follow`, transitions shader), comparaison à l'œil avec la version Remotion. Sa vraie valeur pour nous est probablement **sa doctrine de mise en scène et ses commandes `check`/`snapshot`**, que l'on peut reproduire côté Remotion.
4. **Motion Canvas / Revideo : non.** Activité faible, pas de skills agents, rien de plus que ce que nous avons.

---

## 2. Remotion : ce qui nous manque (état du dépôt `claude-cloud`)

`package.json` actuel : `remotion` et `@remotion/cli` en `^4.0.0`, `@remotion/paths`, `@remotion/player` et `@remotion/three` figés en `4.0.534`, `three` 0.171. **Aucun** de ces paquets : transitions, motion-blur, effects, gsap, lottie, captions, media, Elements ; et aucune skill Remotion.

> Piège : Remotion exige **la même version exacte pour tous les paquets `remotion` et `@remotion/*`**. Mélanger `^4.0.0` et `4.0.534` peut installer des versions différentes. `npx remotion upgrade` (ou la skill `/remotion-upgrade`) aligne tout.

### Paquets à ajouter (commandes officielles)

```bash
# Aligner et mettre à jour (dernière version vue : 4.0.547, 24/11/2026)
npx remotion upgrade

# Skills officielles pour Claude Code (dans le dépôt, à la racine)
npx remotion skills add            # ou : npx skills add remotion-dev/skills
# (variante plugin : claude plugin marketplace add remotion-dev/claude-code-plugin
#                   claude plugin install remotion@remotion  — choisir UNE des deux voies)

npx remotion add @remotion/transitions   # TransitionSeries + 21 présentations
npx remotion add @remotion/motion-blur   # HtmlInCanvasMotionBlur (recommandé), CameraMotionBlur, Trail
npx remotion add @remotion/effects       # 91 effets (≥ 4.0.464 ; lightLeak ≥ 4.0.500)
npx remotion add @remotion/gsap && npm i --save-exact gsap   # useGsapTimeline (≥ 4.0.517)
npm i @remotion/lottie lottie-web        # <Lottie> (icônes animées, After Effects via Lottie)
npm i @remotion/captions                 # createTikTokStyleCaptions()
npx remotion add @remotion/media         # <Video> : le plus rapide pour les captures d'écran vidéo
```

### Ce que chaque paquet apporte contre l'effet « statique »

| Besoin | Outil Remotion | Notes |
|---|---|---|
| Enchaînements entre scènes | `@remotion/transitions` : `<TransitionSeries>`. Présentations : `slide`, `wipe`, `fade`, `flip`, `cube`, `clockWipe`, `iris`, `zoomBlur`, `crossZoom`, `dreamyZoom`, `zoomInOut`, `pushCut` (coup de poing avec flash), `filmBurn`, `ripple`, `crosswarp`, `blurSlide`, `linearBlur`, `bookFlip`, `swap`, `dissolve`, `none`. Son sur transition possible. | `motionBlur` sur `TransitionSeries.Transition` depuis la 4.0.545. `<TransitionSeries.Overlay>` pour poser un light leak sur une coupe sans raccourcir le temps. |
| Flou de mouvement | `<HtmlInCanvasMotionBlur samples shutterAngle width height>` | Coûteux. Repose sur l'API Chrome « HTML-in-canvas », gérée par le Chrome de rendu de Remotion depuis la 4.0.455. Ne plus utiliser `CameraMotionBlur` ni `Trail` (couleurs et opacité inexactes). |
| Effets « pro » | `@remotion/effects` : `lightLeak`, `glow`, `dropShadow`, `longShadows`, `chromaticAberration`, `zoomBlur`, `lensBlur`, `radialProgressiveBlur`, `noise`, `vignette`, `scanlines`, `shine`, `halftone`, `paper`, `pageTurn`, `cornerPin`, `fisheye`… | Passés dans `effects=[…]` de `<Solid>`, `<Img>`, `<Video>`, `@remotion/shapes`… ; tout HTML via `<HtmlInCanvas>`. WebGL : `--gl=angle`, ou **`--gl=swangle` sans GPU** (cas de notre routine cloud). |
| Animations GSAP (timelines, SplitText, MorphSVG) | `@remotion/gsap` → `useGsapTimeline()` | Timeline GSAP en pause, positionnée sur l'image courante : déterministe. GSAP est **100 % gratuit**, plugins compris, depuis le rachat par Webflow (licence du 30/04/2025). Seule exception : les outils no-code d'animation concurrents de Webflow, ce qui n'est pas notre cas. |
| Icônes animées, After Effects | `@remotion/lottie` `<Lottie>` | Charger le JSON avec `delayRender`/`continueRender`. Certaines fonctions Lottie ne sont pas prises en charge (expressions…). |
| Sous-titres mot à mot | `@remotion/captions` → `createTikTokStyleCaptions({captions, combineTokensWithinMilliseconds})` | Valeur basse = mot par mot, 1 200 ms = pages de quelques mots. Nos mots horodatés Qwen3 se convertissent facilement au type `Caption`. Elements « Popping Word » et « Moving Pill ». Transcription locale : `npx remotion whisper` (4.0.546). |
| Téléphone 3D avec la vraie app | Template **remotion-dev/template-three** : un téléphone 3D dont l'écran joue une vidéo (couleur, taille, épaisseur et arrondi réglables) | Utiliser `@remotion/media` pour la texture vidéo (`useVideoTexture` est déprécié). `<Sequence layout="none">` dans `<ThreeCanvas>`. `Config.setChromiumOpenGlRenderer('angle')`. |
| Blocs prêts à l'emploi | **Remotion Elements** : fonds, sous-titres, graphiques et compteurs, callouts, effets shine/tear, split-screen, picture-in-picture, échange de messages à l'écran, aperçu des zones sûres des réseaux sociaux, fins d'écran | Commande `remotion elements add-library` (4.0.547). Code source fourni dans chaque fiche. |
| Physique / animations JS | `spring()` natif ; Anime.js (exemple communautaire) ; Matter.js « cuit » dans la timeline | **Framer Motion / Motion : aucune intégration** (Motion tourne sur l'horloge réelle, donc pas de rendu image par image fiable). react-spring non plus : utiliser `spring()`. Animations CSS déconseillées : elles scintillent, sauf synchro par `animation-play-state`/`animation-delay`. |

---

## 3. HyperFrames en pratique (pour l'essai)

```bash
# Prérequis : Node 22+, FFmpeg
claude plugin marketplace add heygen-com/hyperframes
claude plugin install hyperframes@hyperframes      # ou : npx skills add heygen-com/hyperframes
npx hyperframes doctor
npx hyperframes init promo-cm && cd promo-cm
npx hyperframes add instagram-follow               # bloc du catalogue (≈450)
npx hyperframes capture https://cm.chapote.fr      # capture d'un site
npx hyperframes lint && npx hyperframes check      # structure, mise en page, mouvement, contraste
npx hyperframes snapshot --at 0,2,5                # images de contrôle
npx hyperframes render --output final.mp4
npx hyperframes compare v1/ v2/
```

- Consigne type officielle : « Using /hyperframes:hyperframes, make a 10-second product intro for https://… ». Pour un film narratif, l'agent propose d'abord 3 storylines.
- Charte graphique : un **`frame.md`**. L'en-tête porte les valeurs exactes (hex, polices, graisses), le texte en dessous l'intention et les « à faire / à éviter ». Règle : **figer couleurs et typo, laisser la mise en page et le mouvement à l'agent** (les bordures fines et les ombres légères du web disparaissent en vidéo).
- Une commande `tts` existe, mais nous gardons notre voix Qwen3 : l'audio s'ajoute avec `<audio data-start data-volume>`, et `hyperframes audio` mesure les instants du son.
- Déterminisme : pas de `Date.now()`, pas d'aléatoire sans graine, pas de requêtes réseau, polices Google embarquées.
- Skill de migration `remotion-to-hyperframes` : elle convertit `interpolate` et `Sequence` en clips, signale ce qui ne passe pas (`useState`/`useEffect`, bibliothèques React UI) et compare les rendus image par image. Pratique pour un essai sur une composition existante.

---

## 4. Règles de mise en scène (à mettre dans le skill de promo)

Synthèse de la page « Motion » de HyperFrames. Ces règles valent quel que soit le moteur et répondent directement au reproche « statique » :

- **Easing selon l'intention** (noms GSAP ; équivalents `Easing.bezier` ou `spring()` dans Remotion) : doux `power2.out`, vif `power4.out`, rebond `back.out` (objets physiques seulement), dramatique `expo.out`, rêveur `sine.inOut`. **Pas de rebond sur le texte, l'UI ou les chiffres.**
- **Durées** : 0,2 s = énergie, 0,4 s = « pro », 0,6 s = luxe, 1-2 s = ciné. Démo produit : garder un cadrage 7-10 s pendant que l'UI travaille. Réseaux : 1-4 s par idée, coupe franche.
- **Transitions** : 3 à 5 types par film au plus. Une transition doit être **motivée** par quelque chose à l'écran (la caméra traverse un bouton, une carte grandit jusqu'à la scène suivante). Jamais de fondu au noir puis fondu d'entrée : on définit la sortie *vers* la scène suivante. Durée : 0,5-0,8 s si calme, 0,3-0,5 s moyen, 0,15-0,3 s si énergique.
- **Arriver, puis tenir** : un titre qui continue de dériver ou de grossir paraît inachevé. Animer seulement ce qui change (chiffres, barres, flux). Pas de « respiration » décorative.
- **Chevaucher, pas enchaîner** : l'élément suivant part avant que le précédent ne se pose (décalage, stagger). **Un seul effet par mouvement** : rotation + échelle + flou en même temps rendent le texte illisible.
- **Caméra qui voyage** entre éléments liés (pas de zoom avant sans destination). **Profondeur** : plans lointains plus lents, un seul élément flou au premier plan.
- **Raccords** : positions et vitesses identiques des deux côtés d'une coupe.
- Anti-modèles : scène où rien ne bouge, tout qui entre en même temps, coupes façon diaporama, pauses comptées en secondes plutôt qu'en images (saccades).
- Storyboard avant de construire : une phrase de message, un arc (accroche → fond → atterrissage), une humeur, une règle à 2 couleurs, une image « respiration » plus calme, une liste de clichés à éviter, et un motif planté tôt qui revient transformé.

---

## 5. Astuces de rendu « pro »

- **Flou de mouvement** sur les déplacements rapides et les transitions (`HtmlInCanvasMotionBlur`, `motionBlur` des transitions). C'est l'effet qui sépare le plus vite l'amateur du pro, mais il coûte cher : le réserver aux plans rapides.
- **60 i/s ?** Remotion permet `fps: 60`, mais cela double le temps de rendu. **Reco** : rester à 30 i/s et mettre du flou de mouvement, ce qui est plus fluide à l'œil qu'un 60 i/s net. Aucune source ne tranche ce point : c'est notre avis.
- **Téléphone 3D** : template-three, capture vidéo de l'app en texture, léger roulis caméra, ombre portée au sol (ombre Three ou `dropShadow`/`longShadows` de `@remotion/effects`).
- **Grain, vignette, light leak** à faible dose pour casser le « trop propre » : `noise()`, `vignette()`, `lightLeak()` en overlay de transition.
- **Performances** (doc Remotion) : `npx remotion benchmark` pour choisir `--concurrency`. `box-shadow`, `text-shadow`, gradients et `filter: blur/drop-shadow` sont coûteux. Le **cloud n'a pas de GPU** : WebGL, Three et effets y sont lents ; utiliser `--gl=swangle`, ou **précalculer** les fonds en images. JPEG plutôt que PNG (sauf transparence). `<Video>` de `@remotion/media` plutôt que `<OffthreadVideo>`.
- **Polices** chargées localement (déjà le cas avec `@fontsource`), sinon le rendu peut différer de l'aperçu.

---

## 6. Assets gratuits et licences

| Source | Licence | Remarque |
|---|---|---|
| LottieFiles (animations publiques gratuites) | « Lottie Simple License » : usage commercial autorisé, crédit encouragé mais pas obligatoire (selon l'aide LottieFiles) | Certaines animations ont des conditions propres à leur auteur : vérifier la fiche. Interdit de compiler un catalogue concurrent. Les formules Free/Individual ne couvrent pas l'usage commercial des *outils* LottieFiles. |
| Lordicon (icônes animées) | Gratuites avec **attribution obligatoire** ; Pro sans attribution | |
| IconScout (Lottie gratuits) | Commercial avec lien d'attribution demandé | |
| Airbnb « Modern Pictograms for Lottie » | Open source (fichiers sources téléchargeables) | |
| Google Noto Animated Emoji | Lottie, WebP, GIF disponibles | Licence non confirmée dans nos lectures : **à vérifier** avant usage. |
| GSAP + plugins (SplitText, MorphSVG…) | Licence standard « No Charge », usage commercial gratuit | Sauf outils no-code d'animation concurrents de Webflow. |
| Remotion Elements / templates | Templates sous MIT (Remotion lui-même sous sa licence) | |
| HyperFrames + catalogue | Apache 2.0 | |
| Bruitages | Nous utilisons déjà BigSoundBank CC0 (`scripts/sons.py`) | |

---

## 7. Workflow agent conseillé pour les promos Chapote CM (Reco)

1. **Brief contraint** (le conseil le plus répété dans le tuto Tella) : durée, format 1080×1920, fps, ordre des scènes avec durées, texte exact à l'écran, chemins d'assets autorisés, couleurs et polices, style de mouvement. Dire aussi **ce qui est interdit** (inventer ou télécharger des assets, toucher aux fichiers partagés).
2. **Charte figée** dans un fichier du dépôt, à la façon d'un `frame.md` : hex et polices de Chapote CM, logo SVG, « à faire / à éviter ». Les règles du §4 vont dans le skill de format.
3. **Storyboard JSON** avant le code : beats, accroche en moins de 1,5 s, une transition motivée par changement de scène, motif récurrent, CTA. La voix Qwen3 et ses **mots horodatés** donnent la grille temporelle : chaque révélation est calée sur le mot qui la nomme.
4. **Construction** avec `/remotion-best-practices` et `/remotion-markup`, à partir de composants maison réutilisables : téléphone 3D avec capture, texte cinétique GSAP SplitText, cartes UI qui « poussent » la scène suivante, sous-titres `createTikTokStyleCaptions`.
5. **Contrôles automatiques avant le rendu final** :
   - `npx remotion still <entry> <Comp> out/f-<N>.png --frame=<N>` à chaque début de mot clé, puis une **planche contact** (ffmpeg `tile`) relue par l'agent `controle-visuel` : le texte est lisible, rien n'est coupé, rien ne sort des **zones sûres** (Element « safe-zone » ou masque maison).
   - **Détecteur de « statique »** : rendu brouillon à basse résolution, différence d'image en image avec ffmpeg (`select='gt(scene,…)'` ou `freezedetect`). Toute séquence de plus de 1,5-2 s sans mouvement notable est signalée. `freezedetect` est un filtre ffmpeg standard ; le seuil est à calibrer.
   - Rythme : nombre de coupes et de transitions par 10 s, pas plus de 5 types de transitions.
   - Son : niveau à −14 LUFS (comme pour nos autres comptes), bruitage synchronisé sur chaque transition.
   - Côté HyperFrames, l'équivalent est déjà intégré : `check`, `snapshot`, `compare`.
6. **Itérer une modification à la fois**, Studio ouvert. Relire le diff (Claude a tendance à trop modifier).
7. **Rendu** dans le cloud avec `--gl=swangle` si des effets WebGL sont présents, et la concurrence choisie par `remotion benchmark`.

---

## 8. Pièges

- **Versions Remotion mélangées** (cas actuel du dépôt) : tout aligner avec `npx remotion upgrade`.
- **Animations sur l'horloge réelle** (Framer Motion, CSS keyframes, `requestAnimationFrame`, `Date.now()`, `Math.random()` sans graine) : scintillement, ou rendu différent de l'aperçu. Tout doit dériver de `useCurrentFrame()` (Remotion) ou d'une timeline en pause (HyperFrames).
- **GPU absent dans le cloud** : effets, Three et flou de mouvement deviennent lents. Utiliser `--gl=swangle`, réduire les `samples` du flou, précalculer.
- **HTML-in-canvas** est une API Chrome expérimentale qui peut changer. Les médias cross-origin sans CORS disparaissent du canvas : servir les captures en local (`staticFile`).
- **`<Sequence>` dans `<ThreeCanvas>`** sans `layout="none"` : erreur.
- **Skills Remotion** : choisir *soit* le plugin, *soit* `skills add`, pas les deux. Le serveur MCP `remotion-documentation` est déprécié, utiliser `/remotion-docs`. Après installation, ouvrir une nouvelle session.
- **HyperFrames** : déterminisme complet seulement sous Linux ; un seul worker si la composition contient beaucoup de vidéo ; projet jeune (versions 0.9.x qui changent presque chaque jour).
- **Licences d'assets** : Lordicon et IconScout gratuits demandent une attribution. Vérifier la fiche de chaque Lottie.
- **Licence Remotion** : à surveiller si l'équipe dépasse 3 personnes, prestataires compris.
- **Trop d'effets** tue la lisibilité. Les règles « un effet par mouvement » et « 3-5 transitions » servent de garde-fous.

---

## 9. Dépôts et ressources

- HyperFrames : https://github.com/heygen-com/hyperframes ; docs https://hyperframes.heygen.com/ (index pour agents : https://hyperframes.heygen.com/llms.txt)
- Remotion : https://github.com/remotion-dev/remotion ; skills https://github.com/remotion-dev/skills
- Template 3D (téléphone) : https://github.com/remotion-dev/template-three
- Template TikTok (sous-titres mot à mot) : https://github.com/remotion-dev/template-tiktok
- Template Prompt to Video : https://github.com/remotion-dev/template-prompt-to-video (`npx create-video@latest --prompt-to-video`)
- Liste des templates : https://www.remotion.dev/templates ; Elements : https://www.remotion.dev/elements ; effets : https://www.remotion.dev/effects
- Revideo : https://github.com/redotvideo/revideo ; Motion Canvas : https://github.com/motion-canvas/motion-canvas
- Tutoriel Claude Code + Remotion : https://www.tella.com/blog/how-to-use-remotion-agent-skills-with-claude-code

---

## Sources

- https://github.com/heygen-com/hyperframes
- https://github.com/heygen-com/hyperframes/releases
- https://www.heygen.com/research/html-to-video
- https://hyperframes.heygen.com/
- https://hyperframes.heygen.com/llms.txt et https://hyperframes.heygen.com/_llms/docs.txt
- https://hyperframes.heygen.com/guides/hyperframes-vs-remotion.md
- https://hyperframes.heygen.com/prompting/motion.md
- https://hyperframes.heygen.com/prompting/design-systems.md
- https://hyperframes.heygen.com/developers/cli.md
- https://hyperframes.heygen.com/guides/with-claude-code.md
- https://www.remotion.dev/docs/ai/skills
- https://github.com/remotion-dev/skills
- https://www.remotion.dev/docs/agents.md
- https://www.remotion.dev/docs/agents/webmcp.md
- https://www.remotion.dev/llms.txt
- https://www.remotion.dev/docs/license/faq
- https://www.remotion.dev/docs/pricing
- https://www.remotion.dev/docs/motion-blur et https://www.remotion.dev/docs/motion-blur/api
- https://www.remotion.dev/docs/transitions et https://www.remotion.dev/docs/transitions/presentations
- https://www.remotion.dev/docs/effects et https://www.remotion.dev/effects
- https://www.remotion.dev/docs/light-leaks
- https://www.remotion.dev/docs/html-in-canvas
- https://www.remotion.dev/docs/three
- https://www.remotion.dev/docs/lottie
- https://www.remotion.dev/docs/gsap
- https://www.remotion.dev/docs/third-party
- https://www.remotion.dev/docs/captions/create-tiktok-style-captions
- https://www.remotion.dev/docs/performance
- https://www.remotion.dev/templates et https://www.remotion.dev/templates/prompt-to-video
- https://www.remotion.dev/elements/index.md
- https://github.com/remotion-dev/remotion/releases
- https://github.com/remotion-dev/template-three
- https://github.com/remotion-dev/template-tiktok
- https://github.com/redotvideo/revideo (et /commits/main)
- https://github.com/motion-canvas/motion-canvas (et /commits/main)
- https://github.com/orgs/motion-canvas/discussions/1015
- https://webflow.com/blog/gsap-becomes-free
- https://help.lottiefiles.com/animation-licensing-basics-
- https://lottiefiles.com/free-animations/licence
- https://licenseorg.com/guide/design-graphics/lordicon
- https://iconscout.com/free-lotties
- https://airbnb.design/modern-pictograms-for-lottie
- https://www.tella.com/blog/how-to-use-remotion-agent-skills-with-claude-code
