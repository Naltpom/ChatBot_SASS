// Carte d'une plateforme dans la fiche de publication : état, ce qui diffère du commun, lien, chiffres,
// actions (changer l'heure ou le texte, publier maintenant, annuler, réessayer) et brouillon TikTok.
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  cancelTarget, markPublished, patchTarget, publishNow, resendDraft, retryTarget, PLATFORM_LABEL, type CalendarItem,
} from '../../lib/api'
import { fmtDateTime, num } from '../../lib/format'
import { Button, Field, Icon, Msg, PlatformLogo, Row, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { STATE_LABEL, stateOf, type TargetItem } from './calendar'
import { openLink } from './media'
import { diffsOf, editableText, tiktokLinkOk } from './sheet'
import { DateTimeField } from './ui'
import { showDialog } from '../../ui/dialog'

/** Demande une confirmation (Oui / Non). */
export const confirm = (title: string, message: string, ok: string, destructive = false) =>
  new Promise<boolean>(resolve => showDialog(title, message, [
    { text: 'Non', style: 'cancel', onPress: () => resolve(false) },
    { text: ok, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }))

type Act = (fn: () => Promise<unknown>, ask?: { title: string; message: string; ok: string; destructive?: boolean }) => Promise<void>

export function PlatformCard({ item, common, open, onToggle, onChanged, canEdit }: {
  item: CalendarItem; common: string; open: boolean; onToggle: () => void; onChanged: () => void; canEdit: boolean
}) {
  const { c } = useTheme()
  const st = stateOf(item)
  const inbox = item.kind === 'target' && item.status === 'INBOX'
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const act: Act = async (fn, ask) => {
    if (ask && !(await confirm(ask.title, ask.message, ask.ok, ask.destructive))) return
    setErr(''); setBusy(true)
    try { await fn(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onChanged() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const diffs = diffsOf(item, common)
  const when = item.kind === 'target' ? (item.published_at || item.scheduled_at) : item.at
  const stateColor = inbox ? c.warn : st === 'failed' ? c.danger : st === 'done' ? c.ok : c.muted
  const name = PLATFORM_LABEL[item.platform]
  const sub = `${item.account_name || name} · ${inbox ? 'brouillon envoyé' : st === 'planned' ? 'prévue' : 'publiée'} ${fmtDateTime(when)}`
  const stateText = inbox ? 'À publier dans l’app' : STATE_LABEL[st]
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: st === 'failed' ? 1.5 : StyleSheet.hairlineWidth * 2,
      borderColor: st === 'failed' ? c.danger : c.border, overflow: 'hidden' }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name}, ${sub}, ${stateText}`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 60, opacity: pressed ? 0.7 : 1 })}>
        <PlatformLogo platform={item.platform} size={26} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt bold>{name}</Txt>
          <Txt small muted numberOfLines={1}>{sub}</Txt>
        </View>
        <Txt small bold color={stateColor} style={{ maxWidth: 110, textAlign: 'right' }}>{stateText}</Txt>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><Icon name="down" size={18} color={c.muted} /></View>
      </Pressable>
      {item.kind === 'target' && item.status === 'FAILED' && item.error_message
        ? <Txt small color={c.danger} style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>{item.error_message}</Txt> : null}
      {open ? (
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.md }}>
          {item.kind === 'target' && item.notice ? <Msg>{item.notice}</Msg> : null}
          {item.url ? (
            <Pressable onPress={() => openLink(item.url!)} accessibilityRole="link" accessibilityLabel={`Voir sur ${name}`}
              style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
              <Txt bold color={c.accent}>Voir sur {name}</Txt><Icon name="external" size={16} color={c.accent} />
            </Pressable>
          ) : null}
          {diffs.length ? (
            <View style={{ gap: space.sm }}>
              {diffs.map(([k, v]) => (
                <View key={k} style={{ gap: 2 }}>
                  <Txt small muted>{k}</Txt>
                  <Txt small numberOfLines={4} selectable>{v}</Txt>
                </View>
              ))}
            </View>
          ) : item.kind === 'target' && !inbox ? <Txt small muted>Rien de propre à {name} : texte commun.</Txt> : null}
          {item.kind === 'video' ? (
            <Row gap={14} wrap>
              <Txt small><Txt small bold>{num(item.views)}</Txt> vues</Txt>
              <Txt small><Txt small bold>{num(item.likes)}</Txt> j’aime</Txt>
              {item.comments != null ? <Txt small><Txt small bold>{num(item.comments)}</Txt> comm.</Txt> : null}
              {item.shares != null ? <Txt small><Txt small bold>{num(item.shares)}</Txt> partages</Txt> : null}
              {item.saves != null ? <Txt small><Txt small bold>{num(item.saves)}</Txt> enreg.</Txt> : null}
            </Row>
          ) : null}
          {err ? <Msg kind="err">{err}</Msg> : null}
          {item.kind === 'target' && editing ? <EditInline item={item} onDone={() => { setEditing(false); onChanged() }} onCancel={() => setEditing(false)} /> : null}
          {inbox ? <DraftBox item={item as TargetItem} busy={busy} act={act} canEdit={canEdit} /> : null}
          {item.kind === 'target' && canEdit && !editing && !inbox ? (
            <Row gap={8} wrap>
              {item.status === 'SCHEDULED' ? <Button small icon="clock" title="Changer l’heure ou le texte" disabled={busy} onPress={() => setEditing(true)} /> : null}
              {item.status === 'SCHEDULED' ? (
                <Button small icon="bolt" title="Publier maintenant" disabled={busy}
                  onPress={() => act(() => publishNow(item.id), { title: 'Publier maintenant ?', message: `La vidéo part tout de suite sur ${name}.`, ok: 'Publier' })} />
              ) : null}
              {item.can_retry ? <Button small kind="primary" icon="refresh" title="Réessayer" disabled={busy} onPress={() => act(() => retryTarget(item.id))} /> : null}
            </Row>
          ) : null}
          {item.kind === 'target' && canEdit && !editing && !inbox && item.can_edit ? (
            // Action destructive à l'écart des actions principales (loi de Fitts) : plus petite, seule, en rouge.
            <View style={{ alignItems: 'flex-end', marginTop: space.sm }}>
              <Button small kind="danger" title="Annuler cette publication" disabled={busy}
                onPress={() => act(() => cancelTarget(item.id), { title: 'Annuler la publication ?', message: `Elle ne partira pas sur ${name}.`, ok: 'Annuler la publication', destructive: true })} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** Brouillon TikTok (arrivé sans légende) : légende à copier, « Publié dans l'app » (lien facultatif), « Renvoyer le brouillon ». */
function DraftBox({ item, busy, act, canEdit }: { item: TargetItem; busy: boolean; act: Act; canEdit: boolean }) {
  const { c } = useTheme()
  const caption = String(item.options?.title || '')
  const [copied, setCopied] = useState(false)
  const [asking, setAsking] = useState(false)
  const [link, setLink] = useState('')
  const copy = async () => {
    try { await Clipboard.setStringAsync(caption); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { /* presse-papiers indisponible */ }
  }
  const linkOk = tiktokLinkOk(link)
  return (
    <View style={{ gap: space.md }}>
      <Txt small>La vidéo est dans vos brouillons TikTok, <Txt small bold>sans légende</Txt> : ouvrez l’app, collez la légende, publiez, puis revenez ici.</Txt>
      {caption ? (
        <View style={{ gap: 6 }}>
          <Txt small muted>Légende TikTok</Txt>
          <View style={{ backgroundColor: c.bg, borderRadius: radius.sm, padding: space.md }}><Txt small selectable>{caption}</Txt></View>
          <Button small icon={copied ? 'check' : 'copy'} title={copied ? 'Légende copiée' : 'Copier la légende'} onPress={copy} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
      {!canEdit ? null : asking ? (
        <View style={{ gap: space.sm }}>
          <Field label="Lien de la vidéo TikTok (facultatif)" value={link} onChangeText={setLink} keyboardType="url" autoCapitalize="none" autoCorrect={false}
            placeholder="https://www.tiktok.com/@compte/video/…" error={linkOk ? null : 'Collez un lien TikTok (ou laissez vide).'} />
          <Row gap={8}>
            <Button small kind="primary" icon="check" title="Marquer publiée" disabled={busy || !linkOk} onPress={() => act(() => markPublished(item.id, link.trim() || undefined))} />
            <Button small kind="ghost" title="Annuler" onPress={() => setAsking(false)} />
          </Row>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Row gap={8} wrap>
            <Button small kind="primary" icon="check" title="Publié dans l’app" disabled={busy} onPress={() => setAsking(true)} />
            <Button small icon="refresh" title="Renvoyer le brouillon" disabled={busy}
              onPress={() => act(() => resendDraft(item.id), { title: 'Renvoyer le brouillon ?', message: 'À faire seulement si le brouillon a été supprimé dans TikTok.', ok: 'Renvoyer' })} />
          </Row>
          <Txt size={12} muted>« Publié dans l’app » : collez le lien de la vidéo si vous l’avez. « Renvoyer » : si le brouillon a été supprimé dans TikTok.</Txt>
        </View>
      )}
    </View>
  )
}

function EditInline({ item, onDone, onCancel }: { item: TargetItem; onDone: () => void; onCancel: () => void }) {
  const [when, setWhen] = useState(() => new Date(item.scheduled_at))
  const edit = editableText(item)
  const [text, setText] = useState<string>(edit ? String(item.options?.[edit.key] ?? '') : '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (when.getTime() < Date.now() - 60000) { setErr("L'heure choisie est déjà passée."); return }
    setBusy(true); setErr('')
    try { await patchTarget(item.id, { scheduled_at: when.toISOString(), ...(edit ? { options: { [edit.key]: text } } : {}) }); onDone() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <View style={{ gap: space.md }}>
      <DateTimeField label="Nouvelle heure" value={when} onChange={setWhen} minimumDate={new Date()} />
      {edit ? (
        <Field label={edit.label} value={text} onChangeText={setText} maxLength={edit.max} multiline={edit.label !== 'Titre YouTube'}
          hint={`${text.length} / ${edit.max.toLocaleString('fr-FR')}`} />
      ) : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
      <Row gap={8}>
        <Button small title="Annuler" onPress={onCancel} />
        <Button small kind="primary" title="Enregistrer" loading={busy} onPress={save} />
      </Row>
    </View>
  )
}
