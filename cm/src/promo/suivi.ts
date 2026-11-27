// Suivi de la promo de Chapote CM (tableau de bord /promo) : statut de chaque publication, versions, retours d'expérience,
// prévisionnel sur 3 mois. Les contenus (scripts, textes) sont dans plan.ts ; les notes dans bilan.ts (v1) et pilotes.ts (v2).
import { SEMAINES, type Piece, type Plateforme } from './plan'
import { VIDEOS } from './videos'
import { NOTES } from './bilan'
import { PILOTES } from './pilotes'

export type Statut = 'idee' | 'script' | 'a_refaire' | 'en_test' | 'a_valider' | 'programme' | 'publie'
export const STATUTS: Record<Statut, { nom: string; couleur: string }> = {
  idee: { nom: 'Idée', couleur: '#a8a29e' },
  script: { nom: 'Script prêt', couleur: '#0ea5e9' },
  a_refaire: { nom: 'À refaire (v2)', couleur: '#dc2626' },
  en_test: { nom: 'Pilote en test', couleur: '#d97706' },
  a_valider: { nom: 'À valider', couleur: '#8b5cf6' },
  programme: { nom: 'Programmé', couleur: '#2563eb' },
  publie: { nom: 'Publié', couleur: '#15803d' },
}

export interface Retour { date: string; auteur: string; texte: string }
export interface Version {
  v: string; date: string; resume: string
  video?: { src: string; poster: string; format: 'verticale' | 'horizontale'; duree: number }
  note?: number; detail?: Record<string, number>; problemes?: string[]; aFaire?: boolean
}
export interface Entree {
  id: string; titre: string; format: string; plateformes: Plateforme[]; date: string; jour: number; semaine: number
  heure: string; statut: Statut; versions: Version[]; retours: Retour[]; piece?: Piece
}

const DEBUT = new Date(2026, 10, 30)   // lundi 30 novembre 2026 = semaine 1
export const dateDu = (jour: number) => new Date(DEBUT.getTime() + jour * 86400000)
export const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })

// Retours d'expérience communs (le 27/11/2026).
const RETOUR_V1: Retour = { date: '27/11/2026', auteur: 'Bilan', texte: 'v1 jugée trop statique (images figées 38 % du temps), son trop bas (-23 LUFS) sans musique, voix sans énergie, sous-titres sous la zone visible des applis. À refaire selon le guide v2.' }
const RETOUR_ECRANS: Retour = { date: '27/11/2026', auteur: 'Nathan', texte: 'Les écrans téléphone doivent venir de l\'app Android (c\'est l\'app qui prime), pas de cm.chapote.fr en version mobile, qui est en retard. Ordinateur : cm web.' }
const RETOUR_PRIX: Retour = { date: '27/11/2026', auteur: 'Nathan', texte: 'Ne pas vendre la gratuité ni « sans carte bancaire » : vendre la valeur et attirer des clients ; la bêta est gratuite pour les testeurs, pas un argument.' }

const RETOUR_SLOP: Retour = { date: '27/11/2026', auteur: 'Nathan', texte: 'Pas d\'« IA slop » : du contenu professionnel, qu\'on regarde sans se dire « c\'est de l\'IA ». Voix, textes, visuels et montage à juger avec la grille anti-slop.' }
const RETOUR_VITESSE: Retour = { date: '27/11/2026', auteur: 'Nathan', texte: 'v2.0 trop rapide : pas le temps de voir ni de lire, pas de respiration. Le hook est bon.' }
const RETOUR_AUDIO: Retour = { date: '27/11/2026', auteur: 'Nathan', texte: 'Audio et sous-titres faits sur le processeur du cloud (panne internet chez Nathan) : mauvais, à refaire sur le PC (Qwen3 GPU) au retour de la connexion.' }

/** Pilotes v2 rattachés à une publication du plan (le pilote devient la v2 de cette publication). */
export const PILOTE_DE: Record<string, string> = { resultat: 's1-l', pov: 's2-d', 'avant-apres': 's4-d' }

/** Toutes les publications du mois 1 (plan.ts), avec leur statut, leurs versions et leurs retours. */
export const ENTREES: Entree[] = SEMAINES.flatMap((s, si) => s.jours.flatMap((j, ji) => j.pieces.map(p => {
  const jour = si * 7 + ji
  const v = VIDEOS[p.id], n = NOTES[p.id]
  const versions: Version[] = [{
    v: 'v1', date: '27/11/2026', resume: v ? 'Rendu automatique : voix Qwen3 (PC), écrans de cm.chapote.fr, sous-titres mot à mot, sans musique.' : 'Textes et visuels.',
    video: v ? { src: v.src, poster: v.poster, format: p.video === 'horizontale' ? 'horizontale' : 'verticale', duree: v.duree } : undefined,
    note: n?.note, detail: n?.detail, problemes: n?.problemes,
  }]
  const retours: Retour[] = v ? [RETOUR_V1, RETOUR_ECRANS, RETOUR_SLOP] : []
  const pil = PILOTES.find(x => PILOTE_DE[x.id] === p.id)
  let statut: Statut = v ? 'a_refaire' : n && n.note < 7 ? 'a_refaire' : 'a_valider'
  if (pil) {
    versions.push(
      { v: 'v2.0', date: '27/11/2026', resume: `Pilote « ${pil.titre} » : caméra dans les vrais écrans, taps, accroche dès l'image 0, musique et effets à -14 LUFS. Rapide (voix ×1,1, 13-14 s). Notée par un évaluateur indépendant.`, note: pil.note, detail: pil.detail, problemes: pil.remarques.slice(0, -2) },
      { v: 'v2.1', date: '27/11/2026', resume: 'Rythme ralenti : voix naturelle, 0,5 s de respiration entre les phrases, fin tenue plus longtemps. Pas encore notée.', video: { src: pil.src, poster: pil.poster, format: 'verticale', duree: pil.duree } },
    )
    retours.push({ date: '27/11/2026', auteur: 'Évaluateur indépendant', texte: `v2.0 notée ${pil.note}/10 (v1 : ${n?.note ?? '—'}/10). ${pil.remarques[0]}` }, RETOUR_VITESSE, RETOUR_AUDIO)
    statut = 'en_test'
  } else if (v) {
    versions.push({ v: 'v2', date: 'à venir', resume: 'À produire selon le guide v2 et la grille anti-slop (écrans de l\'app Android, voix refaite sur le PC). Cible : 7/10 minimum sur chaque grille.', aFaire: true })
  }
  return { id: p.id, titre: p.titre, format: p.format, plateformes: p.plateformes, date: fmt(dateDu(jour)), jour, semaine: si, heure: p.heure, statut, versions, retours, piece: p }
})))

/** Publications qui ont un pilote v2 (laboratoire). */
export const LABO: Entree[] = ENTREES.filter(e => Object.values(PILOTE_DE).includes(e.id))

export const noteV1 = (e: Entree) => e.versions[0]?.note
export const noteActuelle = (e: Entree) => [...e.versions].reverse().find(v => v.note !== undefined)?.note
export const versionActuelle = (e: Entree) => [...e.versions].reverse().find(v => !v.aFaire) ?? e.versions[0]

/** Prévisionnel des mois 2 et 3 : une semaine = un thème, un but et ce qu'on prévoit d'y produire (rien n'est écrit). */
export interface SemainePrev { n: number; titre: string; but: string; prevu: Partial<Record<Plateforme | 'story', number>>; idees: string[] }
export const PREVISIONNEL: SemainePrev[] = [
  { n: 5, titre: 'Ta routine 2027', but: 'Installer l\'habitude « je programme ma semaine le dimanche ».', prevu: { instagram: 7, tiktok: 7, youtube: 8, linkedin: 2, x: 3, story: 4 }, idees: ['POV : ta semaine est prête avant lundi', 'Les 3 réglages à faire une fois pour toutes', 'Récap : un mois de vidéos programmées'] },
  { n: 6, titre: 'On cherche 12 CM testeurs', but: 'Recruter les 12 testeurs de l\'app Android exigés par Google Play (14 jours).', prevu: { instagram: 7, tiktok: 7, youtube: 7, linkedin: 3, x: 3, story: 5 }, idees: ['12 places pour tester l\'app Android avant tout le monde', 'Ce que les testeurs vont pouvoir faire', 'Le fondateur explique pourquoi il a besoin de vous'] },
  { n: 7, titre: 'Série : je ne publie plus à la main', but: 'Une série numérotée où chaque épisode tient seul.', prevu: { instagram: 7, tiktok: 7, youtube: 7, linkedin: 2, x: 2, story: 3 }, idees: ['Jour 1 : je programme 3 réseaux d\'un coup', 'Jour 4 : je vois tout sur un planning', 'Jour 7 : mes stats au même endroit'] },
  { n: 8, titre: 'Freelances multi-clients', but: 'Les groupes par client, le partage, le transfert de compte.', prevu: { instagram: 7, tiktok: 7, youtube: 8, linkedin: 3, x: 2, story: 3 }, idees: ['8 clients, 1 planning', 'Ton client voit son planning (groupe partagé)', 'Rendre un compte à un client qui part'] },
  { n: 9, titre: 'Ce que disent les testeurs', but: 'Seulement de vrais retours de testeurs, avec leur accord.', prevu: { instagram: 5, tiktok: 5, youtube: 6, linkedin: 3, x: 3, story: 4 }, idees: ['Retour de testeur n° 1 (vrai, avec accord)', 'Ce qu\'on a corrigé grâce à vous', 'La fonction la plus demandée'] },
  { n: 10, titre: 'Sortie sur Google Play', but: 'Annoncer l\'app Android publique, si Google la valide.', prevu: { instagram: 7, tiktok: 7, youtube: 8, linkedin: 3, x: 3, story: 6 }, idees: ['Elle est sur Google Play', 'Publier depuis la galerie du téléphone', 'Notifications quand une vidéo part'] },
  { n: 11, titre: 'Rendre des comptes avec les stats', but: 'Parler aux CM qui doivent montrer des chiffres à leurs clients.', prevu: { instagram: 7, tiktok: 7, youtube: 7, linkedin: 3, x: 2, story: 3 }, idees: ['Tes chiffres des 3 réseaux sur un écran', 'Quelle vidéo a le mieux marché ce mois-ci', 'Le rapport à envoyer au client'] },
  { n: 12, titre: 'Vos questions en vidéo', but: 'Répondre aux vraies questions reçues (commentaires, avis).', prevu: { instagram: 7, tiktok: 7, youtube: 8, linkedin: 2, x: 3, story: 4 }, idees: ['« Et si une publication échoue ? »', '« Mes vidéos sont-elles en sécurité ? »', '« Ça marche avec plusieurs comptes TikTok ? »'] },
].map(s => s)

/** Prochaines actions de la promo (tenues à la main). */
export const ACTIONS: { fait: boolean; texte: string }[] = [
  { fait: true, texte: '10 recherches et guide v2 (docs/promo-video)' },
  { fait: true, texte: '3 pilotes v2 rendus, notés (6,7/10 contre 5,2) puis ralentis' },
  { fait: true, texte: '« Sans carte bancaire » retiré de Chapote CM (landing, app, assistant)' },
  { fait: true, texte: 'Écrans de l\'app Android capturés (version web de démo, profil fictif)' },
  { fait: false, texte: 'Refaire voix et sous-titres sur le PC (Qwen3 GPU) quand la connexion revient' },
  { fait: false, texte: 'Remonter les pilotes avec les écrans de l\'app Android' },
  { fait: true, texte: 'Textes du mois réécrits : la valeur, pas la gratuité (appel aux 12 testeurs Android)' },
  { fait: false, texte: 'Nathan valide le style des pilotes → refaire les 32 vidéos' },
  { fait: false, texte: 'Écrire les semaines 5 à 12 (prévisionnel)' },
  { fait: true, texte: 'Conception du circuit des retours utilisateurs (blog : « Des retours utilisateurs aux PR »)' },
  { fait: false, texte: 'Nathan répond aux 8 questions du circuit des retours, puis étape 1 (collecte + regroupement + mail)' },
]

export const toutes = (): Entree[] => ENTREES
export const parId = (id: string) => ENTREES.find(e => e.id === id || `pilote-${Object.keys(PILOTE_DE).find(k => PILOTE_DE[k] === e.id)}` === id)
