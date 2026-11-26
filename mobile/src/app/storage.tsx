// Stockage Drive de l'espace : connexion (obligatoire pour publier), jauge, conservation après publication, quota.
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { getStorage, putStorage, type Retention, type Storage } from '../lib/api'
import { t } from '../lib/i18n'
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
    } catch (e: any) { if (e?.status !== 409) setMsg({ kind: 'err', text: e?.message || t('Erreur') }) }
  }
  useEffect(() => { load() }, [org]) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setMsg(null)
    try {
      await connectDrive(org)
      await refresh(); await load()
      setMsg({ kind: 'info', text: t('Si cm.chapote.fr vous a demandé de vous connecter, connectez-vous puis relancez la connexion.') })
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || t('Connexion impossible') }) }
  }
  const save = async () => {
    setMsg(null)
    const q = quota.trim() ? Number(quota.replace(',', '.')) : null
    if (q != null && !(q > 0)) { setMsg({ kind: 'err', text: t('Quota invalide.') }); return }
    try {
      setS(await putStorage(org, { quota_gb: q, retention, delete_after_days: retention === 'delete_after_days' ? Number(days) || 30 : null }))
      await refresh()
      setMsg({ kind: 'ok', text: t('Stockage enregistré.') })
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || t('Erreur') }) }
  }

  const missing = !s || !s.connected || s.state === 'missing'
  return (
    <Screen onRefresh={load}>
      {msg ? <Msg kind={msg.kind}>{msg.text}</Msg> : null}
      {missing ? (
        <>
          <View style={{ gap: space.sm, paddingTop: space.md }}>
            <H1>{t('Connecter votre Google Drive')}</H1>
            <Txt muted>{current?.org_id == null
              ? t('Les vidéos de votre espace sont rangées dans votre Google Drive le temps de la publication. Chapote ne voit que les fichiers qu’il crée, et vous choisissez ce qui est gardé après publication.')
              : t('Les vidéos de l’espace « {name} » sont rangées dans votre Google Drive le temps de la publication. Chapote ne voit que les fichiers qu’il crée, et vous choisissez ce qui est gardé après publication.', { name: current?.name })}</Txt>
          </View>
          {canAdmin
            ? <Button kind="primary" title={t('Connecter Google Drive')} onPress={connect} />
            : <Msg>{t('Un administrateur de l’équipe doit connecter le Drive de l’espace.')}</Msg>}
          <Button kind="ghost" title={t('Plus tard')} onPress={() => { markLater(org); router.back() }} />
        </>
      ) : (
        <>
          <Card>
            <Label>{t('Google Drive relié')}</Label>
            <Txt>{s.email || t('Drive connecté')}</Txt>
            <Gauge s={s} />
            {s.state === 'full' ? <Msg kind="err">{t('Plein : les nouvelles publications sont refusées tant qu’il n’y a pas de place.')}</Msg>
              : s.state === 'almost_full' ? <Msg kind="warn">{t('Presque plein (90 %).')}</Msg> : null}
          </Card>
          <Card>
            <Label>{t('Après publication')}</Label>
            <Row wrap>
              {RETENTION.map(([v, l]) => <Chip key={v} label={t(l)} selected={retention === v} onPress={canAdmin ? () => setRetention(v) : undefined} />)}
            </Row>
            {retention === 'delete_after_days'
              ? <Field label={t('Nombre de jours (1 à 365)')} value={days} onChangeText={setDays} keyboardType="number-pad" editable={canAdmin} /> : null}
            <Txt small muted>{t('La vidéo, la couverture et la légende rangées par Chapote vont à la corbeille du Drive ; la fiche infos.json reste.')}</Txt>
          </Card>
          <Card>
            <Label>{t('Quota réservé à Chapote')}</Label>
            <Field label={t('Go (vide = tout l’espace libre)')} value={quota} onChangeText={setQuota} keyboardType="decimal-pad" editable={canAdmin}
              hint={s.max_quota_gb != null ? t('Au plus {n} Go.', { n: s.max_quota_gb }) : undefined} />
          </Card>
          {canAdmin ? <Button kind="primary" title={t('Enregistrer')} onPress={save} /> : <Msg>{t('Seul un administrateur peut changer ces réglages.')}</Msg>}
        </>
      )}
    </Screen>
  )
}
