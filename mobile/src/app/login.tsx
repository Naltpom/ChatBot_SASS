// Connexion : navigateur intégré (Google, double authentification, comme sur le site) ou e-mail.
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { G, Path, Rect } from 'react-native-svg'
import type { TwoFAChallenge } from '../lib/api'
import { loginWithBrowser, loginWithCode, loginWithGoogle, loginWithPassword } from '../lib/auth'
import { nativeGoogleAvailable } from '../lib/google'
import { API_URL } from '../lib/http'
import { useSession } from '../lib/session'
import { Button, Divider, Field, H1, Msg, Row, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'

WebBrowser.maybeCompleteAuthSession()

function Mark({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect width="24" height="24" rx="6.5" fill="#1d1d1f" />
      <G stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <Path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" />
        <Path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" />
      </G>
    </Svg>
  )
}

export default function Login() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const { signedIn } = useSession()
  const [mode, setMode] = useState<'choose' | 'email'>('choose')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState<TwoFAChallenge | null>(null)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try { await fn() } catch (e: any) { setError(e?.message || 'Connexion impossible') }
  }
  const viaBrowser = () => run(async () => { const me = await loginWithBrowser(); if (me) signedIn(me) })
  const viaGoogle = nativeGoogleAvailable
    ? () => run(async () => {
        const r = await loginWithGoogle()
        if (!r) return
        if ('twofa_required' in r) setChallenge(r)
        else signedIn(r)
      })
    : viaBrowser
  const viaEmail = () => run(async () => {
    const r = await loginWithPassword(email.trim(), password)
    if ('twofa_required' in r) setChallenge(r)
    else signedIn(r)
  })
  const viaCode = () => run(async () => { if (challenge) signedIn(await loginWithCode(challenge.challenge, code.trim(), recovery)) })

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, padding: space.xl, paddingTop: insets.top + 56, paddingBottom: insets.bottom + space.xl, gap: space.xl,
          width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        <View style={{ gap: space.md }}>
          <Mark />
          <H1>Chapote CM</H1>
          <Txt muted>Votre planning TikTok, YouTube et Instagram dans la poche : programmer, suivre, répondre.</Txt>
        </View>

        <View style={{ gap: space.md, marginTop: 'auto' }}>
          {error ? <Msg kind="err">{error}</Msg> : null}
          {challenge ? (
            <>
              <Txt bold>Double authentification</Txt>
              <Txt small muted>{recovery ? 'Entrez un de vos codes de secours.' : 'Entrez le code à 6 chiffres de votre application d’authentification.'}</Txt>
              <Field label={recovery ? 'Code de secours' : 'Code'} value={code} onChangeText={setCode} autoFocus
                keyboardType={recovery ? 'default' : 'number-pad'} textContentType="oneTimeCode" autoComplete="one-time-code" onSubmitEditing={viaCode} />
              <Button kind="primary" title="Valider" onPress={viaCode} disabled={!code.trim()} />
              {challenge.methods.recovery ? <Button kind="ghost" title={recovery ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'} onPress={() => setRecovery(!recovery)} /> : null}
              {challenge.methods.passkey && !challenge.methods.totp ? <Txt small muted>Clé d’accès : utilisez « Se connecter avec le navigateur ».</Txt> : null}
              <Button kind="ghost" title="Retour" onPress={() => { setChallenge(null); setCode('') }} />
            </>
          ) : (
            <>
              <Button kind="secondary" title="Continuer avec Google" onPress={viaGoogle} />
              {nativeGoogleAvailable ? null : <Txt small muted center>Une page sécurisée de cm.chapote.fr s’ouvre (même compte que sur le site, double authentification comprise).</Txt>}
              <Divider />
              {mode === 'email' ? (
                <>
                  <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
                    autoComplete="email" textContentType="username" />
                  <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password"
                    textContentType="password" onSubmitEditing={viaEmail} />
                  <Button kind="primary" title="Se connecter" onPress={viaEmail} disabled={!email.trim() || !password} />
                  <Button kind="ghost" title="Mot de passe oublié" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/`)} />
                </>
              ) : (
                <Button kind="primary" title="Se connecter avec un e-mail" onPress={() => setMode('email')} />
              )}
            </>
          )}
        </View>
        <Divider />
        <Row style={{ justifyContent: 'center' }} gap={space.lg}>
          <Button kind="ghost" small title="Créer un compte" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/`)} />
          <Button kind="ghost" small title="Confidentialité" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/privacy`)} />
        </Row>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
