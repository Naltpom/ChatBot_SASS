// Connexion et création de compte : Google ou e-mail, au même endroit. Double authentification ensuite si
// elle est active. Les champs sont vérifiés quand on passe au suivant, et un bouton grisé dit ce qui manque.
import { isChallenge } from '../lib/session-logic'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import type { TwoFAChallenge } from '../lib/api'
import { loginWithBrowser, loginWithCode, loginWithGoogle, loginWithPasskey, loginWithPassword, resumeBrowserLogin, sendPasswordLink, signUpWithPassword } from '../lib/auth'
import { nativeGoogleAvailable } from '../lib/google'
import { useSession } from '../lib/session'
import { Logo } from '../ui/Logo'
import { passkeyAvailable, passkeyError } from '../lib/passkey'
import { Missing } from '../ui/Progress'
import { Button, Field, Msg, PlatformLogo, Seg, Txt } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'

WebBrowser.maybeCompleteAuthSession()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <Path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <Path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <Path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </Svg>
  )
}

export default function Login() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const { signedIn } = useSession()
  const [mode, setMode] = useState<'choose' | 'email'>('choose')
  const [tab, setTab] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState({ email: false, password: false })
  const [challenge, setChallenge] = useState<TwoFAChallenge | null>(null)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Retour dans l'app après « Autoriser » (même si le lien de retour n'a pas marché, ou si l'app a redémarré).
  useEffect(() => {
    const tryResume = () => { resumeBrowserLogin().then(me => { if (me) signedIn(me) }).catch(() => {}) }
    tryResume()
    const sub = AppState.addEventListener('change', s => { if (s === 'active') tryResume() })
    return () => sub.remove()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => {
    setError(null); setInfo(null)
    try { await fn() } catch (e: any) { setError(e?.message || 'Connexion impossible') }
  }
  const viaBrowser = () => run(async () => { const me = await loginWithBrowser(); if (me) signedIn(me) })
  // Google natif ; si Google refuse la configuration de l'app (DEVELOPER_ERROR, ex. signature pas encore
  // reconnue), on passe tout seul par la connexion dans le navigateur, qui marche toujours.
  const viaGoogle = nativeGoogleAvailable
    ? () => run(async () => {
        let r
        try { r = await loginWithGoogle() } catch (e: any) {
          if (String(e?.code ?? '').includes('DEVELOPER') || String(e?.message ?? '').includes('DEVELOPER_ERROR') || e?.code === 10 || e?.code === '10') {
            const me = await loginWithBrowser(); if (me) signedIn(me); return
          }
          throw e
        }
        if (!r) return
        if (isChallenge(r)) setChallenge(r)
        else signedIn(r)
      })
    : viaBrowser
  const emailOk = EMAIL_RE.test(email.trim())
  const pwOk = tab === 'in' ? password.length > 0 : password.length >= 8
  const missing = [!emailOk && 'une adresse e-mail valide', !pwOk && (tab === 'up' ? 'un mot de passe de 8 caractères' : 'le mot de passe')].filter(Boolean) as string[]
  const submit = () => run(async () => {
    if (missing.length) { setTouched({ email: true, password: true }); return }
    if (tab === 'up') { signedIn(await signUpWithPassword(email.trim(), password)); return }
    const r = await loginWithPassword(email.trim(), password)
    if (isChallenge(r)) setChallenge(r)
    else signedIn(r)
  })
  const forgot = () => run(async () => {
    if (!emailOk) { setTouched(t => ({ ...t, email: true })); setError('Entrez d’abord votre adresse e-mail.'); return }
    await sendPasswordLink(email.trim())
    setInfo(`Si un compte existe pour ${email.trim()}, un lien vient d’être envoyé. Il ouvre l’app pour choisir un nouveau mot de passe.`)
  })
  const viaCode = () => run(async () => { if (challenge) signedIn(await loginWithCode(challenge.challenge, code.trim(), recovery)) })
  // Empreinte (clé d'accès) à la place du code : proposée d'office si le compte en a une et le téléphone le permet.
  const canPasskey = !!challenge?.methods.passkey && passkeyAvailable
  const [useCode, setUseCode] = useState(false)
  const viaPasskey = () => run(async () => {
    if (!challenge) return
    try { signedIn(await loginWithPasskey(challenge.challenge)) } catch (e) { throw new Error(passkeyError(e)) }
  })
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (canPasskey && challenge && asked.current !== challenge.challenge) { asked.current = challenge.challenge; setUseCode(false); viaPasskey() }
  }, [challenge?.challenge]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.xl, paddingTop: insets.top + 48, paddingBottom: insets.bottom + space.lg,
          gap: space.xl, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        <View style={{ gap: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Logo size={56} bg={c.logo} />
            <View>
              <Txt bold size={18}>Chapote CM</Txt>
              <Txt small muted>Content & Community Manager</Txt>
            </View>
          </View>
          <Txt size={32} bold style={{ lineHeight: 38, letterSpacing: -0.6 }} accessibilityRole="header">Vos vidéos courtes, programmées et suivies.</Txt>
          <Txt muted size={16}>Un seul planning pour TikTok, YouTube Shorts et Instagram Reels. Vos chiffres au même endroit.</Txt>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {(['tiktok', 'youtube', 'instagram'] as const).map(p => (
              <View key={p} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
                <PlatformLogo platform={p} size={20} />
              </View>
            ))}
          </View>
        </View>

        <View style={{ gap: space.md, marginTop: 'auto' }}>
          {error ? <Msg kind="err">{error}</Msg> : null}
          {info ? <Msg kind="ok">{info}</Msg> : null}
          {challenge && canPasskey && !useCode ? (
            <>
              <Txt bold size={18}>Confirmez avec votre empreinte</Txt>
              <Txt small muted>Votre empreinte ou votre visage remplace le code à 6 chiffres.</Txt>
              <Button kind="primary" icon="shield" title="Utiliser mon empreinte" onPress={viaPasskey} />
              {challenge.methods.totp || challenge.methods.recovery ? (
                <Button kind="ghost" title={challenge.methods.totp ? 'Utiliser un code à la place' : 'Utiliser un code de secours'}
                  onPress={() => { setUseCode(true); setRecovery(!challenge.methods.totp) }} />
              ) : null}
              <Button kind="ghost" title="Retour" onPress={() => { setChallenge(null); setCode('') }} />
            </>
          ) : challenge ? (
            <>
              <Txt bold size={18}>Double authentification</Txt>
              <Txt small muted>{recovery ? 'Entrez un de vos codes de secours.' : 'Entrez le code à 6 chiffres de votre application d’authentification.'}</Txt>
              <Field label={recovery ? 'Code de secours' : 'Code'} value={code} onChangeText={setCode} autoFocus
                keyboardType={recovery ? 'default' : 'number-pad'} textContentType="oneTimeCode" autoComplete="one-time-code" onSubmitEditing={viaCode} />
              <Button kind="primary" title="Valider" onPress={viaCode} disabled={!code.trim()} />
              {!code.trim() ? <Missing items={['le code']} /> : null}
              {challenge.methods.recovery ? <Button kind="ghost" title={recovery ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'} onPress={() => setRecovery(!recovery)} /> : null}
              {canPasskey ? <Button kind="ghost" icon="shield" title="Utiliser mon empreinte" onPress={() => { setUseCode(false); viaPasskey() }} /> : null}
              <Button kind="ghost" title="Retour" onPress={() => { setChallenge(null); setCode('') }} />
            </>
          ) : mode === 'choose' ? (
            <>
              <Pressable onPress={viaGoogle} accessibilityRole="button" accessibilityLabel="Continuer avec Google"
                style={({ pressed }) => ({ minHeight: 52, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: pressed ? 0.7 : 1 })}>
                <GoogleG /><Txt bold size={16}>Continuer avec Google</Txt>
              </Pressable>
              <Button kind="primary" icon="bolt" title="Continuer avec un e-mail" onPress={() => setMode('email')} style={{ minHeight: 52 }} />
              <Txt small muted center>Nouveau ? Le compte se crée en continuant. Gratuit, sans carte bancaire.</Txt>
            </>
          ) : (
            <>
              <Seg label="Se connecter ou créer un compte" value={tab} onChange={v => { setTab(v); setError(null); setInfo(null) }} options={[['in', 'Se connecter'], ['up', 'Créer un compte']]} />
              <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="nom@exemple.fr"
                autoComplete="email" textContentType="username" onBlur={() => setTouched(t => ({ ...t, email: true }))}
                error={touched.email && !emailOk ? 'Adresse incomplète : vérifiez le @ et la fin (.fr, .com…).' : null} />
              <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry
                autoComplete={tab === 'up' ? 'new-password' : 'current-password'} textContentType={tab === 'up' ? 'newPassword' : 'password'}
                onBlur={() => setTouched(t => ({ ...t, password: true }))} onSubmitEditing={submit}
                hint={tab === 'up' ? (password.length >= 8 ? '✓ 8 caractères ou plus' : `8 caractères au moins (${password.length}/8)`) : undefined}
                error={tab === 'in' && touched.password && !pwOk ? 'Entrez votre mot de passe.' : null} />
              <Button kind="primary" title={tab === 'up' ? 'Créer mon compte' : 'Se connecter'} onPress={submit} disabled={missing.length > 0} style={{ minHeight: 52 }} />
              <Missing items={touched.email || touched.password ? missing : []} />
              {tab === 'in' ? <Button kind="ghost" title="Mot de passe oublié ? Recevoir un lien" onPress={forgot} /> : null}
              <Button kind="ghost" icon="left" title="Autres façons de continuer" onPress={() => { setMode('choose'); setError(null) }} />
            </>
          )}
        </View>
        <Txt small muted center>
          <Txt small color={c.muted} onPress={() => WebBrowser.openBrowserAsync('https://chapote.fr/legal/confidentialite').catch(() => {})}>Confidentialité</Txt>
          {'  ·  '}
          <Txt small color={c.muted} onPress={() => WebBrowser.openBrowserAsync('https://chapote.fr/legal/cgu').catch(() => {})}>Conditions</Txt>
        </Txt>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
