// En-tête commun des étapes de l'inscription : « Étape N sur M » et flèche de retour.
import { Stack, useRouter } from 'expo-router'
import { stepTitle } from '../lib/onboarding'
import { useSession } from '../lib/session'
import { IconButton } from '../ui/kit'

/** Comptes de l'espace en cours (ceux qu'on range en groupes et qu'on partage). */
export function useOwnAccounts() {
  const { accounts, org } = useSession()
  return accounts.filter(a => (a.org_id ?? null) === org && a.mine !== false)
}

export function StepHeader({ n, backTo }: { n: number; backTo?: string }) {
  const router = useRouter()
  const own = useOwnAccounts()
  const back = () => (backTo ? router.replace(backTo as never) : router.canGoBack() ? router.back() : router.replace('/'))
  return <Stack.Screen options={{ title: stepTitle(n, own.length), headerBackVisible: false, gestureEnabled: false,
    headerLeft: () => <IconButton icon="left" label={`Revenir à l’étape ${n - 1}`} onPress={back} /> }} />
}
