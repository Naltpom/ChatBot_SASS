// Activer ou désactiver la double authentification dans une fenêtre : QR code et clé pour l'application
// d'authentification, puis le code à 6 chiffres. Codes de secours montrés une fois.
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { Linking, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { call } from '../lib/http'
import { Button, Field, Msg, Row, Sheet, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'

const send = <T,>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export function TwoFASheet({ visible, enabled, onClose, onChanged }: { visible: boolean; enabled: boolean; onClose: () => void; onChanged: (on: boolean) => void }) {
  const { c } = useTheme()
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  useEffect(() => {
    if (!visible) return
    setCode(''); setErr(''); setCodes(null); setSetup(null)
    if (!enabled) send<{ secret: string; otpauth_uri: string }>('/api/auth/2fa/totp/setup').then(setSetup).catch(e => setErr(e?.message || 'Erreur'))
  }, [visible, enabled])

  const confirm = async () => {
    setErr('')
    try {
      if (enabled) { await send('/api/auth/2fa/totp/disable', { code: code.trim() }); onChanged(false); onClose() }
      else { const r = await send<{ recovery_codes: string[] }>('/api/auth/2fa/totp/enable', { code: code.trim() }); setCodes(r.recovery_codes); onChanged(true) }
    } catch (e: any) { setErr(e?.message || 'Code refusé') }
  }

  return (
    <Sheet visible={visible} title={enabled ? 'Désactiver la double authentification' : 'Double authentification'} onClose={onClose}>
      {err ? <Msg kind="err">{err}</Msg> : null}
      {codes ? (
        <>
          <Msg kind="ok">Activée.</Msg>
          <Txt bold>Codes de secours</Txt>
          <Txt small muted>Gardez-les en lieu sûr : chacun sert une fois si vous perdez votre téléphone.</Txt>
          <Txt selectable style={{ fontFamily: 'monospace' }}>{codes.join('\n')}</Txt>
          <Button title="Copier les codes" icon="copy" onPress={() => Clipboard.setStringAsync(codes.join('\n'))} />
          <Button kind="primary" title="Terminé" onPress={onClose} />
        </>
      ) : (
        <>
          {!enabled && setup ? (
            <>
              <View style={{ alignSelf: 'center', padding: 12, backgroundColor: '#fff', borderRadius: 12 }}>
                <QRCode value={setup.otpauth_uri} size={180} />
              </View>
              <Button title="Ouvrir dans l’application d’authentification" icon="external"
                onPress={() => Linking.openURL(setup.otpauth_uri).catch(() => setErr('Aucune application d’authentification trouvée : copiez la clé.'))} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt selectable small style={{ flex: 1, fontFamily: 'monospace', color: c.muted }}>{setup.secret}</Txt>
                <Button small title="Copier la clé" icon="copy" onPress={() => Clipboard.setStringAsync(setup.secret)} />
              </Row>
            </>
          ) : null}
          <Field label={enabled ? 'Code de l’application (ou de secours)' : 'Code à 6 chiffres'} value={code} onChangeText={setCode}
            keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" onSubmitEditing={confirm} />
          <Button kind={enabled ? 'danger' : 'primary'} title={enabled ? 'Désactiver' : 'Activer'} onPress={confirm} disabled={code.trim().length < 6} />
        </>
      )}
      <View style={{ height: space.sm }} />
    </Sheet>
  )
}
