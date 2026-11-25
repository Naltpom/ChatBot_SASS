// Droits d'auteur d'une publication : bandeau si l'œuvre est protégée ou ses droits inconnus, et réglage.
import { useState } from 'react'
import { View } from 'react-native'
import { isRisky, patchPost, RIGHTS_LABEL, RIGHTS_WARNING, type Post, type Rights } from '../../lib/api'
import { Button, Chip, Field, Msg, Row, Txt } from '../../ui/kit'
import { space } from '../../ui/theme'

export function RightsBox({ post, canEdit, onSaved }: { post: Post; canEdit: boolean; onSaved: (p: Post) => void }) {
  const [editing, setEditing] = useState(false)
  const [rights, setRights] = useState<Rights>(post.rights || 'unknown')
  const [note, setNote] = useState(post.rights_note || '')
  const [err, setErr] = useState('')
  const save = async () => {
    setErr('')
    try { onSaved(await patchPost(post.id, { rights, rights_note: note })); setEditing(false) } catch (e: any) { setErr(e?.message || 'Erreur') }
  }
  return (
    <View style={{ gap: space.sm }} accessibilityLabel="Droits d’auteur">
      {isRisky(post.rights) ? <Msg kind="warn">{post.rights_warning || RIGHTS_WARNING}</Msg> : null}
      {!editing ? (
        <Row wrap gap={6}>
          <Txt small muted>Droits :</Txt>
          <Txt small bold>{post.rights ? RIGHTS_LABEL[post.rights] : 'Non précisés'}</Txt>
          {post.rights_note ? <Txt small muted numberOfLines={1} style={{ flexShrink: 1 }}>· {post.rights_note}</Txt> : null}
          {canEdit ? <Button small kind="ghost" title="Modifier" onPress={() => setEditing(true)} /> : null}
        </Row>
      ) : (
        <View style={{ gap: space.sm }}>
          <Row wrap>
            {(['public_domain', 'protected', 'unknown'] as Rights[]).map(r => (
              <Chip key={r} label={RIGHTS_LABEL[r]} selected={rights === r} onPress={() => setRights(r)} />
            ))}
          </Row>
          <Field value={note} onChangeText={setNote} maxLength={300} placeholder="Note (ex. reprise — Wicked, Stephen Schwartz)" accessibilityLabel="Note sur les droits" />
          {err ? <Msg kind="err">{err}</Msg> : null}
          <Row>
            <Button small kind="primary" title="Enregistrer" onPress={save} />
            <Button small kind="ghost" title="Annuler" onPress={() => setEditing(false)} />
          </Row>
        </View>
      )}
    </View>
  )
}
