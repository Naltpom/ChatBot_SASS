// Lien reçu par e-mail (« Créer / réinitialiser le mot de passe ») ouvert dans l'app : chapote.fr/reset-password?token=…
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { callPublic } from '../lib/http'
import { Button, Field, H1, Msg, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'

export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token?: string }>()
  const router = useRouter()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const save = async () => {
    setMsg(null)
    if (pw !== pw2) { setMsg({ kind: 'err', text: 'Les deux mots de passe sont différents.' }); return }
    try {
      await callPublic('/api/auth/password/reset', { token, new_password: pw })
      setMsg({ kind: 'ok', text: 'Mot de passe enregistré.' })
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Lien invalide ou expiré : redemandez-en un.' }) }
  }
  return (
    <Screen>
      <View style={{ gap: space.sm, paddingTop: space.lg }}>
        <H1>Choisir un mot de passe</H1>
        <Txt muted>8 caractères au moins.</Txt>
      </View>
      {!token ? <Msg kind="err">Lien incomplet : redemandez un e-mail depuis Mon compte.</Msg> : null}
      {msg ? <Msg kind={msg.kind}>{msg.text}</Msg> : null}
      {msg?.kind === 'ok' ? <Button kind="primary" title="Continuer" onPress={() => router.replace('/')} /> : (
        <>
          <Field label="Nouveau mot de passe" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" />
          <Field label="Confirmer" value={pw2} onChangeText={setPw2} secureTextEntry autoComplete="new-password" />
          <Button kind="primary" title="Enregistrer" onPress={save} disabled={!token || pw.length < 8} />
        </>
      )}
    </Screen>
  )
}
