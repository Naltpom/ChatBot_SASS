# 02 — Motion design pour vidéos de démo d'app / SaaS (Chapote CM)

> Recherche n° 2 sur 10. Sujet : les techniques de mouvement qui font « voyager » une vidéo de démo d'app, et leur mise en œuvre dans Remotion.
> Hypothèses techniques : composition **1080×1920 à 30 i/s** (vertical) ou **1920×1080** (horizontal), captures réelles de l'app (téléphone 390×844, ordinateur 1280×800).
> Les durées sont données **en images à 30 i/s** (30 images = 1 s). Les chiffres tirés d'une source sont signalés par [n] (liste en fin de document). Les valeurs données sans [n] sont des **réglages de départ conseillés** (choix d'atelier, à ajuster à l'œil), pas des mesures.

---

## 0. Diagnostic : pourquoi nos vidéos sont statiques

Une vidéo actuelle = un téléphone qui apparaît, un léger zoom, un texte qui « pop ». En termes de montage, c'est **un seul plan de 20-30 s** avec un unique mouvement lent. Or :

- Les pubs « cinématiques » sur Meta et TikTok étudiées par Law et al. (99 pubs, 2026) durent **17,9 s en moyenne pour 15,2 plans, soit un plan toutes les ~1,2 s**, avec des plans entre **0,5 et 7,5 s** ; un film moderne est autour de **4 s par plan** [1]. Les techniques de montage les plus fréquentes dans ce corpus : **coupe dans le mouvement (52,2 %)**, montage (37,4 %), **coupe sur le temps (22,2 %)**, **raccord de mouvement / match cut (18,2 %)** et alignement d'une incrustation sur l'image (16,2 %) [1].
- TikTok recommande de poser l'accroche dans les **6 premières secondes**, la proposition dans les **3 premières**, d'utiliser « transitions, autocollants et graphismes pour retenir l'attention » et d'afficher **5 à 10 mots par seconde** quand on met du texte [2]. Son guide Creative Codes classe **transitions et mouvement** parmi les déclencheurs d'attention [3].
- Meta : vidéo 9:16 **avec le son**, messages clés dans la **zone sûre** (haut, bas et côtés libres de texte et de logos) [4] ; d'après les données Meta reprises par Search Engine Land, la marque et le message dans les **5 premières secondes** rendent une pub 1,7 fois plus susceptible d'être dans le haut du classement d'intention d'achat [5].

Conclusion : il faut passer **d'un plan qui bouge un peu** à **une suite de 12 à 20 « événements » visuels** en 25 s, reliés par une caméra qui se déplace dans l'interface.

---

## 1. Boîte à outils Remotion (rappels exacts de l'API)

| Outil | Ce qu'il fait | Points clés (doc officielle) |
|---|---|---|
| `interpolate(frame, [in…], [out…], {easing, extrapolateLeft/Right})` | mappe le temps sur une valeur | toujours `'clamp'` aux deux bouts pour un mouvement qui s'arrête |
| `Easing` | courbes | `back`, `bounce`, `ease`, `elastic`, `linear`, `quad`, `cubic`, `poly(n)`, `bezier(x1,y1,x2,y2)`, `circle`, `sin`, `exp`, modificateurs `in/out/inOut`, `step0/step1` [6] |
| `spring({frame, fps, config, durationInFrames, delay, reverse, from, to})` | ressort physique 0→1 | défauts **mass 1, damping 10, stiffness 100**, `overshootClamping:false` ; `durationInFrames` étire la courbe ; ordre d'application : durée → `reverse` → `delay` [7] |
| `<Sequence from durationInFrames>` / `<Series>` | placer les plans | le temps est local dans chaque séquence |
| `@remotion/transitions` : `<TransitionSeries>` | transitions entre plans | `linearTiming({durationInFrames})`, `springTiming({config})` ; une transition ne doit pas être plus longue que les plans voisins, deux transitions ne se suivent pas ; `<TransitionSeries.Overlay>` ne raccourcit pas la timeline [8] |
| Présentations | | `slide`, `fade`, `wipe`, `flip`, `clockWipe`, `iris`, `cube`, `none`, `blurSlide`, `bookFlip`, `crosswarp`, `crossZoom`, `dissolve`, `dreamyZoom`, `filmBurn`, `linearBlur`, `pushCut` (« coupe franche avec bref flash »), `ripple`, `swap`, `zoomBlur`, `zoomInOut` [9] (vérifier la version installée : certaines sont récentes) |
| `@remotion/motion-blur` | flou de mouvement | `<CameraMotionBlur shutterAngle={180} samples={10}>` (défauts ; 5-10 échantillons conseillés, enfants en `AbsoluteFill`) ; `<Trail>` répète les positions passées ; la doc oriente désormais vers `<HtmlInCanvasMotionBlur width height samples shutterAngle>` [10][11] |
| `@remotion/paths` : `evolvePath(progress, d)` | tracer un trait SVG progressivement | renvoie `strokeDasharray` / `strokeDashoffset` [12] |
| `@remotion/noise` : `noise2D(seed, x, y)` | bruit doux −1..1 | caméra « à l'épaule », flottement [13] |
| `@remotion/three` : `<ThreeCanvas width height>` | 3D (téléphone qui tourne) | `width`/`height` obligatoires ; une `<Sequence>` dedans exige `layout="none"` ; vidéo en texture via `useOffthreadVideoTexture()` ou `<Video headless>` de `@remotion/media` ; gabarit officiel `template-three` = téléphone 3D dont l'écran joue une vidéo [14][15] |

### 1.1 Courbes d'easing de référence

| Nom | Valeur | Usage | Source |
|---|---|---|---|
| Standard Material | `Easing.bezier(0.4, 0, 0.2, 1)` | changements de taille, déplacements dans le cadre | [16] |
| Décélération (entrée) | `Easing.bezier(0, 0, 0.2, 1)` | un élément qui entre et se pose | [16] |
| Accélération (sortie) | `Easing.bezier(0.4, 0, 1, 1)` | un élément qui sort | [16] |
| M3 « emphasized decelerate » | `Easing.bezier(0.05, 0.7, 0.1, 1)` | entrées marquées (très rapide puis très doux) — **la courbe « produit » par excellence** | [17] |
| M3 « emphasized accelerate » | `Easing.bezier(0.3, 0, 0.8, 0.15)` | sorties marquées | [17] |
| M3 standard | `Easing.bezier(0.2, 0, 0, 1)` | mouvements utilitaires | [17] |
| Expo out (atelier) | `Easing.bezier(0.16, 1, 0.3, 1)` | push-in de caméra, zoom sur zone | choix d'atelier |
| InOut quint (atelier) | `Easing.inOut(Easing.poly(5))` | déplacement de caméra d'un point A à un point B (whip doux) | choix d'atelier |

Durées d'interface de référence (Material 1) : **300 ms** typique sur mobile, **375 ms** pour une grande transition plein écran, **225 ms** pour une entrée, **195 ms** pour une sortie ; au-delà de **400 ms** une transition paraît lente [16]. En images : entrée ≈ 7 images, typique ≈ 9, plein écran ≈ 11. **En vidéo, les mouvements de caméra peuvent durer plus (15-30 images)**, mais les apparitions d'éléments d'UI doivent rester dans ces ordres de grandeur pour paraître « natives ».

Ressorts : Apple décrit un ressort par **durée perçue + rebond** ; un rebond de ~15 % ne se sent pas, ~30 % se sent nettement, au-delà de ~0,4 c'est exagéré pour un élément d'UI ; dans le doute, rebond 0 ; exemples de la session à 0,4-0,6 s [18][19]. Traduction Remotion (réglages de départ) :

| Intention | `config` |
|---|---|
| Doux sans rebond (caméra, grands panneaux) | `{damping: 200}` (exemple de la doc des transitions [8]) |
| Vif, léger dépassement (cartes, bulles, notifications) | `{damping: 14, stiffness: 160, mass: 0.8}` |
| « Pop » (badges, icônes, compteurs qui atterrissent) | `{damping: 9, stiffness: 180, mass: 0.6}` |
| Lourd (téléphone qui arrive) | `{damping: 18, stiffness: 90, mass: 1.4}` |

---

## 2. Briques communes (à mettre dans `src/lib/motion/`)

```tsx
// motion.ts — utilitaires partagés par tous les effets
import {Easing, interpolate, spring} from 'remotion';

export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1),          // expo out (atelier)
  emph: Easing.bezier(0.05, 0.7, 0.1, 1),       // M3 emphasized decelerate [17]
  inOut: Easing.inOut(Easing.poly(5)),          // caméra A→B
  std: Easing.bezier(0.4, 0, 0.2, 1),           // Material standard [16]
  exit: Easing.bezier(0.3, 0, 0.8, 0.15),       // M3 emphasized accelerate [17]
};

export const tween = (
  f: number, start: number, dur: number, from: number, to: number,
  easing = EASE.out,
) =>
  interpolate(f, [start, start + dur], [from, to], {
    easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

export const SPRING = {
  doux: {damping: 200},
  vif: {damping: 14, stiffness: 160, mass: 0.8},
  pop: {damping: 9, stiffness: 180, mass: 0.6},
  lourd: {damping: 18, stiffness: 90, mass: 1.4},
};

export const pop = (f: number, fps: number, delay = 0, config = SPRING.vif) =>
  spring({frame: f, fps, delay, config});
```

### 2.1 La « caméra virtuelle » (cœur du système)

Tout le dynamisme vient d'une idée : **la scène est un grand plan 2D (le « monde ») et la caméra s'y déplace par images clés**. On ne bouge pas les objets un par un : on déplace le cadre. Chaque plan de la recette (§5) est une image clé `{x, y, zoom, rot}` exprimée **en pixels de la capture** (pour viser un bouton à ses coordonnées réelles).

```tsx
// Camera.tsx
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {noise2D} from '@remotion/noise';
import {EASE} from './motion';

export type Cle = {f: number; x: number; y: number; zoom: number; rot?: number; ease?: (t: number) => number};

const lerpCles = (frame: number, cles: Cle[], k: 'x' | 'y' | 'zoom' | 'rot') => {
  if (frame <= cles[0].f) return cles[0][k] ?? 0;
  for (let i = 0; i < cles.length - 1; i++) {
    const a = cles[i], b = cles[i + 1];
    if (frame <= b.f) {
      return interpolate(frame, [a.f, b.f], [a[k] ?? 0, b[k] ?? 0], {
        easing: b.ease ?? EASE.inOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      });
    }
  }
  return cles[cles.length - 1][k] ?? 0;
};

export const Camera: React.FC<{cles: Cle[]; tremble?: number; children: React.ReactNode}> = ({
  cles, tremble = 0, children,
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const zoom = lerpCles(frame, cles, 'zoom');
  // Le zoom se fait en espace logarithmique : un passage 1→4 paraît régulier
  const x = lerpCles(frame, cles, 'x');
  const y = lerpCles(frame, cles, 'y');
  const rot = lerpCles(frame, cles, 'rot');
  const nx = tremble * noise2D('cx', frame / 40, 0);
  const ny = tremble * noise2D('cy', 0, frame / 40);
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          transformOrigin: '0 0',
          // le point (x, y) du monde arrive au centre de l'écran
          transform: `translate(${width / 2 + nx}px, ${height / 2 + ny}px) scale(${zoom}) rotate(${rot}deg) translate(${-x}px, ${-y}px)`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
```

> Astuce : pour un zoom très ample (×1 → ×3), interpoler `Math.log(zoom)` puis `Math.exp` donne une vitesse perçue constante ; sinon le zoom semble « accélérer » à la fin.

---

## 3. Catalogue de 30 effets

Format : **quand** · **durée / easing** · **code**. `f` = `useCurrentFrame()`, `fps` = 30.

### A. Caméra et cadrage

#### 1. Push-in (travelling avant lent)
- **Quand** : pendant une phrase d'explication, pour ne jamais laisser un plan immobile ; ouvre ou ferme un plan.
- **Durée** : toute la durée du plan (45-90 images), échelle 1,00 → 1,06-1,12, easing linéaire ou `Easing.out(Easing.quad)`.
```tsx
const s = interpolate(f, [0, durationInFrames], [1, 1.08], {extrapolateRight: 'clamp'});
<AbsoluteFill style={{transform: `scale(${s})`}}>{plan}</AbsoluteFill>
```

#### 2. Zoom sur la zone cliquée (« auto-zoom » à la Screen Studio)
- **Quand** : à chaque action importante (bouton « Programmer », choix d'une date). Screen Studio génère ses zooms **à partir des clics** et propose deux styles de caméra : « Focused » qui se pose vite (bon quand il faut lire) et « Smooth » plus fluide [20][21].
- **Durée** : aller 18-24 images `EASE.out` (style « focused ») ; tenue 30-60 images ; retour 15-20 images `EASE.inOut`. Zoom ×1,8 à ×2,5 sur une capture téléphone (la zone visée doit rester lisible et dans la zone sûre).
```tsx
// le bouton est à (195, 760) dans la capture 390×844 affichée à l'échelle k
const cles: Cle[] = [
  {f: 0,  x: 195*k, y: 422*k, zoom: 1},
  {f: 10, x: 195*k, y: 422*k, zoom: 1},                       // petite pause avant le geste
  {f: 32, x: 195*k, y: 760*k, zoom: 2.2, ease: EASE.out},     // on plonge sur le bouton
  {f: 80, x: 195*k, y: 740*k, zoom: 2.3},                     // tenue avec léger glissement
  {f: 98, x: 195*k, y: 422*k, zoom: 1, ease: EASE.inOut},     // retour
];
<Camera cles={cles}><Telephone capture="programmer.png" /></Camera>
```

#### 3. Caméra qui suit le curseur / le doigt
- **Quand** : démo desktop (1280×800) où le curseur se déplace ; démo mobile avec un doigt simulé.
- **Durée** : la caméra suit **en retard** (lissage) ; trajectoire du curseur en `EASE.inOut` 15-25 images par déplacement. Screen Studio lisse aussi les mouvements du curseur (réglages Smooth/Medium/Rapid/None) [21].
```tsx
// trajectoire du curseur : liste de points {f, x, y}
const cx = lerpCles(f, pts, 'x'), cy = lerpCles(f, pts, 'y');
// caméra = position du curseur vue 6 images plus tôt (retard naturel)
const camX = lerpCles(f - 6, pts, 'x'), camY = lerpCles(f - 6, pts, 'y');
const cles = [{f, x: camX, y: camY, zoom: 1.6}]; // ou passer camX/camY directement à un <Camera> statique
```
Plus propre : calculer la caméra comme **moyenne glissante** des 8 dernières positions du curseur (`Array.from({length: 8}, (_, i) => pos(f - i))`), ce qui évite tout à-coup.

#### 4. Pan (glissement latéral dans l'interface)
- **Quand** : montrer une liste, un calendrier, un tableau trop large ; passer d'une colonne à l'autre.
- **Durée** : 20-30 images `EASE.inOut` ; ou lent et continu (linéaire) sur 60-90 images pour un « défilement contemplatif ».
```tsx
const x = tween(f, 0, 24, 300, 980, EASE.inOut);
<Camera cles={[{f: 0, x, y: 500, zoom: 1.4}]}>{ecranOrdinateur}</Camera>
```

#### 5. Whip pan (panoramique fouetté)
- **Quand** : passer d'une fonctionnalité à l'autre, ou d'une plateforme (TikTok) à l'autre (YouTube) ; c'est la transition la plus « réseaux ».
- **Durée** : 8-12 images, `Easing.inOut(Easing.poly(5))` + flou de mouvement directionnel ; coupe cachée au milieu (image 5-6).
```tsx
const t = tween(f, 0, 10, 0, 1, Easing.inOut(Easing.poly(5)));
const x = interpolate(t, [0, 1], [0, -width]);            // A part à gauche, B arrive de droite
const v = Math.abs(interpolate(t, [0, 0.5, 1], [0, 1, 0])); // vitesse ~ pic au milieu
<AbsoluteFill style={{transform: `translateX(${x}px)`, filter: `blur(${v * 24}px)`}}>
  <div style={{position: 'absolute', left: 0, width}}>{planA}</div>
  <div style={{position: 'absolute', left: width, width}}>{planB}</div>
</AbsoluteFill>
```
(Un flou CSS est isotrope ; pour un flou vraiment directionnel, envelopper dans `<CameraMotionBlur shutterAngle={270} samples={8}>` [10].)

#### 6. Pull-back / reveal (on part de l'écran plein cadre, on recule jusqu'au téléphone)
- **Quand** : ouverture ou révélation (« tout ça, depuis ton téléphone »). Rotato le cite comme idée de base : écran face caméra puis recul lent qui révèle l'appareil [22].
- **Durée** : 30-45 images, `EASE.inOut` ; zoom ×3,2 → ×1.
```tsx
const z = Math.exp(tween(f, 0, 40, Math.log(3.2), 0, EASE.inOut));
<Camera cles={[{f: 0, x: cxEcran, y: cyEcran, zoom: z}]}><TelephoneDansDecor /></Camera>
```

#### 7. Tremblement / caméra « à l'épaule » léger
- **Quand** : en fond permanent, pour que même une tenue ne soit jamais figée (micro-mouvement).
- **Réglage** : amplitude 3-6 px, fréquence `frame/40` ; **jamais** sur un plan où il faut lire du petit texte zoomé.
```tsx
<Camera cles={cles} tremble={4}>{…}</Camera>
```

#### 8. Dolly zoom / « punch-in » sur le temps
- **Quand** : sur un mot fort de la voix (« gratuit », « en un clic ») ou un temps de musique.
- **Durée** : saut instantané ×1 → ×1,15 à l'image exacte du mot, puis retour amorti en 10 images (`spring` `vif`).
```tsx
const dt = f - fMot; // fMot = image du mot dans l'horodatage TTS
const punch = dt < 0 ? 0 : 0.15 * (1 - spring({frame: dt, fps, config: SPRING.vif}));
<AbsoluteFill style={{transform: `scale(${1 + punch})`}}>{…}</AbsoluteFill>
```

### B. Le téléphone / l'écran comme objet

#### 9. Inclinaison 3D d'un téléphone (CSS perspective)
- **Quand** : plan d'ouverture, présentation d'un écran ; alterner incliné → face caméra quand on veut faire lire.
- **Durée** : arrivée 20-30 images `spring` `lourd` ; puis rotation lente continue (±4° sur 2 s).
```tsx
const p = spring({frame: f, fps, config: SPRING.lourd});
const ry = interpolate(p, [0, 1], [-35, -12]) + 3 * Math.sin(f / 30);
const rx = interpolate(p, [0, 1], [18, 6]);
const y = interpolate(p, [0, 1], [500, 0]);
<AbsoluteFill style={{perspective: 1800, justifyContent: 'center', alignItems: 'center'}}>
  <div style={{transform: `translateY(${y}px) rotateX(${rx}deg) rotateY(${ry}deg)`, transformStyle: 'preserve-3d'}}>
    <Telephone capture="accueil.png" />
  </div>
</AbsoluteFill>
```

#### 10. Mockup 3D qui tourne (Three.js)
- **Quand** : plan « héros » ou final (téléphone qui pivote d'une plateforme à l'autre), vraie profondeur et reflets. Le gabarit officiel `remotion-dev/template-three` fournit un téléphone 3D dont l'écran joue une vidéo [15].
- **Durée** : rotation 360° en 60-90 images `EASE.inOut`, ou demi-tour 30 images pour révéler un autre écran au dos.
```tsx
import {ThreeCanvas, useOffthreadVideoTexture} from '@remotion/three';
import {staticFile} from 'remotion';

const Scene = () => {
  const f = useCurrentFrame(); const {width, height} = useVideoConfig();
  const tex = useOffthreadVideoTexture({src: staticFile('capture-ecran.mp4')});
  const ry = tween(f, 0, 75, -Math.PI * 0.6, Math.PI * 0.1, EASE.inOut);
  return (
    <ThreeCanvas width={width} height={height} camera={{fov: 30, position: [0, 0, 9]}}>
      <ambientLight intensity={0.6} /><directionalLight position={[3, 5, 6]} intensity={1.4} />
      <group rotation={[0.12, ry, 0]}>
        <mesh><boxGeometry args={[2.0, 4.3, 0.18]} /><meshStandardMaterial color="#111" metalness={0.6} roughness={0.3} /></mesh>
        <mesh position={[0, 0, 0.091]}><planeGeometry args={[1.86, 4.03]} />{tex && <meshBasicMaterial map={tex} toneMapped={false} />}</mesh>
      </group>
    </ThreeCanvas>
  );
};
```
(Coins arrondis : `RoundedBox` de drei, ou partir directement du gabarit [15].)

#### 11. Parallax 2.5D (couches à vitesses différentes)
- **Quand** : téléphone devant un décor (formes, captures floues, logos des réseaux) ; donne de la profondeur sans 3D.
- **Réglage** : chaque couche se déplace d'un facteur `profondeur` × mouvement caméra (fond 0,2, milieu 0,6, téléphone 1, éléments flottants au premier plan 1,4).
```tsx
const camX = tween(f, 0, 90, -60, 60, EASE.inOut);
const couche = (prof: number, el: React.ReactNode) =>
  <AbsoluteFill style={{transform: `translateX(${camX * prof}px) scale(${1 + 0.03 * prof})`}}>{el}</AbsoluteFill>;
<>{couche(0.2, <Fond />)}{couche(0.6, <CapturesFlouees />)}{couche(1, <Telephone />)}{couche(1.4, <IconesReseaux />)}</>
```

#### 12. Screen-in-screen (un écran qui contient le suivant)
- **Quand** : passer de l'ordinateur au téléphone (« programme sur ton ordi, vérifie sur ton téléphone ») ; Rotato documente précisément le pan moniteur → téléphone, avec une **courte pause au début pour laisser lire l'écran** avant le mouvement [23].
- **Durée** : 30-40 images ; zoom ×1 → ×4 dans une zone de l'écran 1, où l'écran 2 est déjà incrusté ; à ×4 on coupe sur l'écran 2 plein cadre.
```tsx
const z = Math.exp(tween(f, 8, 32, 0, Math.log(4), EASE.inOut)); // 8 images de pause [23]
<Camera cles={[{f: 0, x: 1040, y: 620, zoom: z}]}>
  <Ordinateur capture="calendrier.png">
    <div style={{position: 'absolute', left: 1000, top: 560, width: 80, height: 173}}><Telephone mini /></div>
  </Ordinateur>
</Camera>
```

#### 13. Explosion des calques de l'UI
- **Quand** : montrer « ce qu'il y a dedans » (la carte de post, la légende, les plateformes, l'heure). Rotato : « éclater les artboards puis les réassembler » [22].
- **Durée** : écartement 20 images `spring` `vif`, tenue, puis retour 15 images.
```tsx
const e = spring({frame: f, fps, config: SPRING.vif});
calques.map((c, i) => (
  <div key={i} style={{transform: `translateZ(${e * i * 90}px) translateY(${-e * i * 18}px)`, transformStyle: 'preserve-3d'}}>{c}</div>
));
// le parent : rotateX(50deg) rotateZ(-30deg) pour la vue isométrique, perspective 2000
```

#### 14. Split-screen (deux ou trois écrans côte à côte)
- **Quand** : même post sur TikTok / Reels / Shorts au même instant ; avant/après ; « toi sans Chapote / avec ».
- **Durée** : chaque panneau arrive en décalé de 4-6 images (`spring` `vif`), séparateur tracé avec `evolvePath`.
```tsx
[0, 1, 2].map(i => {
  const p = spring({frame: f, fps, delay: i * 5, config: SPRING.vif});
  return <div key={i} style={{position: 'absolute', left: i * 360, width: 360, height: 1920,
    transform: `translateY(${(1 - p) * 1920}px)`}}><Plateforme i={i} /></div>;
});
```

### C. Transitions entre plans

#### 15. Match cut (raccord de forme / de mouvement)
- **Quand** : le bouton rond devient le logo, la carte de post devient la vidéo publiée, le calendrier devient une grille TikTok. Technique présente dans 18,2 % des pubs du corpus de Law et al. [1].
- **Mise en œuvre** : même position, même taille, même couleur à l'image de coupe ; on transforme l'élément commun (morph de `borderRadius`, largeur, couleur avec `interpolateColors`) sur 10-14 images.
```tsx
import {interpolateColors} from 'remotion';
const t = tween(f, 0, 12, 0, 1, EASE.std);
<div style={{
  position: 'absolute', left: interpolate(t, [0, 1], [440, 0]), top: interpolate(t, [0, 1], [1500, 0]),
  width: interpolate(t, [0, 1], [200, 1080]), height: interpolate(t, [0, 1], [200, 1920]),
  borderRadius: interpolate(t, [0, 1], [100, 0]), background: interpolateColors(t, [0, 1], ['#6C5CE7', '#0F0F14']),
}} />
```

#### 16. Coupe dans le mouvement (cut on action)
- **Quand** : la technique la plus courante (52,2 % du corpus [1]) : on coupe **pendant** un mouvement (doigt qui tape, écran qui glisse) et le plan suivant reprend le mouvement à la même vitesse.
- **Mise en œuvre** : le plan A finit avec un élément en mouvement vers la droite à v px/image ; le plan B commence avec un élément en mouvement dans la même direction et à la même vitesse (pas d'easing « in » au début de B). Avec `<Series>` et une coupe sèche.

#### 17. Coupe sur le temps (cut to beat)
- **Quand** : 22,2 % du corpus [1] ; caler chaque changement de plan sur un temps de la musique.
```tsx
const bpm = 120, img = (60 / bpm) * fps;  // 15 images par temps à 120 BPM
const plans = [4, 4, 2, 2, 4, 8].map(n => n * img); // durées en nombre de temps
<Series>{plans.map((d, i) => <Series.Sequence key={i} durationInFrames={Math.round(d)}>{scenes[i]}</Series.Sequence>)}</Series>
```

#### 18. Transitions de `@remotion/transitions` (slide, wipe, iris, clockWipe, flip, cube)
- **Quand** : `slide` pour « écran suivant » (lecture naturelle d'une app), `iris` pour plonger dans un bouton rond, `clockWipe` pour « programmé à 18 h », `cube`/`flip` pour changer de plateforme, `pushCut` pour un impact [9].
- **Durée** : 10-18 images ; `springTiming({config: {damping: 200}})` pour un résultat doux [8].
```tsx
import {TransitionSeries, springTiming, linearTiming} from '@remotion/transitions';
import {slide} from '@remotion/transitions/slide';
import {iris} from '@remotion/transitions/iris';
<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={75}><PlanAccueil /></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={slide({direction: 'from-right'})} timing={springTiming({config: {damping: 200}})} />
  <TransitionSeries.Sequence durationInFrames={90}><PlanCalendrier /></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={iris({width: 1080, height: 1920})} timing={linearTiming({durationInFrames: 14})} />
  <TransitionSeries.Sequence durationInFrames={60}><PlanPublie /></TransitionSeries.Sequence>
</TransitionSeries>
```
Attention : une transition **chevauche** les deux plans et raccourcit la durée totale ; il faut en tenir compte pour caler la voix [8].

#### 19. Transition par masque (forme qui grandit depuis l'élément cliqué)
- **Quand** : on tape un bouton et l'écran suivant naît depuis ce bouton (plus précis que `iris` qui part du centre).
- **Durée** : 14-18 images `EASE.emph`.
```tsx
const r = tween(f, 0, 16, 0, 2300, EASE.emph);
<AbsoluteFill style={{clipPath: `circle(${r}px at ${bx}px ${by}px)`}}><EcranSuivant /></AbsoluteFill>
```

#### 20. Zoom-through (on traverse l'élément)
- **Quand** : on zoome dans une vignette de vidéo jusqu'à ce qu'elle remplisse le cadre, et on est dans la vidéo publiée.
- **Durée** : 18-24 images, zoom exponentiel jusqu'à ×6-8, fondu du plan B dans les 4 dernières images ; `zoomBlur` / `crossZoom` en version prête [9].

#### 21. Flash / « push cut »
- **Quand** : ponctuer un moment-clé (« Publié ! ») ; `pushCut()` de Remotion = coupe franche avec bref flash [9].
- **Manuel** : 2-3 images de blanc à 60-80 % d'opacité en `TransitionSeries.Overlay`.

### D. Typographie cinétique

#### 22. Mots qui arrivent un par un (sous-titres dynamiques calés sur la voix)
- **Quand** : tout le long ; texte horodaté par la TTS. TikTok recommande **5 à 10 mots/s** à l'écran [2].
- **Durée** : chaque mot entre en 6-8 images (`spring` `vif`) : `translateY 40 → 0`, opacité, échelle 0,85 → 1 ; mot actif surligné.
```tsx
mots.map((m, i) => {
  const p = spring({frame: f - m.debut, fps, config: SPRING.vif});
  const actif = f >= m.debut && f < m.fin;
  return <span key={i} style={{display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 40}px) scale(${0.85 + 0.15 * p})`,
    color: actif ? '#FFD84D' : '#fff'}}>{m.texte}&nbsp;</span>;
});
```

#### 23. Mot-titre géant qui remplit le cadre
- **Quand** : accroche des 2 premières secondes (« 3 réseaux. 1 clic. »), ou entre deux démos.
- **Durée** : 3 mots × 10-15 images chacun ; chaque mot : scale 1,4 → 1 en `EASE.out` 8 images, coupe sèche au mot suivant ; police 220-320 px, en zone sûre.

#### 24. Révélation par masque de ligne (texte qui sort d'une fente)
- **Quand** : titres de fonctionnalités, plus élégant que le « pop ».
```tsx
const y = tween(f, i * 3, 14, 110, 0, EASE.emph); // décalage de 3 images par ligne
<div style={{overflow: 'hidden', lineHeight: 1.05}}><div style={{transform: `translateY(${y}%)`}}>{ligne}</div></div>
```

#### 25. Texte qui suit un élément de l'UI (étiquette accrochée)
- **Quand** : désigner une fonctionnalité pendant que la caméra bouge (« Heure idéale ✨ ») ; Rotato : étiquettes 3D qui suivent l'appareil ou font face à la caméra, près de ce qu'elles décrivent [22]. Correspond à l'« alignement incrustation-image » (16,2 % du corpus [1]).
- **Mise en œuvre** : placer l'étiquette **à l'intérieur** du monde de `<Camera>` (elle suit) mais compenser l'échelle (`scale(1/zoom)`) pour garder une taille de texte constante.

### E. Mise en évidence

#### 26. Cercle ou contour qui se dessine
- **Durée** : tracé 12-18 images `EASE.std`, tenue, puis effacement par `evolvePath` avec progress > 1 (le début se défait) [12].
```tsx
import {evolvePath} from '@remotion/paths';
const d = 'M 60 0 A 60 40 0 1 1 59.9 0';  // ellipse dessinée à la main
const p = tween(f, 0, 16, 0, 1, EASE.std) + tween(f, 70, 14, 0, 1, EASE.exit);
const ev = evolvePath(p, d);
<svg><path d={d} fill="none" stroke="#FFD84D" strokeWidth={8} strokeLinecap="round"
  strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} /></svg>
```

#### 27. Flèche courbe animée
- Même principe : tracé du corps 12 images, puis la pointe apparaît avec un `spring` `pop` (rotation alignée sur la tangente de fin, `getPointAtLength`/`getTangentAtLength` de `@remotion/paths`).

#### 28. Spotlight (tout s'assombrit sauf la zone utile)
- **Quand** : faire lire un champ précis sans zoomer (ou en complément d'un zoom léger).
- **Durée** : 10-12 images `EASE.std`, assombrissement à 60-70 %.
```tsx
const a = tween(f, 0, 10, 0, 0.65, EASE.std);
<AbsoluteFill style={{background: `radial-gradient(ellipse 260px 120px at ${bx}px ${by}px, transparent 95%, rgba(0,0,0,${a}) 100%)`}} />
```

#### 29. Tap / clic simulé (doigt + onde)
- **Quand** : chaque action ; c'est ce qui rend la démo « vivante ».
- **Durée** : doigt (ou curseur) se déplace 12-18 images `EASE.inOut` ; appui : échelle 1 → 0,9 → 1 sur 6 images ; onde : cercle 0 → 90 px, opacité 0,5 → 0 en 14 images ; **le bouton de l'UI s'enfonce** (scale 0,96) au même instant ; l'écran change 3-4 images après.
```tsx
const t = f - fTap;
const onde = tween(t, 0, 14, 0, 1, EASE.out);
<div style={{position: 'absolute', left: bx - 45, top: by - 45, width: 90, height: 90, borderRadius: 45,
  border: '4px solid white', transform: `scale(${onde})`, opacity: t < 0 ? 0 : 0.5 * (1 - onde)}} />
```

#### 30. Compteur qui défile
- **Quand** : « 3 plateformes », « 12 posts programmés », « 0 € » ; statistiques.
- **Durée** : 20-30 images, `EASE.out` (ralentit vers la valeur finale), petit `pop` à l'arrivée ; chiffres en `font-variant-numeric: tabular-nums` pour qu'ils ne dansent pas.
```tsx
const v = Math.round(tween(f, 0, 24, 0, 12, EASE.out));
const s = 1 + 0.12 * Math.max(0, 1 - spring({frame: f - 24, fps, config: SPRING.pop}));
<span style={{fontVariantNumeric: 'tabular-nums', transform: `scale(${f >= 24 ? s : 1})`, display: 'inline-block'}}>{v}</span>
```

#### 31. Éléments d'UI qui « vivent » (notifications, toasts, badges)
- **Quand** : une notification « Publié sur TikTok ✓ » qui descend du haut, un badge qui compte.
- **Durée** : entrée 9-11 images `spring` `vif` (≈ 300-375 ms [16]), tenue 45 images, sortie 6 images `EASE.exit`.

#### 32. Défilement réel dans la capture (scroll)
- **Quand** : liste de posts, grille ; une capture longue (390×2400) défile dans le cadre du téléphone.
- **Durée** : 30-45 images, `Easing.bezier(0.25, 0.1, 0.25, 1)` + petit dépassement (`spring` doux) pour imiter l'inertie iOS.

### F. Finition

#### 33. Flou de mouvement
- Sur tous les mouvements rapides (whip, zoom-through, arrivée du téléphone) : `<CameraMotionBlur shutterAngle={180} samples={8}>` (défauts 180° / 10 ; 5-10 échantillons conseillés ; multiplie le temps de rendu) [10]. Screen Studio applique séparément du flou au curseur, au zoom et au pan [21].

#### 34. Fond vivant
- Dégradé qui tourne lentement (`conic-gradient` avec angle = `f * 0.3`), formes floues qui dérivent (`noise2D`), grain léger : **le fond ne doit jamais être une couleur fixe**.

---

## 4. Règles de rythme

1. **Un changement visuel notable toutes les 1 à 2 s, un plan toutes les ~1,2 s en moyenne dans les pubs sociales « cinématiques »** (corpus de 99 pubs Meta/TikTok : 17,9 s, 15,2 plans, plans de 0,5 à 7,5 s) [1]. Pour une démo d'app où il faut lire l'écran, viser **un « événement » (coupe, zoom, tap, texte, notification) toutes les 1 à 1,5 s** et **une coupe ou un grand mouvement de caméra toutes les 2 à 3 s**. (Le « toutes les 2-3 s » circule sur des blogs non officiels [24] ; seul le chiffre de Law et al. est une mesure.)
2. **Accroche** : la proposition dans les **3 premières secondes**, l'accroche entière avant **6 s** [2] ; marque + message avant **5 s** [5]. Donc l'image 0 doit déjà bouger, et le nom « Chapote CM » + le bénéfice doivent être dits/affichés avant l'image 150.
3. **Texte** : 5-10 mots/s maximum [2] ; un titre de 3 mots tient 1 à 1,5 s.
4. **Jamais d'immobilité** : pendant une tenue de lecture, au moins un micro-mouvement (push-in 1→1,04, tremble 3 px, fond qui dérive).
5. **Varier les durées** : les films alternent plans courts et longs (motif de variation en 1/f décrit par Cutting et al., indépendant de la durée moyenne) [25][26] ; ne pas couper métronomiquement : 3 coupes rapides (0,5-0,8 s) puis un plan de lecture de 2-3 s.
6. **Appuyer la cadence sur la voix et la musique** : coupes sur les temps (22,2 % du corpus [1]) et sur les mots forts de l'horodatage TTS.
7. **Laisser lire avant de bouger** : petite pause (6-10 images) avant un mouvement de caméra quand l'écran contient du texte [23] ; style de caméra qui se pose vite quand il faut lire [21].
8. **Durées d'UI** : animations d'éléments de 7 à 12 images (225-400 ms) [16] ; mouvements de caméra 15-30 images ; whip 8-12 images.
9. **Zone sûre** : rien d'important dans le haut, le bas et les côtés du 9:16 [4] ; en pratique zoomer pour que la zone visée tombe au centre.
10. **Son** : chaque transition et chaque tap a son bruitage (whoosh, clic) — Meta et TikTok insistent sur le son [2][4].

---

## 5. Recette : vidéo verticale de 24 s « Programme tes vidéos sur 3 réseaux en 1 clic »

1080×1920, 30 i/s, 720 images. Musique ~120 BPM (1 temps = 15 images). Voix off horodatée. Fond vivant permanent (effet 34), sous-titres mot à mot (effet 22) en bas de la zone sûre.

| # | Images | Durée | Voix (exemple) | Image | Effets (n°) | Changements visuels |
|---|---|---|---|---|---|---|
| 1 | 0-45 | 1,5 s | « Tu postes encore à la main sur 3 réseaux ? » | 3 logos (TikTok, Reels, Shorts) qui tombent et s'empilent, mot-titre « 3 RÉSEAUX » | 23, 31, 8 (punch sur « 3 ») | 3 |
| 2 | 45-75 | 1 s | « Stop. » | Coupe sur le temps : écran noir, « STOP » géant, flash | 17, 21 | 1 |
| 3 | 75-150 | 2,5 s | « Avec Chapote CM, c'est gratuit… » | Téléphone qui arrive incliné (spring lourd) avec parallax, logo sur l'écran ; compteur « 0 € » | 9, 11, 30 | 3 |
| 4 | 150-225 | 2,5 s | « …tu déposes ta vidéo… » | Pull-in dans l'écran (téléphone → écran plein cadre), tap sur « Ajouter », onde, la vignette vidéo glisse dans la carte | 6 (inverse), 29, 19 | 3 |
| 5 | 225-300 | 2,5 s | « …tu écris ta légende une fois… » | Zoom ×2,2 sur le champ légende, le texte se tape lettre à lettre, spotlight | 2, 28, 22 | 3 |
| 6 | 300-360 | 2 s | « …tu coches les 3 plateformes… » | Pan vers les cases ; 3 taps rapides cadencés sur 3 temps, chaque case fait un pop | 4, 29 ×3, 17 | 4 |
| 7 | 360-435 | 2,5 s | « …et tu choisis l'heure. » | Match cut : la case cochée devient l'horloge ; clockWipe vers le calendrier, cercle dessiné autour de « 18 h 00 » | 15, 18, 26 | 3 |
| 8 | 435-465 | 1 s | « Programmé ! » | Tap sur « Programmer », iris depuis le bouton, notification « ✓ Programmé » | 29, 19, 31 | 3 |
| 9 | 465-555 | 3 s | « Et à 18 h, c'est publié partout. » | Whip pan → split-screen des 3 plateformes qui montent en décalé, notifications « Publié » sur chacune | 5, 14, 31 | 4 |
| 10 | 555-630 | 2,5 s | « Même depuis ton ordi. » | Screen-in-screen : écran ordinateur 1280×800 incliné → on plonge dans le téléphone posé à côté | 12, 9 | 2 |
| 11 | 630-720 | 3 s | « Chapote CM. Gratuit. cm.chapote.fr » | Téléphone 3D qui pivote (Three) jusqu'au logo, mot-titre en masque de ligne, URL, flou de mouvement | 10, 24, 33 | 3 |

Total : **11 plans en 24 s (2,2 s en moyenne)** et **~32 changements visuels** (un toutes les ~0,75 s), plus lent que la moyenne des pubs cinématiques [1] parce qu'il faut lire l'interface, mais sans aucune seconde immobile. Marque et bénéfice dits avant 5 s (plan 3, image 75-150) [5].

Squelette Remotion :
```tsx
export const PromoProgrammer: React.FC = () => (
  <AbsoluteFill>
    <FondVivant />
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={45}><P1Logos /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={30}><P2Stop /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={75}><P3Telephone /></TransitionSeries.Sequence>
      {/* P4 à P8 : une seule séquence continue avec <Camera> pour que la caméra "voyage" dans l'app */}
      <TransitionSeries.Sequence durationInFrames={315}><P4a8DemoCamera /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({direction: 'from-right'})} timing={linearTiming({durationInFrames: 10})} />
      <TransitionSeries.Sequence durationInFrames={100}><P9Split /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={75}><P10Ordi /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={90}><P11Final3D /></TransitionSeries.Sequence>
    </TransitionSeries>
    <SousTitres mots={motsTTS} />
    <Audio src={staticFile('musique.mp3')} />
    {bruitages.map(b => <Sequence key={b.f} from={b.f}><Audio src={staticFile(b.son)} /></Sequence>)}
  </AbsoluteFill>
);
```
Point clé : **les plans 4 à 8 sont une seule séquence pilotée par une liste d'images clés de caméra** (`Cle[]`) et une liste d'événements (`taps`, `textes`, `ecrans`) calés sur les mots de la voix. C'est ce qui donne l'impression de « voyager » dans l'app au lieu de juxtaposer des captures.

Génération automatique suggérée : un `plan.json` par vidéo décrit chaque plan (`capture`, `cible: {x, y}` en pixels de la capture, `action: tap|saisie|scroll`, `mot_declencheur`) ; le code calcule les images clés de caméra (aller 20 images avant le mot, tenue, retour) et les événements.

---

## 6. Erreurs qui rendent une vidéo statique

1. **Un seul plan pour toute la vidéo** (le téléphone au centre du début à la fin).
2. **Animer l'objet au lieu de la caméra** : un téléphone qui grossit de 5 % n'est pas un mouvement de caméra ; il faut cadrer, recadrer, plonger.
3. **Easing linéaire ou `ease` par défaut sur tout** : aucun accent, tout se ressemble ; il faut des entrées rapides qui se posent (`emph`, expo out) et des ressorts.
4. **Même durée pour tout** (tout en 0,5 s, tout en 1 s) : rythme de diaporama. Varier [25].
5. **Le texte fait tout le travail** (texte qui pop sur une image fixe) : l'image doit raconter l'action (tap, saisie, changement d'écran).
6. **Pas d'interaction simulée** : une capture d'écran sans doigt, sans clic, sans état qui change ne montre pas le produit fonctionner.
7. **Zoom trop faible** (×1,1) : l'UI 390×844 reste illisible sur un téléphone ; zoomer ×2 et plus sur la zone utile.
8. **Tenues sans micro-mouvement** et fond uni fixe.
9. **Transitions toutes identiques** (que des fondus) ; ou au contraire 10 transitions fantaisie différentes sans logique.
10. **Mouvements qui ne correspondent pas à la voix** : le zoom arrive après que la voix en a parlé ; caler sur l'horodatage TTS (le mouvement commence 5-10 images **avant** le mot).
11. **Accroche lente** : logo animé pendant 2 s au début ; la proposition doit être là avant 3 s [2].
12. **Silence visuel au son** : pas de whoosh ni de clic, les mouvements paraissent mous.
13. **Contenu hors zone sûre** : texte sous la légende ou sous les boutons de l'app [4].

---

## 7. Grille de notation du dynamisme (sur 10)

À remplir pour chaque vidéo avant publication (peut être automatisée en partie à partir du `plan.json` et de la timeline).

| Critère | 0 point | 0,5 point | 1 point |
|---|---|---|---|
| 1. Cadence des événements | < 1 événement / 3 s | 1 / 2-3 s | ≥ 1 / 1,5 s (coupe, zoom, tap, texte, notification) |
| 2. Cadence des plans | 1-2 plans | 3-6 plans | ≥ 7 plans / 25 s (ou plan-séquence avec ≥ 7 recadrages) |
| 3. Accroche | rien ne bouge à l'image 0, message après 6 s | message entre 3 et 6 s | mouvement dès l'image 0, proposition < 3 s, marque < 5 s [2][5] |
| 4. Caméra qui voyage | aucun mouvement de caméra | push-in seulement | ≥ 3 types (zoom sur zone, pan, whip, pull-back, screen-in-screen) |
| 5. Interaction visible | captures fixes | état qui change sans geste | taps/saisies simulés avec retour visuel (onde, bouton enfoncé) |
| 6. Easing et physique | tout linéaire | une seule courbe partout | entrées rapides qui se posent + ressorts adaptés à chaque type d'objet |
| 7. Variété des transitions | coupes sèches seules ou fondus seuls | 2 types | ≥ 3 types motivés (match cut, masque depuis l'élément, whip, coupe sur le temps) |
| 8. Synchronisation voix / musique | aucune | partielle | mouvements calés sur les mots et les temps (punch, coupes) |
| 9. Profondeur | à plat, fond uni | ombre ou inclinaison simple | parallax, 3D ou inclinaison + fond vivant |
| 10. Lisibilité malgré le mouvement | texte illisible / hors zone sûre | parfois | chaque texte lisible ≥ 1 s, en zone sûre, ≤ 10 mots/s [2][4] |

Lecture : **≤ 4 statique**, 5-6 correct, **7-8 dynamique**, 9-10 niveau « vidéo de lancement ». Viser ≥ 7 pour publier. Les vidéos actuelles (un téléphone, un zoom, du texte qui pop) obtiendraient ≈ 2-3 (critères 3, 6, 10 partiellement).

---

## 8. Références de studios, outils et tutoriels

- **Screen Studio** : zooms automatiques générés depuis les clics, curseur lissé (Smooth/Medium/Rapid/None), deux styles de caméra (Focused / Smooth), flou de mouvement séparé pour curseur, zoom et pan [20][21]. Modèle direct pour nos effets 2, 3 et 33. Outils similaires cités : Camtasia, FocuSee, Cursorful [27].
- **Rotato** : mockups 3D animés par images clés de caméra ; 14 idées de vidéos (reveal, explosion des artboards, étiquettes qui suivent, détails sans mots puis recul…) ; tutoriel de pan moniteur → téléphone avec pause initiale [22][23][28].
- **Remotion `template-three`** : téléphone 3D avec écran vidéo, paramétrable [15].
- **Linear, Arc, Notion, Raycast** : aucune « making-of » publique trouvée pour leurs films de lancement (recherche infructueuse) ; on ne cite donc aucun chiffre à leur sujet. Leurs vidéos restent des références visuelles à regarder image par image (cadrages serrés sur l'UI, transitions par masque, typographie en masque de ligne).
- **TikTok Creative Codes / Creative best practices**, **Meta Reels** : règles d'accroche, de texte et de zone sûre [2][3][4][5].

---

## Sources

1. Law, Li, Narechania, *How Do Professional Editors Evaluate the Editing Quality of AI-Generated Cinematic Video Ads?*, arXiv 2608.24329 (2026), §4.2.1-4.2.2 et §5.1.2 — https://arxiv.org/pdf/2608.24329
2. TikTok Ads, *Creative best practices for performance ads* — https://ads.tiktok.com/help/article/creative-best-practices?lang=en
3. TikTok, *Creative Codes* — https://ads.tiktok.com/business/library/Creative_Codes_ENG.pdf
4. Meta for Developers, *Unlock the power of Reel ads* (zone sûre, son) — https://developers.facebook.com/blog/post/2024/11/07/unlock-the-power-of-reel-ads/
5. Search Engine Land, *Meta native Reels ads can lift purchase intent 5.3x* — https://searchengineland.com/meta-native-reels-ads-can-lift-purchase-intent-5-3x-465615
6. Remotion, *Easing* — https://www.remotion.dev/docs/easing
7. Remotion, *spring()* — https://www.remotion.dev/docs/spring
8. Remotion, *TransitionSeries* — https://www.remotion.dev/docs/transitions/transitionseries
9. Remotion, *Presentations* — https://www.remotion.dev/docs/transitions/presentations
10. Remotion, *CameraMotionBlur* — https://www.remotion.dev/docs/motion-blur/camera-motion-blur
11. Remotion, *@remotion/motion-blur* — https://www.remotion.dev/docs/motion-blur/
12. Remotion, *evolvePath()* — https://www.remotion.dev/docs/paths/evolve-path
13. Remotion, *noise2D()* — https://www.remotion.dev/docs/noise/noise-2d
14. Remotion, *@remotion/three* et *ThreeCanvas* — https://www.remotion.dev/docs/three , https://www.remotion.dev/docs/three-canvas , https://www.remotion.dev/docs/videos/as-threejs-texture
15. GitHub, *remotion-dev/template-three* — https://github.com/remotion-dev/template-three
16. Material Design (v1), *Duration & easing* — https://m1.material.io/motion/duration-easing.html
17. Material Components Android, *Motion* (courbes M3) — https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md
18. Apple, WWDC23 *Animate with springs* — https://developer.apple.com/videos/play/wwdc2023/10158/
19. WWDC Notes, *Animate with springs* (valeurs de rebond, source tierce) — https://wwdcnotes.com/notes/wwdc23/10158
20. Screen Studio, *Guide* — https://www.screen.studio/help
21. Screen Studio, *Look & Feel — Animations* — https://screen.studio/guide/animations
22. Rotato, *14 video mockup ideas and examples* — https://rotato.app/blog/mockup-video-examples
23. Rotato, *How to pan from a monitor mockup to a phone mockup on the desk* — https://rotato.app/blog/monitor-to-phone-transition
24. Analytics Insight, *TikTok Editing Tricks…* (chiffre non officiel « toutes les 2-3 s ») — https://www.analyticsinsight.net/photo/tiktok-editing-tricks-that-can-make-your-video-viral-instantly
25. Cornell Chronicle, *Pattern in movies mimics that found in our brain* (150 films, 1935-2005, ~4 s par plan aujourd'hui) — https://news.cornell.edu/node/271563
26. Cutting et al., PMC — https://pmc.ncbi.nlm.nih.gov/articles/PMC3485803
27. Data Studios, *Screen Studio: Auto-Zoom Mechanism…* (source tierce) — https://www.datastudios.org/post/screen-studio-auto-zoom-mechanism-mac-only-limits-and-pricing-explained
28. Rotato, *Quick start video* (images clés de caméra) — https://rotato.app/help/quick-start-video
