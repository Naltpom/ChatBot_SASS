// Inscription faite, mais sous l'âge minimum : l'app reste fermée jusqu'à l'anniversaire.
import { Linking, View } from 'react-native'
import { useIdentity } from '../lib/identity'
import { useSession } from '../lib/session'
import { Button, Card, H1, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'

export default function Blocked() {
  const { identity } = useIdentity()
  const { me, signOut } = useSession()
  const until = identity?.blocked_until ? new Date(`${identity.blocked_until}T12:00:00`) : null
  const mail = `mailto:contact@chapote.fr?subject=${encodeURIComponent('Erreur de date de naissance')}&body=${encodeURIComponent(
    `Bonjour,\n\nMa date de naissance est mal enregistrée sur Chapote CM (${me?.email || ''}).\nLa bonne date est : \n\nMerci.`)}`
  return (
    <Screen>
      <View style={{ gap: space.sm, paddingTop: space.xl }}>
        <H1>Inscription réussie</H1>
        <Txt muted>
          Chapote CM est réservé aux personnes de {identity?.min_age ?? 15} ans et plus. Votre compte est créé et s’ouvrira
          {until ? ` le ${until.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : ' à cet âge'}.
        </Txt>
      </View>
      <Card>
        <Txt bold>Une erreur sur votre date de naissance ?</Txt>
        <Txt small muted>Écrivez-nous : nous la corrigerons.</Txt>
        <Button icon="external" title="Nous contacter" onPress={() => Linking.openURL(mail).catch(() => {})} />
      </Card>
      <Button kind="ghost" icon="logout" title="Se déconnecter" onPress={() => { signOut() }} />
    </Screen>
  )
}
