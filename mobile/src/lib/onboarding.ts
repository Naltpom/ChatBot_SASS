// Écran « Sécuriser votre compte » déjà vu par cet utilisateur sur ce téléphone.
export const onboardedKey = (userId: number) => `cm.onboarded.${userId}`

/** Inscription en étapes : 1 Sécuriser (facultatif), 2 Bienvenue (connecter ses comptes et/ou accepter des
 * invitations), puis avec ses propres comptes : 3 Stockage Drive (obligatoire), 4 Groupes (si plusieurs comptes). */
export const stepCount = (accounts: number) => (accounts >= 2 ? 4 : 3)
export const stepTitle = (n: number, accounts: number) => `Étape ${n} sur ${stepCount(accounts)}`
