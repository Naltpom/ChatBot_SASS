// Réglages : apparence (clair / sombre / comme le téléphone), notifications, appareils connectés, compte.
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Switch, View } from 'react-native'
import { call } from '../lib/http'
import { disablePush, enablePush, getPush, pushUnsupported, setPushPrefs, type PushPrefs, type PushState } from '../lib/push'
import { fmtAgo } from '../lib/format'
import { useSession } from '../lib/session'
import { useLock } from '../lib/lock'
import { Button, Card, Divider, Label, Msg, Row, Screen, Seg, Txt } from '../ui/kit'
import { space, useTheme, type ThemePref } from '../ui/theme'

interface DeviceRow { id: number; name: string | null; platform: string | null; push: boolean; created_at: string | null; last_used_at: string | null }

const PREF_LABEL: [keyof PushPrefs, string, string][] = [
  ['published', 'Vidéo publiée', 'Quand une vidéo est en ligne.'],
  ['failed', 'Échec de publication', 'Avec la raison, pour réessayer vite.'],
  ['draft', 'Brouillon TikTok à publier', 'La vidéo attend dans l’app TikTok.'],
  ['comments', 'Nouveaux commentaires', 'Regroupés, une fois par minute au plus.'],
  ['storage', 'Stockage Drive', 'Presque plein (90 %) ou plein.'],
]

export default function Settings() {
  const { c, pref, setPref } = useTheme()
  const { me, signOut } = useSession()
  const router = useRouter()
  const [push, setPush] = useState<PushState | null>(null)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)

  const load = useCallback(() => {
    getPush().then(setPush).catch(() => setPush(null))
    call<DeviceRow[]>('/api/cm/mobile/devices').then(setDevices).catch(() => setDevices(null))
  }, [])
  useEffect(() => { load() }, [load])

  const toggleAll = async (on: boolean) => {
    setPushMsg(null)
    if (on) {
      const r = await enablePush()
      if (typeof r === 'string') setPushMsg(r)
      else setPush(r)
    } else setPush(await disablePush())
  }
  const togglePref = async (k: keyof PushPrefs, v: boolean) => {
    if (!push) return
    setPush({ ...push, prefs: { ...push.prefs, [k]: v } })
    setPush(await setPushPrefs({ [k]: v }))
  }
  const revoke = (d: DeviceRow) => Alert.alert('Déconnecter cet appareil ?', d.name || 'Appareil', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Déconnecter', style: 'destructive', onPress: async () => { await call(`/api/cm/mobile/devices/${d.id}`, { method: 'DELETE' }); load() } },
  ])
  const unsupported = pushUnsupported()
  const lock = useLock()
  const [lockMsg, setLockMsg] = useState<string | null>(null)

  return (
    <Screen>
      <Card>
        <Label>Apparence</Label>
        <Seg<ThemePref> label="Thème" value={pref} onChange={setPref}
          options={[['system', 'Comme le téléphone'], ['light', 'Clair'], ['dark', 'Sombre']]} />
      </Card>

      <Card>
        <Label>Sécurité</Label>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}><Txt bold>Verrouiller avec {lock.label.toLowerCase()}</Txt><Txt small muted>À l’ouverture et au retour dans l’app après une minute.</Txt></View>
          <Switch value={lock.enabled} onValueChange={async v => setLockMsg(await lock.setEnabled(v))} accessibilityLabel="Verrouiller l’app"
            trackColor={{ true: c.primary }} />
        </Row>
        {!lock.supported ? <Txt small muted>Disponible dans l’app installée, avec une empreinte ou un visage enregistré sur le téléphone.</Txt> : null}
        {lockMsg ? <Msg kind="err">{lockMsg}</Msg> : null}
      </Card>

      <Card>
        <Label>Notifications</Label>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}><Txt bold>Sur ce téléphone</Txt><Txt small muted>Publications, échecs, brouillons, commentaires.</Txt></View>
          <Switch value={!!push?.enabled} onValueChange={toggleAll} disabled={!!unsupported} accessibilityLabel="Notifications sur ce téléphone"
            trackColor={{ true: c.primary }} />
        </Row>
        {unsupported ? <Msg kind="info">{unsupported}</Msg> : null}
        {pushMsg ? <Msg kind="err">{pushMsg}</Msg> : null}
        {push?.enabled ? PREF_LABEL.map(([k, label, hint]) => (
          <View key={k} style={{ gap: space.sm }}>
            <Divider />
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}><Txt>{label}</Txt><Txt small muted>{hint}</Txt></View>
              <Switch value={push.prefs[k] !== false} onValueChange={v => togglePref(k, v)} accessibilityLabel={label} trackColor={{ true: c.primary }} />
            </Row>
          </View>
        )) : null}
      </Card>

      <Card>
        <Label>Espace et comptes</Label>
        <Button title="Comptes connectés" icon="users" onPress={() => router.push('/accounts')} />
        <Button title="Personnes et partage" icon="share" onPress={() => router.push('/people')} />
        <Button title="Stockage Google Drive" icon="folder" onPress={() => router.push('/storage')} />
        <Button title="Brouillons à valider" icon="layers" onPress={() => router.push('/drafts')} />
      </Card>

      <Card>
        <Label>Appareils connectés</Label>
        {devices == null ? <Txt small muted>—</Txt> : devices.length === 0 ? <Txt small muted>Aucun.</Txt> : devices.map(d => (
          <Row key={d.id} style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Txt>{d.name || 'Appareil'}{d.push ? ' · notifications' : ''}</Txt>
              <Txt small muted>{d.last_used_at ? `Utilisé ${fmtAgo(d.last_used_at)}` : ''}</Txt>
            </View>
            <Button small kind="danger" title="Déconnecter" onPress={() => revoke(d)} />
          </Row>
        ))}
      </Card>

      <Card>
        <Label>Compte</Label>
        <Txt>{me?.name}</Txt>
        <Txt small muted>{me?.email}</Txt>
        <Button title="Mon compte : mot de passe, double authentification, confidentialité" icon="shield" onPress={() => router.push('/account')} />
        <Button kind="danger" icon="logout" title="Se déconnecter" onPress={() => Alert.alert('Se déconnecter ?', '', [
          { text: 'Annuler', style: 'cancel' }, { text: 'Se déconnecter', style: 'destructive', onPress: () => { signOut() } },
        ])} />
      </Card>
      <Txt small faint center>Chapote CM {Constants.expoConfig?.version} · cm.chapote.fr</Txt>
    </Screen>
  )
}
