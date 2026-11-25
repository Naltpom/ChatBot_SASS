// Inscription, étape 3 : où ranger les vidéos (Google Drive de l'espace, dossier « cm.chapote.fr »).
import { useFocusEffect, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { getStorages, type DriveStorage } from '../../lib/api'
import { useRole, useSession } from '../../lib/session'
import { connectDrive } from '../../features/storage'
import { StepHeader, useOwnAccounts, useSetupOrg } from '../../features/steps'
import { Button, Card, H1, Label, Msg, Screen, Txt } from '../../ui/kit'
import { space } from '../../ui/theme'

export default function SetupDrive() {
  const router = useRouter()
  const { refresh } = useSession()
  const org = useSetupOrg()
  const { canAdmin } = useRole()
  const own = useOwnAccounts()
  const [list, setList] = useState<DriveStorage[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => { getStorages(org).then(r => setList(r.storages || [])).catch(() => setList([])) }, [org])
  useFocusEffect(load)
  const next = () => (own.length >= 2 ? router.push('/setup/groups') : router.replace('/'))
  const connect = async () => {
    setErr(null)
    try { await connectDrive(org); await refresh(); load() } catch (e: any) { setErr(e?.message || 'Connexion impossible') }
  }
  const main = list?.[0]

  return (
    <Screen onRefresh={load}>
      <StepHeader n={3} />
      <View style={{ gap: space.sm, paddingTop: space.md }}>
        <H1>Où ranger vos vidéos ?</H1>
        <Txt muted>Dans votre Google Drive, le temps de la publication. Chapote crée un dossier « cm.chapote.fr » à la racine et ne voit que les fichiers qu’il y range. Vous pourrez le renommer ou le déplacer dans le Drive : il reste suivi.</Txt>
      </View>
      {err ? <Msg kind="err">{err}</Msg> : null}
      {main ? (
        <Card>
          <Label>Google Drive relié</Label>
          <Txt bold>{main.email || 'Drive connecté'}</Txt>
          <Txt small muted>Dossier : {main.name || 'cm.chapote.fr'}</Txt>
          {main.folder_url ? <Button small icon="external" title="Voir le dossier dans Drive" onPress={() => WebBrowser.openBrowserAsync(main.folder_url!).catch(() => {})} /> : null}
          {canAdmin ? <Button small kind="ghost" title="Utiliser un autre compte Google" onPress={connect} /> : null}
        </Card>
      ) : canAdmin ? (
        <Button kind="primary" icon="folder" title="Connecter Google Drive" onPress={connect} />
      ) : <Msg>Un administrateur de l’équipe doit connecter le Drive de l’espace.</Msg>}
      {main ? <Button kind="primary" title={own.length >= 2 ? 'Continuer' : 'Terminer l’inscription'} onPress={next} />
        : canAdmin ? <Txt small muted center>Obligatoire pour publier : vos vidéos passent par ce Drive.</Txt> : null}
    </Screen>
  )
}
