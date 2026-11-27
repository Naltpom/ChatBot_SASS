// Plan de lancement de Chapote CM : 4 semaines de contenu, toutes plateformes (page /promo, réservée au superadmin).
// Rien n'est publié d'ici : c'est un brouillon à relire. Faits vérifiés dans le CODE (cm/src, mobile/src, api/src), pas dans les
// commentaires ni dans la base de l'assistant quand elle diffère (ex. : pas d'option « Ranger dans Publié » dans l'interface ;
// Chapote range les vidéos dans son dossier « cm.chapote.fr » du Drive, par compte, mois et date). Règles :
// - aucune fonction absente du code (pas de « commentaires », fonction non proposée), aucun chiffre inventé ;
// - Android : « en test, bientôt sur Google Play » (lien du Play Store encore vide) ; iPhone : seulement si on la demande ;
// - on vend la valeur, pas la gratuité (app gratuite pendant la bêta, mais ce n'est pas l'argument) : au plus une mention discrète
//   « en bêta » par semaine, jamais « gratuit » ni « sans carte bancaire » ; rien ne part sans validation ; vidéos dans le Drive de l'utilisateur.
// Chaque plan d'une vidéo nomme l'écran réel montré (`vue`, capture du vrai code avec des données de démo, public/promo/ecrans/).

export type Plateforme = 'youtube' | 'instagram' | 'tiktok' | 'linkedin' | 'x'

export const COMPTES: Record<Plateforme, { nom: string; url: string }> = {
  youtube: { nom: 'YouTube @chapotecm', url: 'https://www.youtube.com/@chapotecm' },
  instagram: { nom: 'Instagram @chapote.cm', url: 'https://www.instagram.com/chapote.cm/' },
  tiktok: { nom: 'TikTok @chapote.cm', url: 'https://www.tiktok.com/@chapote.cm' },
  linkedin: { nom: 'LinkedIn Chapote', url: 'https://www.linkedin.com/company/chapote' },
  x: { nom: 'X @chapotecm', url: 'https://x.com/chapotecm' },
}

/** Écrans réels (captures du code actuel, données de démo) : clé → libellé. */
export const VUES: Record<string, string> = {
  planning: 'Planning', publication: 'Fiche d\'une publication', 'composer-1': 'Nouvelle publication, étape 1',
  'composer-2': 'Nouvelle publication, étape 2', 'composer-reglages': 'Réglages par compte', stats: 'Statistiques',
  bibliotheque: 'Bibliothèque (Google Drive)', 'a-valider': 'À valider', comptes: 'Comptes', partage: 'Partage',
  groupes: 'Groupes', reglages: 'Réglages', assistant: 'Assistant IA', landing: 'Accueil cm.chapote.fr',
  'publication-plateformes': 'Fiche : statut par réseau, Réessayer', 'reglages-apparence': 'Réglages : apparence, langue, sécurité',
  'composer-2-date': 'Étape 2 : quand', 'partage-groupe': 'Partager un groupe', 'groupe-edition': 'Modifier un groupe', 'bibliotheque-videos': 'Bibliothèque : vidéos',
  'app-planning': 'App Android : Planning', 'app-publication': 'App Android : publication', 'app-bienvenue': 'App Android : bienvenue',
}

/** Un plan : ce que dit la voix, ce qu'on voit (description), l'écran réel montré et le texte à l'écran. */
export interface Plan { t: string; voix?: string; ecran: string; vue?: string; texte?: string }
export interface Visuel {
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
  textes: Partial<Record<Plateforme | 'commun', string>>
  titreYoutube?: string
  hashtags?: string[]
  visuels?: Visuel[]
  prod?: string
  /** Vidéo produite (rendu) : 'verticale' (1080×1920) ou 'horizontale' (1920×1080). */
  video?: 'verticale' | 'horizontale'
}
export interface Jour { date: string; nom: string; theme: string; but: string; pieces: Piece[] }
export interface Semaine { titre: string; dates: string; jours: Jour[] }

const L = 'https://cm.chapote.fr'
const TAGS = '#communitymanager #reseauxsociaux #tiktok #reels #shorts'
const PROD_V = 'Rendu automatique : voix Qwen3 (PC), sous-titres calés sur la voix, écrans réels de l\'app (données de démo). Même vidéo sur Reels, Shorts et TikTok.'
const PROD_H = 'Rendu automatique 16:9 : voix Qwen3 (PC), écrans réels de l\'app version ordinateur (données de démo), chapitres.'

/** Vidéo verticale publiée sur Reels, Shorts et TikTok. */
function vert(id: string, heure: string, titre: string, accroche: string, script: Plan[], ig: string, tt: string, yt: string): Piece {
  return {
    id, heure, format: 'Vidéo verticale', plateformes: ['instagram', 'tiktok', 'youtube'], video: 'verticale',
    duree: `${Math.round(script.reduce((n, p) => n + (p.voix ? p.voix.split(/\s+/).length : 0), 0) / 3.2)} s environ`,
    titre, accroche, script, titreYoutube: `${yt} #Shorts`,
    textes: { instagram: `${ig}\nTikTok, Shorts et Reels sur un seul planning → lien en bio\n${TAGS}`, tiktok: tt, youtube: `${yt}. Un envoi, trois réseaux : ${L} #Shorts #communitymanager` },
    prod: PROD_V,
  }
}
function story(id: string, titre: string, sous: string, vue: string | null, interaction: string): Piece {
  return {
    id, heure: '19:00', format: 'Story', plateformes: ['instagram', 'tiktok'], titre,
    script: [{ t: 'Écran', ecran: `${titre}${sous ? ` · ${sous}` : ''} · ${interaction}`, vue: vue ?? undefined }],
    textes: { commun: `${interaction} · sticker lien cm.chapote.fr` },
    visuels: [vue ? { type: 'capture', src: `/promo/ecrans/mobile/${vue}.webp`, format: 'story', titre, sous }
      : { type: 'image', src: '/promo/story-fond.webp', format: 'story', titre, sous }],
    prod: 'Story native : sondage, quiz, question et lien sont des stickers ajoutés à la main dans l\'app.',
  }
}
function li(id: string, heure: string, titre: string, texte: string, visuel?: Visuel): Piece {
  return { id, heure, format: 'Post LinkedIn', plateformes: ['linkedin'], titre, textes: { linkedin: texte }, visuels: visuel ? [visuel] : undefined,
    prod: 'Page Chapote, puis partage depuis ton profil avec une phrase à toi. Vouvoiement.' }
}
function x(id: string, heure: string, titre: string, texte: string): Piece {
  return { id, heure, format: 'Post X', plateformes: ['x'], titre, textes: { x: texte } }
}
function yt(id: string, titre: string, titreYoutube: string, script: Plan[], description: string, visuel: Visuel): Piece {
  return { id, heure: '18:00', format: 'Vidéo YouTube (16:9)', plateformes: ['youtube'], video: 'horizontale', titre, titreYoutube,
    accroche: script[0]?.voix, script, textes: { youtube: description }, visuels: [visuel], prod: PROD_H }
}

// ───────────────────────────── Semaine 1 : lancement ─────────────────────────────
const S1: Jour[] = [
  { date: 'lun. 30 nov.', nom: 'Lundi', theme: 'Lancement', but: 'Dire que Chapote CM existe, qui l\'a fait et pourquoi.', pieces: [
    yt('s1-yt', 'J\'avais 6 comptes et 3 applis : j\'ai fait mon propre outil',
      'Planifier ses vidéos TikTok, YouTube Shorts et Instagram Reels en une fois : j\'ai créé Chapote CM', [
        { t: '0:00', voix: 'Six comptes. Trois applis. Les mêmes vidéos partout. Et chaque soir, la même galère.', ecran: 'Titre', texte: '6 comptes · 3 applis' },
        { t: '0:06', voix: 'Au départ j\'avais un compte Instagram, puis un deuxième. Ensuite TikTok et YouTube, pour plus de visibilité. Publier régulièrement demandait de planifier, et je perdais le fil.', ecran: 'Accueil', vue: 'landing' },
        { t: '0:17', voix: 'Alors j\'ai fait l\'outil, pour moi. Il s\'appelle Chapote CM, et il est ouvert à tous.', ecran: 'Accueil', vue: 'landing', texte: 'Chapote CM' },
        { t: '0:22', voix: 'Je connecte mes comptes par les pages officielles de TikTok, de Google et de Meta. Chapote CM ne voit jamais mes mots de passe. Plusieurs comptes par réseau, c\'est prévu.', ecran: 'Comptes', vue: 'comptes' },
        { t: '0:31', voix: 'Pour publier, d\'abord la vidéo, le titre et la légende. Ensuite les comptes et l\'heure. Et si un réseau a des réglages, une dernière étape, compte par compte.', ecran: 'Nouvelle publication', vue: 'composer-1' },
        { t: '0:40', voix: 'Je coche mes comptes, ou un groupe entier, et je choisis le jour et l\'heure. Rien ne part avant.', ecran: 'Étape 2', vue: 'composer-2' },
        { t: '0:45', voix: 'Le planning me montre la semaine : ce qui est programmé, ce qui est parti, ce qui a échoué, réseau par réseau.', ecran: 'Planning', vue: 'planning' },
        { t: '0:51', voix: 'Les statistiques des trois réseaux sont au même endroit : vues, abonnés, j\'aime, partages et engagement.', ecran: 'Stats', vue: 'stats' },
        { t: '0:57', voix: 'Et mes vidéos restent dans mon Google Drive. J\'ajoute un dossier, ses vidéos sont prêtes à programmer.', ecran: 'Bibliothèque', vue: 'bibliotheque' },
        { t: '1:02', voix: 'Une vidéo envoyée une fois, et tout part à l\'heure choisie. Pour la suite, ce sont vos retours qui comptent. Dites-moi en commentaire ce qui vous manque. Le lien est en description.', ecran: 'Fin', texte: 'cm.chapote.fr' },
      ],
      `Chapote CM, c'est l'outil que j'ai créé pour planifier mes vidéos courtes sur TikTok, YouTube Shorts et Instagram Reels, sur tous mes comptes en une fois.\n\n👉 Une vidéo envoyée une fois, publiée partout à l'heure choisie : ${L}\n\n• Le problème\n• Chapote CM\n• Connecter ses comptes\n• Programmer une vidéo\n• Le planning\n• Les statistiques\n• Google Drive\n• Vos retours\n\nVos idées : ${L}/avis\n#communitymanager #tiktok #youtubeshorts #instagramreels`,
      { type: 'image', src: '/promo/yt-lancement.webp', format: 'paysage', titre: '6 COMPTES, 1 OUTIL', sous: 'TikTok · Shorts · Reels' }),
    vert('s1-l', '12:30', 'Planifie une fois. Publie partout.', 'Tu postes la même vidéo sur TikTok, Insta et YouTube, à la main ?', [
      { t: '1', voix: 'Tu postes la même vidéo sur TikTok, Insta et YouTube, à la main ?', ecran: 'Accroche', texte: '3 applis. 1 vidéo. 😩' },
      { t: '2', voix: 'Avec Chapote CM, tu l\'envoies une seule fois.', ecran: 'Étape 1', vue: 'composer-1' },
      { t: '3', voix: 'Tu coches tes comptes, tu choisis le jour et l\'heure.', ecran: 'Étape 2', vue: 'composer-2' },
      { t: '4', voix: 'Et le planning te montre où en est chaque vidéo, sur chaque réseau.', ecran: 'Planning', vue: 'planning' },
      { t: '5', voix: 'Envoyée une fois, publiée partout. Le lien est dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Planifie une fois. Publie partout. 🚀\nUne vidéo, tous tes comptes TikTok, YouTube et Instagram, à l\'heure que tu choisis.\nTu gères combien de comptes ? 👇',
      'Tu postes encore la même vidéo à la main sur 3 applis ? 😅 #communitymanager #tiktoktips #reels', 'Publier sur TikTok, YouTube et Instagram en une fois'),
    story('s1-l-st', 'Chapote CM est ouvert à tous 🎉', 'Tu gères combien de comptes ?', null, 'Sondage : 1 / 2-3 / 4 et +'),
    li('s1-l-li', '08:30', 'Annonce du lancement', `Community managers, créateurs, agences : publier la même vidéo sur TikTok, YouTube Shorts et Instagram Reels ne devrait pas prendre trois fois plus de temps.

J'ai lancé Chapote CM pour ça.

→ Vous envoyez la vidéo une fois
→ Vous choisissez les comptes (plusieurs par réseau) et l'heure
→ Le planning montre le statut de chaque publication, réseau par réseau
→ Les statistiques des trois réseaux sont réunies
→ Vos vidéos restent dans votre Google Drive

Connexion par les pages officielles de TikTok, Google et Meta : l'outil ne voit jamais vos mots de passe.

Le temps gagné sert à créer, pas à copier-coller. Accès bêta ouvert : ${L}

Qu'est-ce qui vous fait perdre le plus de temps aujourd'hui ?`, { type: 'image', src: '/promo/linkedin-lancement.webp', format: 'carre', titre: 'Une vidéo. Tous vos comptes.', sous: 'TikTok · Shorts · Reels' }),
    x('s1-l-x', '12:00', 'Le pourquoi en 4 posts', `1/ J'avais 6 comptes (Insta, TikTok, YouTube) et les mêmes vidéos partout. Chaque réseau, son appli, son planning. J'ai fini par faire mon outil : Chapote CM 🧵\n\n2/ Tu envoies la vidéo une fois, tu choisis les comptes et l'heure. Rien ne part avant.\n\n3/ Le planning, le statut sur chaque réseau, les stats réunies. Les vidéos restent dans ton Google Drive.\n\n4/ Un seul planning pour tout suivre : ${L}\nDis-moi ce qui te manque 👇`),
  ] },
  { date: 'mar. 1 déc.', nom: 'Mardi', theme: 'Le planning', but: 'La promesse « je sais où en sont mes vidéos ».', pieces: [
    vert('s1-ma', '12:30', 'Ta semaine de publications en un coup d\'œil', 'Ta vidéo est partie… ou pas ?', [
      { t: '1', voix: 'Ta vidéo est partie… ou pas ?', ecran: 'Accroche', texte: 'Partie ? 🤔' },
      { t: '2', voix: 'Le planning de Chapote CM montre ta semaine, jour par jour.', ecran: 'Planning', vue: 'planning' },
      { t: '3', voix: 'Chaque publication affiche son statut sur chaque réseau : programmée, publiée ou en échec.', ecran: 'Fiche', vue: 'publication' },
      { t: '4', voix: 'Un échec ? Tu cliques sur Réessayer.', ecran: 'Fiche', vue: 'publication-plateformes', texte: 'Réessayer' },
      { t: '5', voix: 'Tout sur un seul écran. Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Ta semaine de publications en un coup d\'œil 👀\nProgrammée, publiée ou en échec : chaque vidéo, sur chaque réseau.',
      'Ta vidéo est partie ou pas ? 👀 Le planning te le dit, réseau par réseau. #communitymanager #planning', 'Le planning de toutes tes vidéos, réseau par réseau'),
    story('s1-ma-st', 'Quel jour tu publies le plus ?', '', 'planning', 'Quiz : Lundi / Mercredi / Vendredi / Week-end'),
    x('s1-ma-x', '18:00', 'Astuce planning', `Astuce de CM : programme ta semaine le dimanche soir, puis regarde un seul écran chaque jour.\nC'est exactement le planning de Chapote CM : programmé, publié, en échec, sur chaque réseau.\n${L}`),
  ] },
  { date: 'mer. 2 déc.', nom: 'Mercredi', theme: 'Google Drive', but: 'Rassurer : les vidéos restent chez soi.', pieces: [
    vert('s1-me', '12:30', 'Tes vidéos restent dans TON Drive', 'Où vont tes vidéos quand tu les donnes à une appli ?', [
      { t: '1', voix: 'Où vont tes vidéos quand tu les donnes à une appli ?', ecran: 'Accroche', texte: '📁 ?' },
      { t: '2', voix: 'Avec Chapote CM, elles restent dans ton Google Drive. Tu ajoutes un dossier, ses vidéos apparaissent, prêtes à programmer.', ecran: 'Bibliothèque', vue: 'bibliotheque' },
      { t: '3', voix: 'L\'astuce : un fichier texte du même nom que la vidéo devient sa légende.', ecran: 'Astuce', texte: 'video.mp4 + video.txt = légende ✨' },
      { t: '4', voix: 'Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Tes vidéos restent dans TON Google Drive 📁\nAstuce : un .txt du même nom que la vidéo = sa légende, déjà remplie.',
      'L\'astuce .txt qui écrit ta légende toute seule 🤯 #communitymanager #astuce #googledrive', 'Un .txt du même nom que ta vidéo = sa légende'),
    story('s1-me-st', 'video.mp4 + video.txt = légende ✨', 'Astuce Drive', 'bibliotheque', 'Sticker lien'),
    li('s1-me-li', '08:30', 'Confiance et données', `Confier ses comptes clients à un outil, c'est une question de confiance. Les choix faits pour Chapote CM :

1. Connexion par les pages officielles de TikTok, Google et Meta. L'outil ne voit jamais les mots de passe, et l'accès se retire à tout moment.
2. Les vidéos restent dans votre Google Drive.
3. Rien ne part sans validation, même les brouillons préparés automatiquement.
4. Hébergement en France (OVH), politique de confidentialité publique : ${L}/privacy

Qu'est-ce qui vous fait hésiter avant d'adopter un nouvel outil pour vos comptes ?`),
  ] },
  { date: 'jeu. 3 déc.', nom: 'Jeudi', theme: 'Statistiques', but: 'Parler à ceux qui doivent rendre des chiffres.', pieces: [
    vert('s1-j', '12:30', 'Tes chiffres des 3 réseaux, sans tableur', 'Ton rapport mensuel, c\'est encore un tableur ?', [
      { t: '1', voix: 'Ton rapport mensuel, c\'est encore un tableur ?', ecran: 'Accroche', texte: '📊 ?' },
      { t: '2', voix: 'Chapote CM réunit vues, abonnés, j\'aime, partages et engagement. Sur sept jours, trente, quatre-vingt-dix ou un an.', ecran: 'Stats', vue: 'stats' },
      { t: '3', voix: 'Par compte, ou par groupe : un client, un artiste, une chaîne.', ecran: 'Stats', vue: 'stats', texte: 'Par compte · par groupe' },
      { t: '4', voix: 'Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Tes chiffres TikTok, YouTube et Instagram réunis 📊\nVues, abonnés, j\'aime, partages, engagement. (chiffres de démonstration)',
      'Ton rapport mensuel en 1 écran 📊 (chiffres de démo) #communitymanager #statistiques', 'Les stats de 3 réseaux sur un seul écran'),
    story('s1-j-st', 'Quelle stat tu regardes en premier ?', '', 'stats', 'Boîte à questions'),
    x('s1-j-x', '18:00', 'Sondage', 'Sondage CM : la stat qui compte le plus pour toi ?\n• Vues\n• Abonnés\n• Engagement\n• Partages'),
  ] },
  { date: 'ven. 4 déc.', nom: 'Vendredi', theme: 'Équipes', but: 'Toucher les freelances et agences.', pieces: [
    vert('s1-v', '12:30', 'Un groupe par client', 'Tu gères les comptes de plusieurs clients ?', [
      { t: '1', voix: 'Tu gères les comptes de plusieurs clients ?', ecran: 'Accroche', texte: '3 clients. 1 planning.' },
      { t: '2', voix: 'Range-les en groupes : le planning et les stats se filtrent d\'un geste.', ecran: 'Groupes', vue: 'groupes' },
      { t: '3', voix: 'Et partage : administrateur, éditeur qui peut publier, ou lecteur qui voit sans toucher.', ecran: 'Partage', vue: 'partage' },
      { t: '4', voix: 'Ton client voit son planning, jamais tes accès. Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Freelance ou agence ? Un groupe par client 🗂️\nInvite ton équipe ou ton client : admin, éditeur ou lecteur.',
      'CM multi-clients : un groupe par client, ton client en lecture seule 👀 #communitymanager #freelance', 'Gérer plusieurs clients en un seul planning'),
    story('s1-v-st', 'Tu travailles seul ou en équipe ?', '', 'partage', 'Sondage : Seul / En équipe'),
    x('s1-v-x', '18:00', 'Rôles', `Dans Chapote CM, trois rôles pour partager un compte ou un groupe :\n👑 Admin\n✏️ Peut publier\n👁 Lecture seule\nTon client voit son planning, pas tes accès.\n${L}`),
  ] },
  { date: 'sam. 5 déc.', nom: 'Samedi', theme: 'L\'assistant', but: 'La fonction « waouh », honnêtement : il prépare, c\'est toi qui valides.', pieces: [
    vert('s1-s', '11:00', '« Programme ma vidéo demain soir »', 'Et si tu programmais tes vidéos en discutant ?', [
      { t: '1', voix: 'Et si tu programmais tes vidéos en discutant ?', ecran: 'Accroche', texte: '💬 « demain soir sur TikTok »' },
      { t: '2', voix: 'L\'assistant de Chapote CM cherche la vidéo dans ta bibliothèque, propose un créneau libre et prépare un brouillon.', ecran: 'Réglages de l\'assistant', vue: 'assistant' },
      { t: '3', voix: 'Mais il ne publie jamais seul : c\'est toi qui cliques sur Lancer la programmation.', ecran: 'Texte', texte: 'Tu valides. Toujours.' },
      { t: '4', voix: 'À activer dans les réglages. Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], '« Programme ma vidéo demain soir » 💬\nL\'assistant trouve la vidéo, propose un créneau et prépare le brouillon. C\'est toi qui valides.',
      'J\'ai demandé à l\'assistant de programmer ma vidéo 💬 (il attend mon clic) #IA #communitymanager', 'Programmer ses vidéos en discutant'),
    story('s1-s-st', 'Qu\'est-ce qui te manque ?', 'Je lis tout · Nathan', null, 'Boîte à questions'),
  ] },
  { date: 'dim. 6 déc.', nom: 'Dimanche', theme: 'Mobile', but: 'Annoncer l\'app Android (en test) et mesurer la demande iPhone.', pieces: [
    vert('s1-d', '18:00', 'Et sur téléphone ?', 'Programmer depuis ton canapé, ça te dit ?', [
      { t: '1', voix: 'Programmer depuis ton canapé, ça te dit ?', ecran: 'Accroche', texte: '📱' },
      { t: '2', voix: 'L\'app Android de Chapote CM est en test : le planning, la publication depuis ta galerie, et une notification quand la vidéo part.', ecran: 'App Android', vue: 'app-planning' },
      { t: '3', voix: 'Tu es sur iPhone ? Écris iPhone en commentaire. Si vous êtes nombreux, on la fait.', ecran: 'Texte', texte: 'iPhone ? Commente IPHONE 👇' },
    ], 'L\'app Android de Chapote CM arrive 📱 (en test, bientôt sur Google Play)\nOn cherche des community managers pour la tester en avant-première : écris ANDROID 👇\nSur iPhone ? Écris IPHONE en commentaire : si vous êtes nombreux, on la fait 👇',
      'L\'app Android arrive 📱 iPhone ? Commente IPHONE 👇 #android #iphone #communitymanager', 'Chapote CM sur Android (en test), et iPhone ?'),
    story('s1-d-st', 'Android ou iPhone ?', '', null, 'Sondage : Android / iPhone'),
    x('s1-d-x', '20:00', 'Récap', `Semaine 1 de Chapote CM ✅\nPlanning, stats, Google Drive, équipes, assistant… et l'app Android en test.\nTu veux la tester en avant-première ? Réponds « Android ». Sur iPhone ? Réponds « iPhone » 👇\n${L}`),
  ] },
]

// ───────────────────────────── Semaine 2 : les détails qui font gagner du temps ─────────────────────────────
const S2: Jour[] = [
  { date: 'lun. 7 déc.', nom: 'Lundi', theme: 'Tuto express', but: 'Le tuto d\'une minute qu\'on peut envoyer à quelqu\'un qui débute.', pieces: [
    yt('s2-yt', 'Tuto express : de zéro à ta première vidéo programmée', 'Tuto Chapote CM en 1 minute : programmer ses vidéos TikTok, Shorts et Reels', [
      { t: '0:00', voix: 'Dans cette vidéo, on part de zéro et on programme une vidéo sur TikTok, YouTube et Instagram.', ecran: 'Titre', texte: 'Tuto express' },
      { t: '0:06', voix: 'D\'abord, un compte Chapote : par e-mail ou avec Google. C\'est le même compte que sur chapote point f r.', ecran: 'Accueil', vue: 'landing' },
      { t: '0:13', voix: 'Ensuite, la page Comptes. Chaque bouton ouvre la page officielle du réseau. Pour Instagram, il faut un compte professionnel, Créateur ou Entreprise.', ecran: 'Comptes', vue: 'comptes' },
      { t: '0:21', voix: 'La Bibliothèque : tu ajoutes un dossier de ton Google Drive, ses vidéos et ses sous-dossiers apparaissent.', ecran: 'Bibliothèque', vue: 'bibliotheque' },
      { t: '0:26', voix: 'Nouvelle publication, étape un : la vidéo, le titre et la légende. Tu indiques aussi la limite d\'âge, les droits d\'auteur, et si la vidéo contient du contenu généré par IA.', ecran: 'Étape 1', vue: 'composer-1' },
      { t: '0:36', voix: 'Étape deux : les comptes, ou un groupe, puis le jour et l\'heure.', ecran: 'Étape 2', vue: 'composer-2' },
      { t: '0:40', voix: 'Étape trois, si un réseau demande des réglages : un onglet par compte. Sur TikTok, qui peut voir la vidéo, les commentaires, les duos et les collages.', ecran: 'Réglages par compte', vue: 'composer-reglages' },
      { t: '0:47', voix: 'Et voilà : la vidéo est dans le planning. Elle partira à l\'heure choisie, et tu suis son statut réseau par réseau.', ecran: 'Planning', vue: 'planning' },
      { t: '0:53', voix: 'Le lien pour commencer est en description. Et si tu bloques quelque part, dis-le en commentaire.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], `Tuto express : programmer ses vidéos TikTok, YouTube Shorts et Instagram Reels avec Chapote CM : ${L}\n\n• Intro\n• Créer son compte\n• Connecter TikTok, YouTube, Instagram\n• Google Drive\n• Étape 1 : la vidéo\n• Étape 2 : comptes et heure\n• Réglages par compte\n• Le planning`,
      { type: 'image', src: '/promo/yt-tuto.webp', format: 'paysage', titre: 'TUTO EXPRESS', sous: 'Ta 1re vidéo programmée en 1 min' }),
    vert('s2-l', '12:30', 'Publier en 3 étapes', 'Programmer une vidéo, ça prend combien d\'étapes ?', [
      { t: '1', voix: 'Programmer une vidéo partout, ça prend combien d\'étapes ? Trois, au plus.', ecran: 'Accroche', texte: '3 étapes.' },
      { t: '2', voix: 'Un : la vidéo, le titre et la légende.', ecran: 'Étape 1', vue: 'composer-1' },
      { t: '3', voix: 'Deux : les comptes et l\'heure.', ecran: 'Étape 2', vue: 'composer-2' },
      { t: '4', voix: 'Trois, si le réseau en a : les réglages de chaque compte. Planifier, et c\'est fait.', ecran: 'Étape 3', vue: 'composer-reglages' },
      { t: '5', voix: 'Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Publier partout en 3 étapes au plus 🚀\n1. La vidéo, le titre, la légende.\n2. Les comptes et l\'heure.\n3. Les réglages de chaque compte, si le réseau en a.',
      '3 étapes pour publier partout 🚀 #communitymanager #tiktoktips', 'Programmer une vidéo partout en 3 étapes'),
    story('s2-l-st', 'Nouveau : le tuto express sur YouTube', 'Lien en story', null, 'Sticker lien YouTube'),
    x('s2-l-x', '12:00', 'Tuto', `Le tuto express de Chapote CM est en ligne : de zéro à ta première vidéo programmée sur TikTok, YouTube et Instagram.\n${L}`),
  ] },
  { date: 'mar. 8 déc.', nom: 'Mardi', theme: 'La miniature', but: 'Une fonction concrète que les créateurs adorent.', pieces: [
    vert('s2-ma', '12:30', 'La miniature, choisie dans ta vidéo', 'Ta miniature TikTok, tu la choisis vraiment ?', [
      { t: '1', voix: 'Ta miniature, tu la choisis vraiment ?', ecran: 'Accroche', texte: '🖼️ ?' },
      { t: '2', voix: 'Dans Chapote CM, tu choisis l\'image de la vidéo qui servira de miniature, compte par compte, puis Utiliser cette image.', ecran: 'Réglages par compte', vue: 'composer-reglages' },
      { t: '3', voix: 'Pour Instagram, tu peux même envoyer une autre image.', ecran: 'Texte', texte: 'Instagram : une autre image' },
      { t: '4', voix: 'Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'La miniature, choisie dans ta vidéo 🖼️\nCompte par compte. Et pour Instagram, une autre image si tu veux.',
      'Choisis ta miniature TikTok dans ta vidéo 🖼️ #tiktoktips #createur', 'Choisir sa miniature dans sa vidéo'),
    story('s2-ma-st', 'Miniature : tu y passes combien de temps ?', '', null, 'Curseur émoji'),
    li('s2-ma-li', '08:30', 'Réglages par plateforme', `Un détail qui fait perdre du temps aux community managers : chaque réseau a ses propres réglages.

Dans Chapote CM, après le choix des comptes, un onglet par compte reprend ce que le réseau propose :
• TikTok : qui peut voir la vidéo, duo, collage
• YouTube : titre, vidéo conçue pour les enfants ou non
• Instagram : miniature choisie dans la vidéo, ou une autre image

Puis une vérification compte par compte avant de programmer.
${L}`, { type: 'capture', src: '/promo/ecrans/mobile/composer-reglages.webp', format: 'portrait' }),
  ] },
  { date: 'mer. 9 déc.', nom: 'Mercredi', theme: 'TikTok', but: 'Rassurer les utilisateurs TikTok : les réglages du réseau sont respectés.', pieces: [
    vert('s2-me', '12:30', 'TikTok : tes réglages, compte par compte', 'Qui peut voir ta vidéo TikTok ? C\'est toi qui choisis.', [
      { t: '1', voix: 'Qui peut voir ta vidéo TikTok ? C\'est toi qui choisis.', ecran: 'Accroche', texte: 'TikTok 🎵' },
      { t: '2', voix: 'Chapote CM reprend les choix que TikTok propose pour ton compte : qui peut voir la vidéo, le duo, le collage.', ecran: 'Réglages par compte', vue: 'composer-reglages' },
      { t: '3', voix: 'Et avant de programmer, tu vérifies chaque compte : valider, modifier ou retirer.', ecran: 'Texte', texte: 'Valider · Modifier · Retirer' },
      { t: '4', voix: 'Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'TikTok : qui peut voir, duo, collage 🎵\nTes réglages, compte par compte, vérifiés avant de programmer.',
      'Tes réglages TikTok respectés, compte par compte 🎵 #tiktoktips #communitymanager', 'Les réglages TikTok, compte par compte'),
    story('s2-me-st', 'Duo et collage : tu les autorises ?', '', null, 'Sondage : Oui / Non'),
    x('s2-me-x', '18:00', 'Vérification', `Avant de programmer dans Chapote CM, une vérification compte par compte : Valider, Modifier ou Retirer ce compte.\nRien ne part par surprise.\n${L}`),
  ] },
  { date: 'jeu. 10 déc.', nom: 'Jeudi', theme: 'YouTube', but: 'Les questions que YouTube impose, posées au bon moment.', pieces: [
    vert('s2-j', '12:30', 'YouTube : les bonnes questions, au bon moment', 'Vidéo pour enfants ou non ? YouTube te le demande toujours.', [
      { t: '1', voix: 'Vidéo pour enfants ou non ? YouTube te le demande toujours.', ecran: 'Accroche', texte: 'YouTube ▶️' },
      { t: '2', voix: 'Chapote CM te pose la question dès l\'étape un, avec les droits d\'auteur et le contenu généré par IA.', ecran: 'Étape 1', vue: 'composer-1' },
      { t: '3', voix: 'Comme ça, rien n\'est bloqué au moment de publier. Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'YouTube : pour enfants, droits d\'auteur, contenu IA ▶️\nDemandé dès l\'étape 1, pour que rien ne bloque à la publication.',
      'Ce que YouTube exige, demandé avant de publier ▶️ #youtubeshorts #createur', 'Pour enfants, droits, contenu IA : demandé dès l\'étape 1'),
    story('s2-j-st', 'Tu publies sur YouTube Shorts ?', '', null, 'Sondage : Oui / Pas encore'),
    li('s2-j-li', '08:30', 'Contenu IA', `Les plateformes demandent de plus en plus de signaler les contenus générés par IA.

Dans Chapote CM, l'étape 1 d'une publication pose la question, avec la limite d'âge (YouTube) et les droits d'auteur. Ces informations sont envoyées à chaque réseau selon ce qu'il propose.

Un bon réflexe à prendre pour toutes vos publications.
${L}`),
  ] },
  { date: 'ven. 11 déc.', nom: 'Vendredi', theme: 'Échecs', but: 'Montrer qu\'un échec se rattrape.', pieces: [
    vert('s2-v', '12:30', 'Une publication en échec ? Réessayer.', 'Une vidéo qui ne part pas, ça arrive.', [
      { t: '1', voix: 'Une vidéo qui ne part pas, ça arrive.', ecran: 'Accroche', texte: '❌ Échec' },
      { t: '2', voix: 'Dans Chapote CM, tu le vois tout de suite dans la fiche : le statut de chaque réseau.', ecran: 'Fiche', vue: 'publication' },
      { t: '3', voix: 'Un bouton : Réessayer. Et tu peux aussi télécharger la vidéo et sa miniature.', ecran: 'Fiche', vue: 'publication-plateformes', texte: 'Réessayer' },
      { t: '4', voix: 'Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Une publication en échec ? Réessayer 🔁\nLe statut de chaque réseau, dans la fiche de la publication.',
      'Ta vidéo n\'est pas partie ? Un bouton : Réessayer 🔁 #communitymanager', 'Une publication en échec ? Réessayer'),
    story('s2-v-st', 'Ta pire galère de publication ?', '', null, 'Boîte à questions'),
    x('s2-v-x', '18:00', 'Statuts', `Programmée, publiée, en échec : dans Chapote CM, chaque réseau a son statut.\nEt un échec se relance avec Réessayer.\n${L}`),
  ] },
  { date: 'sam. 12 déc.', nom: 'Samedi', theme: 'Apparence', but: 'Petit contenu léger du week-end.', pieces: [
    vert('s2-s', '11:00', 'Clair ou sombre, français ou anglais', 'Team mode sombre ou mode clair ?', [
      { t: '1', voix: 'Team mode sombre, ou mode clair ?', ecran: 'Accroche', texte: '🌙 ou ☀️ ?' },
      { t: '2', voix: 'Dans les réglages de Chapote CM, tu choisis le thème et la langue, français ou anglais, pour le site et pour l\'app.', ecran: 'Réglages', vue: 'reglages-apparence' },
      { t: '3', voix: 'Dis-moi ta team en commentaire.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Team clair ☀️ ou team sombre 🌙 ?\nThème et langue dans les Réglages, pour le site et l\'app.',
      'Team sombre ou team clair ? 🌙☀️ #communitymanager', 'Mode clair ou sombre, français ou anglais'),
    story('s2-s-st', 'Team sombre ou team clair ?', '', 'reglages-apparence', 'Sondage : 🌙 / ☀️'),
  ] },
  { date: 'dim. 13 déc.', nom: 'Dimanche', theme: 'Routine du dimanche', but: 'Installer une habitude : programmer la semaine le dimanche.', pieces: [
    vert('s2-d', '18:00', 'La routine du dimanche soir', 'Dimanche soir : ta semaine de publications est prête ?', [
      { t: '1', voix: 'Dimanche soir : ta semaine de publications est prête ?', ecran: 'Accroche', texte: 'Dimanche 20 h ⏰' },
      { t: '2', voix: 'Ma routine : je programme toute la semaine dans Chapote CM, en une fois.', ecran: 'Étape 2', vue: 'composer-2' },
      { t: '3', voix: 'Ensuite, je regarde juste le planning chaque jour.', ecran: 'Planning', vue: 'planning' },
      { t: '4', voix: 'Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'La routine du dimanche soir ⏰\nToute la semaine programmée en une fois. Ensuite, un coup d\'œil au planning chaque jour.',
      'Ma routine du dimanche soir de CM ⏰ #communitymanager #organisation', 'La routine du dimanche soir'),
    story('s2-d-st', 'Tu programmes à l\'avance ?', '', 'planning', 'Sondage : Oui / Au jour le jour'),
  ] },
]

// ───────────────────────────── Semaine 3 : pour qui ? ─────────────────────────────
const S3: Jour[] = [
  { date: 'lun. 14 déc.', nom: 'Lundi', theme: 'Freelance multi-clients', but: 'La vidéo longue pour les CM freelances.', pieces: [
    yt('s3-yt', 'CM freelance : gérer plusieurs clients sans se perdre', 'Community manager freelance : gérer plusieurs clients sur TikTok, Shorts et Reels', [
      { t: '0:00', voix: 'Tu es community manager freelance, et tu gères plusieurs clients ? Voici comment je m\'organise avec Chapote CM.', ecran: 'Titre', texte: 'CM freelance' },
      { t: '0:08', voix: 'Un : un groupe par client. Le planning, les statistiques et les vidéos se filtrent d\'un geste.', ecran: 'Groupes', vue: 'groupes' },
      { t: '0:13', voix: 'Deux : un dossier Drive par client dans la bibliothèque. Tu peux même lui donner un dossier à part.', ecran: 'Bibliothèque', vue: 'bibliotheque' },
      { t: '0:18', voix: 'Trois : le partage. Ton client en lecture seule voit son planning et ses chiffres, rien d\'autre. Un éditeur peut programmer. Un administrateur gère tout.', ecran: 'Partage', vue: 'partage' },
      { t: '0:28', voix: 'Quatre : les statistiques par groupe, sur sept jours, trente, quatre-vingt-dix ou un an. Ton rapport est prêt.', ecran: 'Stats', vue: 'stats' },
      { t: '0:34', voix: 'Et si un client reprend la main, tu lui transfères son compte, avec son planning à venir et ses chiffres. Il a quatorze jours pour accepter.', ecran: 'Comptes', vue: 'comptes' },
      { t: '0:41', voix: 'Tous tes clients, un seul planning. Le lien est en description.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], `Community manager freelance : tous tes clients sur un seul planning avec Chapote CM : ${L}\n\n• Intro\n• Un groupe par client\n• Un dossier Drive par client\n• Partage et rôles\n• Stats par client\n• Transférer un compte`,
      { type: 'image', src: '/promo/equipe.webp', format: 'paysage', titre: 'CM FREELANCE', sous: 'Plusieurs clients, un planning' }),
    vert('s3-l', '12:30', 'Ton client voit, toi tu publies', 'Ton client te demande « c\'est publié quand ? » ?', [
      { t: '1', voix: 'Ton client te demande encore : c\'est publié quand ?', ecran: 'Accroche', texte: '« C\'est publié quand ? »' },
      { t: '2', voix: 'Partage-lui son groupe en lecture seule : il voit son planning et ses chiffres.', ecran: 'Partage', vue: 'partage' },
      { t: '3', voix: 'Et toi, tu gardes la main. Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Ton client te demande « c\'est publié quand ? » 🙃\nPartage-lui son planning en lecture seule.',
      'Fini les « c\'est publié quand ? » 🙃 #communitymanager #freelance', 'Partager son planning à un client'),
    story('s3-l-st', 'Tu as combien de clients ?', '', 'groupes', 'Curseur'),
    li('s3-l-li', '08:30', 'Freelances', `Freelances social media : comment partagez-vous le planning avec vos clients ?

Dans Chapote CM, trois rôles : Administrateur, Éditeur (« Peut publier »), Lecteur (« Lecture seule »). Chaque personne peut être limitée à certains groupes de comptes.

Un client en lecture seule voit son planning et ses chiffres, jamais vos accès.
${L}`, { type: 'image', src: '/promo/equipe.webp', format: 'carre', titre: 'Votre client voit. Vous publiez.' }),
  ] },
  { date: 'mar. 15 déc.', nom: 'Mardi', theme: 'Musiciens', but: 'Les artistes qui publient des extraits partout.', pieces: [
    vert('s3-ma', '12:30', 'Musicien : 1 extrait, 3 réseaux', 'Tu sors un morceau : tu postes l\'extrait sur combien de réseaux ?', [
      { t: '1', voix: 'Tu sors un morceau : tu postes l\'extrait sur combien de réseaux ?', ecran: 'Accroche', texte: '🎹 1 extrait' },
      { t: '2', voix: 'Avec Chapote CM, tu l\'envoies une fois, sur TikTok, Shorts et Reels, à l\'heure de ta sortie.', ecran: 'Étape 2', vue: 'composer-2' },
      { t: '3', voix: 'Et tu suis les vues des trois réseaux au même endroit. Lien dans la bio.', ecran: 'Stats', vue: 'stats' },
    ], 'Musicien : 1 extrait, 3 réseaux, à l\'heure de ta sortie 🎹', 'Ta sortie, partout à la même heure 🎹 #musique #artiste #tiktokmusic', 'Un extrait, trois réseaux, à l\'heure de ta sortie'),
    story('s3-ma-st', 'Tu es artiste ? Dis-moi ton style', '', null, 'Boîte à questions'),
    x('s3-ma-x', '18:00', 'Sorties', `Artistes : programmez l'extrait de votre sortie sur TikTok, Shorts et Reels à la même heure, en une fois.\n${L}`),
  ] },
  { date: 'mer. 16 déc.', nom: 'Mercredi', theme: 'Commerces', but: 'Les petites entreprises qui manquent de temps.', pieces: [
    vert('s3-me', '12:30', 'Commerce : ta semaine programmée d\'avance', 'Tu tiens un commerce et tu n\'as pas le temps de poster tous les jours ?', [
      { t: '1', voix: 'Tu tiens un commerce et tu n\'as pas le temps de poster tous les jours ?', ecran: 'Accroche', texte: '☕ Pas le temps ?' },
      { t: '2', voix: 'Prépare tes vidéos quand tu veux, programme-les pour toute la semaine.', ecran: 'Planning', vue: 'planning' },
      { t: '3', voix: 'Elles partent toutes seules, à l\'heure choisie. Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Commerçants : votre semaine de vidéos programmée d\'avance ☕', 'Commerce : ta semaine de vidéos programmée d\'avance ☕ #commerce #entrepreneur', 'Commerce : ta semaine programmée d\'avance'),
    story('s3-me-st', 'Tu publies pour ton commerce ?', '', null, 'Sondage : Oui / Je voudrais'),
    li('s3-me-li', '08:30', 'TPE', `Commerçants, artisans, indépendants : vous n'avez pas le temps de publier chaque jour ?

Préparez vos vidéos quand vous le pouvez, programmez la semaine sur TikTok, YouTube Shorts et Instagram Reels en une fois, et suivez le planning d'un coup d'œil. Vos vidéos restent dans votre Google Drive.

Chapote CM est en bêta : ${L}`),
  ] },
  { date: 'jeu. 17 déc.', nom: 'Jeudi', theme: 'Créateurs', but: 'Le workflow Drive des créateurs.', pieces: [
    vert('s3-j', '12:30', 'Créateur : ton Drive devient ta bibliothèque', 'Tes vidéos sont déjà dans ton Drive ?', [
      { t: '1', voix: 'Tes vidéos sont déjà dans ton Google Drive ?', ecran: 'Accroche', texte: '📁 Drive' },
      { t: '2', voix: 'Ajoute le dossier dans Chapote CM : ses vidéos et ses sous-dossiers apparaissent dans la bibliothèque.', ecran: 'Bibliothèque', vue: 'bibliotheque' },
      { t: '3', voix: 'Tu choisis une vidéo, tu programmes. Lien dans la bio.', ecran: 'Étape 1', vue: 'composer-1' },
    ], 'Créateurs : votre Google Drive devient votre bibliothèque 📁', 'Ton Drive devient ta bibliothèque de vidéos 📁 #createur #googledrive', 'Ton Drive devient ta bibliothèque'),
    story('s3-j-st', 'Tu ranges tes vidéos où ?', '', 'bibliotheque', 'Sondage : Drive / Téléphone / Ailleurs'),
    x('s3-j-x', '18:00', 'Drive', `Tes vidéos restent dans ton Google Drive. Chapote CM les lit pour les programmer.\n${L}`),
  ] },
  { date: 'ven. 18 déc.', nom: 'Vendredi', theme: 'Agences', but: 'Les équipes.', pieces: [
    vert('s3-v', '12:30', 'Agence : chacun son rôle', 'Dans ton agence, qui a le droit de publier ?', [
      { t: '1', voix: 'Dans ton agence, qui a le droit de publier ?', ecran: 'Accroche', texte: '👑 ✏️ 👁' },
      { t: '2', voix: 'Dans Chapote CM : administrateur, peut publier, ou lecture seule. Et limité à certains groupes si tu veux.', ecran: 'Partage', vue: 'partage' },
      { t: '3', voix: 'Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Agence : chacun son rôle 👑✏️👁\nAdmin, peut publier, lecture seule, limité à certains groupes.', 'Qui publie dans ton agence ? 👑✏️👁 #agence #communitymanager', 'Agence : chacun son rôle'),
    story('s3-v-st', 'Vous êtes combien dans l\'équipe ?', '', 'partage', 'Curseur'),
  ] },
  { date: 'sam. 19 déc.', nom: 'Samedi', theme: 'Brouillons automatiques', but: 'Montrer « À valider » : rien ne part sans toi.', pieces: [
    vert('s3-s', '11:00', 'Des brouillons prêts, rien ne part sans toi', 'Et si tes publications se préparaient toutes seules ?', [
      { t: '1', voix: 'Et si tes publications se préparaient toutes seules ?', ecran: 'Accroche', texte: '✨' },
      { t: '2', voix: 'Pour un dossier de ta bibliothèque, Chapote CM prépare des brouillons d\'après l\'organisation de tes dossiers et le nom de tes fichiers.', ecran: 'À valider', vue: 'a-valider' },
      { t: '3', voix: 'Ils arrivent dans À valider. Vérifier et programmer, ou écarter : rien ne part sans toi.', ecran: 'À valider', vue: 'a-valider', texte: 'Vérifier et programmer' },
    ], 'Des brouillons prêts dans « À valider » ✨\nRien ne part sans ta validation.', 'Mes publications se préparent toutes seules ✨ (et j\'ai le dernier mot) #communitymanager', 'Des brouillons prêts, rien ne part sans toi'),
    story('s3-s-st', 'Tu voudrais quoi d\'automatique ?', '', 'a-valider', 'Boîte à questions'),
  ] },
  { date: 'dim. 20 déc.', nom: 'Dimanche', theme: 'Transfert', but: 'Une fonction rare : rendre un compte à un client.', pieces: [
    vert('s3-d', '18:00', 'Rendre un compte à ton client', 'Ton client reprend son compte ? Tu le lui transfères.', [
      { t: '1', voix: 'Ton client reprend son compte ? Tu le lui transfères.', ecran: 'Accroche', texte: '🔁 Transférer' },
      { t: '2', voix: 'Dans Comptes, Transférer : le compte part avec son planning à venir, ses chiffres et ses vidéos. Il a quatorze jours pour accepter.', ecran: 'Comptes', vue: 'comptes' },
      { t: '3', voix: 'Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Rendre un compte à ton client, avec son planning et ses chiffres 🔁', 'Transférer un compte à un client 🔁 #freelance #communitymanager', 'Transférer un compte à un client'),
    story('s3-d-st', 'Ça t\'est déjà arrivé ?', 'Rendre un compte client', null, 'Sondage : Oui / Non'),
  ] },
]

// ───────────────────────────── Semaine 4 : confiance et retours ─────────────────────────────
const S4: Jour[] = [
  { date: 'lun. 21 déc.', nom: 'Lundi', theme: 'Vos questions', but: 'La FAQ en vidéo : sécurité, Drive, accès, équipe.', pieces: [
    yt('s4-yt', 'Vos questions sur Chapote CM : sécurité, Drive, équipe', 'Chapote CM : mes comptes sont-ils en sécurité ? Où vont mes vidéos ? (FAQ)', [
      { t: '0:00', voix: 'Les questions qu\'on me pose le plus sur Chapote CM. Réponses courtes.', ecran: 'Titre', texte: 'FAQ' },
      { t: '0:05', voix: 'Mes comptes sont-ils en sécurité ? Tu te connectes par les pages officielles de TikTok, de Google et de Meta. Chapote CM ne voit jamais tes mots de passe, et tu peux retirer l\'accès à tout moment.', ecran: 'Comptes', vue: 'comptes' },
      { t: '0:16', voix: 'Où vont mes vidéos ? Dans ton Google Drive, dans un dossier créé par Chapote CM, rangées par compte, mois et date.', ecran: 'Bibliothèque', vue: 'bibliotheque' },
      { t: '0:24', voix: 'Je peux essayer ? Oui, Chapote CM est en bêta, l\'accès est ouvert.', ecran: 'Accueil', vue: 'landing' },
      { t: '0:27', voix: 'Je peux travailler en équipe ? Oui : tu partages un groupe de comptes, en administrateur, en éditeur ou en lecteur.', ecran: 'Partage', vue: 'partage' },
      { t: '0:34', voix: 'Quels réseaux ? TikTok, YouTube Shorts et Instagram Reels, avec un compte professionnel pour Instagram. Plusieurs comptes par réseau.', ecran: 'Comptes', vue: 'comptes' },
      { t: '0:41', voix: 'Il faut un nouveau compte ? Non, si tu en as déjà un sur chapote point f r. Une autre question ? Pose-la en commentaire.', ecran: 'Fin', texte: 'cm.chapote.fr/avis' },
    ], `Les réponses aux questions les plus fréquentes sur Chapote CM.\n${L}\n\n• Sécurité des comptes\n• Où vont les vidéos\n• Accès bêta\n• Équipe\n• Réseaux pris en charge\n• Compte Chapote`,
      { type: 'image', src: '/promo/yt-tuto.webp', format: 'paysage', titre: 'VOS QUESTIONS', sous: 'Sécurité · Drive · Équipe' }),
    vert('s4-l', '12:30', 'Tes mots de passe ? Jamais vus.', 'Une appli te demande ton mot de passe TikTok ? Fuis.', [
      { t: '1', voix: 'Une appli te demande ton mot de passe TikTok ? Méfie-toi.', ecran: 'Accroche', texte: '🔐' },
      { t: '2', voix: 'Chapote CM passe par les pages officielles de TikTok, de Google et de Meta. Il ne voit jamais tes mots de passe.', ecran: 'Comptes', vue: 'comptes' },
      { t: '3', voix: 'Et tu retires l\'accès quand tu veux. Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Tes mots de passe ? Jamais vus 🔐\nConnexion par les pages officielles de TikTok, Google et Meta.', 'Ne donne jamais ton mot de passe TikTok à une appli 🔐 #securite #tiktoktips', 'Tes mots de passe ? Jamais vus'),
    story('s4-l-st', 'Ta question sur la sécurité ?', '', null, 'Boîte à questions'),
    x('s4-l-x', '12:00', 'FAQ', `Nouvelle vidéo : les questions les plus fréquentes sur Chapote CM (sécurité, Drive, équipe, réseaux).\n${L}`),
  ] },
  { date: 'mar. 22 déc.', nom: 'Mardi', theme: 'Sécurité du compte', but: 'Double authentification.', pieces: [
    vert('s4-ma', '12:30', 'Double authentification', 'Ton compte qui gère tous tes réseaux est protégé ?', [
      { t: '1', voix: 'Le compte qui gère tous tes réseaux, il est protégé ?', ecran: 'Accroche', texte: '🛡️' },
      { t: '2', voix: 'Dans Chapote CM, active la double authentification, et garde tes codes de secours.', ecran: 'Réglages', vue: 'reglages-apparence' },
      { t: '3', voix: 'Sur l\'app Android, le déverrouillage par empreinte. Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Protège le compte qui gère tous tes réseaux 🛡️\nDouble authentification et codes de secours.', 'Active la double authentification 🛡️ #securite #communitymanager', 'Double authentification et codes de secours'),
    story('s4-ma-st', 'Tu as activé la double authentification ?', '', null, 'Sondage : Oui / Pas encore'),
    li('s4-ma-li', '08:30', 'Sécurité', `Un outil qui gère plusieurs comptes clients doit être protégé en conséquence.

Chapote CM propose la double authentification, des codes de secours, et sur l'app Android le déverrouillage par empreinte ou visage. Les accès aux réseaux passent par les pages officielles de TikTok, Google et Meta.

${L}`),
  ] },
  { date: 'mer. 23 déc.', nom: 'Mercredi', theme: 'Testeurs Android', but: 'Trouver les 12 testeurs que Google Play exige avant la sortie de l\'app.', pieces: [
    vert('s4-me', '12:30', 'On cherche 12 testeurs', 'On cherche douze community managers.', [
      { t: '1', voix: 'On cherche douze community managers.', ecran: 'Accroche', texte: '12 places 📱' },
      { t: '2', voix: 'Pour tester l\'app Android de Chapote CM en avant-première. Google Play demande douze testeurs pendant quatorze jours.', ecran: 'Accueil', vue: 'landing' },
      { t: '3', voix: 'Tu publies depuis ton téléphone, et tu nous dis ce qui manque. Écris TESTEUR en commentaire.', ecran: 'Fin', texte: 'cm.chapote.fr/avis' },
    ], '12 places de testeurs pour l\'app Android 📱\nCommunity manager ? Teste-la en avant-première et dis-nous ce qui manque. Écris TESTEUR 👇', 'On cherche 12 CM pour tester l\'app Android en avant-première 📱 #communitymanager #android', 'On cherche 12 testeurs pour l\'app Android'),
    story('s4-me-st', 'Tu testerais l\'app Android ?', '12 places', null, 'Sondage : Oui / Je suis sur iPhone'),
  ] },
  { date: 'jeu. 24 déc.', nom: 'Jeudi', theme: 'Fêtes', but: 'Contenu de saison léger.', pieces: [
    vert('s4-j', '12:30', 'Programme tes vidéos des fêtes', 'Tu veux vraiment poster le soir du réveillon ?', [
      { t: '1', voix: 'Tu veux vraiment poster le soir du réveillon ?', ecran: 'Accroche', texte: '🎄' },
      { t: '2', voix: 'Programme tes vidéos des fêtes maintenant, et profite.', ecran: 'Planning', vue: 'planning' },
      { t: '3', voix: 'Joyeuses fêtes. Lien dans la bio.', ecran: 'Fin', texte: 'Joyeuses fêtes 🎄' },
    ], 'Programme tes vidéos des fêtes, et profite 🎄', 'Le réveillon, sans ton téléphone 🎄 #communitymanager', 'Programme tes vidéos des fêtes'),
    story('s4-j-st', 'Joyeuses fêtes 🎄', 'Tes vidéos sont programmées ?', null, 'Sondage : Oui / Je file le faire'),
  ] },
  { date: 'ven. 25 déc.', nom: 'Vendredi', theme: 'L\'assistant (rappel)', but: 'Rappel de la fonction assistant.', pieces: [
    vert('s4-v', '12:30', 'L\'assistant prépare, tu valides', 'Tu as essayé l\'assistant de Chapote CM ?', [
      { t: '1', voix: 'Tu as essayé l\'assistant de Chapote CM ?', ecran: 'Accroche', texte: '💬' },
      { t: '2', voix: 'Il cherche la vidéo, propose des créneaux libres, reprend le style de tes légendes, et te demande ce qu\'il ne peut pas choisir à ta place.', ecran: 'Assistant', vue: 'assistant' },
      { t: '3', voix: 'Puis c\'est toi qui lances. Lien dans la bio.', ecran: 'Fin', texte: 'Tu valides. Toujours.' },
    ], 'L\'assistant prépare, tu valides 💬', 'Un assistant qui prépare tes publications 💬 #IA #communitymanager', 'L\'assistant prépare, tu valides'),
    story('s4-v-st', 'Tu lui demanderais quoi ?', 'À l\'assistant', 'assistant', 'Boîte à questions'),
  ] },
  { date: 'sam. 26 déc.', nom: 'Samedi', theme: 'Retours', but: 'Inviter aux retours.', pieces: [
    vert('s4-s', '11:00', 'Ton avis décide de la suite', 'La prochaine fonction de Chapote CM, c\'est toi qui la choisis.', [
      { t: '1', voix: 'La prochaine fonction de Chapote CM, c\'est toi qui la choisis.', ecran: 'Accroche', texte: '🗳️' },
      { t: '2', voix: 'Va sur cm point chapote point f r slash avis : je lis chaque message.', ecran: 'Texte', texte: 'cm.chapote.fr/avis' },
    ], 'La prochaine fonction, c\'est toi qui la choisis 🗳️\ncm.chapote.fr/avis', 'Choisis la prochaine fonction 🗳️ #communitymanager', 'Ton avis décide de la suite'),
    story('s4-s-st', 'La fonction que tu veux ?', '', null, 'Boîte à questions'),
    x('s4-s-x', '12:00', 'Retours', `Quelle fonction voudrais-tu dans Chapote CM ? Je lis chaque message : ${L}/avis`),
  ] },
  { date: 'dim. 27 déc.', nom: 'Dimanche', theme: 'Récap du mois', but: 'Tout montrer en 30 secondes.', pieces: [
    vert('s4-d', '18:00', 'Chapote CM en 30 secondes', 'Chapote CM, en trente secondes.', [
      { t: '1', voix: 'Chapote CM, en trente secondes.', ecran: 'Accroche', texte: '30 s ⏱️' },
      { t: '2', voix: 'Une vidéo, tous tes comptes TikTok, YouTube et Instagram.', ecran: 'Étape 2', vue: 'composer-2' },
      { t: '3', voix: 'Le planning de la semaine.', ecran: 'Planning', vue: 'planning' },
      { t: '4', voix: 'Les statistiques réunies.', ecran: 'Stats', vue: 'stats' },
      { t: '5', voix: 'Tes vidéos dans ton Drive, ton équipe avec toi. Lien dans la bio.', ecran: 'Fin', texte: 'cm.chapote.fr' },
    ], 'Chapote CM en 30 secondes ⏱️', 'Chapote CM en 30 secondes ⏱️ #communitymanager', 'Chapote CM en 30 secondes'),
    story('s4-d-st', 'Merci pour ce premier mois ❤️', '', null, 'Sticker lien'),
    li('s4-d-li', '09:00', 'Bilan du mois (profil de Nathan)', `Un mois de Chapote CM en public.

[à compléter avec les vrais chiffres : inscriptions, comptes connectés, vidéos programmées]

Ce que vos retours ont changé :
• [retour 1]
• [retour 2]

La suite : l'app Android sur Google Play, et l'iPhone si vous êtes nombreux à la demander.

Merci à celles et ceux qui ont testé ${L}`),
  ] },
]

export const SEMAINES: Semaine[] = [
  { titre: 'Semaine 1 · Lancement', dates: '30 nov. – 6 déc.', jours: S1 },
  { titre: 'Semaine 2 · Gagner du temps', dates: '7 – 13 déc.', jours: S2 },
  { titre: 'Semaine 3 · Pour qui ?', dates: '14 – 20 déc.', jours: S3 },
  { titre: 'Semaine 4 · Confiance et retours', dates: '21 – 27 déc.', jours: S4 },
]

export const REGLES = [
  'Pas d\'« IA slop » : contenu professionnel qu\'on regarde sans se dire « c\'est de l\'IA » (pas de tournures génériques, d\'emojis en série, de visuels générés ni de voix plate ; vrais écrans, vrais faits, ton humain).',
  'Chaque vidéo verticale part sur Reels, Shorts et TikTok (programmée plus tard avec Chapote CM lui-même).',
  'Tutoiement sur Instagram, TikTok, YouTube et X ; vouvoiement sur LinkedIn.',
  'Aucun chiffre inventé : les écrans montrent des données de démonstration, et c\'est dit.',
  'Écrans : captures du code actuel de l\'app (pas d\'anciennes captures), avec des comptes fictifs.',
  'Lien unique : cm.chapote.fr. Retours : cm.chapote.fr/avis.',
  'On vend la valeur, pas la gratuité : temps gagné (un envoi, trois réseaux à l\'heure choisie), un seul planning multi-comptes, Drive, stats réunies, app Android. Au plus une mention discrète « en bêta » par semaine ; jamais « gratuit » ni « sans carte bancaire », aucune durée de gratuité ni prix futur promis.',
  'Appel aux testeurs Android : Google Play exige 12 testeurs pendant 14 jours avant la sortie ; on cherche des CM pour tester en avant-première et dire ce qui manque.',
  'Android : « en test, bientôt sur Google Play ». iPhone : seulement si on la demande.',
  'Rien n\'est publié ni programmé depuis cette page.',
]
