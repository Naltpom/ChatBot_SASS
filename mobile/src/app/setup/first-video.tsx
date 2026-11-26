// Inscription, étape 4 : un seul objectif, programmer sa première vidéo.
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { t } from '../../lib/i18n'
import { STEPS } from '../../lib/onboarding'
import { StepHeader, StickyFooter, useOwnAccounts } from '../../features/steps'
import { StepProgress } from '../../ui/Progress'
import { Button, Card, H1, Icon, PlatformLogo, Row, Screen, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'

export default function FirstVideo() {
  const router = useRouter()
  const { c } = useTheme()
  const own = useOwnAccounts()
  const steps: [string, string][] = [
    ['upload', t('Choisissez une vidéo dans votre galerie (ou votre Bibliothèque Drive).')],
    ['edit', t('Écrivez la légende une fois : elle part sur chaque compte.')],
    ['clock', t('Choisissez l’heure. Chapote publie, même téléphone éteint.')],
  ]
  return (
    <Screen footer={
      <StickyFooter>
        <Button kind="primary" icon="plus" title={t('Planifier ma première vidéo')} onPress={() => router.push({ pathname: '/new', params: { first: '1' } })} style={{ minHeight: 52 }} />
        <Button kind="ghost" title={t('Je le ferai plus tard')} onPress={() => router.replace('/')} />
      </StickyFooter>
    }>
      <StepHeader n={4} />
      <View style={{ gap: space.md }}>
        <StepProgress step={4} total={STEPS} label={t('Première vidéo')} />
        <H1>{t('Dernière étape : votre première vidéo')}</H1>
        <Txt muted>{t('C’est le moment où Chapote commence à travailler pour vous. Une minute suffit.')}</Txt>
      </View>
      <Card>
        {steps.map(([icon, text], i) => (
          <Row key={i} gap={space.md} style={{ alignItems: 'flex-start' }}>
            <View style={{ width: 32, height: 32, borderRadius: radius.md, backgroundColor: c.infoBg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={icon as any} size={18} color={c.primary} />
            </View>
            <Txt style={{ flex: 1, paddingTop: 5 }}>{text}</Txt>
          </Row>
        ))}
      </Card>
      {own.length ? (
        <Row gap={space.sm} wrap>
          <Txt small muted>{t('Comptes prêts :')}</Txt>
          {own.map(a => <Row key={`${a.platform}${a.id}`} gap={4}><PlatformLogo platform={a.platform} size={16} /><Txt small>{a.name || a.handle}</Txt></Row>)}
        </Row>
      ) : null}
    </Screen>
  )
}
