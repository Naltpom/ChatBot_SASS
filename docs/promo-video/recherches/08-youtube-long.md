# 08 — Vidéos YouTube horizontales (16:9) de produit, tutoriel et lancement pour Chapote CM

Recherche du 27/11/2026. Sujet : ce qui marche dans les vidéos YouTube longues (horizontales) d'outils SaaS, et comment
les produire automatiquement (Remotion, voix TTS, captures réelles de cm.chapote.fr version ordinateur).
Règle suivie : chaque chiffre vient d'une source citée en fin de document (numéro entre crochets). Ce qui n'en a pas
est présenté comme une recommandation ou une hypothèse à tester, jamais comme un fait mesuré.

---

## 0. L'essentiel en 12 points

1. **YouTube juge l'intro sur 30 s.** Le rapport « moments clés » de YouTube Studio mesure la part des spectateurs encore
   là après 30 secondes, et dit qu'une bonne intro est celle dont le contenu correspond au titre et à la miniature [1].
   Donc : la promesse du titre doit être tenue à l'écran avant 30 s, idéalement avant 10 s.
2. **Pas de « Bonjour, aujourd'hui je vais vous montrer… », pas de logo animé en ouverture.** Conseil unanime des guides
   de rétention [2][3] ; Ahrefs, une des chaînes SaaS qui réussit le mieux, a supprimé l'intro logo corporate [17].
3. **Les A/B tests natifs de YouTube choisissent par la durée de visionnage, pas par le CTR** (jusqu'à 3 titres et/ou
   3 miniatures) [4][5]. Un titre « putaclic » qui déçoit perd le test. Better Stack fait 3 titres × 3 miniatures sur
   chaque vidéo [16].
4. **CTR « normal »** : pour la moitié des chaînes et vidéos, entre 2 % et 10 % (page d'aide officielle) [6].
5. **Chapitres** : premier repère à 00:00, au moins 3 repères croissants, chacun d'au moins 10 s [7].
6. **Tags** : rôle « minime » pour la découverte, sauf mots souvent mal orthographiés ; titre, miniature et description
   comptent davantage [8]. → Mettre « Chapote », « chapotte », « chapote cm » en tags, et c'est tout.
7. **Recherche YouTube** = pertinence (titre, tags, description, contenu), engagement (dont la durée de visionnage pour
   la requête) et qualité [9]. Les premières lignes de description sont celles qu'on voit avant « Plus » [10].
8. **« 3 mots max » sur la miniature n'est pas confirmé par les données récentes** : l'étude Eden (2 960 miniatures)
   trouve la plus grosse différence dans la tranche 4-6 mots, et pas de gain mesurable des visages [11] ; vidIQ
   (500 miniatures de vidéos « breakout ») trouve une médiane de 5 mots quand il y a du texte, et 52 % des cas avec 0 à
   3 mots [12]. Règle pratique : **court (2 à 5 mots), lisible en petit, complémentaire du titre**.
9. **Visages** : effet global quasi nul sur 300 000 vidéos (1of10), et négatif dans la niche « business » selon le même
   rapport [13] ; Eden : 84,2 % vs 82,2 %, dans le bruit [11]. Pour un outil, **le produit (interface en gros plan) peut
   remplacer le visage**.
10. **Démos B2B** (étude de 1 750 démos) : médiane 430 vues ; les ouvertures par une question atteignent le quart
    supérieur d'engagement dans 40 % des cas contre 26 % en moyenne ; 54 % n'ont aucun appel à l'action clair ; débit
    médian 135 mots/min ; « vous » plus que « nous » dans 81 % des scripts [14].
11. **Les chaînes SaaS qui gagnent parlent du problème du spectateur, pas de la marque** : chez Better Stack, 2 titres
    sur 938 seulement contiennent le nom de la marque [16] ; Ahrefs « sponsorise » ses propres vidéos plus qu'il n'en
    fait le sujet [17][18].
12. **Production programmatique** : la bonne approche est de *scénariser* l'interface (captures réelles + curseur,
    clics et caméra décrits en données, synchronisés sur les mots horodatés de la voix), pas de filmer l'écran [20][21][22].

---

## 1. Ce que disent les sources

### 1.1 Rétention et intro (sources YouTube officielles d'abord)

- **Moments clés pour la rétention** (aide YouTube) [1] :
  - *Intro* = % de spectateurs encore présents après les 30 premières secondes. Haute = les 30 premières secondes
    correspondent à l'attente créée par la miniature et le titre. Basse = vérifier titre/miniature et expérimenter sur
    les 30 premières secondes.
  - *Top moments* : passages où presque personne ne part ; s'ils sont tard dans la vidéo, YouTube conseille de les
    **ramener plus tôt**.
  - *Pics* (revus ou partagés) et *creux* (sautés ou abandon).
  - *Rétention habituelle* : comparaison avec vos 10 dernières vidéos de durée semblable.
- **Conseils tiers (non officiels)** : intro de 10 s ou moins puis contenu [2] ; ne pas commencer par « Hey guys,
  today I'm going to show you how to… » [3] ; reprendre le titre dès la première phrase [3].
- **Wistia** (vidéos d'entreprise hébergées, pas YouTube) : la perte dans le « nez » de la courbe est en moyenne de
  4,9 % pour les vidéos de 1-2 min et 17,3 % pour 5-10 min ; le rapport 2026 (13 millions de vidéos) dit que plus c'est
  court, plus le taux d'engagement est haut, mais qu'une vidéo de 10 min à engagement plus faible fait quand même plus
  de durée totale qu'une vidéo d'1 min [15]. Wistia conseille de mettre l'essentiel dans la **première moitié**.

### 1.2 Démos SaaS : ce que montrent les données

Étude Motion The Agency sur 1 750 démos B2B [14] :
- médiane 430 vues, 65 % sous 1 000 vues → la démo produit « nue » sur YouTube a peu d'audience ; sa valeur est
  surtout d'être trouvée par quelqu'un qui cherche déjà (recherche, site, mail).
- Démos de 60-90 s dans le quart supérieur d'engagement : 27 %, contre 11 % sous 30 s ; entre 30 et 150 s, résultats
  semblables une fois corrigé l'âge des vidéos.
- 8 % des scripts commencent par une question ; ces vidéos sont dans le quart supérieur dans 40 % des cas (26 % pour
  l'ensemble). 25 % commencent par un problème client. 3 % citent la marque dans les 10 premiers mots.
- 54 % sans appel à l'action clair.
- Débit médian 135 mots/min (≈ 135 mots pour 60 s, ≈ 200 pour 90 s).
- Commentaires : les éloges de l'animation sont 2,4 fois plus fréquents que ceux de la clarté ; les commentaires de
  confusion ont 7 fois plus de chances de recevoir 5 j'aime ou plus que les compliments génériques (→ la confusion est
  le vrai risque).

Ordre recommandé par plusieurs praticiens (pas d'étude contrôlée) : problème → solution → démo → fonctions → CTA ; ne
jamais suivre l'ordre du menu de l'application [19].

### 1.3 Lancements qui marchent

- **Arc (The Browser Company)** : le fondateur à l'écran tient un ton auto-ironique (parodie de keynote), **reformule le
  problème avant la solution** (« un navigateur qui navigue pour vous »), et montre surtout des **cas d'usage
  quotidiens et des réactions** plutôt que la technique [23].
- **Analyse Speedrun (a16z) de lancements viraux** [24] : produit à l'écran tôt (fondateur ~15 s puis démo jusqu'à la
  fin, > 50 % de démo) ; accroche par une affirmation forte et précise ; **zoom sur le curseur et l'interface** pour que
  l'on suive ; résultats concrets ; CTA précis (« commente pour une invitation ») ; une 2ᵉ vidéo « disponible
  maintenant » a ajouté ~3,5 M d'impressions sur X dans un cas.
- **Linear** : vidéos de lancement courtes et denses, une seule tâche par vidéo, interface sombre, peu de narration
  (source fournisseur, à vérifier) [25] ; **Open Design** recommande de restreindre la promesse à ce qu'on peut montrer
  honnêtement à l'écran [26].

### 1.4 Chaînes d'outils qui réussissent (exemples réels)

| Chaîne | Ce qu'elle fait | Leçon pour Chapote CM |
|---|---|---|
| **Better Stack** [16] | 139 k abonnés, ~30 vidéos/mois à 4 ; tutoriels « best practices » en fond (« Docker Image Best Practices » 414 k vues, « 12 Logging Best Practices » 256 k), comparatifs « X vs Y », puis « newsroom » d'actualité ; marque quasi absente des titres (2/938) ; montage léger (tests : aussi bon que le lourd) ; 3 titres + 3 miniatures en A/B natif ; rétro hebdo sur vues, abonnés, CTR, rétention ; au plus 3 vidéos par 24 h (limite des notifications). | Une bibliothèque **evergreen** de tutos « comment faire X sur Instagram/TikTok » fait la base ; la vidéo produit pure est minoritaire. |
| **Ahrefs** [17][18] | « Product-led content » : le produit est tissé dans un sujet utile ; score de « potentiel business » 0-3 par sujet, priorité aux 2-3 ; un présentateur constant (Sam Oh) ; titres conversationnels (« I Used ChatGPT to Rank #1 in Google (in One Hour) ») ; séries type cours (« Complete … Course for Beginners »). | Choisir chaque sujet pour que **Chapote CM soit la façon naturelle de le résoudre** (score 2-3). Une voix TTS constante = « présentateur » reconnaissable. |
| **Canva Design School** [27] | Tutoriels courts classés par niveau, ~4 à 15 min, les « What's New » plus longs. | Étiqueter les tutos par niveau (Débutant / Pro). |
| **Metricool** [28] | Concurrent direct : playlist « Metricool 101: Your How-To Guide », tutos de planification de Shorts et vidéos ; guides écrits en français. | Le terrain des tutos « programmer un Reel / un Short » est occupé : se différencier par **gratuit, français, simple**. |
| **Chaînes francophones marketing** [29] | BDM (Blog du Modérateur), Marketing Mania (Stan Leloup), Stratège Marketing, Bruno Guyot (freelances). | Références de ton et de vocabulaire pour un public de CM/freelances français ; pistes de collaborations. |

Notion, Buffer, Later, Descript, Raycast, CapCut : pas trouvé d'analyse chiffrée publique de leurs chaînes pendant cette
recherche ; ne pas citer de chiffres à leur sujet.

### 1.5 Miniatures et titres : données

- **Officiel** : 1280×720 recommandé (largeur mini 640 px) ; compte vérifié requis ; miniatures fidèles au contenu
  [30][31].
- **Eden, 507 478 vidéos longues / 2 960 miniatures, août 2025-août 2026** [11] (corrélationnel, < 2,5 points = bruit) :
  - visages 84,2 % (breakout) vs 82,2 % (sous-performance) : pas de différence nette ;
  - aucun texte : 13,4 % vs 16,8 % ; 4-6 mots : 30,6 % vs 26,5 % (plus gros écart mesuré) ; 7+ mots : 29,6 % vs 31,1 % ;
  - flèches, cercles, contours : 41,8 % vs 38,1 % ; captures d'écran brutes : 2,6 % vs 3,8 % (petit échantillon) ;
  - luminosité, contraste, saturation : identiques ;
  - taux de « breakout » par longueur de titre : < 30 caractères 26,1 %, 45-59 : 33,9 %, 60-74 : 34,8 %, > 75 : 35,9 % ;
  - par durée : < 5 min 26,9 %, 5-10 min 30,2 %, 10-20 min 33,0 % (observationnel).
- **vidIQ, 500 miniatures breakout, juin 2026** [12] : visage 69 %, texte 72 %, fort contraste 56 %, visage *ou* fort
  contraste 89 % ; médiane 5 mots quand il y a du texte ; expression exagérée 5 % seulement.
- **1of10 via Search Engine Journal, 300 000 vidéos virales 2025** [13] : avec ou sans visage, résultats semblables ;
  visages meilleurs en finance, **moins bons en business** ; plusieurs visages > un seul.

Conclusion : la règle « 3 mots max, visage expressif » est un bon point de départ esthétique mais pas une loi ; pour un
outil B2B, **un gros plan net de l'interface + 2 à 5 mots + un élément graphique (flèche, cercle)** est défendable.
À trancher par l'A/B natif.

---

## 2. Modèles de structure minutés

Conventions : V = voix (TTS), É = écran (capture réelle de cm.chapote.fr animée), B = B-roll / motion design,
⟲ = « relance d'attention » (changement de plan, zoom, schéma, chiffre, question). Débit cible : 135-150 mots/min
(médiane mesurée 135 [14]) → ~400 mots pour 3 min, ~1 000 pour 7 min. Une relance toutes les 30 à 60 s, à
intervalles **irréguliers** (les guides divergent de 3 s à 60 s ; trop régulier ou trop chargé fatigue [32]) ;
changements plus fréquents dans la première minute (10-15 s).

### 2.1 Lancement « fondateur » — 3 à 5 min

But : dire pourquoi Chapote CM existe et donner envie de l'essayer. Pas de visage requis (voix + produit), mais une
voix constante et un « je » de fondateur.

| Temps | Bloc | Contenu (exemple Chapote CM) | Visuel |
|---|---|---|---|
| 0:00-0:08 | Accroche | « Publier le même Reel sur Instagram, TikTok et YouTube, c'est trois applis et vingt minutes. Ici, c'est une fois. » | É : la même vidéo qui part vers 3 plateformes, résultat visible tout de suite |
| 0:08-0:30 | Problème reformulé | Le quotidien du CM : 3 applis, horaires, légendes différentes, oubli. Une question au spectateur (« Combien d'applis ouvrez-vous pour un seul post ? ») | B : écrans qui s'empilent ⟲ |
| 0:30-0:50 | Promesse + qui je suis | « J'ai fait Chapote CM : gratuit, en français, pour programmer vos vidéos courtes partout. Voici ce que ça change. » | É : tableau de bord en grand, logo discret en coin |
| 0:50-2:30 | Démo en 3 moments | 1) déposer une vidéo et choisir les plateformes ; 2) textes par plateforme (légende, titre YouTube, hashtags) ; 3) planning et publication à l'heure | É zoomé sur chaque clic, curseur agrandi, encadré (callout) par action ⟲ à chaque moment |
| 2:30-3:10 | Preuve | Une vraie publication sortie aux 3 endroits (capture du résultat), statut dans le planning | É + B : 3 téléphones côte à côte ⟲ |
| 3:10-3:40 | Ce qui arrive / limites honnêtes | Feuille de route courte ; ce que l'outil ne fait pas encore | B : liste animée |
| 3:40-4:00 | CTA unique | « Créez votre compte gratuit sur cm.chapote.fr, lien en description. » + écran de fin (20 s max) | Carte de fin + vidéo suivante suggérée |

### 2.2 Tutoriel — 6 à 10 min

But : répondre à une recherche précise (« programmer un Reel Instagram gratuitement »). C'est le format qui dure (cf.
« best practices » de Better Stack [16]).

| Temps | Bloc | Contenu | Visuel |
|---|---|---|---|
| 0:00-0:10 | Résultat d'abord | Montrer le Reel programmé et publié ; phrase = le titre | É : résultat final |
| 0:10-0:30 | Plan de la vidéo | « En 3 étapes, ~6 min ; à la fin, astuce pour l'heure idéale. » (boucle ouverte) | B : 3 étapes en sommaire = chapitres |
| 0:30-1:00 | Prérequis | Compte, connexion Instagram professionnel, format 9:16 | É |
| 1:00-2:45 | Étape 1 | Connexion du compte | É zoomé, curseur, callouts ; ⟲ à mi-étape (schéma « ce qui se passe ») |
| 2:45-4:30 | Étape 2 | Dépôt, couverture, légende | É ; ⟲ erreur fréquente montrée en rouge puis corrigée |
| 4:30-6:15 | Étape 3 | Choix de l'heure, programmation, vérification du statut | É ; ⟲ récap à l'écran |
| 6:15-7:15 | Astuce promise | Boucle ouverte fermée (ex. : texte différent pour TikTok/YouTube) | É + B |
| 7:15-8:00 | Récap + erreurs à éviter | 3 puces | B |
| 8:00-8:30 | CTA + vidéo suivante | Une seule action ; carte de fin vers le tuto suivant de la série | Carte de fin |

Chapitres en description (≥ 10 s chacun, 00:00 en premier [7]).

### 2.3 Cas d'usage — 4 à 6 min

But : un profil, un problème, un avant/après (« Une boulangerie publie 5 Reels par semaine en 20 min »). Pas de faux
témoignage : un scénario présenté comme exemple, ou un vrai utilisateur avec son accord.

| Temps | Bloc | Contenu | Visuel |
|---|---|---|---|
| 0:00-0:10 | Avant/après chiffré honnêtement | Situation de départ → résultat (chiffres réels ou « exemple ») | B : split screen |
| 0:10-0:45 | Le personnage et sa contrainte | Qui, combien de temps, quelles plateformes | B illustré ⟲ |
| 0:45-3:30 | La semaine type dans l'outil | Lundi : préparer ; planning de la semaine ; textes adaptés | É zoomé ; ⟲ toutes les 30-60 s (calendrier, gros plan, compteur de temps gagné) |
| 3:30-4:30 | Ce qui a changé | Temps, régularité, plateformes ajoutées | B : 3 chiffres max |
| 4:30-5:00 | Comment faire pareil | Les 3 réglages à copier | É |
| 5:00-5:20 | CTA | Lien + « quel métier pour le prochain cas ? » en commentaire | Carte de fin |

### 2.4 FAQ — 3 à 5 min

But : lever les objections (recherches « Chapote CM gratuit ? », « est-ce sûr ? »). Une question = un chapitre.

| Temps | Bloc | Contenu |
|---|---|---|
| 0:00-0:10 | La question la plus posée, répondue tout de suite | « Oui, c'est gratuit. Voici les 6 autres questions qu'on nous pose. » |
| 0:10-0:20 | Sommaire | Les questions à l'écran (= chapitres) |
| 0:20-4:00 | 5 à 7 questions × 25-40 s | Question écrite en grand → réponse courte → preuve à l'écran (capture). ⟲ = carton de chaque question |
| 4:00-4:30 | Question restante → commentaires | « Posez la vôtre, elle sera dans la prochaine FAQ » |
| 4:30-4:45 | CTA | Lien |

Questions candidates : c'est gratuit ? quelles plateformes ? mes accès sont-ils en sécurité (connexion officielle) ?
puis-je mettre un texte différent par plateforme ? que se passe-t-il si une publication échoue ? Shorts de plus de 60 s ?
plusieurs comptes ?

### 2.5 Durée selon l'intention (synthèse)

| Intention | Durée conseillée | Justification |
|---|---|---|
| Démo/teaser produit | 60-150 s | engagement semblable entre 30 et 150 s, 60-90 s mieux que < 30 s [14] |
| Lancement fondateur | 3-5 min | assez pour problème + démo + preuve ; recommandation (pas de donnée spécifique) |
| Tutoriel « comment faire » | 6-10 min | répondre complètement à une recherche ; taux de breakout plus hauts au-delà de 5 min dans Eden (corrélation) [11] |
| Cas d'usage | 4-6 min | récit + démo ; recommandation |
| FAQ | 3-5 min | 5-7 questions × 30 s ; recommandation |
| Comparatif (« Chapote CM vs Metricool ») | 6-12 min | format qui se classe bien en recherche selon des analyses SaaS [33] ; rester factuel |

Les vidéos actuelles (~1 min, statiques) entrent dans « démo/teaser » ; pour YouTube long, elles gagneraient à devenir
l'accroche ou un chapitre d'un tuto plus complet.

---

## 3. Mise en scène d'écran (style Screen Studio, à reproduire)

Ce que fait Screen Studio et que l'on veut imiter [34][35] :
- zoom automatique sur le curseur, généré à partir des clics ; sans clic, le zoom suit le mouvement du curseur ;
- curseur agrandi et trajectoire lissée (option « Smooth cursor movement ») ;
- zooms réglables après coup ; zooms trop rapides = vertige (à lisser).

Règles de réalisation (recommandations) :
1. **Une action = un zoom** : on part de la vue large (contexte), on zoome (1,6× à 2,5×) sur la zone du clic ~0,4 s
   avant le clic, on reste pendant l'explication, on dézoome pour l'étape suivante. Jamais deux zooms enchaînés sans
   pause.
2. **Curseur** : 1,5 à 2× la taille système, trajectoire courbe et amortie (ressort), halo/cercle au clic, petit son
   de clic discret.
3. **Callouts** : étiquette courte (3-5 mots) qui pointe l'élément, flou/assombrissement léger du reste.
4. **Texte saisi** : frappe simulée caractère par caractère, pas de collage instantané.
5. **Fond** : capture dans une fenêtre arrondie avec ombre sur un fond de marque (rend la 16:9 moins « brute »).
6. **Lisibilité** : l'interface doit être lisible sur un téléphone → zoom plutôt que capture pleine résolution.
7. **Sous-titres** : YouTube les propose ; en incruster seulement les mots-clés (pas tout le texte, contrairement aux
   Reels).

---

## 4. Production programmatique (Remotion + TTS + captures réelles)

Ce que font d'autres équipes :
- **Composition React qui « joue » l'interface** au lieu de filmer : curseur qui vise des éléments par identifiant DOM
  avec des trajectoires (arc, linéaire, amortie), images clés d'état d'interface alignées sur les clics, « caméra »
  globale (zoom, panoramique) avec easing par image clé ; leçon : **références relatives aux scènes, pas en numéros
  d'image absolus**, sinon tout casse quand une durée change ; 1920×1080 à 30 i/s [21].
- **Timeline d'actions en données** (« à l'image X, remplir le champ Y ») animée par `interpolate()` +
  `Easing.inOut(Easing.cubic)` ; composants « purs » alimentés par des données fictives [22].
- **Captures fournies + génération du TSX par un LLM puis `npx remotion render`, avec relance sur erreur** [20].
- **Lissage du curseur** : filtrage des tremblements, densification, lissage par ressort (profil par défaut
  tension 170, friction 20 dans le projet open source screen-studio-effects) [36] ; un développeur signale que la
  gigue des données de curseur est la principale difficulté [36].
- **Briques réutilisables** : composant MIT « Zoom Follows the Click » pour Remotion (16:9, 9:16, 1:1) [37] ; Mockoops
  (Remotion, animations de captures) ; Remocn (zoom-blur, terminal simulé) ; OpenScreen/Recordly (enregistreurs
  open source avec auto-zoom) [38].

Chaîne proposée pour Chapote CM (conception, à valider) :
1. **Script** (`script.json`) : blocs du modèle choisi (§2), texte de voix par bloc, et pour chaque bloc une liste
   d'actions `{type: click|type|scroll|hover, cible: "<sélecteur ou data-testid>", mot_declencheur: "<mot de la voix>"}`.
2. **Voix** : `scripts/tts.py` (mots horodatés) → chaque action est calée sur le temps de son mot déclencheur (le clic
   tombe sur le mot « programmer », pas au hasard).
3. **Captures réelles** : Playwright sur cm.chapote.fr (compte de démonstration, données fictives propres), fenêtre
   1920×1080 et `deviceScaleFactor: 2` pour garder le texte net au zoom ; pour chaque action : capture avant/après +
   boîte englobante de la cible (`locator.boundingBox()`), ou vidéo Playwright (`recordVideo`) si une animation de
   l'app doit être vue. Masquer données personnelles et jetons.
4. **Remotion** : `<Img>` des captures (ou `<OffthreadVideo>`), une couche `Camera` (scale/translate interpolés vers la
   boîte de la cible, avec `spring`), une couche `Curseur` (trajectoire amortie, halo au clic), `Callout`, `Frappe`,
   transitions entre étapes (`@remotion/transitions`) ; durée totale calculée depuis l'audio (`calculateMetadata`).
5. **Relances automatiques** : un générateur insère un ⟲ (carton, schéma, gros plan) si 45 s passent sans changement
   de plan, avec un écart aléatoire pour éviter la régularité.
6. **Sorties** : `video.mp4` 16:9, `miniatures/` (3 variantes pour l'A/B), `youtube.json` (3 titres, description avec
   chapitres générés depuis les blocs, tags), `chapitres.txt` vérifié (00:00, ≥ 3, ≥ 10 s).
7. **Contrôle** : agent `controle-visuel` (image ↔ voix), vérification que chaque zoom montre bien la cible nommée.

---

## 5. Miniatures et titres pour Chapote CM

### 5.1 Règles

1. **Titre et miniature se complètent** (ne pas répéter le titre mot pour mot : 6-7 % seulement des miniatures le font
   [11]).
2. **2 à 5 mots** sur la miniature, très gros, lisibles à la taille d'une vignette mobile ; 0 mot possible si l'image
   parle seule.
3. **Un seul sujet visuel** : gros plan de l'interface (bouton « Programmer », planning plein, 3 logos de plateformes)
   ou un visage si un humain présente ; fort contraste (contraste ou visage présent dans 89 % des breakouts [12]).
4. **Un élément graphique** (flèche, cercle, encadré) vers ce qui compte [11].
5. **Couleurs de marque constantes**, mais pas de gabarit rigide (Better Stack et Ahrefs n'en ont pas [16][17]).
6. **Honnête** : la miniature montre ce que la vidéo montre [31] (sinon l'intro chute et l'A/B est perdu [1][4]).
7. **Titre** : mot-clé de recherche au début, 45-75 caractères (zone des meilleurs taux de breakout chez Eden [11]),
   promesse concrète (durée, gratuit, nombre d'étapes), marque à la fin ou absente (titres sans marque chez Better
   Stack [16]).
8. **3 titres + 3 miniatures en A/B natif** sur chaque vidéo [4][16].

### 5.2 Exemples (français)

| Type | Titre YouTube | Texte miniature | Image |
|---|---|---|---|
| Lancement | J'ai créé un outil gratuit pour publier sur TikTok, Reels et Shorts en une fois | « 1 clic, 3 réseaux » | 1 vidéo → 3 logos |
| Lancement | Publier partout sans 3 applis : voici Chapote CM | « Fini les 3 applis » | 3 applis barrées → 1 écran |
| Tuto | Comment programmer un Reel Instagram gratuitement (2026) | « Programmé ✓ » | bouton Programmer en gros plan |
| Tuto | Programmer un Short YouTube depuis son ordinateur, étape par étape | « Short à 18 h » | horloge + Short |
| Tuto | Publier la même vidéo sur TikTok, Instagram et YouTube (sans la refaire) | « Une vidéo, 3 réseaux » | split 3 téléphones |
| Cas d'usage | Ma semaine de Reels préparée en 20 minutes (exemple réel) | « 20 min/semaine » | planning plein |
| Cas d'usage | Community manager freelance : gérer 5 clients sans s'épuiser | « 5 clients » | 5 colonnes de planning |
| FAQ | Chapote CM est-il vraiment gratuit ? 7 questions, 7 réponses | « Vraiment gratuit ? » | point d'interrogation + logo |
| Comparatif | Chapote CM ou Metricool pour programmer ses vidéos courtes ? | « Lequel choisir ? » | deux interfaces côte à côte |
| Erreur | 5 erreurs qui tuent la portée de vos Reels programmés | « Erreur n°3 » | encadré rouge |

À éviter : « Présentation de Chapote CM », « Tutoriel Chapote CM partie 1 », majuscules partout dans le titre,
promesses chiffrées non tenues (« x10 vues »).

---

## 6. Checklist SEO YouTube

**Avant de produire**
- [ ] Sujet choisi sur une recherche réelle (suggestions de la barre YouTube, onglet Recherche de YouTube Analytics,
      Planificateur de mots-clés Google [10]) ; « potentiel business » 2-3 (l'outil est la solution naturelle) [18].
- [ ] Un sujet = une intention (tuto, comparatif, FAQ…).

**Titre**
- [ ] Mot-clé principal dans les premiers mots ; 45-75 caractères ; ≤ 100 caractères (limite YouTube).
- [ ] Promesse tenue dans les 30 premières secondes [1].
- [ ] 2 variantes de plus pour l'A/B [4].

**Description**
- [ ] 1-2 premières lignes : ce que la vidéo résout + mot-clé + lien cm.chapote.fr (visibles avant « Plus ») [10].
- [ ] Paragraphe de 2-4 phrases avec synonymes (programmer / planifier / publier ; Reel / Short / TikTok).
- [ ] Chapitres : 00:00 en premier, ≥ 3, croissants, ≥ 10 s chacun, titres descriptifs avec mots-clés [7].
- [ ] Liens : inscription, vidéo suivante de la série, playlist.
- [ ] 2-3 hashtags maximum (pas de liste de tags dans la description : spam [8]).

**Tags** [8]
- [ ] Peu nombreux : marque et ses fautes (« chapote », « chapotte », « chapote cm »), 3-5 expressions clés. Pas de
      bourrage.

**Fichier et métadonnées**
- [ ] Sous-titres : fichier SRT/VTT exact (on a le texte exact de la voix TTS) plutôt que l'automatique.
- [ ] Langue de la vidéo et du titre = français ; titres/descriptions traduits possibles plus tard.
- [ ] Miniature 1280×720 [30], 3 variantes.
- [ ] Écran de fin (vidéo suivante + abonnement) et fiches (« cards ») vers le tuto lié.
- [ ] Playlist par série (« Débuter avec Chapote CM », « Programmer ses Reels », « FAQ »).

**Après publication**
- [ ] J+2 : rétention de l'intro (30 s), creux, top moments [1] ; CTR comparé à la plage 2-10 % [6] et à la chaîne.
- [ ] Répondre aux commentaires de confusion d'abord (signal le plus fort selon [14]) → sujets de la prochaine FAQ.
- [ ] Au plus 3 vidéos par 24 h (limite des notifications, selon [16]).

---

## 7. Grille de notation sur 10

À appliquer à chaque script/montage avant publication (agent de contrôle ou humain). Seuil proposé : ≥ 7 pour publier.

| # | Critère | Points | 1 point si… |
|---|---|---|---|
| 1 | Accroche | 1,5 | promesse du titre montrée/dite avant 10 s (0,5 si entre 10 et 30 s, 0 au-delà) ; pas de salut ni de logo |
| 2 | Problème | 1 | le problème du spectateur est formulé (idéalement en question) avant la solution |
| 3 | Preuve à l'écran | 1,5 | chaque affirmation a son plan de produit réel ; résultat final visible |
| 4 | Lisibilité de l'interface | 1 | zoom sur chaque action, curseur visible, texte lisible sur téléphone |
| 5 | Rythme | 1 | aucun passage > 60 s sans changement visuel ; intervalles irréguliers ; pas de surcharge |
| 6 | Structure | 1 | chapitres valides (00:00, ≥ 3, ≥ 10 s), annoncés en sommaire, boucle ouverte refermée |
| 7 | Voix et texte | 0,5 | débit 130-160 mots/min, « vous » > « nous », pas de jargon non expliqué |
| 8 | CTA | 0,5 | un seul appel à l'action clair, + vidéo suivante |
| 9 | Emballage | 1 | titre 45-75 car. avec mot-clé ; 3 titres et 3 miniatures (2-5 mots, contraste, honnêtes) |
| 10 | SEO | 0,5 | description (2 premières lignes), tags limités, sous-titres exacts, playlist |
| 11 | Honnêteté | 0,5 | aucun chiffre ou témoignage inventé ; limites dites |
| | **Total** | **10** | |

---

## 8. Sources

1. YouTube Help — Measure key moments for audience retention : https://support.google.com/youtube/answer/9314415?hl=en
2. vidIQ — YouTube Audience Retention / YouTube intros : https://vidiq.com/blog/post/increase-audience-retention-youtube/ ; https://vidiq.com/blog/post/youtube-video-intros/
3. vidIQ — YouTube intros (hooks) : https://vidiq.com/blog/post/youtube-intros/ ; Skool, stratégies de rétention : https://skool.com/content-academy/here-are-the-best-15-youtube-retention-strategies
4. YouTube Help — A/B test titles & thumbnails : https://support.google.com/youtube/answer/16391400?hl=en
5. YouTube Help — Test & compare thumbnails : https://support.google.com/youtube/answer/13861714 ; Search Engine Journal, test des titres : https://www.searchenginejournal.com/youtube-title-a-b-testing-rolls-out-globally-to-creators
6. YouTube Help — Impressions & click-through rate FAQ : https://support.google.com/youtube/answer/7628154 (version française : https://support.google.com/youtube/answer/7628154?hl=fr)
7. YouTube Help — Video Chapters : https://support.google.com/youtube/answer/9884579?hl=en
8. YouTube Help — Add tags to videos : https://support.google.com/youtube/answer/146402?hl=en
9. YouTube Help — How YouTube search works : https://support.google.com/youtube/answer/16090438?hl=en
10. YouTube Help — Tips for video descriptions : https://support.google.com/youtube/answer/12948449?hl=en
11. Eden — What makes a good YouTube thumbnail? We analyzed 507,478 videos : https://eden.so/blog/what-makes-a-good-youtube-thumbnail/
12. vidIQ Research — YouTube thumbnail study (juillet 2026) : https://vidiq.com/research/youtube-thumbnail-study/
13. Search Engine Journal — Do faces help YouTube thumbnails? (rapport 1of10) : https://www.searchenginejournal.com/do-faces-help-youtube-thumbnails-heres-what-the-data-says/563944/
14. Motion The Agency — Product demo video best practices: lessons from 1,750 B2B demos : https://www.motiontheagency.com/blog/product-demo-video-best-practices
15. Wistia — Optimal video length / Understanding audience retention / State of Video : https://wistia.com/blog/optimal-video-length ; https://wistia.com/library/understanding-audience-retention ; https://wistia.com/blog/insights-state-of-video-report
16. How Better Stack wins YouTube (Substack) : https://zkami.substack.com/p/how-better-stack-wins-developers
17. Video First — Ahrefs, how they've conquered YouTube : https://videofirst.beehiiv.com/p/ahrefs-how-they-ve-conquered-youtube
18. Ahrefs — SaaS content marketing (product-led content, business potential) : https://ahrefs.com/blog/saas-content-marketing ; Supermetrics : https://supermetrics.com/blog/ahrefs-product-led-content-marketing-and-seo
19. Supademo — SaaS demo video guide : https://supademo.com/blog/demo-video ; DEV — The 8-second rule : https://dev.to/cvchelles/the-8-second-rule-why-most-saas-demos-lose-viewers-instantly-2elg
20. R. Frenoy — Automating product demo videos with AI and Remotion : https://rfrenoy.github.io/blog/automating-product-demo-videos
21. DEV — How I built a programmatic video engine for SaaS product demos : https://dev.to/bojan_josifoski_76e9fd65d/how-i-built-a-programmatic-video-engine-for-saas-product-demos-5292
22. LogRocket — Replace screen recordings with Remotion : https://blog.logrocket.com/remotion-screen-recordings/
23. Off Menu — Three reasons Arc's launch video went viral : https://offmenu.substack.com/p/three-reasons-arcs-launch-video-went
24. Speedrun (a16z) — How to make a viral launch video : https://speedrun.substack.com/p/how-to-make-a-viral-launch-video
25. Arcade — Product launch video examples : https://www.arcade.software/post/product-launch-video-examples
26. Open Design — Build a product launch video around one clear promise : https://open-design.ai/blog/product-launch-video-storytelling/
27. Canva Design School — videos : https://www.canva.com/design-school/videos
28. Metricool — tutoriels / programmer des vidéos sur YouTube : https://metricool.com/fr/tutoriels-de-metricool/ ; https://metricool.com/fr/programmer-des-videos-sur-youtube ; https://help.metricool.com/fr/decouvrez-metricool-p0zdh
29. BDM — 10 chaînes YouTube à suivre pour les pros du digital : https://www.blogdumoderateur.com/chaines-youtube-pros-digital/ ; Learnthings (article sponsorisé) : https://www.learnthings.fr/?p=25935
30. YouTube Help — Add custom thumbnails : https://support.google.com/youtube/answer/72431?hl=en
31. YouTube Blog — Thumbnails: your video's billboard : https://blog.youtube/news-and-events/thumbnails-your-videos-billboard-on/
32. Pattern interrupts : https://blog.autonolab.com/blog/2025-10-01-pattern-interrupts-resetting-attention-every-30-seconds/ ; https://www.creatoressentials.com/glossary/pattern-interrupt/ ; https://air.io/en/youtube-hacks/advanced-retention-editing-cutting-patterns-that-keep-viewers-past-minute-8
33. Overseer — B2B SaaS YouTube strategy : https://www.overseeros.com/blog/b2b-saas-youtube-strategy ; Advids : https://advids.co/insights/the-saas-youtube-strategy-driving-organic-discovery-and-growth
34. Screen Studio — Guide / help : https://www.screen.studio/help ; https://screen.studio/guide/animations
35. DEV — Screen Studio review : https://dev.to/pickuma/screen-studio-review-the-macos-screen-recorder-that-makes-every-recording-look-produced-3a02
36. screen-studio-effects (miroir) : https://1clonegithubbyxjn.1934672944.workers.dev/pythonlearner1025/Screen-Studio-Effects ; DEV — Mac screen recorder with zoom from click data : https://dev.to/snazarofff/building-a-mac-screen-recorder-that-adds-zoom-animations-from-click-data-528m
37. 21st.dev — Zoom Follows the Click (Remotion, MIT) : https://21st.dev/@21st/components/zoom-follow
38. Mockoops : https://awesome.ecosyste.ms/projects/github.com%2FJust-Moh-it%2FMockoops ; OpenScreen : https://github.com/gko/openscreen ; OpenVid : https://github.com/th3nolo/openvid ; Remocn : https://dev.to/remocn/how-to-make-a-product-demo-video-in-react-ief ; Remotion Player : https://remotion.dev/docs/player/

Limites : pas d'accès direct aux vidéos Creator Insider (les règles officielles viennent des pages d'aide YouTube) ;
pas trouvé d'analyse chiffrée publique des chaînes Notion, Buffer, Later, Descript, Linear, Raycast ou CapCut ; les
études miniatures sont corrélationnelles ; plusieurs sources sont des blogs de fournisseurs (signalés).
