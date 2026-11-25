// Écran « Sécuriser votre compte » déjà vu par cet utilisateur sur ce téléphone.
export const onboardedKey = (userId: number) => `cm.onboarded.${userId}`

/** Inscription en étapes : 1 Sécuriser, 2 Bienvenue (comptes), 3 Stockage Drive, 4 Groupes (si plusieurs
 * comptes), 4 ou 5 Inviter. */
export const stepCount = (accounts: number) => (accounts >= 2 ? 5 : 4)
export const stepTitle = (n: number, accounts: number) => `Étape ${n} sur ${stepCount(accounts)}`
