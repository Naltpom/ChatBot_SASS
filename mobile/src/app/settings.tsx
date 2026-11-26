import { FEATURES } from '../lib/features'
// Réglages, rangés par portée : moi (profil, notifications, sécurité, apparence), mon espace (comptes, personnes,
// stockage), ce téléphone et les autres appareils, puis la zone sensible tout en bas. Chaque réglage montre son
// état actuel, et chaque changement affiche « Enregistré ».
import Constants from 'expo-constants'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Pressable, Switch, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { call } from '../lib/http'
import { disablePush, enablePush, getPush, pushUnsupported, setPushPrefs, type PushPrefs, type PushState } from '../lib/push'
import { fmtAgo } from '../lib/format'
import { useSession } from '../lib/session'
import { getProfile, patchProfile } from '../lib/api'
import { Button, Card, Divider, Icon, Label, Msg, Row, Screen, Seg, Sheet, Txt, Field, type IconName } from '../ui/kit'
import { PALETTE_PREVIEW, radius, space, useTheme, type Palette, type ThemePref } from '../ui/theme'
import { Logo } from '../ui/Logo'
import { enablePasskey, passkeyAvailable, passkeyDone, passkeyError } from '../lib/passkey'
import { currentIcon, iconAvailable, offerIcon } from '../lib/app-icon'

interface DeviceRow { id: number; name: string | null; platform: string | null; push: boolean; created_at: string | null; last_used_at: string | null }

const PREF_LABEL: [keyof PushPrefs, string, string][] = [
  ['published', 'Vidéo publiée', 'Quand une vidéo est en ligne.'],
  ['failed', 'Échec de publication', 'Avec la raison, pour réessayer vite.'],
  ['draft', 'Brouillon TikTok à publier', 'La vidéo attend dans l’app TikTok.'],
  ['comments', 'Nouveaux commentaires', 'Regroupés, une fois par minute au plus.'],
  ['storage', 'Stockage Drive', 'Presque plein (90 %) ou plein.'],
].filter(([k]) => FEATURES.comments || k !== 'comments') as [keyof PushPrefs, string, string][]

export default function Settings() {
  const { c, dark, pref, setPref, palette, setPalette } = useTheme()
  // Icône de l'app : proposée assortie à la couleur choisie (version 4 et plus).
  const [icon, setIconState] = useState(() => currentIcon())
  const askIcon = (p: Palette) => offerIcon(p, '/settings', () => { setIconState(p); ok() })
  const { me, signOut } = useSession()
  // Connexion par empreinte (clé d'accès), version 6 et plus.
  const [passkey, setPasskey] = useState(false)
  const [pkBusy, setPkBusy] = useState(false)
  const [pkMsg, setPkMsg] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  useEffect(() => { if (me) passkeyDone(me.id).then(setPasskey) }, [me?.id])
  // Arrivée depuis la proposition après connexion (« Activer ») : on lance l'activation une fois.
  const { passkey: autoPk } = useLocalSearchParams<{ passkey?: string }>()
  const started = useRef(false)
  useEffect(() => {
    if (autoPk !== '1' || started.current || !me || !passkeyAvailable) return
    started.current = true
    passkeyDone(me.id).then(d => { if (!d) activatePasskey() })
  }, [autoPk, me?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const activatePasskey = async () => {
    if (!me) return
    setPkBusy(true); setPkMsg(null)
    try { const r = await enablePasskey(me.id); setPasskey(true); if (r?.length) setCodes(r); else ok() }
    catch (e) { setPkMsg(passkeyError(e)) } finally { setPkBusy(false) }
  }
  const router = useRouter()
  const [push, setPush] = useState<PushState | null>(null)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)

  const load = useCallback(() => {
    getPush().then(setPush).catch(() => setPush(null))
    call<DeviceRow[]>('/api/cm/mobile/devices').then(setDevices).catch(() => setDevices(null))
  }, [])
  useEffect(() => { load() }, [load])

  const [saved, setSaved] = useState(0)
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(0), 1800); return () => clearTimeout(t) }, [saved])
  const ok = () => setSaved(Date.now())
  const toggleAll = async (on: boolean) => {
    setPushMsg(null)
    if (on) {
      const r = await enablePush()
      if (typeof r === 'string') setPushMsg(r)
      else { setPush(r); ok() }
    } else { setPush(await disablePush()); ok() }
  }
  const togglePref = async (k: keyof PushPrefs, v: boolean) => {
    if (!push) return
    setPush({ ...push, prefs: { ...push.prefs, [k]: v } })
    setPush(await setPushPrefs({ [k]: v })); ok()
  }
  const revoke = (d: DeviceRow) => Alert.alert('Déconnecter cet appareil ?', d.name || 'Appareil', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Déconnecter', style: 'destructive', onPress: async () => { await call(`/api/cm/mobile/devices/${d.id}`, { method: 'DELETE' }); load() } },
  ])
  const unsupported = pushUnsupported()
  const { refresh, spaces, accounts } = useSession()
  const [persoName, setPersoName] = useState('')
  useEffect(() => { getProfile().then(p => setPersoName(p.perso_name || '')).catch(() => {}) }, [])

  const themeLabel = { system: 'Comme le téléphone', light: 'Clair', dark: 'Sombre' }[pref]
  const space0 = spaces.find(x => x.org_id == null)
  const storageLabel = !space0?.storage || space0.storage.state === 'missing' ? 'À relier'
    : space0.storage.used_bytes != null ? `${(space0.storage.used_bytes / 1e9).toFixed(1).replace('.', ',')} Go utilisés` : 'Relié'

  return (
    <View style={{ flex: 1 }}>
    <Screen>
      <Pressable onPress={() => router.push('/account')} accessibilityRole="button" accessibilityLabel="Mon compte"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg,
          backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.7 : 1 })}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Txt bold size={20} color={c.onPrimary}>{(me?.name || me?.email || '?').slice(0, 1).toUpperCase()}</Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt bold size={17}>{me?.name}</Txt>
          <Txt small muted>{me?.email}</Txt>
          <Txt small color={c.primary}>Mot de passe, double authentification, mes données</Txt>
        </View>
        <Icon name="right" size={18} color={c.muted} />
      </Pressable>

      <Card>
        <Label>Mon espace</Label>
        <NavRow icon="users" label="Comptes connectés" value={`${accounts.filter(a => a.mine !== false).length}`} onPress={() => router.push('/accounts')} />
        <NavRow icon="share" label="Personnes et partage" onPress={() => router.push('/people')} />
        <NavRow icon="folder" label="Stockage Google Drive" value={storageLabel} onPress={() => router.push('/storage')} />
        <NavRow icon="layers" label="Brouillons à valider" onPress={() => router.push('/drafts')} />
        <NavRow icon="comment" label="Assistant IA" onPress={() => router.push('/assistant-settings')} />
        <Divider />
        <Field label="Nom de mon espace" value={persoName} onChangeText={setPersoName} placeholder="Espace perso"
          onEndEditing={() => patchProfile(persoName.trim()).then(() => { refresh(); ok() }).catch(() => {})} hint="Visible par les personnes avec qui vous partagez un groupe." />
      </Card>

      <Card>
        <Label>Notifications</Label>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}><Txt bold>Sur ce téléphone · {push?.enabled ? 'activées' : 'désactivées'}</Txt><Txt small muted>{FEATURES.comments ? 'Publications, échecs, brouillons, commentaires.' : 'Publications, échecs, brouillons, stockage.'}</Txt></View>
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
        <Label>Sécurité</Label>
        {passkeyAvailable ? (
          <>
            <Row style={{ justifyContent: 'space-between' }} gap={space.md}>
              <View style={{ flex: 1 }}>
                <Txt bold>Se connecter avec l’empreinte</Txt>
                <Txt small muted>{passkey ? 'Activé sur ce téléphone. À la connexion, l’empreinte remplace le code à 6 chiffres.'
                  : 'À la connexion, après le mot de passe ou Google, votre empreinte ou votre visage remplace le code à 6 chiffres. Rien n’est redemandé ensuite.'}</Txt>
              </View>
              {!passkey ? <Button small kind="primary" title="Activer" loading={pkBusy} onPress={activatePasskey} /> : null}
            </Row>
            {pkMsg ? <Msg kind="err">{pkMsg}</Msg> : null}
            <Divider />
          </>
        ) : null}
        <NavRow icon="shield" label="Double authentification" value={me?.twofa_enabled ? 'Activée' : 'Désactivée'} onPress={() => router.push({ pathname: '/account', params: { section: '2fa' } })} />
      </Card>

      <Card>
        <Label>Apparence · {themeLabel}</Label>
        <Seg<ThemePref> label="Thème" value={pref} onChange={v => { setPref(v); ok() }}
          options={[['system', 'Comme le téléphone'], ['light', 'Clair'], ['dark', 'Sombre']]} />
        <Txt small bold muted>Couleur de l’app</Txt>
        <Row gap={space.sm}>
          {(Object.keys(PALETTE_PREVIEW) as Palette[]).map(k => {
            const p = PALETTE_PREVIEW[k], col = dark ? p.dark : p.light, on = palette === k
            return (
              <Pressable key={k} onPress={() => { Haptics.selectionAsync().catch(() => {}); setPalette(k); ok() }}
                accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${p.label}${k === 'warm' ? ', par défaut' : ''}`}
                style={({ pressed }) => ({ flex: 1, gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: col.bg,
                  borderWidth: on ? 2 : 1, borderColor: on ? c.primary : c.border, opacity: pressed ? 0.8 : 1 })}>
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <Logo size={36} bg={col.logo} />
                  <Txt bold center numberOfLines={1} color={col.text}>{p.label}</Txt>
                  <Txt size={12} center numberOfLines={1} color={col.muted}>{k === 'warm' ? 'Par défaut' : k === 'ocean' ? 'Comme avant' : 'Nature'}</Txt>
                </View>
                <View style={{ height: 28, borderRadius: 8, backgroundColor: col.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt size={12} bold color={col.onPrimary}>{on ? 'Choisie' : 'Planifier'}</Txt>
                </View>
              </Pressable>
            )
          })}
        </Row>
        {iconAvailable() && icon && icon !== palette ? (
          <Pressable onPress={() => askIcon(palette)} accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md,
              backgroundColor: c.infoBg, opacity: pressed ? 0.7 : 1 })}>
            <Logo size={36} bg={c.logo} />
            <View style={{ flex: 1 }}>
              <Txt bold color={c.primary}>Changer aussi l’icône de l’app</Txt>
              <Txt size={12} muted>Pour l’assortir à la couleur {PALETTE_PREVIEW[palette].label.toLowerCase()}.</Txt>
            </View>
            <Icon name="right" size={18} color={c.primary} />
          </Pressable>
        ) : iconAvailable() && icon ? (
          <Txt size={12} muted>L’icône de l’app est assortie à la couleur choisie.</Txt>
        ) : (
          <Txt size={12} muted>Icône assortie à la couleur : disponible avec la prochaine version de l’app sur le Play Store.</Txt>
        )}
      </Card>

      <Card>
        <Label>Appareils connectés · {devices?.length ?? '—'}</Label>
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

      <Card style={{ borderColor: c.dangerBorder }}>
        <Label>Zone sensible</Label>
        <Button kind="danger" icon="logout" title="Se déconnecter de ce téléphone" onPress={() => Alert.alert('Se déconnecter ?', 'Vous pourrez vous reconnecter à tout moment.', [
          { text: 'Annuler', style: 'cancel' }, { text: 'Se déconnecter', style: 'destructive', onPress: () => { signOut() } },
        ])} />
        <Button kind="danger" icon="trash" title="Supprimer mon compte…" onPress={() => router.push('/account')} />
      </Card>
      <Txt small faint center>Chapote CM {Constants.expoConfig?.version} · cm.chapote.fr</Txt>
    <Sheet visible={!!codes} title="Vos codes de secours" onClose={() => setCodes(null)}>
        <Txt muted>Gardez-les en lieu sûr (gestionnaire de mots de passe, papier). Si vous perdez ce téléphone, un de ces codes remplace l’empreinte, une seule fois chacun. Ils ne seront plus affichés.</Txt>
        <Card><Txt selectable style={{ fontFamily: 'monospace', lineHeight: 24 }}>{(codes || []).join('\n')}</Txt></Card>
        <Button kind="primary" title="Je les ai notés" onPress={() => { setCodes(null); ok() }} />
      </Sheet>
      </Screen>
    {saved ? (
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 32, left: 0, right: 0, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.ink, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Icon name="check" size={16} color={c.onInk} /><Txt small bold color={c.onInk}>Enregistré</Txt>
        </View>
      </View>
    ) : null}
    </View>
  )
}

function NavRow({ icon, label, value, onPress }: { icon: IconName; label: string; value?: string; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={20} color={c.muted} />
      <Txt style={{ flex: 1 }}>{label}</Txt>
      {value ? <Txt small muted>{value}</Txt> : null}
      <Icon name="right" size={16} color={c.muted} />
    </Pressable>
  )
}
