// Inscription faite, mais sous l'âge minimum : l'app reste fermée jusqu'à l'anniversaire.
import { Linking, View } from 'react-native'
import { useIdentity } from '../lib/identity'
import { useSession } from '../lib/session'
import { Button, Card, H1, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'
import { t, locale } from '../lib/i18n'

export default function Blocked() {
  const { identity } = useIdentity()
  const { me, signOut } = useSession()
  const until = identity?.blocked_until ? new Date(`${identity.blocked_until}T12:00:00`) : null
  const mail = `mailto:contact@chapote.fr?subject=${encodeURIComponent(t('Erreur de date de naissance'))}&body=${encodeURIComponent(
    t('Bonjour,\n\nMa date de naissance est mal enregistrée sur Chapote CM ({email}).\nLa bonne date est : \n\nMerci.', { email: me?.email || '' }))}`
  return (
    <Screen>
      <View style={{ gap: space.sm, paddingTop: space.xl }}>
        <H1>{t('Inscription réussie')}</H1>
        <Txt muted>
          {until
            ? t('Chapote CM est réservé aux personnes de {age} ans et plus. Votre compte est créé et s’ouvrira le {date}.', { age: identity?.min_age ?? 15, date: until.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) })
            : t('Chapote CM est réservé aux personnes de {age} ans et plus. Votre compte est créé et s’ouvrira à cet âge.', { age: identity?.min_age ?? 15 })}
        </Txt>
      </View>
      <Card>
        <Txt bold>{t('Une erreur sur votre date de naissance ?')}</Txt>
        <Txt small muted>{t('Écrivez-nous : nous la corrigerons.')}</Txt>
        <Button icon="external" title={t('Nous contacter')} onPress={() => Linking.openURL(mail).catch(() => {})} />
      </Card>
      <Button kind="ghost" icon="logout" title={t('Se déconnecter')} onPress={() => { signOut() }} />
    </Screen>
  )
}
