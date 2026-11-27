// Plan de lancement de Chapote CM : une semaine de contenu, toutes plateformes (page /promo, réservée au superadmin).
// Rien n'est publié d'ici : c'est un brouillon à relire. Sources des faits : api/scripts/cm_assistant/kb/*.md,
// mobile/store/PLAY_STORE.md, cm/src/pages/Landing.tsx, cm/src/legal/*.md. Règles tenues partout :
// - aucune fonction absente du code (pas de « commentaires » : fonction non proposée), aucun chiffre inventé ;
// - Android : « en test, bientôt sur Google Play » (lien du Play Store encore vide) ; iPhone : seulement si on la demande ;
// - gratuit « pour l'instant », sans carte bancaire ; rien ne part sans validation ; vidéos dans le Drive de l'utilisateur.

export type Plateforme = 'youtube' | 'instagram' | 'tiktok' | 'linkedin' | 'x'

export const COMPTES: Record<Plateforme, { nom: string; url: string }> = {
  youtube: { nom: 'YouTube @chapotecm', url: 'https://www.youtube.com/@chapotecm' },
  instagram: { nom: 'Instagram @chapote.cm', url: 'https://www.instagram.com/chapote.cm/' },
  tiktok: { nom: 'TikTok @chapote.cm', url: 'https://www.tiktok.com/@chapote.cm' },
  linkedin: { nom: 'LinkedIn Chapote', url: 'https://www.linkedin.com/company/chapote' },
  x: { nom: 'X @chapotecm', url: 'https://x.com/chapotecm' },
}

export interface Plan { t: string; voix?: string; ecran: string }
export interface Visuel {
  /** capture : vraie capture de l'app ; image : fond généré (Gemini) avec titre posé par la page. */
  type: 'capture' | 'image'
  src: string
  format: 'portrait' | 'paysage' | 'carre' | 'story'
  titre?: string
  sous?: string
}
export interface Piece {
  id: string
  heure: string
  format: string
  plateformes: Plateforme[]
  duree?: string
  titre: string
  accroche?: string
  script?: Plan[]
  /** Texte publié (légende, post, description). Par plateforme quand il diffère. */
  textes: Partial<Record<Plateforme | 'commun', string>>
  titreYoutube?: string
  hashtags?: string[]
  visuels?: Visuel[]
  prod?: string
}
export interface Jour { date: string; nom: string; theme: string; but: string; pieces: Piece[] }

const L = 'https://cm.chapote.fr'
const TAGS = ['#communitymanager', '#reseauxsociaux', '#tiktok', '#reels', '#shorts']

// Chaîne de production commune (dépôt claude-cloud) : voix Qwen3 (serveur du PC), mots horodatés (Whisper),
// motion design Remotion, vraies captures d'un compte de démonstration (aucune donnée réelle), sous-titres.
const PROD_VERTICALE = 'Vidéo verticale 1080×1920 : voix Qwen3 (voix de référence FR expressive), mots horodatés, montage Remotion sur des captures d\'un compte de démo, sous-titres. Publiée par Chapote CM lui-même sur les 3 réseaux.'

export const SEMAINE: Jour[] = [
  {
    date: 'lun. 30 nov.', nom: 'Lundi', theme: 'Lancement', but: 'Dire que Chapote CM existe, qui l\'a fait et pourquoi.',
    pieces: [
      {
        id: 'l-yt', heure: '18:00', format: 'Vidéo YouTube (16:9)', plateformes: ['youtube'], duree: '7-8 min',
        titre: 'J\'avais 6 comptes et 3 applis : j\'ai codé mon propre outil',
        titreYoutube: 'Gérer TikTok, YouTube Shorts et Instagram en une fois : j\'ai créé Chapote CM (gratuit)',
        accroche: 'Six comptes. Trois applis. Les mêmes vidéos partout. Et chaque soir, la même galère.',
        script: [
          { t: '0:00', voix: 'Six comptes. Trois applis. Les mêmes vidéos partout. Et chaque soir, la même galère.', ecran: 'Face caméra ou voix off sur trois téléphones qui sonnent' },
          { t: '0:20', voix: 'Au départ j\'avais un compte Instagram, puis un deuxième, puis TikTok et YouTube pour plus de visibilité. Publier régulièrement demandait de planifier… et je perdais le fil.', ecran: 'Schéma animé : 1 compte → 6 comptes, plannings qui s\'empilent' },
          { t: '1:30', voix: 'Alors j\'ai fait l\'outil, pour moi. Il s\'appelle Chapote CM.', ecran: 'Logo, cm.chapote.fr' },
          { t: '1:50', voix: 'Démo : je connecte mes comptes par les pages officielles de TikTok, Google et Meta. Chapote CM ne voit jamais mes mots de passe.', ecran: 'Capture : page Comptes, boutons de connexion' },
          { t: '3:00', voix: 'J\'envoie la vidéo une fois, je choisis les comptes, une légende commune ou une par compte, et l\'heure. Rien ne part avant.', ecran: 'Capture : Nouvelle publication, 2 étapes' },
          { t: '4:30', voix: 'Le planning : toute la semaine, et le statut de chaque vidéo sur chaque réseau.', ecran: 'Capture : Planning' },
          { t: '5:30', voix: 'Les statistiques des trois réseaux au même endroit, et mes vidéos qui restent dans mon Google Drive.', ecran: 'Captures : Stats, Bibliothèque' },
          { t: '6:30', voix: 'C\'est gratuit pour l\'instant, sans carte bancaire. Ce qui compte pour la suite, ce sont vos retours.', ecran: 'Bouton « Planifier mes vidéos gratuitement », lien en description' },
          { t: '7:20', voix: 'Dites-moi en commentaire ce qui vous manque. Et si vous voulez l\'app iPhone, dites-le aussi.', ecran: 'Fin : cm.chapote.fr' },
        ],
        textes: {
          youtube: `Chapote CM, c'est l'outil que j'ai créé pour planifier mes vidéos courtes sur TikTok, YouTube Shorts et Instagram Reels, sur tous mes comptes en une fois.

👉 Essayer gratuitement (sans carte bancaire) : ${L}

Dans la vidéo :
0:00 Le problème : 6 comptes, 3 applis
1:30 Chapote CM
1:50 Connecter ses comptes (connexion officielle)
3:00 Programmer une vidéo partout
4:30 Le planning
5:30 Statistiques et Google Drive
6:30 Prix et suite

Questions, idées, bugs : ${L}/avis
#communitymanager #tiktok #youtubeshorts #instagramreels`,
        },
        visuels: [{ type: 'image', src: '/promo/yt-lancement.webp', format: 'paysage', titre: '6 COMPTES, 1 OUTIL', sous: 'TikTok · Shorts · Reels' }],
        prod: 'Vidéo horizontale 1920×1080 : enregistrement d\'écran du compte de démo (site), voix Qwen3 ou ta voix, chapitres. Miniature ci-dessus.',
      },
      {
        id: 'l-v', heure: '12:30', format: 'Vidéo verticale', plateformes: ['instagram', 'tiktok', 'youtube'], duree: '30 s',
        titre: 'Planifie une fois. Publie partout.',
        accroche: 'Tu postes la même vidéo sur TikTok, Insta et YouTube… à la main ?',
        script: [
          { t: '0-3 s', voix: 'Tu postes la même vidéo sur TikTok, Insta et YouTube… à la main ?', ecran: 'Trois téléphones, même vidéo, pouce qui fatigue' },
          { t: '3-10 s', voix: 'Avec Chapote CM, tu l\'envoies une fois.', ecran: 'Capture : Nouvelle publication, choix de la vidéo' },
          { t: '10-18 s', voix: 'Tu coches tes comptes, une légende pour tous ou une par compte, et l\'heure.', ecran: 'Comptes cochés TikTok, YouTube, Instagram, horloge' },
          { t: '18-25 s', voix: 'Et elle part à l\'heure, partout. Le planning te montre où elle en est.', ecran: 'Capture : Planning, statuts « publiée »' },
          { t: '25-30 s', voix: 'C\'est gratuit. Lien dans la bio.', ecran: 'cm.chapote.fr' },
        ],
        textes: {
          instagram: `Planifie une fois. Publie partout. 🚀
Une vidéo, tous tes comptes TikTok, YouTube et Instagram, à l'heure que tu choisis.
Gratuit, sans carte bancaire. Lien en bio.
Tu gères combien de comptes ? 👇
${TAGS.join(' ')}`,
          tiktok: 'Tu postes encore la même vidéo à la main sur 3 applis ? 😅 Chapote CM la publie partout à l\'heure choisie. Gratuit : cm.chapote.fr #communitymanager #tiktoktips #reels #shorts',
          youtube: 'Une vidéo, tous tes comptes TikTok, YouTube et Instagram. Gratuit : cm.chapote.fr #Shorts #communitymanager',
        },
        titreYoutube: 'Publier sur TikTok, YouTube et Instagram en une fois #Shorts',
        visuels: [{ type: 'capture', src: '/promo/planning.webp', format: 'portrait' }],
        prod: PROD_VERTICALE,
      },
      {
        id: 'l-story', heure: '19:00', format: 'Stories (3 écrans)', plateformes: ['instagram', 'tiktok'],
        titre: 'Sondage : combien de comptes ?',
        script: [
          { t: 'Écran 1', ecran: 'Fond Chapote + « C\'est le lancement 🎉 Chapote CM est ouvert à tous » + sticker lien cm.chapote.fr' },
          { t: 'Écran 2', ecran: 'Sondage « Tu gères combien de comptes ? » : 1 / 2-3 / 4 et +' },
          { t: 'Écran 3', ecran: 'Capture Planning + « Tout au même endroit » + sticker lien' },
        ],
        textes: { commun: 'Sticker lien : cm.chapote.fr · Sondage : « Tu gères combien de comptes ? »' },
        visuels: [{ type: 'image', src: '/promo/story-fond.webp', format: 'story', titre: 'Chapote CM est ouvert à tous 🎉', sous: 'Tu gères combien de comptes ?' }],
        prod: 'Story Instagram native (sondage et lien = stickers ajoutés à la main dans l\'app). TikTok : même visuel en story.',
      },
      {
        id: 'l-li', heure: '08:30', format: 'Post LinkedIn', plateformes: ['linkedin'],
        titre: 'Annonce du lancement',
        textes: {
          linkedin: `Community managers, créateurs, agences : publier la même vidéo sur TikTok, YouTube Shorts et Instagram Reels ne devrait pas prendre trois fois plus de temps.

J'ai lancé Chapote CM pour ça.

→ Vous envoyez la vidéo une fois
→ Vous choisissez les comptes (plusieurs par réseau) et l'heure
→ Le planning de la semaine montre le statut de chaque publication
→ Les statistiques des trois réseaux sont réunies
→ Vos vidéos restent dans votre Google Drive

Connexion par les pages officielles de TikTok, Google et Meta : l'outil ne voit jamais vos mots de passe.

C'est gratuit pour l'instant, sans carte bancaire : ${L}

Je cherche surtout des retours de personnes qui publient tous les jours. Qu'est-ce qui vous fait perdre le plus de temps aujourd'hui ?`,
        },
        hashtags: ['#communitymanagement', '#socialmedia', '#marketingdigital'],
        visuels: [{ type: 'image', src: '/promo/linkedin-lancement.webp', format: 'carre', titre: 'Une vidéo. Tous vos comptes.', sous: 'Chapote CM · gratuit' }],
        prod: 'Publié sur la page Chapote, puis partagé depuis ton profil perso avec une phrase à toi (les posts perso portent bien plus).',
      },
      {
        id: 'l-x', heure: '12:00', format: 'Thread X (4 posts)', plateformes: ['x'],
        titre: 'Le pourquoi en 4 posts',
        textes: {
          x: `1/ J'avais 6 comptes (Insta, TikTok, YouTube) et les mêmes vidéos partout. Chaque réseau, son appli, son planning. J'ai fini par coder mon outil : Chapote CM 🧵

2/ Tu envoies la vidéo une fois, tu choisis les comptes et l'heure. Rien ne part avant. Une légende commune ou une par compte.

3/ Le planning de la semaine, le statut sur chaque réseau, les stats réunies. Les vidéos restent dans ton Google Drive.

4/ C'est gratuit pour l'instant : ${L}
Dis-moi ce qui te manque 👇`,
        },
        prod: 'Épingler le thread sur le profil la première semaine.',
      },
    ],
  },
  {
    date: 'mar. 1 déc.', nom: 'Mardi', theme: 'Le planning', but: 'Montrer la vue semaine et les statuts : la promesse « je sais où en sont mes vidéos ».',
    pieces: [
      {
        id: 'ma-v', heure: '12:30', format: 'Vidéo verticale', plateformes: ['instagram', 'tiktok', 'youtube'], duree: '25 s',
        titre: 'Ta semaine de publications en un coup d\'œil',
        accroche: 'Ta vidéo est partie… ou pas ?',
        script: [
          { t: '0-3 s', voix: 'Ta vidéo est partie… ou pas ?', ecran: 'Visage-émoji qui hésite, trois logos' },
          { t: '3-12 s', voix: 'Dans Chapote CM, le planning montre ta semaine jour par jour : ce qui est programmé, parti ou en échec.', ecran: 'Capture : Planning, défilement des jours' },
          { t: '12-20 s', voix: 'Et chaque publication affiche son statut sur chaque réseau.', ecran: 'Capture : fiche d\'une publication, TikTok / YouTube / Instagram' },
          { t: '20-25 s', voix: 'Un échec ? Réessayer, en un clic.', ecran: 'Bouton « Réessayer »' },
        ],
        textes: {
          instagram: `Ta semaine de publications en un coup d'œil 👀
Programmée, partie ou en échec : chaque vidéo, sur chaque réseau.
Gratuit → lien en bio
${TAGS.join(' ')}`,
          tiktok: 'Ta vidéo est partie ou pas ? 👀 Le planning de Chapote CM te le dit, réseau par réseau. #communitymanager #planning #tiktoktips',
          youtube: 'Le planning de toutes tes vidéos, réseau par réseau #Shorts',
        },
        titreYoutube: 'Ta semaine de publications en un coup d\'œil #Shorts',
        visuels: [{ type: 'capture', src: '/promo/publication.webp', format: 'portrait' }],
        prod: PROD_VERTICALE,
      },
      {
        id: 'ma-story', heure: '19:00', format: 'Stories (2 écrans)', plateformes: ['instagram', 'tiktok'],
        titre: 'Quiz : ton jour de publication',
        script: [
          { t: 'Écran 1', ecran: 'Quiz « Quel jour tu publies le plus ? » Lundi / Mercredi / Vendredi / Week-end' },
          { t: 'Écran 2', ecran: 'Capture Planning + « Programme toute la semaine le dimanche soir » + lien' },
        ],
        textes: { commun: 'Quiz + sticker lien cm.chapote.fr' },
        visuels: [{ type: 'capture', src: '/promo/planning.webp', format: 'story', titre: 'Quel jour tu publies le plus ?' }],
      },
      {
        id: 'ma-x', heure: '18:00', format: 'Post X', plateformes: ['x'], titre: 'Astuce planning',
        textes: { x: `Astuce de CM : programme toute ta semaine le dimanche soir, puis vérifie un seul écran chaque jour.\nC'est exactement pour ça que j'ai fait le planning de Chapote CM : programmé, parti, en échec, sur chaque réseau.\n${L}` },
      },
    ],
  },
  {
    date: 'mer. 2 déc.', nom: 'Mercredi', theme: 'Google Drive et confiance', but: 'Rassurer : vidéos chez soi, mots de passe jamais vus, rien ne part sans validation.',
    pieces: [
      {
        id: 'me-v', heure: '12:30', format: 'Vidéo verticale', plateformes: ['instagram', 'tiktok', 'youtube'], duree: '30 s',
        titre: 'Tes vidéos restent dans TON Drive',
        accroche: 'Où vont tes vidéos quand tu les donnes à une appli ?',
        script: [
          { t: '0-3 s', voix: 'Où vont tes vidéos quand tu les donnes à une appli ?', ecran: 'Vidéo qui s\'envole vers un nuage inconnu' },
          { t: '3-12 s', voix: 'Avec Chapote CM, elles restent dans ton Google Drive. Tu ajoutes un dossier, ses vidéos sont prêtes à programmer.', ecran: 'Capture : Bibliothèque, dossiers Drive' },
          { t: '12-20 s', voix: 'Astuce : un fichier texte du même nom que la vidéo devient sa légende.', ecran: 'video.mp4 + video.txt → légende remplie' },
          { t: '20-27 s', voix: 'Et après publication, tu choisis de les garder ou de les supprimer.', ecran: 'Sous-dossier « Publié »' },
          { t: '27-30 s', voix: 'Gratuit, lien en bio.', ecran: 'cm.chapote.fr' },
        ],
        textes: {
          instagram: `Tes vidéos restent dans TON Google Drive 📁
Astuce : un .txt du même nom que la vidéo = sa légende, déjà remplie.
Gratuit → lien en bio
${TAGS.join(' ')} #googledrive`,
          tiktok: 'L\'astuce .txt qui écrit ta légende toute seule 🤯 (et tes vidéos restent dans ton Drive) #communitymanager #astuce #googledrive',
          youtube: 'Un .txt du même nom que ta vidéo = sa légende #Shorts',
        },
        titreYoutube: 'L\'astuce .txt qui écrit ta légende #Shorts',
        visuels: [{ type: 'capture', src: '/promo/bibliotheque.webp', format: 'portrait' }],
        prod: PROD_VERTICALE,
      },
      {
        id: 'me-li', heure: '08:30', format: 'Post LinkedIn', plateformes: ['linkedin'], titre: 'Confiance et données',
        textes: {
          linkedin: `Confier ses comptes clients à un outil, c'est une question de confiance. Voici les choix qu'on a faits pour Chapote CM :

1. Connexion par les pages officielles de TikTok, Google et Meta. L'outil ne voit jamais les mots de passe, et l'accès se retire à tout moment.
2. Les vidéos restent dans votre Google Drive. Chapote CM ne voit que les fichiers qu'il y range.
3. Rien ne part sans validation : même les brouillons préparés automatiquement attendent votre accord.
4. Hébergement en France, politique de confidentialité publique : ${L}/privacy

Qu'est-ce qui vous fait hésiter avant d'adopter un nouvel outil pour vos comptes ?`,
        },
        hashtags: ['#RGPD', '#socialmedia', '#communitymanagement'],
        visuels: [{ type: 'capture', src: '/promo/drive.webp', format: 'portrait' }],
      },
      {
        id: 'me-story', heure: '19:00', format: 'Story', plateformes: ['instagram', 'tiktok'], titre: 'Astuce .txt',
        script: [{ t: 'Écran 1', ecran: '« Astuce : video.mp4 + video.txt = légende remplie » + capture Bibliothèque + lien' }],
        textes: { commun: 'Sticker lien cm.chapote.fr' },
        visuels: [{ type: 'capture', src: '/promo/bibliotheque.webp', format: 'story', titre: 'video.mp4 + video.txt = légende ✨' }],
      },
    ],
  },
  {
    date: 'jeu. 3 déc.', nom: 'Jeudi', theme: 'Statistiques', but: 'Parler à ceux qui doivent rendre des chiffres (CM, freelances).',
    pieces: [
      {
        id: 'j-v', heure: '12:30', format: 'Vidéo verticale', plateformes: ['instagram', 'tiktok', 'youtube'], duree: '25 s',
        titre: 'Tes chiffres des 3 réseaux, sans tableur',
        accroche: 'Ton rapport mensuel, c\'est encore un tableur ?',
        script: [
          { t: '0-3 s', voix: 'Ton rapport mensuel, c\'est encore un tableur ?', ecran: 'Tableur qui déborde' },
          { t: '3-15 s', voix: 'Chapote CM réunit vues, abonnés, j\'aime, partages et engagement. Sur sept jours, trente, quatre-vingt-dix ou un an.', ecran: 'Capture : Stats, changement de période' },
          { t: '15-22 s', voix: 'Par compte, ou par groupe : un client, un artiste, une chaîne.', ecran: 'Filtre groupe' },
          { t: '22-25 s', voix: 'Lien en bio.', ecran: 'cm.chapote.fr · « données de démo »' },
        ],
        textes: {
          instagram: `Tes chiffres TikTok, YouTube et Instagram réunis 📊
Vues, abonnés, j'aime, partages, engagement. Par compte ou par client.
(chiffres de démonstration dans la vidéo)
Gratuit → lien en bio
${TAGS.join(' ')}`,
          tiktok: 'Ton rapport mensuel en 1 écran, pas en 3 applis 📊 (chiffres de démo) #communitymanager #statistiques',
          youtube: 'Les stats de 3 réseaux sur un seul écran #Shorts',
        },
        titreYoutube: 'Les stats TikTok, YouTube et Instagram réunies #Shorts',
        visuels: [{ type: 'capture', src: '/promo/stats.webp', format: 'portrait' }],
        prod: PROD_VERTICALE + ' Mention « données de démonstration » à l\'écran.',
      },
      {
        id: 'j-story', heure: '19:00', format: 'Story', plateformes: ['instagram', 'tiktok'], titre: 'Question',
        script: [{ t: 'Écran 1', ecran: 'Boîte à questions « Quelle stat tu regardes en premier ? » + capture Stats (démo)' }],
        textes: { commun: 'Boîte à questions' },
        visuels: [{ type: 'capture', src: '/promo/stats.webp', format: 'story', titre: 'Quelle stat tu regardes en premier ?' }],
      },
      {
        id: 'j-x', heure: '18:00', format: 'Post X', plateformes: ['x'], titre: 'Sondage',
        textes: { x: 'Sondage CM : la stat qui compte le plus pour toi ?\n• Vues\n• Abonnés\n• Engagement\n• Partages' },
      },
    ],
  },
  {
    date: 'ven. 4 déc.', nom: 'Vendredi', theme: 'Équipes et agences', but: 'Toucher les freelances et agences multi-clients.',
    pieces: [
      {
        id: 'v-yt', heure: '18:00', format: 'Vidéo YouTube (16:9)', plateformes: ['youtube'], duree: '10 min',
        titre: 'Tuto complet : de zéro à ta première vidéo programmée',
        titreYoutube: 'Tuto Chapote CM : programmer ses vidéos TikTok, Shorts et Reels (de A à Z)',
        script: [
          { t: '0:00', voix: 'En dix minutes, tu vas programmer ta première vidéo sur tes trois réseaux.', ecran: 'Plan du tuto' },
          { t: '0:40', voix: 'Créer son compte, par e-mail ou avec Google.', ecran: 'Inscription' },
          { t: '1:30', voix: 'Connecter TikTok, YouTube et Instagram. Instagram demande un compte professionnel, Créateur ou Entreprise.', ecran: 'Page Comptes' },
          { t: '3:00', voix: 'Ajouter un dossier Google Drive.', ecran: 'Bibliothèque' },
          { t: '4:30', voix: 'Programmer : la vidéo, les comptes, l\'heure, puis les réglages de chaque compte.', ecran: 'Nouvelle publication' },
          { t: '7:00', voix: 'Ranger ses comptes en groupes et inviter quelqu\'un : administrateur, éditeur ou lecteur.', ecran: 'Groupes, Partage' },
          { t: '9:00', voix: 'Suivre le planning et les statistiques.', ecran: 'Planning, Stats' },
        ],
        textes: { youtube: `Tuto complet de Chapote CM, gratuit : ${L}\n\n0:00 Plan\n0:40 Compte\n1:30 Connecter ses réseaux\n3:00 Google Drive\n4:30 Programmer\n7:00 Groupes et équipe\n9:00 Planning et stats` },
        visuels: [{ type: 'image', src: '/promo/yt-tuto.webp', format: 'paysage', titre: 'TUTO COMPLET', sous: 'De 0 à ta 1re vidéo programmée' }],
        prod: 'Enregistrement d\'écran du compte de démo, voix off, chapitres.',
      },
      {
        id: 'v-v', heure: '12:30', format: 'Vidéo verticale', plateformes: ['instagram', 'tiktok', 'youtube'], duree: '30 s',
        titre: 'CM pour plusieurs clients ? Un groupe par client',
        accroche: 'Tu gères les comptes de plusieurs clients ?',
        script: [
          { t: '0-3 s', voix: 'Tu gères les comptes de plusieurs clients ?', ecran: 'Trois dossiers clients' },
          { t: '3-12 s', voix: 'Range-les en groupes : le planning et les stats se filtrent d\'un geste.', ecran: 'Capture : groupes, filtre' },
          { t: '12-24 s', voix: 'Et invite ton équipe : administrateur, éditeur qui peut publier, ou lecteur qui voit sans toucher. Limité à certains groupes si tu veux.', ecran: 'Rôles : couronne, crayon, œil' },
          { t: '24-30 s', voix: 'Ton client voit son planning, sans tes mots de passe. Lien en bio.', ecran: 'cm.chapote.fr' },
        ],
        textes: {
          instagram: `Freelance ou agence ? Un groupe par client 🗂️
Planning et stats filtrés d'un geste. Invite ton équipe ou ton client : admin, éditeur ou lecteur.
Gratuit → lien en bio
${TAGS.join(' ')} #freelance #agence`,
          tiktok: 'CM multi-clients : un groupe par client, et ton client voit son planning en lecture seule 👀 #communitymanager #freelance #agence',
          youtube: 'Gérer plusieurs clients en un seul planning #Shorts',
        },
        titreYoutube: 'Community manager : un groupe par client #Shorts',
        visuels: [{ type: 'image', src: '/promo/equipe.webp', format: 'carre', titre: 'Un groupe par client', sous: 'Admin · Éditeur · Lecteur' }],
        prod: PROD_VERTICALE,
      },
      {
        id: 'v-li', heure: '08:30', format: 'Post LinkedIn', plateformes: ['linkedin'], titre: 'Agences et freelances',
        textes: {
          linkedin: `Freelances et agences social media : comment partagez-vous le planning avec vos clients ?

Dans Chapote CM, on a prévu trois rôles :
• Administrateur : gère tout l'espace
• Éditeur : programme, modifie et annule les publications
• Lecteur : consulte le planning et les statistiques

Chaque personne peut être limitée à certains groupes de comptes. Un client en lecture seule voit son planning et ses chiffres, rien d'autre, et jamais vos accès.

Gratuit pour l'instant : ${L}`,
        },
        hashtags: ['#agence', '#freelance', '#socialmediamanager'],
        visuels: [{ type: 'image', src: '/promo/equipe.webp', format: 'carre', titre: 'Votre client voit. Vous publiez.' }],
      },
    ],
  },
  {
    date: 'sam. 5 déc.', nom: 'Samedi', theme: 'L\'assistant', but: 'Montrer la fonction la plus « waouh », en restant honnête : il prépare, c\'est toi qui valides.',
    pieces: [
      {
        id: 's-v', heure: '11:00', format: 'Vidéo verticale', plateformes: ['instagram', 'tiktok', 'youtube'], duree: '30 s',
        titre: '« Programme ma vidéo demain soir »',
        accroche: 'Et si tu programmais tes vidéos… en discutant ?',
        script: [
          { t: '0-3 s', voix: 'Et si tu programmais tes vidéos… en discutant ?', ecran: 'Bulle de chat qui s\'ouvre' },
          { t: '3-14 s', voix: 'Tu écris : programme ma vidéo demain soir sur TikTok. L\'assistant la trouve dans ta bibliothèque et propose un créneau libre.', ecran: 'Chat : message, réponse avec créneaux' },
          { t: '14-24 s', voix: 'Il prépare un brouillon dans ton style de légende. Mais il ne publie jamais seul : c\'est toi qui cliques.', ecran: 'Boutons « Lancer la programmation » / « Ouvrir le brouillon »' },
          { t: '24-30 s', voix: 'À activer dans les Réglages. Lien en bio.', ecran: 'Réglages → Assistant IA' },
        ],
        textes: {
          instagram: `« Programme ma vidéo demain soir » 💬
L'assistant de Chapote CM trouve la vidéo, propose un créneau et prépare le brouillon. C'est toi qui valides.
À activer dans les Réglages. Lien en bio.
${TAGS.join(' ')} #IA`,
          tiktok: 'J\'ai demandé à mon assistant de programmer ma vidéo 💬 (et il attend mon clic pour publier) #IA #communitymanager',
          youtube: 'Programmer ses vidéos en discutant avec un assistant #Shorts',
        },
        titreYoutube: 'Programmer ses vidéos en discutant #Shorts',
        visuels: [{ type: 'capture', src: '/promo/nouvelle.webp', format: 'portrait' }],
        prod: PROD_VERTICALE + ' Captures de l\'assistant sur le compte de démo (droit « planning » activé).',
      },
      {
        id: 's-story', heure: '17:00', format: 'Story', plateformes: ['instagram', 'tiktok'], titre: 'Coulisses',
        script: [{ t: 'Écran 1', ecran: '« Samedi = je réponds à vos retours » + boîte à questions « Qu\'est-ce qui te manque ? »' }],
        textes: { commun: 'Boîte à questions' },
        visuels: [{ type: 'image', src: '/promo/story-fond.webp', format: 'story', titre: 'Qu\'est-ce qui te manque ?', sous: 'Je lis tout · Nathan' }],
      },
    ],
  },
  {
    date: 'dim. 6 déc.', nom: 'Dimanche', theme: 'Mobile et récap', but: 'Annoncer l\'app Android (en test) et mesurer la demande iPhone.',
    pieces: [
      {
        id: 'd-v', heure: '18:00', format: 'Vidéo verticale', plateformes: ['instagram', 'tiktok', 'youtube'], duree: '25 s',
        titre: 'Et sur téléphone ?',
        accroche: 'Programmer depuis ton canapé, ça te dit ?',
        script: [
          { t: '0-3 s', voix: 'Programmer depuis ton canapé, ça te dit ?', ecran: 'Téléphone Android, icône Chapote CM' },
          { t: '3-14 s', voix: 'L\'app Android de Chapote CM est en test : planning, vidéo depuis la galerie, notification quand elle part.', ecran: 'Captures app : Planning, Publication' },
          { t: '14-20 s', voix: 'Déverrouillage par empreinte, double authentification.', ecran: 'Empreinte' },
          { t: '20-25 s', voix: 'Tu es sur iPhone ? Écris IPHONE en commentaire. Si vous êtes nombreux, on la fait.', ecran: '« IPHONE 👇 »' },
        ],
        textes: {
          instagram: `L'app Android de Chapote CM arrive 📱 (en test, bientôt sur Google Play)
Planning, publication depuis la galerie, notifications.
Sur iPhone ? Écris IPHONE en commentaire : si vous êtes nombreux, on la fait 👇
${TAGS.join(' ')}`,
          tiktok: 'L\'app Android arrive 📱 Sur iPhone ? Commente IPHONE, si vous êtes nombreux on la fait 👇 #communitymanager #android #iphone',
          youtube: 'Chapote CM sur Android (en test) · iPhone ? Dis-le en commentaire #Shorts',
        },
        titreYoutube: 'L\'app Android arrive (et iPhone ?) #Shorts',
        visuels: [{ type: 'image', src: '/promo/android.webp', format: 'story', titre: 'Bientôt sur Android', sous: 'iPhone ? Commente IPHONE' }],
        prod: PROD_VERTICALE + ' Captures de l\'app Android (compte de démo).',
      },
      {
        id: 'd-story', heure: '19:00', format: 'Stories (2 écrans)', plateformes: ['instagram', 'tiktok'], titre: 'Sondage mobile',
        script: [
          { t: 'Écran 1', ecran: 'Sondage « Tu es plutôt… » Android / iPhone' },
          { t: 'Écran 2', ecran: '« Merci pour cette 1re semaine ❤️ » + lien' },
        ],
        textes: { commun: 'Sondage Android / iPhone + sticker lien' },
        visuels: [{ type: 'image', src: '/promo/android.webp', format: 'story', titre: 'Android ou iPhone ?' }],
      },
      {
        id: 'd-li', heure: '09:00', format: 'Post LinkedIn (profil de Nathan)', plateformes: ['linkedin'], titre: 'Bilan de la semaine 1',
        textes: {
          linkedin: `Première semaine publique pour Chapote CM.

[à compléter avec les vrais chiffres de la semaine : inscriptions, comptes connectés, vidéos programmées]

Ce que j'ai appris de vos retours :
• [retour 1]
• [retour 2]

La suite : l'app Android sort bientôt sur Google Play. Et pour l'iPhone, ce sont vos demandes qui décideront.

Merci à celles et ceux qui ont testé ${L}`,
        },
        prod: 'Ne publier qu\'avec les vrais chiffres (jamais de chiffre inventé).',
      },
      {
        id: 'd-x', heure: '20:00', format: 'Post X', plateformes: ['x'], titre: 'Récap',
        textes: { x: `Semaine 1 de Chapote CM ✅\nPlanning, stats, Google Drive, équipes, assistant… et l'app Android en test.\nTu es sur iPhone ? Réponds « iPhone » 👇\n${L}` },
      },
    ],
  },
]

/** Conseils transverses affichés en haut de la page. */
export const REGLES = [
  'Chaque vidéo verticale part sur Reels, Shorts et TikTok, programmée par Chapote CM lui-même (on montre l\'outil en l\'utilisant).',
  'Tutoiement sur Instagram, TikTok, YouTube et X ; vouvoiement sur LinkedIn.',
  'Aucun chiffre inventé : les captures de stats sont des données de démo, et c\'est dit.',
  'Lien unique : cm.chapote.fr (en bio, en description, en sticker). Retours : cm.chapote.fr/avis.',
  'Android : « en test, bientôt sur Google Play ». iPhone : seulement si on la demande (CTA « IPHONE »).',
  'Rien n\'est publié depuis cette page : c\'est un brouillon à relire.',
]
