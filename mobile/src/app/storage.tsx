// Stockage Drive de l'espace : connexion (obligatoire pour publier), jauge, conservation après publication, quota.
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { getStorage, putStorage, type Retention, type Storage } from '../lib/api'
import { useRole, useSession } from '../lib/session'
import { connectDrive, Gauge, markLater } from '../features/storage'
import { Button, Card, Chip, Field, H1, Label, Msg, Row, Screen, Txt } from '../ui/kit'
import { space } from '../ui/theme'

const RETENTION: [Retention, string][] = [
  ['keep', 'Tout garder'], ['delete_after_publish', 'Supprimer après publication'], ['delete_after_days', 'Supprimer après N jours'],
]

export default function StorageScreen() {
  const router = useRouter()
  const { org, spaces, refresh } = useSession()
  const { canAdmin } = useRole()
  const current = spaces.find(s => s.org_id === org)
  const [s, setS] = useState<Storage | null>(current?.storage || null)
  const [quota, setQuota] = useState('')
  const [retention, setRetention] = useState<Retention>('keep')
  const [days, setDays] = useState('30')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)

  const load = async () => {
    try {
      const x = await getStorage(org)
      setS(x); setQuota(x.quota_gb != null ? String(x.quota_gb) : ''); setRetention(x.retention || 'keep')
      setDays(String(x.delete_after_days || 30))
    } catch (e: any) { if (e?.status !== 409) setMsg({ kind: 'err', text: e?.message || 'Erreur' }) }
  }
  useEffect(() => { load() }, [org]) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setMsg(null)
    try {
      await connectDrive(org)
      await refresh(); await load()
      setMsg({ kind: 'info', text: 'Si cm.chapote.fr vous a demandé de vous connecter, connectez-vous puis relancez la connexion.' })
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Connexion impossible' }) }
  }
  const save = async () => {
    setMsg(null)
    const q = quota.trim() ? Number(quota.replace(',', '.')) : null
    if (q != null && !(q > 0)) { setMsg({ kind: 'err', text: 'Quota invalide.' }); return }
    try {
      setS(await putStorage(org, { quota_gb: q, retention, delete_after_days: retention === 'delete_after_days' ? Number(days) || 30 : null }))
      await refresh()
      setMsg({ kind: 'ok', text: 'Stockage enregistré.' })
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Erreur' }) }
  }

  const missing = !s || !s.connected || s.state === 'missing'
  return (
    <Screen onRefresh={load}>
      {msg ? <Msg kind={msg.kind}>{msg.text}</Msg> : null}
      {missing ? (
        <>
          <View style={{ gap: space.sm, paddingTop: space.md }}>
            <H1>Connecter votre Google Drive</H1>
            <Txt muted>Les vidéos de {current?.org_id == null ? 'votre espace' : `l’espace « ${current?.name} »`} sont rangées dans votre Google Drive le temps de la publication. Chapote ne voit que les fichiers qu’il crée, et vous choisissez ce qui est gardé après publication.</Txt>
          </View>
          {canAdmin
            ? <Button kind="primary" title="Connecter Google Drive" onPress={connect} />
            : <Msg>Un administrateur de l’équipe doit connecter le Drive de l’espace.</Msg>}
          <Button kind="ghost" title="Plus tard" onPress={() => { markLater(org); router.back() }} />
        </>
      ) : (
        <>
          <Card>
            <Label>Google Drive relié</Label>
            <Txt>{s.email || 'Drive connecté'}</Txt>
            <Gauge s={s} />
            {s.state === 'full' ? <Msg kind="err">Plein : les nouvelles publications sont refusées tant qu’il n’y a pas de place.</Msg>
              : s.state === 'almost_full' ? <Msg kind="warn">Presque plein (90 %).</Msg> : null}
          </Card>
          <Card>
            <Label>Après publication</Label>
            <Row wrap>
              {RETENTION.map(([v, l]) => <Chip key={v} label={l} selected={retention === v} onPress={canAdmin ? () => setRetention(v) : undefined} />)}
            </Row>
            {retention === 'delete_after_days'
              ? <Field label="Nombre de jours (1 à 365)" value={days} onChangeText={setDays} keyboardType="number-pad" editable={canAdmin} /> : null}
            <Txt small muted>La vidéo, la couverture et la légende rangées par Chapote vont à la corbeille du Drive ; la fiche infos.json reste.</Txt>
          </Card>
          <Card>
            <Label>Quota réservé à Chapote</Label>
            <Field label="Go (vide = tout l’espace libre)" value={quota} onChangeText={setQuota} keyboardType="decimal-pad" editable={canAdmin}
              hint={s.max_quota_gb != null ? `Au plus ${s.max_quota_gb} Go.` : undefined} />
          </Card>
          {canAdmin ? <Button kind="primary" title="Enregistrer" onPress={save} /> : <Msg>Seul un administrateur peut changer ces réglages.</Msg>}
        </>
      )}
    </Screen>
  )
}
