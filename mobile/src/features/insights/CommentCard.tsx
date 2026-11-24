// Un commentaire (onglet Commentaires, fiche vidéo) : avatar, @pseudo, plateforme et heure, texte ;
// une action visible (Répondre, ou Réponse privée en mode mot-clé), le reste dans « … ».
// La réponse s'écrit sous le commentaire ; envoyée, elle s'affiche en bulle « Vous ».
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { commentAction, PLATFORM_LABEL, type Comment } from '../../lib/api'
import { fmtAgo } from '../../lib/format'
import { useSession } from '../../lib/session'
import { Avatar, Button, Field, Icon, IconButton, Msg, Row, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { errText, openApp } from './hooks'
import { commentActions, personalize, STATUS_DONE, type CommentActionId } from './logic'
import { ActionMenu, Thumb, type MenuItem } from './parts'

export function CommentCard({ c, onChanged, canEdit, template }:
  { c: Comment; onChanged: (c: Comment | null) => void; canEdit: boolean; template?: string }) {
  const { c: col } = useTheme()
  const { org } = useSession()
  const [mode, setMode] = useState<'reply' | 'private' | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [menu, setMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const keyword = template !== undefined
  const personal = personalize(template || '', c.author)
  const { main, more } = commentActions(c, keyword)

  const run = async (fn: () => Promise<Comment>) => {
    setBusy(true); setErr('')
    try {
      const n = await fn()
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      onChanged(n); setMode(null); setText('')
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const copy = async () => {
    try { await Clipboard.setStringAsync(personal); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { setErr('Copie impossible.') }
  }
  const act = (id: CommentActionId) => {
    switch (id) {
      case 'reply': setMode(m => (m === 'reply' ? null : 'reply')); setText(''); break
      case 'private': setMode(m => (m === 'private' ? null : 'private')); setText(personal); break
      case 'tiktok': if (c.video_url) openApp(c.video_url); break
      case 'copy': copy(); break
      case 'dm': if (c.dm_url) openApp(c.dm_url); break
      case 'profile': if (c.profile_url) openApp(c.profile_url); break
      case 'hide':
        Alert.alert('Masquer ce commentaire ?', 'Il sera masqué pour tout le monde.', [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Masquer', style: 'destructive', onPress: () => run(() => commentAction(org, c.id, 'hide')) },
        ])
        break
      case 'done': run(() => commentAction(org, c.id, keyword ? 'contacted' : 'ignore')); break
      case 'reopen': run(() => commentAction(org, c.id, 'reopen')); break
    }
  }
  const items: MenuItem[] = more.map(a => ({ label: a.id === 'copy' && copied ? 'Copié ✓' : a.label, danger: a.danger, onPress: () => act(a.id) }))
  const who = c.author ? `@${c.author.replace(/^@/, '')}` : 'Anonyme'
  const meta = `${PLATFORM_LABEL[c.platform]} · ${fmtAgo(c.published_at)}${c.count && c.count > 1 ? ` · ${c.count} commentaires` : ''}`
  const done = c.status !== 'new' && !c.pending ? STATUS_DONE[c.status] : undefined

  return (
    <View style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.md }}>
      <Avatar src={null} name={c.author} size={36} />
      <View style={{ flex: 1, gap: 6 }}>
        <View accessible accessibilityLabel={`${who}, ${meta}. ${c.text || ''}`}>
          <Row gap={6} wrap>
            <Txt bold numberOfLines={1}>{who}</Txt>
            <Txt small muted>{meta}</Txt>
          </Row>
          <Txt selectable style={{ marginTop: 2 }}>{c.text}</Txt>
        </View>
        {c.reply_text ? (
          <View style={{ backgroundColor: col.surface2, borderRadius: radius.md, padding: space.sm, paddingHorizontal: space.md, gap: 2 }}>
            <Txt small bold>Vous</Txt>
            <Txt small selectable>{c.reply_text}</Txt>
          </View>
        ) : null}
        {done ? <Txt small color={col.ok}>{done}</Txt> : null}
        {c.pending ? <Txt small muted>Envoi en cours par la routine…</Txt> : null}
        {c.error ? <Msg kind="err">{c.error}</Msg> : null}
        {err ? <Msg kind="err">{err}</Msg> : null}
        {canEdit && !c.pending && (main || items.length) && !mode ? (
          <Row style={{ justifyContent: 'space-between' }}>
            {main ? (
              <Button small kind="secondary" title={main.id === 'copy' && copied ? 'Copié ✓' : main.label} onPress={() => act(main.id)} loading={busy && !mode} />
            ) : <View />}
            {items.length ? <IconButton icon="more" label="Plus d’actions" onPress={() => setMenu(true)} color={col.muted} /> : null}
          </Row>
        ) : null}
        {mode ? (
          <View style={{ gap: space.sm }}>
            <Field value={text} onChangeText={setText} multiline maxLength={2200} autoFocus
              accessibilityLabel={mode === 'reply' ? 'Votre réponse' : 'Message privé'}
              placeholder={mode === 'reply' ? `Votre réponse à ${who}` : 'Message privé (une fois, dans les 7 jours)'} />
            <Row style={{ justifyContent: 'flex-end' }}>
              <Button small kind="ghost" title="Annuler" onPress={() => setMode(null)} />
              <Button small kind="primary" title={mode === 'reply' ? 'Publier' : 'Envoyer en privé'} disabled={!text.trim()} loading={busy}
                onPress={() => run(() => commentAction(org, c.id, mode === 'reply' ? 'reply' : 'private-reply', text.trim()))} />
            </Row>
          </View>
        ) : null}
      </View>
      <ActionMenu visible={menu} title={who} items={items} onClose={() => setMenu(false)} />
    </View>
  )
}

/** En-tête d'un groupe de commentaires (vidéo) ; touchable si la fiche vidéo existe. */
export function GroupHead({ title, thumb, sub, onPress }: { title: string; thumb: string | null; sub: string; onPress?: () => void }) {
  const { c } = useTheme()
  const body = (
    <>
      <Thumb uri={thumb} w={40} h={52} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt bold numberOfLines={1}>{title}</Txt>
        <Txt small muted numberOfLines={1}>{sub}</Txt>
      </View>
      {onPress ? <Icon name="right" size={18} color={c.faint} /> : null}
    </>
  )
  if (!onPress) return <Row gap={space.md} style={{ paddingBottom: space.sm }}>{body}</Row>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}, ${sub}. Ouvrir la fiche vidéo`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingBottom: space.sm, opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  )
}
