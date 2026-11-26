// Connexion et création de compte : Google ou e-mail, au même endroit. Double authentification ensuite si
// elle est active. Les champs sont vérifiés quand on passe au suivant, et un bouton grisé dit ce qui manque.
import { isChallenge } from '../lib/session-logic'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import type { TwoFAChallenge } from '../lib/api'
import { loginWithBrowser, loginWithCode, loginWithGoogle, loginWithPasskey, loginWithPassword, resumeBrowserLogin, sendPasswordLink, signUpWithPassword } from '../lib/auth'
import { nativeGoogleAvailable } from '../lib/google'
import { useSession } from '../lib/session'
import { Logo } from '../ui/Logo'
import { challengeUser, passkeyAvailable, passkeyDone, passkeyError } from '../lib/passkey'
import { Missing } from '../ui/Progress'
import { Button, Field, Msg, PlatformLogo, Seg, Txt } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'
import { t } from '../lib/i18n'

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
  // Formulaire (e-mail, code, empreinte) : seulement l'essentiel en haut, pour que le clavier ne cache rien.
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

  const compact = !!challenge || mode === 'email'
  const run = async (fn: () => Promise<void>) => {
    setError(null); setInfo(null)
    try { await fn() } catch (e: any) { setError(e?.message || t('Connexion impossible')) }
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
  const missing = [!emailOk && t('une adresse e-mail valide'), !pwOk && (tab === 'up' ? t('un mot de passe de 8 caractères') : t('le mot de passe'))].filter(Boolean) as string[]
  const submit = () => run(async () => {
    if (missing.length) { setTouched({ email: true, password: true }); return }
    if (tab === 'up') { signedIn(await signUpWithPassword(email.trim(), password)); return }
    const r = await loginWithPassword(email.trim(), password)
    if (isChallenge(r)) setChallenge(r)
    else signedIn(r)
  })
  const forgot = () => run(async () => {
    if (!emailOk) { setTouched(prev => ({ ...prev, email: true })); setError(t('Entrez d’abord votre adresse e-mail.')); return }
    await sendPasswordLink(email.trim())
    setInfo(t('Si un compte existe pour {email}, un lien vient d’être envoyé. Il ouvre l’app pour choisir un nouveau mot de passe.', { email: email.trim() }))
  })
  const viaCode = () => run(async () => { if (challenge) signedIn(await loginWithCode(challenge.challenge, code.trim(), recovery)) })
  // Empreinte (clé d'accès) à la place du code : proposée d'office si le compte en a une et le téléphone le permet.
  // Empreinte : seulement si ce téléphone a une clé active pour ce compte.
  const [canPasskey, setCanPasskey] = useState(false)
  useEffect(() => {
    const uid = challenge ? challengeUser(challenge.challenge) : null
    if (!challenge || !uid || !passkeyAvailable) { setCanPasskey(false); return }
    passkeyDone(uid).then(setCanPasskey)
  }, [challenge?.challenge])
  const [useCode, setUseCode] = useState(false)
  const viaPasskey = () => run(async () => {
    if (!challenge) return
    try { signedIn(await loginWithPasskey(challenge.challenge)) } catch (e) { throw new Error(passkeyError(e)) }
  })
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (canPasskey && challenge && asked.current !== challenge.challenge) { asked.current = challenge.challenge; setUseCode(false); viaPasskey() }
  }, [challenge?.challenge, canPasskey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.xl, paddingTop: insets.top + (compact ? 24 : 48), paddingBottom: insets.bottom + space.lg,
          gap: space.xl, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        <View style={{ gap: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Logo size={56} bg={c.logo} />
            <View>
              <Txt bold size={18}>Chapote CM</Txt>
              <Txt small muted>Content & Community Manager</Txt>
            </View>
          </View>
          {/* Étape du code ou de l'empreinte : seulement l'essentiel, pour que le clavier ne cache rien. */}
          {!compact ? (
            <>
              <Txt size={32} bold style={{ lineHeight: 38, letterSpacing: -0.6 }} accessibilityRole="header">{t('Vos vidéos courtes, programmées et suivies.')}</Txt>
              <Txt muted size={16}>{t('Un seul planning pour TikTok, YouTube Shorts et Instagram Reels. Vos chiffres au même endroit.')}</Txt>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                {(['tiktok', 'youtube', 'instagram'] as const).map(p => (
                  <View key={p} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
                    <PlatformLogo platform={p} size={20} />
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </View>

        <View style={{ gap: space.md, marginTop: compact ? 0 : 'auto' }}>
          {error ? <Msg kind="err">{error}</Msg> : null}
          {info ? <Msg kind="ok">{info}</Msg> : null}
          {challenge && canPasskey && !useCode ? (
            <>
              <Txt bold size={18}>{t('Confirmez avec votre empreinte')}</Txt>
              <Txt small muted>{t('Votre empreinte ou votre visage remplace le code à 6 chiffres.')}</Txt>
              <Button kind="primary" icon="shield" title={t('Utiliser mon empreinte')} onPress={viaPasskey} />
              {challenge.methods.totp || challenge.methods.recovery ? (
                <Button kind="ghost" title={challenge.methods.totp ? t('Utiliser un code à la place') : t('Utiliser un code de secours')}
                  onPress={() => { setUseCode(true); setRecovery(!challenge.methods.totp) }} />
              ) : null}
              <Button kind="ghost" title={t('Retour')} onPress={() => { setChallenge(null); setCode('') }} />
            </>
          ) : challenge ? (
            <>
              <Txt bold size={22} accessibilityRole="header">{recovery ? t('Code de secours') : t('Code de connexion')}</Txt>
              <Txt muted>{recovery ? t('Entrez un de vos codes de secours.') : t('Le code à 6 chiffres de votre application d’authentification.')}</Txt>
              <CodeInput value={code} recovery={recovery} onChange={v => {
                setCode(v)
                // 6 chiffres tapés : validé tout de suite, sans chercher le bouton.
                if (!recovery && /^\d{6}$/.test(v) && challenge) run(async () => { signedIn(await loginWithCode(challenge.challenge, v, false)) })
              }} onSubmit={viaCode} />
              <Button kind="primary" title={t('Valider')} onPress={viaCode} disabled={!code.trim()} />
              {!code.trim() ? <Missing items={[t('le code')]} /> : null}
              {challenge.methods.recovery ? <Button kind="ghost" title={recovery ? t('Utiliser le code de l’application') : t('Utiliser un code de secours')} onPress={() => setRecovery(!recovery)} /> : null}
              {canPasskey ? <Button kind="ghost" icon="shield" title={t('Utiliser mon empreinte')} onPress={() => { setUseCode(false); viaPasskey() }} /> : null}
              <Button kind="ghost" title={t('Retour')} onPress={() => { setChallenge(null); setCode('') }} />
            </>
          ) : mode === 'choose' ? (
            <>
              <Pressable onPress={viaGoogle} accessibilityRole="button" accessibilityLabel={t('Continuer avec Google')}
                style={({ pressed }) => ({ minHeight: 52, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: pressed ? 0.7 : 1 })}>
                <GoogleG /><Txt bold size={16}>{t('Continuer avec Google')}</Txt>
              </Pressable>
              <Button kind="primary" icon="bolt" title={t('Continuer avec un e-mail')} onPress={() => setMode('email')} style={{ minHeight: 52 }} />
              <Txt small muted center>{t('Nouveau ? Le compte se crée en continuant. Gratuit, sans carte bancaire.')}</Txt>
            </>
          ) : (
            <>
              <Seg label={t('Se connecter ou créer un compte')} value={tab} onChange={v => { setTab(v); setError(null); setInfo(null) }} options={[['in', t('Se connecter')], ['up', t('Créer un compte')]]} />
              <Field label={t('E-mail')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder={t('nom@exemple.fr')}
                autoComplete="email" textContentType="username" onBlur={() => setTouched(prev => ({ ...prev, email: true }))}
                error={touched.email && !emailOk ? t('Adresse incomplète : vérifiez le @ et la fin (.fr, .com…).') : null} />
              <Field label={t('Mot de passe')} value={password} onChangeText={setPassword} secureTextEntry
                autoComplete={tab === 'up' ? 'new-password' : 'current-password'} textContentType={tab === 'up' ? 'newPassword' : 'password'}
                onBlur={() => setTouched(prev => ({ ...prev, password: true }))} onSubmitEditing={submit}
                hint={tab === 'up' ? (password.length >= 8 ? t('✓ 8 caractères ou plus') : t('8 caractères au moins ({n}/8)', { n: password.length })) : undefined}
                error={tab === 'in' && touched.password && !pwOk ? t('Entrez votre mot de passe.') : null} />
              <Button kind="primary" title={tab === 'up' ? t('Créer mon compte') : t('Se connecter')} onPress={submit} disabled={missing.length > 0} style={{ minHeight: 52 }} />
              <Missing items={touched.email || touched.password ? missing : []} />
              {tab === 'in' ? <Button kind="ghost" title={t('Mot de passe oublié ? Recevoir un lien')} onPress={forgot} /> : null}
              <Button kind="ghost" icon="left" title={t('Autres façons de continuer')} onPress={() => { setMode('choose'); setError(null) }} />
            </>
          )}
        </View>
        <Txt small muted center>
          <Txt small color={c.muted} onPress={() => WebBrowser.openBrowserAsync('https://chapote.fr/legal/confidentialite').catch(() => {})}>{t('Confidentialité')}</Txt>
          {'  ·  '}
          <Txt small color={c.muted} onPress={() => WebBrowser.openBrowserAsync('https://chapote.fr/legal/cgu').catch(() => {})}>{t('Conditions')}</Txt>
        </Txt>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/** Champ du code : grand, centré, chiffres espacés ; 6 chiffres pour le code de l'application. */
function CodeInput({ value, recovery, onChange, onSubmit }: { value: string; recovery: boolean; onChange: (v: string) => void; onSubmit: () => void }) {
  const { c } = useTheme()
  return (
    <TextInput value={value} autoFocus onSubmitEditing={onSubmit} accessibilityLabel={recovery ? t('Code de secours') : t('Code à 6 chiffres')}
      onChangeText={v => onChange(recovery ? v : v.replace(/\D/g, '').slice(0, 6))}
      keyboardType={recovery ? 'default' : 'number-pad'} textContentType="oneTimeCode" autoComplete="one-time-code" autoCapitalize="characters"
      placeholder={recovery ? 'XXXX-XXXX' : '••••••'} placeholderTextColor={c.faint} maxLength={recovery ? 20 : 6}
      style={{ height: 64, borderRadius: radius.md, borderWidth: 1.5, borderColor: value ? c.primary : c.borderStrong, backgroundColor: c.surface,
        color: c.text, fontSize: recovery ? 22 : 30, letterSpacing: recovery ? 2 : 12, textAlign: 'center', fontWeight: '700' }} />
  )
}
