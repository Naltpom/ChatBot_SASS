// En-tête commun des étapes de l'inscription : « Étape N sur M » et flèche de retour.
import { Stack, useRouter } from 'expo-router'
import { stepTitle } from '../lib/onboarding'
import { useSession } from '../lib/session'
import { IconButton } from '../ui/kit'

/** Mes propres comptes (pas ceux des groupes partagés avec moi). */
export function useOwnAccounts() {
  const { accounts } = useSession()
  return accounts.filter(a => a.mine !== false)
}

/** Espace de mes comptes (où connecter le Drive et créer les groupes) : perso pour un nouveau compte. */
export function useSetupOrg(): number | null {
  const own = useOwnAccounts()
  return own[0]?.org_id ?? null
}

/** Comptes visibles grâce à une invitation acceptée. */
export function useSharedAccounts() {
  const { accounts } = useSession()
  return accounts.filter(a => a.mine === false)
}

export function StepHeader({ n, backTo }: { n: number; backTo?: string }) {
  const router = useRouter()
  const own = useOwnAccounts()
  const back = () => (backTo ? router.replace(backTo as never) : router.canGoBack() ? router.back() : router.replace('/'))
  return <Stack.Screen options={{ title: stepTitle(n, own.length), headerBackVisible: false, gestureEnabled: false,
    headerLeft: () => <IconButton icon="left" label={`Revenir à l’étape ${n - 1}`} onPress={back} /> }} />
}
