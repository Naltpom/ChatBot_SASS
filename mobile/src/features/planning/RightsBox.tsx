// Droits d'auteur d'une publication : bandeau si l'œuvre est protégée ou ses droits inconnus, et réglage.
import { useState } from 'react'
import { View } from 'react-native'
import { isRisky, patchPost, RIGHTS_LABEL, RIGHTS_WARNING, type Post, type Rights } from '../../lib/api'
import { Button, Chip, Field, Msg, Row, Txt } from '../../ui/kit'
import { t } from '../../lib/i18n'
import { space } from '../../ui/theme'

export function RightsBox({ post, canEdit, onSaved }: { post: Post; canEdit: boolean; onSaved: (p: Post) => void }) {
  const [editing, setEditing] = useState(false)
  const [rights, setRights] = useState<Rights>(post.rights || 'unknown')
  const [note, setNote] = useState(post.rights_note || '')
  const [err, setErr] = useState('')
  const save = async () => {
    setErr('')
    try { onSaved(await patchPost(post.id, { rights, rights_note: note })); setEditing(false) } catch (e: any) { setErr(e?.message || t('Erreur')) }
  }
  return (
    <View style={{ gap: space.sm }} accessibilityLabel={t('Droits d’auteur')}>
      {isRisky(post.rights) ? <Msg kind="warn">{t(post.rights_warning || RIGHTS_WARNING)}</Msg> : null}
      {!editing ? (
        <Row wrap gap={6}>
          <Txt small muted>{t('Droits :')}</Txt>
          <Txt small bold>{post.rights ? t(RIGHTS_LABEL[post.rights]) : t('Non précisés')}</Txt>
          {post.rights_note ? <Txt small muted numberOfLines={1} style={{ flexShrink: 1 }}>· {post.rights_note}</Txt> : null}
          {canEdit ? <Button small kind="ghost" title={t('Modifier')} onPress={() => setEditing(true)} /> : null}
        </Row>
      ) : (
        <View style={{ gap: space.sm }}>
          <Row wrap>
            {(['public_domain', 'protected', 'unknown'] as Rights[]).map(r => (
              <Chip key={r} label={t(RIGHTS_LABEL[r])} selected={rights === r} onPress={() => setRights(r)} />
            ))}
          </Row>
          <Field value={note} onChangeText={setNote} maxLength={300} placeholder={t('Note (ex. reprise — Wicked, Stephen Schwartz)')} accessibilityLabel={t('Note sur les droits')} />
          {err ? <Msg kind="err">{err}</Msg> : null}
          <Row>
            <Button small kind="primary" title={t('Enregistrer')} onPress={save} />
            <Button small kind="ghost" title={t('Annuler')} onPress={() => setEditing(false)} />
          </Row>
        </View>
      )}
    </View>
  )
}
