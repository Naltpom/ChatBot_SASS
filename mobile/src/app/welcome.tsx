// Compte sans aucun réseau connecté (nouveau compte, créé par exemple par « Continuer avec Google ») :
// au lieu d'écrans vides, on explique la suite et on mène à la connexion des comptes.
import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { Alert, View } from 'react-native'
import { useSession } from '../lib/session'
import { InvitationCard } from '../ui/ScopeBar'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { PLATFORM_LABEL, PLATFORMS, startOAuth, type Platform } from '../lib/api'
import { Button, Card, H1, Icon, Msg, PlatformLogo, Row, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'

export default function Welcome() {
  const router = useRouter()
  const { me, spaces, signOut, refresh } = useSession()
  const { org, invitations } = useSession()
  const [err, setErr] = useState<string | null>(null)
  const connect = async (p: Platform) => {
    setErr(null)
    try { const { authorize_url } = await startOAuth(p, org); await WebBrowser.openBrowserAsync(authorize_url); await refresh() }
    catch (e: any) { setErr(e?.message || 'Connexion impossible') }
  }
  const hasAccounts = spaces.some(s => (s.accounts || 0) > 0)
  useEffect(() => { if (hasAccounts) router.replace('/') }, [hasAccounts, router])

  return (
    <Screen onRefresh={refresh}>
      <View style={{ gap: space.sm, paddingTop: space.xl }}>
        <H1>Bienvenue{me?.name ? `, ${me.name.split(' ')[0]}` : ''}</H1>
        <Txt muted>Votre compte Chapote est prêt. Connectez votre premier compte : vos chiffres, votre planning et vos commentaires apparaîtront ici.</Txt>
      </View>
      {invitations.length ? <View style={{ gap: space.sm }}><Txt bold>Invitations reçues</Txt>{invitations.map(i => <InvitationCard key={i.id} inv={i} />)}</View> : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
      {PLATFORMS.map(p => (
        <Card key={p} onPress={() => connect(p)} accessibilityLabel={`Connecter ${PLATFORM_LABEL[p]}`}>
          <Row gap={space.md}>
            <PlatformLogo platform={p} size={36} />
            <View style={{ flex: 1 }}>
              <Txt bold size={17}>{PLATFORM_LABEL[p]}</Txt>
              <Txt small muted>{p === 'youtube' ? 'Chaîne YouTube (Shorts)' : p === 'instagram' ? 'Compte professionnel ou créateur' : 'Compte TikTok'}</Txt>
            </View>
            <Icon name="right" size={18} />
          </Row>
        </Card>
      ))}
      <Txt small muted>La connexion s’ouvre dans le navigateur. Si cm.chapote.fr vous demande de vous connecter, connectez-vous puis relancez.</Txt>
      <Card>
        <Txt bold>Vous travaillez en équipe ?</Txt>
        <Txt small muted>Demandez à un administrateur de l’équipe de vous inviter avec l’adresse {me?.email}. L’équipe apparaîtra ici dès que l’invitation est acceptée.</Txt>
        <Button title="Actualiser" icon="refresh" onPress={refresh} />
      </Card>
      <Button kind="ghost" icon="left" title="Étape 1 : sécuriser mon compte" onPress={() => router.push('/onboarding')} />
      <Card>
        <Txt small muted>Connecté avec {me?.email}. Ce n’est pas le bon compte ?</Txt>
        <Button kind="danger" title="Changer de compte" onPress={() => Alert.alert('Changer de compte ?', 'Vous serez déconnecté de cet appareil.', [
          { text: 'Annuler', style: 'cancel' }, { text: 'Se déconnecter', style: 'destructive', onPress: () => { signOut() } },
        ])} />
      </Card>
    </Screen>
  )
}
