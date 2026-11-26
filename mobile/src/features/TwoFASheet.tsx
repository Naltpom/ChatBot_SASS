// Activer ou désactiver la double authentification dans une fenêtre : QR code et clé pour l'application
// d'authentification, puis le code à 6 chiffres. Codes de secours montrés une fois.
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { Linking, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { call } from '../lib/http'
import { Button, Field, Msg, Row, Sheet, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'
import { t } from '../lib/i18n'

const send = <T,>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export function TwoFASheet({ visible, enabled, onClose, onChanged }: { visible: boolean; enabled: boolean; onClose: () => void; onChanged: (on: boolean) => void }) {
  const { c } = useTheme()
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  // Mode figé à l'ouverture : après « Activer », la fenêtre reste sur les codes de secours.
  const [wasEnabled, setWasEnabled] = useState(enabled)
  useEffect(() => {
    if (!visible) return
    setWasEnabled(enabled)
    setCode(''); setErr(''); setCodes(null); setSetup(null)
    if (!enabled) send<{ secret: string; otpauth_uri: string }>('/api/auth/2fa/totp/setup').then(setSetup).catch(e => setErr(e?.message || t('Erreur')))
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    setErr('')
    try {
      if (wasEnabled) { await send('/api/auth/2fa/totp/disable', { code: code.trim() }); onChanged(false); onClose() }
      else { const r = await send<{ recovery_codes: string[] }>('/api/auth/2fa/totp/enable', { code: code.trim() }); setCodes(r.recovery_codes); onChanged(true) }
    } catch (e: any) { setErr(e?.message || t('Code refusé')) }
  }

  return (
    <Sheet visible={visible} title={wasEnabled ? t('Désactiver la double authentification') : t('Double authentification')} onClose={onClose}>
      {err ? <Msg kind="err">{err}</Msg> : null}
      {codes ? (
        <>
          <Msg kind="ok">{t('Activée.')}</Msg>
          <Txt bold>{t('Codes de secours')}</Txt>
          <Txt small muted>{t('Gardez-les en lieu sûr : chacun sert une fois si vous perdez votre téléphone.')}</Txt>
          <Txt selectable style={{ fontFamily: 'monospace' }}>{codes.join('\n')}</Txt>
          <Button title={t('Copier les codes')} icon="copy" onPress={() => Clipboard.setStringAsync(codes.join('\n'))} />
          <Button kind="primary" title={t('Terminé')} onPress={onClose} />
        </>
      ) : (
        <>
          {!wasEnabled && setup ? (
            <>
              <View style={{ alignSelf: 'center', padding: 12, backgroundColor: '#fff', borderRadius: 12 }}>
                <QRCode value={setup.otpauth_uri} size={180} />
              </View>
              <Button title={t('Ouvrir dans l’application d’authentification')} icon="external"
                onPress={() => Linking.openURL(setup.otpauth_uri).catch(() => setErr(t('Aucune application d’authentification trouvée : copiez la clé.')))} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt selectable small style={{ flex: 1, fontFamily: 'monospace', color: c.muted }}>{setup.secret}</Txt>
                <Button small title={t('Copier la clé')} icon="copy" onPress={() => Clipboard.setStringAsync(setup.secret)} />
              </Row>
            </>
          ) : null}
          <Field label={wasEnabled ? t('Code de l’application (ou de secours)') : t('Code à 6 chiffres')} value={code} onChangeText={setCode}
            keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" onSubmitEditing={confirm} />
          <Button kind={wasEnabled ? 'danger' : 'primary'} title={wasEnabled ? t('Désactiver') : t('Activer')} onPress={confirm} disabled={code.trim().length < 6} />
        </>
      )}
      <View style={{ height: space.sm }} />
    </Sheet>
  )
}
