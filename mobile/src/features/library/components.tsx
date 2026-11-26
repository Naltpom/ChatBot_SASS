// Briques de l'écran Bibliothèque (comme cm/src/pages/Library.tsx) : dossier Drive, ajout d'un dossier,
// archivage Drive, adresses Google reliées, carte vidéo.
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { openAuthorize,
  addSource, disconnectDriveArchive, getDriveArchive, getIdentities, getSources, patchIdentity, patchSource, removeIdentity, removeSource,
  scanSource, startDriveOAuth, type Asset, type DriveArchive, type Identities, type Source,
} from '../../lib/api'
import { fmtDateTime, fmtDuration } from '../../lib/format'
import { t } from '../../lib/i18n'
import { API_URL } from '../../lib/http'
import { useRole, useSession } from '../../lib/session'
import { Button, Card, Divider, Field, GroupDot, Icon, IconButton, Msg, Row, Sheet, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { BROWSER_HINT } from '../accounts/logic'
import { assetBadge, recipeSavedNote, sourceLine } from './logic'
import { RecipeSheet } from './RecipeSheet'
import { AuthImage, Badge, Fold, Select, ToggleRow } from './ui'
import { showDialog } from '../../ui/dialog'

const open = (url: string) => Linking.openURL(url).catch(() => WebBrowser.openBrowserAsync(url).catch(() => {}))

function CopyField({ value }: { value: string }) {
  const { c } = useTheme()
  const [done, setDone] = useState(false)
  const copy = async () => {
    await Clipboard.setStringAsync(value).catch(() => {})
    setDone(true); setTimeout(() => setDone(false), 2000)
  }
  return (
    <Row gap={space.sm}>
      <View style={{ flex: 1, minHeight: 48, borderRadius: radius.md, backgroundColor: c.surface2, justifyContent: 'center', paddingHorizontal: 12 }}>
        <Txt small selectable numberOfLines={1}>{value}</Txt>
      </View>
      <Button kind="primary" small icon={done ? 'check' : 'copy'} title={done ? t('Copié') : t('Copier')} onPress={copy} accessibilityLabel={t('Copier l’adresse du robot')} />
    </Row>
  )
}

/** Adresses Google d'où les dossiers partagés au robot sont reliés automatiquement. */
export function GoogleAddresses({ compact = false }: { compact?: boolean }) {
  const { spaces, org } = useSession()
  const { canAdmin } = useRole()
  const [d, setD] = useState<Identities | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { getIdentities().then(setD).catch(e => setErr((e as Error).message)) }, [])
  const spaceName = (o: number | null) => spaces.find(x => x.org_id === o)?.name || t('Espace perso')
  const run = async (fn: () => Promise<Identities>) => {
    setErr('')
    try { setD(await fn()) } catch (e) { setErr((e as Error).message) }
  }
  const remove = (id: number, email: string) => showDialog(t('Retirer {email} ?', { email }), t('Les dossiers qu’il partagera ne seront plus reliés tout seuls.'), [
    { text: t('Annuler'), style: 'cancel' },
    { text: t('Retirer'), style: 'destructive', onPress: () => run(() => removeIdentity(id)) },
  ])
  return (
    <View style={{ gap: space.sm }}>
      {d ? (
        <>
          <Row gap={space.sm}><Icon name="check" size={16} /><Txt small numberOfLines={1} style={{ flexShrink: 1 }}>{d.account_email}</Txt><Txt small muted>{t('(compte Chapote)')}</Txt></Row>
          {d.identities.map(i => (
            <View key={i.id} style={{ gap: 6 }}>
              <Row gap={space.sm}>
                <Icon name="check" size={16} />
                <Txt small numberOfLines={1} style={{ flex: 1 }}>{i.email}</Txt>
                {compact || spaces.length > 1 ? null : <Txt small muted>→ {spaceName(i.org_id)}</Txt>}
                {!compact && canAdmin ? <IconButton icon="close" label={t('Retirer {email}', { email: i.email })} onPress={() => remove(i.id, i.email)} /> : null}
              </Row>
              {!compact && spaces.length > 1 && canAdmin ? (
                <Select label="" value={String(i.org_id ?? '')} options={spaces.map(sp => [String(sp.org_id ?? ''), sp.name] as [string, string])}
                  onChange={v => run(() => patchIdentity(i.id, v ? Number(v) : null))} />
              ) : compact && spaces.length > 1 ? <Txt small muted>→ {spaceName(i.org_id)}</Txt> : null}
            </View>
          ))}
        </>
      ) : null}
      {!compact ? (
        <>
          <Txt small muted>{t('Associer une autre adresse Google se fait sur cm.chapote.fr (connexion Google), dans « {space} ».', { space: spaceName(org) })}</Txt>
          <Button small icon="external" title={t('Ouvrir cm.chapote.fr')} style={{ alignSelf: 'flex-start' }}
            onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/bibliotheque`).then(() => getIdentities().then(setD)).catch(() => {})} />
        </>
      ) : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
    </View>
  )
}

/** « Ajouter un dossier Drive » : partager au robot, et le dossier apparaît tout seul. */
export function AddFolderSheet({ visible, robot, known, onClose, onAdded }:
  { visible: boolean; robot: string; known: number[]; onClose: () => void; onAdded: (s: Source) => void }) {
  const { org, groups } = useSession()
  const [url, setUrl] = useState('')
  const [group, setGroup] = useState<number | ''>('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const knownRef = useRef(known)
  knownRef.current = known
  // Le robot relève les nouveaux partages toutes les minutes : on guette l'arrivée du dossier.
  useEffect(() => {
    if (!visible) return
    const t = setInterval(async () => {
      try {
        const fresh = (await getSources(org)).find(x => !knownRef.current.includes(x.id))
        if (fresh) onAdded(fresh)
      } catch { /* réessai au prochain passage */ }
    }, 8000)
    return () => clearInterval(t)
  }, [org, visible]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setErr(''); setBusy(true)
    try { onAdded(await addSource(org, url.trim(), group === '' ? null : group)); setUrl('') }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Sheet visible={visible} title={t('Ajouter un dossier Google Drive')} onClose={onClose}>
      <Txt bold>{t('1. Partagez le dossier avec le robot de Chapote')}</Txt>
      <CopyField value={robot} />
      <Txt small muted>{t('• Dans Google Drive, sur le dossier des vidéos : Partager.')}</Txt>
      <Txt small muted>{t('• Collez l’adresse ci-dessus, choisissez Lecteur (ou Éditeur pour que cm range les vidéos publiées), puis Envoyer.')}</Txt>
      <Txt small faint>{t('Le robot ne voit que ce dossier, rien d’autre de votre Drive. Retirez-le du partage pour couper l’accès.')}</Txt>
      <Divider />
      <Txt bold>{t('2. C’est tout')}</Txt>
      <Msg>{t('Le dossier apparaîtra ici tout seul, en général en moins d’une minute, s’il est partagé depuis l’une de ces adresses :')}</Msg>
      <GoogleAddresses compact />
      <Fold title={t('Partagé depuis une autre adresse (un monteur…) ? Collez le lien du dossier')}>
        <Field label={t('Lien du dossier')} value={url} onChangeText={setUrl} placeholder="https://drive.google.com/drive/folders/…"
          keyboardType="url" autoCapitalize="none" autoCorrect={false} hint={t('Ouvrez le dossier dans Google Drive et copiez son lien.')} />
        {groups.length > 0 ? (
          <Select label={t('Comptes proposés par défaut (facultatif)')} value={group}
            options={[['', t('Aucun groupe')], ...groups.map(g => [g.id, g.accounts.length > 1 ? t('{name} ({n} comptes)', { name: g.name, n: g.accounts.length }) : t('{name} ({n} compte)', { name: g.name, n: g.accounts.length })] as [number, string])]}
            onChange={setGroup} />
        ) : null}
        {err ? <Msg kind="err">{err}</Msg> : null}
        <Button kind="primary" title={busy ? t('Vérification…') : t('Vérifier et relier')} disabled={busy || !url.trim()} loading={busy} onPress={submit} />
      </Fold>
    </Sheet>
  )
}

export function SourceCard({ s, onChanged, onRemoved }: { s: Source; onChanged: (s: Source) => void; onRemoved: () => void }) {
  const { c } = useTheme()
  const { org, groups } = useSession()
  const { canAdmin } = useRole()
  const [openMenu, setOpenMenu] = useState(false)
  const [recipe, setRecipe] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const group = groups.find(g => g.id === s.group_id)
  const run = async (fn: () => Promise<Source>) => {
    setErr('')
    try { onChanged(await fn()) } catch (e) { setErr((e as Error).message) }
  }
  const remove = () => showDialog(t('Retirer « {name} » ?', { name: s.name || t('ce dossier') }),
    t('Les publications pas encore parties depuis ce dossier seront annulées. Les fichiers restent dans votre Drive.'), [
      { text: t('Annuler'), style: 'cancel' },
      { text: t('Retirer'), style: 'destructive', onPress: async () => {
        try { await removeSource(org, s.id); onRemoved() } catch (e) { setErr((e as Error).message) }
      } },
    ])
  return (
    <Card>
      <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="folder" size={20} color={c.muted} />
        </View>
        <Pressable style={{ flex: 1, minHeight: 44 }} onPress={() => open(s.url)} accessibilityRole="link" accessibilityLabel={t('{name}, ouvrir dans Google Drive', { name: s.name || t('Dossier Drive') })}>
          <Txt bold numberOfLines={1}>{s.name || t('Dossier Drive')}</Txt>
          <Txt small muted>{sourceLine(s, t)}{s.last_scan_at ? ` · ${t('relu {date}', { date: fmtDateTime(s.last_scan_at) })}` : ''}</Txt>
          {group ? <Row gap={6}><GroupDot color={group.color} /><Txt small muted>{group.name}</Txt></Row> : null}
          {s.auto_drafts ? <Row gap={6}><Icon name="bolt" size={14} color={c.primary} /><Txt small color={c.primary}>{t('Publications préparées toutes seules')}</Txt></Row> : null}
        </Pressable>
        {canAdmin ? <IconButton icon={openMenu ? 'close' : 'menu'} label={t('Réglages du dossier')} onPress={() => setOpenMenu(o => !o)} /> : null}
      </Row>
      {s.last_error ? <Msg kind="err">{s.last_error}</Msg> : null}
      {!s.verified && s.shared_by ? <Txt small muted>{t('Partagé par {who}.', { who: s.shared_by })}</Txt> : null}
      {openMenu ? (
        <View style={{ gap: space.md, paddingTop: space.sm }}>
          <Divider />
          <Select label={t('Comptes proposés par défaut')} value={s.group_id ?? ''}
            options={[['', t('Aucun groupe')], ...groups.map(g => [g.id, g.name] as [number, string])]}
            onChange={v => run(() => patchSource(org, s.id, v === '' ? { clear_group: true } : { group_id: v }))} />
          <Button small icon="bolt" style={{ alignSelf: 'flex-start' }} onPress={() => setRecipe(true)}
            title={s.auto_drafts ? t('Préparation automatique : réglages') : t('Préparer les publications toutes seules…')} />
          <Row gap={space.sm} wrap>
            <Button small icon="refresh" title={t('Relire maintenant')} onPress={() => run(() => scanSource(org, s.id))} />
            <Button small kind="danger" icon="trash" title={t('Retirer')} onPress={remove} />
          </Row>
        </View>
      ) : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
      {note ? <Msg kind="ok">{t(note)}</Msg> : null}
      {recipe ? (
        <RecipeSheet s={s} visible onClose={() => setRecipe(false)} onSaved={(n, proposed) => {
          setRecipe(false); onChanged({ ...s, ...n }); setNote(recipeSavedNote(!!n.auto_drafts, proposed))
        }} />
      ) : null}
    </Card>
  )
}

/** Drive d'archivage : où cm range les publications de l'outil (vidéo, légende, couverture, infos.json). */
export function DriveArchiveCard() {
  const { c } = useTheme()
  const { org } = useSession()
  const [a, setA] = useState<DriveArchive | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState(false)
  const load = () => getDriveArchive(org).then(setA).catch(() => {})
  useEffect(() => { load() }, [org]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return null
  const connect = async () => {
    setErr(''); setBusy(true); setHint(true)
    try { await openAuthorize((await startDriveOAuth(org)).authorize_url) } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false); load() }
  }
  const off = () => showDialog(t('Déconnecter le Drive d’archivage ?'), t('Les fichiers déjà archivés restent dans votre Drive.'), [
    { text: t('Annuler'), style: 'cancel' },
    { text: t('Déconnecter'), style: 'destructive', onPress: async () => { try { setA(await disconnectDriveArchive(org)) } catch (e) { setErr((e as Error).message) } } },
  ])
  return (
    <Card>
      <Row gap={space.md}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="layers" size={18} color={c.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt bold accessibilityRole="header">{t('Archivage Drive')}</Txt>
          {a.connected
            ? <Txt small muted>{a.email ? t('Relié à {email}', { email: a.email }) : t('Relié')} · {a.folder_name}</Txt>
            : <Txt small muted>{t('Les publications de votre outil (vidéo, légende, couverture, infos.json) sont rangées dans votre Drive.')}</Txt>}
        </View>
      </Row>
      {a.connected ? (
        <Row gap={space.sm} wrap>
          {a.folder_url ? <Button small icon="external" title={t('Ouvrir le dossier')} onPress={() => open(a.folder_url!)} /> : null}
          <Button small kind="ghost" title={t('Déconnecter')} onPress={off} />
        </Row>
      ) : a.oauth_enabled ? <Button small kind="primary" title={t('Connecter Google Drive')} loading={busy} onPress={connect} style={{ alignSelf: 'flex-start' }} />
        : <Txt small muted>{t('Connexion Google Drive pas encore configurée sur Chapote.')}</Txt>}
      {a.connected ? <Txt small faint>{t('cm ne voit que les fichiers qu’il crée dans ce dossier (droit « drive.file »), rien d’autre de votre Drive.')}</Txt> : null}
      {hint && !a.connected ? <Txt small muted>{t(BROWSER_HINT)}</Txt> : null}
      {a.error ? <Msg kind="err">{a.error}</Msg> : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
    </Card>
  )
}

/** Carte vidéo verticale (miniature, pastille, titre et durée en bas). */
export function AssetCard({ a, headers, onPress }: { a: Asset; headers: Record<string, string> | null; onPress: () => void }) {
  const b = assetBadge(a)
  const badge = { ...b, label: t(b.label) }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${a.title}, ${badge.label}, ${fmtDuration(a.duration_sec)}`}
      style={({ pressed }) => ({ flex: 1, aspectRatio: 9 / 14, borderRadius: 18, overflow: 'hidden', backgroundColor: '#2c2c2e', opacity: pressed ? 0.8 : 1 })}>
      <AuthImage path={a.thumbnail} headers={headers} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <Badge label={badge.label} accent={badge.fresh} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <Txt small bold color="#fff" numberOfLines={2}>{a.title}</Txt>
        <Txt size={12} color="rgba(255,255,255,0.86)" numberOfLines={1}>{fmtDuration(a.duration_sec)}{a.folder ? ` · ${a.folder}` : ''}</Txt>
      </View>
    </Pressable>
  )
}
