// Écran « Sécuriser votre compte » déjà vu par cet utilisateur sur ce téléphone.
import { t } from './i18n'

export const onboardedKey = (userId: number) => `cm.onboarded.${userId}`

/** Inscription : 1 Vos informations, 2 Vos comptes (ou une invitation), 3 Google Drive, 4 Première vidéo.
 * Un invité sans compte à lui s'arrête à l'étape 2. */
export const STEPS = 4
export const stepCount = (_accounts?: number) => STEPS
export const stepTitle = (n: number, _accounts?: number) => t('Étape {step} sur {total}', { step: n, total: STEPS })
