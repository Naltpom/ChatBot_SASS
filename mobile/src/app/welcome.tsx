// Compte sans aucun réseau connecté (nouveau compte, créé par exemple par « Continuer avec Google ») :
// au lieu d'écrans vides, on explique la suite et on mène à la connexion des comptes.
import { useRouter } from 'expo-router'
import { Alert, View } from 'react-native'
import { useSession } from '../lib/session'
import { InvitationCard } from '../ui/ScopeBar'
import { useState } from 'react'
import { openAuthorize, PLATFORM_LABEL, PLATFORMS, startOAuth, type Platform } from '../lib/api'
import { Button, Card, H1, Icon, Msg, PlatformLogo, Row, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'
import { StepHeader, useOwnAccounts } from '../features/steps'

export default function Welcome() {
  const router = useRouter()
  const { me, signOut, refresh } = useSession()
  const { org, invitations } = useSession()
  const [err, setErr] = useState<string | null>(null)
  const connect = async (p: Platform) => {
    setErr(null)
    try { const { authorize_url } = await startOAuth(p, org); await openAuthorize(authorize_url); await refresh() }
    catch (e: any) { setErr(e?.message || 'Connexion impossible') }
  }
  const own = useOwnAccounts()

  return (
    <Screen onRefresh={refresh}>
      <StepHeader n={2} backTo="/onboarding?from=welcome" />
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
      <Txt small muted>La connexion s’ouvre dans le navigateur, puis vous ramène ici. Vous pouvez en connecter plusieurs.</Txt>
      {own.length ? (
        <Card>
          <Txt bold>{own.length} compte{own.length > 1 ? 's' : ''} connecté{own.length > 1 ? 's' : ''}</Txt>
          {own.map(a => (
            <Row key={`${a.platform}:${a.id}`} gap={space.sm}>
              <PlatformLogo platform={a.platform} size={20} />
              <Txt style={{ flex: 1 }} numberOfLines={1}>{a.name || a.handle || PLATFORM_LABEL[a.platform]}</Txt>
              <Icon name="check" size={16} />
            </Row>
          ))}
        </Card>
      ) : null}
      <Button kind={own.length ? 'primary' : 'ghost'} title={own.length ? 'Continuer' : 'Passer cette étape'} onPress={() => router.push('/setup/drive')} />
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
