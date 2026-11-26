import * as Clipboard from 'expo-clipboard'
import { ScrollView, View } from 'react-native'
import { Button, H2, Txt } from './kit'
import { space, useTheme } from './theme'
import { t } from '../lib/i18n'

export function ErrorScreen({ message, stack, onRetry }: { message: string; stack?: string; onRetry: () => void }) {
  const { c } = useTheme()
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.xl, paddingTop: 80, gap: space.md }}>
      <H2>{t('Oups, un problème')}</H2>
      <Txt muted>{t('L’app a rencontré une erreur. Envoyez ce message pour qu’on la corrige :')}</Txt>
      <View style={{ backgroundColor: c.surface, borderRadius: 12, padding: space.md, borderWidth: 1, borderColor: c.border }}>
        <Txt selectable bold>{message}</Txt>
        {stack ? <Txt selectable small muted>{stack}</Txt> : null}
      </View>
      <Button title={t('Copier le message')} icon="copy" onPress={() => Clipboard.setStringAsync(`${message}\n${stack || ''}`)} />
      <Button kind="primary" title={t('Réessayer')} onPress={onRetry} />
    </ScrollView>
  )
}
