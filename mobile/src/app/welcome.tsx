// Inscription, étape 2 : connecter ses comptes TikTok, YouTube, Instagram, et/ou accepter une invitation.
// Avec un compte à soi : on continue vers le Drive. Invité seulement : l'inscription se termine ici.
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { inviteToken, openAuthorize, PLATFORM_LABEL, PLATFORMS, startOAuth, type Platform } from '../lib/api'
import { STEPS } from '../lib/onboarding'
import { useSession } from '../lib/session'
import { StepHeader, StickyFooter, useOwnAccounts, useSetupOrg, useSharedAccounts } from '../features/steps'
import { InvitationCard } from '../ui/ScopeBar'
import { Missing, StepProgress } from '../ui/Progress'
import { Button, Card, Field, H1, Icon, Msg, PlatformLogo, Row, Screen, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'
import { showDialog } from '../ui/dialog'

const HINT: Record<Platform, string> = { tiktok: 'Compte TikTok', youtube: 'Chaîne YouTube (Shorts)', instagram: 'Compte pro ou créateur' }

export default function Welcome() {
  const router = useRouter()
  const { c } = useTheme()
  const { me, signOut, refresh, invitations } = useSession()
  const org = useSetupOrg()
  const own = useOwnAccounts()
  const shared = useSharedAccounts()
  const [err, setErr] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const connect = async (p: Platform) => {
    setErr(null)
    try { const { authorize_url } = await startOAuth(p, org); await openAuthorize(authorize_url); await refresh() }
    catch (e: any) { setErr(e?.message || 'Connexion impossible') }
  }
  const done = (p: Platform) => own.filter(a => a.platform === p)

  return (
    <Screen onRefresh={refresh} footer={
      <StickyFooter>
        {own.length ? <Button kind="primary" title="Continuer : où ranger les vidéos" onPress={() => router.push('/setup/drive')} style={{ minHeight: 52 }} />
          : shared.length ? <Button kind="primary" title="Terminer l’inscription" onPress={() => router.replace('/')} style={{ minHeight: 52 }} />
          : <><Button kind="primary" title="Continuer" disabled style={{ minHeight: 52 }} /><Missing items={['un compte connecté ou une invitation acceptée']} /></>}
      </StickyFooter>
    }>
      <StepHeader n={2} backTo="/onboarding" />
      <View style={{ gap: space.md }}>
        <StepProgress step={2} total={STEPS} label="Vos comptes" />
        <H1>{me?.name ? `${me.name.split(' ')[0]}, connectez vos comptes` : 'Connectez vos comptes'}</H1>
        <Txt muted>Chapote publie à votre place et relève vos chiffres. La connexion se fait chez TikTok, Google ou Instagram, puis vous revenez ici.</Txt>
      </View>
      {invitations.length ? (
        <View style={{ gap: space.sm }}>
          <Txt bold>Une équipe vous attend</Txt>
          {invitations.map(i => <InvitationCard key={i.id} inv={i} />)}
        </View>
      ) : null}
      {shared.length ? <Msg kind="ok">Invitation acceptée : {shared.length} compte{shared.length > 1 ? 's' : ''} partagé{shared.length > 1 ? 's' : ''} avec vous.</Msg> : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
      <View style={{ gap: space.sm }}>
        {PLATFORMS.map(p => {
          const list = done(p)
          return (
            <Card key={p} onPress={() => connect(p)} accessibilityLabel={list.length ? `Ajouter un autre compte ${PLATFORM_LABEL[p]}` : `Connecter ${PLATFORM_LABEL[p]}`}>
              <Row gap={space.md}>
                <PlatformLogo platform={p} size={36} />
                <View style={{ flex: 1 }}>
                  <Txt bold size={17}>{PLATFORM_LABEL[p]}</Txt>
                  <Txt small muted numberOfLines={1}>{list.length ? list.map(a => a.name || a.handle).join(', ') : HINT[p]}</Txt>
                </View>
                {list.length
                  ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="check" size={18} color={c.ok} /><Txt small bold color={c.ok}>Connecté</Txt></View>
                  : <Txt small bold color={c.primary}>Connecter</Txt>}
              </Row>
            </Card>
          )
        })}
      </View>
      <Txt small muted>Vous pouvez en connecter plusieurs, et en ajouter d’autres plus tard.</Txt>
      <Card>
        <Txt bold>Invité par une équipe ?</Txt>
        <Txt small muted>Collez le lien d’invitation reçu par message, ou demandez qu’on vous invite avec {me?.email}.</Txt>
        <Field label="Lien d’invitation" value={link} onChangeText={setLink} placeholder="https://cm.chapote.fr/api/cm/join?t=…" autoCapitalize="none" autoCorrect={false} />
        <Button title="Ouvrir l’invitation" disabled={!inviteToken(link)} onPress={() => { const t = inviteToken(link); if (t) router.push({ pathname: '/join', params: { t } }) }} />
      </Card>
      <Button kind="ghost" small title={`Pas le bon compte (${me?.email}) ? Changer`} onPress={() => showDialog('Changer de compte ?', 'Vous serez déconnecté de ce téléphone.', [
        { text: 'Annuler', style: 'cancel' }, { text: 'Se déconnecter', style: 'destructive', onPress: () => { signOut() } },
      ])} />
    </Screen>
  )
}
