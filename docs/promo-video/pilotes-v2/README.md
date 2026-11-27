# Pilotes v2 : comment ces vidéos sont faites

Trois vidéos verticales refaites le 27/11/2026 selon [le guide](../README.md), visibles sur `cm.chapote.fr/promo` (superadmin).
Ce dossier garde le code pour refaire les 32 autres et pour l'app.

| Fichier | Rôle |
|---|---|
| `capture-pilotes.js` | Captures des vrais écrans de l'app (`cm/dist` + API simulée, données de démo) **avec la position de chaque bouton** (`*.boites.json`) : la caméra vise juste, les taps tombent sur le bon bouton. |
| `demo-data-pilote.js` | Données fictives de la démo (Atelier Lumen, Café des Arts, Studio Nova ; e-mails en @example.com). Les médias de démo (`media/` : vidéo et vignettes) ne sont pas dans git. |
| `voix/*.txt` | Scripts dits (une phrase par ligne = un plan). |
| `pilotes.mjs` | Chaîne complète : voix (silences > 0,2 s ramenés à 0,13 s, tempo ×1,1, EQ présence, compresseur, de-esser, limiteur) → plans calés sur les mots (`at(ligne, 'mot')`) → rendu Remotion → **-14 LUFS / -1 dBTP** (2 passes + limiteur) → contrôles automatiques (`*.controles.json`). |
| `Pilote.tsx` | Composition Remotion : caméra virtuelle (zoom, glissés, recul, inclinaison 3D, léger tremblé, flou de vitesse), taps simulés (doigt + onde), surbrillances, masques « avant le tap » (case non cochée, comptes pas encore choisis), ✓ « publiée », typographie cinétique, scène « avant » (applis qui s'empilent, horloge qui tourne), écran partagé avant/après, fin animée ; accroche dès l'image 0 (y 330-530), sous-titres 2-3 mots dans y 1030-1240, un mot-clé orange ; musique baissée sous la voix (ducking calculé depuis les mots) ; effets sur chaque action. |
| `recoller.py` | Refait une seule phrase de la voix (essais bornés à 6 min, contrôle Whisper) et la recolle avec ses mots horodatés. |
| `licences.json` | Musique (Kevin MacLeod, CC BY 4.0 : **crédit obligatoire dans la légende**) et effets. |

## Ce qu'on a appris en les faisant

- Qwen3 0.6B sur CPU : « Stop. » sort « Top. », « Gratuit » en début de phrase sort « Atui » ; une génération peut s'emballer (35 min, 8,5 Go) : borner chaque essai.
- Whisper entend « chapeau de » pour « Chapote » si on ne lui donne pas le mot (`initial_prompt='Chapote CM'`) : ce n'était pas la voix.
- Les jetons sans lettres (« : », « ! ») et les apostrophes (« l 'envoies ») décalent le calage des sous-titres : les filtrer / fusionner.
- Flou de vitesse fort = images floues la moitié du temps : plafonné à 3,5 px (16 px sur un glissé d'entrée).
