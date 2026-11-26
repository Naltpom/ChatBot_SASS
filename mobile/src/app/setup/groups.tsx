// Inscription, étape 4 (seulement avec plusieurs comptes) : ranger les comptes en groupes, chacun avec
// son dossier dans le Drive si on veut (« cm.chapote.fr — <nom> », créé par Chapote).
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Switch, View } from 'react-native'
import { addStorageFolder, assignStorage, createGroup, getGroups, getStorages, GROUP_COLORS, PLATFORM_LABEL,
  type DriveStorage, type Group } from '../../lib/api'
import { t } from '../../lib/i18n'
import { useSession } from '../../lib/session'
import { akey, groupBody } from '../../features/accounts/logic'
import { useOwnAccounts, useSetupOrg } from '../../features/steps'
import { Button, Card, Chip, Field, GroupDot, H1, Msg, PlatformLogo, Row, Screen, Txt } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'

export default function SetupGroups() {
  const router = useRouter()
  const { refresh } = useSession()
  const org = useSetupOrg()
  const { c } = useTheme()
  const own = useOwnAccounts()
  const [groups, setGroups] = useState<Group[]>([])
  const [storages, setStorages] = useState<DriveStorage[]>([])
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [ownFolder, setOwnFolder] = useState(true)
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null)

  const load = useCallback(() => {
    getGroups(org).then(setGroups).catch(() => {})
    getStorages(org).then(r => setStorages(r.storages || [])).catch(() => setStorages([]))
  }, [org])
  useFocusEffect(load)
  const toggle = (k: string) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]))

  const save = async () => {
    setMsg(null); setBusy(true)
    try {
      const color = GROUP_COLORS[groups.length % GROUP_COLORS.length]
      const g = await createGroup(org, groupBody(name, color, picked))
      let text = t('Groupe « {name} » créé.', { name: g.name })
      let kind: 'ok' | 'warn' = 'ok'
      if (ownFolder && storages[0]) {
        try {
          const before = new Set(storages.map(s => s.id))
          const r = await addStorageFolder(org, storages[0].id, (folder || name).trim())
          const added = (r.storages || []).find(s => !before.has(s.id))
          if (added) await assignStorage(org, added.id, { groups: [g.id] })
          text += ` ${t('Ses vidéos iront dans son propre dossier du Drive.')}`
        } catch (e: any) { kind = 'warn'; text += ` ${t('Dossier Drive non créé : {error}.', { error: e?.message || t('erreur') })}` }
      }
      setMsg({ kind, text })
      setName(''); setPicked([]); setFolder('')
      load(); refresh()
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || t('Groupe non créé') }) } finally { setBusy(false) }
  }

  return (
    <Screen onRefresh={load}>
      <Stack.Screen options={{ title: t('Groupes de comptes') }} />
      <View style={{ gap: space.sm, paddingTop: space.md }}>
        <H1>{t('Ranger vos comptes en groupes')}</H1>
        <Txt muted>{t('Vous avez {n} comptes. Un groupe (par exemple un par client ou par chaîne) se filtre d’un geste, peut avoir son dossier dans le Drive et se partage plus tard avec d’autres personnes.', { n: own.length })}</Txt>
      </View>
      {groups.length ? (
        <Card>
          {groups.map(g => (
            <Row key={g.id} gap={space.sm}>
              <GroupDot color={g.color} />
              <Txt bold style={{ flex: 1 }}>{g.name}</Txt>
              <Txt small muted>{g.accounts.length > 1 ? t('{n} comptes', { n: g.accounts.length }) : t('{n} compte', { n: g.accounts.length })}</Txt>
            </Row>
          ))}
        </Card>
      ) : null}
      {msg ? <Msg kind={msg.kind}>{msg.text}</Msg> : null}
      <Card>
        <Txt bold>{groups.length ? t('Nouveau groupe') : t('Créer un groupe')}</Txt>
        <Field label={t('Nom du groupe')} value={name} onChangeText={setName} maxLength={60} placeholder={t('Ex. Ghost Hands, Clients, Piano FR')} />
        <Txt small bold>{picked.length > 1 ? t('Comptes · {n} choisis', { n: picked.length }) : t('Comptes · {n} choisi', { n: picked.length })}</Txt>
        <Row wrap>
          {own.map(a => {
            const k = akey(a.platform, a.id)
            return <Chip key={k} label={a.name || a.handle || PLATFORM_LABEL[a.platform]} selected={picked.includes(k)}
              left={<PlatformLogo platform={a.platform} size={18} />} onPress={() => toggle(k)} />
          })}
        </Row>
        {storages.length ? (
          <>
            <Row style={{ justifyContent: 'space-between', minHeight: 48 }}>
              <View style={{ flex: 1 }}>
                <Txt bold>{t('Dossier à part dans le Drive')}</Txt>
                <Txt small muted>{storages[0].email ? t('Dans {email}', { email: storages[0].email }) : t('Dans votre Drive')}</Txt>
              </View>
              <Switch value={ownFolder} onValueChange={setOwnFolder} accessibilityLabel={t('Dossier à part dans le Drive')} trackColor={{ true: c.primary }} />
            </Row>
            {ownFolder ? <Field label={t('Nom du dossier')} value={folder} onChangeText={setFolder} maxLength={60}
              placeholder={name.trim() || t('Nom du groupe')} hint={t('Créé par Chapote : « cm.chapote.fr — {name} ».', { name: (folder || name).trim() || '…' })} /> : null}
          </>
        ) : <Txt small muted>{t('Sans Drive relié (étape 3), les vidéos du groupe iront dans le stockage de l’espace dès qu’il sera connecté.')}</Txt>}
        <Button kind="primary" icon="plus" title={t('Créer le groupe')} loading={busy} disabled={!name.trim() || !picked.length} onPress={save} />
      </Card>
      <Button kind={groups.length ? 'primary' : 'ghost'} title={groups.length ? t('Terminé') : t('Plus tard')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </Screen>
  )
}
