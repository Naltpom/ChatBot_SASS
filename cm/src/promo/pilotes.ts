// Pilotes v2 des vidéos promo (docs/promo-video) : vidéo, légende, contrôles automatiques et note. Généré, ne pas modifier à la main.
export interface Controles { premier_mot_s: number; mots_par_s: number; accroche_mots: number; lufs: number; true_peak: number; images_figees_1_5s: number[]; plus_long_sans_evenement_s: number; plans: number; taps: number }
export interface Pilote { id: string; titre: string; format: string; accroche: string; src: string; poster: string; duree: number; legende: string; controles: Controles; note: number; avant: number; detail: Record<string, number>; remarques: string[] }
export const PILOTES: Pilote[] = []
