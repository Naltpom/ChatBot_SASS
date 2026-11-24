// Mon compte : nom, mot de passe, double authentification (application d'authentification, codes de
// secours, clés d'accès), confidentialité, suppression du compte (RGPD).
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import { API_URL, call } from '../lib/http'
import { useSession } from '../lib/session'
import { Button, Card, Divider, Field, Label, Msg, Row, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'

interface TwoFA { totp_enabled: boolean; passkeys: { id: number; name?: string | null; created_at?: string | null }[]; recovery_remaining: number; required: boolean; enabled: boolean }
const PRIVACY_EMAIL = 'nathan.provost78990@gmail.com'
const send = <T,>(method: string, path: string, body?: unknown) => call<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

function Codes({ codes }: { codes: string[] }) {
  return (
    <Card>
      <Txt bold>Codes de secours</Txt>
      <Txt small muted>Gardez-les en lieu sûr : chacun sert une fois si vous n’avez plus votre téléphone. Ils ne seront plus affichés.</Txt>
      <Txt selectable style={{ fontFamily: 'monospace' }}>{codes.join('\n')}</Txt>
      <Button title="Copier les codes" icon="copy" onPress={() => Clipboard.setStringAsync(codes.join('\n'))} />
    </Card>
  )
}

export default function Account() {
  const { me, refresh } = useSession()
  // Depuis « Sécuriser votre compte » : seulement la double authentification.
  const only2fa = useLocalSearchParams<{ section?: string }>().section === '2fa'
  const [name, setName] = useState(me?.name || '')
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
    try { const t = await fn(); if (t) setMsg({ kind: 'ok', text: t }) } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Erreur' }) }
  }

  const saveName = () => run(async () => { await send('PATCH', '/api/auth/me', { name: name.trim() }); await refresh(); return 'Nom enregistré.' })
  const savePw = () => run(async () => {
    await send('POST', '/api/auth/password', { current_password: pw.current, new_password: pw.next })
    setPw({ current: '', next: '' })
    return 'Mot de passe changé.'
  })
  const [pwSent, setPwSent] = useState(false)
  const forgotCall = () => call('/api/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: me?.email }) })
  const forgot = () => run(async () => {
    await forgotCall()
    return `Un lien pour choisir un mot de passe a été envoyé à ${me?.email}.`
  })
  const startTotp = () => run(async () => { setSetup(await send('POST', '/api/auth/2fa/totp/setup')); setCode('') })
  const enableTotp = () => run(async () => {
    const r = await send<{ recovery_codes: string[] }>('POST', '/api/auth/2fa/totp/enable', { code: code.trim() })
    setSetup(null); setCode(''); setCodes(r.recovery_codes); load()
    return 'Double authentification activée.'
  })
  const disableTotp = () => run(async () => {
    await send('POST', '/api/auth/2fa/totp/disable', { code: code.trim() }); setCode(''); load()
    return 'Double authentification désactivée.'
  })
  const regen = () => run(async () => {
    const r = await send<{ recovery_codes: string[] }>('POST', '/api/auth/2fa/recovery/regenerate', { code: code.trim() })
    setCode(''); setCodes(r.recovery_codes); load()
    return 'Nouveaux codes de secours créés.'
  })
  const removeKey = (id: number) => Alert.alert('Retirer cette clé d’accès ?', '', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Retirer', style: 'destructive', onPress: () => run(async () => { await send('DELETE', `/api/auth/2fa/webauthn/credentials/${id}`); load(); return 'Clé retirée.' }) },
  ])
  const askDelete = () => Alert.alert('Supprimer mon compte',
    'Toutes vos données Chapote seront supprimées sous 7 jours (comptes connectés, planning, bibliothèque, commentaires). Un e-mail de demande va s’ouvrir.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Continuer', style: 'destructive', onPress: () => {
        const subject = encodeURIComponent('Suppression de mon compte Chapote')
        const body = encodeURIComponent(`Bonjour,\n\nJe demande la suppression de mon compte Chapote et de toutes mes données.\nCompte : ${me?.email}\n\nMerci.`)
        Linking.openURL(`mailto:${PRIVACY_EMAIL}?subject=${subject}&body=${body}`).catch(() => setMsg({ kind: 'err', text: `Écrivez à ${PRIVACY_EMAIL} depuis ${me?.email}.` }))
      } },
    ])

  return (
    <Screen>
      {msg ? <Msg kind={msg.kind}>{msg.text}</Msg> : null}
      {codes ? <Codes codes={codes} /> : null}

      {only2fa ? <Stack.Screen options={{ title: 'Double authentification' }} /> : null}
      {only2fa ? null : <>
      <Card>
        <Label>Profil</Label>
        <Txt small muted>{me?.email}</Txt>
        <Field label="Nom" value={name} onChangeText={setName} autoCapitalize="words" />
        <Button title="Enregistrer le nom" onPress={saveName} disabled={!name.trim() || name.trim() === me?.name} />
      </Card>

      {me?.auth_source === 'google' && !pwSent ? (
        <Card>
          <Label>Mot de passe</Label>
          <Txt small muted>Votre compte a été créé avec Google : il n’a pas de mot de passe. Créez-en un pour pouvoir aussi vous connecter avec votre e-mail.</Txt>
          <Button kind="primary" title="Créer un mot de passe" onPress={() => run(async () => { await forgotCall(); setPwSent(true); return `Un e-mail a été envoyé à ${me?.email} : touchez le lien pour choisir votre mot de passe.` })} />
        </Card>
      ) : me?.auth_source === 'google' ? null : (
      <Card>
        <Label>Mot de passe</Label>
        <Field label="Mot de passe actuel" value={pw.current} onChangeText={v => setPw({ ...pw, current: v })} secureTextEntry autoComplete="current-password" />
        <Field label="Nouveau mot de passe" value={pw.next} onChangeText={v => setPw({ ...pw, next: v })} secureTextEntry autoComplete="new-password" hint="8 caractères au moins." />
        <Button kind="primary" title="Changer le mot de passe" onPress={savePw} disabled={!pw.current || pw.next.length < 8} />
        <Button kind="ghost" title="Mot de passe oublié ? Recevoir un lien" onPress={forgot} />
      </Card>
      )}

      </>}

      <Card>
        <Label>Double authentification</Label>
        {tf == null ? <Txt small muted>—</Txt> : tf.totp_enabled ? (
          <>
            <Txt>Activée avec une application d’authentification.</Txt>
            <Txt small muted>{tf.recovery_remaining} code{tf.recovery_remaining > 1 ? 's' : ''} de secours restant{tf.recovery_remaining > 1 ? 's' : ''}.</Txt>
            <Field label="Code de l’application (ou de secours)" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" />
            <Row>
              <Button flex title="Nouveaux codes de secours" onPress={regen} disabled={!code.trim()} />
              {tf.required ? null : <Button flex kind="danger" title="Désactiver" onPress={disableTotp} disabled={!code.trim()} />}
            </Row>
          </>
        ) : setup ? (
          <>
            <Txt small>1. Ajoutez Chapote dans votre application d’authentification (Google Authenticator, 1Password…).</Txt>
            <Button title="Ouvrir l’application d’authentification" icon="external" onPress={() => Linking.openURL(setup.otpauth_uri).catch(() => setMsg({ kind: 'err', text: 'Aucune application d’authentification trouvée : copiez la clé.' }))} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt selectable small style={{ flex: 1, fontFamily: 'monospace' }}>{setup.secret}</Txt>
              <Button small title="Copier la clé" icon="copy" onPress={() => Clipboard.setStringAsync(setup.secret)} />
            </Row>
            <Txt small>2. Entrez le code à 6 chiffres affiché.</Txt>
            <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" />
            <Button kind="primary" title="Activer" onPress={enableTotp} disabled={code.trim().length < 6} />
            <Button kind="ghost" title="Annuler" onPress={() => setSetup(null)} />
          </>
        ) : (
          <>
            <Txt small muted>Un code demandé en plus du mot de passe ou de Google à chaque connexion.</Txt>
            <Button kind="primary" title="Activer la double authentification" onPress={startTotp} />
          </>
        )}
        {tf && tf.passkeys.length ? (
          <View style={{ gap: space.sm }}>
            <Divider />
            <Txt bold>Clés d’accès</Txt>
            {tf.passkeys.map(k => (
              <Row key={k.id} style={{ justifyContent: 'space-between' }}>
                <Txt style={{ flex: 1 }}>{k.name || 'Clé d’accès'}</Txt>
                <Button small kind="danger" title="Retirer" onPress={() => removeKey(k.id)} />
              </Row>
            ))}
          </View>
        ) : null}
        <Txt small muted>Les clés d’accès (passkeys) s’ajoutent pour l’instant depuis le site ; l’application d’authentification marche ici.</Txt>
      </Card>

      {only2fa ? null : <Card>
        <Label>Confidentialité</Label>
        <Button title="Politique de confidentialité" icon="shield" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/privacy`)} />
        <Button title="Conditions d’utilisation" icon="external" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/terms`)} />
        <Divider />
        <Txt bold>Supprimer mon compte</Txt>
        <Txt small muted>Toutes vos données sont supprimées sous 7 jours. Pour un réseau seulement : Comptes → Déconnecter.</Txt>
        <Button kind="danger" icon="trash" title="Supprimer mon compte" onPress={askDelete} />
      </Card>}
    </Screen>
  )
}
