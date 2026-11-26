// En-tête commun des étapes de l'inscription : « Étape N sur M » et flèche de retour.
import { Stack, useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { space, useTheme } from '../ui/theme'
import { useSession } from '../lib/session'
import { t } from '../lib/i18n'
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
  const back = () => (backTo ? router.replace(backTo as never) : router.canGoBack() ? router.back() : router.replace('/'))
  return <Stack.Screen options={{ title: '', headerShadowVisible: false, headerBackVisible: false, gestureEnabled: false,
    headerLeft: n > 1 ? () => <IconButton icon="left" label={t('Revenir à l’étape {n}', { n: n - 1 })} onPress={back} /> : () => null }} />
}

/** Bouton principal en bas de l'écran, à portée du pouce. */
export function StickyFooter({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: insets.bottom + space.md, gap: space.sm,
      backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.border }}>
      <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center', gap: space.sm }}>{children}</View>
    </View>
  )
}
