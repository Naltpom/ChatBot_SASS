# 06 — Sound design et musique des vidéos courtes de promo (Chapote CM)

> Recherche n° 6 sur 10. Sujet traité : le son seulement (musique, effets sonores, mixage, loudness, droits, sources libres, implémentation Remotion/ffmpeg).
> Point de départ : les vidéos de promo de cm.chapote.fr ont une voix TTS, un « whoosh » ou un « pop » discret à chaque changement de plan, et pas de musique. On les juge sans énergie.
> Règle suivie ici : chaque chiffre a une source (liste à la fin, numérotée [n]). Quand un chiffre vient d'un blog ou d'une étude payée par une plateforme, c'est indiqué. Ce qui relève de la pratique du métier, sans étude derrière, est marqué **(pratique)**.

---

## 0. Résumé en une page

1. **Ajouter une musique de fond est le levier n° 1.** La voix seule est le seul cas où la vidéo n'a ni rythme ni couleur émotionnelle. Les études TikTok/Kantar et VidMob (payées par la plateforme ou ses partenaires, à prendre comme des pistes à tester) vont dans le même sens : sur TikTok, les publicités avec du son font monter l'intention d'achat et l'image de marque [1] ; musique + narration ensemble donnent un taux de conversion 2× plus élevé qu'un seul des deux [6].
2. **Musique instrumentale libre, jamais un « son tendance ».** Un compte entreprise n'a pas accès à la bibliothèque générale de TikTok : il ne voit que la Commercial Music Library [3][4]. Chez Meta, la Sound Collection est libre de droits mais ne vaut que sur les produits Meta [7][8]. Comme on publie la même vidéo sur 3 plateformes via cm, la musique doit être **intégrée au fichier**, avec une licence valable partout : CC0, Pixabay Content License, ou CC BY avec crédit.
3. **Mixage chiffré.** Voix devant ; musique 18 à 22 dB sous la voix pendant qu'elle parle [10][11], remontée vers −10 dB quand personne ne parle [11]. Ducking automatique de −12 dB (léger) à −18 dB (net) [12]. Sortie finale : **−14 LUFS intégrés, true peak −1 dBTP** (valeur la plus citée pour Reels, TikTok et Shorts, mais **aucune plateforme ne la documente officiellement** [13][14][15]).
4. **Tempo.** Les études classent les tempos en lent (40–76 BPM), modéré (77–107) et rapide (108–208) [17]. Une étude du *Journal of Advertising Research* sur 26 025 vraies publicités vidéo montre que l'effet du tempo n'apparaît qu'avec une musique assez rapide, et seulement pour les messages « promotion », c'est-à-dire de gain (« gagne du temps, publie partout ») [18]. C'est exactement le message de Chapote CM : viser **110–128 BPM** pour les hooks et les démos, garder 70–95 BPM pour l'histoire du fondateur.
5. **Les coupes sur le temps, mais pas toutes.** Une étude contrôlée trouve un effet d'attention entre montage sur le temps et montage à contretemps [20]. Dans 2/3 des clips étudiés, les coupes tombent sur le temps [21]. La pratique déconseille de couper sur *chaque* temps, qui donne un rythme mécanique [22].
6. **Effets sonores : un catalogue par moment** (§4), avec 4 sources CC0 téléchargeables par script : BigSoundBank (déjà utilisé par le dépôt), Kenney, Freesound filtré « Creative Commons 0 », Sonniss GDC. Plus ElevenLabs Sound Effects (offre payante, usage commercial permis [33]).

---

## 1. Pourquoi le son compte : ce que disent les sources

| Constat | Chiffre | Source | Fiabilité |
|---|---|---|---|
| Utilisateurs TikTok pour qui le son est « essentiel » à l'expérience | 88 % | Kantar pour TikTok [1], repris par Social Media Today [2] | Sondage déclaratif payé par TikTok |
| TikTok est la seule plateforme où les pubs avec son font monter à la fois l'intention d'achat et l'image de marque (chez des concurrents, le son *baisse* l'image de marque) | qualitatif | Kantar pour TikTok [1] | Payé par TikTok |
| Répondants qui disent qu'ils « s'arrêteraient pour regarder » une pub TikTok avec du son | 73 % | Kantar pour TikTok [1] | Payé par TikTok |
| Son perçu comme « fun » sur TikTok, par rapport aux autres plateformes sans le son | +66 % | Kantar pour TikTok [1] | Payé par TikTok |
| Utilisateurs qui ont le son activé « toujours ou la plupart du temps » | TikTok 62 %, YouTube 77 %, Instagram 47 %, Facebook 45 % | Sondage Voices [5] | Date et échantillon peu clairs |
| Reels vus avec le son | « 80 % » ou « 60 % » selon les blogs | [19] | **Introuvable chez Meta** : ne pas citer |
| Chansons connues dans les pubs : 5 % plus appréciées et intention d'achat plus forte ; **la musique instrumentale donne une meilleure mémorisation de la marque** | 5 % | TikTok × Kantar × Hotspex, via WARC (06/04/2022) [9] | Payé par TikTok |
| Musique seule : +51 % de taux de vue à 6 s, comparé à voix + musique ou voix seule ; mais musique + narration : conversion 2× plus forte qu'un seul des deux | +51 %, 2× | VidMob via le blog TikTok [6] | Partenaire de TikTok, chiffres de seconde main (la page n'a pas pu être relue) |
| Pubs avec voix off : 71 % de reconnaissance en plus que les pubs ASMR | +71 % | TikTok, cité par [6] | Seconde main |
| Une pub avec musique de fond donne plus d'éveil émotionnel et d'attention que la narration seule | qualitatif | Texas A&M, pubs sportives [16] | Petite étude, tempo non isolé |

**Ce qu'on en retient pour Chapote CM :**
- Une voix TTS seule, c'est la configuration la plus faible de ces comparaisons. **Voix + musique instrumentale** est le bon point de départ : la musique instrumentale aide la mémorisation de la marque [9], et l'association musique + narration est celle qui convertit le mieux [6].
- Une partie du public regarde sans le son, surtout sur Instagram (47 % seulement ont le son activé la plupart du temps [5]). Les sous-titres restent indispensables (autre recherche). Le son doit **renforcer** l'image, sans porter seul l'information.
- Le chiffre VidMob de +51 % pour la musique seule fait penser à une variante à tester en A/B : les 1 à 2 premières secondes en musique et effets seulement (hook visuel), puis la voix.

---

## 2. Droits : ce qu'un compte entreprise peut utiliser

### 2.1 Sons tendance et bibliothèques intégrées

| Plateforme | Ce qui est permis à une marque | Source |
|---|---|---|
| **TikTok** | Un compte Business qui appuie sur « Ajouter un son » ne voit **que** la Commercial Music Library. Les titres de la bibliothèque générale « ne sont pas pré-libérés pour un contenu commercial, c'est-à-dire tout contenu publié par une marque, et ne peuvent être utilisés par aucune marque ni entreprise ». La restriction suit l'**usage** (promouvoir un produit), pas seulement l'étiquette du compte. | TikTok Ads Help [3][4], Soundstripe [23] |
| **TikTok** | Une marque peut mettre dans son fichier une musique qu'elle a licenciée elle-même, à condition de l'ajouter **avant** l'envoi. | [23] |
| **Instagram / Facebook** | La Meta Sound Collection compte plus de 14 000 titres et sons libres de droits, utilisables même pour des pubs. La licence ne couvre **que les produits Meta** : pas TikTok, pas YouTube. | Instagram Help [7], [8] |
| **Instagram** | La bibliothèque musicale principale est réservée à l'usage personnel ; les comptes entreprise sont limités à la Sound Collection. | [8] |
| **YouTube** | Musique de l'Audio Library : « copyright-safe », monétisable dans le Programme Partenaire ; titres CC : créditer l'artiste dans la description. La page d'aide **ne dit pas** si on peut s'en servir hors de YouTube. | Google [24] |

**Conséquence pour cm.chapote.fr :** on n'utilise **ni les sons tendance ni les bibliothèques intégrées aux applis**. cm envoie un seul MP4 vers 3 plateformes, et l'API ne choisit aucun son dans l'appli. La musique est donc **mixée dans le fichier**, avec une licence valable hors plateforme : CC0, Pixabay, ou CC BY avec crédit. Si un format « son tendance » devient utile plus tard, il ne pourra se faire qu'à la main dans l'appli TikTok, en choisissant dans la Commercial Music Library. On l'écarte ici.

### 2.2 Sources libres utilisables commercialement

| Source | Contenu | Licence exacte | Crédit | Téléchargement auto | Remarques |
|---|---|---|---|---|---|
| **Pixabay Music** — https://pixabay.com/music/ | musique et effets | Pixabay Content License : usage commercial ou non, droit irrévocable, mondial, sans redevance [25] | non requis [25] | **pas d'API audio officielle** (l'API ne sert qu'images et vidéos [26]) : choix à la main, puis fichiers rangés dans le dépôt | Des titres peuvent déclencher un Content ID sur YouTube, qu'on lève en montrant la licence [27]. Revente du fichier seul interdite [25]. |
| **Incompetech (Kevin MacLeod)** — https://incompetech.com/music/royalty-free/ | musique | CC BY 4.0 [28] | **oui** : « Titre » Kevin MacLeod (incompetech.com), CC BY 4.0, ou licence payante sans crédit [28][29] | fichiers directs, triables par tempo et ambiance sur le site | Très connu, donc moins original. Crédit à mettre dans la légende ou la description. |
| **Free Music Archive** — https://freemusicarchive.org/ | musique | par titre : CC0, CC BY, CC BY-SA permettent l'usage commercial ; **NC et ND exclus** [30] | selon la licence | API annoncée fermée (charge serveur) [30] | Vérifier la licence sur la page de chaque titre. |
| **YouTube Audio Library** — Studio > Bibliothèque audio | musique et effets | « copyright-safe » ; titres « Attribution non requise » ou CC [24] | CC : oui | non (Studio seulement) | Usage hors YouTube non garanti par Google [24][31] : **à éviter** pour une vidéo envoyée aussi sur TikTok et Instagram. |
| **Uppbeat** — https://uppbeat.io/ | musique et effets | l'offre gratuite vise les créateurs individuels ; **une entreprise ou une pub demande une offre payante (Business)** [32] | crédit unique par téléchargement | non | À écarter tant qu'on ne paie pas. |
| **BigSoundBank** — https://bigsoundbank.com/droit.html | ~3 600 effets et ambiances | CC0 1.0 + WTFPL + domaine public, usage commercial « sans restriction, sans demander la permission » [34] | non requis | oui (déjà utilisé : `scripts/sons.py`) | Vérifier la licence affichée sur la page de chaque son [34]. |
| **Kenney — Interface Sounds / UI Audio** — https://kenney.nl/assets/interface-sounds, https://kenney.nl/assets/ui-audio | 100 + 50 sons d'interface (clics, boutons, interrupteurs) | CC0 [35] | non | zip direct | **Idéal pour les clics de démo d'appli.** Volume déjà normalisé [35]. |
| **Freesound** — https://freesound.org/ | effets de toutes sortes | par son ; filtrer `license:"Creative Commons 0"` [36] | non pour CC0 (CC BY : oui) | API : aperçus MP3/OGG sans OAuth, **fichiers originaux avec OAuth2**, 500 téléchargements par jour [36] | Garder une trace du `license` de chaque son téléchargé. |
| **Sonniss GDC Game Audio Bundle** — https://sonniss.com/gdcbundle | dizaines de Go d'effets pro (whooshs, impacts, interfaces) | sans redevance, usage commercial, **sans crédit** ; interdit depuis 2024 : entraîner une IA, revendiquer les sons comme siens [37] | non | archive torrent ou directe, une fois par an | Lire la licence de l'édition téléchargée [37]. |
| **Mixkit SFX** — https://mixkit.co/free-sound-effects/ | effets | licence « Free » : commerciale, sans crédit ; une licence « Restricted » existe (personnel seulement) [38] | non | non | Vérifier la licence de chaque fichier [38]. |
| **ElevenLabs Sound Effects (API)** — https://elevenlabs.io/sound-effects-terms | effets générés à partir d'un texte | **offre payante : usage commercial sans redevance, y compris réseaux sociaux et pub** ; offre gratuite : non commercial [33] | non | **oui, API** (clé `ELEVENLABS_API_KEY` déjà présente) | Interdit de revendre les sons générés comme une banque [33]. Pratique pour un riser ou un « ding » de marque sur mesure. |
| ~~BBC Sound Effects~~ | 33 000 effets | RemArc : personnel, éducatif, recherche seulement [39] | oui | — | **Interdit** pour une promo commerciale. |
| ~~Meta Sound Collection~~, ~~CML TikTok~~ | — | limitées à leur plateforme [3][7] | — | — | Pas pour un fichier multiplateforme. |

**Pratique de traçabilité (pratique) :** pour chaque fichier audio utilisé, garder `{source, url, auteur, licence, date}` dans un `licences.json` à côté de la vidéo (ou dans `public/sons/`). Avec Pixabay, on peut avoir à **prouver** la licence en cas de réclamation Content ID [27].

---

## 3. Musique : quel tempo et quel style selon le type de vidéo

### 3.1 Ce que dit la recherche sur le tempo

- **Bandes de tempo** utilisées en recherche : lent 40–76 BPM, modéré 77–107 BPM, rapide 108–208 BPM [17]. Une musique de fond rapide fait monter l'excitation (*arousal*), et avec elle la recherche de variété chez le consommateur [17].
- *Journal of Advertising Research*, décembre 2025 : 26 025 vraies publicités vidéo et 3 expériences [18].
  - L'effet du tempo **n'apparaît qu'une fois la musique assez rapide**.
  - Il passe par une **sensation de manque de temps et un traitement rapide, par raccourcis**, pas par l'excitation.
  - **Un tempo rapide fait nettement monter l'intention d'achat pour les pubs « promotion »** (gagner, obtenir), et n'a aucun effet pour les pubs « prévention » (éviter une perte).
  - → Le message de Chapote CM (« gratuit, planifie tout en un clic, gagne du temps ») est un message de **promotion** : la musique rapide est justifiée. Pour un message de type « évite de rater tes publications », l'effet du tempo serait nul.
- Les seuils exacts de l'étude JAR n'étaient pas accessibles (article réservé aux membres) : la plage 110–128 BPM ci-dessous **s'appuie sur la bande « rapide » ≥ 108 BPM de [17]**. Le haut de la plage est un choix **(pratique)**, pour garder une voix intelligible.

### 3.2 Recommandations par type de vidéo

| Type de vidéo Chapote CM | Énergie | BPM | Style (instrumental, sans voix chantée) | Structure musicale | Niveau sous la voix |
|---|---|---|---|---|---|
| **Hook rapide / pub 15-25 s** (« Publie sur TikTok, YouTube et Insta en un clic ») | haute | **118–128** (bande rapide [17][18]) | électro-pop, future bass légère, house « corporate » énergique, drums trap légers (pratique) | **départ direct sur le drop** (pas d'intro lente), riser + impact sur la révélation du produit, coupure nette (stop) avant le CTA | −18 dB (la voix doit rester devant même à fort tempo) |
| **Tuto / démo d'écran 30-60 s** (« Comment programmer une vidéo ») | moyenne-haute, régulière | **100–115** (haut de « modéré » / bas de « rapide » [17]) | lo-fi house, pop électronique minimaliste, beats « tech » avec peu de mélodie (pratique) | boucle stable de 8 ou 16 mesures, peu de changements pour ne pas distraire de l'interface | −20 à −22 dB (beaucoup d'informations à l'écran) |
| **Liste / astuces** (« 3 erreurs… ») | moyenne-haute | **105–120** | hip-hop instrumental, pop électro (pratique) | une montée (*build*) ou un « tick » à chaque numéro | −18 à −20 dB |
| **Émotion fondateur** (« Pourquoi j'ai créé Chapote ») | basse puis montante | **70–95** (lent à modéré [17]) | piano + nappes, *ambient* cinématique, guitare acoustique (pratique) | départ calme, **montée vers la fin** (percussions qui entrent au moment de la solution), résolution sur le logo | −20 à −25 dB [11] (voix intime) |
| **Annonce / nouveauté** | haute | **120–130** | électro « produit », bruits glitch (pratique) | compte à rebours sonore, impact sur le nom de la fonction | −18 dB |

**Critères de choix d'un morceau (pratique) :**
- **Pas de voix chantée** : elle entre en conflit avec la voix off. La musique instrumentale est aussi celle qui aide le plus à retenir la marque [9].
- **Peu de contenu dans 1–4 kHz** (la zone où la parole devient intelligible), ou bien creuser cette zone par égalisation (§5.3).
- **BPM connu** (indiqué par la source, ou mesuré par librosa, §6.4) pour caler les coupes.
- Un **point fort** (drop, impact) dans les 0–3 s, ou un morceau qu'on peut faire commencer à ce point (`trimBefore`, §6.1).
- Durée ≥ vidéo, ou une boucle propre (`loop`).
- Varier : prévoir un **petit catalogue de 15 à 30 titres étiquetés** (`energie`, `bpm`, `type`, `licence`) et en tirer un au hasard par vidéo, sans répéter les N dernières (pratique ; c'est le même principe que les tests A/B du dépôt).

---

## 4. Catalogue d'effets sonores par moment de la vidéo

Principe **(pratique)** : un effet doit **correspondre à quelque chose de visible** (un mouvement, une apparition, un clic). Un effet sans rien à l'écran sonne comme du bruit. Le constat actuel (« un whoosh ou un pop à chaque plan, sans énergie ») s'explique en partie : **un seul type d'effet, toujours au même niveau, sans musique pour le porter**. Il faut **varier** les familles et **hiérarchiser** les niveaux.

| Moment | Effet | Placement exact | Niveau indicatif (sous la voix) | Durée | Source conseillée |
|---|---|---|---|---|---|
| **0 s, hook** | **impact** grave (*boom*, *hit*) + début de la musique sur son temps fort | image 0 (pas de silence au début) | −6 à −10 dB (c'est le pic de la vidéo) | 0,5–1,5 s | Sonniss, Freesound CC0, ElevenLabs |
| **Montée vers une révélation** (avant d'afficher le produit ou un chiffre) | **riser** (montée de bruit ou de note) | se termine **pile** sur l'image de révélation | monte de −30 à −12 dB | 1–2 s, **1 ou 2 fois par vidéo maximum** | Sonniss, ElevenLabs (« riser 2 s ») |
| **Révélation** | **impact** ou **sub-drop** court | même image que la fin du riser | −8 à −12 dB | 0,3–1 s | Sonniss |
| **Transition entre deux plans** (glissement, zoom) | **whoosh / swoosh** | le **milieu** du whoosh sur l'image de coupe ; durée = durée du mouvement | −14 à −18 dB | 0,2–0,6 s | BigSoundBank, Kenney, Sonniss |
| **Apparition d'un texte, d'une icône ou d'un logo de plateforme** | **pop** court, **tick** | sur l'image où l'élément atteint sa taille | −16 à −20 dB | < 0,2 s | Kenney UI Audio |
| **Clic dans l'interface** (capture réelle de cm.chapote.fr) | **clic** souris ou tactile | **sur l'image où le bouton change d'état** | −14 à −18 dB | < 0,1 s | Kenney Interface Sounds |
| **Saisie** (titre de la vidéo, légende) | **clavier** (frappe douce) | pendant que le texte s'écrit, une frappe tous les 2-3 caractères | −20 à −24 dB | variable | Freesound CC0, BigSoundBank |
| **Confirmation** (« Programmée ! », publication réussie) | **ding** / carillon de notification, *success chime* | sur l'apparition de la coche | −12 à −16 dB | 0,3–0,8 s | Kenney, ElevenLabs (« son de marque » maison) |
| **Notifications qui s'empilent** (vues, likes) | série de **pops** à hauteur croissante | un par notification | −18 dB | court | Kenney ; varier la hauteur (`playbackRate`, §6.1) |
| **Problème / douleur** (« 3 applis, 3 envois… ») | **glitch**, *error buzz*, disque rayé, **coupure de musique** | sur l'image du problème | −14 dB | 0,2–0,5 s | Freesound CC0, Sonniss |
| **Chiffre-clé** (« 0 € », « 3 plateformes ») | impact léger + **arrêt** de la musique 1 temps | sur l'apparition du chiffre | −12 dB | — | — |
| **CTA final** (« Essaie gratuitement : cm.chapote.fr ») | musique qui revient ou se résout + **ding de marque** | sur l'apparition de l'URL | −12 dB | — | même son à chaque vidéo = **signature sonore** |
| **Fin / boucle** | dernière note de musique **raccord** avec la 1ʳᵉ image | dernières 0,5 s | — | — | cf. boucle : finir sur un temps |

**Règles de densité (pratique) :**
- **Pas plus d'un effet « fort »** (impact, riser) toutes les 3 à 5 s ; les effets d'interface (clic, pop) peuvent être plus fréquents.
- **Jamais un effet sur un mot important de la voix** : décaler de 1 à 2 images, ou baisser l'effet de 6 dB.
- **Varier** chaque famille avec 3 à 5 fichiers tirés au hasard, plus ±5 % de `playbackRate`, pour éviter l'effet « même son collé partout ».
- **Un « son de marque »** (ding ou court motif de 3 notes) réutilisé sur chaque CTA de Chapote CM : à la longue, il devient une **signature sonore**.
- Les **silences** sont des effets : couper la musique 1 temps avant un mot clé, puis la relancer sur un impact. C'est le contraste le plus efficace avec une voix TTS **(pratique)**.

---

## 5. Règles de mixage chiffrées

### 5.1 Niveaux relatifs

| Élément | Règle | Source |
|---|---|---|
| Voix | référence ; « autour de −12 à −10 dB de moyenne, crêtes vers −6 dB » sur le vumètre de l'éditeur | Adorama / Soundstripe [10][11] |
| Musique **pendant la voix** | **−18 à −22 dB sous la voix** [10] ; ou −18 à −25 dB [11] | [10][11] |
| Musique **sans voix** (intro, respirations, fin) | remontée **vers −10 dB** | [11] |
| Profondeur du ducking automatique | **−12 dB = discret, −18 dB = marqué** ; Premiere propose −18 dB par défaut | [12] |
| Release du ducking | **long**, pour que la musique ne « pompe » pas entre les mots | Apple Logic [40] |
| Limite des règles fixes | aucun chiffre ne remplace l'écoute : à valider à l'oreille, au téléphone | Creative Cow, invideo [41] |

**Réglage proposé pour Chapote CM** (synthèse des sources ci-dessus) :
- voix normalisée seule vers **−16 LUFS** (elle sera remontée par la normalisation finale) ;
- musique (*bed*) à **−20 dB sous la voix** pendant la parole (gain ≈ 0,10 si le morceau est déjà normalisé au même niveau que la voix), **−10 dB** hors parole (gain ≈ 0,32) ;
- transitions de ducking : **attaque 80–150 ms, retour 300–600 ms** (pratique), et **pas de remontée** dans les silences de moins de 400 ms entre deux phrases (sinon ça pompe [40]) ;
- effets selon le tableau du §4 ;
- bus final : limiteur + loudnorm (§5.2).

### 5.2 Loudness cible à la sortie

| Plateforme | Cible la plus citée | Statut |
|---|---|---|
| Instagram Reels | −14 LUFS intégrés, −1 dBTP, LRA 5–8 LU | blogs et outils seulement [13][14] |
| TikTok | −14 LUFS, −1 dBTP | blogs [13][14] ; d'autres disent −16 LUFS [15] |
| YouTube (Shorts compris) | −14 LUFS : **jamais documenté officiellement par YouTube** ; un fichier plus fort est baissé, un plus faible n'est pas remonté | [42][43] ; « Stats for nerds » montre l'écart (« content loudness ») [44] |

**Recommandation :** sortie à **−14 LUFS intégrés, true peak ≤ −1 dBTP** (c'est déjà la règle du dépôt pour ghost-hands : −14 LUFS). Un fichier plus fort que la cible est simplement baissé par la plateforme : mixer plus fort n'apporte rien, et le limiteur écrase les dynamiques [13][43]. Un fichier plus faible n'est pas remonté sur YouTube [42] : **ne pas livrer sous −16 LUFS**.

⚠️ Le filtre `loudnorm` de ffmpeg vise par défaut **I = −24, TP = −2, LRA = 7** [45] : il faut **toujours** passer les valeurs (§6.3).

### 5.3 Égalisation et propreté (pratique)

- Musique : coupe-haut doux au-dessus de ~16 kHz, coupe-bas sous ~40 Hz ; creux de −2 à −4 dB vers 2–4 kHz pendant la voix (ou ducking seulement si le morceau est déjà discret dans cette zone).
- Voix TTS : coupe-bas vers 80 Hz ; compression légère. Les voix Qwen/ElevenLabs sont déjà propres : pas de débruitage.
- Mono-compatibilité : écoute sur un haut-parleur de téléphone (mono, peu de graves). Les impacts doivent garder un médium audible, pas seulement du sub.

---

## 6. Implémentation

Pipeline proposé (pratique) :
1. TTS → `voix.wav` + mots horodatés (déjà produits par `scripts/tts.py`).
2. Choix de la musique dans le catalogue étiqueté (`bpm`, `energie`, `licence`).
3. `beats.json` (librosa) → caler les coupes et les apparitions sur les temps (§6.4).
4. Remotion : `<Audio>` pour la voix, la musique avec un ducking calculé à partir des mots, et les effets placés par plan.
5. Rendu → ffmpeg `loudnorm` en 2 passes (−14 LUFS, −1 dBTP).
   *Variante :* rendre la vidéo sans musique et faire musique + ducking + loudnorm dans ffmpeg (§6.3). Le ducking par compresseur sidechain sonne plus naturel ; la version Remotion se contrôle à l'image près.

### 6.1 Remotion : volume par image, ducking, effets

Ce que disent les docs officielles :
- `Audio` s'importe depuis **`@remotion/media`** ; `volume` va de 0 à 1 (1 par défaut) [46].
- Pour animer le volume, il faut calculer un **nombre** avec `useCurrentFrame()` + `interpolate()`, écrit directement dans la prop. La forme fonction `(f) => number` **n'est plus recommandée** [46][47].
- Dans le Studio, le volume est limité à 1 (le navigateur ne peut pas amplifier) [47].
- `trimBefore` / `trimAfter` sont en images ; `loop` répète la plage gardée [48] ; `trimAfter` est marqué déprécié sur la page de l'API, au profit de `durationInFrames` [49].
- `playbackRate` existe (lecture à l'envers impossible) ; `toneFrequency` change la hauteur mais ne s'anime pas [49].

```tsx
// src/lib/son/BandeSon.tsx — esquisse (pratique), d'après l'API de [46][48][49]
import {Audio} from '@remotion/media';
import {Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';

const dB = (x: number) => Math.pow(10, x / 20); // −20 dB → 0.1, −10 dB → 0.316

type Mot = {start: number; end: number}; // secondes (sortie de tts.py)
type Sfx = {fichier: string; t: number; gainDb: number; rate?: number};

// Regroupe les mots en « zones de parole » : un trou < 0,4 s ne fait pas remonter la musique.
function zonesParole(mots: Mot[], trouMin = 0.4): [number, number][] {
  const z: [number, number][] = [];
  for (const m of mots) {
    const der = z[z.length - 1];
    if (der && m.start - der[1] < trouMin) der[1] = m.end;
    else z.push([m.start, m.end]);
  }
  return z;
}

// Gain de la musique à l'instant t : −20 dB sous la voix, −10 dB hors voix,
// attaque 0,12 s avant le premier mot, retour 0,5 s après le dernier.
function gainMusique(t: number, zones: [number, number][], hautDb = -10, basDb = -20) {
  const ATT = 0.12, REL = 0.5;
  let duck = 0; // 0 = haut, 1 = baissé
  for (const [a, b] of zones) {
    if (t >= a - ATT && t <= b + REL) {
      const entree = interpolate(t, [a - ATT, a], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      const sortie = interpolate(t, [b, b + REL], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      duck = Math.max(duck, Math.min(entree, sortie));
    }
  }
  return dB(hautDb + (basDb - hautDb) * duck);
}

export const BandeSon: React.FC<{
  voix: string; mots: Mot[];
  musique: string; debutMusique?: number; // s : commencer sur le drop
  sfx: Sfx[];
}> = ({voix, mots, musique, debutMusique = 0, sfx}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const t = frame / fps;
  const zones = zonesParole(mots);
  // fondu de sortie de la musique sur la dernière seconde
  const fin = interpolate(frame, [durationInFrames - fps, durationInFrames], [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <>
      <Audio src={staticFile(voix)} volume={1} />
      <Audio
        src={staticFile(musique)}
        trimBefore={Math.round(debutMusique * fps)}
        loop
        volume={gainMusique(t, zones) * fin}
      />
      {sfx.map((s, i) => (
        <Sequence key={i} from={Math.round(s.t * fps)} durationInFrames={3 * fps} layout="none">
          <Audio src={staticFile(s.fichier)} volume={dB(s.gainDb)} playbackRate={s.rate ?? 1} />
        </Sequence>
      ))}
    </>
  );
};
```

Notes :
- Le calcul se fait **par image** (30 ou 60 fois par seconde), assez fin pour un ducking.
- L'**effet audio du whoosh** démarre **avant** la coupe : `t = tCoupe − duréeWhoosh/2`.
- Un riser : `t = tRévélation − duréeRiser` (sa fin tombe pile sur l'image de révélation).
- Pour un son de marque plus aigu sans changer sa durée : `toneFrequency` fixe [49] ; pour varier les pops : `playbackRate` 0,95–1,05.
- Effets audio-réactifs (le logo qui « respire » sur les basses) : `useWindowedAudioData` + `visualizeAudio` de `@remotion/media-utils` donnent le spectre de chaque image [50]. Remotion n'a **pas de détection de temps** intégrée : on la calcule à part (§6.4).

### 6.2 Remotion : caler les coupes sur les temps

```ts
// beats.json = [0.000, 0.488, 0.977, ...] (secondes, cf. §6.4)
// Ramène une coupe prévue sur le temps le plus proche, à ±tol secondes près.
export function surLeTemps(t: number, beats: number[], tol = 0.12): number {
  let best = t, d = tol;
  for (const b of beats) { const e = Math.abs(b - t); if (e <= d) { d = e; best = b; } }
  return best;
}
// Sur les temps forts seulement (1 temps sur 4 en 4/4) pour les coupes importantes :
export const tempsForts = (beats: number[], offset = 0) => beats.filter((_, i) => (i - offset) % 4 === 0);
```

Règle d'usage **(pratique, cf. [22])** : les **coupes de plan** et les **apparitions fortes** se calent sur les temps (les impacts sur les temps forts) ; le **texte qui suit la voix** reste calé sur les mots. Ne pas couper à *chaque* temps : on obtient un rythme mécanique [22]. Si une coupe tombe au milieu d'un mot, c'est la voix qui gagne.

### 6.3 ffmpeg : ducking sidechain, mixage, loudness

Options officielles de `sidechaincompress` [45] : `threshold` (0,125 par défaut, linéaire : 0,125 ≈ −18 dBFS ; 0,05 ≈ −26 dBFS), `ratio` (2 par défaut, 1 à 20), `attack` (20 ms par défaut), `release` (250 ms par défaut, jusqu'à 9000), `makeup`, `knee`, `detection` (rms par défaut), `mix`. 1ʳᵉ entrée = le signal compressé (la musique), 2ᵉ entrée = la clé (la voix) [45].
Exemple d'un livre de recettes ffmpeg (non officiel) pour une voix off : `threshold=0.05:ratio=4:attack=200:release=1000` ; variante plus réactive : `threshold=0.02:ratio=8:attack=50:release=500` [51].

```bash
# 1) Musique ramenée vers −20 dB sous la voix au départ, puis baissée encore par la voix (sidechain),
#    effets mixés, sortie normalisée. (esquisse ; valeurs de [45][51] + niveaux du §5.1)
ffmpeg -i voix.wav -i musique.mp3 -i sfx_mix.wav -filter_complex "
 [0:a]aformat=sample_rates=48000:channel_layouts=stereo,highpass=f=80,asplit=2[vx][key];
 [1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=-10dB,
      highpass=f=40,lowpass=f=16000[mus];
 [mus][key]sidechaincompress=threshold=0.05:ratio=4:attack=120:release=600:knee=4[musduck];
 [vx][musduck][2:a]amix=inputs=3:duration=first:dropout_transition=0:weights='1 1 1':normalize=0,
      alimiter=limit=0.89:level=disabled[mix]" \
 -map "[mix]" -c:a pcm_s24le mix.wav
```
- `amix` normalise les entrées par défaut (le volume baisse quand on ajoute des pistes) : `normalize=0` garde les niveaux réglés [45]. La doc donne l'exemple voix + musique avec `weights="1 0.25":normalize=0` [45].
- `alimiter` : `limit=0.89` ≈ −1 dBFS ; `level` est activé par défaut et remonte le signal à 0 dB : le désactiver [45].

```bash
# 2) Loudness en 2 passes (EBU R128) : mesure puis correction linéaire. [45]
ffmpeg -i mix.wav -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2> mesure.txt
# lire input_i, input_tp, input_lra, input_thresh, target_offset dans le JSON, puis :
ffmpeg -i video_sans_son.mp4 -i mix.wav -map 0:v -map 1:a -c:v copy \
 -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=<input_i>:measured_TP=<input_tp>:measured_LRA=<input_lra>:measured_thresh=<input_thresh>:offset=<target_offset>:linear=true" \
 -ar 48000 -c:a aac -b:a 192k sortie.mp4
```
- `linear=true` ne marche que si les 4 mesures sont données, et si l'écart ne fait pas dépasser le TP. Sinon, loudnorm passe en mode dynamique [45].
- En mode dynamique, loudnorm suréchantillonne à 192 kHz : il faut **forcer `-ar 48000`** [45].
- LRA : 11 laisse respirer la voix et les impacts. Les blogs parlent de 5–8 LU pour Reels [14] ; c'est un réglage à essayer, sans règle fixe.

Contrôle automatique (à mettre dans le contrôle qualité de la vidéo) :
```bash
ffmpeg -i sortie.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -n 12   # I ≈ −14 LUFS, True peak ≤ −1 dBFS
```

### 6.4 Détection des temps (beat detection), en Python

librosa (doc officielle [52]) :
```python
import json, sys, librosa
y, sr = librosa.load(sys.argv[1], sr=None, mono=True)
onset_env = librosa.onset.onset_strength(y=y, sr=sr)
tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, units="time")
json.dump({"bpm": float(tempo), "beats": [round(float(b), 3) for b in beats]},
          open(sys.argv[2], "w"))
```
- `units="time"` donne directement les secondes [52] ; on peut passer `start_bpm` ou `bpm` si le BPM de la source est connu [52].
- Faire tourner ça **une fois par morceau du catalogue**, puis garder `beats.json` à côté du fichier.
- Le **premier temps fort** (le « 1 ») se repère au pic d'`onset_env` dans les 4 premiers temps (pratique), ou à la main une fois par morceau.

### 6.5 Téléchargement automatique des effets libres

- **Freesound** (CC0 seulement) : recherche `filter=license:"Creative Commons 0"`. Les originaux demandent OAuth2 ; sans OAuth on n'a que les aperçus MP3/OGG, suffisants pour des effets courts mais compressés. Limite : 500 téléchargements par jour [36]. Garder `license`, `username` et `url` de chaque son.
- **ElevenLabs Sound Effects** : génération par texte (« soft UI click », « whoosh 0.4s », « bright notification ding, brand jingle 3 notes ») avec la clé déjà présente. Commercial seulement sur une **offre payante** [33].
- **Kenney, Sonniss, BigSoundBank** : un téléchargement, une fois, puis un sous-ensemble choisi rangé dans `public/sons/` (BigSoundBank est déjà branché sur `scripts/sons.py`).
- **Musique Pixabay** : pas d'API audio [26]. Sélection manuelle d'un catalogue de 15 à 30 titres, ensuite tiré au sort par script.

---

## 7. Grille de notation du son (sur 10)

À remplir à l'écoute **au téléphone, haut-parleur puis écouteurs**, et par un agent pour la partie mesurable.

| # | Critère | Points | 0 | moitié | plein |
|---|---|---|---|---|---|
| 1 | **Loudness et propreté** (mesuré : `ebur128`) | 1 | hors de −16…−12 LUFS ou TP > −1 dBTP, ou saturation | dans la plage, TP limite | −14 ± 1 LUFS, TP ≤ −1 dBTP, pas de clic ni de coupure |
| 2 | **Voix intelligible** | 2 | des mots couverts par la musique ou un effet | compréhensible mais il faut tendre l'oreille | chaque mot net au haut-parleur du téléphone ; musique 18–22 dB sous la voix [10][11] |
| 3 | **Musique adaptée** (BPM et style pour le type de vidéo, §3.2) | 1,5 | pas de musique, ou à contre-emploi | correcte mais générique ou un peu lente | tempo dans la bande du §3.2, instrumentale, couleur juste |
| 4 | **Hook sonore (0–1 s)** | 1 | silence ou démarrage mou | musique dès 0 s | impact ou drop sur l'image 0, l'oreille est « prise » |
| 5 | **Ducking naturel** | 1 | pas de ducking, ou musique qui pompe entre les mots | ducking audible mais propre | invisible : la musique remonte dans les vraies pauses seulement |
| 6 | **Synchro image ↔ son** | 1,5 | coupes au hasard par rapport aux temps ; effets décalés | la plupart des coupes sur les temps | coupes fortes sur les temps forts, clic sur l'image du clic, riser qui finit pile sur la révélation |
| 7 | **Effets justes et variés** (§4) | 1 | un seul type d'effet répété, ou trop d'effets | 2–3 familles, densité correcte | chaque effet correspond à une action visible ; variation ; ≤ 1 effet fort toutes les 3–5 s |
| 8 | **Structure et fin** | 0,5 | musique coupée net à la fin | fondu | montée vers le CTA, son de marque, fin raccord pour la boucle |
| 9 | **Droits en règle** | 0,5 | source inconnue ou NC/BBC/son tendance | licence connue sans trace | `licences.json` complet, licence commerciale valable hors plateforme |
| | **Total** | **10** | | | |

Seuil proposé **(pratique)** : ≥ 7/10 pour publier ; le critère 2 (voix) et le critère 9 (droits) sont **éliminatoires** à 0.
Vidéo actuelle (voix + whoosh/pop, sans musique), estimée d'après la description : 1 (si −14 LUFS) + 2 + 0 + 0 + 0,5 (rien à ducker) + 0,5 + 0,5 + 0 + 0,5 ≈ **5/10**. C'est cohérent avec le constat « sans énergie ».

---

## 8. Plan d'action conseillé (ordre)

1. **Catalogue musique** : 15–30 instrumentaux Pixabay (et quelques CC BY d'Incompetech, avec crédit dans la légende), étiquetés `{bpm, energie, type_video, debut_drop, licence, url}`, avec un `beats.json` par titre.
2. **Banque d'effets** par famille (§4) : Kenney (interface), BigSoundBank et Sonniss (whooshs, impacts, risers), quelques sons ElevenLabs sur mesure (ding de marque).
3. **Composant `BandeSon`** (§6.1) : ducking calculé depuis les mots du TTS ; effets placés par le plan de montage (clic → image du clic, révélation → riser + impact).
4. **Coupes sur les temps** (§6.2) pour les changements de plan.
5. **Sortie** : `loudnorm` 2 passes à −14 LUFS / −1 dBTP, puis contrôle `ebur128` automatique.
6. **A/B** : (a) musique 110–120 vs 120–128 BPM sur les hooks ; (b) hook musique + effets seulement pendant 1,5 s puis voix, contre voix dès 0 s (piste VidMob [6]) ; (c) ducking −18 vs −22 dB.

---

## Sources

1. TikTok for Business, « Kantar report: How brands are making noise and driving impact with sound on TikTok » — https://ads.tiktok.com/business/en-US/blog/kantar-report-how-brands-are-making-noise-and-driving-impact-with-sound-on-tiktok
2. Social Media Today, « TikTok shares new insights into the importance of sound » — https://www.socialmediatoday.com/news/tiktok-shares-new-insights-into-the-importance-of-sound-for-marketing-promo/601569
3. TikTok Ads Help, « About the Commercial Music Library » — https://ads.tiktok.com/help/article?aid=10005905
4. TikTok Ads Help, « How to use the Commercial Music Library » — https://ads.tiktok.com/resources/help/article/how-to-use-the-commercial-music-library?lang=en
5. Voices.com, sondage sur le son activé par plateforme — https://www.voices.com/?p=21943
6. TikTok for Business (VidMob), « VidMob's data-driven insights to supercharge ad creative on TikTok » — https://ads.tiktok.com/business/es/blog/vidmobs-data-driven-insights-to-supercharge-ad-creative-on-tiktok (chiffres repris de l'extrait de recherche ; corps de page non relisible), et Entrepreneur, « How to Harness the Full Power of Audio for TikTok Ads » — https://www.entrepreneur.com/article/381435
7. Instagram Help, Sound Collection — https://help.instagram.com/ipad-app/402084904469945
8. Soundstripe, « Instagram Music Library: What's In It, What's Missing » — https://www.soundstripe.com/blogs/instagram-music-library ; Music Business Worldwide — https://musicbusinessworldwide.com/meta-offers-royalty-free-music-library-to-instagram-reels-advertisers
9. WARC, « TikTok: Insights on the effect of music in ads » (06/04/2022) — https://www.warc.com/content/feed/tiktok-insights-on-the-effect-of-music-in-ads/en-GB/6561
10. Adorama, « Mastering Audio Levels: A Filmmaker's Guide » — https://www.adorama.com/alc/mastering-audio-levels/
11. Soundstripe, « How to perfect your audio levels » — https://soundstripe.com/blogs/how-to-perfect-your-audio-levels
12. Freepik/Magnific, « How to use Auto Ducking in Premiere Pro » — https://www.freepik.com/blog/how-to-use-auto-ducking-in-premiere-pro-for-clean-professional-audio ; Corel VideoStudio, Audio ducking — https://help.corel.com/videostudio/v24/en/official-help/videostudio/h2-audio-ducking.html
13. DEV Community, « Mastering for Reels, TikTok and YouTube Shorts: the LUFS −14 standard » — https://dev.to/arthurvalle1_a2586dd2b4bc/mastering-for-reels-tiktok-and-youtube-shorts-the-lufs-14-standard-2ck5
14. « Instagram Reels Audio Optimization » — https://dj-master-web.vercel.app/en/blog/instagram-reels-audio-en ; Soundplate — https://soundplate.com/why-music-sounds-quiet-on-instagram-reels/
15. « Integrated Loudness −16 LUFS » (TikTok / Reels) — https://d1lex0gkhzvix9.cloudfront.net/tiktok-instagram-reels-loudness
16. Phys.org, Texas A&M, musique de fond dans les pubs — https://phys.org/news/2021-08-background-music-ads-affects-consumers.pdf
17. Frontiers in Psychology (2023), tempo de la musique de fond et recherche de variété — https://www.frontiersin.org/articles/10.3389/fpsyg.2023.1236006/full
18. Journal of Advertising Research (ARF), « When fast music makes ads more persuasive and when it doesn't » (déc. 2025) — https://thearf.org/access-knowledge-2/publications/journal-of-advertising-research/when-fast-music-makes-ads-more-persuasive-and-when-it-doesnt/
19. Exemples de chiffres « sound-on » des Reels sans source Meta : https://adamconnell.me/instagram-reels-statistics/ , https://www.teleprompter.com/blog/2025-instagram-reels-statistics
20. Étude du montage sur le temps / à contretemps (notice) — https://katalog.lib.cas.cz/KNAV/EdsRecord/edb,149872035
21. « Is there a "language of music-video clips"? » (arXiv 2108.00970) — https://arxiv.org/pdf/2108.00970
22. PremiumBeat (cut on the beat, rythme mécanique) — https://www.premiumbeat.com/blog/wp-json/wp/v2/posts/46125 ; CapCut, Montage rhythm — https://www.capcut.com/create/music-video-pacing-emotional-montage-rhythm
23. Soundstripe, « TikTok Music Licensing Rules for Creators and Brands » — https://www.soundstripe.com/blogs/tiktok-music-licensing-rules ; « Why can I only use commercial sounds » — https://www.soundstripe.com/blogs/why-can-i-only-use-commercial-sounds-on-tiktok
24. YouTube Help, « Use music and sound effects from the Audio Library » — https://support.google.com/youtube/answer/3376882
25. Pixabay, Content License Summary — https://pixabay.com/service/license-summary/ (version indexée : https://pixabay.com/id/service/license)
26. Pixabay API docs (images et vidéos seulement) — https://pixabay.com/api/docs/
27. Pixabay FAQ (Content ID) — https://pixabay.com/service/faq/
28. Incompetech FAQ (CC BY 4.0) — https://incompetech.com/music/royalty-free/faq.html
29. Wikipedia, Kevin MacLeod — https://en.wikipedia.org/wiki/Kevin_MacLeod ; licenseorg, Incompetech — https://licenseorg.com/guide/music-audio/incompetech
30. Soundstripe, « Creative Commons Music » — https://www.soundstripe.com/blogs/creative-commons-music ; Freedom251, FMA — https://freedom251.com/apps/free-music-archive/
31. licenseorg, YouTube Audio Library — https://licenseorg.com/guide/music-audio/youtube-audio-library
32. Uppbeat, Help center Premium & Business — https://uppbeat.io/help-center/premium-and-business ; tarifs — https://uppbeat.io/pricing
33. ElevenLabs, Sound Effects Terms — https://elevenlabs.io/sound-effects-terms ; FAQ publication — https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform/llms.txt
34. BigSoundBank, droits d'utilisation — https://bigsoundbank.com/droit.html
35. Kenney, Interface Sounds — https://kenney.nl/assets/interface-sounds ; UI Audio — https://kenney.nl/assets/ui-audio
36. Freesound API (forum : OAuth, limite, filtre de licence) — https://groups.google.com/g/freesound-api/c/8qQyjHQ8H4g , https://groups.google.com/g/freesound-api/c/ItYWNO1i9iI ; conditions de l'API — https://freesound.org/help/tos_api
37. Sonniss GDC bundle : Bedroom Producers Blog — https://bedroomproducersblog.com/2026/03/16/sonniss-gdc-2026-bundle/ ; GameFromScratch (restriction IA 2024) — https://gamefromscratch.com/?p=28664 ; licence — https://sonniss.com/gdc-bundle-license
38. Mixkit, Terms — https://mixkit.co/terms/
39. MusicRadar, BBC Sound Effects (RemArc) — https://musicradar.com/news/free-bbc-sound-effect-samples
40. Apple, Logic Pro (sidechain, release) — https://help.apple.com/logicpro/mac/9.1.6/en/logicpro/effects/chapter_4_section_5.html
41. invideo, « Automatically lower background music under dialogue » — https://invideo.io/blog/automatically-lower-background-music-under-dialogue-with-ai/ ; Creative Cow — https://creativecow.net/?p=2139815
42. Videvo (YouTube −14 LUFS non documenté) — https://videvo.net/blog/?p=40770 ; Wikipedia, Audio normalization — https://en.wikipedia.org/wiki/Audio_normalization
43. Production Advice, YouTube loudness — https://productionadvice.co.uk/youtube-loudness/ ; Sweetwater — https://www.sweetwater.com/insync/how-to-master-audio-for-youtube/
44. Production Advice, « Stats for nerds » — https://productionadvice.co.uk/stats-for-nerds/
45. FFmpeg Filters Documentation (sidechaincompress, loudnorm, amix, alimiter, ebur128) — https://ffmpeg.org/ffmpeg-filters.html
46. Remotion, « Controlling volume and muting » — https://www.remotion.dev/docs/audio/volume
47. Remotion, `<Html5Audio>` / anciennes docs audio (callback de volume, limite de 1 dans le Studio) — https://www.remotion.dev/docs/html5-audio , https://v4.remotion.dev/docs/using-audio
48. Remotion, Timing and trimming — https://www.remotion.dev/docs/timing ; https://remotion.dev/docs/audio/trimming
49. Remotion, `<Audio>` de `@remotion/media` — https://www.remotion.dev/docs/media/audio
50. Remotion, Audio visualization / visualizeAudio / useWindowedAudioData — https://www.remotion.dev/docs/audio/visualization , https://www.remotion.dev/docs/visualize-audio , https://www.remotion.dev/docs/use-windowed-audio-data
51. FFmpeg Cookbook, Audio ducking (non officiel) — https://ffmpeg-cookbook.pages.dev/en/articles/audio-ducking/ ; ffmpeg-user (sidechaincompress) — https://ffmpeg.org/pipermail/ffmpeg-user/2018-August/040933.html
52. librosa, `beat_track` et tutoriel rythme — https://librosa.org/doc/main/generated/librosa.beat.beat_track.html , https://librosa.org/doc/dev/auto_tutorials/01-intro/06-rhythm.html
