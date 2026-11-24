// Compte sans aucun réseau connecté (nouveau compte, créé par exemple par « Continuer avec Google ») :
// au lieu d'écrans vides, on explique la suite et on mène à la connexion des comptes.
import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { Alert, View } from 'react-native'
import { useSession } from '../lib/session'
import { Button, Card, H1, PlatformLogo, Row, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'

export default function Welcome() {
  const router = useRouter()
  const { me, spaces, signOut, refresh } = useSession()
  const hasAccounts = spaces.some(s => (s.accounts || 0) > 0)
  useEffect(() => { if (hasAccounts) router.replace('/') }, [hasAccounts, router])

  return (
    <Screen onRefresh={refresh}>
      <View style={{ gap: space.sm, paddingTop: space.xl }}>
        <H1>Bienvenue{me?.name ? `, ${me.name.split(' ')[0]}` : ''}</H1>
        <Txt muted>Votre compte Chapote est prêt. Connectez votre premier compte : vos chiffres, votre planning et vos commentaires apparaîtront ici.</Txt>
      </View>
      <Card>
        <Row gap={space.md}>
          <PlatformLogo platform="tiktok" size={28} />
          <PlatformLogo platform="youtube" size={28} />
          <PlatformLogo platform="instagram" size={28} />
        </Row>
        <Txt bold>TikTok, YouTube ou Instagram</Txt>
        <Txt small muted>La connexion s’ouvre dans le navigateur, comme sur cm.chapote.fr.</Txt>
        <Button kind="primary" title="Connecter un compte" onPress={() => router.push('/accounts')} />
      </Card>
      <Card>
        <Txt bold>Vous travaillez en équipe ?</Txt>
        <Txt small muted>Demandez à un administrateur de l’équipe de vous inviter avec l’adresse {me?.email}. L’équipe apparaîtra ici dès que l’invitation est acceptée.</Txt>
        <Button title="Actualiser" icon="refresh" onPress={refresh} />
      </Card>
      <Card>
        <Txt small muted>Connecté avec {me?.email}. Ce n’est pas le bon compte ?</Txt>
        <Button kind="danger" title="Changer de compte" onPress={() => Alert.alert('Changer de compte ?', 'Vous serez déconnecté de cet appareil.', [
          { text: 'Annuler', style: 'cancel' }, { text: 'Se déconnecter', style: 'destructive', onPress: () => { signOut() } },
        ])} />
      </Card>
    </Screen>
  )
}
