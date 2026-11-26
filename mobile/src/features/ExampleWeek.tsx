// Planning d'un compte neuf : jamais vide. Un aperçu grisé d'une semaine type, marqué « Exemple »,
// et l'action pour programmer la vraie première vidéo.
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { t } from '../lib/i18n'
import { Button, Card, PlatformLogo, Txt } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'

const SAMPLE: [string, string, ('tiktok' | 'youtube' | 'instagram')[]][] = [
  ['Lun. 18:30', 'Les coulisses du tournage', ['tiktok', 'instagram']],
  ['Mer. 12:00', 'Astuce de la semaine', ['youtube', 'tiktok']],
  ['Ven. 19:00', 'Avant / après', ['tiktok', 'youtube', 'instagram']],
]

export function ExampleWeek({ canEdit }: { canEdit: boolean }) {
  const router = useRouter()
  const { c } = useTheme()
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt bold size={17}>{t('À quoi ressemblera votre semaine')}</Txt>
        <View style={{ backgroundColor: c.surface2, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 }}><Txt size={12} bold color={c.muted}>{t('Exemple')}</Txt></View>
      </View>
      <View style={{ gap: space.sm, opacity: 0.55 }} accessibilityLabel={t('Exemple de planning')}>
        {SAMPLE.map(([when, title, nets]) => (
          <View key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md,
            borderWidth: 1, borderStyle: 'dashed', borderColor: c.borderStrong }}>
            <Txt bold small style={{ width: 72 }}>{t(when)}</Txt>
            <View style={{ flex: 1, gap: 4 }}>
              <Txt numberOfLines={1}>{t(title)}</Txt>
              <View style={{ flexDirection: 'row', gap: 6 }}>{nets.map(p => <PlatformLogo key={p} platform={p} size={14} />)}</View>
            </View>
            <Txt small muted>{t('programmée')}</Txt>
          </View>
        ))}
      </View>
      <Txt small muted>{t('Chaque vidéo part toute seule à l’heure choisie, sur chaque compte. Vous suivez ici ce qui est publié.')}</Txt>
      {canEdit ? <Button kind="primary" icon="plus" title={t('Planifier ma vraie première vidéo')} onPress={() => router.push('/new')} /> : null}
    </Card>
  )
}
