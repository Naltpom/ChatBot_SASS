import { FEATURES } from '../../lib/features'
import { Tabs, useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ScopeTitle, HeaderActions } from '../../ui/ScopeBar'
import { Icon, type IconName } from '../../ui/kit'
import { useTheme } from '../../ui/theme'
import { useRole } from '../../lib/session'
import { assistantAvailable } from '../../lib/assistant'

const icon = (name: IconName) => ({ color }: { color: unknown }) => <Icon name={name} size={24} color={String(color)} />

export default function TabsLayout() {
  const { c } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { canEdit } = useRole()
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: c.bg }, headerShadowVisible: false, headerTitleAlign: 'left',
      headerTitle: () => <ScopeTitle />, headerRight: () => <HeaderActions />,
      tabBarActiveTintColor: c.primary, tabBarInactiveTintColor: c.muted,
      tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 58 + insets.bottom, paddingTop: 6 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }, sceneStyle: { backgroundColor: c.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Planning', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="comments" options={{ title: 'Commentaires', tabBarIcon: icon('comment'), href: FEATURES.comments ? undefined : null }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats', tabBarIcon: icon('chart') }} />
      <Tabs.Screen name="publish" options={{
        title: 'Planifier', tabBarAccessibilityLabel: 'Nouvelle publication',
        // Lecture seule : pas de bouton « + » (le rôle vient de l'espace affiché).
        tabBarButton: () => !canEdit ? null : (
          <Pressable onPress={() => router.push('/new')} accessibilityRole="button" accessibilityLabel="Nouvelle publication"
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 52, height: 40, borderRadius: 14, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" size={24} color={c.onPrimary} strokeWidth={2.4} />
            </View>
          </Pressable>
        ),
      }} />
      <Tabs.Screen name="library" options={{ title: 'Bibliothèque', tabBarIcon: icon('folder') }} />
      <Tabs.Screen name="assistant" options={{ title: 'Assistant', tabBarIcon: icon('comment'), href: assistantAvailable ? undefined : null }} />
    </Tabs>
  )
}
