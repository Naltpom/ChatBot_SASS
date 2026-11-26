// Mon compte : nom, mot de passe, double authentification (application d'authentification, codes de
// secours, clés d'accès), confidentialité, suppression du compte (RGPD).
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Linking, View } from 'react-native'
import { API_URL, call } from '../lib/http'
import { useSession } from '../lib/session'
import { Button, Card, Divider, Field, Label, Msg, Row, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'
import { showDialog } from '../ui/dialog'
import { t } from '../lib/i18n'

interface TwoFA { totp_enabled: boolean; passkeys: { id: number; name?: string | null; created_at?: string | null }[]; recovery_remaining: number; required: boolean; enabled: boolean }
const PRIVACY_EMAIL = 'nathan.provost78990@gmail.com'
const send = <T,>(method: string, path: string, body?: unknown) => call<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

function Codes({ codes }: { codes: string[] }) {
  return (
    <Card>
      <Txt bold>{t('Codes de secours')}</Txt>
      <Txt small muted>{t('Gardez-les en lieu sûr : chacun sert une fois si vous n’avez plus votre téléphone. Ils ne seront plus affichés.')}</Txt>
      <Txt selectable style={{ fontFamily: 'monospace' }}>{codes.join('\n')}</Txt>
      <Button title={t('Copier les codes')} icon="copy" onPress={() => Clipboard.setStringAsync(codes.join('\n'))} />
    </Card>
  )
}

export default function Account() {
  const { me, refresh } = useSession()
  // Depuis « Sécuriser votre compte » : seulement la double authentification.
  const only2fa = useLocalSearchParams<{ section?: string }>().section === '2fa'
  const [name, setName] = useState(me?.name || '')
  useEffect(() => { if (me?.name) setName(n => n || me.name) }, [me?.name])
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pw, setPw] = useState({ current: '', next: '' })
  const [tf, setTf] = useState<TwoFA | null>(null)
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)

  const load = useCallback(() => { call<TwoFA>('/api/auth/2fa/status').then(setTf).catch(() => setTf(null)) }, [])
  useEffect(() => { load() }, [load])
  const run = async (fn: () => Promise<string | void>) => {
    setMsg(null)
    try { const r = await fn(); if (r) setMsg({ kind: 'ok', text: r }) } catch (e: any) { setMsg({ kind: 'err', text: e?.message || t('Erreur') }) }
  }

  const saveName = () => run(async () => { await send('PATCH', '/api/auth/me', { name: name.trim() }); await refresh(); return t('Nom enregistré.') })
  const savePw = () => run(async () => {
    await send('POST', '/api/auth/password', { current_password: pw.current, new_password: pw.next })
    setPw({ current: '', next: '' })
    return t('Mot de passe changé.')
  })
  const [pwSent, setPwSent] = useState(false)
  const forgotCall = () => call('/api/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: me?.email }) })
  const forgot = () => run(async () => {
    await forgotCall()
    return t('Un lien pour choisir un mot de passe a été envoyé à {email}.', { email: me?.email ?? '' })
  })
  const startTotp = () => run(async () => { setSetup(await send('POST', '/api/auth/2fa/totp/setup')); setCode('') })
  const enableTotp = () => run(async () => {
    const r = await send<{ recovery_codes: string[] }>('POST', '/api/auth/2fa/totp/enable', { code: code.trim() })
    setSetup(null); setCode(''); setCodes(r.recovery_codes); load()
    return t('Double authentification activée.')
  })
  const disableTotp = () => run(async () => {
    await send('POST', '/api/auth/2fa/totp/disable', { code: code.trim() }); setCode(''); load()
    return t('Double authentification désactivée.')
  })
  const regen = () => run(async () => {
    const r = await send<{ recovery_codes: string[] }>('POST', '/api/auth/2fa/recovery/regenerate', { code: code.trim() })
    setCode(''); setCodes(r.recovery_codes); load()
    return t('Nouveaux codes de secours créés.')
  })
  const removeKey = (id: number) => showDialog(t('Retirer cette clé d’accès ?'), '', [
    { text: t('Annuler'), style: 'cancel' },
    { text: t('Retirer'), style: 'destructive', onPress: () => run(async () => { await send('DELETE', `/api/auth/2fa/webauthn/credentials/${id}`); load(); return t('Clé retirée.') }) },
  ])
  const askDelete = () => showDialog(t('Supprimer mon compte'),
    t('Toutes vos données Chapote seront supprimées sous 7 jours (comptes connectés, planning, bibliothèque, commentaires). Un e-mail de demande va s’ouvrir.'), [
      { text: t('Annuler'), style: 'cancel' },
      { text: t('Continuer'), style: 'destructive', onPress: () => {
        const subject = encodeURIComponent(t('Suppression de mon compte Chapote'))
        const body = encodeURIComponent(t('Bonjour,\n\nJe demande la suppression de mon compte Chapote et de toutes mes données.\nCompte : {email}\n\nMerci.', { email: me?.email ?? '' }))
        Linking.openURL(`mailto:${PRIVACY_EMAIL}?subject=${subject}&body=${body}`).catch(() => setMsg({ kind: 'err', text: t('Écrivez à {destinataire} depuis {email}.', { destinataire: PRIVACY_EMAIL, email: me?.email ?? '' }) }))
      } },
    ])

  return (
    <Screen>
      {msg ? <Msg kind={msg.kind}>{msg.text}</Msg> : null}
      {codes ? <Codes codes={codes} /> : null}

      {only2fa ? <Stack.Screen options={{ title: t('Double authentification') }} /> : null}
      {only2fa ? null : <>
      <Card>
        <Label>{t('Profil')}</Label>
        <Txt small muted>{me?.email}</Txt>
        <Field label={t('Nom')} value={name} onChangeText={setName} autoCapitalize="words" />
        <Button title={t('Enregistrer le nom')} onPress={saveName} disabled={!name.trim() || name.trim() === me?.name} />
      </Card>

      {me?.auth_source === 'google' && !pwSent ? (
        <Card>
          <Label>{t('Mot de passe')}</Label>
          <Txt small muted>{t('Votre compte a été créé avec Google : il n’a pas de mot de passe. Créez-en un pour pouvoir aussi vous connecter avec votre e-mail.')}</Txt>
          <Button kind="primary" title={t('Créer un mot de passe')} onPress={() => run(async () => { await forgotCall(); setPwSent(true); return t('Un e-mail a été envoyé à {email} : touchez le lien pour choisir votre mot de passe.', { email: me?.email ?? '' }) })} />
        </Card>
      ) : me?.auth_source === 'google' ? null : (
      <Card>
        <Label>{t('Mot de passe')}</Label>
        <Field label={t('Mot de passe actuel')} value={pw.current} onChangeText={v => setPw({ ...pw, current: v })} secureTextEntry autoComplete="current-password" />
        <Field label={t('Nouveau mot de passe')} value={pw.next} onChangeText={v => setPw({ ...pw, next: v })} secureTextEntry autoComplete="new-password" hint={t('8 caractères au moins.')} />
        <Button kind="primary" title={t('Changer le mot de passe')} onPress={savePw} disabled={!pw.current || pw.next.length < 8} />
        <Button kind="ghost" title={t('Mot de passe oublié ? Recevoir un lien')} onPress={forgot} />
      </Card>
      )}

      </>}

      <Card>
        <Label>{t('Double authentification')}</Label>
        {tf == null ? <Txt small muted>—</Txt> : tf.totp_enabled ? (
          <>
            <Txt>{t('Activée avec une application d’authentification.')}</Txt>
            <Txt small muted>{tf.recovery_remaining > 1 ? t('{n} codes de secours restants.', { n: tf.recovery_remaining }) : t('{n} code de secours restant.', { n: tf.recovery_remaining })}</Txt>
            <Field label={t('Code de l’application (ou de secours)')} value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" />
            <Row>
              <Button flex title={t('Nouveaux codes de secours')} onPress={regen} disabled={!code.trim()} />
              {tf.required ? null : <Button flex kind="danger" title={t('Désactiver')} onPress={disableTotp} disabled={!code.trim()} />}
            </Row>
          </>
        ) : setup ? (
          <>
            <Txt small>{t('1. Ajoutez Chapote dans votre application d’authentification (Google Authenticator, 1Password…).')}</Txt>
            <Button title={t('Ouvrir l’application d’authentification')} icon="external" onPress={() => Linking.openURL(setup.otpauth_uri).catch(() => setMsg({ kind: 'err', text: t('Aucune application d’authentification trouvée : copiez la clé.') }))} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt selectable small style={{ flex: 1, fontFamily: 'monospace' }}>{setup.secret}</Txt>
              <Button small title={t('Copier la clé')} icon="copy" onPress={() => Clipboard.setStringAsync(setup.secret)} />
            </Row>
            <Txt small>{t('2. Entrez le code à 6 chiffres affiché.')}</Txt>
            <Field label={t('Code')} value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" />
            <Button kind="primary" title={t('Activer')} onPress={enableTotp} disabled={code.trim().length < 6} />
            <Button kind="ghost" title={t('Annuler')} onPress={() => setSetup(null)} />
          </>
        ) : (
          <>
            <Txt small muted>{t('Un code demandé en plus du mot de passe ou de Google à chaque connexion.')}</Txt>
            <Button kind="primary" title={t('Activer la double authentification')} onPress={startTotp} />
          </>
        )}
        {tf && tf.passkeys.length ? (
          <View style={{ gap: space.sm }}>
            <Divider />
            <Txt bold>{t('Clés d’accès')}</Txt>
            {tf.passkeys.map(k => (
              <Row key={k.id} style={{ justifyContent: 'space-between' }}>
                <Txt style={{ flex: 1 }}>{k.name || t('Clé d’accès')}</Txt>
                <Button small kind="danger" title={t('Retirer')} onPress={() => removeKey(k.id)} />
              </Row>
            ))}
          </View>
        ) : null}
        <Txt small muted>{t('Les clés d’accès (passkeys) s’ajoutent pour l’instant depuis le site ; l’application d’authentification marche ici.')}</Txt>
      </Card>

      {only2fa ? null : <Card>
        <Label>{t('Confidentialité')}</Label>
        <Button title={t('Politique de confidentialité')} icon="shield" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/privacy`)} />
        <Button title={t('Conditions d’utilisation')} icon="external" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/terms`)} />
        <Divider />
        <Txt bold>{t('Supprimer mon compte')}</Txt>
        <Txt small muted>{t('Toutes vos données sont supprimées sous 7 jours. Pour un réseau seulement : Comptes → Déconnecter.')}</Txt>
        <Button kind="danger" icon="trash" title={t('Supprimer mon compte')} onPress={askDelete} />
      </Card>}
    </Screen>
  )
}
