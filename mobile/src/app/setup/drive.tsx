// Inscription, étape 3 : le Google Drive où passent les vidéos (obligatoire avec ses propres comptes).
// Chapote crée son dossier (nom au choix), le partage avec son robot : tout dossier glissé dedans,
// avec ses vidéos, apparaît dans la Bibliothèque.
import { useFocusEffect, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { getStorages, type DriveStorage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { STEPS } from '../../lib/onboarding'
import { useRole, useSession } from '../../lib/session'
import { connectDrive } from '../../features/storage'
import { StepHeader, StickyFooter, useSetupOrg } from '../../features/steps'
import { StepProgress } from '../../ui/Progress'
import { Button, Card, Field, H1, Icon, Msg, Row, Screen, Txt } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'

const ROOT = 'cm.chapote.fr'

export default function SetupDrive() {
  const router = useRouter()
  const { c } = useTheme()
  const { refresh } = useSession()
  const org = useSetupOrg()
  const { canAdmin } = useRole()
  const [list, setList] = useState<DriveStorage[] | null>(null)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => { getStorages(org).then(r => setList(r.storages || [])).catch(() => setList([])) }, [org])
  useFocusEffect(load)
  const connect = async () => {
    setErr(null)
    try { await connectDrive(org, name.trim() || undefined); await refresh(); load() } catch (e: any) { setErr(e?.message || t('Connexion impossible')) }
  }
  const main = list?.[0]
  const folder = name.trim() ? `${ROOT} — ${name.trim()}` : ROOT

  return (
    <Screen onRefresh={load} footer={
      <StickyFooter>
        {main ? <Button kind="primary" title={t('Continuer : ma première vidéo')} onPress={() => router.push('/setup/first-video')} style={{ minHeight: 52 }} />
          : canAdmin ? <Button kind="primary" icon="folder" title={t('Connecter Google Drive')} onPress={connect} style={{ minHeight: 52 }} />
          : <Msg>{t('Un administrateur de l’équipe doit connecter le Drive.')}</Msg>}
      </StickyFooter>
    }>
      <StepHeader n={3} />
      <View style={{ gap: space.md }}>
        <StepProgress step={3} total={STEPS} label="Google Drive" />
        <H1>{t('Où ranger vos vidéos ?')}</H1>
        <Txt muted>{t('Dans votre Google Drive, le temps de la publication. Chapote n’y voit que son propre dossier, et vous choisissez ce qui est gardé après.')}</Txt>
      </View>
      {err ? <Msg kind="err">{err}</Msg> : null}
      {main ? (
        <Card>
          <Row gap={space.sm}><Icon name="check" size={20} color={c.ok} /><Txt bold>{t('Google Drive connecté')}</Txt></Row>
          <Txt small muted>{main.email}</Txt>
          <Row gap={space.sm}><Icon name="folder" size={18} color={c.muted} /><Txt>{main.name || ROOT}</Txt></Row>
          {main.folder_url ? <Button small icon="external" title={t('Ouvrir le dossier dans Drive')} onPress={() => WebBrowser.openBrowserAsync(main.folder_url!).catch(() => {})} /> : null}
        </Card>
      ) : (
        <Card>
          <Field label={t('Nom du dossier (facultatif)')} value={name} onChangeText={setName} maxLength={60} placeholder={t('Ex. Mes vidéos, Client Lumen')}
            hint={t('Il sera créé à la racine de votre Drive : « {folder} ». Vous pourrez le déplacer.', { folder })} />
        </Card>
      )}
      <Card>
        <Row gap={space.sm}><Icon name="layers" size={20} color={c.primary} /><Txt bold>{t('Vos vidéos sont déjà dans Drive ?')}</Txt></Row>
        <Txt small muted>{t('Glissez leur dossier dans « {folder} » : Chapote le voit tout seul, et ses vidéos apparaissent dans la Bibliothèque en quelques minutes, prêtes à planifier.', { folder: main?.name || folder })}</Txt>
        <Txt small muted>{t('Un dossier d’un Drive partagé d’entreprise ? Ajoutez-le depuis la Bibliothèque → « Ajouter un dossier Drive ».')}</Txt>
      </Card>
    </Screen>
  )
}
