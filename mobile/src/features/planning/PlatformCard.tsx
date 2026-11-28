// Carte d'une plateforme dans la fiche de publication : état, ce qui diffère du commun, lien, chiffres,
// actions (changer l'heure ou le texte, publier maintenant, annuler, réessayer) et « publier soi-même » (textes à
// copier + « Publié » avec le lien) : brouillon TikTok, publication ratée, ou prévue.
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  cancelTarget, fixLink, markPublished, patchTarget, publishNow, publishedByHand, resendDraft, retryTarget, PLATFORM_LABEL, type CalendarItem, type Target,
} from '../../lib/api'
import { fmtDateTime, num } from '../../lib/format'
import { locale, t } from '../../lib/i18n'
import { Button, Field, Icon, Msg, PlatformLogo, Row, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { STATE_LABEL, stateOf, type TargetItem } from './calendar'
import { openLink } from './media'
import { diffsOf, editableText, linkOk, LINK_EXAMPLE, manualTexts } from './sheet'
import { DateTimeField } from './ui'
import { showDialog } from '../../ui/dialog'

/** Demande une confirmation (Oui / Non). */
export const confirm = (title: string, message: string, ok: string, destructive = false) =>
  new Promise<boolean>(resolve => showDialog(title, message, [
    { text: t('Non'), style: 'cancel', onPress: () => resolve(false) },
    { text: ok, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }))

type Act = (fn: () => Promise<unknown>, ask?: { title: string; message: string; ok: string; destructive?: boolean }) => Promise<void>

export function PlatformCard({ item, common, open, onToggle, onChanged, canEdit, targets = [] }: {
  item: CalendarItem; common: string; open: boolean; onToggle: () => void; onChanged: () => void; canEdit: boolean; targets?: Target[]
}) {
  const { c } = useTheme()
  const st = stateOf(item)
  const inbox = item.kind === 'target' && item.status === 'INBOX'
  const [editing, setEditing] = useState(false)
  const [manual, setManual] = useState(false)
  const [linkEdit, setLinkEdit] = useState(false)
  // Cible publiée derrière la carte (vidéo relevée : retrouvée dans la publication) : son lien se corrige.
  const published = item.kind === 'target' ? (item.status === 'PUBLISHED' ? item : null)
    : targets.find(x => x.status === 'PUBLISHED' && x.platform === item.platform && x.account_id === item.account_id && x.external_id === item.external_id) || null
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
  const sub = t(inbox ? '{account} · brouillon envoyé {date}' : st === 'planned' ? '{account} · prévue {date}' : '{account} · publiée {date}',
    { account: item.account_name || name, date: fmtDateTime(when) })
  const stateText = inbox ? t('À publier dans l’app') : t(STATE_LABEL[st])
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
            <Pressable onPress={() => openLink(item.url!)} accessibilityRole="link" accessibilityLabel={t('Voir sur {name}', { name })}
              style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
              <Txt bold color={c.accent}>{t('Voir sur {name}', { name })}</Txt><Icon name="external" size={16} color={c.accent} />
            </Pressable>
          ) : null}
          {published && canEdit ? (linkEdit
            ? <LinkEdit target={published} busy={busy} act={act} onDone={() => setLinkEdit(false)} />
            : <Pressable onPress={() => setLinkEdit(true)} disabled={busy} accessibilityRole="button"
                style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
                <Icon name="edit" size={16} color={c.accent} /><Txt bold color={c.accent}>{published.url ? t('Modifier le lien') : t('Ajouter le lien')}</Txt>
              </Pressable>) : null}
          {diffs.length ? (
            <View style={{ gap: space.sm }}>
              {diffs.map(([k, v]) => (
                <View key={k} style={{ gap: 2 }}>
                  <Txt small muted>{t(k)}</Txt>
                  <Txt small numberOfLines={4} selectable>{t(v)}</Txt>
                </View>
              ))}
            </View>
          ) : item.kind === 'target' && !inbox ? <Txt small muted>{t('Rien de propre à {name} : texte commun.', { name })}</Txt> : null}
          {item.kind === 'video' ? (
            <Row gap={14} wrap>
              <Txt small><Txt small bold>{num(item.views)}</Txt> {t('vues')}</Txt>
              <Txt small><Txt small bold>{num(item.likes)}</Txt> {t('j’aime')}</Txt>
              {item.comments != null ? <Txt small><Txt small bold>{num(item.comments)}</Txt> {t('comm.')}</Txt> : null}
              {item.shares != null ? <Txt small><Txt small bold>{num(item.shares)}</Txt> {t('partages')}</Txt> : null}
              {item.saves != null ? <Txt small><Txt small bold>{num(item.saves)}</Txt> {t('enreg.')}</Txt> : null}
            </Row>
          ) : null}
          {err ? <Msg kind="err">{err}</Msg> : null}
          {item.kind === 'target' && editing ? <EditInline item={item} onDone={() => { setEditing(false); onChanged() }} onCancel={() => setEditing(false)} /> : null}
          {item.kind === 'target' && !editing && (inbox || item.status === 'FAILED' || (item.status === 'SCHEDULED' && manual))
            ? <ManualBox item={item as TargetItem} common={common} busy={busy} act={act} canEdit={canEdit}
                onClose={item.status === 'SCHEDULED' ? () => setManual(false) : undefined} /> : null}
          {item.kind === 'target' && canEdit && !editing && !inbox ? (
            <Row gap={8} wrap>
              {item.status === 'SCHEDULED' ? <Button small icon="clock" title={t('Changer l’heure ou le texte')} disabled={busy} onPress={() => setEditing(true)} /> : null}
              {item.status === 'SCHEDULED' ? (
                <Button small icon="bolt" title={t('Publier maintenant')} disabled={busy}
                  onPress={() => act(() => publishNow(item.id), { title: t('Publier maintenant ?'), message: t('La vidéo part tout de suite sur {name}.', { name }), ok: t('Publier') })} />
              ) : null}
              {item.status === 'SCHEDULED' && !manual ? <Button small icon="copy" title={t('Publier moi-même')} disabled={busy} onPress={() => setManual(true)} /> : null}
              {item.can_retry ? <Button small kind="primary" icon="refresh" title={t('Réessayer')} disabled={busy} onPress={() => act(() => retryTarget(item.id))} /> : null}
            </Row>
          ) : null}
          {item.kind === 'target' && canEdit && !editing && !inbox && item.can_edit ? (
            // Action destructive à l'écart des actions principales (loi de Fitts) : plus petite, seule, en rouge.
            <View style={{ alignItems: 'flex-end', marginTop: space.sm }}>
              <Button small kind="danger" title={t('Annuler cette publication')} disabled={busy}
                onPress={() => act(() => cancelTarget(item.id), { title: t('Annuler la publication ?'), message: t('Elle ne partira pas sur {name}.', { name }), ok: t('Annuler la publication'), destructive: true })} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** Publier soi-même : textes à copier, « Publié » (lien facultatif). Brouillon TikTok : aussi « Renvoyer le brouillon ».
 *  Pour une publication ratée (ouverte d'office) ou prévue (repliée derrière « Publier moi-même »). */
function ManualBox({ item, common, busy, act, canEdit, onClose }: { item: TargetItem; common: string; busy: boolean; act: Act; canEdit: boolean; onClose?: () => void }) {
  const { c } = useTheme()
  const inbox = item.status === 'INBOX'
  const name = PLATFORM_LABEL[item.platform]
  const texts = manualTexts(item, common)
  const [copied, setCopied] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [link, setLink] = useState('')
  const copy = async (k: string, v: string) => {
    try { await Clipboard.setStringAsync(v); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); setCopied(k); setTimeout(() => setCopied(null), 2000) }
    catch { /* presse-papiers indisponible */ }
  }
  const ok = linkOk(item.platform, link)
  const done = (url?: string) => inbox ? markPublished(item.id, url) : publishedByHand(item.id, url)
  return (
    <View style={{ gap: space.md }}>
      {inbox
        ? <Txt small>{t('La vidéo est dans vos brouillons TikTok,')} <Txt small bold>{t('sans légende')}</Txt>{t(' : ouvrez l’app, collez la légende, publiez, puis revenez ici.')}</Txt>
        : <Txt small>{t('Copiez le texte, publiez la vidéo vous-même dans {name}, puis revenez ici.', { name })}</Txt>}
      {texts.map(([k, v]) => (
        <View key={k} style={{ gap: 6 }}>
          <Txt small muted>{t(k)}</Txt>
          <View style={{ backgroundColor: c.bg, borderRadius: radius.sm, padding: space.md }}><Txt small selectable>{v}</Txt></View>
          <Button small icon={copied === k ? 'check' : 'copy'} title={copied === k ? t('Copié') : t('Copier')} onPress={() => copy(k, v)}
            accessibilityLabel={t('Copier : {what}', { what: t(k) })} style={{ alignSelf: 'flex-start' }} />
        </View>
      ))}
      {!canEdit ? null : asking ? (
        <View style={{ gap: space.sm }}>
          <Field label={t('Lien de la vidéo {name} (facultatif)', { name })} value={link} onChangeText={setLink} keyboardType="url" autoCapitalize="none" autoCorrect={false}
            placeholder={LINK_EXAMPLE[item.platform] ?? 'https://…'} error={ok ? null : t('Collez un lien {name} (ou laissez vide).', { name })} />
          <Row gap={8}>
            <Button small kind="primary" icon="check" title={t('Marquer publiée')} disabled={busy || !ok} onPress={() => act(() => done(link.trim() || undefined))} />
            <Button small kind="ghost" title={t('Annuler')} onPress={() => setAsking(false)} />
          </Row>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Row gap={8} wrap>
            <Button small kind="primary" icon="check" title={t('Publié dans l’app')} disabled={busy} onPress={() => setAsking(true)} />
            {inbox ? <Button small icon="refresh" title={t('Renvoyer le brouillon')} disabled={busy}
              onPress={() => act(() => resendDraft(item.id), { title: t('Renvoyer le brouillon ?'), message: t('À faire seulement si le brouillon a été supprimé dans TikTok.'), ok: t('Renvoyer') })} /> : null}
            {onClose ? <Button small kind="ghost" title={t('Fermer')} onPress={onClose} /> : null}
          </Row>
          <Txt size={12} muted>{inbox
            ? t('« Publié dans l’app » : collez le lien de la vidéo si vous l’avez. « Renvoyer » : si le brouillon a été supprimé dans TikTok.')
            : item.status === 'SCHEDULED'
              ? t('« Publié dans l’app » : collez le lien si vous l’avez. La publication prévue est alors retirée, rien ne partira en double.')
              : t('« Publié dans l’app » : collez le lien de la vidéo si vous l’avez.')}</Txt>
        </View>
      )}
    </View>
  )
}

/** Lien d'une publication publiée, corrigé ou retiré (vide). */
function LinkEdit({ target, busy, act, onDone }: { target: Target; busy: boolean; act: Act; onDone: () => void }) {
  const name = PLATFORM_LABEL[target.platform]
  const [link, setLink] = useState(target.url || '')
  const ok = linkOk(target.platform, link)
  const save = () => act(async () => { await fixLink(target.id, link.trim()); onDone() })   // erreur : le champ reste ouvert
  return (
    <View style={{ gap: space.sm }}>
      <Field label={t('Lien de la vidéo {name} (vide pour le retirer)', { name })} value={link} onChangeText={setLink} keyboardType="url" autoCapitalize="none" autoCorrect={false}
        placeholder={LINK_EXAMPLE[target.platform] ?? 'https://…'} error={ok ? null : t('Collez un lien {name} (ou laissez vide).', { name })} autoFocus />
      <Row gap={8}>
        <Button small kind="primary" icon="check" title={t('Enregistrer le lien')} disabled={busy || !ok}
          onPress={save} />
        <Button small kind="ghost" title={t('Annuler')} onPress={onDone} />
      </Row>
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
    if (when.getTime() < Date.now() - 60000) { setErr(t("L'heure choisie est déjà passée.")); return }
    setBusy(true); setErr('')
    try { await patchTarget(item.id, { scheduled_at: when.toISOString(), ...(edit ? { options: { [edit.key]: text } } : {}) }); onDone() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <View style={{ gap: space.md }}>
      <DateTimeField label={t('Nouvelle heure')} value={when} onChange={setWhen} minimumDate={new Date()} />
      {edit ? (
        <Field label={t(edit.label)} value={text} onChangeText={setText} maxLength={edit.max} multiline={edit.label !== 'Titre YouTube'}
          hint={`${text.length.toLocaleString(locale())} / ${edit.max.toLocaleString(locale())}`} />
      ) : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
      <Row gap={8}>
        <Button small title={t('Annuler')} onPress={onCancel} />
        <Button small kind="primary" title={t('Enregistrer')} loading={busy} onPress={save} />
      </Row>
    </View>
  )
}
