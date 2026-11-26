// Avant de planifier : chaque compte, l'un après l'autre. « Valider » passe au suivant ; « Modifier » ouvre ses
// champs sur place (puis « Enregistrer ») ; « Retirer » l'enlève de la programmation. Un compte avec un réglage
// manquant ne se valide pas tant qu'il n'est pas corrigé. Le dernier validé lance la planification.
import * as Haptics from 'expo-haptics'
import { useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { PLATFORM_LABEL, type Account } from '../../lib/api'
import { LOCALE } from '../../lib/locale'
import { Avatar, Button, Msg, Row, Sheet, Txt } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'
import { longDate } from './compose'

export function ReviewSheet({ visible, onClose, accounts, when, recap, problems, renderEdit, onRemove, onDone, busy, finalLabel }: {
  visible: boolean
  onClose: () => void
  accounts: Account[]
  /** Heure de publication du compte (null : tout de suite). */
  when: (a: Account) => Date | null
  recap: (a: Account) => [string, string][]
  problems: (a: Account) => string[]
  renderEdit: (a: Account) => ReactNode
  onRemove: (a: Account) => void
  onDone: () => void
  busy?: boolean
  finalLabel: string
}) {
  const { c } = useTheme()
  const [i, setI] = useState(0)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (visible) { setI(0); setEditing(false) } }, [visible])
  // Compte retiré pendant la validation : on reste sur une position qui existe.
  useEffect(() => { if (i > accounts.length - 1) setI(Math.max(accounts.length - 1, 0)) }, [accounts.length, i])
  const a = accounts[i]
  if (!a) return null
  const errs = problems(a)
  const at = when(a)
  const last = i === accounts.length - 1
  const validate = () => {
    Haptics.selectionAsync().catch(() => {})
    if (last) onDone(); else { setI(i + 1); setEditing(false) }
  }
  const footer = editing ? (
    <Button kind="primary" icon="check" title="Enregistrer" onPress={() => { Haptics.selectionAsync().catch(() => {}); setEditing(false) }} />
  ) : (
    <View style={{ gap: space.sm }}>
      <Row gap={space.sm}>
        <Button icon="edit" title="Modifier" disabled={busy} onPress={() => setEditing(true)} style={{ flex: 1 }} />
        <Button kind="primary" icon={last ? 'clock' : 'check'} title={last ? finalLabel : 'Valider'} loading={busy && last}
          disabled={busy || errs.length > 0} onPress={validate} style={{ flex: 1.4 }} />
      </Row>
      <Button kind="danger" icon="close" title="Retirer ce compte" disabled={busy || accounts.length < 2}
        onPress={() => { onRemove(a); setEditing(false) }} />
    </View>
  )
  return (
    <Sheet visible={visible} title={`Vérification · ${i + 1} / ${accounts.length}`} onClose={busy ? () => {} : onClose} footer={footer}>
      <Row gap={space.md}>
        <Avatar src={a.avatar_url} name={a.name} platform={a.platform} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt bold numberOfLines={1}>{a.name || PLATFORM_LABEL[a.platform]}</Txt>
          <Txt small muted numberOfLines={2}>{PLATFORM_LABEL[a.platform]} · {at ? longDate(at, LOCALE) : 'tout de suite'}</Txt>
        </View>
      </Row>
      {errs.length ? <Msg kind="err">À corriger : {errs.join(' ')}</Msg> : null}
      {editing ? renderEdit(a) : (
        <View style={{ gap: 0 }}>
          {recap(a).map(([k, v]) => (
            <View key={k} style={{ paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border, gap: 2 }}>
              <Txt size={12} muted>{k}</Txt>
              <Txt numberOfLines={6} color={/^à (choisir|indiquer|préciser)/.test(v) ? c.danger : c.text}>{v}</Txt>
            </View>
          ))}
        </View>
      )}
      {accounts.length < 2 && !editing ? <Txt size={12} muted>Dernier compte : pour l’enlever, fermez et changez les comptes.</Txt> : null}
      {accounts.length > 1 ? (
        <Txt size={12} muted>{accounts.map((_, j) => (j < i ? '✓' : j === i ? '●' : '○')).join('  ')}  ·  {i} validé{i > 1 ? 's' : ''} sur {accounts.length}</Txt>
      ) : null}
    </Sheet>
  )
}

