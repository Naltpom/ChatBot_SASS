# 04 — Voix off et écriture de script avec du peps (Chapote CM)

> Recherche n° 4 sur 10. Périmètre : **le texte dit à voix haute et la voix qui le dit** (écriture pour l'oreille, débit, intonation, réglages TTS, post-traitement, mixage). Le visuel, le montage, les hooks visuels et la stratégie de publication sont traités ailleurs.
>
> Convention de fiabilité :
> - **[source]** : chiffre ou consigne trouvé dans une source citée en fin de document ;
> - **[mesuré]** : mesuré par moi dans ce bac à sable (ffmpeg 6.1 sur une voix de référence du dépôt) ;
> - **[pratique]** : consensus de praticiens (blogs, outils) sans étude derrière ;
> - **[à tester]** : ma recommandation de départ, à valider à l'écoute ou en A/B. Aucun chiffre n'a été inventé : quand je n'ai pas trouvé de source, je le dis.

---

## 0. Diagnostic en une page : pourquoi « la voix c'est bien mais ça manque de peps »

Trois causes s'additionnent, presque jamais une seule :

1. **Le texte est écrit pour l'œil.** Phrases complètes, subordonnées, ton de plaquette (« Chapote CM est une solution qui permet de… »). Une TTS lit fidèlement : un texte plat donne une voix plate. ElevenLabs le dit pour v3 : la structure du texte influence fortement le rendu ; il faut des tournures orales, de la ponctuation et un contexte émotionnel clair **[source : ElevenLabs, Prompting v3]**.
2. **La voix de référence est calme.** Qwen3-TTS en clonage par « in-context learning » (avec `ref_text`) **garde mieux la prosodie** de la référence que le clonage par simple empreinte (x-vector) **[source : rapport technique Qwen3-TTS, §4]**. Le modèle reproduit donc l'énergie de la référence : une référence « livre audio » donne un livre audio, quel que soit le texte.
3. **Pas de traitement « broadcast ».** Une voix brute de TTS n'est ni compressée, ni éclairée dans les aigus de présence, ni mise au niveau des plateformes. À côté d'un créateur traité (compresseur, EQ, -14 LUFS), elle paraît lointaine et molle.

Dans le dépôt (pour info, sans rien modifier) : le serveur utilise `Qwen/Qwen3-TTS-12Hz-0.6B-Base` (clonage, **pas d'instructions de style** sur ce modèle) avec les réglages d'échantillonnage par défaut ; `tts.py` fait déjà `silenceremove` + `atempo` (tempo 1 par défaut pour les moteurs locaux) ; les fiches de voix mesurent déjà débit (`mots_s`) et intonation (`intonation_demi_tons`) — c'est la bonne base pour choisir une voix énergique (§5).

---

## 1. Écrire pour l'oreille : 14 règles, avec avant/après sur Chapote CM

Principes de base de l'écriture radio/broadcast : écrire comme on parle, phrases courtes et digestes, voix active, présent, l'info importante d'abord, pas de point-virgule, lire à voix haute pour vérifier le rythme **[source : UF/IFAS WC193 ; Human Kinetics ; Press Gazette ; LibreTexts « Writing for the ear »]**. Les règles ci-dessous les adaptent à la vidéo courte et à la TTS.

### R1. Une idée par phrase, 4 à 10 mots en moyenne
Une étude sur 3 931 TED Talks associe l'engagement à des phrases d'environ **8 mots** **[source : Electronic Commerce Research, 2026, résumé]** (contexte TED, pas vidéo courte : à prendre comme ordre de grandeur). Alterner très court (1-3 mots) et moyen (8-12) crée le rythme.

- Avant : « Chapote CM est un outil gratuit qui vous permet de planifier vos vidéos courtes sur TikTok, YouTube Shorts et Instagram Reels depuis une seule interface. » (25 mots, une respiration impossible)
- Après : « Une vidéo. Trois réseaux. Zéro copier-coller. Tu la planifies une fois sur Chapote CM… et elle part sur TikTok, Shorts et Reels. »

### R2. Tutoiement, et un seul interlocuteur
Les comédiens voix obtiennent la sincérité en parlant à **une seule personne** ; le style « annonceur » ne doit pas être le style par défaut **[source : Voices.com, conversational read]**. En français sur TikTok/Reels, « tu » sonne natif ; « vous » sonne pub ou institution **[pratique]**.
- Avant : « Les créateurs de contenu peuvent gagner du temps. »
- Après : « Toi, tu postes la même vidéo trois fois. Chaque semaine. »

### R3. Ouvrir sur le conflit, pas sur la marque
Le message principal dans les 3 premières secondes, le hook dans les 6 premières **[source : TikTok Ads, Creative best practices]**. Le nom « Chapote CM » ne doit pas être le premier mot : d'abord la douleur, ensuite la solution **[pratique]**.
- Avant : « Découvrez Chapote CM, l'outil de planification… »
- Après : « Arrête de publier tes vidéos à la main. Sérieusement. »

### R4. Questions qui forcent une réponse mentale
Une question fermée ou piquante relance l'intonation (montée de la voix, puis chute sur la réponse). Elle donne aussi à la TTS un contour mélodique qu'une affirmation n'a pas **[pratique]**.
- « Combien de temps tu perds à reposter la même vidéo ? Dix minutes ? Vingt ? »

### R5. Open loops : promettre, retenir, payer
Une boucle ouverte est une question ou une idée non résolue que le cerveau veut voir fermée ; on peut en empiler, la première ouverte étant la dernière fermée **[pratique : Tokcount, Socialync, Cursa]**. Règle d'or : **toujours payer** la boucle avant la fin, sinon c'est du clickbait.
- « Il y a un réglage que presque personne n'active… on y revient dans 10 secondes. » → payé à 0:20.

### R6. Ruptures (pattern interrupts) toutes les 3-6 secondes
Un changement inattendu (son, image, ton) casse le pilotage automatique du spectateur ; les praticiens visent 1 à 3 s pour TikTok **[pratique : CapCut, Opus]** — aucune donnée publiée de plateforme ne le prouve. À l'oral : changement de registre (chuchoté → franc), phrase d'un mot, interjection (« Bon. », « Attends. »), chiffre qui tombe.
- « … et là, tu fais ça à la main. Trois fois. *[pause]* Non. »

### R7. Verbes d'action, présent, impératif
Le présent et la voix active sont la base du broadcast **[source : Human Kinetics, Press Gazette]**. L'impératif ajoute de l'énergie.
- Avant : « La programmation pourra être effectuée en quelques clics. »
- Après : « Tu choisis l'heure. Tu cliques. C'est parti. »

### R8. Chiffres concrets et contrastes
« Trois réseaux, une seule fois » > « plusieurs plateformes ». Les contrastes binaires (avant/après, toi/eux, 20 minutes/20 secondes) donnent naturellement deux intonations opposées. Ne jamais inventer de chiffre sur le produit : utiliser des faits vérifiables (gratuit, français, TikTok + Shorts + Reels).

### R9. Mots à l'oral, pas à l'écrit
Bannir : « permet de », « afin de », « solution », « en effet », « ainsi », « notamment », « optimiser », « fonctionnalité ». Préférer : « ça », « hop », « bref », « en vrai », « genre » (avec modération), « franchement ». Le « ne » de négation peut sauter dans les répliques familières (« t'as pas besoin ») **[pratique]** ; attention, la TTS prononce mal certaines élisions : tester « t'as » vs « tu as ».

### R10. Ponctuation = partition pour la TTS
- Points : chute et respiration. Mettre un point là où l'on veut une **chute franche** d'intonation.
- Points de suspension : pause et poids ; tirets : interruption ; MAJUSCULES : emphase **[source : ElevenLabs, Prompting]**.
- Point d'exclamation : avec Qwen3, souvent peu d'effet, parfois un cri. À doser : 1 à 2 par script **[à tester]**.
- Virgules : ne pas en abuser ; chaque virgule ralentit.
- Pour Qwen3 (et ElevenLabs v3/v4, qui n'acceptent pas les balises SSML `<break>`) : pauses par la ponctuation et, dans ce dépôt, par `{pause 0.4}` inséré après coup **[source : ElevenLabs ; code de tts.py]**.

### R11. Lire comme on sourit
Le sourire s'entend, il relève la voix et aide l'articulation ; le dosage dépend du sujet **[source : Voices.com podcasts ; idratherbewriting]**. Côté TTS, ça se traduit par : référence enregistrée en souriant (§5), balise `[excited]`/`[cheerfully]` côté ElevenLabs, et texte qui contient des marqueurs de bonne humeur (« Bonne nouvelle : », « Et le meilleur ? »).

### R12. Démarrer haut, finir plus bas
Pour une lecture commerciale : commencer légèrement plus haut, puis laisser la voix redescendre **[source : Such A Voice]**. Écrire le hook comme une phrase courte et montante (question, exclamation) et la conclusion comme une affirmation qui tombe (point).

### R13. CTA unique, concret, en verbe
Terminer par un CTA clair **[source : TikTok Ads]**. Un seul : « Teste Chapote CM, c'est gratuit. Lien en bio. » Pas trois CTA à la suite.

### R14. Le test du souffle
Lire le script à voix haute à la vitesse cible ; toute phrase qui ne se dit pas en une respiration est coupée en deux **[source : UF/IFAS « read the story aloud »]**. Automatisable : alerte si une phrase dépasse 14 mots ou 2,5 s d'audio **[à tester]**.

### Exemple complet avant/après (≈ 20 s)

**Avant (sage)** :
> « Vous êtes créateur de contenu et vous publiez sur plusieurs réseaux sociaux ? Chapote CM est un outil français et gratuit qui vous permet de planifier vos vidéos courtes sur TikTok, YouTube Shorts et Instagram Reels. Gagnez du temps et concentrez-vous sur l'essentiel : la création. Essayez-le dès maintenant. »

**Après (avec du peps)** :
> « Tu postes encore ta vidéo trois fois ? … À la main ?
> Arrête. Tout de suite.
> Sur Chapote CM, tu la déposes UNE fois. Tu choisis l'heure.
> Et hop : TikTok, Shorts, Reels. Chacun à son heure.
> Le meilleur ? C'est gratuit. Et c'est français.
> Lien en bio. Va gagner tes soirées. »

Différences : 11 phrases au lieu de 4, tutoiement, deux questions d'ouverture, une rupture (« Arrête. »), une emphase en capitales, un contraste, une boucle (« Le meilleur ? ») payée aussitôt, CTA unique.

---

## 2. Débit : combien de mots par seconde ?

Ce qu'on sait vraiment (peu de chose solide pour la vidéo courte) :

| Donnée | Valeur | Fiabilité |
|---|---|---|
| Français parlé, toutes situations | ≈ 7 syllabes/s (Pellegrino et al. 2011, *Language*) | [source], moyenne de lecture d'un corpus |
| Conversation courante (anglais) | 120-150 mots/min ≈ 2-2,5 mots/s | [pratique] |
| TikTok/Reels (anglais) | 170-200 mots/min ≈ 2,8-3,3 mots/s ; 160-200 mots pour 60 s | [pratique], estimation d'éditeurs de téléprompteur, pas d'étude |
| TED Talks : meilleur engagement | 0,8 s/mot (≈ 1,25 mot/s) | [source] mais contexte conférence, non transposable |
| Pub vidéo courte : débit plus rapide → plus de partages (pas d'effet sur likes/commentaires) | effet significatif | [source : Internet Research, Emerald] |
| Persuasion : parler vite rend plus crédible et plus persuasif | Miller et al. 1976 | [source], avec nuances : effet seulement pour une implication modérée (Smith & Shaffer 1995), littérature mitigée et effet plafond possible (revue 2024) |
| Texte à l'écran | 5-10 mots/s affichés | [source : TikTok Ads] |

**Repères internes au dépôt** [mesuré par les fiches `voix/references/fiches.json`] : les voix « réseaux sociaux » les plus vives mesurent 3,4 à 3,9 mots/s (ex. `elevenlabs_saira` 3,86 ; `elevenlabs_ember` 3,79 ; `elevenlabs_liam` 3,55) ; le compte easy-neuron exige déjà ≥ 3,0 mots/s (référence Décode de Numerama).

**Recommandation Chapote CM [à tester]** : viser **3,3 à 3,8 mots/s** de moyenne sur la vidéo finale (silences resserrés compris), avec des variations : hook et énumérations plus rapides (≈ 4), punchline et CTA plus lents (≈ 2,5) précédés d'une pause de 0,3-0,5 s. Le débit moyen compte moins que **le contraste** entre passages rapides et pauses.

Calcul pratique : nombre de mots du script ≈ durée (s) × 3,3, puis ajustement après la première synthèse.

---

## 3. Modèles de scripts minutés (Chapote CM)

Base de calcul : ~3,3 mots/s **[à tester]**. Les fourchettes de mots sont des budgets, pas des chiffres sourcés.

### 3.1 — 15 s (≈ 45-50 mots) : « Douleur → solution → CTA »

| Temps | Rôle | Texte | Mots |
|---|---|---|---|
| 0:00-0:03 | Hook (douleur, question) | « Tu postes encore la même vidéo… trois fois ? » | 8 |
| 0:03-0:05 | Rupture | « Stop. » *(pause 0,3 s)* | 1 |
| 0:05-0:11 | Solution concrète | « Sur Chapote CM, tu la programmes une seule fois. Elle part sur TikTok, Shorts et Reels. Toute seule. » | 19 |
| 0:11-0:15 | Bénéfice + CTA | « Gratuit, et en français. Lien en bio. » | 7 |

### 3.2 — 30 s (≈ 95-100 mots) : « Mythe → démonstration → payoff »

| Temps | Rôle | Texte |
|---|---|---|
| 0:00-0:03 | Hook contre-intuitif | « Publier tous les jours, ça ne prend pas des heures. Ça prend… une minute. » |
| 0:03-0:07 | Open loop | « Je te montre comment. Et reste jusqu'au bout : il y a un détail que tout le monde oublie. » |
| 0:07-0:12 | Problème vécu | « Le soir, tu exportes ta vidéo. Tu ouvres TikTok. Puis YouTube. Puis Insta. Trois légendes. Trois fois les mêmes clics. » |
| 0:12-0:22 | Démonstration (3 temps) | « Avec Chapote CM : un, tu déposes la vidéo. Deux, tu choisis les réseaux. Trois, tu choisis l'heure. C'est tout. » |
| 0:22-0:26 | Payoff de la boucle | « Le détail ? L'heure. Tu programmes quand tu veux, ça sort quand ton public est là. » *(adapter au produit réel — [à vérifier])* |
| 0:26-0:30 | CTA | « C'est gratuit. Teste-le ce soir. Lien en bio. » |

### 3.3 — 45 s (≈ 140-150 mots) : « Histoire courte → 3 bénéfices → CTA »

| Temps | Rôle | Texte |
|---|---|---|
| 0:00-0:03 | Hook narratif | « Dimanche, 23 h. J'avais encore trois vidéos à poster. » |
| 0:03-0:08 | Tension | « Même vidéo. Trois applis. Trois légendes à recopier. Et évidemment… une oubliée. » |
| 0:08-0:12 | Bascule | « Alors j'ai arrêté. Pas de poster : de poster à la main. » |
| 0:12-0:20 | Bénéfice 1 | « Maintenant, je dépose ma vidéo une fois sur Chapote CM. Une seule. » |
| 0:20-0:28 | Bénéfice 2 | « Je coche TikTok, YouTube Shorts, Instagram Reels. Je choisis l'heure. Et je ferme l'ordi. » |
| 0:28-0:36 | Bénéfice 3 | « Le lundi matin, tout est en ligne. Sans moi. » |
| 0:36-0:40 | Objection | « Le prix ? Zéro. C'est gratuit. Et c'est fait en France. » |
| 0:40-0:45 | CTA | « Si toi aussi tu postes le dimanche soir… lien en bio. » |

Gabarit générique à remplir : `HOOK (≤ 3 s, ≤ 10 mots, question ou contre-pied) → BOUCLE (promesse) → DOULEUR (2-3 phrases d'1-6 mots) → BASCULE (1 mot ou 1 phrase courte) → PREUVE/DÉMO (liste de 3) → PAYOFF → CTA (1 seul)`.

---

## 4. Réglages TTS par moteur

### 4.1 Qwen3-TTS (moteur par défaut du dépôt)

Ce que dit la doc officielle **[source : README QwenLM/Qwen3-TTS ; rapport arXiv 2601.15621]** :
- Variantes : `1.7B-Base` et `0.6B-Base` (clonage, **sans instructions**), `1.7B-CustomVoice` (voix prédéfinies **avec** `instruct`), `0.6B-CustomVoice` (sans instruct), `1.7B-VoiceDesign` (voix créée depuis une description en langage naturel).
- 10 langues dont le français ; clonage multilingue évalué.
- Clonage : `create_voice_clone_prompt(ref_audio, ref_text)` puis `generate_voice_clone(...)`. `x_vector_only_mode=True` n'utilise que l'empreinte du locuteur (pas besoin de `ref_text`) mais la qualité peut baisser ; l'ICL (avec `ref_text`) **préserve mieux la prosodie**.
- Paramètres d'échantillonnage passés à `generate` (Transformers) : `do_sample`, `top_k`, `top_p`, `temperature`, `repetition_penalty`, `subtalker_dosample`, `subtalker_top_k`, `subtalker_top_p`, `subtalker_temperature`, `max_new_tokens`. Valeurs par défaut vues dans des copies de `generation_config.json` (communautaires, non vérifiées sur le dépôt officiel) : `temperature 0.9`, `top_k 50`, `top_p 1.0`, `repetition_penalty 1.05`, `subtalker_temperature 0.9`, `subtalker_top_k 50`.
- Exemples d'`instruct` de la doc : « Very happy. », « Speak in an incredulous tone, but with a hint of panic beginning to creep into your voice. »

Leviers, du plus efficace au moins efficace **[à tester, dans cet ordre]** :

1. **La voix de référence** (§5). C'est 80 % du résultat avec un modèle Base : choisir/enregistrer une référence déjà vive, et toujours fournir `ref_text` exact (mode ICL).
2. **« Voice Design then Clone »** (chemin documenté dans le README) : avec `1.7B-VoiceDesign`, générer une référence de 15-20 s en français à partir d'une description du type *« Jeune femme française, 25-30 ans, créatrice TikTok, ton enjoué et complice, débit rapide, sourire dans la voix, grande variation mélodique, attaques franches »*, puis la cloner avec le Base. Donne une référence énergique sans enregistrer personne (droits clairs). Nécessite de charger le 1.7B une fois (pas à chaque synthèse).
3. **Le texte** (§1) : phrases courtes, points d'interrogation, capitales d'emphase. Le modèle adapte ton, débit et émotion au sens du texte d'après le README.
4. **Découpage** : synthétiser par **paragraphe d'idée** (2-4 phrases) plutôt que phrase par phrase garde une intonation qui « raconte » ; phrase par phrase donne des fins de phrase toutes identiques. Le dépôt lit déjà par paragraphe sur CPU.
5. **Échantillonnage** : `temperature` 0.9 → 1.0 et `subtalker_temperature` 0.9 → 1.0 pour plus de variation ; au-delà, risque d'artefacts et de mots sautés (le contrôle Whisper du dépôt les rattrape). Générer 2-3 prises et garder la plus vivante (comme ElevenLabs le recommande pour une stabilité basse) **[à tester]**.
6. **CustomVoice 1.7B + `instruct`** (ex. « Parle avec enthousiasme, rythme rapide, comme une créatrice TikTok ») : seule voie avec instruction directe, mais avec les voix prédéfinies (langues natives chinois/anglais/japonais/coréen surtout) : à écouter en français avant d'adopter.
7. **Accélération après coup** (§6) : 1,05-1,10 avec `atempo` (hauteur conservée).

### 4.2 ElevenLabs

**Réglages officiels [source : ElevenLabs, Text to Speech product guide]** :
- *Stability* : plus bas = gamme émotionnelle plus large, mais trop bas = interprétation aléatoire. Pour une interprétation vive, **baisser la stabilité et générer plusieurs fois**. Réglage le plus courant : stability ≈ 50, similarity ≈ 75, style 0.
- *Similarity* : fidélité à la voix ; trop haut sur un échantillon médiocre reproduit les défauts. Indisponible en v3.
- *Style exaggeration* : amplifie le style du locuteur, mais ElevenLabs **recommande de le laisser à 0** (latence, instabilité).
- *Speaker boost* : effet subtil ; indisponible en v3.
- *Speed* : 0,7 à 1,2, défaut 1,0 ; les valeurs extrêmes dégradent la qualité.

**Eleven v3 [source : ElevenLabs, Prompting v3]** :
- Stabilité en trois modes : *Creative* (plus émotionnel et expressif, risque d'hallucinations), *Natural* (équilibré, proche de l'enregistrement d'origine), *Robust* (très stable, répond moins aux indications, proche de v2). Pour l'expressivité avec balises : **Creative ou Natural**. (Correspondance avec 0,0 / 0,5 / 1,0 dans l'API : plausible, non confirmée officiellement.)
- Balises de jeu : `[excited]`, `[curious]`, `[sarcastic]`, `[mischievously]`, `[whispers]`, `[sighs]`, `[exhales]`, `[laughs]`, `[laughs harder]`, `[starts laughing]`… Les balises fonctionnent mieux si la voix possède ce registre dans ses données ; décrire une qualité de voix (« [low, gravelly voice] ») plutôt qu'un bruit.
- Pas de SSML `<break>` en v3/v4 : pauses par ponctuation (« … », tirets) et structure.
- Les clones professionnels (PVC) ne sont pas optimisés pour v3 ; v4 recommandé pour eux.

**Profil « peps » ElevenLabs pour Chapote CM [à tester]** :

| Modèle | Réglages | Balises |
|---|---|---|
| `eleven_multilingual_v2` | stability 0,35-0,45 ; similarity 0,75 ; style 0 (la doc dit 0 ; le dépôt envoie 0,3 par défaut : comparer 0 vs 0,3 à l'écoute) ; speed 1,05-1,10 ; speaker boost on | aucune (non supportées) |
| `eleven_v3` | mode Natural (ou Creative si la prise reste plate ; regénérer 2-3 fois) | 1 balise toutes les 2-3 phrases max : `[excited]` sur le hook, `[curious]` sur la question, `[mischievously]` avant la révélation, `[laughs]` rare |
| `eleven_v4` (défaut du dépôt) | stability seule (le dépôt n'envoie ni speed ni style) | mêmes balises qu'en v3 (la doc les donne pour v4 et v3) |

Exemple de texte balisé v3/v4 :
> `[excited] Tu postes encore ta vidéo trois fois ? [curious] À la main ? … [mischievously] Arrête. Sur Chapote CM, tu la déposes UNE fois. Et hop : TikTok, Shorts, Reels.`

### 4.3 Récapitulatif des leviers par moteur

| Levier | Qwen3 Base (dépôt) | Qwen3 1.7B CustomVoice/VoiceDesign | ElevenLabs v2 | ElevenLabs v3/v4 |
|---|---|---|---|---|
| Voix de référence énergique | **essentiel** | VoiceDesign = la créer | voix choisie | voix choisie |
| Instruction de style | non | oui (`instruct`) | non | balises `[ ]` |
| Stabilité / variation | `temperature` | `temperature` | stability | mode Creative/Natural/Robust |
| Vitesse native | non (atempo) | via instruct (non documenté précisément) | speed 0,7-1,2 | v4 : non (atempo) |
| Pauses | ponctuation + `{pause}` | ponctuation | `<break>` (≤ 3 s) | ponctuation, « … » |

---

## 5. Choisir ou enregistrer une voix de référence énergique

### 5.1 Choisir parmi les voix existantes du dépôt
Les fiches mesurent déjà ce qu'il faut. Classement [mesuré, fiches.json, voix françaises] par intonation (étendue en demi-tons) et débit :

| Voix | Genre | Intonation (demi-tons) | Débit (mots/s) | Usage noté |
|---|---|---|---|---|
| `elevenlabs_saira` | femme | 16,0 | 3,86 | réseaux sociaux, « dynamique » |
| `elevenlabs_ember` | femme | 13,8 | 3,79 | personnage |
| `elevenlabs_jessica` | femme | 12,3 | 3,41 | conversation |
| `elevenlabs_charlie` | homme | 17,6 | 2,79 | conversation, « dynamique » |
| `elevenlabs_christian` | homme | 17,8 | 2,37 | animateur, « dynamique » |
| `elevenlabs_jules` | homme | 12,5 | 3,06 | conversation |
| `elevenlabs_liam` | homme | 11,6 | 3,55 | réseaux sociaux |

Critère de présélection proposé [à tester] : **intonation ≥ 12 demi-tons ET débit ≥ 3,2 mots/s** (le dépôt applique déjà des seuils de ce type par compte : kiwi 9,5 demi-tons, easy-neuron 3,0 mots/s). Puis A/B à l'oreille sur le même script de 15 s. Saira et Ember passent ce filtre ; côté homme, aucune voix ne passe les deux seuils : Jules ou Charlie + `atempo 1,08`, ou une nouvelle référence (§5.2).

### 5.2 Enregistrer (ou générer) une nouvelle référence
Exigences déjà fixées par le dépôt : 15 à 20 s, une seule voix, sans musique, parole nette, fin sur une phrase complète, droit d'usage. Pour l'énergie, ajouter **[pratique / à tester]** :

- **Le texte lu doit avoir le registre visé** : un texte de créateur TikTok (questions, exclamations, phrases courtes, énumération), pas un extrait de roman. Exemple de texte de référence (≈ 18 s) :
  > « Bon, écoute, j'ai un truc à te montrer. Tu sais ce qui m'énerve le plus ? Poster la même vidéo trois fois ! Franchement, c'est long, c'est répétitif… et on oublie toujours quelque chose. Alors maintenant, je fais tout d'un coup. Une fois. Et c'est réglé. Génial, non ? »
- **Jouer debout, en souriant, en s'adressant à une personne** (cf. R2, R11) ; un peu plus d'énergie que naturel, car le clonage « moyenne » et aplatit souvent **[pratique]**.
- **Variété mélodique dans les 20 s** : au moins une question, une exclamation, une phrase très courte, une énumération.
- **Débit de la référence ≈ débit visé** (≈ 3,5 mots/s) : ElevenLabs note que le rythme est fortement influencé par l'audio de la voix **[source]** ; c'est d'autant plus vrai pour un modèle qui copie la prosodie.
- Technique : pièce morte (couette, placard), micro à 15-20 cm, pas de compression lourde ni de débruitage agressif sur la référence (artefacts recopiés), crêtes vers -6 dBFS, 44,1/48 kHz.
- Passer ensuite par `voix_fiches.py` pour vérifier que les mesures dépassent les seuils, puis A/B.

Alternative sans enregistrement : « Voice Design then Clone » de Qwen3 (§4.1, point 2).

---

## 6. Post-traitement : chaîne ffmpeg prête à copier

Chaîne testée sur `voix/references/elevenlabs_saira.mp3` avec ffmpeg 6.1 [mesuré] : elle s'exécute sans erreur. Les valeurs (fréquences, gains, ratio) sont des **points de départ classiques d'ingénierie voix, non tirés d'une source chiffrée** : je n'ai trouvé aucune source fiable donnant « +3 dB à 3,5 kHz » ; à régler à l'oreille.

Cible loudness : Spotify recommande -14 LUFS, Apple Podcasts -16 **[source : Descript, Podnews]** ; les plateformes baissent ce qui est plus fort. Pour une vidéo courte, viser **-14 LUFS intégrés, true peak ≤ -1,5 dBTP** sur le **mix final** (voix + musique).

### 6.1 Voix seule (ordre : nettoyer → corriger → compresser → dé-esser → limiter)

```bash
VOIX_IN=voix.wav
VOIX_TRAITEE=voix_traitee.wav

ffmpeg -y -i "$VOIX_IN" -af "\
highpass=f=80,\
equalizer=f=250:t=q:w=1.2:g=-2,\
equalizer=f=3500:t=q:w=1.0:g=3,\
highshelf=f=10000:g=1.5,\
acompressor=threshold=-20dB:ratio=3:attack=5:release=60:knee=2.5:makeup=2,\
deesser=i=0.4:m=0.5:f=0.5,\
alimiter=limit=0.89:attack=5:release=50:level=false" \
-ar 48000 "$VOIX_TRAITEE"
```

Rôle de chaque filtre :
- `highpass=f=80` : retire grondements et souffle grave.
- `equalizer=f=250 … g=-2` : enlève l'effet « boîte »/boueux.
- `equalizer=f=3500 … g=3` : **présence** (intelligibilité, voix « devant »). Sur une voix déjà brillante ou sifflante, descendre à +1,5.
- `highshelf=f=10000:g=1.5` : « air ». À supprimer si la TTS a un léger grésillement aigu.
- `acompressor` : 3:1 à -20 dB, attaque rapide → voix régulière et dense, qui reste au-dessus de la musique.
- `deesser` (options ffmpeg : `i` intensité 0-1, `m` maximum, `f` fréquence relative 0-1) : calme les « s » renforcés par l'EQ.
- `alimiter=limit=0.89` (≈ -1 dBFS) : coupe les crêtes.

### 6.2 Resserrer les silences et accélérer (hauteur conservée)

```bash
ffmpeg -y -i voix_traitee.wav -af "\
silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.25:stop_threshold=-45dB:stop_silence=0.12,\
atempo=1.08" voix_rapide.wav
```
- Tous les silences de plus de 0,25 s sont ramenés à environ 0,12 s ; le silence de tête est coupé. Le dépôt utilise déjà la même forme (`max_pause` 0,12 pour ElevenLabs).
- `atempo` (0,5 à 100 dans ffmpeg 6.1) garde la hauteur ; rester entre **1,03 et 1,12** : au-delà, l'artefact de « time-stretch » s'entend sur une TTS **[à tester]**. Sur l'essai : 46,25 s → 41,67 s [mesuré].
- **Attention** : après ces deux filtres, les horodatages de mots ne sont plus valides : refaire l'alignement (c'est ce que fait `tts.py`) ou appliquer les filtres *avant* l'alignement Whisper. Les pauses voulues (`{pause}`) sont à insérer **après** `silenceremove`.

### 6.3 Mixage voix + musique avec ducking (sidechain)

```bash
ffmpeg -y -i voix_rapide.wav -stream_loop -1 -i musique.ogg -filter_complex "\
[1:a]volume=-16dB,aformat=channel_layouts=stereo[mus];\
[0:a]aformat=channel_layouts=stereo,asplit=2[voix][sc];\
[mus][sc]sidechaincompress=threshold=0.05:ratio=6:attack=15:release=350:makeup=1[musd];\
[voix][musd]amix=inputs=2:duration=first:normalize=0,\
alimiter=limit=0.89:level=false[out]" \
-map "[out]" -ar 48000 mix.wav
```
- `volume=-16dB` : niveau de base de la musique sous la voix (de -12 à -20 selon la musique).
- `sidechaincompress` : la musique baisse dès que la voix parle (attaque 15 ms), remonte en 350 ms dans les pauses → la musique « respire » entre les phrases, ce qui ajoute du rythme.
- `normalize=0` dans `amix` : sinon ffmpeg divise chaque entrée par le nombre d'entrées et la voix perd ~6 dB.
- Testé avec `public/sons/nappes/drone-grave.ogg` [mesuré] : fonctionne.
- Dans Remotion, l'équivalent simple : une courbe de volume musique qui baisse de 6-10 dB pendant les mots (horodatages `words.json`) ; le sidechain ffmpeg sur le mix exporté est plus simple et plus fidèle.

### 6.4 Normalisation finale -14 LUFS (deux passes)

```bash
# Passe 1 : mesure
ffmpeg -i mix.wav -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p' > mesure.json
# Passe 2 : application linéaire avec les valeurs mesurées
read I TP LRA TH OFF < <(python3 -c "import json;d=json.load(open('mesure.json'));print(d['input_i'],d['input_tp'],d['input_lra'],d['input_thresh'],d['target_offset'])")
ffmpeg -y -i mix.wav -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:offset=$OFF:linear=true" -ar 48000 mix_final.wav
# Contrôle
ffmpeg -i mix_final.wav -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|Peak:" | tail -2
```
Mesuré sur la voix d'essai : entrée -20,9 LUFS / TP -3,3 dB ; sortie -14,7 LUFS / pic -1,4 dB. Le passage linéaire est impossible quand la hausse de gain ferait dépasser le TP : `loudnorm` passe alors en mode « dynamic » (affiché dans le JSON, `normalization_type`), ce qui aplatit un peu. Pour garder le mode linéaire : compresser/limiter un peu plus fort en 6.1 (crêtes plus basses), ou remplacer la passe 2 par `volume=<gain>dB,alimiter=limit=0.79:level=false` (essai : -14,6 LUFS, pic -1,1 dBFS [mesuré]). Tolérance raisonnable : -14 ± 1 LUFS.

Option rapide (une passe, normalisation dynamique) : `-af loudnorm=I=-14:TP=-1.5:LRA=11`.

### 6.5 Ordre complet recommandé
1. Synthèse TTS (WAV, pas MP3, pour éviter les recompressions successives).
2. 6.1 (voix seule) → 6.2 (silences, atempo) → réalignement des mots → insertion des `{pause}`.
3. Montage Remotion avec la voix traitée, musique en piste séparée.
4. Export audio du mix → 6.3 si le ducking n'est pas fait dans Remotion → 6.4 sur le mix final → AAC 192 kbit/s minimum dans le MP4.

---

## 7. Grille de notation voix + script (sur 10)

À remplir par un humain (ou un agent qui écoute via Whisper + mesures), pour chaque vidéo ou chaque A/B.

| # | Critère | 0 | 0,5 | 1 | Mesure possible |
|---|---|---|---|---|---|
| 1 | **Hook** : conflit/question dans les 3 premières s, sans nom de marque en premier mot | absent | présent mais long | ≤ 3 s, ≤ 10 mots | horodatage du 1er point |
| 2 | **Phrases courtes** : moyenne ≤ 10 mots, aucune > 16 | moyenne > 14 | 10-14 | ≤ 10 | compte de mots |
| 3 | **Adresse directe** : « tu », une personne | « vous »/impersonnel | mixte | « tu » partout | recherche de mots |
| 4 | **Ruptures** : ≥ 1 rupture (mot seul, changement de ton, pause voulue) toutes les ~6 s | aucune | 1-2 | régulières | lecture |
| 5 | **Boucle ouverte payée** | aucune ou non payée | implicite | promise et payée | lecture |
| 6 | **Oralité** : aucun mot de plaquette (« permet de », « solution »…) | ≥ 3 | 1-2 | 0 | liste noire |
| 7 | **Débit** : 3,3-3,8 mots/s moyen, avec contraste rapide/lent | < 2,7 ou > 4,3 | 2,7-3,3 ou 3,8-4,3 | dans la cible avec variations | mots / durée (words.json) |
| 8 | **Intonation** : étendue mélodique, fins de phrase non identiques, questions qui montent | plate | correcte | vivante | étendue en demi-tons (comme `voix_fiches.py`) ; seuil à calibrer (≥ 12 ?) |
| 9 | **Son** : -14 ± 1 LUFS, TP ≤ -1 dB, voix nettement au-dessus de la musique, pas de sifflantes ni d'artefacts | défauts nets | un défaut | propre | `ebur128` |
| 10 | **CTA** : un seul, concret, en verbe, dit plus lentement | absent ou multiple | flou | net | lecture |

Lecture : **8-10** prêt à publier ; **6-7** retoucher le script (critères 1-6) ou relancer une prise (7-8) ; **< 6** réécrire. Les critères 7-9 sont mesurables automatiquement ; 1, 2, 3, 6 en partie (texte).

---

## 8. Plan d'essai suggéré (court)

1. Réécrire 3 scripts Chapote CM avec §1/§3, noter avant/après avec la grille.
2. Pour chacun : 3 voix (Saira, Ember, Jules) × Qwen3 Base ; une prise ElevenLabs v3 Natural avec balises en témoin.
3. Variante « Voice Design then Clone » (une référence générée par Qwen3 1.7B VoiceDesign).
4. Même post-traitement §6 pour tous ; écoute à l'aveugle + grille ; garder la meilleure combinaison, puis A/B en publication (rétention à 3 s et taux de visionnage complet).

---

## Sources

Écriture pour l'oreille et jeu vocal
- UF/IFAS, *Writing for Radio* (WC193) : https://edis.ifas.ufl.edu/publication/WC193
- Human Kinetics, *Tips for writing for broadcast* : https://us.humankinetics.com/blogs/excerpt/tips-for-writing-for-broadcast
- Press Gazette (écriture radio) : https://pressgazette.co.uk/?p=40536
- LibreTexts, *Writing for the ear* : https://human.libretexts.org/Courses/Southern_Illinois_University/The_OER_Guide_to_Media_Writing/07%3A_Writing_for_Audiovisual_Media/7.01%3A_Writing_for_the_ear
- Voices.com, *Conversational read* : https://voices.com/blog/conversational-read
- Voices.com podcast, sincérité, sourire, physicalité : https://www.voices.com/podcasts/voiceoverexperts/?p=147
- Such A Voice, énergie et lecture conversationnelle : https://www.suchavoice.com/blog/2026/07/22/how-to-add-more-energy-to-your-voice-while-staying-conversational/
- Such A Voice, top 10 techniques : https://suchavoice.com/?p=11109
- I'd Rather Be Writing, sourire en narration : https://idratherbewriting.com/2010/03/11/5-smiling-while-you-narrate-developing-a-personal-voice-in-audio-series/

Hooks, boucles, ruptures (praticiens)
- TikTok Ads, *Creative best practices for performance ads* : https://ads.tiktok.com/help/article/creative-best-practices?lang=en
- TikTok, *Creative Codes* (2023) : https://www.tiktok.com/business/library/Creative_Codes_May_2023.pdf
- Marketing Brew (analyse interne TikTok, 6 premières secondes) : https://www.marketingbrew.com/stories/2023/12/18/pay-attention-to-me-report-shares-brand-tips-for-catching-users-interest-on-tiktok
- CapCut, pattern interrupt : https://www.capcut.com/create/pattern-interrupt-technique-short-form-video
- Opus, science des hooks : https://www.opus.pro/blog/the-science-of-hooks
- Tokcount, open loops : https://tokcount.com/blog/scripting-for-retentive-attention-using-the-narrative-open-loop-strategy
- Socialync, open loops : https://www.socialync.io/blog/open-loops-in-content-2026
- Cursa, open loops et payoffs : https://cursa.app/en/page/open-loops-and-payoffs-keeping-viewers-watching-without-clickbait

Débit de parole
- Equinox Magazine (Pellegrino et al. 2011, *Language*, ≈ 7 syllabes/s en français) : https://www.equinoxmagazine.fr/?p=231009
- CNRS / Université Lyon 2 (Coupé et al. 2019, *Science Advances*, ≈ 39 bits/s) : https://www.univ-lyon2.fr/medias/fichier/20190904-alerte-presse-vitesse-langues-cnrs-universite-lumiere-lyon-2_1580921093538-pdf
- *What makes things catch on?* (TED Talks, 0,8 s/mot, phrases ≈ 8 mots ; Electronic Commerce Research 2026) : https://researchwith.montclair.edu/en/publications/what-makes-things-catch-on-understanding-consumer-engagement-with/
- Internet Research (Emerald), débit et partages des pubs vidéo courtes : https://www.emerald.com/insight/content/doi/10.1108/intr-07-2023-0521/full/pdf
- Miller et al. 1976, *Speed of speech and persuasion* : https://typeset.io/pdf/speed-of-speech-and-persuasion-48bx24hl8s.pdf
- Chaiken 1980 (résumé de Miller et al.) : https://fbaum.unc.edu/teaching/articles/jpsp-1980-Chaiken.pdf
- Smith & Shaffer 1995 : https://cir.nii.ac.jp/crid/1363670321183928320?lang=en
- Revue 2024, débit et persuasion (*Journal of Nonverbal Behavior*) : https://link.springer.com/article/10.1007/s10919-024-00477-6
- Estimation praticienne 170-200 mots/min pour TikTok : https://wildandfreetools.com/blog/reading-speed-words-per-minute-speech/
- UCLA Language in Life, voix des influenceurs TikTok : https://languagedlife.ucla.edu/sociolinguistics/the-tiktok-influencer-voice-do-sociolinguistic-features-influence-the-success-of-tiktok-videos

TTS
- Qwen3-TTS, README officiel : https://github.com/QwenLM/Qwen3-TTS
- Qwen3-TTS, rapport technique : https://arxiv.org/html/2601.15621
- Qwen3-TTS, méthodes de génération (miroir Mintlify) : https://www.mintlify.com/QwenLM/Qwen3-TTS/api/model/generation-methods
- Qwen3-TTS, `generation_config.json` (copie communautaire, non officielle) : https://huggingface.co/simone00/Qwen-TTS-Best-Model/blob/main/generation_config.json
- ElevenLabs, *Text to Speech* (réglages de voix) : https://elevenlabs.io/docs/product-guides/playground/text-to-speech
- ElevenLabs, *Prompting* (balises, pauses, vitesse) : https://elevenlabs.io/docs/best-practices/prompting
- ElevenLabs, *Prompting Eleven v3 (alpha)* (modes Creative/Natural/Robust) : https://cdntest.elevenlabs.io/docs/best-practices/prompting
- ElevenLabs, blog v3 audio tags : https://elevenlabs.io/blog/v3-audiotags

Audio
- Descript, loudness podcast : https://descript.com/blog/article/podcast-loudness-standard-getting-the-right-volume
- Podnews, LUFS pour podcasteurs : https://podnews.net/article/lufs-lkfs-for-podcasters
- Overcast Voice Boost 2 (chaîne normalisation + compression + EQ + limiteur) : https://marco.org/2020/01/31/voiceboost2
- Documentation des filtres FFmpeg : https://ffmpeg.org/ffmpeg-filters.html (options vérifiées localement avec `ffmpeg -h filter=<nom>`, ffmpeg 6.1.1)
